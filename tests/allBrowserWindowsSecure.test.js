'use strict';

/**
 * Every BrowserWindow (and BrowserView) must use hardened webPreferences.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['main.js', 'lib/pdfViewer.js'];

function splitBrowserWindowBlocks(src) {
  const blocks = [];
  const re = /new BrowserWindow\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length - 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      i += 1;
    }
    blocks.push(src.slice(m.index, i));
  }
  return blocks;
}

function splitBrowserViewBlocks(src) {
  const blocks = [];
  const re = /new BrowserView\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length - 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      i += 1;
    }
    blocks.push(src.slice(m.index, i));
  }
  return blocks;
}

function assertSecureWebPreferences(block, label) {
  assert.match(block, /webPreferences\s*:/, label + ' must declare webPreferences');
  assert.match(block, /contextIsolation\s*:\s*true/, label + ' contextIsolation');
  assert.match(block, /nodeIntegration\s*:\s*false/, label + ' nodeIntegration');
  assert.match(block, /sandbox\s*:\s*true/, label + ' sandbox');
  assert.match(block, /webSecurity\s*:\s*true/, label + ' webSecurity');
}

describe('BrowserWindow / BrowserView webPreferences', () => {
  for (const rel of FILES) {
    it(rel + ' — all BrowserWindow instances are hardened', () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const blocks = splitBrowserWindowBlocks(src);
      assert.ok(blocks.length > 0, rel + ' should contain at least one BrowserWindow');
      blocks.forEach((b, idx) => assertSecureWebPreferences(b, `${rel} BrowserWindow #${idx + 1}`));
    });
  }

  it('lib/pdfViewer.js — PDF BrowserView pane is hardened', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/pdfViewer.js'), 'utf8');
    const blocks = splitBrowserViewBlocks(src);
    assert.ok(blocks.length > 0, 'pdfViewer should use BrowserView');
    blocks.forEach((b, idx) => assertSecureWebPreferences(b, `pdfViewer BrowserView #${idx + 1}`));
  });
});
