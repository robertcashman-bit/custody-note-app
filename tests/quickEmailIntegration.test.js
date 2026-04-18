/**
 * Quick Email integration tests — full DOM simulation against the new
 * template-first single-screen modal. Uses jsdom and exercises:
 *   1. Modal renders with template picker + form + preview
 *   2. Picking a system template auto-fills subject + body from the catalog
 *   3. Editing a matter-detail field live-updates the preview
 *   4. Hand-edits to the message preview survive subsequent field changes
 *   5. Switching to a different template throws away manual edits and
 *      re-renders from the new template
 *   6. Switching to "no template" clears the preview
 *   7. Saving the current preview as a new template converts literal
 *      values back into placeholders silently
 *   8. A user-saved custom template appears in the picker and renders
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

function createEnv(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
  });
  const { window } = dom;

  window._appSettingsCache = { feeEarnerNameDefault: 'Robert Cashman' };
  window.api = {
    getSettings: () => Promise.resolve({}),
    setSettings: () => Promise.resolve(),
    openExternal: () => {},
    attendanceSave: () => Promise.resolve({}),
  };
  window.emailAPI = { open: () => Promise.resolve() };
  window.invokeOutlookWebCompose = (payload) => window.emailAPI.open(payload);

  /* In-memory custom-template store the modal can read/write. */
  let _customStore = (opts.customTemplates || []).slice();
  window._getCustomEmailTemplates = () => _customStore.slice();
  window._saveCustomEmailTemplates = (tpls) => { _customStore = (tpls || []).slice(); };

  /* The catalog tries to load the JSON file via XMLHttpRequest. jsdom's
     XHR can't read disk paths, so we patch it with a synchronous stub
     that returns the bundled JSON for that one URL. */
  const RealXHR = window.XMLHttpRequest;
  function StubXHR() {
    this.status = 0;
    this.responseText = '';
    this._url = '';
  }
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

  return { dom, window, document: window.document, restoreXHR: () => { window.XMLHttpRequest = RealXHR; } };
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
  if (!sel) throw new Error('Template picker not found');
  sel.value = id;
  const Event = sel.ownerDocument.defaultView.Event;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Quick Email modal — template-first DOM', () => {
  let env;
  beforeEach(() => { env = createEnv(); openModal(env); });

  it('renders picker, form, preview, and action buttons', () => {
    assert.ok(env.document.getElementById('quick-email-picker'),  'picker missing');
    assert.ok(env.document.getElementById('quick-email-form'),    'form container missing');
    assert.ok(env.document.getElementById('quick-email-subject'), 'subject preview missing');
    assert.ok(env.document.getElementById('quick-email-body'),    'body preview missing');
    assert.ok(env.document.getElementById('qe-send'),             'send button missing');
    assert.ok(env.document.getElementById('qe-save'),             'save button missing');
  });

  it('picker contains all 5 system templates grouped by category', () => {
    const picker = env.document.getElementById('quick-email-picker');
    const opts = Array.from(picker.querySelectorAll('option')).map(o => o.value).filter(v => v);
    assert.ok(opts.includes('system:bail-details'),        'bail template missing');
    assert.ok(opts.includes('system:representation'),      'representation template missing');
    assert.ok(opts.includes('system:disclosure'),          'disclosure template missing');
    assert.ok(opts.includes('system:follow-up'),           'follow-up template missing');
    assert.ok(opts.includes('system:voluntary-attendance'),'voluntary template missing');
    assert.ok(picker.querySelector('optgroup[label="Bail"]'), 'Bail optgroup missing');
  });

  it('common form fields are always visible', () => {
    ['officerEmail','oicName','clientName','station','offenceType','attendanceType','date','time'].forEach(k => {
      assert.ok(env.document.getElementById('qe-field-' + k), 'expected common field qe-field-' + k);
    });
  });
});

describe('Quick Email modal — template selection auto-fills preview', () => {
  let env;
  beforeEach(() => { env = createEnv(); openModal(env); });

  it('selecting Disclosure renders subject + body with the field values', () => {
    setField(env.document, 'clientName', 'John Doe');
    setField(env.document, 'station',    'Holborn');
    setField(env.document, 'oicName',    'Smith');
    setField(env.document, 'date',       '2026-04-18');

    pickTemplate(env.document, 'system:disclosure');

    const subj = env.document.getElementById('quick-email-subject').value;
    const body = env.document.getElementById('quick-email-body').value;

    assert.ok(subj.includes('John Doe'),       'subject missing client, got: ' + subj);
    assert.ok(subj.includes('Holborn'),        'subject missing station, got: ' + subj);
    assert.ok(/disclosure/i.test(subj),        'subject missing template label');
    assert.ok(body.includes('Dear DC Smith'),  'body missing officer name, got: ' + body);
    assert.ok(body.includes('John Doe'),       'body missing client name');
    assert.ok(body.includes('Holborn'),        'body missing station');
    assert.ok(body.includes('18/04/2026'),     'body missing UK-formatted date, got: ' + body);
    assert.ok(body.includes('Robert Cashman'), 'body missing fee earner');
    assert.ok(!body.includes('{{'),            'unrendered tokens in body');
  });

  it('selecting Bail uses "Dear Officer," when oicName is blank (conditional fallback)', () => {
    setField(env.document, 'clientName', 'Jane Smith');
    setField(env.document, 'station',    'Paddington');

    pickTemplate(env.document, 'system:bail-details');

    const body = env.document.getElementById('quick-email-body').value;
    assert.ok(body.startsWith('Dear Officer,'), 'expected Dear Officer fallback, got: ' + body.slice(0, 40));
    assert.ok(body.includes('Jane Smith'));
    assert.ok(body.includes('Paddington'));
  });

  it('changing oicName after picking a template live-updates the body', () => {
    setField(env.document, 'oicName', 'Smith');
    pickTemplate(env.document, 'system:disclosure');

    setField(env.document, 'oicName', 'Williams');
    const body = env.document.getElementById('quick-email-body').value;
    assert.ok(body.includes('Dear DC Williams'), 'live update missing, got: ' + body);
    assert.ok(!body.includes('Dear DC Smith'),   'old officer name should be gone');
  });

  it('changing clientName live-updates the subject', () => {
    setField(env.document, 'clientName', 'Alice');
    pickTemplate(env.document, 'system:disclosure');
    setField(env.document, 'clientName', 'Bob');

    const subj = env.document.getElementById('quick-email-subject').value;
    assert.ok(subj.includes('Bob'),    'subject not updated, got: ' + subj);
    assert.ok(!subj.includes('Alice'), 'old client should be gone');
  });
});

describe('Quick Email modal — manual edit protection', () => {
  let env;
  beforeEach(() => { env = createEnv(); openModal(env); });

  it('hand-edited subject is preserved across field changes', () => {
    pickTemplate(env.document, 'system:disclosure');

    const subjEl = env.document.getElementById('quick-email-subject');
    subjEl.value = 'My custom subject';
    const Event = env.window.Event;
    subjEl.dispatchEvent(new Event('input', { bubbles: true }));

    setField(env.document, 'oicName', 'NewOfficer');
    assert.strictEqual(subjEl.value, 'My custom subject');
  });

  it('hand-edited body is preserved across field changes', () => {
    pickTemplate(env.document, 'system:disclosure');
    const bodyEl = env.document.getElementById('quick-email-body');
    bodyEl.value = 'My custom body text';
    const Event = env.window.Event;
    bodyEl.dispatchEvent(new Event('input', { bubbles: true }));

    setField(env.document, 'oicName', 'NewOfficer');
    assert.strictEqual(bodyEl.value, 'My custom body text');
  });

  it('switching to a different template discards manual edits and re-renders', () => {
    pickTemplate(env.document, 'system:disclosure');
    const bodyEl = env.document.getElementById('quick-email-body');
    bodyEl.value = 'Custom body, ignore me';
    const Event = env.window.Event;
    bodyEl.dispatchEvent(new Event('input', { bubbles: true }));

    setField(env.document, 'clientName', 'Test');
    pickTemplate(env.document, 'system:bail-details');

    const newBody = env.document.getElementById('quick-email-body').value;
    assert.ok(/bail/i.test(newBody), 'new template body should mention bail, got: ' + newBody);
    assert.ok(!newBody.includes('Custom body, ignore me'), 'manual edits should be discarded');
  });

  it('switching to "no template" clears the preview', () => {
    pickTemplate(env.document, 'system:disclosure');
    setField(env.document, 'clientName', 'Alice');

    const beforeBody = env.document.getElementById('quick-email-body').value;
    assert.ok(beforeBody.includes('Alice'));

    pickTemplate(env.document, '');
    assert.strictEqual(env.document.getElementById('quick-email-subject').value, '');
    assert.strictEqual(env.document.getElementById('quick-email-body').value,    '');
  });
});

describe('Quick Email modal — value-to-placeholder save flow', () => {
  let env;
  beforeEach(() => { env = createEnv(); openModal(env); });

  it('_valuesToPlaceholders converts field values back into placeholders', () => {
    const fn = env.window._valuesToPlaceholders;
    const map = {
      clientName:    'John Doe',
      oicName:       'Smith',
      station:       'Holborn',
      date:          '18/04/2026',
      feeEarnerName: 'Robert Cashman'
    };
    const text   = 'Dear DC Smith,\n\nRe: John Doe at Holborn on 18/04/2026.\n\nRobert Cashman';
    const result = fn(text, map);
    assert.ok(result.includes('{{oicName}}'),       result);
    assert.ok(result.includes('{{clientName}}'),    result);
    assert.ok(result.includes('{{station}}'),       result);
    assert.ok(result.includes('{{date}}'),          result);
    assert.ok(result.includes('{{feeEarnerName}}'), result);
  });

  it('_valuesToPlaceholders is case-insensitive', () => {
    const fn = env.window._valuesToPlaceholders;
    const out = fn('Station: HOLBORN and holborn and Holborn', { station: 'holborn' });
    assert.strictEqual(out, 'Station: {{station}} and {{station}} and {{station}}');
  });

  it('_valuesToPlaceholders ignores values shorter than 2 chars', () => {
    const fn = env.window._valuesToPlaceholders;
    const out = fn('A client at Holborn', { clientName: 'A', station: 'Holborn' });
    assert.ok(out.includes('A client'));
    assert.ok(out.includes('{{station}}'));
  });
});

describe('Quick Email modal — user-saved custom template', () => {
  let env;
  beforeEach(() => {
    env = createEnv({ customTemplates: [{
      id:       'cn-etpl-test-1',
      name:     'My Test Template',
      category: 'Other',
      subject:  '{{clientName}} - {{station}} - Custom Subject',
      body:     'Hi {{oicName}},\n\nRegarding {{clientName}} at {{station}}.\n\nBest,\n{{feeEarnerName}}',
      scope:    'officer'
    }]});
    openModal(env);
  });

  it('appears in the picker under "Your saved templates"', () => {
    const picker = env.document.getElementById('quick-email-picker');
    const opt = Array.from(picker.querySelectorAll('option')).find(o => o.value === 'cn-etpl-test-1');
    assert.ok(opt, 'custom template missing from picker');
    assert.ok(opt.textContent.includes('My Test Template'));
    assert.ok(picker.querySelector('optgroup[label="Your saved templates"]'));
  });

  it('renders correctly when selected', () => {
    setField(env.document, 'clientName', 'Alice Brown');
    setField(env.document, 'station',    'Camden');
    setField(env.document, 'oicName',    'Taylor');

    pickTemplate(env.document, 'cn-etpl-test-1');

    const subj = env.document.getElementById('quick-email-subject').value;
    const body = env.document.getElementById('quick-email-body').value;
    assert.ok(subj.includes('Alice Brown'),    'subject missing client, got: ' + subj);
    assert.ok(subj.includes('Camden'),         'subject missing station');
    assert.ok(body.includes('Hi Taylor'),      'body missing officer name, got: ' + body);
    assert.ok(body.includes('Alice Brown'));
    assert.ok(body.includes('Camden'));
    assert.ok(body.includes('Robert Cashman'));
  });

  it('field changes after selecting a custom template live-update the body', () => {
    setField(env.document, 'oicName', 'Taylor');
    pickTemplate(env.document, 'cn-etpl-test-1');

    setField(env.document, 'oicName', 'Morgan');
    const body = env.document.getElementById('quick-email-body').value;
    assert.ok(body.includes('Hi Morgan'), 'live update missing, got: ' + body);
  });

  it('exposes Edit link only for user templates', () => {
    const link = env.document.getElementById('quick-email-edit-link');
    /* No template chosen yet → link hidden. */
    assert.strictEqual(link.style.display, 'none');

    pickTemplate(env.document, 'system:disclosure');
    assert.strictEqual(link.style.display, 'none', 'system templates should not be editable');

    pickTemplate(env.document, 'cn-etpl-test-1');
    assert.notStrictEqual(link.style.display, 'none', 'user templates should be editable');
  });

  it('exposes Delete button only for user templates', () => {
    const btn = env.document.getElementById('quick-email-delete-btn');
    assert.strictEqual(btn.style.display, 'none');

    pickTemplate(env.document, 'system:disclosure');
    assert.strictEqual(btn.style.display, 'none');

    pickTemplate(env.document, 'cn-etpl-test-1');
    assert.notStrictEqual(btn.style.display, 'none');
  });

  it('toolbar Delete removes the saved template after confirm', async () => {
    pickTemplate(env.document, 'cn-etpl-test-1');
    env.document.getElementById('quick-email-delete-btn').click();
    /* showConfirm().then(...) runs on a microtask — flush before asserting. */
    await Promise.resolve();
    await Promise.resolve();

    const picker = env.document.getElementById('quick-email-picker');
    const opt = Array.from(picker.querySelectorAll('option')).find(o => o.value === 'cn-etpl-test-1');
    assert.ok(!opt, 'template should be removed from picker');
    assert.strictEqual(picker.value, '', 'selection clears to empty after delete');
  });
});
