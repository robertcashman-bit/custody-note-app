'use strict';

/**
 * Mocked QuickFile robustness scenarios (no live API).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const preflight = require('../lib/quickfilePreflight');
const retry = require('../lib/quickfileRetry');
const clientMatch = require('../lib/quickfileClientMatch');
const verify = require('../lib/quickfileVerify');
const {
  createInvoiceWithDuplicateRecovery,
  isQuickFileInvoiceNumberDuplicateError,
} = require('../lib/quickfileInvoiceNumber');
const qfClient = require('../lib/quickfileClient');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const billingScreenJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'billing-screen.js'), 'utf8');

describe('pre-flight failures (mocked context)', () => {
  it('blocks missing credentials', () => {
    const r = preflight.runQuickFileSendPreflight({ settingsMissing: ['API key'], pingOk: true, firmName: 'Acme', billableTotal: 100, lineItemCount: 1, vatRate: 0.2 });
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some((e) => /not configured/i.test(e)));
  });

  it('blocks zero total and missing lines', () => {
    const r = preflight.runQuickFileSendPreflight({ firmName: 'Acme', billableTotal: 0, lineItemCount: 0, vatRate: 0.2 });
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.length >= 2);
  });

  it('blocks invalid VAT rate', () => {
    const r = preflight.runQuickFileSendPreflight({ firmName: 'Acme', billableTotal: 50, lineItemCount: 1, vatRate: 1.5 });
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some((e) => /VAT rate/i.test(e)));
  });
});

describe('retry policy (429 / 5xx / network)', () => {
  it('retries 429 then succeeds', async () => {
    let calls = 0;
    const out = await retry.runWithQuickFileRetries({
      maxAttempts: 3,
      delaysMs: [1],
      run: async () => {
        calls += 1;
        if (calls < 2) {
          const e = new Error('Too many requests');
          e.httpStatus = 429;
          throw e;
        }
        return 'ok';
      },
    });
    assert.strictEqual(out, 'ok');
    assert.strictEqual(calls, 2);
  });

  it('does not retry plain 4xx client errors', async () => {
    let calls = 0;
    await assert.rejects(async () => retry.runWithQuickFileRetries({
      maxAttempts: 3,
      delaysMs: [1],
      run: async () => {
        calls += 1;
        const e = new Error('Bad request');
        e.httpStatus = 400;
        throw e;
      },
    }));
    assert.strictEqual(calls, 1);
  });

  it('retries network timeout errors', async () => {
    let calls = 0;
    const out = await retry.runWithQuickFileRetries({
      maxAttempts: 2,
      delaysMs: [1],
      run: async () => {
        calls += 1;
        if (calls < 2) throw qfClient.quickFileTimeoutError('/1_2/invoice/create', 30000);
        return 42;
      },
    });
    assert.strictEqual(out, 42);
  });
});

describe('client matching — never treat client-exists as invoice duplicate', () => {
  it('classifies client already exists separately from invoice duplicate', () => {
    const err = new Error('Client already exists for this company name');
    assert.strictEqual(clientMatch.isQuickFileClientAlreadyExistsError(err), true);
    assert.strictEqual(isQuickFileInvoiceNumberDuplicateError(err), false);
  });

  it('finds exact name match only', () => {
    const hit = clientMatch.findClientByExactName([
      { CompanyName: 'Other LLP' },
      { CompanyName: 'Smith & Co' },
    ], 'Smith & Co');
    assert.strictEqual(hit.CompanyName, 'Smith & Co');
  });
});

describe('CN-ATT idempotency and timeout relink', () => {
  it('skips create when CN-ATT invoice already exists before send', async () => {
    let createCalls = 0;
    const result = await createInvoiceWithDuplicateRecovery({
      attendanceId: 'att-99',
      findByAttendanceRef: async () => ({
        InvoiceID: 9001,
        InvoiceNumber: '328681',
        PurchaseReference: 'CN-ATT-att-99',
      }),
      allocateNextNumber: async () => '328682',
      createWithNumber: async () => {
        createCalls += 1;
        return { InvoiceID: 2, InvoiceNumber: '328682' };
      },
    });
    assert.strictEqual(result.reused, true);
    assert.strictEqual(result.invoiceId, '9001');
    assert.strictEqual(createCalls, 0);
  });

  it('relinkBeforeRetry returns existing invoice after timeout (same pattern as main quickFileRequest)', async () => {
    let runCalls = 0;
    const existing = { InvoiceID: 9001, InvoiceNumber: '328681', PurchaseReference: 'CN-ATT-att-99' };
    const out = await retry.runWithQuickFileRetries({
      maxAttempts: 3,
      delaysMs: [1],
      beforeRetry: async () => {
        if (runCalls >= 1) return existing;
        return null;
      },
      run: async () => {
        runCalls += 1;
        throw qfClient.quickFileTimeoutError('/1_2/invoice/create', 30000);
      },
    });
    assert.deepStrictEqual(out, existing);
    assert.strictEqual(runCalls, 1);
  });
});

describe('verify after create includes client', () => {
  it('fails when ClientID mismatches', () => {
    const r = verify.verifyQuickFileInvoice({
      expectedNumber: '100',
      expectedTotal: 120,
      expectedClientId: 55,
      fetchedBody: { ClientID: 99, TotalGross: 120, InvoiceNumber: '100' },
    });
    assert.strictEqual(r.ok, false);
    assert.ok(/client mismatch/i.test(r.reason));
  });
});

describe('link existing invoice wiring', () => {
  it('registers quickfile-link-invoice IPC in main', () => {
    assert.match(mainJs, /ipcMain\.handle\('quickfile-link-invoice'/);
    assert.match(mainJs, /invoice_linked_manual/);
  });

  it('preload exposes quickfileLinkInvoice', () => {
    assert.match(preloadJs, /quickfileLinkInvoice/);
  });

  it('billing screen shows link card and handler', () => {
    assert.match(billingScreenJs, /wf-bill-link-qf/);
    assert.match(billingScreenJs, /quickfileLinkInvoice/);
    assert.match(billingScreenJs, /Link existing QuickFile invoice/);
  });
});

describe('invoice client match for manual link', () => {
  it('accepts matching ClientID', () => {
    const r = clientMatch.invoiceClientMatchesFirm(12, 12, 'Any', 'Firm');
    assert.strictEqual(r.ok, true);
  });

  it('rejects different client without name match', () => {
    const r = clientMatch.invoiceClientMatchesFirm(99, 12, 'Other Co', 'Expected Firm');
    assert.strictEqual(r.ok, false);
  });
});
