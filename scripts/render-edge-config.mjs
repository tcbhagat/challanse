#!/usr/bin/env node
// ─── Render Cloudflare Worker Configuration ──────────────────────────────────
// Reads apps/edge/wrangler.toml and substitutes placeholder values from env vars.
// The source wrangler.toml uses optional markers ($$KEY) for dynamic fields:
//   database_id = ""  # $$D1_DATABASE_ID      → filled from D1_DATABASE_ID env
//   id = ""           # $$SESSIONS_KV_ID       → filled from SESSIONS_KV_ID
//   ACCESS_AUD = ""                            → filled from CLOUDFLARE_ACCESS_AUD
//
// Output: apps/edge/wrangler.generated.toml

import { readFile, writeFile } from 'node:fs/promises';
import { env } from 'node:process';

const source = new URL('../apps/edge/wrangler.toml', import.meta.url);
const target = new URL('../apps/edge/wrangler.generated.toml', import.meta.url);

// Map of env var → $marker used in wrangler.toml
const MARKER_MAP = {
  D1_DATABASE_ID: '$$D1_DATABASE_ID',
  SESSIONS_KV_ID: '$$SESSIONS_KV_ID',
  SESSIONS_KV_PREVIEW_ID: '$$SESSIONS_KV_PREVIEW_ID',
  CONFIG_KV_ID: '$$CONFIG_KV_ID',
  CONFIG_KV_PREVIEW_ID: '$$CONFIG_KV_PREVIEW_ID',
  RATE_LIMITS_KV_ID: '$$RATE_LIMITS_KV_ID',
  RATE_LIMITS_KV_PREVIEW_ID: '$$RATE_LIMITS_KV_PREVIEW_ID',
};

// Vars that get set unconditionally from their env var (empty becomes "")
const VARS_MAP = {
  ACCESS_TEAM_DOMAIN: 'CLOUDFLARE_ACCESS_TEAM_DOMAIN',
  ACCESS_AUD: 'CLOUDFLARE_ACCESS_AUD',
  ENRICHMENT_URL: 'ENRICHMENT_URL',
  EDGE_TO_ENRICHMENT_HMAC_KEY_ID: 'EDGE_TO_ENRICHMENT_HMAC_KEY_ID',
  EDGE_TO_ENRICHMENT_NEXT_HMAC_KEY_ID: 'EDGE_TO_ENRICHMENT_NEXT_HMAC_KEY_ID',
  TURNSTILE_SITE_KEY: 'TURNSTILE_SITE_KEY',
  PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: 'PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER',
  GROK_API_BASE_URL: 'GROK_API_BASE_URL',
  AGENTMEMORY_URL: 'AGENTMEMORY_URL',
  AGENTMEMORY_API_KEY: 'AGENTMEMORY_API_KEY',
};

// Validate required env vars
const REQUIRED = ['CLOUDFLARE_ACCESS_TEAM_DOMAIN', 'CLOUDFLARE_ACCESS_AUD'];
for (const key of REQUIRED) {
  if (!env[key]) {
    throw new Error(`Required env var ${key} is not set.`);
  }
}

let config = await readFile(source, 'utf8');

// Pass 1: Replace marker-based fields (D1 database_id, KV ids)
// Match: database_id = ""  # $$D1_DATABASE_ID  →  database_id = "value"  # $$D1_DATABASE_ID
for (const [envKey, marker] of Object.entries(MARKER_MAP)) {
  const value = env[envKey] ?? '';
  // Escape the marker for regex ($$ → \$)
  const escaped = marker.replace(/\$/g, '\\$');
  const pattern = new RegExp(`("[^"]*"\\s*#\\s*${escaped})`, 'g');
  config = config.replace(pattern, `${JSON.stringify(value)}  # ${marker}`);
}

// Pass 2: Replace vars section entries
// Match: ACCESS_TEAM_DOMAIN = ""  →  ACCESS_TEAM_DOMAIN = "actual-value"
for (const [tomlKey, envKey] of Object.entries(VARS_MAP)) {
  const value = env[envKey] ?? '';
  const escapedKey = tomlKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(${escapedKey}\\s*=\\s*)"[^"]*"`, 'g');
  config = config.replace(pattern, `$1${JSON.stringify(value)}`);
}

await writeFile(target, config);
console.log(`Generated ${target.pathname}`);
console.log(`  Markers replaced: ${Object.keys(MARKER_MAP).length}`);
console.log(`  Vars replaced: ${Object.keys(VARS_MAP).length}`);
