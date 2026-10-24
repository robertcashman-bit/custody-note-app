'use strict';

/**
 * Plain-English QuickFile errors for the renderer + redacted copy text.
 * Pure functions — no secrets, client names, or amounts in output.
 */

const crypto = require('crypto');

const CATEGORIES = {
  AUTH: 'auth',
  APP_ID: 'app_id',
  CLIENT: 'client',
  VALIDATION: 'validation',
  DUPLICATE: 'duplicate',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  SERVER: 'server_5xx',
  RATE_LIMIT: 'rate_limit',
  UNCONFIRMED: 'unconfirmed',
  PREFLIGHT: 'preflight',
  VERIFY: 'verify',
  UNKNOWN: 'unknown',
};

function makeReferenceCode(seed) {
  const s = String(seed || Date.now());
  const hash = crypto.createHash('sha256').update(s).digest('hex').slice(0, 6).toUpperCase();
  return 'QF-' + hash;
}

function _msgLower(err) {
  if (!err) return '';
  if (typeof err === 'string') return err.toLowerCase();
  return String(err.message || err.error || '').toLowerCase();
}

function classifyQuickFileFailure(err, ctx) {
  const c = ctx || {};
  const code = (err && err.code) ? String(err.code) : (c.code ? String(c.code) : '');
  const httpStatus = Number(
    (err && err.httpStatus) || c.httpStatus || (/\bHTTP (\d{3})\b/i.exec(_msgLower(err)) || [])[1]
  );
  const raw = _msgLower(err);
  const createSent = !!(c.createRequestSent || (err && err.createRequestSent));
  const isNet = typeof c.isNetworkError === 'function' ? c.isNetworkError(err) : false;

  if (code === 'QF_PREFLIGHT') {
    return { category: CATEGORIES.PREFLIGHT, retryable: false };
  }
  if (code === 'QF_VERIFY') {
    return { category: CATEGORIES.VERIFY, retryable: false };
  }
  if (code === 'QF_UNCONFIRMED' || (createSent && isNet)) {
    return { category: CATEGORIES.UNCONFIRMED, retryable: true };
  }
  if (code === 'QF_TIMEOUT' || /did not reply within|qf_timeout/i.test(raw)) {
    return { category: CATEGORIES.TIMEOUT, retryable: true };
  }
  if (isNet || code === 'QF_NETWORK' || /econn|enotfound|network|socket hang up/i.test(raw)) {
    return { category: CATEGORIES.NETWORK, retryable: true };
  }
  if (httpStatus === 429) {
    return { category: CATEGORIES.RATE_LIMIT, retryable: true };
  }
  if (httpStatus >= 500 && httpStatus < 600) {
    return { category: CATEGORIES.SERVER, retryable: true };
  }
  if (httpStatus === 401 || httpStatus === 403 || /auth|credential|md5|authentication|not configured|missing in settings/i.test(raw)) {
    return { category: CATEGORIES.AUTH, retryable: false };
  }
  if (/application.?id|applicationid|not authorised|not authorized|app id/i.test(raw)) {
    return { category: CATEGORIES.APP_ID, retryable: false };
  }
  if (/client.*not found|could not find or create|clientid is invalid|client_create|find or create quickfile client/i.test(raw)) {
    return { category: CATEGORIES.CLIENT, retryable: false };
  }
  if (/already (exists|used|in use)|duplicate invoice|invoice number.*not unique/i.test(raw)) {
    return { category: CATEGORIES.DUPLICATE, retryable: false };
  }
  if (/preflight|no billable|firm name is required|amount/i.test(raw) && !createSent) {
    return { category: CATEGORIES.VALIDATION, retryable: false };
  }
  if (/invalid|validation|required|must be/i.test(raw)) {
    return { category: CATEGORIES.VALIDATION, retryable: false };
  }
  return { category: CATEGORIES.UNKNOWN, retryable: false };
}

function userMessageForCategory(category, ctx) {
  const c = ctx || {};
  const fieldMsg = c.fieldMessage ? String(c.fieldMessage).trim() : '';
  switch (category) {
    case CATEGORIES.AUTH:
      return 'QuickFile rejected the sign-in details. Check account number, API key and Application ID in Settings, then use Test connection.';
    case CATEGORIES.APP_ID:
      return 'The Application ID is not authorised for this QuickFile account. Confirm the ID in QuickFile and in Settings.';
    case CATEGORIES.CLIENT:
      return 'QuickFile could not find or create the firm client record. Check the instructing firm name and try again.';
    case CATEGORIES.VALIDATION:
      return fieldMsg || 'QuickFile rejected the invoice data. Fix the highlighted issue and send again.';
    case CATEGORIES.DUPLICATE:
      return 'That invoice number is already used in QuickFile. The app will try the next free number when you retry.';
    case CATEGORIES.NETWORK:
      return 'Could not reach QuickFile. Check your internet connection (police-station Wi‑Fi often blocks accounting sites).';
    case CATEGORIES.TIMEOUT:
      return 'QuickFile did not answer in time. Nothing may have been created unless the request was already sent.';
    case CATEGORIES.SERVER:
      return 'QuickFile’s service returned a temporary error. Wait a moment and retry.';
    case CATEGORIES.RATE_LIMIT:
      return 'QuickFile asked us to slow down (too many requests). Wait a few seconds and retry.';
    case CATEGORIES.UNCONFIRMED:
      return 'The invoice may or may not exist in QuickFile. Retry sends safely link an existing invoice for this record instead of duplicating.';
    case CATEGORIES.PREFLIGHT:
      return fieldMsg || 'Some checks failed before contacting QuickFile. Fix the items below and try again.';
    case CATEGORIES.VERIFY:
      return 'An invoice may exist in QuickFile but could not be verified. Open QuickFile and confirm manually before marking as sent.';
    default:
      return fieldMsg || 'Sending to QuickFile failed. See the reason below and retry when fixed.';
  }
}

function buildRedactedCopyDetails(payload) {
  const p = payload || {};
  const lines = [
    'Custody Note — QuickFile send (redacted)',
    'Reference: ' + (p.referenceCode || 'QF-UNKNOWN'),
    'Category: ' + (p.category || 'unknown'),
    'Code: ' + (p.code || '—'),
    'HTTP: ' + (p.httpStatus != null ? String(p.httpStatus) : '—'),
    'Attendance ID: ' + (p.attendanceId != null ? String(p.attendanceId) : '—'),
    'Invoice number tried: ' + (p.invoiceNumberTried || '—'),
    'Create request sent: ' + (p.createRequestSent ? 'yes' : 'no'),
    'Reason: ' + String(p.technicalReason || p.error || 'Unknown').slice(0, 800),
  ];
  return lines.join('\n');
}

/**
 * @param {object} input IPC failure or thrown error context
 * @returns {object} enriched failure for renderer
 */
function enrichQuickFileFailure(input) {
  const r = input || {};
  const errLike = { message: r.error || r.message, code: r.code, httpStatus: r.httpStatus };
  const classified = classifyQuickFileFailure(errLike, r);
  const referenceCode = r.referenceCode || makeReferenceCode(
    (r.attendanceId || '') + '|' + (r.code || '') + '|' + Date.now()
  );
  const userMessage = r.userMessage || userMessageForCategory(classified.category, r);
  const technicalReason = String(r.error || r.message || '').trim() || 'Unknown error';
  return {
    ok: false,
    code: r.code,
    error: technicalReason,
    mayHaveBeenCreated: !!r.mayHaveBeenCreated,
    category: classified.category,
    userTitle: r.userTitle || (classified.category === CATEGORIES.UNCONFIRMED
      ? "QuickFile didn't confirm the invoice"
      : 'Not sent to QuickFile'),
    userMessage,
    advice: r.advice,
    referenceCode,
    copyDetails: buildRedactedCopyDetails({
      referenceCode,
      category: classified.category,
      code: r.code,
      httpStatus: r.httpStatus,
      attendanceId: r.attendanceId,
      invoiceNumberTried: r.invoiceNumberTried,
      createRequestSent: r.createRequestSent,
      technicalReason,
    }),
    retryable: classified.retryable,
  };
}

module.exports = {
  CATEGORIES,
  makeReferenceCode,
  classifyQuickFileFailure,
  userMessageForCategory,
  buildRedactedCopyDetails,
  enrichQuickFileFailure,
};
