// ─── Device Endpoints ────────────────────────────────────────────────────────
// Handlers for device enrollment, mobile bootstrap, and telemetry.
// Ported from services/enrichment/app/authoritative.py

import { error, json } from '../responses';
import { authenticateDevice, authenticateDeviceNonce, verifyPlayIntegrity, DeviceAuthError } from '../auth';
import { uuid, exec, first, getSite, getOrganization, getVendorsBySite } from '../db';
import { sha256Hex, randomEnrollmentCode } from '../security';
import { appendAuditEvent, deviceEnrolledEvent } from '../audit-chain';
import { upsertGraphNode, ensureDeviceInGraph } from '../graph';
import type { Env } from '../types';

// Mobile PilotConfiguration.pilotMode (see apps/mobile/src/config/deviceEnrollment.ts).
// Synthetic demo mode is reserved for the local pilot and development runtimes so
// the mobile app can never emit synthetic receipts against a production server.
export function pilotModeFor(environment: string | undefined): 'synthetic-demo' | 'controlled-client-pilot' {
  return environment === 'local-pilot' || environment === 'development'
    ? 'synthetic-demo'
    : 'controlled-client-pilot';
}

// ─── POST /v1/devices/enroll ─────────────────────────────────────────────────

export async function handleEnroll(request: Request, env: Env): Promise<Response> {
  const db = env.DB;
  let body: { enrollmentCode?: string; appVersion?: string; integrityToken?: string };
  try {
    body = await request.json();
  } catch {
    return error(request, env, 400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
  }

  if (!body.enrollmentCode || typeof body.enrollmentCode !== 'string') {
    return error(request, env, 400, 'MISSING_ENROLLMENT_CODE', 'Enrollment code is required.');
  }

  // Verify enrollment code
  const codeRow = await first<{
    id: string;
    site_id: string;
    organization_id: string;
    device_name: string;
  }>(
    db,
    `SELECT ec.id, ec.site_id, ec.organization_id, ec.device_name
     FROM enrollment_codes ec
     JOIN sites s ON s.id = ec.site_id AND s.active = 1
     JOIN organizations o ON o.id = ec.organization_id AND o.active = 1
     WHERE ec.code = ? AND ec.active = 1 AND (ec.expires_at IS NULL OR ec.expires_at > datetime('now'))
     LIMIT 1`,
    body.enrollmentCode.toUpperCase(),
  );

  if (!codeRow) {
    return error(request, env, 404, 'INVALID_ENROLLMENT_CODE', 'The enrollment code is invalid or has expired.');
  }

  // Verify Play Integrity in production
  const integrityResult = await verifyPlayIntegrity(env, body.integrityToken ?? null, '');
  if (integrityResult !== 'pass' && env.ENVIRONMENT === 'production') {
    return error(request, env, 403, 'INTEGRITY_CHECK_FAILED', 'Device integrity verification failed.');
  }

  // Generate device token
  const rawToken = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const pepper = env.DEVICE_TOKEN_PEPPER || '';
  const tokenHash = await sha256Hex(`${rawToken}:${pepper}`);

  const deviceId = uuid();
  const now = new Date().toISOString();

  await exec(
    db,
    `INSERT INTO devices (id, site_id, organization_id, name, token_hash, app_version, active, enrolled_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    deviceId, codeRow.site_id, codeRow.organization_id, codeRow.device_name,
    tokenHash, body.appVersion ?? 'unknown', now, now,
  );

  // Deactivate the enrollment code (one-time use)
  await exec(db, 'UPDATE enrollment_codes SET active = 0 WHERE id = ?', codeRow.id);

  // Record audit event
  const chainId = `org:${codeRow.organization_id}:site:${codeRow.site_id}`;
  await appendAuditEvent(db, chainId, 'DEVICE_ENROLLED', deviceEnrolledEvent(deviceId, codeRow.site_id, codeRow.organization_id, codeRow.device_name));

  // Ensure organization and site exist in graph
  await upsertGraphNode(db, codeRow.organization_id, 'Organization', {
    id: codeRow.organization_id,
  });
  await upsertGraphNode(db, codeRow.site_id, 'Site', {
    id: codeRow.site_id,
    organization_id: codeRow.organization_id,
  });

  // Record device in graph with ENROLLED_AT edge to site
  await ensureDeviceInGraph(db, deviceId, codeRow.site_id, codeRow.organization_id, {
    name: codeRow.device_name,
    app_version: body.appVersion ?? 'unknown',
    enrolled_at: now,
  });

  return json(request, env, {
    deviceId,
    siteId: codeRow.site_id,
    organizationId: codeRow.organization_id,
    deviceToken: rawToken,
  }, 201);
}

// ─── GET /v1/mobile/bootstrap ────────────────────────────────────────────────

export async function handleBootstrap(request: Request, env: Env): Promise<Response> {
  const db = env.DB;
  let device;
  try {
    device = await authenticateDevice(db, request.headers.get('Authorization'), env.DEVICE_TOKEN_PEPPER);
  } catch (err) {
    if (err instanceof DeviceAuthError) {
      return error(request, env, err.statusCode, err.code, 'Device authentication failed.');
    }
    throw err;
  }

  const site = await getSite(db, device.siteId);
  if (!site) {
    return error(request, env, 404, 'SITE_NOT_FOUND', 'The site configuration was not found.');
  }

  const org = await getOrganization(db, device.organizationId);
  if (!org) {
    return error(request, env, 404, 'ORGANIZATION_NOT_FOUND', 'The organization was not found.');
  }

  const vendors = await getVendorsBySite(db, device.siteId);

  return json(request, env, {
    siteId: site.id,
    siteName: site.name,
    allowedWifiSsids: JSON.parse(site.allowed_wifi_ssids_json || '[]'),
    configurationVersion: site.configuration_version,
    dailyReceiptLimit: site.daily_receipt_limit,
    storageByteLimit: site.storage_byte_limit,
    deviceLimit: org.device_limit,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
    playIntegrityCloudProjectNumber: env.PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER || '',
    // Mobile PilotConfiguration shape (see apps/mobile/src/config/deviceEnrollment.ts)
    pilotMode: pilotModeFor(env.ENVIRONMENT),
    site: { id: site.id, name: site.name },
    device: { id: device.id, name: device.name },
    vendors: vendors.map((v) => ({
      id: v.id,
      name: v.name,
      initials: v.initials,
      color: v.color,
    })),
    limits: {
      dailyReceipts: site.daily_receipt_limit,
      imageBytes: site.image_byte_limit,
    },
  });
}

// ─── POST /v1/mobile/telemetry ───────────────────────────────────────────────

export async function handleTelemetry(request: Request, env: Env): Promise<Response> {
  const db = env.DB;
  let device;
  let body: { measurements?: unknown[] };
  try {
    device = await authenticateDevice(db, request.headers.get('Authorization'), env.DEVICE_TOKEN_PEPPER);
    body = await request.json();
  } catch (err) {
    if (err instanceof DeviceAuthError) {
      return error(request, env, err.statusCode, err.code, 'Device authentication failed.');
    }
    return error(request, env, 400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
  }

  if (body.measurements && Array.isArray(body.measurements)) {
    for (const m of body.measurements) {
      if (m && typeof m === 'object') {
        await exec(
          db,
          `INSERT INTO telemetry_measurements (id, device_id, site_id, organization_id, metric_name, metric_value, tags_json, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          uuid(), device.id, device.siteId, device.organizationId,
          String((m as Record<string, unknown>).metricName ?? ''),
          Number((m as Record<string, unknown>).metricValue ?? 0),
          JSON.stringify((m as Record<string, unknown>).tags ?? {}),
          new Date().toISOString(),
        );
      }
    }
  }

  return json(request, env, { received: true }, 202);
}
