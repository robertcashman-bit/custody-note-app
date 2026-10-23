'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'main.js');
const PRELOAD = path.join(ROOT, 'preload.js');
const LIB = path.join(ROOT, 'lib', 'pdfViewer.js');

function extractHandlerBlock(src, channel) {
  const needle = "ipcMain.handle('" + channel + "'";
  const start = src.indexOf(needle);
  assert.ok(start >= 0, 'handler ' + channel + ' not found');
  const next = src.indexOf("ipcMain.handle(", start + needle.length);
  return next >= 0 ? src.slice(start, next) : src.slice(start, start + 4000);
}

describe('pdfViewer module', () => {
  it('exports core helpers', () => {
    assert.ok(fs.existsSync(LIB), 'lib/pdfViewer.js missing');
    const mod = require(LIB);
    assert.strictEqual(typeof mod.sanitizePdfFilename, 'function');
    assert.strictEqual(typeof mod.resolveAllowedPdfPath, 'function');
    assert.strictEqual(typeof mod.openPdfViewer, 'function');
  });

  it('sanitizePdfFilename strips unsafe characters and enforces .pdf', () => {
    const { sanitizePdfFilename } = require(LIB);
    assert.strictEqual(sanitizePdfFilename('client<>note.pdf'), 'client__note.pdf');
    assert.strictEqual(sanitizePdfFilename('noext'), 'noext.pdf');
    assert.strictEqual(sanitizePdfFilename(''), 'document.pdf');
  });

  it('isManagedEphemeralPreviewPath only matches cn-pdf-preview temp files', () => {
    const { isManagedEphemeralPreviewPath, PREVIEW_FILE_PREFIX } = require(LIB);
    assert.ok(PREVIEW_FILE_PREFIX.startsWith('cn-pdf-preview-'));
    assert.strictEqual(isManagedEphemeralPreviewPath('/etc/passwd.pdf'), false);
    assert.strictEqual(isManagedEphemeralPreviewPath(''), false);
  });
});

describe('Generated PDF preview IPC (source)', () => {
  it('preview-pdf-base64 opens in-app viewer, not shell.openPath', () => {
    const src = fs.readFileSync(MAIN, 'utf8');
    const block = extractHandlerBlock(src, 'preview-pdf-base64');
    assert.ok(block.includes('openPdfViewer'), 'must call openPdfViewer');
    assert.ok(!block.includes('shell.openPath'), 'must not shell.openPath generated previews');
  });

  it('preview-pdf-from-html opens in-app viewer', () => {
    const src = fs.readFileSync(MAIN, 'utf8');
    const block = extractHandlerBlock(src, 'preview-pdf-from-html');
    assert.ok(block.includes('openPdfViewer'), 'must call openPdfViewer');
    assert.ok(!block.includes('shell.openPath'), 'must not shell.openPath generated previews');
  });

  it('preload exposes openPdfViewer API', () => {
    const preload = fs.readFileSync(PRELOAD, 'utf8');
    assert.ok(preload.includes("invoke('open-pdf-viewer'"), 'preload must expose openPdfViewer');
    assert.ok(preload.includes("invoke('save-pdf-base64'"), 'preload must expose savePdfBase64');
  });

  it('open-pdf-viewer only deletes when deleteOnClose is explicitly true', () => {
    const src = fs.readFileSync(MAIN, 'utf8');
    const block = extractHandlerBlock(src, 'open-pdf-viewer');
    assert.ok(block.includes('deleteOnClose: deleteOnClose === true'), 'deleteOnClose must default false');
  });

  it('viewer shell assets exist', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'pdf-viewer-shell.html')));
    assert.ok(fs.existsSync(path.join(ROOT, 'pdf-viewer-shell.js')));
    assert.ok(fs.existsSync(path.join(ROOT, 'pdf-viewer-preload.js')));
  });
});
