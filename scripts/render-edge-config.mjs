#!/usr/bin/env node
// ─── Render Cloudflare Edge Worker Configuration (two explicit modes) ────────
//
// Reads apps/edge/wrangler.toml (the canonical template with $$ placeholders)
// and renders a complete, syntactically valid config into an IGNORED directory
// (apps/edge/config/). Generated files are never written into a tracked path.
//
// Modes:
//   --ci          Render a deterministic, synthetic NON-production config to
//                 apps/edge/config/edge.ci.toml. Every D1/KV resource ID is
//                 non-empty, clearly synthetic (prefixed with "ci"), and
//                 derived from a fixed salt — no randomness, no timestamps,
//                 so repeated runs are byte-identical.
//   --production  Render the real production config to
//                 apps/edge/config/edge.production.toml. Requires EVERY real
//                 resource ID and required var to be present in the
//                 environment. Fails fast (before writing any file) with a
//                 clear error naming the first missing variable.
//
//   External-provider integrations (xAI/Grok, agentmemory) are intentionally
//   disabled in BOTH modes: GROK_API_BASE_URL / AGENTMEMORY_URL /
//   AGENTMEMORY_API_KEY are always rendered empty and are never read from the
//   environment.
//
// Exit codes: 0 on success, 1 on usage error or missing required values.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, env, stderr, stdout } from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = join(ROOT, 'apps/edge', 'wrangler.toml');
const OUTPUT_DIR = join(ROOT, 'apps/edge', 'config');
const CI_OUTPUT = join(OUTPUT_DIR, 'edge.ci.toml');
const PRODUCTION_OUTPUT = join(OUTPUT_DIR, 'edge.production.toml');

// Fixed salt — never derived from wall-clock time or randomness, so the CI
// output is byte-identical across runs and machines.
const CI_SALT = 'challanse-edge-ci-synthetic-2026';

const MODE_CI = '--ci';
const MODE_PRODUCTION = '--production';
const KNOWN_MODES = new Set([MODE_CI, MODE_PRODUCTION]);

// Env var -> $$ marker used in wrangler.toml for resource IDs.
const MARKER_MAP = {
  D1_DATABASE_ID: '$$D1_DATABASE_ID',
  SESSIONS_KV_ID: '$$SESSIONS_KV_ID',
  SESSIONS_KV_PREVIEW_ID: '$$SESSIONS_KV_PREVIEW_ID',
  CONFIG_KV_ID: '$$CONFIG_KV_ID',
  CONFIG_KV_PREVIEW_ID: '$$CONFIG_KV_PREVIEW_ID',
  RATE_LIMITS_KV_ID: '$$RATE_LIMITS_KV_ID',
  RATE_LIMITS_KV_PREVIEW_ID: '$$RATE_LIMITS_KV_PREVIEW_ID',
};

// Every real resource ID and required var that production rendering needs.
// The order here determines the order of missing-variable reporting.
const REQUIRED_PRODUCTION_VARS = [
  'D1_DATABASE_ID',
  'SESSIONS_KV_ID',
  'SESSIONS_KV_PREVIEW_ID',
  'CONFIG_KV_ID',
  'CONFIG_KV_PREVIEW_ID',
  'RATE_LIMITS_KV_ID',
  'RATE_LIMITS_KV_PREVIEW_ID',
  'CLOUDFLARE_ACCESS_TEAM_DOMAIN',
  'CLOUDFLARE_ACCESS_AUD',
  'ENRICHMENT_URL',
  'EDGE_TO_ENRICHMENT_HMAC_KEY_ID',
  'EDGE_TO_ENRICHMENT_NEXT_HMAC_KEY_ID',
  'TURNSTILE_SITE_KEY',
  'PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER',
];

// [vars] keys substituted from the environment in production mode, with the
// env var that supplies the value.
const VARS_FROM_ENV = {
  ACCESS_TEAM_DOMAIN: 'CLOUDFLARE_ACCESS_TEAM_DOMAIN',
  ACCESS_AUD: 'CLOUDFLARE_ACCESS_AUD',
  ENRICHMENT_URL: 'ENRICHMENT_URL',
  EDGE_TO_ENRICHMENT_HMAC_KEY_ID: 'EDGE_TO_ENRICHMENT_HMAC_KEY_ID',
  EDGE_TO_ENRICHMENT_NEXT_HMAC_KEY_ID: 'EDGE_TO_ENRICHMENT_NEXT_HMAC_KEY_ID',
  TURNSTILE_SITE_KEY: 'TURNSTILE_SITE_KEY',
  PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: 'PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER',
};

// [vars] keys that must stay disabled (empty) in BOTH modes. Never read from
// the environment.
const VARS_ALWAYS_DISABLED = ['GROK_API_BASE_URL', 'AGENTMEMORY_URL', 'AGENTMEMORY_API_KEY'];

// Harmless, clearly synthetic defaults used by --ci so every [vars] value is
// syntactically valid, quoted, and non-empty (or an explicitly harmless
// default such as "0").
const CI_VAR_DEFAULTS = {
  ACCESS_TEAM_DOMAIN: 'ci-access-team.example.com',
  ACCESS_AUD: 'ci-access-audience',
  ENRICHMENT_URL: 'https://ci-enrichment.example.com',
  EDGE_TO_ENRICHMENT_HMAC_KEY_ID: 'ci-edge-to-enrichment-hmac-key-id',
  EDGE_TO_ENRICHMENT_NEXT_HMAC_KEY_ID: 'ci-edge-to-enrichment-next-hmac-key-id',
  TURNSTILE_SITE_KEY: '0',
  PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: '0',
};

function printUsage(stream) {
  stream.write('Usage: node scripts/render-edge-config.mjs <mode>\n');
  stream.write('\n');
  stream.write('Modes:\n');
  stream.write(`  ${MODE_CI}          Render a deterministic, synthetic (non-production) config to\n`);
  stream.write(`                ${relative(ROOT, CI_OUTPUT)}. All D1/KV resource IDs are\n`);
  stream.write('                non-empty, clearly synthetic ("ci" prefix), and stable across runs.\n');
  stream.write(`  ${MODE_PRODUCTION}  Render the real production config to\n`);
  stream.write(`                ${relative(ROOT, PRODUCTION_OUTPUT)}. Requires every resource ID and\n`);
  stream.write('                required var to be present in the environment; refuses to write\n');
  stream.write('                when anything is missing.\n');
}

function failUsage() {
  printUsage(stderr);
  process.exitCode = 1;
  return;
}

// Deterministic synthetic ID: "ci" + 30 hex chars (sha256 of a fixed salt and
// the label). 32 chars total, non-empty, and clearly not a real Cloudflare ID.
function syntheticId(label) {
  const digest = createHash('sha256').update(`${CI_SALT}:${label}`).digest('hex');
  return `ci${digest.slice(0, 30)}`;
}

function isSet(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Rewrite a config-relative path (main, migrations_dir) so it stays correct
// when the rendered file lives one directory deeper (apps/edge/config/).
function adjustConfigRelativePath(config, key) {
  const pattern = new RegExp(`^(\\s*${key}\\s*=\\s*)"([^"]*)"`, 'm');
  const match = config.match(pattern);
  if (!match || !match[2]) return config;
  const absolute = join(dirname(TEMPLATE_PATH), match[2]);
  const adjusted = relative(OUTPUT_DIR, absolute).split(sep).join('/');
  return config.replace(pattern, `$1"${adjusted}"`);
}

function render(mode) {
  if (mode === 'production') {
    // Fail fast, before rendering or writing anything, if any required
    // production value is missing or empty.
    const missing = REQUIRED_PRODUCTION_VARS.filter((name) => !isSet(env[name]));
    if (missing.length > 0) {
      stderr.write('Error: --production requires the following environment variables (missing or empty):\n');
      for (const name of missing) {
        stderr.write(`  - ${name}\n`);
      }
      stderr.write('Refusing to write a production config until every required value is present.\n');
      process.exitCode = 1;
      return;
    }
  }

  let config = '';

  return readFile(TEMPLATE_PATH, 'utf8')
    .then((template) => {
      config = template;
      return undefined;
    })
    .then(() => {
      if (mode === 'ci') {
        // Pass 1: fill every $$ marker with a deterministic synthetic ID.
        for (const [envKey, marker] of Object.entries(MARKER_MAP)) {
          const escaped = marker.replace(/\$/g, '\\$');
          // Callback form so the $$ marker in the trailing comment is preserved
          // verbatim (the replacement string is used literally, no $$ escaping).
          const pattern = new RegExp(`("[^"]*")(\\s*#\\s*${escaped})`, 'g');
          config = config.replace(pattern, (_full, _quoted, suffix) => `${JSON.stringify(syntheticId(envKey))}${suffix}`);
        }
        // Pass 2: [vars] values from synthetic defaults (all quoted/non-empty).
        for (const [tomlKey, value] of Object.entries(CI_VAR_DEFAULTS)) {
          const escapedKey = escapeRegExp(tomlKey);
          const pattern = new RegExp(`(${escapedKey}\\s*=\\s*)"[^"]*"`, 'g');
          config = config.replace(pattern, `$1${JSON.stringify(value)}`);
        }
      } else {
        // Pass 1: fill every $$ marker from the (validated) environment.
        for (const [envKey, marker] of Object.entries(MARKER_MAP)) {
          const escaped = marker.replace(/\$/g, '\\$');
          const pattern = new RegExp(`("[^"]*")(\\s*#\\s*${escaped})`, 'g');
          config = config.replace(pattern, (_full, _quoted, suffix) => `${JSON.stringify(env[envKey])}${suffix}`);
        }
        // Pass 2: [vars] values from the (validated) environment.
        for (const [tomlKey, envKey] of Object.entries(VARS_FROM_ENV)) {
          const escapedKey = escapeRegExp(tomlKey);
          const pattern = new RegExp(`(${escapedKey}\\s*=\\s*)"[^"]*"`, 'g');
          config = config.replace(pattern, `$1${JSON.stringify(env[envKey])}`);
        }
      }

      // Pass 3 (both modes): external-provider integrations stay disabled.
      for (const tomlKey of VARS_ALWAYS_DISABLED) {
        const escapedKey = escapeRegExp(tomlKey);
        const pattern = new RegExp(`(${escapedKey}\\s*=\\s*)"[^"]*"`, 'g');
        config = config.replace(pattern, `$1""`);
      }

      // Keep config-relative paths correct from the one-level-deeper output dir.
      config = adjustConfigRelativePath(config, 'main');
      config = adjustConfigRelativePath(config, 'migrations_dir');

      return undefined;
    })
    .then(() => mkdir(OUTPUT_DIR, { recursive: true }))
    .then(() => {
      const output = mode === 'ci' ? CI_OUTPUT : PRODUCTION_OUTPUT;
      return writeFile(output, config).then(() => output);
    })
    .then((output) => {
      stdout.write(`Generated ${relative(ROOT, output)}\n`);
    })
    .catch((error) => {
      stderr.write(`Error: failed to render ${mode} config: ${error.message}\n`);
      process.exitCode = 1;
    });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
  const modeArgs = argv.slice(2);
  const unknown = modeArgs.filter((arg) => !KNOWN_MODES.has(arg));
  if (unknown.length > 0 || modeArgs.length !== 1) {
    failUsage();
    return;
  }
  const mode = modeArgs[0] === MODE_CI ? 'ci' : 'production';
  render(mode);
}

main();
