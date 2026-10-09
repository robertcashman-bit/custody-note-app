'use strict';

/**
 * The open note's saved/sync status ("Saved on this computer, sync pending" etc.)
 * must render exactly once: on the Save & Sync button at the right end of the
 * top bar. Before 1.9.113 it also appeared in the header text, the form header,
 * the footer and the summary panel at the same time.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function fnBody(name) {
  const start = appJs.indexOf('function ' + name + '(');
  assert.ok(start > 0, name + ' exists');
  let depth = 0;
  for (let i = appJs.indexOf('{', start); i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}') { depth--; if (depth === 0) return appJs.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

describe('sync status shows exactly once (Save & Sync button)', () => {
  it('the duplicate status slots are gone from the markup', () => {
    assert.doesNotMatch(indexHtml, /id="header-autosave"/);
    assert.doesNotMatch(indexHtml, /id="footer-autosave"/);
    assert.doesNotMatch(indexHtml, /id="footer-autosave-wrap"/);
    const dom = new JSDOM(indexHtml);
    const header = dom.window.document.querySelector('header.app-header');
    const right = header.querySelector('.header-right');
    const btn = right.querySelector('#header-backup-now-btn');
    assert.ok(btn, 'Save & Sync button in the top bar');
    assert.equal(right.lastElementChild, btn, 'Save & Sync is at the right end of the top bar');
    assert.equal(header.querySelectorAll('.autosave-indicator').length, 0, 'no second status text in the top bar');
  });

  it('save/autosave code paths write status only to the Save & Sync button', () => {
    for (const name of ['showAutoSaveIndicator', 'showSavingIndicator']) {
      const body = fnBody(name);
      assert.match(body, /applySaveSyncButton\(/, name + ' drives the button');
      assert.doesNotMatch(body, /header-autosave|footer-autosave|'autosave-indicator'/, name + ' must not write a second copy');
      assert.doesNotMatch(body, /sync pending|pending central sync/i, name + ' must not repeat sync wording');
    }
    assert.doesNotMatch(appJs, /header-autosave|footer-autosave/);
    assert.doesNotMatch(appJs, /pending central sync/);
  });

  it('autosave failure is still visible (on the button), never silent', () => {
    const qs = fnBody('quietSave');
    const catchIdx = qs.indexOf('.catch(');
    const chunk = qs.slice(catchIdx, catchIdx + 900);
    assert.match(chunk, /showToast\('Auto-save failed/);
    assert.match(chunk, /applySaveSyncButton\(\{[\s\S]*noteDurable: false/);
  });

  it('dirty state stays visible on the button', () => {
    const body = fnBody('showAutoSaveIndicator');
    assert.match(body, /dirty: dirty/);
    assert.match(fnBody('markFormDirtyForDiskIndicator'), /dirty: true/);
  });

  it('the summary panel shows the last local save time without sync wording', () => {
    const body = fnBody('showAutoSaveIndicator');
    assert.match(body, /form-last-saved/);
    assert.match(body, /'Saved on this computer ' \+/);
    assert.doesNotMatch(body, /Safe locally/);
  });
});
