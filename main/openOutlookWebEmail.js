'use strict';

const fs = require('fs');
const path = require('path');
const { shell, dialog, clipboard, app } = require('electron');
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
 *   - Windows: `_launchExternalUrl` forces Edge InPrivate for outlook.office.com /
 *     outlook.live.com unless openMethod is explicitly `shell` (Default browser).
 *     Otherwise shell.openExternal uses the default browser and the Outlook PWA
 *     often hijacks the compose deeplink — tests that called openOutlookWebEmail
 *     without IPC showed success while Quick Email failed for the same reason.
 *   - When the body has to be trimmed for URL length, the FULL body is also
 *     copied to the system clipboard so the user can paste it into Outlook.
 */

function _sanitiseSubject(s) {
  if (s == null) return '';
  // M49 — strip CR/LF from subject to prevent header injection.
  return String(s).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

let _outlookWebAckSession = null; // null | 'open' | 'no-body'

function _traceLaunch(event, data) {
  try {
    var base = null;
    try { base = app && typeof app.getPath === 'function' ? app.getPath('userData') : null; } catch (_) {}
    if (!base) base = process.cwd();
    var file = path.join(base, 'email-launch.log');
    var line = JSON.stringify({
      ts: new Date().toISOString(),
      event: String(event || 'unknown'),
      data: data || {},
    });
    fs.appendFileSync(file, line + '\n');
  } catch (_) { /* tracing must never break launch */ }
}

/** Playwright e2e only — writes the exact HTTPS compose URL for external browser verification. */
function _writeE2eLastComposeUrl(launchUrl) {
  if (String(process.env.CUSTODYNOTE_E2E_CAPTURE_LAUNCH_URL || '').trim() !== '1') return;
  try {
    var base = null;
    try { base = app && typeof app.getPath === 'function' ? app.getPath('userData') : null; } catch (_) {}
    if (!base) base = process.cwd();
    fs.writeFileSync(path.join(base, 'e2e-last-compose-url.txt'), String(launchUrl || ''), 'utf8');
  } catch (_) { /* must never break launch */ }
}

function _composeSignature(accountType, launchUrl) {
  var t = String(accountType || '').toLowerCase();
  var raw = String(launchUrl || '');
  var out = { composeSignature: false, composeReason: 'empty_url' };
  if (!raw) return out;
  var u;
  try { u = new URL(raw); } catch (_) { return { composeSignature: false, composeReason: 'invalid_url' }; }
  var host = String(u.hostname || '').toLowerCase();
  if (t === 'work') {
    if (host !== 'outlook.office.com') return { composeSignature: false, composeReason: 'work_wrong_host' };
    if (String(u.pathname || '') === '/mail/deeplink/compose') return { composeSignature: true, composeReason: 'work_deeplink_compose' };
    var qp = String(u.searchParams.get('path') || '');
    if (qp === '/mail/action/compose') return { composeSignature: true, composeReason: 'work_action_compose' };
    return { composeSignature: false, composeReason: 'work_not_compose_route' };
  }
  if (t === 'personal') {
    if (host !== 'outlook.live.com') return { composeSignature: false, composeReason: 'personal_wrong_host' };
    if (String(u.pathname || '') === '/mail/0/deeplink/compose') return { composeSignature: true, composeReason: 'personal_deeplink_compose' };
    return { composeSignature: false, composeReason: 'personal_not_compose_route' };
  }
  if (t === 'mailto') {
    if (String(u.protocol || '').toLowerCase() === 'mailto:') return { composeSignature: true, composeReason: 'mailto' };
    return { composeSignature: false, composeReason: 'mailto_wrong_protocol' };
  }
  return { composeSignature: false, composeReason: 'unknown_account_type' };
}

/** Prefer a full path so we need not go through cmd.exe (cmd treats `&` in URLs as shell operators). */
function _resolveMsEdgeExecutable() {
  const candidates = [];
  if (process.env['PROGRAMFILES(X86)']) {
    candidates.push(path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  if (process.env.PROGRAMFILES) {
    candidates.push(path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  for (let i = 0; i < candidates.length; i++) {
    try {
      if (fs.existsSync(candidates[i])) return candidates[i];
    } catch (_) { /* continue */ }
  }
  return 'msedge';
}

function _openUrlViaEdgeCommand(url, spawnImpl) {
  const sp = spawnImpl || spawn;
  return new Promise((resolve, reject) => {
    try {
      const exe = _resolveMsEdgeExecutable();
      /* Single argv URL — preserves ?…&… in OWA compose links (cmd.exe start … would break on &). */
      const child = sp(exe, [url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', reject);
      child.unref();
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

/* H62 — InPrivate launch. Edge InPrivate windows do not run installed PWAs
   (the Outlook PWA can't intercept the URL) and have no signed-in browser
   accounts (no wrong-account hijack). The compose URL with login_hint=…
   lands in a clean tab and OWA prompts the user to sign in to the hinted
   M365 account on first use. We resolve a full path to msedge.exe so we
   can spawn directly without going through cmd.exe (which would split on
   the URL's `&` query separators). */
function _openUrlViaEdgeInPrivate(url, spawnImpl) {
  const sp = spawnImpl || spawn;
  return new Promise((resolve, reject) => {
    try {
      const exe = _resolveMsEdgeExecutable();
      const args = ['--inprivate', '--new-window', url];
      const child = sp(exe, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', reject);
      child.unref();
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

/** outlook.office.com / outlook.live.com — must not open via default browser on Windows (Outlook PWA hijack). */
function _isMicrosoftOwaHttpsHost(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'outlook.office.com' || h === 'outlook.live.com';
  } catch (_) {
    return false;
  }
}

function _copyUrlToClipboardSafe(clipboardApi, url) {
  if (!clipboardApi || typeof clipboardApi.writeText !== 'function') return false;
  try {
    clipboardApi.writeText(String(url || ''));
    return true;
  } catch (_) { return false; }
}

function _launchExternalUrl(url, accountType, deps, shellApi) {
  const isHttps = /^https:\/\//i.test(String(url || ''));
  const browserLauncher = deps && deps.browserLauncher ? deps.browserLauncher : null;
  const clipboardApi = deps && deps.clipboard != null ? deps.clipboard : clipboard;
  const spawnImpl = deps && deps.spawn ? deps.spawn : spawn;
  /* H62 — caller (renderer Officer Emails screen) can force an Edge InPrivate
     launch to bypass Outlook PWA hijacking on Windows. Only valid for HTTPS
     URLs; mailto: stays on shell.openExternal.
     Windows + OWA hosts: always coerce to Edge InPrivate unless the user
     explicitly chose openMethod "shell" (Default browser). Tests and internal
     callers that omit IPC still get the same behaviour as Quick Email. */
  let openMethod = String((deps && deps.openMethod) || '').toLowerCase();
  if (process.platform === 'win32' && isHttps && openMethod !== 'shell' && _isMicrosoftOwaHttpsHost(url)) {
    openMethod = 'edge-inprivate';
  }
  if (isHttps && openMethod === 'edge-inprivate') {
    return _openUrlViaEdgeInPrivate(url, spawnImpl).then(() => ({
      launchUrl: url,
      launchMethod: 'edge-inprivate',
    })).catch((edgeErr) => {
      console.warn('[EMAIL] Edge InPrivate launch failed:', edgeErr && edgeErr.message ? edgeErr.message : edgeErr);
      _traceLaunch('edge_inprivate_failed', {
        accountType: accountType,
        reason: edgeErr && edgeErr.message ? edgeErr.message : String(edgeErr),
      });
      /* Second try: normal Edge window (still Edge, not Chrome / PWA handler). */
      return _openUrlViaEdgeCommand(url, spawnImpl).then(() => ({
        launchUrl: url,
        launchMethod: 'edge-window-after-inprivate-failed',
      })).catch((edge2Err) => {
        console.warn('[EMAIL] Edge normal-window launch failed:', edge2Err && edge2Err.message ? edge2Err.message : edge2Err);
        _traceLaunch('edge_normal_window_failed', {
          accountType: accountType,
          reason: edge2Err && edge2Err.message ? edge2Err.message : String(edge2Err),
        });
        return Promise.resolve(shellApi.openExternal(url)).then(() => ({
          launchUrl: url,
          launchMethod: 'shell-after-edge-failed',
        })).catch(clipboardFallback);
      });
    });
  }

  function clipboardFallback(rootCause) {
    const copied = _copyUrlToClipboardSafe(clipboardApi, url);
    _traceLaunch('launch_failed_clipboard_fallback', {
      accountType: accountType,
      copied: copied,
      reason: rootCause && rootCause.message ? rootCause.message : String(rootCause || 'unknown'),
    });
    if (copied) {
      return {
        launchUrl: url,
        launchMethod: 'clipboard-fallback',
        launchFailed: true,
        urlCopiedToClipboard: true,
      };
    }
    /* Clipboard refused too — caller turns this into an inline error toast. */
    const err = new Error(
      'Outlook could not be opened automatically and the compose URL could not be copied to the clipboard. '
      + (rootCause && rootCause.message ? '(' + rootCause.message + ')' : '')
    );
    err.launchFailed = true;
    err.urlCopiedToClipboard = false;
    throw err;
  }

  /* Non-Windows or explicit shell / non-OWA HTTPS: prefer shell.openExternal.
     (Windows OWA is handled above — Edge InPrivate so the Outlook PWA cannot
     swallow /mail/deeplink/compose.) If the shell handler fails we fall through
     to the optional explicit browser launcher, and finally — for HTTPS
     compose URLs — to a clipboard-only fallback so the user can paste the
     compose link into a browser tab themselves. */
  if (isHttps) {
    return Promise.resolve(shellApi.openExternal(url)).then(() => ({
      launchUrl: url,
      launchMethod: 'shell',
    })).catch((shellErr) => {
      console.warn('[EMAIL] shell.openExternal failed:', shellErr && shellErr.message ? shellErr.message : shellErr);
      if (!browserLauncher) return clipboardFallback(shellErr);
      return Promise.resolve(browserLauncher(url)).then(() => ({
        launchUrl: url,
        launchMethod: 'browser-launcher-fallback',
      })).catch((browserErr) => {
        console.warn('[EMAIL] browser launcher also failed:', browserErr && browserErr.message ? browserErr.message : browserErr);
        return clipboardFallback(browserErr);
      });
    });
  }

  /* Non-HTTPS schemes (mailto:) — only path is shell.openExternal; there is no
     compose URL we can put on the clipboard for the user to paste into a browser. */
  return Promise.resolve(shellApi.openExternal(url)).then(() => ({ launchUrl: url, launchMethod: 'shell' }));
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
  const route = String((safePayload && safePayload.route) || '').trim().toLowerCase();
  /* H62 — capture the user's own work address BEFORE the strip so we can pass
     it to the URL builder as login_hint. This prevents Edge / the Outlook PWA
     from hijacking the URL into a wrong-account session (e.g. a Gmail-bound
     browser session producing blank OWA tabs + a Google sign-in popup). */
  const loginHint = (function () {
    var hint = (safePayload && safePayload.feeEarnerEmail) || '';
    return typeof hint === 'string' ? hint.trim() : '';
  })();
  /* H62 — caller can force an Edge InPrivate launch for the OWA route. */
  const openMethod = (function () {
    var m = (safePayload && safePayload.openMethod) || (deps && deps.openMethod) || '';
    return typeof m === 'string' ? m.trim().toLowerCase() : '';
  })();
  _traceLaunch('resolve_account_type', { accountType: accountType, skipConfirm: !!skipConfirm, hasLoginHint: !!loginHint, openMethod: openMethod || 'default' });
  // Strip our internal hints from the payload before URL building.
  delete safePayload.accountType;
  delete safePayload.feeEarnerEmail;
  delete safePayload.route;
  delete safePayload.openMethod;

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
    _traceLaunch('cancelled', { accountType: accountType });
    return { ok: false, cancelled: true, truncated: false, reason: 'user_cancelled', accountType: accountType };
  }
  if (mode === 'no-body') {
    safePayload.body = ''; // strip privileged content from the URL
  }

  const meta = buildOutlookWebComposeUrlWithMeta(Object.assign({}, safePayload, { accountType: accountType, route: route, loginHint: loginHint }));
  const url = meta.url;
  _traceLaunch('url_built', {
    accountType: accountType,
    host: (function () { try { return new URL(url).hostname; } catch (_) { return ''; } })(),
    path: (function () { try { return new URL(url).pathname; } catch (_) { return ''; } })(),
    hasPathParam: (function () { try { return String(new URL(url).searchParams.get('path') || '') !== ''; } catch (_) { return false; } })(),
    hasLoginHint: (function () { try { return !!new URL(url).searchParams.get('login_hint'); } catch (_) { return false; } })(),
    len: String(url).length,
    truncated: !!meta.truncated,
    mode: mode,
    route: route || 'default',
  });

  // M20 — never log subject/body in production.
  console.log('[EMAIL] Opening Outlook (account=' + accountType + ', route=' + (route || 'default') + ', len=' + url.length + ', truncated=' + meta.truncated + ', mode=' + mode + ')');
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

  /* Forward the openMethod into _launchExternalUrl via the deps bag. */
  const launchDeps = Object.assign({}, deps, { openMethod: openMethod });

  return _launchExternalUrl(launchUrl, accountType, launchDeps, shellApi).then(function(launchResult) {
    const sig = _composeSignature(accountType, launchResult && launchResult.launchUrl);
    _traceLaunch('url_launched', {
      accountType: accountType,
      launchMethod: launchResult && launchResult.launchMethod,
      composeSignature: sig.composeSignature,
      composeReason: sig.composeReason,
      host: (function () { try { return new URL(launchResult.launchUrl).hostname; } catch (_) { return ''; } })(),
      path: (function () { try { return new URL(launchResult.launchUrl).pathname; } catch (_) { return ''; } })(),
      hasPathParam: (function () { try { return String(new URL(launchResult.launchUrl).searchParams.get('path') || '') !== ''; } catch (_) { return false; } })(),
    });
    _writeE2eLastComposeUrl(launchResult && launchResult.launchUrl);
    return {
      ok: true,
      mode: mode,
      truncated: meta.truncated,
      reason: meta.reason,
      accountType: accountType,
      clipboardCopied: clipboardCopied,
      launchUrl: launchResult.launchUrl,
      launchMethod: launchResult.launchMethod,
      composeSignature: sig.composeSignature,
      composeReason: sig.composeReason,
      launchFailed: !!launchResult.launchFailed,
      urlCopiedToClipboard: !!launchResult.urlCopiedToClipboard,
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
  _composeSignature,
};
