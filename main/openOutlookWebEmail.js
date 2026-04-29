'use strict';

const { shell, dialog, clipboard } = require('electron');
const { spawn } = require('child_process');
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
 *   - v1.6.5 update: do NOT prefix work links with `microsoft-edge:`. On
 *     current Edge / Outlook Web, the new outlook.cloud.microsoft shell can
 *     normalise the Edge-protocol launch back to the mailbox and drop the
 *     compose route. Plain HTTPS preserves the /mail/deeplink/compose URL.
 *   - When the body has to be trimmed for URL length, the FULL body is also
 *     copied to the system clipboard so the user can paste it into Outlook.
 */

function _sanitiseSubject(s) {
  if (s == null) return '';
  // M49 — strip CR/LF from subject to prevent header injection.
  return String(s).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

let _outlookWebAckSession = null; // null | 'open' | 'no-body'

function _openUrlViaEdgeCommand(url) {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(
        'cmd.exe',
        ['/d', '/s', '/c', 'start', '""', 'msedge', url],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }
      );
      child.once('error', reject);
      child.unref();
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function _launchExternalUrl(url, accountType, deps, shellApi) {
  const isHttps = /^https:\/\//i.test(String(url || ''));
  const hasInjectedShell = deps && Object.prototype.hasOwnProperty.call(deps, 'shell');

  /* v1.6.6: On Robert's Windows install, plain Electron shell.openExternal
     did not visibly open Outlook at all, while the old microsoft-edge:
     protocol opened Edge but landed in outlook.cloud.microsoft/mail (Inbox).
     The most reliable Windows route is launching Edge's command line with
     the normal HTTPS compose URL. Tests inject `browserLauncher` or `shell`
     so this never opens a real browser during automation. */
  if (process.platform === 'win32' && isHttps && (!hasInjectedShell || (deps && deps.browserLauncher))) {
    const browserLauncher = deps && deps.browserLauncher ? deps.browserLauncher : _openUrlViaEdgeCommand;
    return Promise.resolve(browserLauncher(url)).then(() => ({
      launchUrl: url,
      launchMethod: 'msedge-cli',
    })).catch((err) => {
      console.warn('[EMAIL] Edge command launch failed, falling back to shell.openExternal:', err && err.message ? err.message : err);
      return Promise.resolve(shellApi.openExternal(url)).then(() => ({
        launchUrl: url,
        launchMethod: 'shell-fallback',
      }));
    });
  }

  return Promise.resolve(shellApi.openExternal(url)).then(() => ({
    launchUrl: url,
    launchMethod: 'shell',
  }));
}

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
    return inferOutlookAccountType(''); // shared default: work / office.com
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

  // M20 — never log subject/body in production.
  console.log('[EMAIL] Opening Outlook (account=' + accountType + ', len=' + url.length + ', truncated=' + meta.truncated + ', mode=' + mode + ')');
  if (process && process.env && process.env.NODE_ENV === 'development') {
    console.log('Opening Outlook compose URL:', url);
  }

  // If we had to trim the body, copy the FULL original body to the clipboard
  // so the user can paste it into the Outlook compose window.
  let clipboardCopied = false;
  if (meta.truncated && payload && payload.body && clipboardApi && typeof clipboardApi.writeText === 'function') {
    try {
      clipboardApi.writeText(String(payload.body));
      clipboardCopied = true;
    } catch (_) { /* clipboard not available — continue silently */ }
  }

  // Use the plain URL for all HTTPS compose links. Do not wrap with
  // microsoft-edge: — Edge/Outlook can redirect that protocol launch to
  // outlook.cloud.microsoft/mail and lose the compose path.
  const launchUrl = url;

  return _launchExternalUrl(launchUrl, accountType, deps, shellApi).then(function(launchResult) {
    return {
      ok: true,
      mode: mode,
      truncated: meta.truncated,
      reason: meta.reason,
      accountType: accountType,
      clipboardCopied: clipboardCopied,
      launchUrl: launchResult.launchUrl,
      launchMethod: launchResult.launchMethod,
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
  _openUrlViaEdgeCommand,
  _launchExternalUrl,
};
