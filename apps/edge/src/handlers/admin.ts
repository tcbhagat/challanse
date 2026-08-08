// ─── Admin Endpoints ─────────────────────────────────────────────────────────
// Handlers for admin operations: summary, enrollment codes, site/vendor management,
// membership management, configuration, and audit verification.
// All endpoints require Cloudflare Access authentication with appropriate roles.

import { error, json } from '../responses';
import { authenticateReviewer, requireRole, ReviewerAuthError } from '../auth';
import { uuid, exec, first, all, getSitesByOrg, getOrganization } from '../db';
import { randomEnrollmentCode, sha256Hex } from '../security';
import { appendAuditEvent, verifyChain, verifyAllChains } from '../audit-chain';
import { reviewerInvitedEvent, configChangedEvent, quotaChangedEvent, siteChangedEvent, vendorChangedEvent, membershipChangedEvent } from '../audit-chain';
import { upsertGraphNode, ensureSiteInGraph, ensureVendorInGraph, ensureReviewerInGraph, deleteGraphNode } from '../graph';
import type { AccessIdentity, Env } from '../types';

// ─── GET /v1/admin/summary ──────────────────────────────────────────────────

export async function handleAdminSummary(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const org = await getOrganization(db, reviewer.organizationId);

  // Device counts
  const deviceStats = await first<{ total: number; active: number; inactive: number }>(
    db,
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active,
       SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END) as inactive
     FROM devices WHERE organization_id = ?`,
    reviewer.organizationId,
  );

  // Receipt counts by status
  const receiptStats = await all<{ status: string; count: number }>(
    db,
    `SELECT r.status, COUNT(*) as count
     FROM receipts r
     JOIN sites s ON s.id = r.site_id AND s.organization_id = ?
     GROUP BY r.status`,
    reviewer.organizationId,
  );

  // Reviewer counts
  const reviewerStats = await first<{ total: number }>(
    db,
    'SELECT COUNT(*) as total FROM reviewers WHERE organization_id = ? AND active = 1',
    reviewer.organizationId,
  );

  // Site counts
  const sites = await getSitesByOrg(db, reviewer.organizationId);

  // Today's receipt count
  const today = new Date().toISOString().slice(0, 10);
  const todayStats = await first<{ count: number }>(
    db,
    `SELECT COUNT(*) as count
     FROM receipts r
     JOIN sites s ON s.id = r.site_id AND s.organization_id = ?
     WHERE date(r.created_at) = ?`,
    reviewer.organizationId, today,
  );

  // Storage used
  const storageStats = await first<{ total_bytes: number }>(
    db,
    `SELECT COALESCE(SUM(r.image_bytes), 0) as total_bytes
     FROM receipts r
     JOIN sites s ON s.id = r.site_id AND s.organization_id = ?`,
    reviewer.organizationId,
  );

  return json(request, env, {
    organizationId: reviewer.organizationId,
    organizationName: org?.name ?? '',
    deviceLimit: org?.device_limit ?? 0,
    dailyReceiptLimit: org?.daily_receipt_limit ?? 0,
    storageByteLimit: org?.storage_byte_limit ?? 0,
    devices: deviceStats || { total: 0, active: 0, inactive: 0 },
    receipts: receiptStats || [],
    reviewers: reviewerStats?.total ?? 0,
    sites: sites.length,
    todayReceipts: todayStats?.count ?? 0,
    storageUsedBytes: storageStats?.total_bytes ?? 0,
  });
}

// ─── POST /v1/admin/enrollment-codes ─────────────────────────────────────────

export async function handleCreateEnrollmentCode(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* use defaults */ }

  const siteId = String(body.siteId || reviewer.siteId);
  const code = randomEnrollmentCode();
  // code_hash is the enrollment_codes primary key; store the plaintext in `code`
  // because handleEnroll looks the code up by plaintext (ec.code = ?).
  const codeHash = await sha256Hex(code);
  const now = new Date().toISOString();

  await exec(
    db,
    `INSERT INTO enrollment_codes (id, code, code_hash, site_id, organization_id, device_name, expires_at, created_by, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    uuid(), code, codeHash, siteId, reviewer.organizationId,
    String(body.deviceName || 'Unnamed Device'),
    String(body.expiresAt || new Date(Date.now() + 7 * 86_400_000).toISOString()),
    reviewer.email, now,
  );

  return json(request, env, { code, siteId, expiresAt: body.expiresAt || null }, 201);
}

// ─── GET /v1/admin/configuration ─────────────────────────────────────────────

export async function handleAdminConfiguration(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const org = await getOrganization(db, reviewer.organizationId);
  const sites = await getSitesByOrg(db, reviewer.organizationId);
  const vendors = await all<Record<string, unknown>>(
    db,
    `SELECT v.id, v.site_id, v.name, v.initials, v.color, v.display_order, v.active
     FROM vendors v
     WHERE v.organization_id = ?
     ORDER BY v.display_order, v.name`,
    reviewer.organizationId,
  );

  const reviewers = await all<Record<string, unknown>>(
    db,
    `SELECT r.email, r.site_id, r.role, r.active
     FROM reviewers r
     WHERE r.organization_id = ?
     ORDER BY r.email`,
    reviewer.organizationId,
  );

  return json(request, env, {
    organization: org,
    sites,
    vendors,
    reviewers,
  });
}

// ─── PUT /v1/admin/sites ─────────────────────────────────────────────────────

export async function handleUpsertSite(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  let body: {
    id?: string;
    name?: string;
    allowedWifiSsids?: string[];
    configurationVersion?: number;
    dailyReceiptLimit?: number;
    imageByteLimit?: number;
    storageByteLimit?: number;
  } = {};
  try { body = await request.json(); } catch { /* fail */ }

  if (!body.name) {
    return error(request, env, 400, 'MISSING_NAME', 'Site name is required.');
  }

  const now = new Date().toISOString();
  const siteId = body.id || uuid();

  if (body.id) {
    // Update existing site
    await exec(
      db,
      `UPDATE sites SET
        name = ?, allowed_wifi_ssids_json = ?, configuration_version = ?,
        daily_receipt_limit = ?, image_byte_limit = ?, storage_byte_limit = ?,
        updated_at = ?
       WHERE id = ? AND organization_id = ?`,
      body.name, JSON.stringify(body.allowedWifiSsids || []),
      body.configurationVersion ?? 1,
      body.dailyReceiptLimit ?? 100, body.imageByteLimit ?? 10_000_000,
      body.storageByteLimit ?? 1_000_000_000,
      now, siteId, reviewer.organizationId,
    );
  } else {
    // Create new site
    await exec(
      db,
      `INSERT INTO sites (id, organization_id, name, allowed_wifi_ssids_json, configuration_version,
        daily_receipt_limit, image_byte_limit, storage_byte_limit, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      siteId, reviewer.organizationId, body.name, JSON.stringify(body.allowedWifiSsids || []),
      body.configurationVersion ?? 1,
      body.dailyReceiptLimit ?? 100, body.imageByteLimit ?? 10_000_000,
      body.storageByteLimit ?? 1_000_000_000,
      now, now,
    );
  }

  // Record in graph: Site node with BELONGS_TO edge
  await ensureSiteInGraph(db, siteId, reviewer.organizationId, {
    name: body.name,
    allowed_wifi_ssids: body.allowedWifiSsids ?? [],
    configuration_version: body.configurationVersion ?? 1,
  });

  // Audit: SITE_CHANGED + CONFIG_CHANGED
  const siteChainId = `org:${reviewer.organizationId}:site:${siteId}`;
  const siteAction = body.id ? 'updated' : 'created';
  const siteChanges: Record<string, unknown> = { name: body.name };
  if (body.dailyReceiptLimit !== undefined) siteChanges.dailyReceiptLimit = body.dailyReceiptLimit;
  if (body.imageByteLimit !== undefined) siteChanges.imageByteLimit = body.imageByteLimit;
  if (body.storageByteLimit !== undefined) siteChanges.storageByteLimit = body.storageByteLimit;
  await appendAuditEvent(db, siteChainId, 'SITE_CHANGED', siteChangedEvent(siteId, reviewer.organizationId, reviewer.email, siteAction, siteChanges));
  if (Object.keys(siteChanges).length > 1 || body.configurationVersion !== undefined) {
    await appendAuditEvent(db, siteChainId, 'CONFIG_CHANGED', configChangedEvent(reviewer.email, reviewer.organizationId, { ...siteChanges, configuration_version: body.configurationVersion }));
  }

  return json(request, env, { id: siteId, name: body.name });
}

// ─── PUT /v1/admin/vendors ───────────────────────────────────────────────────

export async function handleUpsertVendor(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  let body: {
    id?: string;
    siteId?: string;
    name?: string;
    initials?: string;
    color?: string;
    displayOrder?: number;
  } = {};
  try { body = await request.json(); } catch { /* fail */ }

  if (!body.name) {
    return error(request, env, 400, 'MISSING_NAME', 'Vendor name is required.');
  }

  const now = new Date().toISOString();
  const vendorId = body.id || uuid();
  const siteId = body.siteId || reviewer.siteId;

  if (body.id) {
    await exec(
      db,
      `UPDATE vendors SET name = ?, initials = ?, color = ?, display_order = ?, updated_at = ?
       WHERE id = ? AND site_id = ?`,
      body.name, body.initials || '', body.color || '#666666',
      body.displayOrder ?? 0, now, vendorId, siteId,
    );
  } else {
    await exec(
      db,
      `INSERT INTO vendors (id, site_id, organization_id, name, initials, color, display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      vendorId, siteId, reviewer.organizationId, body.name,
      body.initials || body.name.slice(0, 2).toUpperCase(),
      body.color || '#666666', body.displayOrder ?? 0, now, now,
    );
  }

  // Record in graph: Vendor node
  await ensureVendorInGraph(db, vendorId, siteId, {
    name: body.name,
    initials: body.initials || body.name.slice(0, 2).toUpperCase(),
    color: body.color || '#666666',
    display_order: body.displayOrder ?? 0,
  });

  // Audit: VENDOR_CHANGED
  const vendorChainId = `org:${reviewer.organizationId}:site:${siteId}`;
  await appendAuditEvent(db, vendorChainId, 'VENDOR_CHANGED', vendorChangedEvent(vendorId, siteId, reviewer.organizationId, reviewer.email, body.id ? 'updated' : 'created'));

  return json(request, env, { id: vendorId, name: body.name });
}

// ─── PUT /v1/admin/memberships ───────────────────────────────────────────────

export async function handleUpsertMembership(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  let body: { email?: string; siteId?: string; role?: string } = {};
  try { body = await request.json(); } catch { /* fail */ }

  if (!body.email || !body.siteId || !body.role) {
    return error(request, env, 400, 'MISSING_FIELDS', 'email, siteId, and role are required.');
  }

  const validRoles = ['ORG_ADMIN', 'SITE_ADMIN', 'CONTROLLER', 'AUDITOR', 'VIEWER'];
  if (!validRoles.includes(body.role)) {
    return error(request, env, 400, 'INVALID_ROLE', `Role must be one of: ${validRoles.join(', ')}`);
  }

  const now = new Date().toISOString();
  await exec(
    db,
    `INSERT INTO reviewers (email, site_id, organization_id, role, active, issuer, subject, created_at)
     VALUES (?, ?, ?, ?, 1, '', '', ?)
     ON CONFLICT(email) DO UPDATE SET
       site_id = excluded.site_id, role = excluded.role, updated_at = excluded.created_at`,
    body.email, body.siteId, reviewer.organizationId, body.role, now,
  );

  // Record in graph: Reviewer node with WORKS_AT and ASSIGNED_TO edges
  await ensureReviewerInGraph(db, body.email, reviewer.organizationId, body.siteId, {
    email: body.email,
    role: body.role,
  });

  // Audit: MEMBERSHIP_CHANGED
  const membershipChainId = `org:${reviewer.organizationId}`;
  await appendAuditEvent(db, membershipChainId, 'MEMBERSHIP_CHANGED', membershipChangedEvent(body.email, body.siteId, reviewer.organizationId, reviewer.email, 'upserted', body.role));

  return json(request, env, { email: body.email, siteId: body.siteId, role: body.role });
}

// ─── POST /v1/admin/membership-invitations ───────────────────────────────────

export async function handleCreateInvitation(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  let body: { email?: string; siteId?: string; role?: string; expiresAt?: string } = {};
  try { body = await request.json(); } catch { /* fail */ }

  if (!body.email || !body.role) {
    return error(request, env, 400, 'MISSING_FIELDS', 'email and role are required.');
  }

  const invitationId = uuid();
  const now = new Date().toISOString();
  const expiresAt = body.expiresAt || new Date(Date.now() + 30 * 86_400_000).toISOString();

  await exec(
    db,
    `INSERT INTO membership_invitations (id, organization_id, site_id, email, role, invited_by, expires_at, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    invitationId, reviewer.organizationId, body.siteId || reviewer.siteId,
    body.email, body.role, reviewer.email, expiresAt, now,
  );

  // Audit: REVIEWER_INVITED
  const invitationChainId = `org:${reviewer.organizationId}`;
  await appendAuditEvent(db, invitationChainId, 'REVIEWER_INVITED', reviewerInvitedEvent(invitationId, reviewer.email, body.email, body.siteId || reviewer.siteId, reviewer.organizationId, body.role));

  return json(request, env, { invitationId, email: body.email }, 201);
}

// ─── PUT /v1/admin/quotas ────────────────────────────────────────────────────

export async function handleUpdateQuota(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  let body: { deviceLimit?: number; dailyReceiptLimit?: number; storageByteLimit?: number } = {};
  try { body = await request.json(); } catch { /* fail */ }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.deviceLimit !== undefined) {
    updates.push('device_limit = ?');
    params.push(body.deviceLimit);
  }
  if (body.dailyReceiptLimit !== undefined) {
    updates.push('daily_receipt_limit = ?');
    params.push(body.dailyReceiptLimit);
  }
  if (body.storageByteLimit !== undefined) {
    updates.push('storage_byte_limit = ?');
    params.push(body.storageByteLimit);
  }

  if (updates.length === 0) {
    return error(request, env, 400, 'NO_CHANGES', 'No quota fields to update.');
  }

  params.push(new Date().toISOString(), reviewer.organizationId);
  await exec(
    db,
    `UPDATE organizations SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`,
    ...params,
  );

  // Audit: QUOTA_CHANGED for each updated field
  const quotaChainId = `org:${reviewer.organizationId}`;
  if (body.deviceLimit !== undefined) {
    await appendAuditEvent(db, quotaChainId, 'QUOTA_CHANGED', quotaChangedEvent(reviewer.email, reviewer.organizationId, 'device_limit', 0, body.deviceLimit));
  }
  if (body.dailyReceiptLimit !== undefined) {
    await appendAuditEvent(db, quotaChainId, 'QUOTA_CHANGED', quotaChangedEvent(reviewer.email, reviewer.organizationId, 'daily_receipt_limit', 0, body.dailyReceiptLimit));
  }
  if (body.storageByteLimit !== undefined) {
    await appendAuditEvent(db, quotaChainId, 'QUOTA_CHANGED', quotaChangedEvent(reviewer.email, reviewer.organizationId, 'storage_byte_limit', 0, body.storageByteLimit));
  }

  return json(request, env, { updated: true });
}

// ─── POST /v1/admin/devices/revoke-all ───────────────────────────────────────

export async function handleRevokeAllDevices(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  let body: { siteId?: string } = {};
  try { body = await request.json(); } catch { /* use default */ }

  if (body.siteId) {
    await exec(db, 'UPDATE devices SET active = 0 WHERE site_id = ? AND organization_id = ?',
      body.siteId, reviewer.organizationId);
  } else {
    await exec(db, 'UPDATE devices SET active = 0 WHERE organization_id = ?',
      reviewer.organizationId);
  }

  return json(request, env, { revoked: true });
}

// ─── DELETE /v1/admin/devices/{deviceId} ─────────────────────────────────────

export async function handleRevokeDevice(request: Request, env: Env, identity: AccessIdentity, deviceId: string): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const device = await first<{ id: string; site_id: string }>(
    db,
    'SELECT id, site_id FROM devices WHERE id = ? AND organization_id = ?',
    deviceId, reviewer.organizationId,
  );

  if (!device) {
    return error(request, env, 404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }

  await exec(db, 'UPDATE devices SET active = 0 WHERE id = ?', deviceId);

  const chainId = `org:${reviewer.organizationId}:site:${device.site_id}`;
  await appendAuditEvent(db, chainId, 'DEVICE_REVOKED', {
    event_type: 'DEVICE_REVOKED',
    device_id: deviceId,
    site_id: device.site_id,
    organization_id: reviewer.organizationId,
    revoked_by: reviewer.email,
    timestamp: new Date().toISOString(),
  });

  return new Response(null, { status: 204 });
}

// ─── POST /v1/admin/site-managers ────────────────────────────────────────────

export async function handleSiteManager(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  let body: { siteId?: string; managerEmail?: string; active?: boolean } = {};
  try { body = await request.json(); } catch { /* fail */ }

  if (!body.siteId || !body.managerEmail || body.active === undefined) {
    return error(request, env, 400, 'MISSING_FIELDS', 'siteId, managerEmail, and active are required.');
  }

  await exec(
    db,
    'UPDATE reviewers SET site_id = ?, active = ? WHERE email = ? AND organization_id = ?',
    body.active ? body.siteId : null,
    body.active ? 1 : 0,
    body.managerEmail, reviewer.organizationId,
  );

  return new Response(null, { status: 204 });
}

// ─── Audit Verification Endpoints ────────────────────────────────────────────

export async function handleVerifyChain(request: Request, env: Env, identity: AccessIdentity, chainId: string): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const result = await verifyChain(db, chainId);
  return json(request, env, result);
}

export async function handleVerifyAllChains(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const result = await verifyAllChains(db);
  return json(request, env, result);
}

export async function handleChainEvents(request: Request, env: Env, identity: AccessIdentity, chainId: string): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const url = new URL(request.url);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

  const events = await all<Record<string, unknown>>(
    db,
    `SELECT event_id, event_type, event_json, previous_hash, event_hash, created_at
     FROM audit_events
     WHERE chain_id = ?
     ORDER BY created_at ASC, event_id ASC
     LIMIT ? OFFSET ?`,
    chainId, limit, offset,
  );

  return json(request, env, { chainId, offset, limit, events });
}
