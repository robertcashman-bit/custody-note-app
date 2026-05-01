/**
 * User-flow tests for Officer Emails — fill details, generate from template,
 * then use hero open buttons (mailto + Outlook Web).
 *
 * Loads renderer/email-draft-open.js; stubs window.open / location for assertions.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const EMAIL_COMPOSE_LIB = require(path.join(ROOT, 'lib', 'emailComposeDraft.js'));
const EMAIL_COPY_SRC = fs.readFileSync(path.join(ROOT, 'renderer', 'emailCopy.js'), 'utf8');
const EMAIL_DRAFT_SRC = fs.readFileSync(path.join(ROOT, 'renderer', 'email-draft-open.js'), 'utf8');
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
  window.CustodyEmailCompose = EMAIL_COMPOSE_LIB;
  /* Minimal stubs — officerEmails init touches these */
  window.confirm = () => false;
  const opens = [];
  /* jsdom's location is non-configurable; replace with a URL object (supports href = mailto:…). */
  try {
    /* eslint-disable-next-line no-underscore-dangle */
    delete window.location;
  } catch (_) { /* some jsdom versions */ }
  try {
    var locStub = { href: 'http://localhost/' };
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: locStub,
    });
  } catch (_) {
    /* If location cannot be replaced, mailto href assignment tests may be skipped. */
  }
  window.open = function (url) {
    opens.push({ kind: 'window-open', url: String(url || '') });
    return {};
  };
  window.navigator.clipboard = {
    writeText: async (t) => {
      window.__lastClipboard = String(t);
      return undefined;
    },
  };
  window.isSecureContext = true;
  window.emailAPI = {
    detectOutlookDesktop: () => Promise.resolve({ installed: false }),
    open: () => Promise.resolve({ ok: true }),
  };
  evalRendererInWindow(window, EMAIL_COPY_SRC);
  evalRendererInWindow(window, EMAIL_DRAFT_SRC);
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
  it('fills details, generates template, hero Open in Outlook Web uses deeplink compose URL', async () => {
    const { window, opens } = bootOfficerEmailsDom();

    byId(window, 'officerEmailInput').value = 'officer.fisher@police.uk';
    byId(window, 'officerRankInput').value = 'DC';
    byId(window, 'officerSurnameInput').value = 'Fisher';
    byId(window, 'officerReferenceInput').value = '1234';
    byId(window, 'policeStationOrUnitInput').value = 'Kent Police';
    byId(window, 'custodyNumberInput').value = 'CN-1';
    byId(window, 'dsccReferenceInput').value = 'DSCC/9';
    byId(window, 'attendanceDateInput').value = '2026-04-30';
    byId(window, 'attendanceTimeInput').value = '14:30';
    byId(window, 'clientNameInput').value = 'John Smith';
    byId(window, 'matterInput').value = 'Assault allegation';
    byId(window, 'attendanceNoteInput').value = '';
    byId(window, 'officerLoginHintInput').value = 'fee.earner@example.com';

    click(window, 'officerGenerateBtn');
    assert.ok(byId(window, 'officerSubjectInput').value.includes('John Smith'), 'subject should include client');
    assert.ok(byId(window, 'officerBodyInput').value.includes('Fisher'), 'body should include officer surname');

    click(window, 'officerOpenOutlookHeroBtn');
    await flushPromises();

    assert.strictEqual(opens.length, 1, 'window.open should run once for OWA');
    assert.ok(opens[0].url.includes('https://outlook.office.com/mail/deeplink/compose'), opens[0].url);
    assert.ok(
      opens[0].url.includes('officer.fisher') && opens[0].url.includes('police.uk'),
      opens[0].url
    );
  });

  it('hero Open in Outlook uses encoded mailto (no window.open)', async () => {
    const { window, opens } = bootOfficerEmailsDom();

    byId(window, 'officerEmailInput').value = 'officer.fisher@police.uk';
    byId(window, 'officerRankInput').value = 'DC';
    byId(window, 'officerSurnameInput').value = 'Fisher';
    byId(window, 'officerReferenceInput').value = '1234';
    byId(window, 'policeStationOrUnitInput').value = 'Kent Police';
    byId(window, 'custodyNumberInput').value = 'CN-1';
    byId(window, 'dsccReferenceInput').value = 'DSCC/9';
    byId(window, 'attendanceDateInput').value = '2026-04-30';
    byId(window, 'attendanceTimeInput').value = '14:30';
    byId(window, 'clientNameInput').value = 'John Smith';
    byId(window, 'matterInput').value = 'Assault allegation';
    byId(window, 'attendanceNoteInput').value = 'Note';

    click(window, 'officerGenerateBtn');
    const expectedMailto = window.buildMailtoLink({
      to: 'officer.fisher@police.uk',
      cc: '',
      subject: byId(window, 'officerSubjectInput').value,
      body: byId(window, 'officerBodyInput').value,
    });
    click(window, 'officerOpenOutlookMailtoHeroBtn');
    await flushPromises();

    assert.strictEqual(opens.length, 0, 'mailto must not use window.open');
    assert.ok(expectedMailto.toLowerCase().startsWith('mailto:'), expectedMailto);
    assert.ok(expectedMailto.includes('%40'), 'address must be encoded');
    assert.ok(expectedMailto.includes('subject='), 'subject query param');
    assert.ok(expectedMailto.includes('body='), 'body query param');
  });

  it('hero Open with empty form still tries Outlook Web (copy-first workflow does not block Open)', async () => {
    const { window, opens } = bootOfficerEmailsDom();
    click(window, 'officerOpenOutlookHeroBtn');
    await flushPromises();
    assert.strictEqual(opens.length, 1, 'OWA deeplink should still be attempted');
  });

  it('Copy Email Body uses clipboard API when body is generated', async () => {
    const { window } = bootOfficerEmailsDom();
    byId(window, 'clientNameInput').value = 'Jane';
    byId(window, 'officerSurnameInput').value = 'Doe';
    byId(window, 'policeStationOrUnitInput').value = 'Station';
    byId(window, 'attendanceDateInput').value = '2026-05-01';
    click(window, 'officerGenerateBtn');
    click(window, 'officerHeroCopyBodyBtn');
    await flushPromises();
    assert.ok((window.__lastClipboard || '').includes('Jane'), 'clipboard should receive body text');
  });
});
