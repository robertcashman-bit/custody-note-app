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

const { buildOutlookComposeUrls, buildOutlookWebComposeUrl, buildOutlookWebComposeUrlWithMeta } = require('../lib/outlookWebComposeUrl');
const { openOutlookWebEmail, _resetOutlookWebAckForTests } = require('../main/openOutlookWebEmail');

function param(url, key) {
  return new URL(url).searchParams.get(key);
}

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

  /* v1.6.4 — Quick Email send is now strictly validated before opening
     Outlook. Missing officer email / client / station / date / time block
     the send and surface an inline error inside the modal. The tests
     below populate every required field so the happy path still fires. */

  function fillRequired(env, overrides) {
    const o = overrides || {};
    setField(env.document, 'officerEmail', o.officerEmail || 'oic@met.police.uk');
    setField(env.document, 'clientName',   o.clientName   || 'John Doe');
    setField(env.document, 'station',      o.station      || 'Holborn');
    setField(env.document, 'date',         o.date         || '2026-04-29');
    setField(env.document, 'time',         o.time         || '09:00');
    if (o.oicName) setField(env.document, 'oicName', o.oicName);
  }

  it('sends the typed officer email, rendered subject and rendered body to emailAPI.open', async () => {
    fillRequired(env, { oicName: 'Smith' });
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks();

    assert.strictEqual(env.sentPayloads.length, 1, 'expected one payload to be forwarded to main');
    const sent = env.sentPayloads[0];
    assert.strictEqual(sent.to, 'oic@met.police.uk', 'officer email did not transfer to Outlook payload');
    assert.ok(/john doe/i.test(sent.subject),  'client name missing from Outlook subject: ' + sent.subject);
    assert.ok(/holborn/i.test(sent.subject),   'station missing from Outlook subject: ' + sent.subject);
    /* v1.6.4 templates use the smart {{officerSalutation}} → "Officer Smith"
       (no duplicate rank). The old "DC Smith" wording has been retired. */
    assert.ok(/dear officer smith/i.test(sent.body),
      'officer salutation missing from Outlook body: ' + sent.body.slice(0, 120));
    assert.ok(/john doe/i.test(sent.body),     'client name missing from Outlook body');
    assert.ok(/holborn/i.test(sent.body),      'station missing from Outlook body');
    assert.ok(sent.body.includes('29/04/2026'),'date missing from Outlook body');
    assert.ok(!/\{\{/.test(sent.body),         'unrendered placeholder slipped through to Outlook payload');
  });

  it('hand-edited subject and body win over the template when sending', async () => {
    fillRequired(env, { officerEmail: 'oic@example.uk' });
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
    fillRequired(env, { officerEmail: 'free@example.uk' });
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

  it('BLOCKS the send and surfaces an inline error when a required field is missing', async () => {
    /* v1.6.4 spec section C: validation must prevent Outlook from opening
       with malformed data. Previously the modal forwarded a partial
       payload and let Outlook silently land in the inbox. */
    setField(env.document, 'officerEmail', 'partial@example.uk');
    /* clientName / station / date / time deliberately left empty. */
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks();

    assert.strictEqual(env.sentPayloads.length, 0, 'partial-field send must be suppressed');
    const errStrip = env.document.getElementById('quick-email-error-strip');
    assert.ok(errStrip,                        'error strip must exist in the DOM');
    assert.notStrictEqual(errStrip.style.display, 'none', 'error strip must be visible');
    assert.ok(/required/i.test(errStrip.textContent), 'error strip text must explain what is wrong');
  });

  it('blocks the send and surfaces a clear error when the officer email is empty', async () => {
    pickTemplate(env.document, 'system:disclosure');
    env.document.getElementById('qe-send').click();
    await tickMicrotasks();
    assert.strictEqual(env.sentPayloads.length, 0, 'must not call Outlook with an empty To address');
    const errStrip = env.document.getElementById('quick-email-error-strip');
    assert.ok(errStrip && errStrip.style.display !== 'none', 'error strip must surface to the user');
  });

  it('blocks the send when the officer email is malformed (not a real email address)', async () => {
    fillRequired(env, { officerEmail: 'not-a-real-email' });
    pickTemplate(env.document, 'system:disclosure');
    env.document.getElementById('qe-send').click();
    await tickMicrotasks();
    assert.strictEqual(env.sentPayloads.length, 0, 'malformed To addresses must not reach Outlook');
    const errStrip = env.document.getElementById('quick-email-error-strip');
    assert.ok(errStrip && /valid address|valid email/i.test(errStrip.textContent),
      'error strip must explain the email is invalid');
  });

  it('uses Officer prefix for plain surname and does not duplicate rank if rank already provided', async () => {
    fillRequired(env, { officerEmail: 'rank@example.uk', oicName: 'Jarvis' });
    pickTemplate(env.document, 'system:disclosure');
    env.document.getElementById('qe-send').click();
    await tickMicrotasks();
    assert.strictEqual(env.sentPayloads.length, 1);
    assert.ok(/dear officer jarvis,/i.test(env.sentPayloads[0].body), env.sentPayloads[0].body);

    openModal(env);
    fillRequired(env, { officerEmail: 'rank2@example.uk', oicName: 'DC Smith' });
    pickTemplate(env.document, 'system:disclosure');
    env.document.getElementById('qe-send').click();
    await tickMicrotasks();
    assert.strictEqual(env.sentPayloads.length, 2);
    assert.ok(/dear dc smith,/i.test(env.sentPayloads[1].body), env.sentPayloads[1].body);
    assert.ok(!/dear officer dc smith,/i.test(env.sentPayloads[1].body), env.sentPayloads[1].body);
  });

  it('send button does not submit a parent form and click is handled once', async () => {
    fillRequired(env, { officerEmail: 'single@example.uk' });
    pickTemplate(env.document, 'system:disclosure');
    var modal = env.document.getElementById('quick-email-modal');
    var form = env.document.createElement('form');
    var submitCount = 0;
    form.addEventListener('submit', function(e) { submitCount += 1; e.preventDefault(); });
    modal.parentNode.insertBefore(form, modal);
    form.appendChild(modal);

    const sendBtn = env.document.getElementById('qe-send');
    const evt = new env.window.MouseEvent('click', { bubbles: true, cancelable: true });
    sendBtn.dispatchEvent(evt);
    await tickMicrotasks();
    assert.strictEqual(submitCount, 0, 'send should not submit parent form');
    assert.strictEqual(env.sentPayloads.length, 1, 'send handler should forward exactly once');
    assert.strictEqual(evt.defaultPrevented, true, 'send click should call preventDefault');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Smart-routing tests for the v1.6.10 follow-up: Outlook web URLs are
   environment-fragile (Edge / M365 tenant policy normalises
   /mail/deeplink/compose back to /mail/), so on Windows with Outlook
   desktop installed the primary Send must transparently switch to the
   .eml draft route. The previous implementation kicked off detection
   asynchronously inside _bindEvents, so a fast click raced past it and
   the renderer ended up sending the user to the inbox.
   ───────────────────────────────────────────────────────────────────── */
describe('Quick Email — primary Send routes to Outlook desktop draft when detected installed', () => {
  function makeDesktopDetectedEnv(opts) {
    opts = opts || {};
    const env = createEnv();
    /* Pre-seed cache so _ensureDesktopDetect resolves synchronously to
       the requested state — exactly what a real boot would look like
       once the pre-warm IPC has resolved. */
    env.window._outlookDesktopDetect = { installed: !!opts.installed, exePath: opts.installed ? 'C:\\OUTLOOK.EXE' : null };
    env.window.emailAPI.detectOutlookDesktop = () => Promise.resolve(env.window._outlookDesktopDetect);
    if (opts.savedAccountType != null) {
      env.window._appSettingsCache = Object.assign({}, env.window._appSettingsCache || {}, { outlookAccountType: opts.savedAccountType });
    }
    if (opts.lastWorkingAccountType != null) {
      env.window._appSettingsCache = Object.assign({}, env.window._appSettingsCache || {}, { lastWorkingOutlookAccountType: opts.lastWorkingAccountType });
    }
    return env;
  }

  function fillRequired(env, overrides) {
    const o = overrides || {};
    setField(env.document, 'officerEmail', o.officerEmail || '30052@kent.police.uk');
    setField(env.document, 'clientName',   o.clientName   || 'David Walter');
    setField(env.document, 'station',      o.station      || 'Maidstone');
    setField(env.document, 'date',         o.date         || '2026-04-30');
    setField(env.document, 'time',         o.time         || '09:00');
    if (o.oicName) setField(env.document, 'oicName', o.oicName);
  }

  it('sends forceAccountType="desktop" when Outlook desktop is detected installed and user has no setting', async () => {
    const env = makeDesktopDetectedEnv({ installed: true });
    openModal(env);
    fillRequired(env, { oicName: 'Jarvis' });
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    /* 8 microtasks: detection awaits + downstream promises */
    await tickMicrotasks(10);

    assert.strictEqual(env.sentPayloads.length, 1, 'must forward exactly one payload');
    const sent = env.sentPayloads[0];
    assert.strictEqual(sent.forceAccountType, 'desktop',
      'desktop must be FORCED so the saved setting cannot override it: ' + JSON.stringify(sent));
    assert.strictEqual(sent.accountType, 'desktop',
      'accountType must also be desktop in the payload');
  });

  it('OVERRIDES legacy outlookAccountType="work" with desktop when Outlook desktop is detected installed', async () => {
    /* Real-world bug: existing users have outlookAccountType="work" saved
       from earlier versions where it was the silent default. The web URL
       route is unreliable, so on a Windows box with Outlook installed we
       must prefer the .eml draft route even though "work" is saved. */
    const env = makeDesktopDetectedEnv({ installed: true, savedAccountType: 'work' });
    openModal(env);
    fillRequired(env, { oicName: 'Jarvis' });
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks(10);

    assert.strictEqual(env.sentPayloads.length, 1);
    assert.strictEqual(env.sentPayloads[0].forceAccountType, 'desktop',
      'desktop must override the legacy "work" default');
  });

  it('RESPECTS lastWorkingOutlookAccountType once the user has confirmed a web route', async () => {
    /* If the user has previously clicked "Yes, looks good" on a web route
       follow-up, that learned preference must beat the desktop default. */
    const env = makeDesktopDetectedEnv({
      installed: true,
      savedAccountType: 'work',
      lastWorkingAccountType: 'work',
    });
    openModal(env);
    fillRequired(env, { oicName: 'Jarvis' });
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks(10);

    assert.strictEqual(env.sentPayloads.length, 1);
    assert.strictEqual(env.sentPayloads[0].forceAccountType, 'work',
      'a confirmed working route must beat the desktop default');
  });

  it('falls back to web when Outlook desktop is NOT installed', async () => {
    const env = makeDesktopDetectedEnv({ installed: false, savedAccountType: 'work' });
    openModal(env);
    fillRequired(env, { oicName: 'Jarvis' });
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks(10);

    assert.strictEqual(env.sentPayloads.length, 1);
    const sent = env.sentPayloads[0];
    assert.strictEqual(sent.forceAccountType, 'work',
      'with no Outlook desktop available, "work" web route is the right choice');
  });

  it('AWAITS in-flight detection: clicking Send before detection lands still routes to desktop', async () => {
    /* This is the original race that put the user in the inbox: detection
       was asynchronous, so the click went out using accountType='' and
       fell back to web. With the await guard, the click handler must
       block on the in-flight detection promise. */
    const env = createEnv();
    let resolveDetect;
    env.window.emailAPI.detectOutlookDesktop = () => new Promise(function(resolve) { resolveDetect = resolve; });
    openModal(env);

    fillRequired(env, { oicName: 'Jarvis' });
    pickTemplate(env.document, 'system:disclosure');
    env.document.getElementById('qe-send').click();

    /* Without the race fix, the click would have already sent a payload by
       now using accountType='work'. With the fix, it is awaiting detection. */
    await tickMicrotasks(2);
    assert.strictEqual(env.sentPayloads.length, 0, 'click must wait for detection to resolve');

    /* Now resolve the detection as "installed" — the awaiting click should
       proceed and send a desktop-routed payload. */
    resolveDetect({ installed: true, exePath: 'C:\\OUTLOOK.EXE' });
    await tickMicrotasks(15);

    assert.strictEqual(env.sentPayloads.length, 1, 'click must complete after detection resolves');
    assert.strictEqual(env.sentPayloads[0].forceAccountType, 'desktop',
      'after detection resolves "installed", desktop route must be used');
  });

  it('shows a route-preview pill that updates to reflect the resolved route', async () => {
    const env = makeDesktopDetectedEnv({ installed: true });
    openModal(env);
    await tickMicrotasks(5);
    const pill = env.document.getElementById('quick-email-route-preview');
    assert.ok(pill, 'route-preview pill must render in the modal footer');
    assert.ok(/desktop draft/i.test(pill.textContent),
      'pill must reflect the desktop route when detected installed: ' + pill.textContent);
  });

  it('Send button label switches to "Send via Outlook (desktop)" when desktop is the resolved route', async () => {
    const env = makeDesktopDetectedEnv({ installed: true });
    openModal(env);
    await tickMicrotasks(5);
    const btn = env.document.getElementById('qe-send');
    assert.ok(btn);
    assert.ok(/desktop/i.test(btn.textContent), 'button label must indicate desktop: ' + btn.textContent);
  });

  it('Send button label stays "Send via Outlook Web" when desktop is NOT installed', async () => {
    const env = makeDesktopDetectedEnv({ installed: false });
    openModal(env);
    await tickMicrotasks(5);
    const btn = env.document.getElementById('qe-send');
    assert.ok(btn);
    assert.ok(/web/i.test(btn.textContent), 'button label must stay "Web" when desktop unavailable: ' + btn.textContent);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Acceptance test from the v1.6.11 brief — the David Walter scenario.
   Verifies the URL builders produce a real compose deeplink (not the
   inbox URL), with the required to / subject / body content.
   ───────────────────────────────────────────────────────────────────── */
describe('Acceptance: David Walter / Maidstone scenario', () => {
  const SCENARIO = {
    to: '30052@kent.police.uk',
    subject: 'Disclosure request - David Walter - Maidstone - 30/04/2026',
    body:
      'Dear Officer Jarvis,\n\n'
      + 'I am instructed in relation to David Walter, who is attending Maidstone Police Station '
      + 'on 30/04/2026 at 09:00 as a voluntary attendee in relation to Common Assault.\n\n'
      + 'Please could you provide disclosure ahead of the interview, or alternatively contact me '
      + 'so that I can take instructions.\n\n'
      + 'Kind regards,\nRobert Cashman',
  };

  it('M365 work compose URL contains the encoded recipient, subject and body verbatim', () => {
    const url = buildOutlookWebComposeUrl(Object.assign({ accountType: 'work' }, SCENARIO));
    assert.ok(url.startsWith('https://outlook.office.com/mail/deeplink/compose?'),
      'URL must use the work compose deeplink: ' + url.slice(0, 120));
    assert.ok(url.includes('to=' + encodeURIComponent(SCENARIO.to).replace(/%40/gi, '%40')),
      'to= encoded recipient must be present');
    assert.ok(url.includes('subject='), 'subject= must be present');
    assert.ok(url.includes('body='), 'body= must be present');
    const decodedBody = new URL(url).searchParams.get('body') || '';
    assert.ok(decodedBody.includes('Dear Officer Jarvis'), 'salutation present in decoded body');
    assert.ok(decodedBody.includes('David Walter'),        'client name present in decoded body');
    assert.ok(decodedBody.includes('Maidstone'),           'station present in decoded body');
    assert.ok(decodedBody.includes('30/04/2026'),          'UK date present in decoded body');
    assert.ok(decodedBody.includes('09:00'),               '24h time present in decoded body');
    assert.ok(decodedBody.includes('Common Assault'),      'offence present in decoded body');
    assert.ok(decodedBody.includes('Kind regards'),        'sign-off present in decoded body');
    assert.ok(decodedBody.includes('Robert Cashman'),      'fee earner name present in decoded body');
    assert.ok(decodedBody.includes('\n\n'),                'paragraph breaks preserved (not collapsed)');
  });

  it('all three compose endpoints are produced and contain the same payload', () => {
    const urls = buildOutlookComposeUrls(SCENARIO);
    assert.ok(urls.office365.startsWith('https://outlook.office.com/mail/deeplink/compose?'));
    assert.ok(urls.office365Alt.startsWith('https://outlook.office.com/owa/?path=/mail/action/compose&'));
    assert.ok(urls.personal.startsWith('https://outlook.live.com/mail/0/deeplink/compose?'));
    /* All three must NOT collapse to the inbox URL. */
    assert.ok(urls.office365 !== 'https://outlook.office.com/mail/');
    assert.ok(urls.personal !== 'https://outlook.live.com/mail/');
    /* All three must carry the to/subject/body. */
    [urls.office365, urls.office365Alt, urls.personal].forEach((u) => {
      const sp = new URL(u).searchParams;
      assert.strictEqual(sp.get('to'), SCENARIO.to);
      assert.strictEqual(sp.get('subject'), SCENARIO.subject);
      assert.strictEqual(sp.get('body'), SCENARIO.body);
    });
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
    assert.strictEqual(param(url, 'to'), 'oic@met.police.uk', 'to= missing');
    assert.strictEqual(param(url, 'subject'), 'Disclosure request: John Doe', 'subject missing');
    assert.strictEqual(param(url, 'body'), 'Hello DC Smith,\n\nPlease send disclosure for John Doe at Holborn.', 'body missing');
  });

  it('truncates oversized bodies but keeps the subject + recipient intact', () => {
    const huge = 'X'.repeat(20000);
    const meta = buildOutlookWebComposeUrlWithMeta({
      to: 'a@b.c', subject: 'tiny', body: huge,
    });
    assert.strictEqual(meta.truncated, true);
    assert.strictEqual(meta.reason, 'body_too_long');
    assert.strictEqual(param(meta.url, 'to'), 'a@b.c');
    assert.strictEqual(param(meta.url, 'subject'), 'tiny');
  });

  it('buildOutlookComposeUrls returns primary, alternate and personal compose routes', () => {
    const urls = buildOutlookComposeUrls({
      to: '30052@kent.police.uk',
      subject: 'Disclosure request - David Walter - Maidstone - 30/04/2026',
      body: 'Dear Officer Jarvis,\n\nKind regards,\nRobert Cashman',
    });
    assert.ok(urls.office365.startsWith('https://outlook.office.com/mail/deeplink/compose?'));
    assert.ok(urls.office365Alt.startsWith('https://outlook.office.com/owa/?path=/mail/action/compose&'));
    assert.ok(urls.personal.startsWith('https://outlook.live.com/mail/0/deeplink/compose?'));
    assert.strictEqual(param(urls.office365, 'to'), '30052@kent.police.uk');
    assert.ok(urls.office365.includes('subject='));
    assert.ok(urls.office365.includes('body='));
  });

  it('does not use generic inbox/home URLs and keeps compose signature', () => {
    const url = buildOutlookWebComposeUrl({
      to: '30052@kent.police.uk',
      subject: 'Disclosure request - David Walter - Maidstone - 30/04/2026',
      body: 'Dear Officer Jarvis,\n\nKind regards,\nRobert Cashman',
      accountType: 'work',
    });
    assert.notStrictEqual(url, 'https://outlook.office.com/mail/');
    assert.notStrictEqual(url, 'https://outlook.live.com/mail/');
    assert.ok(url.includes('/deeplink/compose'));
  });

  it('preserves paragraph breaks in decoded body', () => {
    const body = 'Dear Officer Jarvis,\n\nLine 2.\n\nKind regards,\nRobert Cashman';
    const url = buildOutlookWebComposeUrl({
      to: '30052@kent.police.uk',
      subject: 'Disclosure request - David Walter - Maidstone - 30/04/2026',
      body: body,
      accountType: 'work',
    });
    const parsed = new URL(url);
    const decodedBody = parsed.searchParams.get('body') || '';
    assert.ok(decodedBody.includes('\n\nLine 2.\n\n'));
  });

  it('route=work_alt generates owa action/compose URL', () => {
    const url = buildOutlookWebComposeUrl({
      to: '30052@kent.police.uk',
      subject: 'S',
      body: 'B',
      accountType: 'work',
      route: 'work_alt',
    });
    assert.ok(url.startsWith('https://outlook.office.com/owa/?path=/mail/action/compose&'));
    assert.strictEqual(param(url, 'to'), '30052@kent.police.uk');
  });

  it('personal fallback URL starts with outlook.live.com compose path', () => {
    const url = buildOutlookWebComposeUrl({
      to: '30052@kent.police.uk',
      subject: 'S',
      body: 'B',
      accountType: 'personal',
    });
    assert.ok(url.startsWith('https://outlook.live.com/mail/0/deeplink/compose?'));
    assert.strictEqual(param(url, 'to'), '30052@kent.police.uk');
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
    assert.ok((param(launchedUrl, 'body') || '').includes('Dear DC Smith,'),
      'body greeting must reach Outlook on the default action: ' + launchedUrl.slice(0, 200));
    assert.ok((param(launchedUrl, 'body') || '').includes('John Doe'),
      'client name must reach Outlook');
    assert.ok((param(launchedUrl, 'body') || '').includes('Holborn'),
      'station must reach Outlook');
    assert.ok((param(launchedUrl, 'body') || '').includes('Robert Cashman'),
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
    assert.ok((param(opens[0], 'body') || '').includes('KEEP_ME_IN_URL'), opens[0]);
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
    setField(env.document, 'date',         '2026-04-29');
    setField(env.document, 'time',         '10:00');
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks(8);

    assert.strictEqual(env.opens.length, 1, 'send did not reach openOutlookWebEmail');
    const launchUrl = env.opens[0];
    assert.ok(launchUrl.startsWith('https://outlook.live.com/mail/0/deeplink/compose'),
      'personal must hit outlook.live.com: ' + launchUrl.slice(0, 200));
    assert.strictEqual(param(launchUrl, 'to'), 'oic@met.police.uk');
    assert.ok((param(launchUrl, 'body') || '').includes('John Doe'));
    assert.ok((param(launchUrl, 'body') || '').includes('Holborn'));
    /* v1.6.4 — bare "Smith" renders as "Officer Smith" via officerSalutation. */
    assert.ok((param(launchUrl, 'body') || '').includes('Dear Officer Smith,'));
  });

  it("setting outlookAccountType='mailto' produces a mailto: URI with subject + body", async () => {
    _resetOutlookWebAckForTests();
    const env = makeWiredEnv('mailto');
    openModal(env);
    setField(env.document, 'officerEmail', 'oic@met.police.uk');
    setField(env.document, 'oicName',      'Williams');
    setField(env.document, 'clientName',   'Alice Brown');
    setField(env.document, 'station',      'Camden');
    setField(env.document, 'date',         '2026-04-29');
    setField(env.document, 'time',         '11:30');
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks(8);

    assert.strictEqual(env.opens.length, 1);
    const launchUrl = env.opens[0];
    assert.ok(launchUrl.startsWith('mailto:'), 'mailto must use mailto: scheme: ' + launchUrl.slice(0, 100));
    assert.ok(launchUrl.startsWith('mailto:' + encodeURIComponent('oic@met.police.uk')));
    /* v1.6.4 — the disclosure subject template was rewritten to put the
       template label first (matches user spec: "Disclosure request - <name> - <station> - <date>"). */
    assert.ok(launchUrl.includes('subject=' + encodeURIComponent('Disclosure request - Alice Brown - Camden - 29/04/2026')),
      'unexpected subject in URL: ' + launchUrl);
    assert.ok(launchUrl.includes(encodeURIComponent('Dear Officer Williams,')));
  });

  it("setting outlookAccountType='work' keeps the existing outlook.office.com path", async () => {
    _resetOutlookWebAckForTests();
    const env = makeWiredEnv('work');
    openModal(env);
    setField(env.document, 'officerEmail', 'oic@firm.example');
    setField(env.document, 'clientName',   'Test Client');
    setField(env.document, 'station',      'Westminster');
    setField(env.document, 'date',         '2026-04-29');
    setField(env.document, 'time',         '14:00');
    pickTemplate(env.document, 'system:representation');

    env.document.getElementById('qe-send').click();
    await tickMicrotasks(8);

    const launchUrl = env.opens[0];
    /* v1.6.5 — even on Windows, work uses plain HTTPS. The old
       microsoft-edge: wrapper could land in outlook.cloud.microsoft/mail
       (inbox) and lose the compose route. */
    assert.ok(
      launchUrl.startsWith('https://outlook.office.com/'),
      'work must hit outlook.office.com: ' + launchUrl.slice(0, 200)
    );
    assert.ok(!launchUrl.startsWith('microsoft-edge:'), 'must not use microsoft-edge: wrapper');
    assert.ok((param(launchUrl, 'body') || '').includes('Test Client'));
  });

  it('Try alternate compose button uses the /owa/?path=/mail/action/compose route', async () => {
    _resetOutlookWebAckForTests();
    const env = makeWiredEnv('work');
    openModal(env);
    setField(env.document, 'officerEmail', 'oic@firm.example');
    setField(env.document, 'clientName', 'Test Client');
    setField(env.document, 'station', 'Westminster');
    setField(env.document, 'date', '2026-04-29');
    setField(env.document, 'time', '14:00');
    pickTemplate(env.document, 'system:representation');
    env.document.getElementById('qe-send-alt').click();
    await tickMicrotasks(8);
    assert.strictEqual(env.opens.length, 1);
    assert.ok(env.opens[0].startsWith('https://outlook.office.com/owa/?path=/mail/action/compose&'), env.opens[0]);
  });

  it('Try personal compose button forces outlook.live.com route even when setting is work', async () => {
    _resetOutlookWebAckForTests();
    const env = makeWiredEnv('work');
    openModal(env);
    setField(env.document, 'officerEmail', 'oic@firm.example');
    setField(env.document, 'clientName', 'Test Client');
    setField(env.document, 'station', 'Westminster');
    setField(env.document, 'date', '2026-04-29');
    setField(env.document, 'time', '14:00');
    pickTemplate(env.document, 'system:representation');
    env.document.getElementById('qe-send-personal').click();
    await tickMicrotasks(8);
    assert.strictEqual(env.opens.length, 1);
    assert.ok(env.opens[0].startsWith('https://outlook.live.com/mail/0/deeplink/compose?'), env.opens[0]);
  });

  it('ACCEPTANCE: David Walter disclosure opens office.com compose with to/subject/body', async () => {
    _resetOutlookWebAckForTests();
    const env = makeWiredEnv(undefined); // no user setting saved -> default work / office.com
    openModal(env);

    setField(env.document, 'officerEmail',   '30052@kent.police.uk');
    setField(env.document, 'oicName',        'Jarvis');
    setField(env.document, 'clientName',     'David Walter');
    setField(env.document, 'station',        'Maidstone');
    setField(env.document, 'offenceType',    'Common Assault');
    setField(env.document, 'attendanceType', 'voluntary');
    setField(env.document, 'date',           '2026-04-30');
    setField(env.document, 'time',           '09:00');
    pickTemplate(env.document, 'system:disclosure');

    const copyBodyBeforeSend = env.document.getElementById('quick-email-body').value;
    env.document.getElementById('qe-send').click();
    await tickMicrotasks(8);

    assert.strictEqual(env.opens.length, 1, 'Outlook compose URL should open exactly once');
    const launchUrl = env.opens[0];
    assert.ok(launchUrl.includes('/mail/deeplink/compose?'),
      'URL must be a compose deeplink, not inbox/home: ' + launchUrl.slice(0, 200));
    assert.ok(
      launchUrl.startsWith('https://outlook.office.com/mail/deeplink/compose'),
      'default Quick Email Outlook surface should be office.com compose: ' + launchUrl.slice(0, 200)
    );
    assert.ok(!launchUrl.startsWith('microsoft-edge:'), 'must not use microsoft-edge: wrapper');
    assert.strictEqual(param(launchUrl, 'to'), '30052@kent.police.uk', 'to param missing');
    assert.strictEqual(param(launchUrl, 'subject'), 'Disclosure request - David Walter - Maidstone - 30/04/2026',
      'subject param missing or wrong: ' + launchUrl);
    assert.ok(launchUrl.includes('body='), 'body param missing');
    var decodedBody = param(launchUrl, 'body') || '';
    assert.ok(decodedBody.includes('Dear Officer Jarvis,'), 'body missing rank-aware salutation');
    assert.ok(decodedBody.includes('David Walter'), 'body missing client name');
    assert.ok(decodedBody.includes('Maidstone Police Station'),
      'body must use full "Maidstone Police Station" wording: ' + decodedBody);
    assert.ok(decodedBody.includes('Common Assault'), 'body missing offence');
    assert.ok(decodedBody.includes('09:00'), 'body missing 24h time');
    assert.ok(copyBodyBeforeSend.includes('Dear Officer Jarvis,'), 'Copy button should see same generated body source');
    assert.ok(copyBodyBeforeSend.includes('David Walter'), 'generated body source missing client');
    assert.ok(copyBodyBeforeSend.includes('Maidstone Police Station'),
      'Copy body must contain the full "Maidstone Police Station" wording');
  });

  it('stationLabel: appends "Police Station" only when not already present', () => {
    const fn = require('../renderer/quick-email-template-render.js'); // ensures module is required for coverage
    void fn; // file uses IIFE, no exports — call buildStationLabel via global below
    /* Re-execute the renderer in a sandbox to expose buildStationLabel. */
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'quick-email-template-render.js'), 'utf8'), ctx);
    assert.strictEqual(ctx.buildStationLabel('Maidstone'), 'Maidstone Police Station');
    assert.strictEqual(ctx.buildStationLabel('Maidstone Police Station'), 'Maidstone Police Station');
    assert.strictEqual(ctx.buildStationLabel('Charing Cross Station'), 'Charing Cross Station');
    assert.strictEqual(ctx.buildStationLabel(''), '');
    assert.strictEqual(ctx.buildStationLabel('  '), '');
  });

  it('More routes toggle reveals the alternate route panel when clicked', async () => {
    _resetOutlookWebAckForTests();
    const env = makeWiredEnv('work');
    openModal(env);
    const panel = env.document.getElementById('quick-email-routes-panel');
    const toggle = env.document.getElementById('qe-routes-toggle');
    assert.ok(panel,  'routes panel must exist');
    assert.ok(toggle, 'routes toggle must exist');
    assert.strictEqual(panel.style.display, 'none', 'panel must be hidden by default');
    toggle.click();
    assert.notStrictEqual(panel.style.display, 'none', 'panel must be visible after toggle');
    toggle.click();
    assert.strictEqual(panel.style.display, 'none', 'panel must hide again after second toggle');
  });

  it('post-send follow-up prompt appears on successful launch and persists working route on Yes', async () => {
    _resetOutlookWebAckForTests();
    const env = makeWiredEnv('work');
    /* Spy on setSettings so we can assert persistence. */
    const persisted = [];
    env.window.api.setSettings = (s) => { persisted.push(s); return Promise.resolve(); };
    openModal(env);
    setField(env.document, 'officerEmail', 'oic@firm.example');
    setField(env.document, 'clientName',   'Persist Client');
    setField(env.document, 'station',      'Westminster');
    setField(env.document, 'date',         '2026-04-29');
    setField(env.document, 'time',         '14:00');
    pickTemplate(env.document, 'system:representation');
    env.document.getElementById('qe-send-alt').click();
    await tickMicrotasks(8);
    const followup = env.document.getElementById('quick-email-followup');
    assert.ok(followup, 'followup container must exist');
    assert.notStrictEqual(followup.style.display, 'none', 'followup must be visible after success');
    const yesBtn = followup.querySelector('.qe-followup-yes');
    assert.ok(yesBtn, 'Yes button must be present');
    yesBtn.click();
    assert.ok(persisted.length >= 1, 'setSettings should be called when user confirms route');
    const last = persisted[persisted.length - 1];
    assert.strictEqual(last.lastWorkingOutlookRoute, 'work_alt');
    assert.strictEqual(last.lastWorkingOutlookAccountType, 'work');
  });

  it('persisted route is used as default route on next Send via Outlook Web', async () => {
    _resetOutlookWebAckForTests();
    const env = makeWiredEnv('work');
    env.window._appSettingsCache = Object.assign({}, env.window._appSettingsCache || {}, {
      outlookAccountType: 'work',
      lastWorkingOutlookRoute: 'work_alt',
      lastWorkingOutlookAccountType: 'work',
    });
    openModal(env);
    setField(env.document, 'officerEmail', 'oic@firm.example');
    setField(env.document, 'clientName',   'Default Route Client');
    setField(env.document, 'station',      'Westminster');
    setField(env.document, 'date',         '2026-04-29');
    setField(env.document, 'time',         '14:00');
    pickTemplate(env.document, 'system:representation');
    env.document.getElementById('qe-send').click();
    await tickMicrotasks(8);
    assert.strictEqual(env.opens.length, 1, 'one launch expected');
    assert.ok(env.opens[0].startsWith('https://outlook.office.com/owa/?path=/mail/action/compose&'),
      'persisted work_alt route should be used by default Send: ' + env.opens[0]);
  });
});

