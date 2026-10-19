'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PROBE_CHARS = '测试李王陈黄林马中';
const fontPath = path.join(__dirname, '..', 'resources', 'fonts', 'NotoSansSC-Subset.woff2');
const coveragePath = path.join(__dirname, '..', 'resources', 'fonts', 'subset-coverage-probes.json');

describe('PDF CJK font cmap coverage', () => {
  it('woff2 cmap includes probe characters (测 试 李 王 陈 黄 林 马 中)', () => {
    assert.ok(fs.existsSync(fontPath), 'missing bundled woff2');
    let fontkit;
    try {
      fontkit = require('fontkit');
    } catch (e) {
      assert.fail('fontkit devDependency required for cmap test: ' + (e && e.message));
    }
    const font = fontkit.openSync(fontPath);
    const missing = [];
    for (let i = 0; i < PROBE_CHARS.length; i++) {
      const ch = PROBE_CHARS[i];
      const cp = ch.codePointAt(0);
      const glyph = font.glyphForCodePoint(cp);
      if (!glyph || glyph.id === 0) missing.push(ch + ' U+' + cp.toString(16));
    }
    assert.equal(missing.length, 0, 'missing glyphs: ' + missing.join(', '));
  });

  it('build script checked probes into subset-coverage-probes.json', () => {
    assert.ok(fs.existsSync(coveragePath), 'run npm run build:pdf-cjk-font to generate coverage manifest');
    const data = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
    assert.deepEqual(data.probes.join(''), PROBE_CHARS);
    for (let i = 0; i < PROBE_CHARS.length; i++) {
      assert.equal(data.codepoints[i], PROBE_CHARS.codePointAt(i));
    }
    assert.ok(data.fontBytes >= fs.statSync(fontPath).size * 0.99);
  });
});
