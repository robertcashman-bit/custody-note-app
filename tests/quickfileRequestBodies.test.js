'use strict';

/* QuickFile validates request Bodies against its XSD: unknown elements are
   rejected and elements must follow the documented order
   (https://api.quickfile.co.uk/d/v1_2/<Method>). These tests pin the exact
   keys and order for every call the app makes. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const B = require('../lib/quickfileRequestBodies');

const keys = (o) => Object.keys(o);
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('Invoice_Get body is exactly { InvoiceID } (no ReturnFullInvoice)', () => {
  const b = B.invoiceGetBody('328682');
  assert.deepStrictEqual(keys(b), ['InvoiceID']);
  assert.strictEqual(b.InvoiceID, 328682);
  assert.throws(() => B.invoiceGetBody(''), /Invalid QuickFile InvoiceID/);
  assert.throws(() => B.invoiceGetBody('abc'), /Invalid QuickFile InvoiceID/);
});

test('main.js never sends ReturnFullInvoice and uses the Invoice_Get builder', () => {
  assert.doesNotMatch(main.replace(/\/\*[\s\S]*?\*\//g, ''), /ReturnFullInvoice/);
  assert.match(main, /quickFileRequest\('\/1_2\/invoice\/get', quickfileRequestBodies\.invoiceGetBody\(/);
});

test('Invoice_Search by number: documented order', () => {
  const b = B.invoiceSearchBody({
    returnCount: 5, offset: 0, orderResultsBy: 'InvoiceNumber', orderDirection: 'DESC',
    invoiceType: 'INVOICE', invoiceNumber: '328682', showDeleted: false, showPurchaseRef: true,
  });
  assert.deepStrictEqual(keys(b), ['SearchParameters']);
  assert.deepStrictEqual(keys(b.SearchParameters), [
    'ReturnCount', 'Offset', 'OrderResultsBy', 'OrderDirection', 'InvoiceType',
    'ShowDeleted', 'InvoiceNumber', 'AdditionalParameters',
  ]);
  assert.deepStrictEqual(b.SearchParameters.AdditionalParameters, { ShowPurchaseRef: true });
});

test('Invoice_Search by CN-ATT ref: ShowDeleted before PurchaseReference', () => {
  const b = B.invoiceSearchBody({
    returnCount: 5, offset: 0, orderResultsBy: 'IssueDate', orderDirection: 'DESC',
    invoiceType: 'INVOICE', purchaseReference: 'CN-ATT-1', showDeleted: false, showPurchaseRef: true,
  });
  assert.deepStrictEqual(keys(b.SearchParameters), [
    'ReturnCount', 'Offset', 'OrderResultsBy', 'OrderDirection', 'InvoiceType',
    'ShowDeleted', 'PurchaseReference', 'AdditionalParameters',
  ]);
});

test('Invoice_Search ledger page: documented order', () => {
  const b = B.invoiceSearchBody({
    returnCount: 200, offset: 0, orderResultsBy: 'IssueDate', orderDirection: 'DESC',
    invoiceType: 'INVOICE', showDeleted: true,
  });
  assert.deepStrictEqual(keys(b.SearchParameters), [
    'ReturnCount', 'Offset', 'OrderResultsBy', 'OrderDirection', 'InvoiceType', 'ShowDeleted',
  ]);
});

test('Client_Search: CompanyName after the paging/order elements', () => {
  const b = B.clientSearchBody({
    companyName: 'Firm', returnCount: 25, offset: 0, orderResultsBy: 'CompanyName', orderDirection: 'ASC',
  });
  assert.deepStrictEqual(keys(b), ['SearchParameters']);
  assert.deepStrictEqual(keys(b.SearchParameters), [
    'ReturnCount', 'Offset', 'OrderResultsBy', 'OrderDirection', 'CompanyName',
  ]);
  const ping = B.clientSearchBody({ returnCount: 1, offset: 0, orderResultsBy: 'CompanyName', orderDirection: 'ASC' });
  assert.deepStrictEqual(keys(ping.SearchParameters), ['ReturnCount', 'Offset', 'OrderResultsBy', 'OrderDirection']);
});

test('Client_Get: ClientID then ReturnData in documented order', () => {
  const b = B.clientGetBody(12, { ClientContacts: false, Address: false });
  assert.deepStrictEqual(keys(b), ['ClientID', 'ReturnData']);
  assert.deepStrictEqual(keys(b.ReturnData), ['Address', 'ClientContacts']);
  assert.throws(() => B.clientGetBody(1, { Bogus: true }), /Unknown Client_Get ReturnData/);
});

test('Invoice_Create SingleInvoiceData: InvoiceNumber, PurchaseReference, IssueDate', () => {
  assert.deepStrictEqual(keys(B.singleInvoiceData({
    issueDate: '2026-10-24', purchaseReference: 'CN-ATT-1', invoiceNumber: '100',
  })), ['InvoiceNumber', 'PurchaseReference', 'IssueDate']);
  /* Auto-number: no InvoiceNumber element at all. */
  assert.deepStrictEqual(keys(B.singleInvoiceData({ issueDate: '2026-10-24', purchaseReference: 'CN-ATT-1' })),
    ['PurchaseReference', 'IssueDate']);
  /* Fallback after auto-number rejection rebuilds the object (keeps order). */
  assert.match(main, /invoicePayload\.InvoiceData\.Scheduling\.SingleInvoiceData = quickfileRequestBodies\.singleInvoiceData\(/);
  assert.doesNotMatch(main, /singleInvoiceData\.InvoiceNumber = /);
});

test('every search/get call in main.js goes through a builder (no hand-written bodies)', () => {
  assert.doesNotMatch(main, /quickFileRequest\('\/1_2\/(client|invoice)\/(search|get)', \{/);
});
