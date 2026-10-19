'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PDF_CJK_FONT_FAMILY, pdfBodyFontStack } = require('../lib/pdfBundledCjkFont');

describe('PDF CJK font stack', () => {
  it('bundled Noto family is first in pdfBodyFontStack', () => {
    const stack = pdfBodyFontStack();
    assert.ok(stack.startsWith("'" + PDF_CJK_FONT_FAMILY + "'"));
    assert.ok(stack.indexOf('PingFang SC') > stack.indexOf(PDF_CJK_FONT_FAMILY), 'system CJK fallbacks follow bundled font');
  });

  it('pdfBodyFontStack is wired into custody, telephone, and voluntary PDF builders', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const custodyStart = appJs.indexOf('function buildPdfHtml(');
    const custodyEnd = appJs.indexOf('function buildTelephonePdfHtml(', custodyStart);
    const custody = appJs.slice(custodyStart, custodyEnd);
    const telStart = appJs.indexOf('function buildTelephonePdfHtml(');
    const telEnd = appJs.indexOf('function buildVoluntaryPdfHtml(', telStart);
    const tel = appJs.slice(telStart, telEnd);
    const volStart = appJs.indexOf('function buildVoluntaryPdfHtml(');
    const volEnd = appJs.indexOf('function getActivePdfBuilder(', volStart);
    const vol = appJs.slice(volStart, volEnd);
    assert.match(custody, /pdfBodyFontStack\(\)/);
    assert.match(tel, /pdfBodyFontStack\(\)/);
    assert.match(vol, /pdfBodyFontStack\(\)/);
  });
});
