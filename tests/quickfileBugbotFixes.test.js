'use strict';

/* Regressions for Bugbot findings on PR #127. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runQuickFileSendPreflight } = require('../lib/quickfilePreflight');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('link preflight passes without a billable total when skipTotalCheck', () => {
  const r = runQuickFileSendPreflight({ pingRequired: true, pingOk: true, firmName: 'Firm', skipTotalCheck: true });
  assert.strictEqual(r.ok, true, r.errors.join(' '));
  assert.strictEqual(runQuickFileSendPreflight({ firmName: 'Firm' }).ok, false);
  const link = main.slice(main.indexOf("ipcMain.handle('quickfile-link-invoice'"));
  assert.match(link.slice(0, 3000), /skipTotalCheck: true/);
});

test('failed cloud settings pull does not block when local creds exist', () => {
  assert.match(main, /settingsPullFailed: !!settingsPullError && qfSettings\.missing\.length > 0/);
});

test('display billingInvoiceNumber is not treated as a forced invoice number', () => {
  assert.match(main, /sanitizeQuickFileInvoiceNumber\(params\.customInvoiceNumber\)/);
  assert.doesNotMatch(main, /sanitizeQuickFileInvoiceNumber\(billingInvoiceNumber\)/);
});

test('only a client mismatch blocks after verify; other issues flag check_quickfile and still attach', () => {
  assert.match(main, /const verifyBlocks = !!verifyReason && \/client mismatch\/i\.test\(verifyReason\)/);
  assert.match(main, /verifyRefSoft \? 'check_quickfile' : 'sent'/);
  assert.match(main, /verifyWarning: verifyRefSoft \? verifyReason : undefined/);
});

test('list badges ignore default not_sent status', () => {
  assert.match(app, /r\.quickfile_send_status && r\.quickfile_send_status !== 'not_sent'/);
});

test('confirmation shows verify warning', () => {
  global.window = global.window || {};
  const mod = require('../renderer/lib/quickfileInvoiceResult.js');
  const R = (mod && mod.buildInvoiceSentConfirmation) ? mod : global.window.QuickfileInvoiceResult;
  const conf = R.buildInvoiceSentConfirmation({ invoiceNumber: '1', total: 10, verifyWarning: 'Invoice total mismatch' });
  assert.strictEqual(conf.level, 'warning');
  assert.ok(conf.rows.some((r) => r.label === 'Check in QuickFile'));
});
