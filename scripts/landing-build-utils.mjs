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
