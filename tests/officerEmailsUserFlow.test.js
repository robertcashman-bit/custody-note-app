/**
 * User-flow tests for Officer Emails — fill details, generate from template,
 * then use the hero "Open in Outlook Web" button (quick path: officerOpenOutlookHeroBtn).
 *
 * Mocks the preload bridge (emailAPI.open / invokeOutlookWebCompose) so no real browser opens.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const OUTLOOK_INVOKE_SRC = fs.readFileSync(path.join(ROOT, 'renderer', 'outlook-email-invoke.js'), 'utf8');
const OFFICER_EMAILS_SRC = fs.readFileSync(path.join(ROOT, 'renderer', 'officerEmails.js'), 'utf8');

/**
 * Load renderer scripts with real window/document globals (same pattern as vm tests).
 * officerEmails.js waits for DOMContentLoaded when readyState === 'loading'; jsdom may not
 * replay that after programmatic evaluation, so we call OfficerEmails.init() explicitly.
 */
function evalRendererInWindow(window, source) {
  new Function('window', 'document', source)(window, window.document);
}

function bootOfficerEmailsDom() {
  const dom = new JSDOM(INDEX_HTML, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  /* Minimal stubs — officerEmails init touches these */
  window.confirm = () => false;
  const opens = [];
  window.emailAPI = {
    detectOutlookDesktop: () => Promise.resolve({ installed: false }),
    open: (payload) => {
      opens.push(payload);
      return Promise.resolve({ ok: true, launchMethod: 'shell', accountType: 'work' });
    },
  };
  evalRendererInWindow(window, OUTLOOK_INVOKE_SRC);
  evalRendererInWindow(window, OFFICER_EMAILS_SRC);
  window.OfficerEmails.init();
  return { dom, window, opens };
}

function byId(window, id) {
  return window.document.getElementById(id);
}

function click(window, id) {
  const el = byId(window, id);
  assert.ok(el, 'missing #' + id);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function flushPromises() {
  await new Promise((r) => setImmediate(r));
}

describe('Officer Emails — quick hero compose (user flow)', () => {
  it('fills details, generates template, hero Open sends invokeOutlookWebCompose payload (Edge InPrivate)', async () => {
    const { window, opens } = bootOfficerEmailsDom();

    byId(window, 'officerEmailInput').value = 'officer.fisher@police.uk';
    byId(window, 'officerSurnameInput').value = 'Fisher';
    byId(window, 'officerReferenceInput').value = '1234';
    byId(window, 'policeStationOrUnitInput').value = 'Kent Police';
    byId(window, 'attendanceDateInput').value = '2026-04-30';
    byId(window, 'attendanceTimeInput').value = '14:30';
    byId(window, 'clientNameInput').value = 'John Smith';
    byId(window, 'matterInput').value = 'Assault allegation';
    byId(window, 'attendanceNoteInput').value = 'The client was interviewed under caution.';

    click(window, 'officerGenerateBtn');
    assert.ok(byId(window, 'officerSubjectInput').value.includes('John Smith'), 'subject should include client');
    assert.ok(byId(window, 'officerBodyInput').value.includes('Fisher'), 'body should include officer surname');

    click(window, 'officerOpenOutlookHeroBtn');
    await flushPromises();

    assert.strictEqual(opens.length, 1, 'emailAPI.open should run exactly once');
    const p = opens[0];
    assert.strictEqual(p.to, 'officer.fisher@police.uk');
    assert.strictEqual(p.openMethod, 'edge-inprivate');
    assert.ok(p.subject && p.subject.includes('John Smith'));
    assert.ok(p.body && p.body.includes('interviewed under caution'));
    assert.ok(typeof p.loginHint === 'string' && p.loginHint.includes('@'));
  });

  it('shows validation error when hero Open is clicked with empty form', async () => {
    const { window, opens } = bootOfficerEmailsDom();
    click(window, 'officerOpenOutlookHeroBtn');
    await flushPromises();
    assert.strictEqual(opens.length, 0);
    const err = byId(window, 'officerEmailError');
    assert.ok(err && !err.classList.contains('hidden'), 'error alert should be visible');
    assert.ok((err.textContent || '').includes('Please complete'), err.textContent);
  });
});
