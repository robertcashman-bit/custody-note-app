'use strict';

/**
 * QuickFile client resolution helpers (pure + testable).
 */

const { unwrapInvoiceBody } = require('./quickfileInvoiceNumber');

function normaliseCompanyName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function clientRecordName(record) {
  const r = record && typeof record === 'object' ? record : {};
  return String(r.ClientName || r.CompanyName || r.ClientCompanyName || r.Name || '').trim();
}

/**
 * Exact company name match (case-insensitive, collapsed whitespace).
 * @param {object} record QuickFile client search row
 * @param {string} firmName
 */
function clientRecordMatchesFirmName(record, firmName) {
  const want = normaliseCompanyName(firmName);
  if (!want) return false;
  return normaliseCompanyName(clientRecordName(record)) === want;
}

/**
 * @param {object[]} records
 * @param {string} firmName
 * @returns {object|null}
 */
function findClientByExactName(records, firmName) {
  const list = Array.isArray(records) ? records : [];
  for (let i = 0; i < list.length; i++) {
    if (clientRecordMatchesFirmName(list[i], firmName)) return list[i];
  }
  return null;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isQuickFileClientAlreadyExistsError(err) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  if (!msg) return false;
  if (/client.*already\s+(exists|exist)/.test(msg)) return true;
  if (/already\s+(exists|exist).*\bclient\b/.test(msg)) return true;
  if (/duplicate\s+client/.test(msg)) return true;
  if (/company\s*name.*already/.test(msg) && /client/.test(msg)) return true;
  return false;
}

function extractClientIdFromRecord(record) {
  const r = record && typeof record === 'object' ? record : {};
  const id = r.ClientID || r.ClientId || r.RecordID;
  if (id == null || id === '') return null;
  const n = parseInt(String(id), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractClientIdFromInvoiceBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const inv = unwrapInvoiceBody(b);
  const id = inv.ClientID || inv.ClientId || b.ClientID || b.ClientId;
  if (id == null || id === '') return null;
  const n = parseInt(String(id), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractClientNameFromInvoiceBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const inv = unwrapInvoiceBody(b);
  return String(
    inv.ClientCompanyName || inv.ClientName || inv.CompanyName
    || b.ClientCompanyName || b.ClientName || b.CompanyName || ''
  ).trim();
}

/**
 * @param {number} invoiceClientId
 * @param {number} expectedClientId
 * @param {string} [invoiceClientName]
 * @param {string} [firmName]
 */
function invoiceClientMatchesFirm(invoiceClientId, expectedClientId, invoiceClientName, firmName) {
  const exp = Number(expectedClientId);
  const inv = Number(invoiceClientId);
  if (Number.isFinite(exp) && Number.isFinite(inv) && exp === inv) return { ok: true };
  if (firmName && invoiceClientName && clientRecordMatchesFirmName({ CompanyName: invoiceClientName }, firmName)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: 'That QuickFile invoice is for a different client'
      + (invoiceClientName ? ' (“' + invoiceClientName + '”).' : '.')
      + ' Expected “' + String(firmName || '').trim() + '”.',
  };
}

module.exports = {
  normaliseCompanyName,
  clientRecordName,
  clientRecordMatchesFirmName,
  findClientByExactName,
  isQuickFileClientAlreadyExistsError,
  extractClientIdFromRecord,
  extractClientIdFromInvoiceBody,
  extractClientNameFromInvoiceBody,
  invoiceClientMatchesFirm,
};
