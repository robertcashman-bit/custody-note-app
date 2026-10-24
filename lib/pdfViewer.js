'use strict';

/**
 * In-app PDF viewer — opens generated PDFs in a dedicated Electron window
 * (Chromium PDF via BrowserView) instead of the OS default handler.
 *
 * Ephemeral temp previews use cn-pdf-preview-* under the OS temp folder only;
 * those may be deleted when the viewer closes. Saved/desktop/mail-attachment
 * paths are never deleted automatically.
 *
 * BrowserView is deprecated in favour of WebContentsView in newer Electron;
 * we keep BrowserView for now to avoid a risky migration mid-feature.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { BrowserWindow, BrowserView, ipcMain, dialog, shell, app, session } = require('electron');
const { hardenWindow, ALLOWED_PERMISSIONS } = require('../main/windowHardening');
const { buildOutlookComposeEmlWithPdfAttachment } = require('./outlookComposeEml');
const {
  isAutomatedTestEnvActive,
  mayUsePackagedTestStubEnv,
} = require('./automatedTestBuild');

const TOOLBAR_HEIGHT = 52;
const PREVIEW_FILE_PREFIX = 'cn-pdf-preview-';
const MAIL_ATTACH_DIR_NAME = 'cn-pdf-mail-attachments';
/** In-memory session partition — must NOT use the default session (hardenSession CSP breaks PDF extension). */
const PDF_VIEWER_PARTITION = 'cn-pdf-viewer';
const CHROMIUM_PDF_EXTENSION_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';
const CHROMIUM_PDF_EXTENSION_PREFIX = 'chrome-extension://' + CHROMIUM_PDF_EXTENSION_ID;

let pdfViewerPartitionReady = false;

/** @type {Map<number, ViewerSession>} */
const viewerSessions = new Map();
let ipcRegistered = false;

/**
 * @typedef {object} ViewerSession
 * @property {string} filePath
 * @property {string} suggestedFilename
 * @property {string} [title]
 * @property {boolean} deleteOnClose
 * @property {boolean} userSaved
 * @property {boolean} dialogOpen
 * @property {{ to?: string, subject?: string, body?: string }} [emailCompose]
 * @property {import('electron').BrowserView} view
 * @property {import('electron').BrowserWindow} shellWindow
 */

function getAllowedPdfRoots() {
  const roots = [
    app.getPath('userData'),
    app.getPath('temp'),
  ];
  try { roots.push(app.getPath('desktop')); } catch (_) { /* ignore */ }
  try { roots.push(app.getPath('documents')); } catch (_) { /* ignore */ }
  return roots.map(function (r) {
    try { return fs.realpathSync(r); } catch (_) { return r; }
  });
}

function getTempDirReal() {
  try { return fs.realpathSync(app.getPath('temp')); } catch (_) {
    return app.getPath('temp');
  }
}

/**
 * True only for managed ephemeral preview files (temp + cn-pdf-preview- prefix).
 * @param {string} filePath
 */
function isManagedEphemeralPreviewPath(filePath) {
  const resolved = resolveAllowedPdfPath(filePath);
  if (!resolved) return false;
  const tempRoot = getTempDirReal();
  if (resolved !== tempRoot && !resolved.startsWith(tempRoot + path.sep)) return false;
  return path.basename(resolved).startsWith(PREVIEW_FILE_PREFIX);
}

/**
 * Resolve and validate a local PDF path for viewing / printing.
 * @param {string} filePath
 * @returns {string|null} realpath or null if disallowed / missing
 */
function resolveAllowedPdfPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;
  let resolved;
  try {
    resolved = fs.realpathSync(path.resolve(filePath.trim()));
  } catch (_) {
    return null;
  }
  if (path.extname(resolved).toLowerCase() !== '.pdf') return null;
  if (!fs.existsSync(resolved)) return null;
  const roots = getAllowedPdfRoots();
  const ok = roots.some(function (root) {
    return resolved === root || resolved.startsWith(root + path.sep);
  });
  return ok ? resolved : null;
}

function sanitizePdfFilename(name) {
  const base = path.basename(String(name || 'document.pdf')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  if (!base.toLowerCase().endsWith('.pdf')) return (base || 'document') + '.pdf';
  return base || 'document.pdf';
}

/**
 * Write a buffer to a temp preview file (tracked for cleanup).
 * @param {Buffer} buf
 * @param {string} [suggestedFilename]
 * @returns {string} absolute path
 */
function writeTempPreviewPdf(buf, suggestedFilename) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error('PDF buffer is empty');
  }
  const tempDir = app.getPath('temp');
  const safeLeaf = sanitizePdfFilename(suggestedFilename);
  const filePath = path.join(
    tempDir,
    PREVIEW_FILE_PREFIX + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '-' + safeLeaf
  );
  fs.writeFileSync(filePath, buf);
  return filePath;
}

function writePdfToDesktop(buf, suggestedFilename) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error('PDF buffer is empty');
  }
  const desktop = app.getPath('desktop');
  if (!fs.existsSync(desktop)) {
    throw new Error('Desktop folder does not exist.');
  }
  const safeName = sanitizePdfFilename(suggestedFilename);
  const outPath = path.join(desktop, safeName);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

function writePdfToMailAttachments(buf, suggestedFilename) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error('PDF buffer is empty');
  }
  const dir = path.join(app.getPath('userData'), MAIL_ATTACH_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const safeLeaf = sanitizePdfFilename(suggestedFilename);
  const filePath = path.join(
    dir,
    Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '-' + safeLeaf
  );
  fs.writeFileSync(filePath, buf);
  return filePath;
}

function cleanupStalePreviewPdfsOnStartup() {
  let tempDir;
  try { tempDir = app.getPath('temp'); } catch (_) { return; }
  let names;
  try { names = fs.readdirSync(tempDir); } catch (_) { return; }
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (typeof n !== 'string' || !n.startsWith(PREVIEW_FILE_PREFIX) || !n.toLowerCase().endsWith('.pdf')) continue;
    try { fs.unlinkSync(path.join(tempDir, n)); } catch (_) { /* locked or gone */ }
  }
}

function hardenWebContents(wc, appOrigin) {
  if (!wc) return;
  const pseudoWin = { webContents: wc };
  try {
    hardenWindow(pseudoWin, {
      logger: { warn: function (msg, meta) { console.warn(msg, meta || ''); } },
      appOrigin: appOrigin || '',
      shellOpenExternal: function () { return Promise.resolve(); },
    });
  } catch (_) { /* ignore */ }
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isAllowedPdfViewerRequestUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  const lower = url.trim().toLowerCase();
  if (lower.startsWith('file:')) return true;
  if (lower.startsWith(CHROMIUM_PDF_EXTENSION_PREFIX)) return true;
  if (lower.startsWith('data:')) return true;
  if (lower.startsWith('blob:')) return true;
  if (lower.startsWith('devtools:')) return true;
  if (lower.startsWith('about:')) return true;
  /* Chromium PDF internals (not network); required when using session webRequest filters. */
  if (lower.startsWith('chrome://')) return true;
  return false;
}

/**
 * Configure the isolated PDF viewer partition once (permissions only — no hardenSession / CSP injection).
 */
function ensurePdfViewerPartitionSession() {
  if (pdfViewerPartitionReady) return;
  pdfViewerPartitionReady = true;
  const ses = session.fromPartition(PDF_VIEWER_PARTITION);
  ses.setPermissionRequestHandler(function (_webContents, permission, callback) {
    const allowed = ALLOWED_PERMISSIONS.has(permission);
    if (!allowed) {
      console.warn('[pdf-viewer] Denied permission on viewer partition', { permission: permission });
    }
    try { callback(allowed); } catch (_) { /* ignore */ }
  });
  if (typeof ses.setPermissionCheckHandler === 'function') {
    ses.setPermissionCheckHandler(function (_wc, permission) {
      return ALLOWED_PERMISSIONS.has(permission);
    });
  }
  if (ses.webRequest && typeof ses.webRequest.onBeforeRequest === 'function') {
    /* Deny remote schemes; allowlist policy is enforced via isAllowedPdfViewerRequestUrl (unit-tested).
       Avoid <all_urls> cancel on file:/extension: — breaks Chromium PDF on some Electron builds. */
    ses.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ftp://*/*', 'ws://*/*', 'wss://*/*'] },
      function (details, callback) {
        console.warn('[pdf-viewer] Blocked remote request on viewer partition', { url: details.url });
        callback({ cancel: true });
      }
    );
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, function (details, callback) {
      const url = details.url || '';
      if (!url || isAllowedPdfViewerRequestUrl(url)) {
        callback({});
        return;
      }
      console.warn('[pdf-viewer] Blocked disallowed request on viewer partition', { url: url });
      callback({ cancel: true });
    });
  }
}

/**
 * @param {string} urlStr
 * @param {string} pdfFileUrl file:// URL of the loaded PDF
 */
function isAllowedPdfViewerPaneNavigation(urlStr, pdfFileUrl) {
  if (typeof urlStr !== 'string' || !urlStr) return false;
  if (urlStr === 'about:blank') return true;
  let parsed;
  try { parsed = new URL(urlStr); } catch (_) { return false; }
  if (parsed.protocol === 'chrome-extension:' && parsed.hostname === CHROMIUM_PDF_EXTENSION_ID) {
    return true;
  }
  if (parsed.protocol === 'file:') {
    const base = String(pdfFileUrl || '').split('#')[0];
    const target = urlStr.split('#')[0];
    return !!base && (target === base || urlStr.startsWith(base));
  }
  return false;
}

function hardenPdfViewerPane(wc, pdfFilePath) {
  if (!wc) return;
  const pdfFileUrl = pathToFileURL(pdfFilePath).href;
  const log = function (msg, meta) { console.warn(msg, meta || ''); };

  wc.on('will-navigate', function (event, urlStr) {
    if (!isAllowedPdfViewerPaneNavigation(urlStr, pdfFileUrl)) {
      event.preventDefault();
      log('[pdf-viewer] Blocked pane navigation', { url: urlStr.slice(0, 120) });
    }
  });
  wc.on('will-redirect', function (event, urlStr) {
    if (!isAllowedPdfViewerPaneNavigation(urlStr, pdfFileUrl)) {
      event.preventDefault();
      log('[pdf-viewer] Blocked pane redirect', { url: urlStr.slice(0, 120) });
    }
  });
  wc.setWindowOpenHandler(function () {
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', function (event) {
    event.preventDefault();
  });
}

function analyzeNativeImagePaint(image) {
  try {
    if (!image || image.isEmpty()) {
      return { distinctGreys: 0, nearWhiteRatio: 0, nearBlackRatio: 0 };
    }
    const size = image.getSize();
    const pixels = Math.max(1, size.width * size.height);
    const bitmap = image.toBitmap();
    const greys = new Set();
    let nearWhite = 0;
    let nearBlack = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      const b = bitmap[i];
      const g = bitmap[i + 1];
      const r = bitmap[i + 2];
      if (r >= 240 && g >= 240 && b >= 240) nearWhite++;
      if (r <= 30 && g <= 30 && b <= 30) nearBlack++;
      greys.add(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
    }
    return {
      distinctGreys: greys.size,
      nearWhiteRatio: nearWhite / pixels,
      nearBlackRatio: nearBlack / pixels,
    };
  } catch (_) {
    return { distinctGreys: 0, nearWhiteRatio: 0, nearBlackRatio: 0 };
  }
}

function captureShowsSyntheticPdfContent(stats) {
  return (
    stats.distinctGreys >= 20 &&
    stats.nearWhiteRatio >= 0.05 &&
    stats.nearBlackRatio >= 0.002
  );
}

function maybeStubPrintForTests(viewerSession) {
  if (process.env.CUSTODYNOTE_PDF_VIEWER_STUB_PRINT !== '1') return;
  if (!mayUsePackagedTestStubEnv()) return;
  if (!viewerSession || !viewerSession.view || viewerSession.view.webContents.isDestroyed()) return;
  const wc = viewerSession.view.webContents;
  viewerSession.printIsFunction = typeof wc.print === 'function';
  wc.print = function (_opts, callback) {
    viewerSession.printCallCount = (viewerSession.printCallCount || 0) + 1;
    if (typeof callback === 'function') callback(true, '');
  };
}

function getShellPaths() {
  const appRoot = app.getAppPath();
  return {
    shellHtml: path.join(appRoot, 'pdf-viewer-shell.html'),
    shellJs: path.join(appRoot, 'pdf-viewer-shell.js'),
    preload: path.join(appRoot, 'pdf-viewer-preload.js'),
  };
}

function layoutViewer(win, view) {
  if (!win || win.isDestroyed() || !view) return;
  const size = win.getContentSize();
  const w = size[0] || 960;
  const h = size[1] || 800;
  view.setBounds({
    x: 0,
    y: TOOLBAR_HEIGHT,
    width: w,
    height: Math.max(0, h - TOOLBAR_HEIGHT),
  });
}

function sessionForSender(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  return viewerSessions.get(win.id) || null;
}

function releaseEphemeralPdfIfNeeded(session) {
  if (!session || !session.filePath) return;
  if (!session.deleteOnClose) return;
  if (!isManagedEphemeralPreviewPath(session.filePath)) return;
  try { fs.unlinkSync(session.filePath); } catch (_) { /* ignore */ }
}

/**
 * Open Outlook with a PDF attached via .eml (single execution path).
 * @param {{ to?: string, subject?: string, body?: string, pdfPath: string, pdfFilename?: string, logTag?: string }} opts
 */
async function openOutlookWithPdfAttachment(opts) {
  const o = opts || {};
  const resolved = resolveAllowedPdfPath(o.pdfPath);
  if (!resolved) return { ok: false, error: 'PDF file not accessible' };
  const pdfBuf = fs.readFileSync(resolved);
  const attachName = sanitizePdfFilename(o.pdfFilename || path.basename(resolved));
  const subject = String(o.subject != null ? o.subject : attachName);
  const body = String(o.body != null ? o.body : ('Please find attached: ' + attachName));
  const to = String(o.to != null ? o.to : '').trim();
  const logTag = o.logTag || 'pdf-viewer-email';

  let emlPath;
  try {
    const draftsDir = path.join(app.getPath('userData'), 'outlook-drafts');
    fs.mkdirSync(draftsDir, { recursive: true });
    const stamp = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
    emlPath = path.join(draftsDir, 'pdf-draft-' + stamp + '.eml');
    const eml = buildOutlookComposeEmlWithPdfAttachment({
      to: to,
      subject: subject,
      body: body,
      attachmentFilename: attachName,
      attachmentBuffer: pdfBuf,
    });
    fs.writeFileSync(emlPath, eml, { encoding: 'utf8' });
    if (process.env.CUSTODYNOTE_PDF_VIEWER_STUB_EMAIL === '1' && mayUsePackagedTestStubEnv()) {
      console.info('[' + logTag + '] stub email — .eml written, shell.openPath skipped', { emlPath: emlPath });
      return { ok: true, openMethod: 'stub-eml', path: resolved, emlPath: emlPath };
    }
    if (isAutomatedTestEnvActive()) {
      try {
        const capturePath = path.join(String(process.env.CUSTODYNOTE_TEST_USERDATA), 'last-pdf-email-launch.json');
        fs.writeFileSync(capturePath, JSON.stringify({
          logTag,
          to,
          subject,
          body,
          pdfPath: resolved,
          pdfFilename: attachName,
          emlPath: emlPath,
          capturedAt: new Date().toISOString(),
        }), 'utf8');
        return { ok: true, openMethod: 'e2e-capture', path: resolved, emlPath: emlPath };
      } catch (capErr) {
        console.warn('[pdf-viewer-email] e2e capture failed', capErr && capErr.message);
      }
    }
    const openErr = await shell.openPath(emlPath);
    if (openErr) {
      try { fs.unlinkSync(emlPath); } catch (_) { /* ignore */ }
      return { ok: false, error: openErr };
    }
    setTimeout(function () {
      try { fs.unlinkSync(emlPath); } catch (_) { /* ignore */ }
    }, 5 * 60 * 1000).unref?.();
    console.info('[' + logTag + '] opened Outlook .eml with PDF attachment', { attachName: attachName });
    return { ok: true, openMethod: 'shell-openPath-eml', path: resolved };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn('[' + logTag + '] failed', msg);
    return { ok: false, error: msg };
  }
}

/**
 * @param {() => import('electron').BrowserWindow | null | undefined} getMainWindow
 */
function registerPdfViewerIpc(getMainWindow) {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('pdf-viewer-init', function (event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { error: 'No window' };
    const session = viewerSessions.get(win.id);
    if (!session) return { error: 'No PDF session' };
    return {
      ok: true,
      fileName: session.suggestedFilename,
      title: session.title || session.suggestedFilename,
      emailEnabled: true,
    };
  });

  ipcMain.handle('pdf-viewer-print', async function (event) {
    const session = sessionForSender(event);
    if (!session || !session.view || session.view.webContents.isDestroyed()) {
      return { error: 'PDF viewer not ready' };
    }
    if (typeof session.view.webContents.print !== 'function') {
      return { error: 'print is not available on PDF pane' };
    }
    await new Promise(function (resolve) {
      session.view.webContents.print({ silent: false, printBackground: true }, function (success, reason) {
        if (!success && reason !== 'cancelled') {
          console.error('[pdf-viewer] Print failed:', reason);
        }
        resolve();
      });
    });
    return { ok: true };
  });

  ipcMain.handle('pdf-viewer-save-as', async function (event) {
    const session = sessionForSender(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!session || !win) return { error: 'PDF viewer not ready' };
    const resolved = resolveAllowedPdfPath(session.filePath);
    if (!resolved) return { error: 'PDF file not accessible' };

    let defaultDir;
    try { defaultDir = app.getPath('documents'); } catch (_) {
      defaultDir = app.getPath('desktop');
    }
    session.dialogOpen = true;
    let result;
    try {
      result = await dialog.showSaveDialog(win, {
        title: 'Save PDF as',
        defaultPath: path.join(defaultDir, session.suggestedFilename),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
    } finally {
      session.dialogOpen = false;
    }
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    let dest = result.filePath;
    if (path.extname(dest).toLowerCase() !== '.pdf') dest += '.pdf';
    fs.copyFileSync(resolved, dest);
    session.userSaved = true;
    session.deleteOnClose = false;
    console.log('[pdf-viewer] Saved copy:', path.basename(dest));
    return { ok: true, path: dest };
  });

  ipcMain.handle('pdf-viewer-open-external', async function (event) {
    const session = sessionForSender(event);
    if (!session) return { error: 'PDF viewer not ready' };
    const resolved = resolveAllowedPdfPath(session.filePath);
    if (!resolved) return { error: 'PDF file not accessible' };
    session.deleteOnClose = false;
    const err = await shell.openPath(resolved);
    if (err) return { error: err };
    return { ok: true };
  });

  ipcMain.handle('pdf-viewer-email', async function (event) {
    const session = sessionForSender(event);
    if (!session) return { error: 'PDF viewer not ready' };
    session.deleteOnClose = false;
    const compose = session.emailCompose || {};
    const subject = compose.subject || session.suggestedFilename;
    const body = compose.body || ('Please find attached: ' + session.suggestedFilename);
    return openOutlookWithPdfAttachment({
      to: compose.to || '',
      subject: subject,
      body: body,
      pdfPath: session.filePath,
      pdfFilename: session.suggestedFilename,
      logTag: 'pdf-viewer-email',
    });
  });

  ipcMain.handle('pdf-viewer-e2e-inspect-pane', async function (event) {
    if (!isAutomatedTestEnvActive()) return { error: 'disabled' };
    const session = sessionForSender(event);
    if (!session || !session.view || session.view.webContents.isDestroyed()) {
      return { error: 'PDF viewer not ready' };
    }
    const wc = session.view.webContents;
    const deadline = Date.now() + 20000;
    let hasExt = false;
    let hasPdfFrame = false;
    const frameUrls = [];
    while (Date.now() < deadline) {
      hasExt = false;
      hasPdfFrame = false;
      frameUrls.length = 0;
      for (const f of wc.mainFrame.framesInSubtree) {
        const u = f.url || '';
        frameUrls.push(u);
        if (u.includes('chrome-extension://' + CHROMIUM_PDF_EXTENSION_ID)) hasExt = true;
        if (u.startsWith('file://') && u.toLowerCase().includes('.pdf')) hasPdfFrame = true;
      }
      if (hasExt && hasPdfFrame) break;
      await new Promise(function (r) { setTimeout(r, 200); });
    }
    if (!hasExt || !hasPdfFrame) {
      return { ok: false, error: 'PDF extension / embedded PDF frame not ready', hasExt: hasExt, hasPdfFrame: hasPdfFrame, frameUrls: frameUrls };
    }
    layoutViewer(session.shellWindow, session.view);
    const paintDeadline = Date.now() + 45000;
    let pngBase64 = '';
    let lastStats = { distinctGreys: 0, nearWhiteRatio: 0, nearBlackRatio: 0 };
    while (Date.now() < paintDeadline) {
      layoutViewer(session.shellWindow, session.view);
      const image = await wc.capturePage();
      lastStats = analyzeNativeImagePaint(image);
      if (captureShowsSyntheticPdfContent(lastStats)) {
        pngBase64 = image.toPNG().toString('base64');
        break;
      }
      await new Promise(function (r) { setTimeout(r, 400); });
    }
    if (!pngBase64) {
      const image = await wc.capturePage();
      lastStats = analyzeNativeImagePaint(image);
      pngBase64 = image.toPNG().toString('base64');
    }
    return {
      ok: true,
      hasExt: hasExt,
      hasPdfFrame: hasPdfFrame,
      frameUrls: frameUrls,
      pngBase64: pngBase64,
      distinctGreys: lastStats.distinctGreys,
      nearWhiteRatio: lastStats.nearWhiteRatio,
      nearBlackRatio: lastStats.nearBlackRatio,
      partition: typeof wc.session.getPartition === 'function' ? wc.session.getPartition() : '',
    };
  });

  ipcMain.handle('pdf-viewer-test-metrics', function (event) {
    if (!isAutomatedTestEnvActive()) return { error: 'disabled' };
    const session = sessionForSender(event);
    if (!session || !session.view) return { error: 'PDF viewer not ready' };
    return {
      ok: true,
      printCallCount: session.printCallCount || 0,
      printIsFunction: session.printIsFunction !== false,
      panePrintType: typeof session.view.webContents.print,
    };
  });

  ipcMain.handle('pdf-viewer-close', function (event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: true };
    const session = viewerSessions.get(win.id);
    if (session && session.dialogOpen) return { ok: false, error: 'Close the dialog first' };
    win.close();
    return { ok: true };
  });

  ipcMain.handle('open-outlook-with-pdf-attachment', async (_, payload) => {
    const p = payload || {};
    return openOutlookWithPdfAttachment({
      to: p.to,
      subject: p.subject,
      body: p.body,
      pdfPath: p.pdfPath || p.path,
      pdfFilename: p.filename || p.pdfFilename,
      logTag: 'open-outlook-with-pdf-attachment',
    });
  });
}

/**
 * Open the in-app PDF viewer for an existing file.
 * @param {object} options
 * @param {string} options.filePath
 * @param {string} [options.suggestedFilename]
 * @param {string} [options.title]
 * @param {boolean} [options.deleteOnClose] — only applies to cn-pdf-preview-* temp files
 * @param {{ to?: string, subject?: string, body?: string }} [options.emailCompose]
 * @param {() => import('electron').BrowserWindow | null | undefined} [options.getParentWindow]
 */
async function openPdfViewer(options) {
  const opts = options || {};
  const resolved = resolveAllowedPdfPath(opts.filePath);
  if (!resolved) throw new Error('PDF path not allowed or missing');

  const paths = getShellPaths();
  if (!fs.existsSync(paths.shellHtml) || !fs.existsSync(paths.preload)) {
    throw new Error('PDF viewer shell assets missing');
  }

  const shellOrigin = pathToFileURL(paths.shellHtml).href.replace(/[^/]+$/, '');
  const suggestedFilename = sanitizePdfFilename(opts.suggestedFilename || path.basename(resolved));
  const parent = (opts.getParentWindow && opts.getParentWindow()) || BrowserWindow.getFocusedWindow() || null;

  const win = new BrowserWindow({
    width: 960,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    title: opts.title || suggestedFilename,
    parent: parent || undefined,
    modal: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: paths.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  hardenWebContents(win.webContents, shellOrigin);
  ensurePdfViewerPartitionSession();

  const view = new BrowserView({
    webPreferences: {
      partition: PDF_VIEWER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  hardenPdfViewerPane(view.webContents, resolved);

  win.setBrowserView(view);
  view.setAutoResize({ width: true, height: true });
  layoutViewer(win, view);
  win.on('resize', function () { layoutViewer(win, view); });
  win.once('ready-to-show', function () { layoutViewer(win, view); });

  const wantsDelete = opts.deleteOnClose === true && isManagedEphemeralPreviewPath(resolved);

  /** @type {ViewerSession} */
  const session = {
    filePath: resolved,
    suggestedFilename: suggestedFilename,
    title: opts.title,
    deleteOnClose: wantsDelete,
    userSaved: false,
    dialogOpen: false,
    emailCompose: opts.emailCompose || null,
    view: view,
    shellWindow: win,
  };
  viewerSessions.set(win.id, session);
  maybeStubPrintForTests(session);

  win.on('close', function (e) {
    if (session.dialogOpen) {
      e.preventDefault();
    }
  });

  win.on('closed', function () {
    viewerSessions.delete(win.id);
    try {
      if (!win.isDestroyed()) win.removeBrowserView(view);
    } catch (_) { /* ignore */ }
    try {
      if (view.webContents && !view.webContents.isDestroyed()) view.webContents.close();
    } catch (_) { /* ignore */ }
    releaseEphemeralPdfIfNeeded(session);
  });

  await win.loadFile(paths.shellHtml);
  await view.webContents.loadFile(resolved);
  layoutViewer(win, view);

  console.log('[pdf-viewer] Opened', suggestedFilename);
  return { ok: true, path: resolved, viewerOpened: true };
}

module.exports = {
  PDF_VIEWER_PARTITION,
  CHROMIUM_PDF_EXTENSION_ID,
  PREVIEW_FILE_PREFIX,
  MAIL_ATTACH_DIR_NAME,
  TOOLBAR_HEIGHT,
  ensurePdfViewerPartitionSession,
  isAllowedPdfViewerPaneNavigation,
  isAllowedPdfViewerRequestUrl,
  resolveAllowedPdfPath,
  isManagedEphemeralPreviewPath,
  sanitizePdfFilename,
  writeTempPreviewPdf,
  writePdfToDesktop,
  writePdfToMailAttachments,
  cleanupStalePreviewPdfsOnStartup,
  registerPdfViewerIpc,
  openPdfViewer,
  openOutlookWithPdfAttachment,
};
