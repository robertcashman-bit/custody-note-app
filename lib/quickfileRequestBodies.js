'use strict';

const { assertInvoiceSearchOrderResultsBy } = require('./quickfileOrderResultsBy');

/**
 * QuickFile v1.2 request Body builders.
 *
 * QuickFile validates each Body against an XSD: unknown elements are rejected
 * ("invalid child element ...") and elements are expected in the documented
 * sequence order. Every builder here emits only documented elements, in the
 * order listed at https://api.quickfile.co.uk/d/v1_2/<Method>, and omits
 * optional elements that are not set.
 */

function put(target, key, value) {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

/** Invoice_Get: Body = { InvoiceID } only. */
function invoiceGetBody(invoiceId) {
  const id = parseInt(String(invoiceId == null ? '' : invoiceId).trim(), 10);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid QuickFile InvoiceID');
  return { InvoiceID: id };
}

/**
 * Invoice_Search SearchParameters order: ReturnCount, Offset, OrderResultsBy,
 * OrderDirection, InvoiceType, TagName, ShowDeleted, ClientDetails, ...,
 * InvoiceNumber, ..., Status, PurchaseReference, AdditionalParameters.
 */
function invoiceSearchBody(o) {
  const orderBy = o.orderResultsBy != null && o.orderResultsBy !== ''
    ? assertInvoiceSearchOrderResultsBy(o.orderResultsBy)
    : undefined;
  const p = {};
  put(p, 'ReturnCount', o.returnCount);
  put(p, 'Offset', o.offset);
  put(p, 'OrderResultsBy', orderBy);
  put(p, 'OrderDirection', o.orderDirection);
  put(p, 'InvoiceType', o.invoiceType);
  if (typeof o.showDeleted === 'boolean') p.ShowDeleted = o.showDeleted;
  put(p, 'InvoiceNumber', o.invoiceNumber);
  put(p, 'PurchaseReference', o.purchaseReference);
  if (o.showPurchaseRef) p.AdditionalParameters = { ShowPurchaseRef: true };
  return { SearchParameters: p };
}

/**
 * Client_Search SearchParameters order: ReturnCount, Offset, OrderResultsBy,
 * OrderDirection, ShowDeleted, CompanyName, ...
 */
function clientSearchBody(o) {
  const p = {};
  put(p, 'ReturnCount', o.returnCount);
  put(p, 'Offset', o.offset);
  put(p, 'OrderResultsBy', o.orderResultsBy);
  put(p, 'OrderDirection', o.orderDirection);
  put(p, 'CompanyName', o.companyName);
  return { SearchParameters: p };
}

const CLIENT_GET_RETURN_DATA_ORDER = ['Address', 'VATDetails', 'Preferences', 'ClientContacts', 'Financials', 'GoCardlessDetails'];

/** Client_Get: ClientID, then optional ReturnData flags in documented order. */
function clientGetBody(clientId, returnData) {
  const body = { ClientID: clientId };
  if (returnData && typeof returnData === 'object') {
    const rd = {};
    for (const k of CLIENT_GET_RETURN_DATA_ORDER) {
      if (typeof returnData[k] === 'boolean') rd[k] = returnData[k];
    }
    for (const k of Object.keys(returnData)) {
      if (!CLIENT_GET_RETURN_DATA_ORDER.includes(k)) throw new Error('Unknown Client_Get ReturnData element: ' + k);
    }
    body.ReturnData = rd;
  }
  return body;
}

/** Invoice_Create Scheduling.SingleInvoiceData order: InvoiceNumber, PurchaseReference, IssueDate. */
function singleInvoiceData(o) {
  const d = {};
  put(d, 'InvoiceNumber', o.invoiceNumber);
  put(d, 'PurchaseReference', o.purchaseReference);
  put(d, 'IssueDate', o.issueDate);
  return d;
}

module.exports = {
  invoiceGetBody,
  invoiceSearchBody,
  clientSearchBody,
  clientGetBody,
  singleInvoiceData,
  CLIENT_GET_RETURN_DATA_ORDER,
};
