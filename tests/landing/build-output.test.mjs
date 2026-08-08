import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { escapeHtmlAttribute, replacePilotControls } from '../../scripts/landing-build-utils.mjs';

const contactUrl = 'https://www.constrovet.com/pages/contact.html?interest=challanse';

test('disabled landing output contains only functional pilot links', async () => {
  const [page, navigation] = await Promise.all([
    readFile('dist/landing/index.html', 'utf8'),
    readFile('dist/landing/assets/nav.html', 'utf8'),
  ]);

  for (const markup of [page, navigation]) {
    assert.equal(markup.includes('data-pilot-request'), false);
    assert.equal(markup.includes(`href="${contactUrl.replace('&', '&amp;')}"`), true);
  }
});

test('pilot-control replacement preserves safe attributes and escapes hostile URLs', () => {
  const markup = '<button type="button" class="cta" data-pilot-request>Request Pilot</button>';
  const hostileUrl = 'https://example.test/?next="<unsafe>&value=$1\\path';
  const transformed = replacePilotControls(markup, hostileUrl);

  assert.equal(transformed.includes('<button'), false);
  assert.equal(transformed.includes('data-pilot-request'), false);
  assert.equal(transformed.includes('class="cta"'), true);
  assert.equal(transformed.includes(`href="${escapeHtmlAttribute(hostileUrl)}"`), true);
});

test('landing tabs remain discoverable while inactive panels remain hidden', async () => {
  const page = await readFile('dist/landing/index.html', 'utf8');
  assert.doesNotMatch(page, /role="tab"[^>]*aria-hidden=/);
  assert.match(page, /role="tabpanel"[^>]*aria-hidden="true"[^>]*hidden/);
});
