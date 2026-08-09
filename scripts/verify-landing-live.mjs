import process from 'node:process';

const expectedCommit = process.argv[2];
const publicUrl = 'https://challanse.constrovet.com/';
const contactUrl = 'https://www.constrovet.com/pages/contact.html?interest=challanse';

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
  const controls = [...markup.matchAll(/<(a|button)\b([^>]*)>(Request Pilot|Contact)<\/\1>/g)];
  if (controls.length === 0) throw new Error(`${name} contains no pilot controls.`);
  for (const [, tag, attributes, label] of controls) {
    const normalizedAttributes = attributes.replaceAll('&amp;', '&');
    if (tag !== 'a' || !normalizedAttributes.includes(`href="${contactUrl}"`)) {
      throw new Error(`${name} ${label} control has no valid contact destination.`);
    }
  }
}

const contactResult = await fetchText(contactUrl, { cache: 'no-store' });
if (contactResult.response.status !== 200) {
  throw new Error(`Contact page returned ${contactResult.response.status}.`);
}
if (
  !contactResult.text.includes('<option value="ChallanSe pilot">ChallanSe pilot</option>') ||
  !contactResult.text.includes('select.value = "ChallanSe pilot"')
) {
  throw new Error('Contact page does not preserve ChallanSe pilot preselection.');
}

console.log(`Landing smoke passed for ${expectedCommit.slice(0, 7)}.`);
