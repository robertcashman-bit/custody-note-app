'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('PDF CJK font stack', () => {
  it('custody PDF HTML and print footer include CJK fallbacks', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(appJs, /PingFang SC/);
    assert.match(appJs, /Noto Sans CJK SC/);
    assert.match(mainJs, /Noto Sans CJK SC/);
    assert.match(appJs, /function pdfBodyFontStack\(/);
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
