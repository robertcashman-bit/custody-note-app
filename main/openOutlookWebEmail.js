'use strict';

const { shell, dialog, clipboard } = require('electron');
const {
  buildOutlookWebComposeUrl,
  buildOutlookWebComposeUrlWithMeta,
  inferOutlookAccountType,
} = require('../lib/outlookWebComposeUrl');

/**
 * Opens an Outlook compose surface chosen by the user (work-OWA, personal-OWA,
 * or system mailto:). Never falls through to a raw `mailto:` unless the user
 * explicitly chose the desktop/system Outlook mode in settings.
 *
 * H02 (2026 hardening) — the compose URL embeds `subject` and `body` in the
 * query string. For privileged content we obtain explicit one-time-per-session
 * confirmation before launching (full-body is the default; subject-only is an
 * opt-in for legally privileged matter).
 *
 * v1.6.2 hardening:
 *   - Honours `accountType` ('work' | 'personal' | 'mailto') so the URL goes
 *     to outlook.office.com, outlook.live.com, or mailto: respectively.
 *   - Only force `microsoft-edge:` when targeting outlook.office.com on
 *     Windows; for personal Outlook and mailto we use the OS default app
 *     (so users without Edge / signed into a different Outlook profile in
 *     their default browser get the right destination).
 *   - When the body has to be trimmed for URL length, the FULL body is also
 *     copied to the system clipboard so the user can paste it into Outlook.
 */

function _sanitiseSubject(s) {
  if (s == null) return '';
  // M49 — strip CR/LF from subject to prevent header injection.
  return String(s).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

let _outlookWebAckSession = null; // null | 'open' | 'no-body'

async function _confirmOutlookWebDeeplink(dialogApi, parentWindow, payload, accountType) {
  if (_outlookWebAckSession === 'open' || _outlookWebAckSession === 'no-body') {
    return _outlookWebAckSession;
  }
  const bodyLen = payload && payload.body ? String(payload.body).length : 0;
  const subjectLen = payload && payload.subject ? String(payload.subject).length : 0;
  const surface =
    accountType === 'mailto' ? 'your default email app (e.g. Outlook desktop)'
    : accountType === 'personal' ? 'Outlook.com (outlook.live.com)'
    : 'Outlook on the web (outlook.office.com)';
  const detail =
    'CustodyNote will hand this email to ' + surface + '.\n\n'
    + 'The subject and (by default) the email body travel inside the link, '
    + 'which means they are visible to:\n'
    + '  • your browser history,\n'
    + '  • any corporate web proxy or DLP product,\n'
    + (accountType === 'mailto' ? '' : '  • Microsoft\'s servers,\n')
    + '  • the receiving inbox.\n\n'
    + 'For LEGALLY PRIVILEGED material you can choose to send the subject only — '
    + 'then attach the PDF or paste the body in Outlook before sending.\n\n'
    + 'Subject length: ' + subjectLen + ' chars\n'
    + 'Body length: ' + bodyLen + ' chars';
  const { response, checkboxChecked } = await dialogApi.showMessageBox(parentWindow || null, {
    type: 'question',
    title: 'Open in Outlook',
    message: 'Send this email via ' + surface + '?',
    detail: detail,
    buttons: [
      'Open in Outlook',                        // 0 — default: send everything the user typed
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
  const clipboardApi = deps.clipboard != null ? deps.clipboard : clipboard;
  const parentWindow = deps.parentWindow || null;
  const skipConfirm = !!deps.skipConfirm; // tests / power users only

  const safePayload = Object.assign({}, payload || {}, {
    subject: _sanitiseSubject(payload && payload.subject),
  });

  // Resolve account type. Caller may pass it explicitly (preferred) or omit it
  // and let the saved settings / fee-earner email guess it.
  const accountType = (function() {
    if (deps.accountType) return deps.accountType;
    if (safePayload.accountType) return safePayload.accountType;
    if (safePayload.feeEarnerEmail) return inferOutlookAccountType(safePayload.feeEarnerEmail);
    return 'personal'; // sensible default for "Outlook.com" users
  })();
  // Strip our internal hints from the payload before URL building.
  delete safePayload.accountType;
  delete safePayload.feeEarnerEmail;

  // Confirmation gate (skipped only for tests / scripted flows).
  let mode = 'open';
  if (!skipConfirm && dialogApi && typeof dialogApi.showMessageBox === 'function') {
    try {
      mode = await _confirmOutlookWebDeeplink(dialogApi, parentWindow, safePayload, accountType);
    } catch (_) {
      mode = 'cancel';
    }
  }
  if (mode === 'cancel') {
    return { ok: false, cancelled: true, truncated: false, reason: 'user_cancelled', accountType: accountType };
  }
  if (mode === 'no-body') {
    safePayload.body = ''; // strip privileged content from the URL
  }

  const meta = buildOutlookWebComposeUrlWithMeta(Object.assign({}, safePayload, { accountType: accountType }));
  const url = meta.url;

  // M20 — never log subject/body in the URL.
  console.log('[EMAIL] Opening Outlook (account=' + accountType + ', len=' + url.length + ', truncated=' + meta.truncated + ', mode=' + mode + ')');

  // If we had to trim the body, copy the FULL original body to the clipboard
  // so the user can paste it into the Outlook compose window.
  let clipboardCopied = false;
  if (meta.truncated && payload && payload.body && clipboardApi && typeof clipboardApi.writeText === 'function') {
    try {
      clipboardApi.writeText(String(payload.body));
      clipboardCopied = true;
    } catch (_) { /* clipboard not available — continue silently */ }
  }

  // Edge-forcing rule:
  //   - work (outlook.office.com): on Windows, prefix `microsoft-edge:` so the
  //     "New Outlook" desktop URL handler doesn't intercept the deeplink.
  //   - personal (outlook.live.com): use the OS default browser — Outlook
  //     desktop never claims outlook.live.com so default is correct.
  //   - mailto: use the OS default mail handler.
  let launchUrl = url;
  if (process.platform === 'win32' && accountType === 'work' && url.startsWith('https://')) {
    launchUrl = 'microsoft-edge:' + url;
  }

  return Promise.resolve(shellApi.openExternal(launchUrl)).then(function() {
    return {
      ok: true,
      mode: mode,
      truncated: meta.truncated,
      reason: meta.reason,
      accountType: accountType,
      clipboardCopied: clipboardCopied,
    };
  });
}

function _resetOutlookWebAckForTests() { _outlookWebAckSession = null; }

module.exports = {
  openOutlookWebEmail,
  buildOutlookWebComposeUrl,
  buildOutlookWebComposeUrlWithMeta,
  inferOutlookAccountType,
  _resetOutlookWebAckForTests,
};
