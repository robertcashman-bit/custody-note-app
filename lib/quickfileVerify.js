'use strict';

const { pickInvoiceIdentity } = require('./quickfileInvoiceNumber');

function normaliseInvoiceNumber(raw) {
  return String(raw || '').trim().replace(/^#+/, '');
}

function extractInvoiceTotal(body) {
  const b = body && typeof body === 'object' ? body : {};
  const candidates = [
    b.TotalGross, b.GrossTotal, b.InvoiceTotal, b.Total, b.AmountDue,
    b.TotalAmount, b.GrandTotal,
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const n = Number(candidates[i]);
    if (Number.isFinite(n)) return n;
  }
  const sub = Number(b.SubTotal || b.NetTotal || b.TotalNet);
  const vat = Number(b.VatTotal || b.TotalVat || b.VAT);
  if (Number.isFinite(sub) && Number.isFinite(vat)) return sub + vat;
  return NaN;
}

/**
 * Confirm fetched QuickFile invoice matches what we intended to create.
 * @param {{ expectedNumber?: string, expectedTotal?: number, fetchedBody?: object, tolerance?: number }} opts
 */
function verifyQuickFileInvoice(opts) {
  const o = opts || {};
  const id = pickInvoiceIdentity(o.fetchedBody, o.expectedNumber);
  const num = normaliseInvoiceNumber(id.invoiceNumber || o.expectedNumber);
  const expectedNum = normaliseInvoiceNumber(o.expectedNumber);
  if (expectedNum && num && expectedNum !== num) {
    return { ok: false, reason: 'Invoice number mismatch (expected ' + expectedNum + ', got ' + num + ')' };
  }
  const expectedTotal = Number(o.expectedTotal);
  const actualTotal = extractInvoiceTotal(o.fetchedBody);
  const tol = Number.isFinite(Number(o.tolerance)) ? Number(o.tolerance) : 0.02;
  if (Number.isFinite(expectedTotal) && Number.isFinite(actualTotal)) {
    if (Math.abs(actualTotal - expectedTotal) > tol) {
      return {
        ok: false,
        reason: 'Invoice total mismatch (expected ' + expectedTotal.toFixed(2) + ', got ' + actualTotal.toFixed(2) + ')',
      };
    }
  } else if (Number.isFinite(expectedTotal) && !Number.isFinite(actualTotal)) {
    return { ok: false, reason: 'Could not read invoice total from QuickFile' };
  }
  const expectedClient = Number(o.expectedClientId);
  if (Number.isFinite(expectedClient) && expectedClient > 0) {
    const b = o.fetchedBody && typeof o.fetchedBody === 'object' ? o.fetchedBody : {};
    const inv = b.InvoiceData || b.Invoice || b;
    const actualClient = Number(inv.ClientID || inv.ClientId || b.ClientID || b.ClientId);
    if (!Number.isFinite(actualClient) || actualClient !== expectedClient) {
      return {
        ok: false,
        reason: 'Invoice client mismatch (expected ClientID ' + expectedClient + ', got '
          + (Number.isFinite(actualClient) ? String(actualClient) : 'unknown') + ')',
      };
    }
  }
  return { ok: true, invoiceNumber: num || expectedNum, invoiceId: id.invoiceId };
}

module.exports = {
  verifyQuickFileInvoice,
  extractInvoiceTotal,
};
