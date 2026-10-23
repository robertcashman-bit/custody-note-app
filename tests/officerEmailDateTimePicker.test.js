'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const DATE_TIME_SRC = fs.readFileSync(path.join(ROOT, 'lib/officerEmailDateTime.js'), 'utf8');
const DATE_PICKER_SRC = fs.readFileSync(path.join(ROOT, 'renderer/lib/officerEmailDateTimePicker.js'), 'utf8');

describe('officerEmailDateTimePicker', () => {
  it('setTemplateType silent does not invoke onChange', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="m"></div></body></html>', {
      url: 'http://localhost',
      runScripts: 'outside-only',
    });
    const win = dom.window;
    let onChangeCount = 0;
    win.eval(DATE_TIME_SRC);
    win.eval(DATE_PICKER_SRC);
    const mount = win.document.getElementById('m');
    const picker = win.OfficerEmailDateTimePicker.init(mount, {
      prefix: 't',
      onChange: function () { onChangeCount += 1; },
      getToday: function () { return new Date(2026, 9, 23); },
    });
    onChangeCount = 0;
    picker.setTemplateType('bail_details_request', { silent: true });
    assert.strictEqual(onChangeCount, 0);
    picker.setTemplateType('disclosure_confirm_attendance');
    assert.strictEqual(onChangeCount, 1);
  });

  it('switching to bail template does not auto-fill +28 day bail return date', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="m"></div></body></html>', {
      url: 'http://localhost',
      runScripts: 'outside-only',
    });
    const win = dom.window;
    win.eval(DATE_TIME_SRC);
    win.eval(DATE_PICKER_SRC);
    const mount = win.document.getElementById('m');
    const picker = win.OfficerEmailDateTimePicker.init(mount, {
      prefix: 't2',
      onChange: function () {},
      getToday: function () { return new Date(2026, 9, 23); },
    });
    picker.setTemplateType('bail_details_request', { silent: true });
    const vals = picker.getValues('bail_details_request');
    assert.strictEqual(vals.bailReturnDate, '');
  });

  it('keeps attendance and bail return times separate', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="m"></div></body></html>', {
      url: 'http://localhost',
      runScripts: 'outside-only',
    });
    const win = dom.window;
    win.eval(DATE_TIME_SRC);
    win.eval(DATE_PICKER_SRC);
    const mount = win.document.getElementById('m');
    const picker = win.OfficerEmailDateTimePicker.init(mount, {
      prefix: 't3',
      onChange: function () {},
      getToday: function () { return new Date(2026, 9, 23); },
    });
    picker.setValues({
      templateType: 'bail_details_request',
      attendanceDate: '2026-01-15',
      attendanceTime: '09:00',
      bailReturnDate: '2026-02-01',
      bailReturnTime: '10:00',
    }, { silent: true });
    const vals = picker.getValues('bail_details_request');
    assert.strictEqual(vals.attendanceTime, '09:00');
    assert.strictEqual(vals.bailReturnTime, '10:00');
  });
});
