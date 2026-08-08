// ─── ChallanSe Authentication Layer ──────────────────────────────────────────
// Device token authentication (SHA-256 with pepper)
// Reviewer OIDC identity verification (via Cloudflare Access or local-pilot)
// Nonce replay protection (D1-backed)

import { sha256Hex } from './security';
import { consumeNonce, first, getOrganization, getSite, getReviewer as dbGetReviewer, touchDevice } from './db';
import type { Env } from './types';

// ─── Device Context ──────────────────────────────────────────────────────────

export interface DeviceContext {
  id: string;
  organizationId: string;
  siteId: string;
  name: string;
}

export class DeviceAuthError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
  ) {
    super(code);
    this.name = 'DeviceAuthError';
  }
}

// ─── Reviewer Context ────────────────────────────────────────────────────────

export interface ReviewerContext {
  userId: string;
  organizationId: string;
  siteId: string;
  role: string;
  email: string;
  issuer: string;
  subject: string;
}

export class ReviewerAuthError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
  ) {
    super(code);
    this.name = 'ReviewerAuthError';
  }
}

// ─── Token Hashing ───────────────────────────────────────────────────────────

async function tokenHash(token: string, pepper: string): Promise<string> {
  return sha256Hex(`${token}:${pepper}`);
}

// ─── Device Authentication ───────────────────────────────────────────────────

/**
 * Authenticate a device from the Authorization header.
 * Expects: "Bearer <device-token>"
 * Looks up the SHA-256(token:pepper) hash in the devices table.
 * Returns DeviceContext or throws DeviceAuthError.
 */
export async function authenticateDevice(
  db: D1Database,
  authorization: string | null,
  pepper: string | undefined,
): Promise<DeviceContext> {
  if (!pepper || !authorization?.startsWith('Bearer ')) {
    throw new DeviceAuthError('DEVICE_UNAUTHORIZED', 401);
  }
  const token = authorization.slice(7).trim();
  if (token.length < 32) {
    throw new DeviceAuthError('DEVICE_UNAUTHORIZED', 401);
  }

  const hash = await tokenHash(token, pepper);
  const row = await first<{
    id: string;
    site_id: string;
    organization_id: string;
    name: string;
  }>(
    db,
    `SELECT d.id, d.site_id, d.organization_id, d.name
     FROM devices d
     JOIN organizations o ON o.id = d.organization_id AND o.active = 1
     JOIN sites s ON s.id = d.site_id AND s.organization_id = d.organization_id AND s.active = 1
     WHERE d.token_hash = ? AND d.active = 1`,
    hash,
  );
  if (!row) throw new DeviceAuthError('DEVICE_UNAUTHORIZED', 401);

  // Update last_seen_at asynchronously (fire-and-forget, non-critical)
  touchDevice(db, row.id).catch(() => {});

  return {
    id: row.id,
    siteId: row.site_id,
    organizationId: row.organization_id,
    name: row.name,
  };
}

// ─── Device Nonce Replay Protection ──────────────────────────────────────────

/**
 * Validate and consume a device nonce from request headers.
 * Headers: X-ChallanSe-Nonce, X-ChallanSe-Device-Timestamp
 * Throws DeviceAuthError if nonce is replayed, expired, or missing.
 */
export async function authenticateDeviceNonce(
  db: D1Database,
  device: DeviceContext,
  headers: Headers,
): Promise<void> {
  const nonce = headers.get('X-ChallanSe-Nonce');
  const timestamp = headers.get('X-ChallanSe-Device-Timestamp');
  if (!nonce || !timestamp) {
    throw new DeviceAuthError('DEVICE_NONCE_REQUIRED', 400);
  }
  const result = await consumeNonce(db, device.id, timestamp, nonce);
  switch (result) {
    case 'replay':
      throw new DeviceAuthError('DEVICE_NONCE_REPLAY', 400);
    case 'expired':
      throw new DeviceAuthError('DEVICE_NONCE_EXPIRED', 400);
    case 'ok':
      return;
  }
}

// ─── Reviewer Authentication ─────────────────────────────────────────────────

/**
 * Authenticate a reviewer from their OIDC identity (Cloudflare Access JWT).
 * Looks up the reviewer in D1 by (issuer, subject).
 * Returns ReviewerContext or throws ReviewerAuthError.
 */
export async function authenticateReviewer(
  db: D1Database,
  issuer: string,
  subject: string,
  email: string,
): Promise<ReviewerContext> {
  const row = await dbGetReviewer(db, issuer, subject);
  if (!row) throw new ReviewerAuthError('REVIEWER_UNAUTHORIZED', 401);

  return {
    userId: row.email, // email is the PK in reviewers
    organizationId: row.organization_id,
    siteId: row.site_id,
    role: row.role,
    email: row.email,
    issuer: row.issuer,
    subject: row.subject,
  };
}

// ─── Authorization Helpers ───────────────────────────────────────────────────

/**
 * Verify the reviewer has one of the required roles.
 * Throws ReviewerAuthError if not authorized.
 */
export function requireRole(reviewer: ReviewerContext, allowedRoles: string[]): void {
  if (!allowedRoles.includes(reviewer.role)) {
    throw new ReviewerAuthError('REVIEWER_FORBIDDEN', 403);
  }
}

/**
 * Verify the site belongs to the reviewer's organization.
 * Throws ReviewerAuthError if site is not in the organization.
 */
export async function verifySiteAccess(
  db: D1Database,
  reviewer: ReviewerContext,
  siteId: string,
): Promise<void> {
  const site = await getSite(db, siteId);
  if (!site || site.organization_id !== reviewer.organizationId) {
    throw new ReviewerAuthError('SITE_ACCESS_DENIED', 403);
  }
}

/**
 * Verify the organization exists and is active.
 * Throws ReviewerAuthError if inactive or missing.
 */
export async function verifyOrganization(
  db: D1Database,
  organizationId: string,
): Promise<void> {
  const org = await getOrganization(db, organizationId);
  if (!org) {
    throw new ReviewerAuthError('ORGANIZATION_NOT_FOUND', 404);
  }
}

// ─── Play Integrity Verification (stub for production) ───────────────────────

/**
 * Verify Google Play Integrity token.
 * In local-pilot mode, skip validation.
 * In production, call Google Play Integrity API.
 * Returns 'pass' | 'fail'.
 *
 * Full implementation in Phase 6 (Google Play Store Publishing).
 */
export async function verifyPlayIntegrity(
  env: Env,
  token: string | null,
  expectedRequestHash: string,
): Promise<'pass' | 'fail'> {
  if (env.ENVIRONMENT === 'local-pilot' || env.ENVIRONMENT === 'development') {
    return 'pass';
  }
  // Production enrollment stays fail-closed until server-side Play Integrity
  // decoding and request-hash verification are implemented and evidenced.
  void token;
  void expectedRequestHash;
  return 'fail';
}
