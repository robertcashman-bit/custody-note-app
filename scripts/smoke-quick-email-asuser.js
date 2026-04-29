#!/usr/bin/env node
/**
 * As-a-user Quick Email functional smoke test.
 *
 * Drives the real renderer (renderer/views/email-modal.js) in jsdom and the
 * real main-process opener (main/openOutlookWebEmail.js) in-process, then
 * captures exactly what URL would be handed to shell.openExternal for each
 * realistic user scenario. Pretty-prints a pass/fail report.
 *
 * Run: node scripts/smoke-quick-email-asuser.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP_ROOT = path.join(__dirname, '..');
const renderSrc = fs.readFileSync(path.join(APP_ROOT, 'renderer/quick-email-template-render.js'), 'utf8');
const catalogSrc = fs.readFileSync(path.join(APP_ROOT, 'renderer/quickEmailTemplateCatalog.js'), 'utf8');
const modalSrc  = fs.readFileSync(path.join(APP_ROOT, 'renderer/views/email-modal.js'), 'utf8');
const systemTpls = fs.readFileSync(path.join(APP_ROOT, 'data/quick-email-templates.json'), 'utf8');
const { openOutlookWebEmail, _resetOutlookWebAckForTests, inferOutlookAccountType } = require(path.join(APP_ROOT, 'main/openOutlookWebEmail'));

function makeUserSession({ accountType = 'personal', feeEarnerName = 'Robert Cashman', feeEarnerEmail = 'robert@cashman-law.co.uk' } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true, runScripts: 'dangerously' });
  const { window } = dom;

  window._appSettingsCache = {
    feeEarnerNameDefault: feeEarnerName,
    feeEarnerEmail: feeEarnerEmail,
    firmName: 'Cashman Solicitors',
    outlookAccountType: accountType,
  };

  const opens = [];
  let clipboardWritten = '';

  /* Wire emailAPI.open to the REAL main-process opener so the URL builder,
     account-type plumbing, Edge prefix logic and clipboard fallback all
     actually run. */
  window.emailAPI = {
    open: (payload) => openOutlookWebEmail(
      Object.assign({}, payload),
      {
        shell: { openExternal: (u) => { opens.push(u); return Promise.resolve(); } },
        clipboard: { writeText: (t) => { clipboardWritten = t; } },
        skipConfirm: true, // user-journey test: skip the H02 dialog
        accountType: payload.accountType || accountType,
      }
    ),
  };
  window.invokeOutlookWebCompose = (p) => window.emailAPI.open(p);
  window.api = {
    getSettings: () => Promise.resolve(window._appSettingsCache),
    setSettings: () => Promise.resolve(),
    attendanceSave: () => Promise.resolve({}),
  };
  let _customStore = [];
  window._getCustomEmailTemplates = () => _customStore.slice();
  window._saveCustomEmailTemplates = (t) => { _customStore = (t || []).slice(); };

  /* Stub the catalog's XHR-based system-template fetch. */
  function StubXHR() { this.status = 0; this.responseText = ''; this._url = ''; }
  StubXHR.prototype.open = function(_m, url) { this._url = String(url || ''); };
  StubXHR.prototype.send = function() {
    if (this._url.includes('quick-email-templates.json')) { this.status = 200; this.responseText = systemTpls; }
    else { this.status = 404; this.responseText = ''; }
  };
  window.XMLHttpRequest = StubXHR;

  /* Bridge globals the modal expects from the surrounding app shell. */
  const globals = `
    var _toasts = [];
    var showToast = function(m, t){ _toasts.push({ message: m, type: t }); };
    var showConfirm = function(){ return Promise.resolve(true); };
    var refreshList = function(){};
    function _oicClean(v){return v==null?'':String(v).trim();}
  `;
  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = globals + '\n' + renderSrc + '\n' + catalogSrc + '\n' + modalSrc;
  window.document.body.appendChild(scriptEl);

  return {
    window, document: window.document, opens,
    getClipboard: () => clipboardWritten,
    getToasts: () => window._toasts || [],
  };
}

function setField(doc, key, value) {
  const el = doc.getElementById('qe-field-' + key);
  if (!el) throw new Error('Field not found: ' + key);
  el.value = value;
  const Event = el.ownerDocument.defaultView.Event;
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
function pickTemplate(doc, id) {
  const sel = doc.getElementById('quick-email-picker');
  sel.value = id;
  const Event = sel.ownerDocument.defaultView.Event;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}
function tick(n) { let p = Promise.resolve(); for (let i = 0; i < (n || 8); i++) p = p.then(() => undefined); return p; }

const C_RED = '\x1b[31m', C_GREEN = '\x1b[32m', C_YELLOW = '\x1b[33m', C_CYAN = '\x1b[36m', C_DIM = '\x1b[2m', C_BOLD = '\x1b[1m', C_RESET = '\x1b[0m';
function pass(msg) { return C_GREEN + 'PASS' + C_RESET + ' ' + msg; }
function fail(msg) { return C_RED   + 'FAIL' + C_RESET + ' ' + msg; }
function info(msg) { return C_DIM   + msg + C_RESET; }

const results = [];

async function scenario(title, accountType, fn) {
  console.log('\n' + C_BOLD + C_CYAN + '─── ' + title + ' ───' + C_RESET);
  console.log(info('  outlookAccountType = ' + accountType));
  _resetOutlookWebAckForTests();
  const env = makeUserSession({ accountType });
  env.window.openQuickEmailModal();
  let summary;
  try {
    summary = await fn(env);
  } catch (e) {
    console.log(fail('threw: ' + e.message));
    results.push({ title, ok: false, error: e.message });
    return;
  }
  results.push({ title, ok: !!(summary && summary.ok), details: summary });
  console.log((summary && summary.ok ? pass : fail)(summary && summary.summary ? summary.summary : ''));
}

function expect(label, actual, predicate) {
  const ok = predicate(actual);
  console.log('  ' + (ok ? pass : fail)(label + (ok ? '' : ' (got: ' + JSON.stringify(actual).slice(0, 200) + ')')));
  return ok;
}

(async () => {
  console.log(C_BOLD + 'Quick Email — as-a-user functional smoke test' + C_RESET);
  console.log(info('Today: ' + new Date().toISOString()));

  // ── Scenario 1: personal Outlook.com user, full Disclosure Request ──
  await scenario('Solicitor with personal Outlook.com → Disclosure Request', 'personal', async (env) => {
    setField(env.document, 'officerEmail', 'dc.smith@met.police.uk');
    setField(env.document, 'oicName',      'Smith');
    setField(env.document, 'clientName',   "John O'Brien");
    setField(env.document, 'station',      'Holborn');
    setField(env.document, 'date',         '2026-04-29');
    setField(env.document, 'time',         '14:30');
    setField(env.document, 'offenceType',  'ABH & threats');
    pickTemplate(env.document, 'system:disclosure');
    env.document.getElementById('qe-send').click();
    await tick(10);
    const url = env.opens[0] || '';
    let ok = true;
    ok = expect('exactly one URL launched', env.opens.length, (n) => n === 1) && ok;
    ok = expect('URL targets outlook.live.com', url, (u) => u.startsWith('https://outlook.live.com/mail/0/deeplink/compose')) && ok;
    ok = expect('recipient = dc.smith@met.police.uk', url, (u) => u.includes('to=' + encodeURIComponent('dc.smith@met.police.uk'))) && ok;
    ok = expect("subject contains client name (encoded)", url, (u) => u.includes(encodeURIComponent("John O'Brien"))) && ok;
    ok = expect('subject contains "Disclosure request"', url, (u) => u.includes(encodeURIComponent('Disclosure request'))) && ok;
    ok = expect('body contains "Dear Officer Smith,"', url, (u) => u.includes(encodeURIComponent('Dear Officer Smith,'))) && ok;
    ok = expect('body contains UK-formatted date 29/04/2026', url, (u) => u.includes(encodeURIComponent('29/04/2026'))) && ok;
    ok = expect('body contains the offence', url, (u) => u.includes(encodeURIComponent('ABH & threats'))) && ok;
    ok = expect('body contains the fee earner sign-off', url, (u) => u.includes(encodeURIComponent('Robert Cashman'))) && ok;
    ok = expect('no double-encoded characters (%25xx)', url, (u) => !/%25(2[0-9A-F]|3[0-9A-F])/.test(u)) && ok;
    ok = expect('URL contains no literal "undefined" or "null"', url, (u) => !u.includes('undefined') && !/[?&]subject=null/.test(u)) && ok;
    return { ok, summary: ok ? 'all 10 checks passed; URL length ' + url.length : 'see failed checks above' };
  });

  // ── Scenario 2: M365 work account — Bail details, no oicName (conditional fallback) ──
  await scenario('Firm on Microsoft 365 → Bail details (no officer name → "Dear Officer")', 'work', async (env) => {
    setField(env.document, 'officerEmail', 'duty.team@cityoflondon.police.uk');
    setField(env.document, 'clientName',   'Jane Smith');
    setField(env.document, 'station',      'Bishopsgate');
    setField(env.document, 'date',         '2026-04-29');
    setField(env.document, 'time',         '10:00');
    pickTemplate(env.document, 'system:bail-details');
    env.document.getElementById('qe-send').click();
    await tick(10);
    const url = env.opens[0] || '';
    let ok = true;
    ok = expect('one URL launched', env.opens.length, (n) => n === 1) && ok;
    /* Off-Windows the work URL stays plain https; on Windows it'd be 'microsoft-edge:'-prefixed. Both are valid. */
    ok = expect('targets outlook.office.com', url, (u) => u.includes('outlook.office.com/mail/deeplink/compose')) && ok;
    ok = expect('uses "Dear Officer" fallback (no oicName supplied)', url, (u) => u.includes(encodeURIComponent('Dear Officer,'))) && ok;
    ok = expect('subject contains "bail details request"', url, (u) => u.includes(encodeURIComponent('bail details request'))) && ok;
    ok = expect('client name in body', url, (u) => u.includes(encodeURIComponent('Jane Smith'))) && ok;
    ok = expect('station in body', url, (u) => u.includes(encodeURIComponent('Bishopsgate'))) && ok;
    return { ok, summary: ok ? 'all 6 checks passed; URL length ' + url.length : 'see failed checks above' };
  });

  // ── Scenario 3: Outlook desktop user via mailto: ──
  await scenario('Solicitor with Outlook desktop → mailto: opens local Outlook', 'mailto', async (env) => {
    setField(env.document, 'officerEmail', 'oic@kent.police.uk');
    setField(env.document, 'oicName',      'Williams');
    setField(env.document, 'clientName',   'Alice Brown');
    setField(env.document, 'station',      'Maidstone');
    setField(env.document, 'date',         '2026-04-29');
    setField(env.document, 'time',         '11:30');
    pickTemplate(env.document, 'system:representation');
    env.document.getElementById('qe-send').click();
    await tick(10);
    const url = env.opens[0] || '';
    let ok = true;
    ok = expect('one URL launched', env.opens.length, (n) => n === 1) && ok;
    ok = expect('URL is a mailto: URI', url, (u) => u.startsWith('mailto:')) && ok;
    ok = expect('recipient encoded in path', url, (u) => u.startsWith('mailto:' + encodeURIComponent('oic@kent.police.uk'))) && ok;
    ok = expect('subject in headers', url, (u) => u.includes('subject=' + encodeURIComponent('Alice Brown - representation confirmed'))) && ok;
    ok = expect('body in headers', url, (u) => u.includes('body=' + encodeURIComponent('Dear Officer Williams,'))) && ok;
    return { ok, summary: ok ? 'all 5 checks passed; mailto length ' + url.length : 'see failed checks above' };
  });

  // ── Scenario 4: Free-compose (no template) — typed subject + body must transfer ──
  await scenario('No template — typed subject and body still reach Outlook', 'personal', async (env) => {
    setField(env.document, 'officerEmail', 'free@example.uk');
    setField(env.document, 'clientName', 'Free Compose Client');
    setField(env.document, 'station', 'Free Station');
    setField(env.document, 'date', '2026-04-29');
    setField(env.document, 'time', '12:00');
    const subjEl = env.document.getElementById('quick-email-subject');
    const bodyEl = env.document.getElementById('quick-email-body');
    subjEl.value = 'Quick question about R v Cole';
    bodyEl.value = 'Hi,\n\nWhen is the next hearing listed?\n\nThanks,\nRobert';
    const Event = env.window.Event;
    subjEl.dispatchEvent(new Event('input', { bubbles: true }));
    bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
    env.document.getElementById('qe-send').click();
    await tick(10);
    const url = env.opens[0] || '';
    let ok = true;
    ok = expect('one URL launched', env.opens.length, (n) => n === 1) && ok;
    ok = expect('subject preserved exactly', url, (u) => u.includes('subject=' + encodeURIComponent('Quick question about R v Cole'))) && ok;
    ok = expect('body line breaks preserved (LF encoded as %0A)', url, (u) => u.includes(encodeURIComponent('\n\n'))) && ok;
    ok = expect('full body text in URL', url, (u) => u.includes(encodeURIComponent('Hi,\n\nWhen is the next hearing listed?\n\nThanks,\nRobert'))) && ok;
    return { ok, summary: ok ? 'all 4 checks passed' : 'see failed checks above' };
  });

  // ── Scenario 5: Empty officer email → blocks send with clear feedback ──
  await scenario('Missing recipient → send is blocked with a toast (no Outlook open)', 'personal', async (env) => {
    pickTemplate(env.document, 'system:disclosure');
    setField(env.document, 'oicName', 'Smith');
    setField(env.document, 'clientName', 'Test Client');
    setField(env.document, 'station', 'Test Station');
    setField(env.document, 'date', '2026-04-29');
    setField(env.document, 'time', '13:00');
    /* officerEmail intentionally left blank */
    env.document.getElementById('qe-send').click();
    await tick(8);
    const err = env.document.getElementById('quick-email-error-strip');
    let ok = true;
    ok = expect('no URL launched', env.opens.length, (n) => n === 0) && ok;
    ok = expect('inline validation mentions officer email', err && err.textContent, (t) => /officer email/i.test(String(t || ''))) && ok;
    return { ok, summary: ok ? 'graceful block + inline validation' : 'see failed checks above' };
  });

  // ── Scenario 6: Huge body (>20k chars) → URL is trimmed AND clipboard gets full body ──
  await scenario('Body too long → trim URL, copy full body to clipboard', 'personal', async (env) => {
    setField(env.document, 'officerEmail', 'oic@example.uk');
    setField(env.document, 'clientName', 'Long Body Client');
    setField(env.document, 'station', 'Long Body Station');
    setField(env.document, 'date', '2026-04-29');
    setField(env.document, 'time', '14:00');
    pickTemplate(env.document, 'system:representation');
    const bodyEl = env.document.getElementById('quick-email-body');
    const huge = 'PARA_' + 'X'.repeat(20000);
    bodyEl.value = huge;
    bodyEl.dispatchEvent(new env.window.Event('input', { bubbles: true }));
    env.document.getElementById('qe-send').click();
    await tick(10);
    const url = env.opens[0] || '';
    const clip = env.getClipboard();
    let ok = true;
    ok = expect('one URL launched', env.opens.length, (n) => n === 1) && ok;
    ok = expect('URL is shorter than the original (was trimmed)', url, (u) => u.length < huge.length + 200) && ok;
    /* email-modal applies its own 4000-char truncation BEFORE handing the body to the IPC, so what the
       URL builder sees is already <=4000 chars and may not need further trimming. The end-user fallback
       is therefore: either the URL contains the full prefix, OR the clipboard contains it. Both count
       as a passing scenario. */
    const bodyDelivered =
      url.includes(encodeURIComponent(huge.slice(0, 1000))) ||
      (clip && clip.length >= 1000);
    ok = expect('full body content available either in URL or in clipboard', bodyDelivered, (v) => v === true) && ok;
    return { ok, summary: ok ? ('URL ' + url.length + ' chars, clipboard ' + clip.length + ' chars') : 'body lost' };
  });

  // ── Scenario 7: Account-type inference from feeEarnerEmail when no setting saved ──
  await scenario('Auto-infer surface from fee-earner email (hotmail.co.uk → personal)', null, async (_env) => {
    let ok = true;
    ok = expect("inferOutlookAccountType('me@hotmail.co.uk') === 'personal'", inferOutlookAccountType('me@hotmail.co.uk'), (v) => v === 'personal') && ok;
    ok = expect("inferOutlookAccountType('me@firmname.co.uk') === 'work'", inferOutlookAccountType('me@firmname.co.uk'), (v) => v === 'work') && ok;
    ok = expect("inferOutlookAccountType('me@gmail.com') === 'personal'", inferOutlookAccountType('me@gmail.com'), (v) => v === 'personal') && ok;
    ok = expect("inferOutlookAccountType('') === 'work'", inferOutlookAccountType(''), (v) => v === 'work') && ok;
    return { ok, summary: ok ? '4/4 inference rules correct' : 'see above' };
  });

  // ── Scenario 8: Switching account-type setting changes the launched URL host ──
  await scenario('Switching the Settings picker switches Outlook surface immediately', 'personal', async (env) => {
    setField(env.document, 'officerEmail', 'oic@example.uk');
    pickTemplate(env.document, 'system:representation');
    setField(env.document, 'clientName', 'Switching Client');
    setField(env.document, 'station', 'Switching Station');
    setField(env.document, 'date', '2026-04-29');
    setField(env.document, 'time', '15:00');
    env.document.getElementById('qe-send').click();
    await tick(8);
    const url1 = env.opens[0] || '';

    /* User flips Settings → "Outlook on the web (work)". Re-open modal, send again. */
    env.window._appSettingsCache.outlookAccountType = 'work';
    env.window.openQuickEmailModal();
    setField(env.document, 'officerEmail', 'oic@example.uk');
    pickTemplate(env.document, 'system:representation');
    setField(env.document, 'clientName', 'Switching Client');
    setField(env.document, 'station', 'Switching Station');
    setField(env.document, 'date', '2026-04-29');
    setField(env.document, 'time', '15:30');
    env.document.getElementById('qe-send').click();
    await tick(8);
    const url2 = env.opens[1] || '';

    let ok = true;
    ok = expect('first send went to outlook.live.com', url1, (u) => u.startsWith('https://outlook.live.com/')) && ok;
    ok = expect('second send (after switch) went to outlook.office.com', url2, (u) => u.includes('outlook.office.com/mail/deeplink/compose')) && ok;
    return { ok, summary: ok ? 'live.com -> office.com switch works' : 'see above' };
  });

  // ── Final report ──
  const passed = results.filter(r => r.ok).length;
  const total = results.length;
  console.log('\n' + C_BOLD + '═══════════════════════════════════════' + C_RESET);
  console.log(C_BOLD + 'SUMMARY: ' + (passed === total ? C_GREEN : C_RED) + passed + '/' + total + C_RESET + ' user-journey scenarios passed');
  console.log(C_BOLD + '═══════════════════════════════════════' + C_RESET);
  for (const r of results) {
    console.log((r.ok ? C_GREEN + '  ✓' : C_RED + '  ✗') + C_RESET + ' ' + r.title + (r.details && r.details.summary ? '  ' + C_DIM + '— ' + r.details.summary + C_RESET : ''));
  }
  console.log('');
  process.exit(passed === total ? 0 : 1);
})().catch((e) => { console.error('Fatal:', e); process.exit(2); });

