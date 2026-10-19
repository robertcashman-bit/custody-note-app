'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  PDF_CJK_FONT_FAMILY,
  PDF_CJK_FONT_FILE,
  PDF_CJK_FONT_RELATIVE,
  resolveBundledPdfCjkFontPath,
  buildPdfCjkFontFaceCss,
  injectPdfCjkFontIntoHtml,
  pdfBodyFontStack,
} = require('../lib/pdfBundledCjkFont');

const root = path.join(__dirname, '..');
const fontPath = path.join(root, PDF_CJK_FONT_RELATIVE);
const licensePath = path.join(root, 'resources', 'fonts', 'OFL.txt');

describe('pdfBundledCjkFont packaging', () => {
  it('ships Noto Sans SC subset and OFL licence in resources/fonts', () => {
    assert.ok(fs.existsSync(fontPath), 'missing ' + PDF_CJK_FONT_RELATIVE);
    const bytes = fs.statSync(fontPath).size;
    assert.ok(bytes > 1_000_000 && bytes < 20 * 1024 * 1024, 'unexpected font size: ' + bytes);
    assert.ok(fs.existsSync(licensePath), 'missing OFL.txt');
    assert.match(fs.readFileSync(licensePath, 'utf8'), /Open Font License/i);
  });

  it('electron-builder unpacks resources/fonts for packaged @font-face', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const unpack = (pkg.build && pkg.build.asarUnpack) || [];
    assert.ok(unpack.some((g) => /resources\/fonts/.test(String(g))));
  });

  it('main.js injects cn-pdf-cjk-font and waits on document.fonts.ready', () => {
    const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    assert.match(mainJs, /injectPdfCjkFontIntoHtml/);
    assert.match(mainJs, /document\.fonts\.ready/);
    assert.match(mainJs, /getBundledPdfCjkFontFileUrl/);
  });
});

describe('pdfBundledCjkFont HTML', () => {
  it('buildPdfHtml references bundled family before system UI fonts', () => {
    const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    assert.match(appJs, /PdfBundledCjkFont/);
    const stack = pdfBodyFontStack();
    assert.ok(stack.indexOf(PDF_CJK_FONT_FAMILY) < stack.indexOf('Segoe UI'));
    assert.match(appJs, /Custody Note Noto SC/);
  });

  it('injects @font-face with woff2 URL into PDF HTML head', () => {
    const url = pathToFileURL(fontPath).href;
    const css = buildPdfCjkFontFaceCss(url);
    assert.match(css, /@font-face/);
    assert.match(css, /woff2/);
    assert.match(css, new RegExp(PDF_CJK_FONT_FAMILY));

    const html = injectPdfCjkFontIntoHtml(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>测试</body></html>',
      url
    );
    assert.match(html, /id="cn-pdf-cjk-font"/);
    assert.match(html, /format\("woff2"\)/);
    assert.match(html, new RegExp(PDF_CJK_FONT_FILE));
  });

  it('index.html loads pdfBundledCjkFont.js before app.js', () => {
    const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const bundledIdx = index.indexOf('lib/pdfBundledCjkFont.js');
    const appIdx = index.indexOf('<script src="app.js">');
    assert.ok(bundledIdx >= 0 && appIdx > bundledIdx);
  });
});

describe('pdfBundledCjkFont path resolution', () => {
  it('resolves dev and packaged unpacked paths', () => {
    const dev = resolveBundledPdfCjkFontPath({ isPackaged: false, appRoot: root });
    assert.equal(dev, fontPath);
    const packed = resolveBundledPdfCjkFontPath({
      isPackaged: true,
      resourcesPath: '/Applications/Custody Note.app/Contents/Resources',
    });
    assert.match(packed, /app\.asar\.unpacked[\\/]resources[\\/]fonts[\\/]NotoSansSC-Subset\.woff2$/);
  });
});
