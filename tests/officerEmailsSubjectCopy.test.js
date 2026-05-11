/**
 * Officer Emails — Copy Subject entry-points (hero + inline buttons).
 *
 * Regression cover for the "I cannot copy the subject easily" user request:
 *   • Big hero "Copy Subject" button alongside "Copy Email Body".
 *   • Inline "Copy" button next to the Compose Subject input.
 *   • Inline "Copy" button next to the Preview Subject value.
 *
 * Stays inside the v1.6.21 copy-and-paste-only design — none of these buttons
 * may launch Outlook/window.open or call openEmailDraft.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const EMAIL_COMPOSE_LIB = require(path.join(ROOT, 'lib', 'emailComposeDraft.js'));
const EMAIL_COPY_SRC = fs.readFileSync(path.join(ROOT, 'renderer', 'emailCopy.js'), 'utf8');
const EMAIL_PENDING_SRC = fs.readFileSync(path.join(ROOT, 'renderer', 'email-pending-globals.js'), 'utf8');
const OFFICER_EMAILS_SRC = fs.readFileSync(path.join(ROOT, 'renderer', 'officerEmails.js'), 'utf8');

function evalRendererInWindow(window, source) {
  new Function('window', 'document', source)(window, window.document);
}

function bootDom() {
  const dom = new JSDOM(INDEX_HTML, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.CustodyEmailCompose = EMAIL_COMPOSE_LIB;
  const opens = [];
  try { delete window.location; } catch (_) { /* noop */ }
  try {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'http://localhost/' },
    });
  } catch (_) { /* noop */ }
  window.open = function (url) { opens.push(String(url || '')); return {}; };
  window.navigator.clipboard = {
    writeText: async (t) => { window.__lastClipboard = String(t); return undefined; },
  };
  window.isSecureContext = true;
  evalRendererInWindow(window, EMAIL_COPY_SRC);
  evalRendererInWindow(window, EMAIL_PENDING_SRC);
  evalRendererInWindow(window, OFFICER_EMAILS_SRC);
  window.OfficerEmails.init();
  return { window, opens };
}

function id(window, x) { return window.document.getElementById(x); }
function click(window, x) {
  const el = id(window, x);
  assert.ok(el, 'expected #' + x + ' in DOM');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
async function flush() { await new Promise((r) => setImmediate(r)); }

function fillBasicCase(window) {
  id(window, 'officerEmailInput').value = 'officer.fisher@police.uk';
  id(window, 'officerRankInput').value = 'DC';
  id(window, 'officerSurnameInput').value = 'Fisher';
  id(window, 'policeStationOrUnitInput').value = 'Kent Police';
  id(window, 'attendanceDateInput').value = '2026-04-30';
  id(window, 'clientNameInput').value = 'Jane Smith';
  id(window, 'matterInput').value = 'Assault';
}

describe('Officer Emails — Copy Subject entry-points (hero + inline)', () => {
  it('hero "Copy Subject" button is rendered and copies the generated subject', async () => {
    const { window } = bootDom();
    const heroBtn = id(window, 'officerHeroCopySubjectBtn');
    assert.ok(heroBtn, 'hero Copy Subject button must exist alongside Copy Email Body');
    fillBasicCase(window);
    click(window, 'officerGenerateBtn');
    click(window, 'officerHeroCopySubjectBtn');
    await flush();
    assert.ok(
      (window.__lastClipboard || '').includes('Jane Smith'),
      'clipboard should receive the subject (with the client name merged in)'
    );
  });

  it('inline Compose Copy button next to the Subject input copies the subject', async () => {
    const { window } = bootDom();
    const inlineBtn = id(window, 'officerInlineCopySubjectBtn');
    assert.ok(inlineBtn, 'inline Copy button next to the Compose Subject input must exist');
    fillBasicCase(window);
    click(window, 'officerGenerateBtn');
    click(window, 'officerInlineCopySubjectBtn');
    await flush();
    assert.ok((window.__lastClipboard || '').includes('Jane Smith'));
  });

  it('inline Preview Copy button next to the Subject value copies the subject', async () => {
    const { window } = bootDom();
    const previewBtn = id(window, 'officerInlineCopySubjectPreviewBtn');
    assert.ok(previewBtn, 'inline Copy button on Preview tab next to Subject must exist');
    fillBasicCase(window);
    click(window, 'officerGenerateBtn');
    click(window, 'officerInlineCopySubjectPreviewBtn');
    await flush();
    assert.ok((window.__lastClipboard || '').includes('Jane Smith'));
  });

  it('all subject-copy buttons are disabled when the subject is blank', () => {
    const { window } = bootDom();
    const ids = [
      'officerCopySubjectBtn',
      'officerCopySubjectPreviewBtn',
      'officerHeroCopySubjectBtn',
      'officerInlineCopySubjectBtn',
      'officerInlineCopySubjectPreviewBtn',
    ];
    ids.forEach((bid) => {
      const el = id(window, bid);
      assert.ok(el, '#' + bid + ' must exist');
      assert.strictEqual(el.disabled, true, '#' + bid + ' should be disabled when subject is empty');
    });
  });

  it('subject-copy entry-points never call window.open and never navigate', async () => {
    const { window, opens } = bootDom();
    fillBasicCase(window);
    click(window, 'officerGenerateBtn');
    click(window, 'officerHeroCopySubjectBtn');
    click(window, 'officerInlineCopySubjectBtn');
    click(window, 'officerInlineCopySubjectPreviewBtn');
    await flush();
    assert.strictEqual(opens.length, 0, 'subject copy must never open a window/tab');
    assert.strictEqual(window.location.href, 'http://localhost/', 'subject copy must not navigate');
  });
});
