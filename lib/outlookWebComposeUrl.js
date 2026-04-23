'use strict';

/**
 * Builds the Outlook Web (OWA) compose deeplink. Single source of truth for URL shape + encoding.
 *
 * H38 — OWA silently truncates or rejects very long compose URLs. Callers
 * get { url, truncated: boolean, reason: string|null } so the UI can warn
 * the user and suggest opening the note as an attachment instead of inline.
 * 6000 chars is the practical Edge/Chrome cap, 2083 is the stricter IE one.
 */
const OWA_URL_SOFT_LIMIT = 6000;
const OWA_BODY_FALLBACK_NOTICE =
  '\n\n[The full message body was too long for the Outlook Web link. Please paste it from your clipboard or open the attached file.]';

function _assemble(to, cc, bcc, subject, body) {
  const encode = (v) => encodeURIComponent(v || '');
  return (
    'https://outlook.office.com/mail/deeplink/compose' +
    '?to=' + encode(to) +
    '&cc=' + encode(cc) +
    '&bcc=' + encode(bcc) +
    '&subject=' + encode(subject) +
    '&body=' + encode(body)
  );
}

// Unchanged: string-returning API for existing callers / tests.
function buildOutlookWebComposeUrl({ to, cc, bcc, subject, body }) {
  return _assemble(to || '', cc || '', bcc || '', subject || '', body || '');
}

// New: metadata-returning variant for callers that want to surface a
// "message truncated" warning to the user before the URL opens.
function buildOutlookWebComposeUrlWithMeta(opts) {
  const o = opts || {};
  const to = o.to || '';
  const cc = o.cc || '';
  const bcc = o.bcc || '';
  const subject = o.subject || '';
  const body = o.body || '';

  let url = _assemble(to, cc, bcc, subject, body);
  if (url.length <= OWA_URL_SOFT_LIMIT) {
    return { url: url, truncated: false, reason: null };
  }

  const overheadUrl = _assemble(to, cc, bcc, subject, OWA_BODY_FALLBACK_NOTICE);
  const overhead = overheadUrl.length;
  const budget = Math.max(0, OWA_URL_SOFT_LIMIT - overhead);
  let trimmed = body;
  while (trimmed.length > 0 && encodeURIComponent(trimmed).length > budget) {
    trimmed = trimmed.slice(0, Math.floor(trimmed.length * 0.9));
  }
  const truncatedBody = trimmed + OWA_BODY_FALLBACK_NOTICE;
  url = _assemble(to, cc, bcc, subject, truncatedBody);
  return { url: url, truncated: true, reason: 'body_too_long' };
}

module.exports = { buildOutlookWebComposeUrl, buildOutlookWebComposeUrlWithMeta, OWA_URL_SOFT_LIMIT };
