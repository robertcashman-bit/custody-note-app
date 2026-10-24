'use strict';

/* Source-level guards for QuickFile duplicate/secret safety in main.js. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function fnBody(name) {
  const i = src.indexOf(name);
  assert.ok(i >= 0, name + ' not found');
  return src.slice(i, i + 6000);
}

test('only search/get QuickFile calls are retried without a relink hook', () => {
  assert.match(src, /function isQuickFileReadOnlyPath\(apiPath\)/);
  assert.match(src, /const unsafeToRepeat = !isQuickFileReadOnlyPath\(apiPath\) && typeof o\.relinkBeforeRetry !== 'function'/);
});

test('client/create is single-shot and re-searches after an ambiguous failure', () => {
  const body = fnBody('async function quickFileFindOrCreateClient');
  assert.match(body, /'\/1_2\/client\/create', createPayload, \{ logEvent: 'client_create', skipRetry: true \}/);
  assert.match(body, /isQuickFileNetworkError\(createErr\)/);
  assert.match(body, /if \(o\.noCreate\) return null;/);
  assert.doesNotMatch(body, /if \(!getName \|\|/);
});

test('invoice-number lookup is exact only (no first-row fallback)', () => {
  const body = fnBody('async function quickFileFindInvoiceByNumber');
  assert.doesNotMatch(body.slice(0, 1500), /records\[0\]/);
  assert.match(body, /quickfileInvoiceNumbersEqual/);
});

test('link never creates a QuickFile client and refuses foreign/duplicate links', () => {
  const body = fnBody("ipcMain.handle('quickfile-link-invoice'");
  assert.match(body, /noCreate: true/);
  assert.match(body, /created by Custody Note for a different record/);
  assert.match(body, /already linked to another record/);
});

test('invoice/create retries only with CN-ATT relink, never for allowDuplicate', () => {
  assert.match(src, /relinkBeforeRetry: \(attendanceId && !params\.allowDuplicate\)/);
});

test('auto-number fallback never re-posts after a network/5xx failure', () => {
  assert.match(src, /isAuto\s*&& !quickfileClient\.isQuickFileNetworkError\(createErr\)\s*&& !quickfileRetry\.isRetryableQuickFileError\(createErr\)/);
});

test('ALREADY_INVOICED check runs before preflight in create handler', () => {
  const body = fnBody("ipcMain.handle('quickfile-create-invoice'");
  assert.ok(body.indexOf("code: 'ALREADY_INVOICED'") < body.indexOf('runQuickFileSendPreflight('));
});

test('QuickFile error text is scrubbed of credentials', () => {
  assert.match(src, /function scrubQuickFileSecrets\(text, auth\)/);
  assert.match(src, /scrubQuickFileSecrets\(err\.message, auth\)/);
});
