'use strict';

/**
 * Bundled Noto Sans SC subset for PDF rendering (CJK in printToPDF on macOS/Windows).
 * Dual-export: Node (main + tests) and renderer <script> (window.PdfBundledCjkFont).
 */

const path = require('path');

const PDF_CJK_FONT_FAMILY = 'Custody Note Noto SC';
const PDF_CJK_FONT_FILE = 'NotoSansSC-Subset.woff2';
const PDF_CJK_FONT_RELATIVE = path.join('resources', 'fonts', PDF_CJK_FONT_FILE);
const PDF_CJK_LICENSE_RELATIVE = path.join('resources', 'fonts', 'OFL.txt');

function pdfBodyFontStackInner() {
  return (
    "'" + PDF_CJK_FONT_FAMILY + "','Segoe UI','Helvetica Neue'," +
    "'PingFang SC','Hiragino Sans','Microsoft YaHei','Noto Sans CJK SC',Arial,sans-serif"
  );
}

/**
 * Resolve bundled font path for dev (repo root) or packaged app (asar.unpacked).
 *
 * @param {{ isPackaged?: boolean, appRoot?: string, resourcesPath?: string }} ctx
 */
function resolveBundledPdfCjkFontPath(ctx) {
  const isPackaged = !!(ctx && ctx.isPackaged);
  const appRoot = (ctx && ctx.appRoot) || path.join(__dirname, '..');
  const resourcesPath = (ctx && ctx.resourcesPath) || appRoot;
  if (isPackaged) {
    return path.join(resourcesPath, 'app.asar.unpacked', PDF_CJK_FONT_RELATIVE);
  }
  return path.join(appRoot, PDF_CJK_FONT_RELATIVE);
}

function buildPdfCjkFontFaceCss(fileUrl) {
  const url = String(fileUrl || '').trim();
  if (!url) return '';
  return (
    '@font-face{font-family:' + JSON.stringify(PDF_CJK_FONT_FAMILY) + ';' +
    'font-style:normal;font-weight:400;font-display:swap;' +
    "src:url(" + JSON.stringify(url) + ') format("woff2");}'
  );
}

function pdfBodyFontStack() {
  return pdfBodyFontStackInner();
}

function injectPdfCjkFontIntoHtml(html, fileUrl) {
  const css = buildPdfCjkFontFaceCss(fileUrl);
  if (!css) return html;
  const block = '<style id="cn-pdf-cjk-font">' + css + '</style>';
  const src = String(html || '');
  if (src.includes('id="cn-pdf-cjk-font"')) return src;
  const headClose = src.indexOf('</head>');
  if (headClose >= 0) {
    return src.slice(0, headClose) + block + src.slice(headClose);
  }
  return block + src;
}

const api = {
  PDF_CJK_FONT_FAMILY,
  PDF_CJK_FONT_FILE,
  PDF_CJK_FONT_RELATIVE,
  PDF_CJK_LICENSE_RELATIVE,
  resolveBundledPdfCjkFontPath,
  buildPdfCjkFontFaceCss,
  pdfBodyFontStack,
  injectPdfCjkFontIntoHtml,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.PdfBundledCjkFont = {
    PDF_CJK_FONT_FAMILY: PDF_CJK_FONT_FAMILY,
    pdfBodyFontStack: pdfBodyFontStackInner,
  };
}
