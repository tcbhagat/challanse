import process from 'node:process';

const expectedCommit = process.argv[2];
const publicUrl = 'https://challanse.constrovet.com/';
const reviewerUrl = 'https://review.challanse.constrovet.com/';

if (!/^[0-9a-f]{7,40}$/i.test(expectedCommit || '')) {
  throw new Error('Usage: node scripts/verify-landing-live.mjs <expected-commit-sha>');
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  return { response, text: await response.text() };
}

const insecureResponse = await fetch('http://challanse.constrovet.com/', { redirect: 'manual' });
if (![301, 308].includes(insecureResponse.status)) {
  throw new Error(`HTTP did not redirect permanently: ${insecureResponse.status}`);
}
if (!insecureResponse.headers.get('location')?.startsWith(publicUrl)) {
  throw new Error('HTTP redirect did not target the trusted HTTPS origin.');
}

let page;
for (let attempt = 1; attempt <= 20; attempt += 1) {
  const result = await fetchText(publicUrl, { cache: 'no-store' });
  if (result.response.status === 200 && result.text.includes(`?v=${expectedCommit.slice(0, 7)}`)) {
    page = result.text;
    break;
  }
  if (attempt < 20) await sleep(15_000);
}

if (!page) {
  throw new Error(`Live landing did not publish commit ${expectedCommit.slice(0, 7)} within five minutes.`);
}

const navigationResult = await fetchText(`${publicUrl}assets/nav.html`, { cache: 'no-store' });
if (navigationResult.response.status !== 200) {
  throw new Error(`Navigation partial returned ${navigationResult.response.status}.`);
}

for (const [name, markup] of [['landing', page], ['navigation', navigationResult.text]]) {
  if (markup.includes('data-pilot-request')) {
    throw new Error(`${name} contains an inert pilot control.`);
  }
  if (!markup.includes(`href="${reviewerUrl}"`) || !markup.includes('>Client Sign In</a>')) {
    throw new Error(`${name} has no valid registered-client destination.`);
  }
}

for (const requiredSampleControl of ['data-sample-demo', 'data-sample-view', 'Sample demonstration']) {
  if (!page.includes(requiredSampleControl)) {
    throw new Error(`Landing is missing sample control: ${requiredSampleControl}.`);
  }
}

console.log(`Landing smoke passed for ${expectedCommit.slice(0, 7)}.`);
