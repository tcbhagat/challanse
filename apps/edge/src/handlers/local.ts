// ─── Local Pilot Bridge Endpoints ─────────────────────────────────────────────
// Internal-only endpoints for the supervised local pilot (ENVIRONMENT=local-pilot).
// These routes exist so local-pilot.sh can drive the edge/D1 path over the LAN
// without Cloudflare Access or reviewer authentication. In any other environment
// they return 404 so they are never reachable in production.

import { error, json } from '../responses';
import { uuid, exec, first } from '../db';
import { sha256Hex } from '../security';
import type { Env } from '../types';

// ─── GET /v1/local/status ────────────────────────────────────────────────────
// Reports the enrichment queue depth (receipts awaiting enrichment drain) so the
// synthetic acceptance test can poll until the queue reaches zero.

export async function handleLocalStatus(request: Request, env: Env): Promise<Response> {
  if (env.ENVIRONMENT !== 'local-pilot') {
    return error(request, env, 404, 'NOT_FOUND', 'The requested route does not exist.');
  }
  const db = env.DB;
  const row = await first<{ cnt: number }>(
    db,
    "SELECT COUNT(*) as cnt FROM receipts WHERE status = 'RECEIVED'",
  );
  return json(request, env, { queueDepth: row?.cnt ?? 0 });
}

// ─── POST /v1/local/enrollment-codes ─────────────────────────────────────────
// Creates an enrollment code in the edge D1 database for the tenant being driven
// by local-pilot.sh. Gated by the local reviewer gateway secret so only the
// orchestrator on the LAN can create codes. Mirrors the admin
// handleCreateEnrollmentCode INSERT but targets an explicit site/organization.

export async function handleLocalEnrollmentCodes(request: Request, env: Env): Promise<Response> {
  if (env.ENVIRONMENT !== 'local-pilot') {
    return error(request, env, 404, 'NOT_FOUND', 'The requested route does not exist.');
  }
  const db = env.DB;
  const supplied = request.headers.get('X-ChallanSe-Local-Reviewer-Secret') ?? '';
  if (!env.LOCAL_REVIEWER_GATEWAY_SECRET || supplied !== env.LOCAL_REVIEWER_GATEWAY_SECRET) {
    return error(request, env, 403, 'LOCAL_BRIDGE_FORBIDDEN', 'Bridge authentication is required.');
  }

  let body: { code?: string; siteId?: string; organizationId?: string; deviceName?: string };
  try {
    body = await request.json();
  } catch {
    return error(request, env, 400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
  }

  const code = String(body.code ?? '').toUpperCase();
  const siteId = String(body.siteId ?? '');
  const organizationId = String(body.organizationId ?? '');
  const deviceName = String(body.deviceName || 'Unnamed Device');
  if (!code || !siteId || !organizationId) {
    return error(request, env, 400, 'MISSING_FIELDS', 'code, siteId, and organizationId are required.');
  }

  // code_hash is the enrollment_codes primary key; store the plaintext in `code`
  // because handleEnroll looks the code up by plaintext (ec.code = ?).
  const codeHash = await sha256Hex(code);
  const now = new Date().toISOString();

  await exec(
    db,
    `INSERT INTO enrollment_codes (id, code, code_hash, site_id, organization_id, device_name, expires_at, created_by, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+10 minutes'), 'local-pilot-bridge', 1, ?)`,
    uuid(), code, codeHash, siteId, organizationId, deviceName, now,
  );

  return json(request, env, { code, siteId, organizationId, expiresAt: null }, 201);
}
