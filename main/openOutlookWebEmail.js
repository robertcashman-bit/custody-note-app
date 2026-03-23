'use strict';

const { shell } = require('electron');
const { buildOutlookWebComposeUrl } = require('../lib/outlookWebComposeUrl');

/**
 * Opens Outlook Web compose in the browser (never mailto / never the system default client).
 * On Windows, uses the microsoft-edge: scheme so desktop Outlook does not intercept outlook.office.com.
 */
function openOutlookWebEmail(payload, deps = {}) {
  const shellApi = deps.shell != null ? deps.shell : shell;
  const url = buildOutlookWebComposeUrl(payload);
  console.log('[EMAIL] Opening Outlook Web:', url.slice(0, 220) + (url.length > 220 ? '…' : ''));
  const launchUrl =
    process.platform === 'win32'
      ? 'microsoft-edge:' + url
      : url;
  return shellApi.openExternal(launchUrl);
}

module.exports = { openOutlookWebEmail, buildOutlookWebComposeUrl };
