'use strict';

/**
 * QuickFile online invoice view links.
 *
 * Invoice_Get does not return ViewHref; Invoice_Search rows do. Custody Note must
 * not build app.quickfile.co.uk/invoice/view/{id} — that URL often renders blank.
 */

function pickViewHrefFromRecord(record) {
  if (!record || typeof record !== 'object') return '';
  const candidates = [
    record.ViewHref,
    record.viewHref,
    record.ViewURL,
    record.ViewUrl,
    record.InvoiceViewHref,
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const s = String(candidates[i] || '').trim();
    if (s && /^https?:\/\//i.test(s)) return s;
  }
  return '';
}

function unwrapInvoiceGetBody(body) {
  if (!body || typeof body !== 'object') return body;
  if (body.Invoice && typeof body.Invoice === 'object') return body.Invoice;
  if (body.InvoiceDetails && typeof body.InvoiceDetails === 'object') return body.InvoiceDetails;
  return body;
}

function pickDirectPreviewUri(getBody) {
  const b = unwrapInvoiceGetBody(getBody);
  if (!b || typeof b !== 'object') return '';
  const uri = b.DirectPreviewUri || b.directPreviewUri;
  const s = String(uri || '').trim();
  return s && /^https?:\/\//i.test(s) ? s : '';
}

/**
 * Resolve a view URL from data already in hand (no API calls).
 * @param {{ searchRow?: object, getBody?: object, invoiceId?: string }} opts
 * @returns {string}
 */
function resolveInvoiceViewUrlFromSources(opts) {
  const o = opts || {};
  const fromSearch = pickViewHrefFromRecord(o.searchRow);
  if (fromSearch) return fromSearch;
  const fromPreview = pickDirectPreviewUri(o.getBody);
  if (fromPreview) return fromPreview;
  return '';
}

module.exports = {
  pickViewHrefFromRecord,
  pickDirectPreviewUri,
  resolveInvoiceViewUrlFromSources,
  unwrapInvoiceGetBody,
};
