'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const orderBy = require('../lib/quickfileOrderResultsBy');
const bodies = require('../lib/quickfileRequestBodies');

describe('QuickFile Invoice_Search OrderResultsBy', () => {
  it('allows documented enum values', () => {
    for (const v of orderBy.INVOICE_SEARCH_ORDER_RESULTS_BY) {
      assert.strictEqual(orderBy.assertInvoiceSearchOrderResultsBy(v), v);
    }
  });

  it('rejects InvoiceID (invalid in v1.2 schema)', () => {
    assert.throws(
      () => orderBy.assertInvoiceSearchOrderResultsBy('InvoiceID'),
      /Invalid QuickFile Invoice_Search OrderResultsBy/
    );
  });

  it('invoiceSearchBody rejects invalid OrderResultsBy at build time', () => {
    assert.throws(
      () => bodies.invoiceSearchBody({
        returnCount: 5,
        offset: 0,
        orderResultsBy: 'InvoiceID',
        orderDirection: 'DESC',
        invoiceType: 'INVOICE',
      }),
      /Invalid QuickFile Invoice_Search OrderResultsBy/
    );
  });
});
