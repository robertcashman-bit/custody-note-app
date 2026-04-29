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
    /* v1.6.4 — templates now use the smart {{officerSalutation}} so a
       bare "Smith" renders as "Officer Smith" (no fictitious DC rank). */
    assert.ok(/Dear Officer Smith/i.test(body),'body missing officer salutation, got: ' + body.slice(0, 120));
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
    assert.ok(body.includes('Dear Officer Williams'), 'live update missing, got: ' + body);
    assert.ok(!body.includes('Officer Smith'),        'old officer name should be gone');
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

describe('Quick Email modal — send never auto-clears; user-initiated Clear does', () => {
  /* User report (v1.6.3): "email is not being transferred automatically to
     Outlook web when done but cleared. Emails should only be cleared by user
     (maybe option to do so) on quick email."
     The previous behaviour wiped the form on a successful resolve from the
     Outlook compose IPC. That is wrong because Outlook can fail silently
     (pop-up blocker, mid sign-in) — the user would lose the typed content
     even though no email was actually sent. */

  it('successful Outlook open KEEPS all form fields and the persisted draft', async () => {
    const env = createEnv();
    env.window.invokeOutlookWebCompose = () => Promise.resolve();

    let clearedDraft = false;
    env.window.api.setSettings = (patch) => {
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'lastQuickEmailDraftJson') && patch.lastQuickEmailDraftJson === '') {
        clearedDraft = true;
      }
      return Promise.resolve();
    };

    openModal(env);
    setField(env.document, 'officerEmail', 'oic@police.uk');
    setField(env.document, 'clientName',   'Alice Brown');
    setField(env.document, 'station',      'Camden');
    setField(env.document, 'oicName',      'Smith');
    pickTemplate(env.document, 'system:disclosure');

    const subjBefore = env.document.getElementById('quick-email-subject').value;
    const bodyBefore = env.document.getElementById('quick-email-body').value;

    env.document.getElementById('qe-send').click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(env.document.getElementById('qe-field-clientName').value,   'Alice Brown',   'client name kept after send');
    assert.strictEqual(env.document.getElementById('qe-field-station').value,      'Camden',        'station kept after send');
    assert.strictEqual(env.document.getElementById('qe-field-oicName').value,      'Smith',         'officer name kept after send');
    assert.strictEqual(env.document.getElementById('qe-field-officerEmail').value, 'oic@police.uk', 'officer email kept after send');
    assert.strictEqual(env.document.getElementById('quick-email-picker').value,    'system:disclosure', 'template choice kept after send');
    assert.strictEqual(env.document.getElementById('quick-email-subject').value,   subjBefore,      'subject preview kept after send');
    assert.strictEqual(env.document.getElementById('quick-email-body').value,      bodyBefore,      'message preview kept after send');
    assert.strictEqual(clearedDraft, false, 'persisted draft must NOT be cleared by sending');
  });

  it('failed Outlook open preserves form fields (no clearing)', async () => {
    const env = createEnv();
    env.window.invokeOutlookWebCompose = () => Promise.reject(new Error('Outlook unavailable'));

    let clearedDraft = false;
    env.window.api.setSettings = (patch) => {
      if (patch && patch.lastQuickEmailDraftJson === '') clearedDraft = true;
      return Promise.resolve();
    };

    openModal(env);
    setField(env.document, 'officerEmail', 'oic@police.uk');
    setField(env.document, 'clientName',   'Bob Stone');
    setField(env.document, 'station',      'Holborn');
    setField(env.document, 'oicName',      'Williams');
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-send').click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(env.document.getElementById('qe-field-clientName').value,   'Bob Stone',     'client name kept on failure');
    assert.strictEqual(env.document.getElementById('qe-field-station').value,      'Holborn',       'station kept on failure');
    assert.strictEqual(env.document.getElementById('qe-field-oicName').value,      'Williams',      'officer name kept on failure');
    assert.strictEqual(env.document.getElementById('qe-field-officerEmail').value, 'oic@police.uk', 'officer email kept on failure');
    assert.strictEqual(clearedDraft, false, 'persisted draft must NOT be cleared on failure');
  });

  it('explicit Clear button clears the form, template, preview and persisted draft', async () => {
    const env = createEnv();
    /* Always confirm so we exercise the destructive branch. */
    env.window.eval('showConfirm = function(){ return Promise.resolve(true); };');
    env.window.invokeOutlookWebCompose = () => Promise.resolve();

    let clearedDraft = false;
    env.window.api.setSettings = (patch) => {
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'lastQuickEmailDraftJson') && patch.lastQuickEmailDraftJson === '') {
        clearedDraft = true;
      }
      return Promise.resolve();
    };

    openModal(env);
    setField(env.document, 'officerEmail', 'oic@police.uk');
    setField(env.document, 'clientName',   'Alice Brown');
    setField(env.document, 'station',      'Camden');
    setField(env.document, 'oicName',      'Smith');
    pickTemplate(env.document, 'system:disclosure');

    const clearBtn = env.document.getElementById('qe-clear');
    assert.ok(clearBtn, 'Clear button must exist in the actions bar');
    clearBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(env.document.getElementById('qe-field-clientName').value,   '', 'client name cleared by Clear');
    assert.strictEqual(env.document.getElementById('qe-field-station').value,      '', 'station cleared by Clear');
    assert.strictEqual(env.document.getElementById('qe-field-oicName').value,      '', 'officer name cleared by Clear');
    assert.strictEqual(env.document.getElementById('qe-field-officerEmail').value, '', 'officer email cleared by Clear');
    assert.strictEqual(env.document.getElementById('quick-email-picker').value,    '', 'template choice cleared by Clear');
    assert.strictEqual(env.document.getElementById('quick-email-subject').value,   '', 'subject preview cleared by Clear');
    assert.strictEqual(env.document.getElementById('quick-email-body').value,      '', 'message preview cleared by Clear');
    assert.strictEqual(clearedDraft, true, 'persisted draft cleared by Clear');
  });

  it('Clear button cancellation (showConfirm rejected) keeps the form intact', async () => {
    const env = createEnv();
    env.window.eval('showConfirm = function(){ return Promise.resolve(false); };');

    openModal(env);
    setField(env.document, 'officerEmail', 'oic@police.uk');
    setField(env.document, 'clientName',   'Alice Brown');
    pickTemplate(env.document, 'system:disclosure');

    env.document.getElementById('qe-clear').click();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(env.document.getElementById('qe-field-clientName').value,   'Alice Brown',  'cancel keeps client name');
    assert.strictEqual(env.document.getElementById('qe-field-officerEmail').value, 'oic@police.uk','cancel keeps officer email');
    assert.strictEqual(env.document.getElementById('quick-email-picker').value,    'system:disclosure', 'cancel keeps template');
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

  it('exposes the Edit link for every template (system or user) once one is selected', () => {
    const link = env.document.getElementById('quick-email-edit-link');
    /* No template chosen yet → link hidden. */
    assert.strictEqual(link.style.display, 'none');

    pickTemplate(env.document, 'system:disclosure');
    assert.notStrictEqual(link.style.display, 'none', 'built-in templates should also be editable');

    pickTemplate(env.document, 'cn-etpl-test-1');
    assert.notStrictEqual(link.style.display, 'none', 'user templates should be editable');
  });

  it('exposes the Delete button for every template, with friendlier wording for built-ins', () => {
    const btn = env.document.getElementById('quick-email-delete-btn');
    assert.strictEqual(btn.style.display, 'none');

    pickTemplate(env.document, 'system:disclosure');
    assert.notStrictEqual(btn.style.display, 'none', 'built-in templates should also be removable');
    assert.strictEqual(btn.textContent, 'Hide template', 'built-in templates use "Hide" wording so users know they can be restored');

    pickTemplate(env.document, 'cn-etpl-test-1');
    assert.notStrictEqual(btn.style.display, 'none');
    assert.strictEqual(btn.textContent, 'Delete template');
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

describe('Quick Email modal — built-in templates can be edited, hidden and restored', () => {
  function createEnvWithSystemStores() {
    const env = createEnv();
    /* In-memory stores for the new system-override + deleted-id settings. */
    let _overrides = {};
    let _deletedIds = [];
    env.window._getSystemEmailOverrides = () => Object.assign({}, _overrides);
    env.window._saveSystemEmailOverrides = (o) => { _overrides = Object.assign({}, o || {}); };
    env.window._getDeletedSystemEmailIds = () => _deletedIds.slice();
    env.window._saveDeletedSystemEmailIds = (ids) => { _deletedIds = (ids || []).slice(); };
    env.window._resetSystemEmailCustomizations = () => { _overrides = {}; _deletedIds = []; };
    return env;
  }

  it('editing a built-in template persists as an override and is reflected in the picker', () => {
    const env = createEnvWithSystemStores();
    openModal(env);

    pickTemplate(env.document, 'system:disclosure');
    /* Open the edit panel via the toolbar Edit link. */
    env.document.getElementById('quick-email-edit-link').click();
    const nameEl = env.document.getElementById('qe-edit-name');
    assert.ok(nameEl, 'edit panel did not open for the built-in template');
    nameEl.value = 'Disclosure (custom)';
    env.document.getElementById('qe-edit-save').click();

    const overrides = env.window._getSystemEmailOverrides();
    assert.ok(overrides['system:disclosure'], 'override entry should exist for the edited built-in id');
    assert.strictEqual(overrides['system:disclosure'].name, 'Disclosure (custom)');

    /* The picker should now show the renamed template. */
    const picker = env.document.getElementById('quick-email-picker');
    const opt = Array.from(picker.querySelectorAll('option')).find(o => o.value === 'system:disclosure');
    assert.ok(opt, 'picker missing the built-in option after edit');
    assert.strictEqual(opt.textContent, 'Disclosure (custom)');
  });

  it('hiding (deleting) a built-in template removes it from the picker and toggles the Restore link', async () => {
    const env = createEnvWithSystemStores();
    openModal(env);

    /* Restore Defaults link should start hidden. */
    const restoreBtn = env.document.getElementById('quick-email-restore-defaults');
    assert.ok(restoreBtn, 'restore-defaults button missing from picker actions');
    assert.strictEqual(restoreBtn.style.display, 'none', 'restore link should start hidden');

    pickTemplate(env.document, 'system:follow-up');
    env.document.getElementById('quick-email-delete-btn').click();
    await Promise.resolve();
    await Promise.resolve();

    const deleted = env.window._getDeletedSystemEmailIds();
    assert.ok(deleted.indexOf('system:follow-up') !== -1, 'deleted-ids store should remember the hidden template');

    const picker = env.document.getElementById('quick-email-picker');
    const opt = Array.from(picker.querySelectorAll('option')).find(o => o.value === 'system:follow-up');
    assert.ok(!opt, 'hidden built-in template should disappear from the picker');

    assert.notStrictEqual(restoreBtn.style.display, 'none', 'restore link should appear once any built-in is hidden');
  });

  it('Restore defaults wipes overrides and un-hides removed built-ins', async () => {
    const env = createEnvWithSystemStores();
    openModal(env);

    /* Hide and edit two different built-ins to set up the test. */
    pickTemplate(env.document, 'system:follow-up');
    env.document.getElementById('quick-email-delete-btn').click();
    await Promise.resolve();
    await Promise.resolve();

    pickTemplate(env.document, 'system:disclosure');
    env.document.getElementById('quick-email-edit-link').click();
    env.document.getElementById('qe-edit-name').value = 'Disclosure (custom)';
    env.document.getElementById('qe-edit-save').click();

    /* Click Restore defaults. */
    env.document.getElementById('quick-email-restore-defaults').click();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepStrictEqual(env.window._getSystemEmailOverrides(), {}, 'overrides should be cleared');
    assert.deepStrictEqual(env.window._getDeletedSystemEmailIds(), [], 'deleted-ids should be cleared');

    const picker = env.document.getElementById('quick-email-picker');
    const followUp = Array.from(picker.querySelectorAll('option')).find(o => o.value === 'system:follow-up');
    assert.ok(followUp, 'hidden built-in should reappear after restore');

    const disclosure = Array.from(picker.querySelectorAll('option')).find(o => o.value === 'system:disclosure');
    assert.ok(disclosure, 'edited built-in should still exist after restore');
    assert.notStrictEqual(disclosure.textContent, 'Disclosure (custom)', 'edited name should revert to default');
  });
});
