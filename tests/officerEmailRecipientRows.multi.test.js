'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const RECIPIENT_ROWS_SRC = fs.readFileSync(path.join(ROOT, 'renderer/lib/officerEmailRecipientRows.js'), 'utf8');

function setupDom() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>' +
      '<div id="host" class="officer-email-recipients-block"></div>' +
      '<label class="officer-email-multi-recipient-toggle"><input type="checkbox" id="multi-cb" /><span>Send to another officer as well?</span></label>' +
      '</body></html>',
    { url: 'http://localhost', runScripts: 'outside-only' }
  );
  const win = dom.window;
  win.eval(RECIPIENT_ROWS_SRC);
  const host = win.document.getElementById('host');
  const multiCb = win.document.getElementById('multi-cb');
  const api = win.OfficerEmailRecipientRows.initRecipientBlock(host, {
    prefix: 'tst',
    multiOfficerCheckbox: multiCb,
  });
  return { win, host, multiCb, api, fireChange: (el) => el.dispatchEvent(new win.Event('change')) };
}

describe('officer email recipient rows — multi-officer toggle', () => {
  it('starts with one row, add link hidden, multi checkbox off', () => {
    const { host, multiCb, api } = setupDom();
    assert.strictEqual(host.querySelectorAll('.officer-email-recipient-row').length, 1);
    assert.ok(host.querySelector('.officer-email-add-recipient').classList.contains('hidden'));
    assert.strictEqual(multiCb.checked, false);
    assert.strictEqual(api.isMultiOfficerEnabled(), false);
    const kids = Array.from(host.children).map((el) => el.className || el.tagName);
    assert.ok(kids[0].includes('officer-email-recipient-primary'));
    assert.ok(kids[1].includes('officer-email-multi-recipient-toggle'));
  });

  it('enabling multi shows add link and a second row; getValues uses both', () => {
    const { host, multiCb, api, fireChange } = setupDom();
    multiCb.checked = true;
    fireChange(multiCb);
    assert.strictEqual(api.isMultiOfficerEnabled(), true);
    assert.ok(!host.querySelector('.officer-email-add-recipient').classList.contains('hidden'));
    assert.strictEqual(host.querySelectorAll('.officer-email-recipient-row').length, 2);

    const rows = host.querySelectorAll('.officer-email-recipient-row');
    rows[0].querySelector('.officer-email-recipient-to').value = 'a@x.police.uk';
    rows[0].querySelector('.officer-email-recipient-name').value = 'PC A';
    rows[1].querySelector('.officer-email-recipient-to').value = 'b@x.police.uk';
    rows[1].querySelector('.officer-email-recipient-name').value = 'PC B';
    const vals = api.getValues();
    assert.strictEqual(vals.toEmail, 'a@x.police.uk; b@x.police.uk');
    assert.strictEqual(vals.recipientName, 'PC A; PC B');
  });

  it('disabling multi trims extra rows and clears extra recipient data', () => {
    const { host, multiCb, api, fireChange } = setupDom();
    api.setValues('a@x.police.uk; b@x.police.uk', 'PC A; PC B');
    assert.strictEqual(multiCb.checked, true);
    assert.strictEqual(host.querySelectorAll('.officer-email-recipient-row').length, 2);

    multiCb.checked = false;
    fireChange(multiCb);
    assert.strictEqual(host.querySelectorAll('.officer-email-recipient-row').length, 1);
    const vals = api.getValues();
    assert.strictEqual(vals.toEmail, 'a@x.police.uk');
    assert.strictEqual(vals.recipientName, 'PC A');
  });

  it('setValues with multiple semicolon-separated recipients auto-enables multi', () => {
    const { host, multiCb, api } = setupDom();
    api.setValues('one@x.police.uk; two@x.police.uk', 'PC One; PC Two');
    assert.strictEqual(multiCb.checked, true);
    assert.strictEqual(host.querySelectorAll('.officer-email-recipient-row').length, 2);
    assert.ok(!host.querySelector('.officer-email-add-recipient').classList.contains('hidden'));
  });

  it('countStoredRecipients counts semicolon lists', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(RECIPIENT_ROWS_SRC);
    assert.strictEqual(
      dom.window.OfficerEmailRecipientRows.countStoredRecipients('a@x; b@y', 'PC A'),
      2
    );
  });
});
