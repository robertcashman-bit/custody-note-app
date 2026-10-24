'use strict';

const {
  parseInvoiceNumberNumericPart,
  quickFileExtractInvoiceSearchRecords,
  formatInvoiceNumber,
} = require('./quickfileInvoiceNumber');

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 15;

/**
 * Largest numeric invoice suffix across search rows (handles mixed formats).
 * @param {object[]} records
 * @returns {number|null}
 */
function computeMaxNumericInvoiceFromRecords(records) {
  const list = Array.isArray(records) ? records : [];
  let max = null;
  for (let i = 0; i < list.length; i++) {
    const inv = list[i] || {};
    const raw = inv.InvoiceNumber || inv.Invoice_No || inv.InvoiceNo || inv.InvoiceNum || '';
    const n = parseInvoiceNumberNumericPart(raw);
    if (Number.isFinite(n) && (max === null || n > max)) max = n;
  }
  return max;
}

/**
 * Next candidate strictly above ledger max and local stored next (pure).
 * @param {{ ledgerMax?: number|null, localNext?: number, width?: number, defaultStart?: number }} opts
 * @returns {string}
 */
function invoiceNumberWidthForValue(n, minWidth) {
  const min = Number.isFinite(minWidth) && minWidth > 0 ? minWidth : 6;
  const digits = String(Math.max(1, Math.floor(Number(n) || 0))).length;
  return Math.max(min, digits);
}

/**
 * Next number to submit to QuickFile. When ledgerMax is known, it is authoritative
 * (max+1) — per-machine nextInvoiceNumber must not override QuickFile's ledger.
 * @param {{ ledgerMax?: number|null, localNext?: number, width?: number, defaultStart?: number, trustLocalWhenLedgerEmpty?: boolean }} opts
 */
function computeNextInvoiceNumberAfterSync(opts) {
  const o = opts || {};
  const minWidth = Number.isFinite(o.width) && o.width > 0 ? o.width : 6;
  const defaultStart = Number.isFinite(o.defaultStart) && o.defaultStart > 0 ? o.defaultStart : 6066;
  const ledgerMax = Number(o.ledgerMax);
  if (Number.isFinite(ledgerMax) && ledgerMax >= 1) {
    const next = ledgerMax + 1;
    const width = invoiceNumberWidthForValue(next, minWidth);
    return formatInvoiceNumber(next, width);
  }
  let localNext = Number(o.localNext);
  if (!Number.isFinite(localNext) || localNext < 1) localNext = defaultStart;
  const width = invoiceNumberWidthForValue(localNext, minWidth);
  return formatInvoiceNumber(localNext, width);
}

function mergeLedgerMaxNumeric(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || x < 1) return Number.isFinite(y) && y >= 1 ? y : null;
  if (!Number.isFinite(y) || y < 1) return x;
  return Math.max(x, y);
}

/**
 * Paginate Invoice_Search and return the highest numeric invoice number seen.
 * @param {(offset: number, pageSize: number) => Promise<object>} searchPage
 * @param {{ pageSize?: number, maxPages?: number }} [opts]
 * @returns {Promise<number|null>}
 */
async function fetchLedgerMaxInvoiceNumeric(searchPage, opts) {
  const o = opts || {};
  const pageSize = Number(o.pageSize) > 0 ? Number(o.pageSize) : DEFAULT_PAGE_SIZE;
  const maxPages = Number(o.maxPages) > 0 ? Number(o.maxPages) : DEFAULT_MAX_PAGES;
  let offset = 0;
  let globalMax = null;
  for (let page = 0; page < maxPages; page += 1) {
    const body = await searchPage(offset, pageSize);
    const records = quickFileExtractInvoiceSearchRecords(body);
    if (!records.length) break;
    const pageMax = computeMaxNumericInvoiceFromRecords(records);
    if (Number.isFinite(pageMax) && (globalMax === null || pageMax > globalMax)) {
      globalMax = pageMax;
    }
    if (records.length < pageSize) break;
    offset += pageSize;
  }
  return globalMax;
}

/** Sentinel: create invoice without InvoiceNumber (QuickFile auto-assign when supported). */
const AUTO_INVOICE_NUMBER = '__QF_AUTO_NUMBER__';

module.exports = {
  AUTO_INVOICE_NUMBER,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_PAGES,
  computeMaxNumericInvoiceFromRecords,
  computeNextInvoiceNumberAfterSync,
  fetchLedgerMaxInvoiceNumeric,
  invoiceNumberWidthForValue,
  mergeLedgerMaxNumeric,
};
