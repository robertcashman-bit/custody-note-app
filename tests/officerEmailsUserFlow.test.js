/**
 * User-flow tests for Officer Emails — fill details, generate from template,
 * then drive the copy buttons.
 *
 * v1.6.20: Officer Emails is copy-and-paste only. The hero / Compose /
 * Preview / side-panel "Open in Outlook" + "Open in Outlook Web" launch
 * surfaces were removed because the Windows launch path was unreliable
 * (Outlook PWA hijack, Edge sign-in prompts, Default-browser
 * interception). The previous tests for those buttons have been replaced
 * with copy-button assertions that match the user's actual workflow.
 *
 * Loads renderer/email-draft-open.js so the inlined helper module wiring
 * matches the production preload bridge.
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
  window.confirm = () => false;
  const opens = [];
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

describe('Officer Emails — copy-only user flow (v1.6.20)', () => {
  it('hero Copy Email Body copies the generated template body to the clipboard', async () => {
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

  it('Compose Copy Officer Email / Copy Subject / Copy Full Email all hit the clipboard', async () => {
    const { window } = bootOfficerEmailsDom();
    byId(window, 'officerEmailInput').value = 'officer.fisher@police.uk';
    byId(window, 'officerRankInput').value = 'DC';
    byId(window, 'officerSurnameInput').value = 'Fisher';
    byId(window, 'policeStationOrUnitInput').value = 'Kent Police';
    byId(window, 'attendanceDateInput').value = '2026-04-30';
    byId(window, 'clientNameInput').value = 'John Smith';
    byId(window, 'matterInput').value = 'Assault';

    click(window, 'officerGenerateBtn');

    click(window, 'officerCopyOfficerEmailBtn');
    await flushPromises();
    assert.strictEqual(window.__lastClipboard, 'officer.fisher@police.uk');

    click(window, 'officerCopySubjectBtn');
    await flushPromises();
    assert.ok(
      (window.__lastClipboard || '').includes('John Smith'),
      'subject clipboard should include client name'
    );

    click(window, 'officerCopyFullBtn');
    await flushPromises();
    assert.ok(
      (window.__lastClipboard || '').startsWith('To: officer.fisher@police.uk'),
      'full-email clipboard should start with To: …'
    );
    assert.ok(
      (window.__lastClipboard || '').includes('Subject:'),
      'full-email clipboard should include Subject: …'
    );
  });

  it('No Open-in-Outlook button is present in the rendered DOM after init', () => {
    const { window } = bootOfficerEmailsDom();
    const FORBIDDEN_IDS = [
      'officerOpenOutlookMailtoHeroBtn',
      'officerOpenOutlookHeroBtn',
      'officerOpenOutlookMailtoBtn',
      'officerOpenOutlookBtn',
      'officerOpenOutlookMailtoPreviewBtn',
      'officerOpenOutlookPreviewBtn',
      'officerOpenOutlookMailtoSideBtn',
      'officerOpenOutlookSideBtn',
      'officerEmailFallbackPanel',
      'officerEmailSignInPanel',
      'officerContinueDraftBtn',
      'officerFbOpenMailtoBtn',
      'officerFbOpenWebBtn',
      'officerClearPendingDraftBtn',
    ];
    const stillPresent = FORBIDDEN_IDS.filter((id) => byId(window, id));
    assert.deepStrictEqual(
      stillPresent,
      [],
      'Outlook-launch IDs leaked back into the DOM: ' + stillPresent.join(', ')
    );
  });

  it('Generating the template never calls window.open (Officer Emails never auto-launches a browser)', async () => {
    const { window, opens } = bootOfficerEmailsDom();
    byId(window, 'officerEmailInput').value = 'officer.fisher@police.uk';
    byId(window, 'officerSurnameInput').value = 'Fisher';
    byId(window, 'clientNameInput').value = 'Jane';
    byId(window, 'policeStationOrUnitInput').value = 'Station';
    byId(window, 'attendanceDateInput').value = '2026-05-01';
    click(window, 'officerGenerateBtn');
    click(window, 'officerHeroCopyBodyBtn');
    click(window, 'officerCopySubjectBtn');
    click(window, 'officerCopyFullBtn');
    await flushPromises();
    assert.strictEqual(opens.length, 0, 'copy-only workflow must never open a window/tab');
    assert.strictEqual(window.location.href, 'http://localhost/', 'copy-only workflow must not navigate location');
  });
});
