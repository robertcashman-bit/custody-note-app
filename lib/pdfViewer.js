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
const { BrowserWindow, BrowserView, ipcMain, dialog, shell, app } = require('electron');
const { hardenWindow } = require('../main/windowHardening');
const { buildOutlookComposeEmlWithPdfAttachment } = require('./outlookComposeEml');

const TOOLBAR_HEIGHT = 52;
const PREVIEW_FILE_PREFIX = 'cn-pdf-preview-';
const MAIL_ATTACH_DIR_NAME = 'cn-pdf-mail-attachments';

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

  if (process.env.CUSTODYNOTE_TEST_USERDATA) {
    try {
      const capturePath = path.join(String(process.env.CUSTODYNOTE_TEST_USERDATA), 'last-pdf-email-launch.json');
      fs.writeFileSync(capturePath, JSON.stringify({
        logTag,
        to,
        subject,
        body,
        pdfPath: resolved,
        pdfFilename: attachName,
        capturedAt: new Date().toISOString(),
      }), 'utf8');
      return { ok: true, openMethod: 'e2e-capture', path: resolved };
    } catch (capErr) {
      console.warn('[pdf-viewer-email] e2e capture failed', capErr && capErr.message);
    }
  }

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

  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  hardenWebContents(view.webContents, pathToFileURL(resolved).href);

  win.setBrowserView(view);
  layoutViewer(win, view);
  win.on('resize', function () { layoutViewer(win, view); });

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
  PREVIEW_FILE_PREFIX,
  MAIL_ATTACH_DIR_NAME,
  TOOLBAR_HEIGHT,
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
