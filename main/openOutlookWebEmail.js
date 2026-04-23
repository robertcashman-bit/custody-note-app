'use strict';

const { shell } = require('electron');
const { buildOutlookWebComposeUrl, buildOutlookWebComposeUrlWithMeta } = require('../lib/outlookWebComposeUrl');

/**
 * Opens Outlook Web compose in the browser (never mailto / never the system default client).
 * On Windows, uses the microsoft-edge: scheme so desktop Outlook does not intercept outlook.office.com.
 *
 * H38 — uses the metadata variant so we can report truncation back to the
 * renderer instead of silently shipping a stripped URL. M20 — we no longer
 * log any portion of the compose URL, which can contain client PII (names,
 * email addresses, file numbers) and was being captured in support bundles.
 */
// M49 — strip CR/LF from subject to prevent header injection in clients
// that parse the deeplink into native MIME headers.
function _sanitiseSubject(s) {
  if (s == null) return '';
  return String(s).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function openOutlookWebEmail(payload, deps = {}) {
  const shellApi = deps.shell != null ? deps.shell : shell;
  const safePayload = Object.assign({}, payload || {}, {
    subject: _sanitiseSubject(payload && payload.subject),
  });
  const meta = buildOutlookWebComposeUrlWithMeta(safePayload);
  const url = meta.url;
  console.log('[EMAIL] Opening Outlook Web (len=' + url.length + ', truncated=' + meta.truncated + ')');
  const launchUrl =
    process.platform === 'win32'
      ? 'microsoft-edge:' + url
      : url;
  return Promise.resolve(shellApi.openExternal(launchUrl)).then(function() {
    return { ok: true, truncated: meta.truncated, reason: meta.reason };
  });
}

module.exports = { openOutlookWebEmail, buildOutlookWebComposeUrl, buildOutlookWebComposeUrlWithMeta };
