'use strict';

/**
 * lib/outlookLaunch.js
 * ----------------------------------------------------------------------------
 * Pure helpers for the v1.8.0 reliable Outlook launch path.
 *
 * Builds the four payload formats used by the `officer-emails:send` IPC:
 *   - Outlook desktop: RFC 5322 .eml file content (handed to shell.openPath)
 *   - Outlook on the web: M365 deeplink URL (handed to shell.openExternal)
 *   - Default mail app: RFC 6068 mailto: URI (handed to shell.openExternal)
 *   - Copy-only: subject/body for clipboard
 *
 * Plus PII-safe redaction for the email-launch.log diagnostic file.
 *
 * Why these specific formats:
 *
 *   .eml: Outlook desktop opens .eml as a compose draft natively. No URL
 *   parsing, no browser involved, no PWA hijack. The historical pre-v1.6.21
 *   `main/openComposeEml.js` was deleted because of issues launching .eml
 *   that turned out to be MIME header malformation (CRLF vs LF) and missing
 *   `MIME-Version` header — both fixed here. We use `\r\n` line endings
 *   throughout per RFC 5322 and include a complete header block.
 *
 *   OWA: the `outlook.office.com/mail/deeplink/compose` endpoint with
 *   URLSearchParams encoding is the format that v1.6.14 settled on
 *   (changelog: "use OWA path=/mail/action/compose ... so Microsoft 365 new
 *   shell opens compose instead of dropping the compose deep link to inbox").
 *
 *   mailto: RFC 6068 specifies that subject/body live in the query string,
 *   percent-encoded, with `?` separator and `&` between fields. CRLF body
 *   newlines must be `%0D%0A` not `%0A` to survive Outlook parsing.
 *
 * NO mailto: is built for the Outlook-desktop path because mailto: gets
 * intercepted by whatever app is registered as the default mailto handler,
 * which historically was Edge (PWA), default browser, or Outlook's web
 * preview — not Outlook desktop. Use .eml + shell.openPath for desktop.
 *
 * NO `cmd /c start msedge <url>` anywhere — that's the v1.6.13 bug where
 * `&` separators in the OWA URL truncated the launched URL.
 *
 * NO chained-fallback launchers — if the chosen method's launch fails the
 * caller falls back to clipboard ONLY. Chaining produced "Outlook opens,
 * then Edge opens, then nothing happens" reports in v1.6.10-v1.6.16.
 */

const SEND_METHODS = Object.freeze([
  'outlook-desktop',
  'outlook-web',
  'default-mailto',
  'copy-only',
]);

const OWA_COMPOSE_BASE = 'https://outlook.office.com/mail/deeplink/compose';
const MAX_SUBJECT_CHARS = 998;
const MAX_BODY_CHARS = 50000;

/**
 * Validate a `{ to, subject, body }` payload.
 * @returns {{ ok: boolean, error?: string }}
 */
function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'Missing payload' };
  const to = String(payload.to || '').trim();
  const subject = String(payload.subject || '').trim();
  const body = String(payload.body || '');
  if (!to) return { ok: false, error: 'Recipient (to) is required' };
  if (!subject) return { ok: false, error: 'Subject is required' };
  if (!body.trim()) return { ok: false, error: 'Body is required' };
  if (subject.length > MAX_SUBJECT_CHARS) return { ok: false, error: 'Subject too long' };
  if (body.length > MAX_BODY_CHARS) return { ok: false, error: 'Body too long' };
  /* RFC 5321 path: forbid CR/LF in to/subject (header injection guard). */
  if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
    return { ok: false, error: 'CR/LF in to/subject not allowed' };
  }
  return { ok: true };
}

/**
 * Build an RFC 5322 .eml message. Outlook desktop opens this as a compose
 * draft (it interprets a non-multipart message with no `From:` and no
 * `Date:` close to now as a draft to be edited and sent).
 *
 * Conventions:
 *   - CRLF line endings everywhere (RFC 5322 §2.1)
 *   - UTF-8 with explicit Content-Type charset
 *   - 8bit Content-Transfer-Encoding (Outlook handles this; saves us
 *     from having to base64-encode bodies with non-ASCII characters)
 *   - X-Unsent: 1 hint (some Outlook versions treat this as "unsent draft"
 *     and put the message in the Drafts folder when opened)
 *   - No `From:` header — Outlook fills it from the user's default account
 *
 * @param {{ to: string, subject: string, body: string, date?: Date }} payload
 * @returns {string}
 */
function buildEmlContent(payload) {
  const validation = validatePayload(payload);
  if (!validation.ok) throw new Error(validation.error);

  const to = String(payload.to).trim();
  const subject = String(payload.subject).trim();
  const body = String(payload.body || '');
  const date = (payload.date instanceof Date) ? payload.date : new Date();

  /* RFC 5322 fold long subjects? Outlook handles long subject fine without
     folding; only fold if explicitly required. We just truncate-validate. */
  const headers = [
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Unsent: 1',
    'X-Mailer: CustodyNote',
    'Date: ' + date.toUTCString(),
    'To: ' + _encodeHeaderValue(to),
    'Subject: ' + _encodeHeaderValue(subject),
  ];

  /* Body: normalise newlines to CRLF (RFC 5322 §2.3). Bare LF or bare CR
     can cause Outlook to flatten paragraph breaks. */
  const bodyCrlf = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');

  return headers.join('\r\n') + '\r\n\r\n' + bodyCrlf + '\r\n';
}

/**
 * Encode a header value if it contains non-ASCII (RFC 2047 encoded-word).
 * For pure ASCII, return unchanged so Outlook displays the readable form.
 */
function _encodeHeaderValue(value) {
  /* Fast path: ASCII printable — no encoding needed. */
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  /* Slow path: RFC 2047 base64 encoded-word for the whole header. */
  const utf8 = Buffer.from(value, 'utf8').toString('base64');
  return '=?utf-8?B?' + utf8 + '?=';
}

/**
 * Build an Outlook-on-the-web compose deeplink. URLSearchParams handles
 * percent-encoding correctly — including escaping `&` inside subject/body
 * so the URL never breaks at the first `&` like the v1.6.13 cmd-line bug.
 *
 * @param {{ to: string, subject: string, body: string }} payload
 * @returns {string}
 */
function buildOwaComposeUrl(payload) {
  const validation = validatePayload(payload);
  if (!validation.ok) throw new Error(validation.error);
  const params = new URLSearchParams();
  params.set('to', String(payload.to).trim());
  params.set('subject', String(payload.subject).trim());
  /* Preserve paragraph breaks as CRLF — OWA renders \r\n as <br>\n in compose. */
  const bodyForUrl = String(payload.body || '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  params.set('body', bodyForUrl);
  return OWA_COMPOSE_BASE + '?' + params.toString();
}

/**
 * Build an RFC 6068 mailto: URI. Whatever app is registered as the system
 * default for `mailto:` will handle it.
 *
 * @param {{ to: string, subject: string, body: string }} payload
 * @returns {string}
 */
function buildMailtoUri(payload) {
  const validation = validatePayload(payload);
  if (!validation.ok) throw new Error(validation.error);
  /* RFC 6068: to is in the path (not query); subject/body are query params.
     Use encodeURIComponent (NOT URLSearchParams: URLSearchParams emits `+`
     for spaces, but RFC 6068 §5 mandates `%20`). */
  const to = encodeURIComponent(String(payload.to).trim());
  const subject = encodeURIComponent(String(payload.subject).trim());
  /* Body: convert CRLF/CR/LF to LF then percent-encode. encodeURIComponent
     emits `%0A` for LF — Outlook desktop and most mail clients handle this
     as a paragraph break. */
  const bodyLf = String(payload.body || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const body = encodeURIComponent(bodyLf);
  return 'mailto:' + to + '?subject=' + subject + '&body=' + body;
}

/**
 * Build a PII-safe redacted record for email-launch.log. Never logs
 * recipient addresses, subjects, or bodies — only their lengths + the
 * to-domain (which is useful for diagnosing OWA/M365 routing issues).
 *
 * @param {{ to: string, subject: string, body: string }} payload
 * @returns {object}
 */
function redactForLog(payload) {
  const to = String((payload && payload.to) || '');
  const subject = String((payload && payload.subject) || '');
  const body = String((payload && payload.body) || '');
  const atIdx = to.indexOf('@');
  const toDomain = atIdx >= 0 ? to.slice(atIdx + 1).toLowerCase() : '(no-at)';
  return {
    toDomain,
    subjectLength: subject.length,
    bodyLength: body.length,
  };
}

/**
 * Format a single launch-log entry as a one-line string.
 * @param {{ ts?: string, method: string, ok: boolean, error?: string|null,
 *           redacted: object, durationMs?: number }} entry
 * @returns {string}
 */
function formatLogLine(entry) {
  const ts = entry.ts || new Date().toISOString();
  const status = entry.ok ? 'OK' : 'FAIL';
  const err = entry.error ? ' err=' + JSON.stringify(String(entry.error).slice(0, 200)) : '';
  const dur = (typeof entry.durationMs === 'number') ? ' dur=' + entry.durationMs + 'ms' : '';
  const r = entry.redacted || {};
  return [
    ts,
    status,
    entry.method || '?',
    'toDomain=' + (r.toDomain || '?'),
    'subjLen=' + (typeof r.subjectLength === 'number' ? r.subjectLength : '?'),
    'bodyLen=' + (typeof r.bodyLength === 'number' ? r.bodyLength : '?'),
  ].join(' ') + dur + err;
}

/**
 * Determine the recommended send method given a detection result.
 * Detection keys mirror what the main-process detector returns.
 *
 * @param {{ outlookDesktopInstalled?: boolean, defaultMailtoApp?: string|null }} detection
 * @returns {'outlook-desktop'|'outlook-web'|'default-mailto'|'copy-only'}
 */
function recommendSendMethod(detection) {
  const d = detection || {};
  if (d.outlookDesktopInstalled === true) return 'outlook-desktop';
  /* If the user has a default mailto handler that isn't a generic browser
     (which typically renders mailto as "save as link to disk") prefer that.
     We can't reliably distinguish browsers from mail clients from the
     ProgId alone, so be conservative: only recommend default-mailto if the
     ProgId looks like a mail-related ProgId. */
  const prog = String(d.defaultMailtoApp || '').toLowerCase();
  if (prog && /(outlook|thunderbird|emclient|mailbird|spark|airmail|postbox)/.test(prog)) {
    return 'default-mailto';
  }
  /* No Outlook desktop, no recognizable mail handler — Outlook web is the
     safest bet for a UK criminal-defence audience using M365. */
  return 'outlook-web';
}

module.exports = {
  SEND_METHODS,
  OWA_COMPOSE_BASE,
  MAX_SUBJECT_CHARS,
  MAX_BODY_CHARS,
  validatePayload,
  buildEmlContent,
  buildOwaComposeUrl,
  buildMailtoUri,
  redactForLog,
  formatLogLine,
  recommendSendMethod,
};
