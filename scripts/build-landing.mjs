import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { addPilotRequestTrigger, configureGuestControls, replacePilotControls } from './landing-build-utils.mjs';

const root = process.cwd();
const output = path.join(root, 'dist', 'landing');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'robots.txt', 'sitemap.xml', '.nojekyll']) {
  await cp(path.join(root, file), path.join(output, file));
}
await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });

/* Build a cache-busting hash from the current commit (or timestamp as fallback). */
const { execSync } = await import('node:child_process');
let cacheBust;
try {
  cacheBust = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  cacheBust = Date.now().toString(36);
}

const apiBaseUrl = process.env.CHALLANSE_API_BASE_URL || '__API_BASE_URL__';
const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || '__TURNSTILE_SITE_KEY__';
const pilotRequestsEnabled = process.env.CHALLANSE_PILOT_REQUESTS_ENABLED === 'true';
const guestProcessingEnabled = process.env.CHALLANSE_GUEST_PROCESSING_ENABLED === 'true';
const guestUrl = process.env.CHALLANSE_GUEST_URL || 'https://guest.challanse.constrovet.com/';
const reviewerUrl = process.env.CHALLANSE_REVIEWER_URL || 'https://review.challanse.constrovet.com/';
const contactUrl =
  process.env.CHALLANSE_CONTACT_URL || 'https://www.constrovet.com/pages/contact.html?interest=challanse';

if (
  pilotRequestsEnabled &&
  (apiBaseUrl.startsWith('__') || turnstileSiteKey.startsWith('__'))
) {
  throw new Error('Interactive pilot requests require an API base URL and Turnstile site key.');
}

/* Inject runtime config into the output runtime-config.js */
const runtimePath = path.join(output, 'assets', 'js', 'runtime-config.js');
const runtime = (await readFile(runtimePath, 'utf8'))
  .replace('__API_BASE_URL__', apiBaseUrl)
  .replace('__TURNSTILE_SITE_KEY__', turnstileSiteKey)
  .replace('__PILOT_REQUESTS_ENABLED__', String(pilotRequestsEnabled));
await writeFile(runtimePath, runtime);

/* Inject cache-bust hash into the output index.html */
const htmlPath = path.join(output, 'index.html');
let html = configureGuestControls(
  (await readFile(htmlPath, 'utf8')).replace(/__CACHE_BUST__/g, cacheBust),
  guestProcessingEnabled,
  guestUrl,
  reviewerUrl
);
if (!pilotRequestsEnabled) {
  html = replacePilotControls(html, contactUrl)
    .replace(/\n\s*<dialog class="cs-pilot-dialog"[\s\S]*?<\/dialog>\n/, '\n')
    .replace(
      /\n\s*<script src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit" async defer><\/script>/,
      ''
    );
} else {
  html = addPilotRequestTrigger(html);
}
await writeFile(htmlPath, html);

const navigationPath = path.join(output, 'assets', 'nav.html');
let navigation = configureGuestControls(
  await readFile(navigationPath, 'utf8'),
  guestProcessingEnabled,
  guestUrl,
  reviewerUrl
);
if (!pilotRequestsEnabled) navigation = replacePilotControls(navigation, contactUrl);
await writeFile(navigationPath, navigation);

if (process.env.CHALLANSE_CUSTOM_DOMAIN) {
  await writeFile(path.join(output, 'CNAME'), `${process.env.CHALLANSE_CUSTOM_DOMAIN}\n`);
}
