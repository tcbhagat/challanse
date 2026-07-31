// ─── Render-Edge-Config Regression Tests ────────────────────────────────────
//
// Verifies the two-mode apps/edge config renderer (scripts/render-edge-config.mjs):
//   a. --ci produces non-empty, deterministic, synthetic, git-ignored config.
//   b. --production fails fast on missing env values and writes nothing.
//   c. Queue bindings use the current [[queues.producers]] producer syntax.
//   d. No generated config file is ever tracked by git.
//
// These tests run through the @challanse/edge workspace (vitest) via the root
// `npm test` (which runs `npm run test --workspaces --if-present`).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url)); // apps/edge/tests
const REPO_ROOT = join(TESTS_DIR, '..', '..', '..'); // repository root
const SCRIPT = join(REPO_ROOT, 'scripts', 'render-edge-config.mjs');
const EDGE_CONFIG_DIR = join(REPO_ROOT, 'apps', 'edge', 'config');
const CI_OUTPUT = join(EDGE_CONFIG_DIR, 'edge.ci.toml');
const PRODUCTION_OUTPUT = join(EDGE_CONFIG_DIR, 'edge.production.toml');
const WRANGLER_TOML = join(REPO_ROOT, 'apps', 'edge', 'wrangler.toml');

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

/** Run the render script and return spawnSync-style result. */
function runRender(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

/** Strip every required production variable from an env object. */
function strippedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  for (const name of REQUIRED_PRODUCTION_VARS) delete env[name];
  return env;
}

/** Collect every D1/KV id value (database_id, id, preview_id) as a string. */
function collectResourceIds(toml: string): string[] {
  const ids: string[] = [];
  const pattern = /(?:database_id|preview_id|id)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(toml)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

function gitCheckIgnore(path: string) {
  return spawnSync('git', ['check-ignore', path], { cwd: REPO_ROOT, encoding: 'utf8' });
}

function gitLsFiles(): string {
  const result = spawnSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  expect(result.status).toBe(0);
  return result.stdout;
}

describe('render-edge-config.mjs', () => {
  describe('--ci mode', () => {
    it('generates a config with no empty D1/KV resource IDs', () => {
      const first = runRender(['--ci']);
      expect(first.status).toBe(0);
      const toml = readFileSync(CI_OUTPUT, 'utf8');
      const ids = collectResourceIds(toml);
      // Every D1 database_id, KV id, and KV preview_id must be present and non-empty.
      expect(ids.length).toBeGreaterThanOrEqual(7); // 1 D1 + 3 KV ids + 3 KV preview ids
      for (const id of ids) {
        expect(id.trim().length).toBeGreaterThan(0);
      }
      // The scheme is clearly synthetic (never a real production ID).
      for (const id of ids) {
        expect(id.startsWith('ci')).toBe(true);
      }
    });

    it('is deterministic: two runs produce byte-identical output', () => {
      const run1 = runRender(['--ci']);
      expect(run1.status).toBe(0);
      const content1 = readFileSync(CI_OUTPUT, 'utf8');

      const run2 = runRender(['--ci']);
      expect(run2.status).toBe(0);
      const content2 = readFileSync(CI_OUTPUT, 'utf8');

      expect(content2).toBe(content1);
    });

    it('keeps external-provider integrations disabled', () => {
      runRender(['--ci']);
      const toml = readFileSync(CI_OUTPUT, 'utf8');
      expect(toml).toMatch(/GROK_API_BASE_URL\s*=\s*""/);
      expect(toml).toMatch(/AGENTMEMORY_URL\s*=\s*""/);
      expect(toml).toMatch(/AGENTMEMORY_API_KEY\s*=\s*""/);
    });

    it('writes the generated CI config to a git-ignored path', () => {
      runRender(['--ci']);
      expect(existsSync(CI_OUTPUT)).toBe(true);
      const check = gitCheckIgnore(CI_OUTPUT);
      expect(check.status).toBe(0);
      expect(check.stdout).toContain(CI_OUTPUT);
    });
  });

  describe('--production mode', () => {
    it('rejects missing required variables, names one, and writes nothing', () => {
      rmSync(PRODUCTION_OUTPUT, { force: true });
      const result = runRender(['--production'], strippedEnv());
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('D1_DATABASE_ID');
      expect(result.stderr).toContain('CLOUDFLARE_ACCESS_TEAM_DOMAIN');
      expect(result.stderr).toContain('Refusing to write');
      expect(existsSync(PRODUCTION_OUTPUT)).toBe(false);
    });

    it('renders successfully when every required variable is present', () => {
      const env = {
        D1_DATABASE_ID: 'ci111111111111111111111111111111',
        SESSIONS_KV_ID: 'ci222222222222222222222222222222',
        SESSIONS_KV_PREVIEW_ID: 'ci333333333333333333333333333333',
        CONFIG_KV_ID: 'ci444444444444444444444444444444',
        CONFIG_KV_PREVIEW_ID: 'ci555555555555555555555555555555',
        RATE_LIMITS_KV_ID: 'ci666666666666666666666666666666',
        RATE_LIMITS_KV_PREVIEW_ID: 'ci777777777777777777777777777777',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'ci-team.example.com',
        CLOUDFLARE_ACCESS_AUD: 'ci-audience',
        ENRICHMENT_URL: 'https://ci-enrichment.example.com',
        EDGE_TO_ENRICHMENT_HMAC_KEY_ID: 'ci-hmac-id',
        EDGE_TO_ENRICHMENT_NEXT_HMAC_KEY_ID: 'ci-hmac-next-id',
        TURNSTILE_SITE_KEY: 'ci-turnstile',
        PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: '0',
      };
      const result = runRender(['--production'], env);
      expect(result.status).toBe(0);
      expect(existsSync(PRODUCTION_OUTPUT)).toBe(true);
      const toml = readFileSync(PRODUCTION_OUTPUT, 'utf8');
      expect(toml).toContain('database_id = "ci111111111111111111111111111111"');
      expect(toml).toContain('ACCESS_TEAM_DOMAIN = "ci-team.example.com"');
      // External providers remain disabled even when env vars are present.
      expect(toml).toMatch(/GROK_API_BASE_URL\s*=\s*""/);
      expect(toml).toMatch(/AGENTMEMORY_URL\s*=\s*""/);
    });
  });

  describe('queue bindings', () => {
    it('uses current [[queues.producers]] producer syntax in wrangler.toml', () => {
      const toml = readFileSync(WRANGLER_TOML, 'utf8');
      expect(toml).toContain('[[queues.producers]]');
      expect(toml).toContain('queue = "receipt-enrichment"');
      expect(toml).toContain('queue = "audit-events"');
      expect(toml).not.toMatch(/^\s*queue_name\s*=/m);
    });

    it('uses current [[queues.producers]] producer syntax in the CI config', () => {
      runRender(['--ci']);
      const toml = readFileSync(CI_OUTPUT, 'utf8');
      expect(toml).toContain('[[queues.producers]]');
      expect(toml).toContain('queue = "receipt-enrichment"');
      expect(toml).toContain('queue = "audit-events"');
      expect(toml).not.toMatch(/^\s*queue_name\s*=/m);
    });
  });

  describe('tracking hygiene', () => {
    it('never tracks generated config files', () => {
      runRender(['--ci']);
      const tracked = gitLsFiles();
      for (const path of [CI_OUTPUT, PRODUCTION_OUTPUT]) {
        const relative = path.replace(`${REPO_ROOT}/`, '');
        expect(tracked).not.toContain(relative);
        const check = gitCheckIgnore(path);
        expect(check.status).toBe(0);
      }
    });
  });

  describe('usage', () => {
    it('prints usage and exits non-zero without a mode', () => {
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: REPO_ROOT,
        env: { ...process.env, ...strippedEnv() },
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Usage: node scripts/render-edge-config.mjs <mode>');
    });

    it('prints usage and exits non-zero for an unknown mode', () => {
      const result = runRender(['--bogus']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Usage:');
    });
  });
});
