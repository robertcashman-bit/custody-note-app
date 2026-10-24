'use strict';

/* Regression: QuickFile invoice/get wraps everything in Body.InvoiceDetails.
   Verify / identity / client helpers must read through that wrapper, or every
   real send is wrongly flagged "Check QuickFile". Values below are synthetic. */
const test = require('node:test');
const assert = require('node:assert');
const { verifyQuickFileInvoice, extractInvoiceTotal } = require('../lib/quickfileVerify');
const { pickInvoiceIdentity, invoiceBelongsToAttendance } = require('../lib/quickfileInvoiceNumber');
const {
  extractClientIdFromInvoiceBody,
  extractClientNameFromInvoiceBody,
  clientRecordMatchesFirmName,
} = require('../lib/quickfileClientMatch');

const invoiceGetBody = {
  InvoiceDetails: {
    InvoiceID: 90000001,
    InvoiceType: 'INVOICE',
    InvoiceNumber: '400123',
    PurchaseReference: 'CN-ATT-42',
    ClientID: 777,
    ClientCompanyName: 'Example Solicitors LLP',
    TotalAmount: 216.84,
    Notes: 'x',
    Status: 'DRAFT',
    ItemLines: { Item: [{ LineTotal: 160 }, { LineTotal: 20.7 }] },
  },
};

test('extractInvoiceTotal reads InvoiceDetails.TotalAmount', () => {
  assert.strictEqual(extractInvoiceTotal(invoiceGetBody), 216.84);
});

test('pickInvoiceIdentity reads InvoiceDetails', () => {
  assert.deepStrictEqual(pickInvoiceIdentity(invoiceGetBody), { invoiceId: '90000001', invoiceNumber: '400123' });
});

test('verifyQuickFileInvoice passes for a matching real-shaped invoice/get body', () => {
  const r = verifyQuickFileInvoice({
    expectedNumber: '400123', expectedTotal: 216.84, expectedClientId: 777, fetchedBody: invoiceGetBody,
  });
  assert.strictEqual(r.ok, true, r.reason);
});

test('verifyQuickFileInvoice still catches total and client mismatches', () => {
  assert.strictEqual(verifyQuickFileInvoice({ expectedTotal: 100, fetchedBody: invoiceGetBody }).ok, false);
  assert.strictEqual(verifyQuickFileInvoice({ expectedClientId: 778, fetchedBody: invoiceGetBody }).ok, false);
  assert.strictEqual(verifyQuickFileInvoice({ expectedNumber: '400124', fetchedBody: invoiceGetBody }).ok, false);
});

test('client helpers read InvoiceDetails.ClientID / ClientCompanyName', () => {
  assert.strictEqual(extractClientIdFromInvoiceBody(invoiceGetBody), 777);
  assert.strictEqual(extractClientNameFromInvoiceBody(invoiceGetBody), 'Example Solicitors LLP');
  assert.strictEqual(clientRecordMatchesFirmName({ ClientCompanyName: 'example  solicitors llp' }, 'Example Solicitors LLP'), true);
});

test('invoiceBelongsToAttendance reads InvoiceDetails.PurchaseReference', () => {
  assert.strictEqual(invoiceBelongsToAttendance(invoiceGetBody, 42), true);
  assert.strictEqual(invoiceBelongsToAttendance(invoiceGetBody, 43), false);
});
