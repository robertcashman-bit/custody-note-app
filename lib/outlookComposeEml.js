'use strict';

/**
 * RFC 5322 .eml draft builder for Outlook desktop compose.
 *
 * Outlook opens .eml files with X-Unsent: 1 as an editable draft (To, Subject,
 * Body prefilled). This is the reliable body-transfer path when Outlook Web
 * compose URLs cannot carry a full message (length limits / silent body drop).
 *
 * Pure Node — no Electron dependency. Main process writes the file and calls
 * shell.openPath.
 */

const CRLF = '\r\n';

/**
 * Strip CR/LF from header values to prevent header injection.
 * @param {string} s
 * @returns {string}
 */
function stripHeaderInjection(s) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
}

/**
 * RFC 2047 base64 encoded-word for non-ASCII header values.
 * @param {string} value
 * @returns {string}
 */
function encodeHeaderValue(value) {
  const s = stripHeaderInjection(value);
  if (!s) return '';
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return '=?utf-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}

/**
 * Build an RFC 5322 .eml message Outlook opens as an unsent draft.
 *
 * @param {{ to?: string, cc?: string, subject?: string, body?: string, date?: Date }} fields
 * @returns {string}
 */
function buildOutlookComposeEmlContent(fields) {
  const f = fields || {};
  const to = stripHeaderInjection(f.to);
  const cc = stripHeaderInjection(f.cc);
  const subject = encodeHeaderValue(f.subject);
  const body = String(f.body == null ? '' : f.body);
  const date = f.date instanceof Date ? f.date : new Date();

  const headers = [
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Unsent: 1',
    'X-Mailer: CustodyNote',
    'Date: ' + date.toUTCString(),
  ];
  if (to) headers.push('To: ' + encodeHeaderValue(to));
  if (cc) headers.push('Cc: ' + encodeHeaderValue(cc));
  headers.push('Subject: ' + subject);

  const bodyCrlf = body
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, CRLF);

  return headers.join(CRLF) + CRLF + CRLF + bodyCrlf + CRLF;
}

/**
 * Extract the plain-text body from an .eml produced by buildOutlookComposeEmlContent.
 * Used by tests to prove round-trip fidelity.
 *
 * @param {string} eml
 * @returns {string}
 */
function extractEmlPlainBody(eml) {
  const raw = String(eml == null ? '' : eml);
  const idx = raw.indexOf(CRLF + CRLF);
  if (idx < 0) return '';
  let body = raw.slice(idx + 4);
  if (body.endsWith(CRLF)) body = body.slice(0, -CRLF.length);
  return body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

module.exports = {
  buildOutlookComposeEmlContent,
  extractEmlPlainBody,
  encodeHeaderValue,
  stripHeaderInjection,
};
