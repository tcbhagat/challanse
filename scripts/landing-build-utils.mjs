export function escapeHtmlAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function replacePilotControls(markup, contactUrl) {
  const escapedContactUrl = escapeHtmlAttribute(contactUrl);

  return markup.replace(
    /<button([^>]*)\sdata-pilot-request([^>]*)>(Request Pilot|Contact)<\/button>/g,
    (_match, before, after, label) => {
      const attributes = `${before}${after}`
        .replace(/\s+type=(?:"button"|'button')/g, '')
        .trim();
      return `<a${attributes ? ` ${attributes}` : ''} href="${escapedContactUrl}">${label}</a>`;
    }
  );
}

export function addPilotRequestTrigger(markup) {
  const marker = /<a class="cs-button cs-button--secondary"[^>]*>Client Sign In<\/a>/;
  if (!marker.test(markup)) {
    throw new Error('Cannot add the pilot request trigger without the hero client control.');
  }
  return markup.replace(
    marker,
    match => '<button class="cs-button cs-button--secondary" type="button" data-pilot-request>Request Pilot</button>\n            ' + match
  );
}

export function configureClientControls(markup, enabled, appUrl) {
  const href = escapeHtmlAttribute(appUrl);
  return markup.replace(
    /<a([^>]*)\sdata-guest-processing([^>]*)>(Process My Invoice|Client Sign In)<\/a>/g,
    (_match, before, after) => {
      const attributes = `${before}${after}`.replace(/\s+href=(?:"[^"]*"|'[^']*')/g, '').trim();
      if (enabled) return `<a${attributes ? ` ${attributes}` : ''} href="${href}">Client Sign Up / Sign In</a>`;
      return `<span${attributes ? ` ${attributes}` : ''} role="status" aria-disabled="true">Client service launching soon</span>`;
    }
  );
}
