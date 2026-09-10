'use strict';

/**
 * QuickFile invoice-number helpers — pure / injectable so duplicate recovery
 * can be unit-tested without hitting the live API or Electron main process.
 */

const MAX_INVOICE_NUMBER_ATTEMPTS = 35;
const PURCHASE_REF_MAX = 25;

/**
 * Largest numeric segment from an invoice reference (handles "006069", "INV-6069").
 * @param {unknown} raw
 * @returns {number}
 */
function parseInvoiceNumberNumericPart(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return NaN;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Stable PurchaseReference for an attendance (QuickFile max length 25).
 * @param {unknown} attendanceId
 * @returns {string}
 */
function attendancePurchaseReference(attendanceId) {
  const id = String(attendanceId == null ? '' : attendanceId).trim();
  if (!id) return '';
  return ('CN-ATT-' + id).slice(0, PURCHASE_REF_MAX);
}

/**
 * Marker embedded in Notes so older/partial invoices can still be matched.
 * @param {unknown} attendanceId
 * @returns {string}
 */
function attendanceNotesMarker(attendanceId) {
  const id = String(attendanceId == null ? '' : attendanceId).trim();
  if (!id) return '';
  return '[CN-ATT:' + id + ']';
}

/**
 * Append the attendance marker to Notes without inventing narrative content.
 * @param {string} notes
 * @param {unknown} attendanceId
 * @returns {string}
 */
function appendAttendanceNotesMarker(notes, attendanceId) {
  const marker = attendanceNotesMarker(attendanceId);
  if (!marker) return String(notes || '');
  const base = String(notes || '');
  if (base.toLowerCase().includes(marker.toLowerCase())) return base;
  const joined = base ? (base.replace(/\s+$/, '') + '\n' + marker) : marker;
  return joined.slice(0, 4000);
}

/**
 * True when a QuickFile invoice search/get row clearly belongs to this attendance.
 * @param {object|null|undefined} record
 * @param {unknown} attendanceId
 * @returns {boolean}
 */
function invoiceBelongsToAttendance(record, attendanceId) {
  if (!record || typeof record !== 'object' || attendanceId == null || attendanceId === '') {
    return false;
  }
  const ref = attendancePurchaseReference(attendanceId);
  const purchaseRef = String(
    record.PurchaseReference || record.PurchaseRef || record.purchaseReference || ''
  ).trim();
  if (ref && purchaseRef && purchaseRef === ref) return true;

  const marker = attendanceNotesMarker(attendanceId).toLowerCase();
  if (!marker) return false;
  const notes = String(
    record.Notes || record.InvoiceNotes || record.Note || record.Description || ''
  ).toLowerCase();
  return notes.includes(marker);
}

/**
 * Detect QuickFile "invoice number already used/exists" errors across known variants.
 * @param {unknown} err
 * @returns {boolean}
 */
function isQuickFileInvoiceNumberDuplicateError(err) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  if (!msg) return false;

  /* Explicit phrases seen in UI / community / API-ish responses */
  const phrases = [
    'already exists',
    'already exist',
    'already used',
    'already in use',
    'already been used',
    'already there',
    'already taken',
    'has already been allocated',
    'number is in use',
    'number in use',
    'invoice number is not unique',
    'invoice number not unique',
    'duplicate invoice number',
    'invoice number duplicate',
  ];
  for (let i = 0; i < phrases.length; i++) {
    if (msg.includes(phrases[i])) return true;
  }

  if (msg.includes('duplicate') && msg.includes('invoice')) return true;

  /* "invoice number … already …" with filler words (is/has/been) */
  if (/invoice\s*(?:#|no\.?|number)?\s*[\w-]*\s+(?:is\s+|has\s+)?(?:already|in use)/.test(msg)) {
    return true;
  }
  if (/invoicenumber\s+(?:is\s+|has\s+)?(?:already|in use)/.test(msg)) return true;

  /* "006066 already exists" / "Invoice #006066 already…" */
  if (/\b\d{3,}\b/.test(msg) && /already\s+(exists|exist|used|taken|there|in use)/.test(msg)) {
    return true;
  }

  return false;
}

/**
 * Best-effort extract of the conflicting invoice number from an error message.
 * @param {unknown} err
 * @returns {string}
 */
function extractConflictingInvoiceNumber(err) {
  const msg = String((err && err.message) || err || '');
  if (!msg) return '';
  const patterns = [
    /invoice\s*(?:#|no\.?|number)?\s*[:=]?\s*([A-Za-z0-9-]{1,20})/i,
    /invoicenumber\s*[:=]?\s*([A-Za-z0-9-]{1,20})/i,
    /\b(\d{4,20})\b/,
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = msg.match(patterns[i]);
    if (m && m[1] && /[0-9]/.test(m[1])) return String(m[1]).trim();
  }
  return '';
}

/**
 * Normalise Invoice_Search body into a record array.
 * @param {object|null|undefined} body
 * @returns {object[]}
 */
function quickFileExtractInvoiceSearchRecords(body) {
  if (!body || typeof body !== 'object') return [];
  const list =
    body.Record ||
    body.Records ||
    body.InvoiceDetails ||
    body.Invoices ||
    body.InvoiceList ||
    [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean);
}

/**
 * Pick InvoiceID / InvoiceNumber from a create body or search row.
 * @param {object|null|undefined} body
 * @param {string} [fallbackNumber]
 * @returns {{invoiceId:string,invoiceNumber:string}}
 */
function pickInvoiceIdentity(body, fallbackNumber) {
  const b = body && typeof body === 'object' ? body : {};
  const invoiceId = String(
    b.InvoiceID || b.InvoiceId || b.RecordID || b.invoiceId || ''
  ).trim();
  const invoiceNumber = String(
    b.InvoiceNumber || b.Invoice_No || b.InvoiceNo || b.InvoiceNum || fallbackNumber || ''
  ).trim();
  return { invoiceId, invoiceNumber };
}

/**
 * Create an invoice with bounded duplicate-number recovery.
 *
 * Prefer reuse when an existing QuickFile invoice clearly belongs to this
 * attendance; otherwise allocate the next number and retry.
 *
 * @param {object} opts
 * @param {() => string} opts.allocateNextNumber
 * @param {(invNum: string) => Promise<object>} opts.createWithNumber
 * @param {() => Promise<object|null|undefined>} [opts.findByAttendanceRef]
 * @param {(invNum: string) => Promise<object|null|undefined>} [opts.findByInvoiceNumber]
 * @param {(raw: string) => void} [opts.bumpPastNumber]
 * @param {unknown} [opts.attendanceId]
 * @param {number} [opts.maxAttempts]
 * @param {(err: unknown, invNum: string) => void} [opts.onConflictWarn]
 * @returns {Promise<{reused:boolean,invoiceBody:object,invoiceNumber:string,invoiceId:string}>}
 */
async function createInvoiceWithDuplicateRecovery(opts) {
  const o = opts || {};
  const maxAttempts = Math.max(1, Number(o.maxAttempts) || MAX_INVOICE_NUMBER_ATTEMPTS);
  const attendanceId = o.attendanceId;

  if (typeof o.allocateNextNumber !== 'function') {
    throw new Error('allocateNextNumber is required');
  }
  if (typeof o.createWithNumber !== 'function') {
    throw new Error('createWithNumber is required');
  }

  if (attendanceId != null && attendanceId !== '' && typeof o.findByAttendanceRef === 'function') {
    const existing = await o.findByAttendanceRef();
    if (existing && invoiceBelongsToAttendance(existing, attendanceId)) {
      const id = pickInvoiceIdentity(existing);
      return {
        reused: true,
        invoiceBody: existing,
        invoiceId: id.invoiceId,
        invoiceNumber: id.invoiceNumber,
      };
    }
  }

  let lastCreateErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const invNum = o.allocateNextNumber();
    try {
      const invoiceBody = await o.createWithNumber(invNum);
      const id = pickInvoiceIdentity(invoiceBody, invNum);
      return {
        reused: false,
        invoiceBody: invoiceBody || {},
        invoiceId: id.invoiceId,
        invoiceNumber: id.invoiceNumber || invNum,
      };
    } catch (e) {
      lastCreateErr = e;
      if (!isQuickFileInvoiceNumberDuplicateError(e)) throw e;

      if (
        attendanceId != null && attendanceId !== ''
        && typeof o.findByInvoiceNumber === 'function'
      ) {
        try {
          const found = await o.findByInvoiceNumber(invNum);
          if (found && invoiceBelongsToAttendance(found, attendanceId)) {
            const id = pickInvoiceIdentity(found, invNum);
            return {
              reused: true,
              invoiceBody: found,
              invoiceId: id.invoiceId,
              invoiceNumber: id.invoiceNumber || invNum,
            };
          }
        } catch (_) {
          /* search failure must not block retrying the next free number */
        }
      }

      const conflictRaw = extractConflictingInvoiceNumber(e) || invNum;
      if (typeof o.bumpPastNumber === 'function' && conflictRaw) {
        try { o.bumpPastNumber(conflictRaw); } catch (_) { /* ignore */ }
      }
      if (typeof o.onConflictWarn === 'function') {
        try { o.onConflictWarn(e, invNum); } catch (_) { /* ignore */ }
      }
      if (attempt === maxAttempts - 1) throw e;
    }
  }
  throw lastCreateErr || new Error('QuickFile invoice/create failed');
}

module.exports = {
  MAX_INVOICE_NUMBER_ATTEMPTS,
  parseInvoiceNumberNumericPart,
  attendancePurchaseReference,
  attendanceNotesMarker,
  appendAttendanceNotesMarker,
  invoiceBelongsToAttendance,
  isQuickFileInvoiceNumberDuplicateError,
  extractConflictingInvoiceNumber,
  quickFileExtractInvoiceSearchRecords,
  pickInvoiceIdentity,
  createInvoiceWithDuplicateRecovery,
};
