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

export function configureGuestControls(markup, enabled, guestUrl, reviewerUrl) {
  const href = escapeHtmlAttribute(enabled ? guestUrl : reviewerUrl);
  const label = enabled ? 'Process My Invoice' : 'Client Sign In';
  return markup.replace(
    /<a([^>]*)\sdata-guest-processing([^>]*)>(Process My Invoice|Client Sign In)<\/a>/g,
    (_match, before, after) => {
      const attributes = `${before}${after}`.replace(/\s+href=(?:"[^"]*"|'[^']*')/g, '').trim();
      return `<a${attributes ? ` ${attributes}` : ''} href="${href}">${label}</a>`;
    }
  );
}
