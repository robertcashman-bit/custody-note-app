/**
 * Quick Email integration tests — full DOM simulation
 * Uses jsdom to simulate the browser environment and exercises:
 *   1. Selecting a built-in template fills subject + body with field values
 *   2. Changing field values after template selection live-updates subject + body
 *   3. Saving a template converts values → {{placeholders}}
 *   4. Loading a saved template fills new values correctly
 *   5. Subject line is properly filled from template
 *   6. Manual edits prevent automatic overwrites
 *   7. Switching back to "None" resets template state
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const modalSrc = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'views', 'email-modal.js'),
  'utf8'
);

function createEnv() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
  });
  const { window } = dom;
  const { document } = window;

  window._appSettingsCache = { feeEarnerNameDefault: 'Robert Cashman' };
  window.api = {
    getSettings: function() { return Promise.resolve({}); },
    setSettings: function() { return Promise.resolve(); },
    openExternal: function() {},
    attendanceSave: function() { return Promise.resolve({}); },
  };
  window.emailAPI = {
    open: function() { return Promise.resolve(); },
  };
  window.invokeOutlookWebCompose = function(payload) {
    return window.emailAPI.open(payload);
  };
  window._getCustomEmailTemplates = function() { return []; };

  const globals = `
    var showToast = function(){};
    var refreshList = function(){};
    var esc = function(s){return s;};
    function _oicClean(v){return v==null?'':String(v).trim();}
    function _oicFmtDate(v){return v||'';}
    function buildEmailSubject(tpl,data){return 'built-in subject';}
    function buildEmailBody(tpl,data,fe){return 'built-in body';}
  `;

  const scriptEl = document.createElement('script');
  scriptEl.textContent = globals + '\n' + modalSrc;
  document.body.appendChild(scriptEl);

  return { dom, window, document };
}

function openModal(env) {
  env.window.openQuickEmailModal();
}

function getField(doc, id) {
  return doc.getElementById(id);
}

function setFieldValue(doc, id, value) {
  const el = doc.getElementById(id);
  if (!el) throw new Error('Element not found: ' + id);
  el.value = value;
  return el;
}

function fireEvent(el, eventName) {
  const Event = el.ownerDocument.defaultView.Event;
  el.dispatchEvent(new Event(eventName, { bubbles: true }));
}

function selectTemplate(doc, templateId) {
  const sel = doc.getElementById('quick-email-custom-template');
  if (!sel) throw new Error('Template dropdown not found');
  sel.value = templateId;
  fireEvent(sel, 'change');
}

describe('Quick Email integration — template application', () => {
  let env;

  beforeEach(() => {
    env = createEnv();
    openModal(env);
  });

  it('modal renders with template dropdown', () => {
    const dropdown = getField(env.document, 'quick-email-custom-template');
    assert.ok(dropdown, 'Template dropdown should exist');
    const options = Array.from(dropdown.querySelectorAll('option'));
    assert.ok(options.length >= 3, 'Should have None + 2 built-in options, got ' + options.length);
  });

  it('selecting Disclosure template fills subject with field values', () => {
    setFieldValue(env.document, 'quick-email-client-name', 'John Doe');
    setFieldValue(env.document, 'quick-email-station', 'Holborn');
    setFieldValue(env.document, 'quick-email-officer-name', 'Smith');
    setFieldValue(env.document, 'quick-email-date', '2026-03-18');

    selectTemplate(env.document, 'builtin:disclosure');

    const subject = getField(env.document, 'quick-email-subject').value;
    assert.ok(subject.includes('John Doe'), 'Subject should contain client name, got: ' + subject);
    assert.ok(subject.includes('Holborn'), 'Subject should contain station, got: ' + subject);
    assert.ok(subject.includes('Disclosure Request'), 'Subject should contain template label, got: ' + subject);
  });

  it('selecting Disclosure template fills body with field values', () => {
    setFieldValue(env.document, 'quick-email-client-name', 'John Doe');
    setFieldValue(env.document, 'quick-email-station', 'Holborn');
    setFieldValue(env.document, 'quick-email-officer-name', 'Smith');
    setFieldValue(env.document, 'quick-email-date', '2026-03-18');

    selectTemplate(env.document, 'builtin:disclosure');

    const body = getField(env.document, 'quick-email-body').value;
    assert.ok(body.includes('Dear DC Smith'), 'Body should contain officer name, got: ' + body);
    assert.ok(body.includes('John Doe'), 'Body should contain client name, got: ' + body);
    assert.ok(body.includes('Holborn'), 'Body should contain station, got: ' + body);
    assert.ok(body.includes('18/03/2026'), 'Body should contain formatted date, got: ' + body);
    assert.ok(body.includes('Robert Cashman'), 'Body should contain fee earner, got: ' + body);
  });

  it('selecting Bail template fills subject and body', () => {
    setFieldValue(env.document, 'quick-email-client-name', 'Jane Smith');
    setFieldValue(env.document, 'quick-email-station', 'Paddington');
    setFieldValue(env.document, 'quick-email-officer-name', 'Jones');

    selectTemplate(env.document, 'builtin:bail');

    const subject = getField(env.document, 'quick-email-subject').value;
    const body = getField(env.document, 'quick-email-body').value;
    assert.ok(subject.includes('Jane Smith'), 'Subject should contain client name');
    assert.ok(subject.includes('Paddington'), 'Subject should contain station');
    assert.ok(body.includes('Dear DC Jones'), 'Body should contain officer name');
    assert.ok(body.includes('police bail'), 'Body should mention bail');
  });

  it('changing officer name after template selection updates body', () => {
    setFieldValue(env.document, 'quick-email-officer-name', 'Smith');
    selectTemplate(env.document, 'builtin:disclosure');

    let body = getField(env.document, 'quick-email-body').value;
    assert.ok(body.includes('Dear DC Smith'), 'Initial body should have Smith');

    const officerEl = setFieldValue(env.document, 'quick-email-officer-name', 'Williams');
    fireEvent(officerEl, 'input');

    body = getField(env.document, 'quick-email-body').value;
    assert.ok(body.includes('Dear DC Williams'), 'Body should update to Williams after field change, got: ' + body);
    assert.ok(!body.includes('Dear DC Smith'), 'Body should no longer contain Smith');
  });

  it('changing client name after template selection updates subject and body', () => {
    setFieldValue(env.document, 'quick-email-client-name', 'Alice');
    selectTemplate(env.document, 'builtin:disclosure');

    let subject = getField(env.document, 'quick-email-subject').value;
    assert.ok(subject.includes('Alice'), 'Initial subject should have Alice');

    const clientEl = setFieldValue(env.document, 'quick-email-client-name', 'Bob');
    fireEvent(clientEl, 'input');

    subject = getField(env.document, 'quick-email-subject').value;
    assert.ok(subject.includes('Bob'), 'Subject should update to Bob, got: ' + subject);
    assert.ok(!subject.includes('Alice'), 'Subject should no longer have Alice');
  });

  it('changing station after template selection updates subject and body', () => {
    setFieldValue(env.document, 'quick-email-station', 'Brixton');
    selectTemplate(env.document, 'builtin:disclosure');

    let subject = getField(env.document, 'quick-email-subject').value;
    assert.ok(subject.includes('Brixton'), 'Initial subject should have Brixton');

    const stationEl = setFieldValue(env.document, 'quick-email-station', 'Camden');
    fireEvent(stationEl, 'input');

    subject = getField(env.document, 'quick-email-subject').value;
    assert.ok(subject.includes('Camden'), 'Subject should update to Camden, got: ' + subject);
  });

  it('changing attendance type updates body when template active', () => {
    selectTemplate(env.document, 'builtin:disclosure');

    const typeEl = setFieldValue(env.document, 'quick-email-attendance-type', 'voluntary');
    fireEvent(typeEl, 'change');

    const body = getField(env.document, 'quick-email-body').value;
    assert.ok(typeof body === 'string' && body.length > 0, 'Body should be non-empty after type change');
  });
});

describe('Quick Email integration — manual edit protection', () => {
  let env;

  beforeEach(() => {
    env = createEnv();
    openModal(env);
  });

  it('manually editing subject prevents template from overwriting it', () => {
    selectTemplate(env.document, 'builtin:disclosure');

    const subjectEl = getField(env.document, 'quick-email-subject');
    subjectEl.value = 'My custom subject';
    fireEvent(subjectEl, 'input');

    const officerEl = setFieldValue(env.document, 'quick-email-officer-name', 'NewOfficer');
    fireEvent(officerEl, 'input');

    assert.strictEqual(subjectEl.value, 'My custom subject',
      'Subject should remain as user typed after field change');
  });

  it('manually editing body prevents template from overwriting it', () => {
    selectTemplate(env.document, 'builtin:disclosure');

    const bodyEl = getField(env.document, 'quick-email-body');
    bodyEl.value = 'My custom body text';
    fireEvent(bodyEl, 'input');

    const officerEl = setFieldValue(env.document, 'quick-email-officer-name', 'NewOfficer');
    fireEvent(officerEl, 'input');

    assert.strictEqual(bodyEl.value, 'My custom body text',
      'Body should remain as user typed after field change');
  });

  it('selecting a new template resets manual edit protection', () => {
    selectTemplate(env.document, 'builtin:disclosure');

    const bodyEl = getField(env.document, 'quick-email-body');
    bodyEl.value = 'My custom body';
    fireEvent(bodyEl, 'input');

    setFieldValue(env.document, 'quick-email-officer-name', 'TestOfficer');

    selectTemplate(env.document, 'builtin:bail');

    const newBody = getField(env.document, 'quick-email-body').value;
    assert.ok(newBody.includes('police bail'),
      'After selecting new template, body should be from new template, got: ' + newBody);
  });
});

describe('Quick Email integration — None (compose freely)', () => {
  let env;

  beforeEach(() => {
    env = createEnv();
    openModal(env);
  });

  it('switching to None clears body and resets template state', () => {
    setFieldValue(env.document, 'quick-email-client-name', 'Alice');
    selectTemplate(env.document, 'builtin:disclosure');

    const body = getField(env.document, 'quick-email-body').value;
    assert.ok(body.includes('Alice'), 'Body should have Alice before reset');

    selectTemplate(env.document, '');

    const clearedBody = getField(env.document, 'quick-email-body').value;
    assert.strictEqual(clearedBody, '', 'Body should be empty after selecting None');
  });

  it('after None, auto-subject resumes on blur', () => {
    selectTemplate(env.document, 'builtin:disclosure');
    selectTemplate(env.document, '');

    setFieldValue(env.document, 'quick-email-client-name', 'Bob');
    const clientEl = getField(env.document, 'quick-email-client-name');
    fireEvent(clientEl, 'blur');

    const subject = getField(env.document, 'quick-email-subject').value;
    assert.ok(subject.includes('Bob'), 'Auto-subject should fire after None, got: ' + subject);
  });

  it('field changes after None do NOT re-apply old template', () => {
    selectTemplate(env.document, 'builtin:disclosure');
    selectTemplate(env.document, '');

    const officerEl = setFieldValue(env.document, 'quick-email-officer-name', 'Wilson');
    fireEvent(officerEl, 'input');

    const body = getField(env.document, 'quick-email-body').value;
    assert.strictEqual(body, '', 'Body should stay empty — no template is active');
  });
});

describe('Quick Email integration — save as template round-trip', () => {
  let env;

  beforeEach(() => {
    env = createEnv();
    openModal(env);
  });

  it('_valuesToPlaceholders converts field values to placeholders', () => {
    const fn = env.window._valuesToPlaceholders;
    const map = {
      clientName: 'John Doe',
      oicName: 'Smith',
      station: 'Holborn',
      date: '18/03/2026',
      feeEarnerName: 'Robert Cashman'
    };
    const text = 'Dear DC Smith,\n\nRe: John Doe at Holborn on 18/03/2026.\n\nRobert Cashman';
    const result = fn(text, map);

    assert.ok(result.includes('{{oicName}}'), 'Should replace Smith with {{oicName}}, got: ' + result);
    assert.ok(result.includes('{{clientName}}'), 'Should replace John Doe with {{clientName}}, got: ' + result);
    assert.ok(result.includes('{{station}}'), 'Should replace Holborn with {{station}}, got: ' + result);
    assert.ok(result.includes('{{date}}'), 'Should replace date with {{date}}, got: ' + result);
    assert.ok(result.includes('{{feeEarnerName}}'), 'Should replace Robert Cashman with {{feeEarnerName}}, got: ' + result);
  });

  it('round-trip: apply → save → re-apply with new values', () => {
    const fn_v2p = env.window._valuesToPlaceholders;
    const originalMap = {
      clientName: 'John Doe',
      oicName: 'Smith',
      station: 'Holborn',
      feeEarnerName: 'Robert Cashman'
    };
    const composedBody = 'Dear DC Smith,\n\nClient John Doe at Holborn.\n\nRobert Cashman';
    const templateBody = fn_v2p(composedBody, originalMap);

    assert.ok(templateBody.includes('{{oicName}}'), 'Template should have oicName placeholder');
    assert.ok(templateBody.includes('{{clientName}}'), 'Template should have clientName placeholder');

    const newMap = {
      clientName: 'Jane Adams',
      oicName: 'Williams',
      station: 'Paddington',
      feeEarnerName: 'Robert Cashman'
    };
    const reapplied = templateBody.replace(
      /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
      function (_, key) { return newMap[key] != null ? String(newMap[key]) : ''; }
    );

    assert.ok(reapplied.includes('Dear DC Williams'), 'Re-applied should have new officer, got: ' + reapplied);
    assert.ok(reapplied.includes('Jane Adams'), 'Re-applied should have new client, got: ' + reapplied);
    assert.ok(reapplied.includes('Paddington'), 'Re-applied should have new station, got: ' + reapplied);
    assert.ok(!reapplied.includes('{{'), 'No unfilled placeholders, got: ' + reapplied);
  });

  it('_valuesToPlaceholders is case-insensitive', () => {
    const fn = env.window._valuesToPlaceholders;
    const map = { station: 'holborn' };
    const text = 'Station: HOLBORN and holborn and Holborn';
    const result = fn(text, map);
    assert.ok(!result.includes('HOLBORN'), 'Should replace HOLBORN');
    assert.ok(!result.includes('Holborn'), 'Should replace Holborn');
    assert.strictEqual(result, 'Station: {{station}} and {{station}} and {{station}}');
  });

  it('_valuesToPlaceholders ignores short values (< 2 chars)', () => {
    const fn = env.window._valuesToPlaceholders;
    const map = { clientName: 'A', station: 'Holborn' };
    const text = 'A client at Holborn';
    const result = fn(text, map);
    assert.ok(result.includes('A client'), 'Should not replace single-char value');
    assert.ok(result.includes('{{station}}'), 'Should replace longer value');
  });
});

describe('Quick Email integration — custom saved template with placeholders', () => {
  let env;

  beforeEach(() => {
    env = createEnv();
    env.window.localStorage.setItem('cn-custom-email-templates', JSON.stringify([
      {
        name: 'My Test Template',
        subject: '{{clientName}} - {{station}} - Custom Subject',
        body: 'Hi {{oicName}},\n\nRegarding {{clientName}} at {{station}}.\n\nBest,\n{{feeEarnerName}}',
        scope: 'officer'
      }
    ]));
    env.window._getCustomEmailTemplates = function () {
      try {
        return JSON.parse(env.window.localStorage.getItem('cn-custom-email-templates') || '[]');
      } catch (_) { return []; }
    };
    openModal(env);
  });

  it('saved custom template appears in dropdown', () => {
    const dropdown = getField(env.document, 'quick-email-custom-template');
    const options = Array.from(dropdown.querySelectorAll('option'));
    const customOpt = options.find(o => o.value === 'custom:0');
    assert.ok(customOpt, 'Custom template should appear in dropdown');
    assert.ok(customOpt.textContent.includes('My Test Template'), 'Option label should match');
  });

  it('selecting custom template fills subject and body with field values', () => {
    setFieldValue(env.document, 'quick-email-client-name', 'Alice Brown');
    setFieldValue(env.document, 'quick-email-station', 'Camden');
    setFieldValue(env.document, 'quick-email-officer-name', 'Taylor');

    selectTemplate(env.document, 'custom:0');

    const subject = getField(env.document, 'quick-email-subject').value;
    const body = getField(env.document, 'quick-email-body').value;

    assert.ok(subject.includes('Alice Brown'), 'Subject should have client name, got: ' + subject);
    assert.ok(subject.includes('Camden'), 'Subject should have station, got: ' + subject);
    assert.ok(body.includes('Hi Taylor'), 'Body should have officer name, got: ' + body);
    assert.ok(body.includes('Alice Brown'), 'Body should have client name');
    assert.ok(body.includes('Camden'), 'Body should have station');
    assert.ok(body.includes('Robert Cashman'), 'Body should have fee earner');
  });

  it('changing fields after custom template updates output', () => {
    setFieldValue(env.document, 'quick-email-officer-name', 'Taylor');
    selectTemplate(env.document, 'custom:0');

    let body = getField(env.document, 'quick-email-body').value;
    assert.ok(body.includes('Hi Taylor'), 'Initial body should have Taylor');

    const el = setFieldValue(env.document, 'quick-email-officer-name', 'Morgan');
    fireEvent(el, 'input');

    body = getField(env.document, 'quick-email-body').value;
    assert.ok(body.includes('Hi Morgan'), 'Updated body should have Morgan, got: ' + body);
  });
});
