/**
 * Officer Emails — Manage templates… modal integration (jsdom).
 *
 * Proves that the Compose Template <select> is sourced from
 * OfficerEmailTemplatesStore (no hard-wired runtime list), the manage
 * button opens the modal, and CRUD operations from the modal flow back
 * into the dropdown without re-introducing any Outlook launch surface.
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
const STORE_SRC = fs.readFileSync(path.join(ROOT, 'renderer', 'officerEmailTemplatesStore.js'), 'utf8');
const MANAGER_SRC = fs.readFileSync(path.join(ROOT, 'renderer', 'officerEmailTemplatesManager.js'), 'utf8');
const COPY_SRC = fs.readFileSync(path.join(ROOT, 'renderer', 'emailCopy.js'), 'utf8');
const PENDING_SRC = fs.readFileSync(path.join(ROOT, 'renderer', 'email-pending-globals.js'), 'utf8');
const OFFICER_EMAILS_SRC = fs.readFileSync(path.join(ROOT, 'renderer', 'officerEmails.js'), 'utf8');

function evalIn(window, src) {
  /* Use the JSDOM window's own eval so global declarations inside an IIFE land on it.
     `new Function('window', 'document', src)` chokes when it sees certain ES2017+
     constructs (object spread / async etc.) under jsdom 29; window.eval does not. */
  if (typeof window.eval === 'function') { window.eval(src); return; }
  // Fallback for older jsdom.
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', src)(window, window.document);
}

function boot() {
  const dom = new JSDOM(INDEX_HTML, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.CustodyEmailCompose = EMAIL_COMPOSE_LIB;
  window._appSettingsCache = {};
  const opens = [];
  try { delete window.location; } catch (_) { /* noop */ }
  try {
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { href: 'http://localhost/' } });
  } catch (_) { /* noop */ }
  window.open = function (url) { opens.push(String(url || '')); return {}; };
  window.confirm = function () { return true; };
  window.navigator.clipboard = {
    writeText: async (t) => { window.__lastClipboard = String(t); return undefined; },
  };
  window.isSecureContext = true;
  evalIn(window, STORE_SRC);
  evalIn(window, MANAGER_SRC);
  evalIn(window, COPY_SRC);
  evalIn(window, PENDING_SRC);
  evalIn(window, OFFICER_EMAILS_SRC);
  window.OfficerEmails.init();
  return { window, opens };
}

function id(window, x) { return window.document.getElementById(x); }
function click(window, x) {
  const el = id(window, x);
  assert.ok(el, '#' + x + ' should exist');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
async function flush() { await new Promise((r) => setImmediate(r)); }

describe('Officer Emails — user-editable templates (no hard-wired runtime list)', () => {
  it('exposes the user-editable store on window', () => {
    const { window } = boot();
    assert.ok(window.OfficerEmailTemplatesStore, 'store global should exist');
    assert.ok(typeof window.OfficerEmailTemplatesStore.list === 'function');
    assert.ok(typeof window.openOfficerEmailTemplatesManager === 'function', 'manager opener exposed');
    assert.strictEqual(window.OfficerEmailTemplatesStore.list().length, 4, 'four built-ins seeded by init');
  });

  it('Compose <select> is rebuilt from the store after init (not from the hard-coded HTML options)', () => {
    const { window } = boot();
    const sel = id(window, 'officerTemplateSelect');
    const options = Array.from(sel.options).map((o) => o.value).sort();
    assert.deepStrictEqual(
      options,
      ['confirm_representation', 'followup_after_rui', 'request_bail_details', 'request_interview_recording'].sort()
    );
  });

  it('clicking Manage templates… opens the modal', () => {
    const { window } = boot();
    click(window, 'officerManageTemplatesBtn');
    const overlay = id(window, 'officer-tpl-manager-overlay');
    assert.ok(overlay, 'manager overlay must mount');
    const newBtn = id(window, 'officerTplMgrNewBtn');
    assert.ok(newBtn, 'New button visible');
  });

  it('saving a NEW template via the modal updates the dropdown and persists to settings', () => {
    const { window } = boot();
    click(window, 'officerManageTemplatesBtn');
    click(window, 'officerTplMgrNewBtn');
    id(window, 'officerTplMgrName').value = 'Bail variation chase';
    id(window, 'officerTplMgrSubject').value = '{{clientName}} - Bail variation';
    id(window, 'officerTplMgrBody').value = 'Dear {{officerRank}} {{officerSurname}},\n\nPlease confirm.';
    click(window, 'officerTplMgrSaveBtn');

    const sel = id(window, 'officerTemplateSelect');
    const names = Array.from(sel.options).map((o) => o.text);
    assert.ok(names.indexOf('Bail variation chase') >= 0, 'new template appears in dropdown: ' + names.join(','));
    assert.strictEqual(window.OfficerEmailTemplatesStore.list().length, 5);
    assert.ok(window._appSettingsCache.customOfficerEmailTemplatesJson, 'persisted to settings cache');
  });

  it('editing an existing template via the modal changes the rendered subject/body in the dropdown flow', async () => {
    const { window } = boot();
    click(window, 'officerManageTemplatesBtn');

    // Click the first list item (request_bail_details).
    const item = window.document.querySelector('#officerTplMgrList .officer-tpl-mgr-item[data-key="request_bail_details"]');
    assert.ok(item, 'list shows request_bail_details');
    item.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    id(window, 'officerTplMgrName').value = 'Bail (custom)';
    id(window, 'officerTplMgrSubject').value = '{{clientName}} - Custom bail subject';
    id(window, 'officerTplMgrBody').value = 'Dear {{officerRank}} {{officerSurname}},\n\nCustom body for {{clientName}}.';
    click(window, 'officerTplMgrSaveBtn');

    // Close manager and verify dropdown text reflects edit.
    click(window, 'officerTplMgrCloseBtn');
    const sel = id(window, 'officerTemplateSelect');
    sel.value = 'request_bail_details';
    sel.dispatchEvent(new window.Event('change'));

    // Generate from the edited template and check the new subject/body land.
    id(window, 'clientNameInput').value = 'Pat Tester';
    id(window, 'officerSurnameInput').value = 'Fisher';
    id(window, 'officerRankInput').value = 'DC';
    click(window, 'officerGenerateBtn');
    await flush();
    assert.strictEqual(id(window, 'officerSubjectInput').value, 'Pat Tester - Custom bail subject');
    assert.ok(id(window, 'officerBodyInput').value.indexOf('Custom body for Pat Tester') >= 0);
  });

  it('deleting a template removes it from the dropdown and Restore defaults brings it back', async () => {
    const { window } = boot();
    // Delete via the store directly (manager invokes the same path with confirm()).
    window.OfficerEmailTemplatesStore.delete('confirm_representation');
    const sel1 = id(window, 'officerTemplateSelect');
    await flush();
    assert.ok(!Array.from(sel1.options).some((o) => o.value === 'confirm_representation'), 'gone after delete');

    // Restore defaults adds it back.
    window.OfficerEmailTemplatesStore.restoreDefaults();
    await flush();
    const sel2 = id(window, 'officerTemplateSelect');
    assert.ok(Array.from(sel2.options).some((o) => o.value === 'confirm_representation'), 'returned after restoreDefaults');
  });

  it('manager workflow never opens a window/tab and never navigates location', async () => {
    const { window, opens } = boot();
    click(window, 'officerManageTemplatesBtn');
    click(window, 'officerTplMgrNewBtn');
    id(window, 'officerTplMgrName').value = 'X';
    id(window, 'officerTplMgrSubject').value = '{{clientName}}';
    id(window, 'officerTplMgrBody').value = 'Body';
    click(window, 'officerTplMgrSaveBtn');
    click(window, 'officerTplMgrCloseBtn');
    assert.strictEqual(opens.length, 0);
    assert.strictEqual(window.location.href, 'http://localhost/');
  });
});
