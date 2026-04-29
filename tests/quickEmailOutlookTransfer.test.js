/**
 * Quick Email → Outlook payload-transfer tests.
 *
 * Reproduces the user's bug report: "after I have typed the information in
 * for the email it is not transferring it to the Outlook app". These tests
 * spy on the IPC `emailAPI.open` (and the lower-level OWA URL builder) to
 * verify that the data the user types in the modal actually arrives in the
 * payload sent to the main process and to Outlook Web.
 *
 * Coverage:
 *   1. Form fields → rendered template → payload (to/subject/body all present)
 *   2. Manual edits to subject/body win over the template render
 *   3. Compose with NO template selected — typed subject/body still send
 *   4. Officer email field reaches the `to` parameter exactly once
 *   5. The OWA compose URL embeds the typed values verbatim (encoded)
 *   6. A `microsoft-edge:` launch URL preserves the OWA query parameters
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const renderSrc = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'quick-email-template-render.js'),
  'utf8'
);
const catalogSrc = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'quickEmailTemplateCatalog.js'),
  'utf8'
);
const modalSrc = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'views', 'email-modal.js'),
  'utf8'
);
const systemTemplatesJson = fs.readFileSync(
  path.join(__dirname, '..', 'data', 'quick-email-templates.json'),
  'utf8'
);

const { buildOutlookWebComposeUrl, buildOutlookWebComposeUrlWithMeta } = require('../lib/outlookWebComposeUrl');
const { openOutlookWebEmail, _resetOutlookWebAckForTests } = require('../main/openOutlookWebEmail');

function createEnv(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
  });
  const { window } = dom;

  window._appSettingsCache = {
    feeEarnerNameDefault: 'Robert Cashman',
    firmName: 'Cashman Solicitors',
    feeEarnerEmail: 'robert@example.com',
    feeEarnerPhone: '0123456789',
  };

  /* Capture every Outlook payload the modal forwards to the main process. */
  const sentPayloads = [];
  let nextOutcome = Promise.resolve({ ok: true });
  window.api = {
    getSettings: () => Promise.resolve({}),
    setSettings: () => Promise.resolve(),
    openExternal: () => {},
    attendanceSave: () => Promise.resolve({}),
  };
  window.emailAPI = {
    open: (payload) => {
      sentPayloads.push(payload);
      return nextOutcome;
    },
  };
  window.invokeOutlookWebCompose = (payload) => window.emailAPI.open(payload);

  let _customStore = (opts.customTemplates || []).slice();
  window._getCustomEmailTemplates = () => _customStore.slice();
  window._saveCustomEmailTemplates = (tpls) => { _customStore = (tpls || []).slice(); };

  const RealXHR = window.XMLHttpRequest;
  function StubXHR() { this.status = 0; this.responseText = ''; this._url = ''; }
  StubXHR.prototype.open = function(_method, url) { this._url = String(url || ''); };
  StubXHR.prototype.send = function() {
    if (this._url.indexOf('quick-email-templates.json') !== -1) {
      this.status = 200;
      this.responseText = systemTemplatesJson;
    } else {
      this.status = 404;
      this.responseText = '';
    }
  };
  window.XMLHttpRequest = StubXHR;

  const globals = `
    var showToast = function(){};
    var showConfirm = function(){ return Promise.resolve(true); };
    var refreshList = function(){};
    function _oicClean(v){return v==null?'':String(v).trim();}
  `;
  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = globals + '\n' + renderSrc + '\n' + catalogSrc + '\n' + modalSrc;
  window.document.body.appendChild(scriptEl);

  return {
    dom, window, document: window.document,
    sentPayloads,
    setOutcome(p) { nextOutcome = p; },
    restoreXHR: () => { window.XMLHttpRequest = RealXHR; },
  };
}

function openModal(env) { env.window.openQuickEmailModal(); }
function setField(doc, key, value) {
  const el = doc.getElementById('qe-field-' + key);
  if (!el) throw new Error('Field not found: qe-field-' + key);
  el.value = value;
  const Event = el.ownerDocument.defaultView.Event;
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  return el;
}
function pickTemplate(doc, id) {
  const sel = doc.getElementById('quick-email-picker');
  sel.value = id;
  const Event = sel.ownerDocument.defaultView.Event;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}
function tickMicrotasks(n) {
  let p = Promise.resolve();
  for (let i = 0; i < (n || 5); i++) p = p.then(() => undefined);
  return p;
}

describe('Quick Email → Outlook payload transfer', () => {
  let env;
  beforeEach(() => { env = createEnv(); openModal(env); });

  it('sends the typed officer email, rendered subject and rendered body to emailAPI.open', async () => {
    setField(env.document, 'officerEmail', 'oic@met.police.uk');
    setField(env.document, 'oicName',      'Smith');
    setField(env.document, 'clientName',   'John Doe');
    setField(env.document, 'station',      'Holborn');
    setField(env.document, 'date',         '2026-04-29');
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks();

    assert.strictEqual(env.sentPayloads.length, 1, 'expected one payload to be forwarded to main');
    const sent = env.sentPayloads[0];
    assert.strictEqual(sent.to, 'oic@met.police.uk', 'officer email did not transfer to Outlook payload');
    assert.ok(/john doe/i.test(sent.subject),  'client name missing from Outlook subject: ' + sent.subject);
    assert.ok(/holborn/i.test(sent.subject),   'station missing from Outlook subject: ' + sent.subject);
    assert.ok(/dear dc smith/i.test(sent.body),'officer name missing from Outlook body: ' + sent.body.slice(0, 80));
    assert.ok(/john doe/i.test(sent.body),     'client name missing from Outlook body');
    assert.ok(/holborn/i.test(sent.body),      'station missing from Outlook body');
    assert.ok(sent.body.includes('29/04/2026'),'date missing from Outlook body');
    assert.ok(!/\{\{/.test(sent.body),         'unrendered placeholder slipped through to Outlook payload');
  });

  it('hand-edited subject and body win over the template when sending', async () => {
    setField(env.document, 'officerEmail', 'oic@example.uk');
    pickTemplate(env.document, 'system:disclosure');

    const subjEl = env.document.getElementById('quick-email-subject');
    const bodyEl = env.document.getElementById('quick-email-body');
    subjEl.value = 'Manual subject — please ignore template';
    bodyEl.value = 'Manually written body. Do not auto-render this.';
    const Event = env.window.Event;
    subjEl.dispatchEvent(new Event('input', { bubbles: true }));
    bodyEl.dispatchEvent(new Event('input', { bubbles: true }));

    env.document.getElementById('qe-send').click();
    await tickMicrotasks();

    assert.strictEqual(env.sentPayloads.length, 1);
    const sent = env.sentPayloads[0];
    assert.strictEqual(sent.subject, 'Manual subject — please ignore template');
    assert.strictEqual(sent.body,    'Manually written body. Do not auto-render this.');
  });

  it('compose with no template still sends typed subject + body to Outlook', async () => {
    setField(env.document, 'officerEmail', 'free@example.uk');
    /* No template picked. The subject + body inputs should be writable
       and whatever the user types must reach Outlook. */
    const subjEl = env.document.getElementById('quick-email-subject');
    const bodyEl = env.document.getElementById('quick-email-body');
    subjEl.value = 'Free compose subject';
    bodyEl.value = 'Free compose body line 1\nLine 2';
    const Event = env.window.Event;
    subjEl.dispatchEvent(new Event('input', { bubbles: true }));
    bodyEl.dispatchEvent(new Event('input', { bubbles: true }));

    env.document.getElementById('qe-send').click();
    await tickMicrotasks();

    assert.strictEqual(env.sentPayloads.length, 1, 'send did not forward the free-compose payload');
    const sent = env.sentPayloads[0];
    assert.strictEqual(sent.to,      'free@example.uk');
    assert.strictEqual(sent.subject, 'Free compose subject');
    assert.strictEqual(sent.body,    'Free compose body line 1\nLine 2');
  });

  it('does NOT block the send when an optional missing field is reported', async () => {
    /* Pick disclosure (which expects clientName, station). Officer email
       is filled; clientName is left blank. The modal shows a missing-field
       strip but should still forward to Outlook so the user can finish
       there. */
    setField(env.document, 'officerEmail', 'partial@example.uk');
    setField(env.document, 'oicName',      'Smith');
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks();

    assert.strictEqual(env.sentPayloads.length, 1, 'partial-field send was suppressed');
    assert.strictEqual(env.sentPayloads[0].to, 'partial@example.uk');
  });

  it('blocks the send and surfaces a clear error when the officer email is empty', async () => {
    pickTemplate(env.document, 'system:disclosure');
    env.document.getElementById('qe-send').click();
    await tickMicrotasks();
    assert.strictEqual(env.sentPayloads.length, 0, 'must not call Outlook with an empty To address');
  });
});

describe('Quick Email → OWA URL builder', () => {
  it('embeds the typed values into the Outlook Web compose URL verbatim', () => {
    const url = buildOutlookWebComposeUrl({
      to: 'oic@met.police.uk',
      cc: '',
      bcc: '',
      subject: 'Disclosure request: John Doe',
      body: 'Hello DC Smith,\n\nPlease send disclosure for John Doe at Holborn.',
    });
    assert.ok(url.startsWith('https://outlook.office.com/mail/deeplink/compose'));
    assert.ok(url.indexOf('to=' + encodeURIComponent('oic@met.police.uk')) !== -1, 'to= missing');
    assert.ok(url.indexOf('subject=' + encodeURIComponent('Disclosure request: John Doe')) !== -1, 'subject missing');
    assert.ok(url.indexOf('body=' + encodeURIComponent('Hello DC Smith,\n\nPlease send disclosure for John Doe at Holborn.')) !== -1, 'body missing');
  });

  it('truncates oversized bodies but keeps the subject + recipient intact', () => {
    const huge = 'X'.repeat(20000);
    const meta = buildOutlookWebComposeUrlWithMeta({
      to: 'a@b.c', subject: 'tiny', body: huge,
    });
    assert.strictEqual(meta.truncated, true);
    assert.strictEqual(meta.reason, 'body_too_long');
    assert.ok(meta.url.indexOf('to=' + encodeURIComponent('a@b.c')) !== -1);
    assert.ok(meta.url.indexOf('subject=tiny') !== -1);
  });

  it('a Windows microsoft-edge launch URL preserves the OWA query parameters', () => {
    const url = buildOutlookWebComposeUrl({
      to: 'oic@met.police.uk',
      subject: 'Hello',
      body: 'World',
    });
    const launch = 'microsoft-edge:' + url;
    assert.ok(launch.startsWith('microsoft-edge:https://outlook.office.com/'));
    assert.ok(launch.indexOf('subject=Hello') !== -1);
    assert.ok(launch.indexOf('body=World') !== -1);
    assert.ok(launch.indexOf('to=' + encodeURIComponent('oic@met.police.uk')) !== -1);
  });
});

describe('Quick Email → main-process end-to-end (regression: typed body must reach Outlook)', () => {
  beforeEach(() => { _resetOutlookWebAckForTests(); });

  it('default dialog choice (Enter / highlighted button) keeps the body in the OWA URL', async () => {
    /* This is the bug the user hit: in the old build the dialog defaulted
       to "subject only", which silently dropped the email body the user
       had just typed. Pin the regression with a full pipeline test. */
    const opens = [];
    const result = await openOutlookWebEmail(
      {
        to: 'oic@met.police.uk', cc: '', bcc: '',
        subject: 'Disclosure request: John Doe',
        body: 'Dear DC Smith,\n\nPlease send disclosure for John Doe at Holborn.\n\nKind regards,\nRobert Cashman',
      },
      {
        shell: { openExternal: (u) => { opens.push(u); return Promise.resolve(); } },
        dialog: {
          /* Simulate the user pressing Enter / clicking the highlighted
             button — i.e. picking whatever defaultId is. */
          showMessageBox: async (_w, opts) => ({ response: opts.defaultId, checkboxChecked: false }),
        },
      }
    );
    assert.strictEqual(opens.length, 1);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.mode, 'open', 'default mode must be full body, not "no-body"');
    const launchedUrl = opens[0];
    assert.ok(launchedUrl.includes(encodeURIComponent('Dear DC Smith,')),
      'body greeting must reach Outlook on the default action: ' + launchedUrl.slice(0, 200));
    assert.ok(launchedUrl.includes(encodeURIComponent('John Doe')),
      'client name must reach Outlook');
    assert.ok(launchedUrl.includes(encodeURIComponent('Holborn')),
      'station must reach Outlook');
    assert.ok(launchedUrl.includes(encodeURIComponent('Robert Cashman')),
      'fee earner sign-off must reach Outlook');
  });

  it('skipConfirm bypasses the dialog and forwards the full body verbatim', async () => {
    /* Used by automated tests / packaged background flows. */
    const opens = [];
    const result = await openOutlookWebEmail(
      { to: 'a@b.c', subject: 'S', body: 'KEEP_ME_IN_URL' },
      {
        shell: { openExternal: (u) => { opens.push(u); return Promise.resolve(); } },
        skipConfirm: true,
      }
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(opens.length, 1);
    assert.ok(opens[0].includes(encodeURIComponent('KEEP_ME_IN_URL')), opens[0]);
  });
});

describe('Quick Email modal — accountType setting selects the right Outlook surface end-to-end', () => {
  /* Re-uses the createEnv helper from the top of this file but injects an
     outlookAccountType setting and a fresh emailAPI.open spy that runs the
     real openOutlookWebEmail so the mailto / personal / work URL surfaces
     are exercised through the full pipeline (form -> modal -> _invokeOutlookEmail
     -> emailAPI.open -> openOutlookWebEmail -> shell.openExternal). */

  function makeWiredEnv(accountType) {
    const env = createEnv();
    env.window._appSettingsCache = Object.assign({}, env.window._appSettingsCache || {}, { outlookAccountType: accountType });

    /* Replace the captured-payloads stub with one that invokes the real
       main-process opener so URL building + Edge logic + clipboard
       fallback are exercised together. */
    const opens = [];
    env.opens = opens;
    env.window.invokeOutlookWebCompose = (payload) => openOutlookWebEmail(
      Object.assign({}, payload),
      {
        shell: { openExternal: (u) => { opens.push(u); return Promise.resolve(); } },
        skipConfirm: true,
        accountType: payload.accountType,
      }
    );
    return env;
  }

  it("setting outlookAccountType='personal' opens outlook.live.com with the typed body", async () => {
    _resetOutlookWebAckForTests();
    const env = makeWiredEnv('personal');
    openModal(env);
    setField(env.document, 'officerEmail', 'oic@met.police.uk');
    setField(env.document, 'oicName',      'Smith');
    setField(env.document, 'clientName',   'John Doe');
    setField(env.document, 'station',      'Holborn');
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks(8);

    assert.strictEqual(env.opens.length, 1, 'send did not reach openOutlookWebEmail');
    const launchUrl = env.opens[0];
    assert.ok(launchUrl.startsWith('https://outlook.live.com/mail/0/deeplink/compose'),
      'personal must hit outlook.live.com: ' + launchUrl.slice(0, 200));
    assert.ok(launchUrl.includes('to=' + encodeURIComponent('oic@met.police.uk')));
    assert.ok(launchUrl.includes(encodeURIComponent('John Doe')));
    assert.ok(launchUrl.includes(encodeURIComponent('Holborn')));
    assert.ok(launchUrl.includes(encodeURIComponent('Dear DC Smith,')));
  });

  it("setting outlookAccountType='mailto' produces a mailto: URI with subject + body", async () => {
    _resetOutlookWebAckForTests();
    const env = makeWiredEnv('mailto');
    openModal(env);
    setField(env.document, 'officerEmail', 'oic@met.police.uk');
    setField(env.document, 'oicName',      'Williams');
    setField(env.document, 'clientName',   'Alice Brown');
    setField(env.document, 'station',      'Camden');
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks(8);

    assert.strictEqual(env.opens.length, 1);
    const launchUrl = env.opens[0];
    assert.ok(launchUrl.startsWith('mailto:'), 'mailto must use mailto: scheme: ' + launchUrl.slice(0, 100));
    assert.ok(launchUrl.startsWith('mailto:' + encodeURIComponent('oic@met.police.uk')));
    assert.ok(launchUrl.includes('subject=' + encodeURIComponent('Alice Brown - Camden - request for disclosure')));
    assert.ok(launchUrl.includes(encodeURIComponent('Dear DC Williams,')));
  });

  it("setting outlookAccountType='work' keeps the existing outlook.office.com path", async () => {
    _resetOutlookWebAckForTests();
    const env = makeWiredEnv('work');
    openModal(env);
    setField(env.document, 'officerEmail', 'oic@firm.example');
    setField(env.document, 'clientName',   'Test Client');
    setField(env.document, 'station',      'Westminster');
    pickTemplate(env.document, 'system:representation');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks(8);

    const launchUrl = env.opens[0];
    /* On Windows the work surface gets prefixed with microsoft-edge:; off Windows it stays plain https. */
    assert.ok(
      launchUrl.startsWith('https://outlook.office.com/') ||
      launchUrl.startsWith('microsoft-edge:https://outlook.office.com/'),
      'work must hit outlook.office.com: ' + launchUrl.slice(0, 200)
    );
    assert.ok(launchUrl.includes(encodeURIComponent('Test Client')));
  });
});
