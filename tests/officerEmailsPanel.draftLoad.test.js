'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PANEL_SRC = fs.readFileSync(path.join(ROOT, 'renderer/views/officerEmailsPanel.js'), 'utf8');
const STANDALONE_SRC = fs.readFileSync(path.join(ROOT, 'renderer/views/officerEmailsStandalone.js'), 'utf8');
const RECIPIENT_ROWS_SRC = fs.readFileSync(path.join(ROOT, 'renderer/lib/officerEmailRecipientRows.js'), 'utf8');
const DATE_TIME_SRC = fs.readFileSync(path.join(ROOT, 'lib/officerEmailDateTime.js'), 'utf8');
const DATE_PICKER_SRC = fs.readFileSync(path.join(ROOT, 'renderer/lib/officerEmailDateTimePicker.js'), 'utf8');
const COMPOSE_LAYOUT_SRC = fs.readFileSync(path.join(ROOT, 'renderer/lib/officerEmailComposeLayout.js'), 'utf8');
const TEMPLATE_OPTIONS_SRC = fs.readFileSync(path.join(ROOT, 'lib/officerEmailTemplateOptions.js'), 'utf8');

function flushMicrotasks(times) {
  let p = Promise.resolve();
  for (let i = 0; i < (times || 12); i++) p = p.then(() => undefined);
  return p;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bootPanelDom(listDraftsImpl) {
  const html = '<!DOCTYPE html><html><body><div id="officer-emails-panel-host"></div></body></html>';
  const dom = new JSDOM(html, { url: 'http://localhost', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  const calls = { buildPreview: [] };
  win.formData = { forename: 'A', surname: 'B', date: '2026-01-01' };
  win.currentAttendanceId = 99;
  win.api = {
    officerEmails: {
      buildPreview: (fields) => {
        calls.buildPreview.push(fields);
        return Promise.resolve({
          ok: true,
          subject: 'AUTO SUBJECT OVERWRITE',
          body: 'AUTO BODY OVERWRITE',
        });
      },
      listDrafts: listDraftsImpl || (() => Promise.resolve([])),
      createDraft: () => Promise.resolve({ ok: true }),
      updateDraft: () => Promise.resolve({ ok: true }),
    },
  };
  win.showToast = () => {};
  win.eval(TEMPLATE_OPTIONS_SRC);
  win.eval(DATE_TIME_SRC);
  win.eval(COMPOSE_LAYOUT_SRC);
  win.eval(DATE_PICKER_SRC);
  win.eval(RECIPIENT_ROWS_SRC);
  win.eval(PANEL_SRC);
  win.OfficerEmailsPanel.init();
  return { dom, win, calls };
}

function bootStandaloneDom() {
  const html = '<!DOCTYPE html><html><body><div id="officer-emails-standalone-host"></div></body></html>';
  const dom = new JSDOM(html, { url: 'http://localhost', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  const calls = { buildPreview: [] };
  win.api = {
    officerEmails: {
      buildPreview: (fields) => {
        calls.buildPreview.push(fields);
        return Promise.resolve({
          ok: true,
          subject: 'AUTO SUBJECT OVERWRITE',
          body: 'AUTO BODY OVERWRITE',
        });
      },
      copyText: () => Promise.resolve({ ok: true }),
      getComposeUrl: () => Promise.resolve({ ok: true, url: 'https://example.com' }),
    },
  };
  win.showToast = () => {};
  win.eval(TEMPLATE_OPTIONS_SRC);
  win.eval(DATE_TIME_SRC);
  win.eval(COMPOSE_LAYOUT_SRC);
  win.eval(DATE_PICKER_SRC);
  win.eval(RECIPIENT_ROWS_SRC);
  win.eval(STANDALONE_SRC);
  win.OfficerEmailsStandalone.init();
  return { dom, win, calls };
}

describe('officer email draft load — no auto-regenerate over saved subject/body', () => {
  let originalWindow;
  beforeEach(() => { originalWindow = global.window; });
  afterEach(() => {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  });

  it('panel: loading a saved draft keeps subject/body after >200ms', async () => {
    const savedDraft = {
      id: 'draft-1',
      status: 'draft',
      templateType: 'bail_details_request',
      toEmail: 'officer@kent.police.uk',
      recipientName: '',
      clientName: 'Client',
      policeStation: 'Tonbridge',
      offence: 'Theft',
      attendanceDate: '2026-01-15',
      attendanceTime: '09:00',
      bailReturnDate: '2026-02-01',
      bailReturnTime: '10:00',
      bailConditions: '',
      extraNote: '',
      userEmailAddress: '',
      subject: 'Saved hand subject',
      body: 'Saved hand body line',
      updatedAt: '2026-01-01T12:00:00',
    };
    const { win, calls } = bootPanelDom(() => Promise.resolve([savedDraft]));
    await flushMicrotasks(20);
    win.OfficerEmailsPanel.attachToCustodyNote(99);
    await flushMicrotasks(20);
    const loadBtn = win.document.querySelector('[data-act="load"]');
    assert.ok(loadBtn, 'Load button should be rendered from listDrafts');
    const previewBeforeLoad = calls.buildPreview.length;
    loadBtn.click();
    await flushMicrotasks(10);
    await delay(250);
    assert.strictEqual(win.document.getElementById('oep-subject').value, 'Saved hand subject');
    assert.strictEqual(win.document.getElementById('oep-body').value, 'Saved hand body line');
    assert.strictEqual(calls.buildPreview.length, previewBeforeLoad, 'load must not trigger buildPreview/auto-generate');
  });

  it('standalone: silent setTemplateType after edited body does not regenerate', async () => {
    const { win, calls } = bootStandaloneDom();
    await flushMicrotasks(30);
    await delay(50);
    win.document.getElementById('oes-subject').value = 'Saved hand subject';
    win.document.getElementById('oes-body').value = 'Saved hand body line';
    win.document.getElementById('oes-subject').dispatchEvent(new win.Event('input', { bubbles: true }));
    win.document.getElementById('oes-body').dispatchEvent(new win.Event('input', { bubbles: true }));
    await flushMicrotasks(10);
    const mount = win.document.getElementById('oes-when-mount');
    const picker = mount && mount.__officerEmailWhenPicker;
    assert.ok(picker, 'picker API should be on when-mount for tests');
    picker.setTemplateType('bail_details_request', { silent: true });
    await delay(250);
    assert.strictEqual(win.document.getElementById('oes-subject').value, 'Saved hand subject');
    assert.strictEqual(win.document.getElementById('oes-body').value, 'Saved hand body line');
    assert.strictEqual(win.document.getElementById('oes-subject').value, 'Saved hand subject', 'dirty body must survive silent bail template switch');
  });
});
