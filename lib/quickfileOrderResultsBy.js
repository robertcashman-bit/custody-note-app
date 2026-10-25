'use strict';

/** QuickFile Invoice_Search v1.2 — documented OrderResultsBy values only. */
const INVOICE_SEARCH_ORDER_RESULTS_BY = Object.freeze([
  'InvoiceNumber',
  'IssueDate',
  'ClientName',
  'Total',
]);

function assertInvoiceSearchOrderResultsBy(value) {
  const v = String(value || '').trim();
  if (!INVOICE_SEARCH_ORDER_RESULTS_BY.includes(v)) {
    throw new Error(
      'Invalid QuickFile Invoice_Search OrderResultsBy: '
      + (v || '(empty)')
      + '. Allowed: '
      + INVOICE_SEARCH_ORDER_RESULTS_BY.join(', ')
    );
  }
  return v;
}

module.exports = {
  INVOICE_SEARCH_ORDER_RESULTS_BY,
  assertInvoiceSearchOrderResultsBy,
};
