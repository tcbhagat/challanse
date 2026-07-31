import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TESTS_DIR, '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'build-landing.mjs');
const OUTPUT_HTML = join(REPO_ROOT, 'dist', 'landing', 'index.html');
const OUTPUT_RUNTIME = join(REPO_ROOT, 'dist', 'landing', 'assets', 'js', 'runtime-config.js');

function buildLanding(env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

describe('build-landing.mjs', () => {
  it('builds a noninteractive contact-link landing by default', () => {
    const result = buildLanding();
    expect(result.status).toBe(0);

    const html = readFileSync(OUTPUT_HTML, 'utf8');
    const runtime = readFileSync(OUTPUT_RUNTIME, 'utf8');
    expect(html).toContain('https://www.constrovet.com/pages/contact.html?interest=challanse');
    expect(html).not.toContain('id="cs-pilot-form"');
    expect(html).not.toContain('challenges.cloudflare.com/turnstile');
    expect(runtime).toContain("pilotRequestsEnabled: 'false' === 'true'");
  });

  it('requires backend and Turnstile configuration for an interactive build', () => {
    const result = buildLanding({ CHALLANSE_PILOT_REQUESTS_ENABLED: 'true' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'Interactive pilot requests require an API base URL and Turnstile site key.'
    );
  });

  it('retains the request form only when interactive dependencies are explicit', () => {
    const result = buildLanding({
      CHALLANSE_PILOT_REQUESTS_ENABLED: 'true',
      CHALLANSE_API_BASE_URL: 'https://api.example.invalid',
      TURNSTILE_SITE_KEY: 'test-site-key',
    });
    expect(result.status).toBe(0);

    const html = readFileSync(OUTPUT_HTML, 'utf8');
    const runtime = readFileSync(OUTPUT_RUNTIME, 'utf8');
    expect(html).toContain('id="cs-pilot-form"');
    expect(html).toContain('challenges.cloudflare.com/turnstile');
    expect(runtime).toContain("pilotRequestsEnabled: 'true' === 'true'");
  });
});
