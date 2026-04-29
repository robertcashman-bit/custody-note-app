'use strict';

const { shell, dialog } = require('electron');
const { buildOutlookWebComposeUrl, buildOutlookWebComposeUrlWithMeta } = require('../lib/outlookWebComposeUrl');

/**
 * Opens Outlook Web compose in the browser (never mailto / never the system default client).
 * On Windows, uses the microsoft-edge: scheme so desktop Outlook does not intercept outlook.office.com.
 *
 * H38 — uses the metadata variant so we can report truncation back to the
 * renderer instead of silently shipping a stripped URL. M20 — we no longer
 * log any portion of the compose URL, which can contain client PII (names,
 * email addresses, file numbers) and was being captured in support bundles.
 *
 * H02 (2026 hardening) — the compose URL embeds `subject` and `body` in the
 * query string. Once handed to Edge that URL is visible in browser history,
 * may appear in proxy logs, and is sent to Microsoft as part of the request
 * to outlook.office.com. For privileged content we must obtain explicit
 * one-time-per-session confirmation before launching.
 */

// M49 — strip CR/LF from subject to prevent header injection in clients
// that parse the deeplink into native MIME headers.
function _sanitiseSubject(s) {
  if (s == null) return '';
  return String(s).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

// In-memory "remember for this app session" so the user is not prompted on
// every email click. We store the LAST mode the user picked so a subsequent
// send uses that same choice (otherwise a "Don't ask again" tick after
// "subject only" would silently start sending the body next time, which is
// the opposite of the user's intent). Acknowledgement is intentionally NOT
// persisted to disk — closing the app forces re-acknowledgement.
let _outlookWebAckSession = null; // null | 'open' | 'no-body'

/**
 * Show the per-session confirmation dialog. Returns:
 *   "open"    — user accepted, open the compose URL with subject + body.
 *   "no-body" — user accepted but asked us to strip the body (subject only).
 *   "cancel"  — user cancelled.
 *
 * NOTE on default button: the default action is "Open in Outlook Web (with
 * everything I typed)" so that pressing Enter / clicking the default never
 * silently throws away the body the user just typed in the email modal.
 * The "subject only" option remains for legally-privileged matters where
 * the user explicitly does NOT want the body in the URL — but that is now
 * an opt-in, not the default.
 */
async function _confirmOutlookWebDeeplink(dialogApi, parentWindow, payload) {
  if (_outlookWebAckSession === 'open' || _outlookWebAckSession === 'no-body') {
    return _outlookWebAckSession;
  }
  const bodyLen = payload && payload.body ? String(payload.body).length : 0;
  const subjectLen = payload && payload.subject ? String(payload.subject).length : 0;
  const detail =
    'CustodyNote will open Outlook Web in your browser to compose this email.\n\n'
    + 'Microsoft Outlook receives the subject line and (by default) the email body '
    + 'in the URL. That URL is visible to:\n'
    + '  • your browser history,\n'
    + '  • any corporate web proxy or DLP product,\n'
    + '  • Microsoft\'s outlook.office.com servers.\n\n'
    + 'For LEGALLY PRIVILEGED material you can choose to send the subject only — '
    + 'then attach the PDF or paste the body in Outlook before sending.\n\n'
    + 'Subject length: ' + subjectLen + ' chars\n'
    + 'Body length: ' + bodyLen + ' chars';
  const { response, checkboxChecked } = await dialogApi.showMessageBox(parentWindow || null, {
    type: 'question',
    title: 'Open in Outlook Web',
    message: 'Send this email via Outlook Web?',
    detail: detail,
    buttons: [
      'Open in Outlook Web',                    // 0 — default: send everything the user typed
      'Open with subject only (no body)',       // 1 — privacy opt-in
      'Cancel',                                 // 2
    ],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    checkboxLabel: 'Don\u2019t ask again until I quit the app',
    checkboxChecked: false,
  });
  if (response === 2) return 'cancel';
  const mode = response === 1 ? 'no-body' : 'open';
  if (checkboxChecked) _outlookWebAckSession = mode;
  return mode;
}

async function openOutlookWebEmail(payload, deps = {}) {
  const shellApi = deps.shell != null ? deps.shell : shell;
  const dialogApi = deps.dialog != null ? deps.dialog : dialog;
  const parentWindow = deps.parentWindow || null;
  const skipConfirm = !!deps.skipConfirm; // tests only

  const safePayload = Object.assign({}, payload || {}, {
    subject: _sanitiseSubject(payload && payload.subject),
  });

  // Confirmation gate.
  let mode = 'open';
  if (!skipConfirm && dialogApi && typeof dialogApi.showMessageBox === 'function') {
    try {
      mode = await _confirmOutlookWebDeeplink(dialogApi, parentWindow, safePayload);
    } catch (_) {
      mode = 'cancel';
    }
  }
  if (mode === 'cancel') {
    return { ok: false, cancelled: true, truncated: false, reason: 'user_cancelled' };
  }
  if (mode === 'no-body') {
    safePayload.body = ''; // strip privileged content from the URL
  }

  const meta = buildOutlookWebComposeUrlWithMeta(safePayload);
  const url = meta.url;
  console.log('[EMAIL] Opening Outlook Web (len=' + url.length + ', truncated=' + meta.truncated + ', mode=' + mode + ')');
  const launchUrl =
    process.platform === 'win32'
      ? 'microsoft-edge:' + url
      : url;
  return Promise.resolve(shellApi.openExternal(launchUrl)).then(function() {
    return { ok: true, mode: mode, truncated: meta.truncated, reason: meta.reason };
  });
}

// Test-only hook to reset the per-session ack state.
function _resetOutlookWebAckForTests() { _outlookWebAckSession = null; }

module.exports = {
  openOutlookWebEmail,
  buildOutlookWebComposeUrl,
  buildOutlookWebComposeUrlWithMeta,
  _resetOutlookWebAckForTests,
};
