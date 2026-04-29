'use strict';

/**
 * Builds the deeplink/compose URL for the user's chosen Outlook surface.
 *
 * Three modes are supported (controlled by `accountType`):
 *   - 'work'     → https://outlook.office.com/mail/deeplink/compose?to=…  (Microsoft 365 work/school)
 *   - 'personal' → https://outlook.live.com/mail/0/deeplink/compose?to=…   (Outlook.com / Hotmail / Live)
 *   - 'mailto'   → mailto:<to>?subject=…&body=…                            (lets the OS choose Outlook desktop / Mail / etc.)
 *
 * H38 — OWA (web modes) silently truncates or rejects very long compose URLs.
 * Callers get { url, truncated, reason } so the UI can fall back to clipboard
 * or attached-file flow. The mailto mode is treated the same way since most
 * Windows mailto handlers also have practical length limits (~2000 chars in
 * older clients, ~32k in modern Outlook desktop).
 */
const OWA_URL_SOFT_LIMIT = 6000;
const MAILTO_URL_SOFT_LIMIT = 1900; // safest cross-client bound for mailto:
const OWA_BODY_FALLBACK_NOTICE =
  '\n\n[The full message body was too long for this email link. Please paste it from your clipboard or open the attached file.]';

const OUTLOOK_ACCOUNT_TYPES = ['work', 'personal', 'mailto'];
/* Default surface = M365 work (outlook.office.com). User report (v1.6.4):
   "Send via Outlook Web" was loading the inbox instead of opening compose
   for users who had no setting saved AND were signed into a M365 work
   account. The personal-account live.com URL only opens compose if the
   browser session is signed into outlook.live.com; if not, OWA silently
   redirects to the inbox. office.com is the safer default for solicitors
   on firm M365 accounts (the common case) and personal-Outlook.com users
   can still pick it via Settings → Your Details → "Quick Email opens in". */
const DEFAULT_ACCOUNT_TYPE = 'work';

function _normaliseAccountType(t) {
  const raw = String(t == null ? '' : t).trim().toLowerCase();
  if (raw === 'work' || raw === 'office' || raw === 'm365' || raw === 'office365') return 'work';
  if (raw === 'personal' || raw === 'live' || raw === 'outlook' || raw === 'hotmail' || raw === 'outlook.com') return 'personal';
  if (raw === 'mailto' || raw === 'desktop' || raw === 'system' || raw === 'default') return 'mailto';
  return DEFAULT_ACCOUNT_TYPE;
}

/**
 * Best-guess account type from the user's own email address.
 * Returns 'personal' for Microsoft consumer domains, 'work' otherwise.
 * Always falls back to the configured default if the address is missing.
 */
function inferOutlookAccountType(email) {
  const e = String(email == null ? '' : email).trim().toLowerCase();
  if (!e) return DEFAULT_ACCOUNT_TYPE;
  const at = e.lastIndexOf('@');
  if (at < 0) return DEFAULT_ACCOUNT_TYPE;
  const domain = e.slice(at + 1);
  const PERSONAL = new Set([
    'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.co.uk',
    'msn.com', 'passport.com', 'outlook.co.uk',
  ]);
  if (PERSONAL.has(domain)) return 'personal';
  // Common consumer domains for non-Microsoft mail still get the personal
  // Outlook surface as a sensible default — when the user opens "Outlook" they
  // overwhelmingly mean Outlook.com (consumer), not enterprise M365.
  const NON_MICROSOFT_CONSUMER = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk',
    'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me',
  ]);
  if (NON_MICROSOFT_CONSUMER.has(domain)) return 'personal';
  // Custom domain — almost always M365 work/school in solicitor practices.
  return 'work';
}

function _enc(v) { return encodeURIComponent(v == null ? '' : v); }

function _assembleWeb(host, basePath, to, cc, bcc, subject, body) {
  const sep = String(basePath).indexOf('?') >= 0 ? '&' : '?';
  return (
    'https://' + host + basePath +
    sep + 'to=' + _enc(to) +
    '&cc=' + _enc(cc) +
    '&bcc=' + _enc(bcc) +
    '&subject=' + _enc(subject) +
    '&body=' + _enc(body)
  );
}

function _assembleMailto(to, cc, bcc, subject, body) {
  // mailto encoding rules differ from query-string ones — RFC 6068 says the
  // local-part of the address is in the path, headers go in the query string
  // and use the same percent-encoding rules. encodeURIComponent matches.
  const headers = [];
  if (cc) headers.push('cc=' + _enc(cc));
  if (bcc) headers.push('bcc=' + _enc(bcc));
  if (subject) headers.push('subject=' + _enc(subject));
  if (body != null && body !== '') headers.push('body=' + _enc(body));
  return 'mailto:' + _enc(to) + (headers.length ? '?' + headers.join('&') : '');
}

function _assembleForType(accountType, to, cc, bcc, subject, body) {
  const t = _normaliseAccountType(accountType);
  if (t === 'work') {
    /* Auth-resilient route for M365: keeps compose intent through modern
       Outlook Web / cloud shell redirects that sometimes drop deeplink routes. */
    return _assembleWeb('outlook.office.com', '/?path=/mail/action/compose', to, cc, bcc, subject, body);
  }
  if (t === 'personal') {
    return _assembleWeb('outlook.live.com', '/mail/0/deeplink/compose', to, cc, bcc, subject, body);
  }
  return _assembleMailto(to, cc, bcc, subject, body);
}

function _softLimitFor(accountType) {
  return _normaliseAccountType(accountType) === 'mailto' ? MAILTO_URL_SOFT_LIMIT : OWA_URL_SOFT_LIMIT;
}

/**
 * Backwards-compatible string-returning API.
 * Optional `accountType` keeps existing callers ('work' default) working.
 */
function buildOutlookWebComposeUrl(opts) {
  const o = opts || {};
  // Existing tests + callers expect 'work' (outlook.office.com) when no type
  // is supplied — preserve that, even though the new app default is 'personal'.
  const accountType = _normaliseAccountType(o.accountType || 'work');
  return _assembleForType(accountType, o.to || '', o.cc || '', o.bcc || '', o.subject || '', o.body || '');
}

/**
 * Metadata-returning variant. Trims the body if the resulting URL would
 * exceed the (per-mode) soft limit and reports it back so the UI can show
 * a clipboard fallback / "we trimmed your message" toast.
 *
 * If `accountType === 'mailto'`, returns a mailto: URL instead of an https one.
 */
function buildOutlookWebComposeUrlWithMeta(opts) {
  const o = opts || {};
  const accountType = _normaliseAccountType(o.accountType || 'work');
  const to = o.to || '';
  const cc = o.cc || '';
  const bcc = o.bcc || '';
  const subject = o.subject || '';
  const body = o.body || '';
  const softLimit = _softLimitFor(accountType);

  let url = _assembleForType(accountType, to, cc, bcc, subject, body);
  if (url.length <= softLimit) {
    return { url: url, truncated: false, reason: null, accountType: accountType };
  }

  const overheadUrl = _assembleForType(accountType, to, cc, bcc, subject, OWA_BODY_FALLBACK_NOTICE);
  const overhead = overheadUrl.length;
  const budget = Math.max(0, softLimit - overhead);
  let trimmed = body;
  while (trimmed.length > 0 && encodeURIComponent(trimmed).length > budget) {
    trimmed = trimmed.slice(0, Math.floor(trimmed.length * 0.9));
  }
  const truncatedBody = trimmed + OWA_BODY_FALLBACK_NOTICE;
  url = _assembleForType(accountType, to, cc, bcc, subject, truncatedBody);
  return { url: url, truncated: true, reason: 'body_too_long', accountType: accountType };
}

module.exports = {
  buildOutlookWebComposeUrl,
  buildOutlookWebComposeUrlWithMeta,
  inferOutlookAccountType,
  OUTLOOK_ACCOUNT_TYPES,
  OWA_URL_SOFT_LIMIT,
  MAILTO_URL_SOFT_LIMIT,
};
