import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { addPilotRequestTrigger, configureGuestControls, escapeHtmlAttribute, replacePilotControls } from '../../scripts/landing-build-utils.mjs';

const guestUrl = 'https://guest.challanse.constrovet.com/';
const reviewerUrl = 'https://review.challanse.constrovet.com/';
const contactUrl = 'https://www.constrovet.com/pages/contact.html?interest=challanse';
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('disabled landing output contains only released service links', async () => {
  const [page, navigation] = await Promise.all([
    readFile('dist/landing/index.html', 'utf8'),
    readFile('dist/landing/assets/nav.html', 'utf8'),
  ]);

  for (const markup of [page, navigation]) {
    assert.equal(markup.includes('data-pilot-request'), false);
    assert.equal(markup.includes(`href="${guestUrl}"`), false);
  }
  assert.equal(page.includes(`href="${contactUrl.replaceAll('&', '&amp;')}"`), true);
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

test('enabled pilot builds retain a visible dialog trigger', () => {
  const source = '<div><a class="cs-button cs-button--secondary" data-guest-processing href="ignored">Client Sign In</a></div>';
  const transformed = addPilotRequestTrigger(source);
  assert.match(transformed, /<button[^>]*data-pilot-request>Request Pilot<\/button>/);
  assert.match(transformed, /data-guest-processing/);
});

test('landing tabs remain discoverable while inactive panels remain hidden', async () => {
  const page = await readFile('dist/landing/index.html', 'utf8');
  assert.doesNotMatch(page, /role="tab"[^>]*aria-hidden=/);
  assert.match(page, /role="tabpanel"[^>]*aria-hidden="true"[^>]*hidden/);
});

test('guest controls remain gated until the private service is approved', () => {
  const source = '<a class="cta" data-guest-processing href="ignored">Client Sign In</a>';
  assert.equal(configureGuestControls(source, false, guestUrl, reviewerUrl), `<a class="cta" href="${reviewerUrl}">Client Sign In</a>`);
  assert.equal(configureGuestControls(source, true, guestUrl, reviewerUrl), `<a class="cta" href="${guestUrl}">Process My Invoice</a>`);
});

test('landing exposes a browser-only sample journey and registered-client route', async () => {
  const page = await readFile('dist/landing/index.html', 'utf8');
  assert.match(page, /data-sample-demo>Try Sample Invoice/);
  assert.match(page, /Fictional data only/);
  assert.match(page, /Sample demonstration/);
  assert.match(page, /id="cs-sample-result-title"/);
  assert.match(page, /data-sample-view disabled>View Sample Result/);
  assert.match(page, />Try Another Sample</);
  assert.match(page, /This demonstration stays in your browser and stores nothing/);
  assert.match(page, new RegExp(`href="${escapeRegExp(reviewerUrl)}">Client Sign In<\\/a>`));
  assert.doesNotMatch(page, /type="file"/);
});
