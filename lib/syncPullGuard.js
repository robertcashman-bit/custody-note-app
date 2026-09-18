'use strict';

/**
 * Hostile-cloud pull guard (Mac + Windows — identical rules).
 * ----------------------------------------------------------------------------
 * Treat /api/sync/pull responses as untrusted. A compromised cloud DB/API must
 * not be able to:
 *   - inject plaintext note bodies (skipping AES-GCM),
 *   - deliver cross-account records,
 *   - force a silent full-cloud dump into renderer-facing IPC,
 *   - smuggle oversized / malformed payloads that weaken local integrity.
 *
 * Fail closed. Shared path — no platform branches.
 */

const MAX_PULL_RECORDS_PER_BATCH = 500;
const MAX_ENVELOPE_CHARS = 5 * 1024 * 1024; // 5 MiB per envelope
const MAX_SYNC_ID_LEN = 128;
const SYNC_ID_RE = /^[A-Za-z0-9_.:@-]{8,128}$/;

/**
 * True when a blob looks like unauthenticated JSON rather than a CNSYNC envelope.
 * Used to reject cloud-injected plaintext even before decrypt is attempted.
 */
function looksLikePlaintextJsonEnvelope(blob) {
  if (typeof blob !== 'string') return false;
  const t = blob.trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

/**
 * Validate top-level pull HTTP JSON before any merge.
 *
 * @param {unknown} resp
 * @param {{
 *   expectedLicenceKey?: string|null,
 *   expectedAccountId?: string|null,
 *   maxRecords?: number,
 * }} [ctx]
 * @returns {{ ok: true, records: object[], serverTime: string|null, hasMore: boolean }
 *   | { ok: false, code: string, error: string }}
 */
function validatePullResponse(resp, ctx) {
  const opts = ctx || {};
  if (!resp || typeof resp !== 'object' || Array.isArray(resp)) {
    return { ok: false, code: 'MALFORMED_RESPONSE', error: 'Pull response is not an object' };
  }
  if (resp.ok !== true) {
    return {
      ok: false,
      code: 'PULL_NOT_OK',
      error: typeof resp.error === 'string' && resp.error ? resp.error : 'Pull failed',
    };
  }

  // Cross-account binding: if the server echoes identity, it must match ours.
  const expectedKey = opts.expectedLicenceKey
    ? String(opts.expectedLicenceKey).trim().toUpperCase()
    : '';
  if (expectedKey && resp.licenceKey != null && String(resp.licenceKey).trim() !== '') {
    const echoed = String(resp.licenceKey).trim().toUpperCase();
    if (echoed !== expectedKey) {
      return {
        ok: false,
        code: 'CROSS_ACCOUNT_LICENCE',
        error: 'Pull response licence key does not match this installation',
      };
    }
  }
  if (expectedKey && resp.key != null && String(resp.key).trim() !== '') {
    const echoed = String(resp.key).trim().toUpperCase();
    if (echoed !== expectedKey) {
      return {
        ok: false,
        code: 'CROSS_ACCOUNT_LICENCE',
        error: 'Pull response key does not match this installation',
      };
    }
  }
  const expectedAccount = opts.expectedAccountId != null && String(opts.expectedAccountId).trim() !== ''
    ? String(opts.expectedAccountId).trim()
    : '';
  if (expectedAccount && resp.accountId != null && String(resp.accountId).trim() !== '') {
    if (String(resp.accountId).trim() !== expectedAccount) {
      return {
        ok: false,
        code: 'CROSS_ACCOUNT_ID',
        error: 'Pull response accountId does not match this installation',
      };
    }
  }
  if (expectedAccount && resp.userId != null && String(resp.userId).trim() !== '') {
    if (String(resp.userId).trim() !== expectedAccount) {
      return {
        ok: false,
        code: 'CROSS_ACCOUNT_ID',
        error: 'Pull response userId does not match this installation',
      };
    }
  }

  if (resp.records == null) {
    return {
      ok: true,
      records: [],
      serverTime: typeof resp.serverTime === 'string' ? resp.serverTime : null,
      hasMore: false,
    };
  }
  if (!Array.isArray(resp.records)) {
    return { ok: false, code: 'MALFORMED_RECORDS', error: 'Pull records must be an array' };
  }

  const maxRecords = typeof opts.maxRecords === 'number' && opts.maxRecords > 0
    ? opts.maxRecords
    : MAX_PULL_RECORDS_PER_BATCH;
  if (resp.records.length > maxRecords) {
    return {
      ok: false,
      code: 'BATCH_TOO_LARGE',
      error: 'Pull batch exceeds safe size (' + maxRecords + ')',
    };
  }

  return {
    ok: true,
    records: resp.records,
    serverTime: typeof resp.serverTime === 'string' ? resp.serverTime : null,
    hasMore: !!resp.hasMore,
  };
}

/**
 * Validate one remote record shell before decrypt/merge.
 * Requires an encrypted envelope — plaintext cloud rows are rejected.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, syncId: string, envelope: string, version: number,
 *             createdAt: string|null, updatedAt: string|null }
 *   | { ok: false, code: string, error: string }}
 */
function validatePullRecordShell(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'MALFORMED_RECORD', error: 'Record is not an object' };
  }
  // Reject prototype-pollution style keys on the outer shell.
  if (Object.prototype.hasOwnProperty.call(raw, '__proto__')
      || Object.prototype.hasOwnProperty.call(raw, 'constructor')) {
    return { ok: false, code: 'MALFORMED_RECORD', error: 'Record contains forbidden keys' };
  }

  const syncId = raw.syncId != null ? String(raw.syncId) : (raw.sync_id != null ? String(raw.sync_id) : '');
  if (!syncId || syncId.length > MAX_SYNC_ID_LEN || !SYNC_ID_RE.test(syncId)) {
    return { ok: false, code: 'INVALID_SYNC_ID', error: 'Missing or invalid syncId' };
  }

  // Hostile cloud must not deliver plaintext note bodies alongside/instead of envelope.
  if (raw.data != null && (typeof raw.data === 'string' || typeof raw.data === 'object')
      && (raw.envelope == null || String(raw.envelope).trim() === '')) {
    return {
      ok: false,
      code: 'PLAINTEXT_RECORD_REJECTED',
      error: 'Cloud record has plaintext data without encrypted envelope',
    };
  }

  const envelope = raw.envelope != null ? String(raw.envelope) : '';
  if (!envelope) {
    return {
      ok: false,
      code: 'MISSING_ENVELOPE',
      error: 'Cloud record missing encrypted envelope',
    };
  }
  if (envelope.length > MAX_ENVELOPE_CHARS) {
    return { ok: false, code: 'ENVELOPE_TOO_LARGE', error: 'Envelope exceeds size limit' };
  }
  if (looksLikePlaintextJsonEnvelope(envelope)) {
    return {
      ok: false,
      code: 'PLAINTEXT_ENVELOPE_REJECTED',
      error: 'Cloud envelope is plaintext JSON — AES-GCM required',
    };
  }

  let version = 1;
  if (raw.version != null) {
    const n = Number(raw.version);
    if (!Number.isFinite(n) || n < 1 || n > Number.MAX_SAFE_INTEGER) {
      return { ok: false, code: 'INVALID_VERSION', error: 'Invalid record version' };
    }
    version = Math.floor(n);
  }

  return {
    ok: true,
    syncId,
    envelope,
    version,
    createdAt: raw.createdAt != null ? String(raw.createdAt) : (raw.created_at != null ? String(raw.created_at) : null),
    updatedAt: raw.updatedAt != null ? String(raw.updatedAt) : (raw.updated_at != null ? String(raw.updated_at) : null),
  };
}

/**
 * After decrypt: bind inner identity to outer syncId and strip hostile fields.
 *
 * @param {object|null} payload
 * @param {string} outerSyncId
 * @returns {{ ok: true, payload: object } | { ok: false, code: string, error: string }}
 */
function bindDecryptedPullPayload(payload, outerSyncId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, code: 'DECRYPT_EMPTY', error: 'Decrypted payload missing' };
  }
  if (Object.prototype.hasOwnProperty.call(payload, '__proto__')
      || Object.prototype.hasOwnProperty.call(payload, 'constructor')) {
    return { ok: false, code: 'MALFORMED_PAYLOAD', error: 'Payload contains forbidden keys' };
  }
  const innerId = payload.syncId != null
    ? String(payload.syncId)
    : (payload.sync_id != null ? String(payload.sync_id) : '');
  if (innerId && innerId !== String(outerSyncId)) {
    return {
      ok: false,
      code: 'SYNC_ID_MISMATCH',
      error: 'Decrypted syncId does not match outer record',
    };
  }
  // Cross-account fields inside ciphertext (if present) are ignored for apply;
  // reject only when they conflict with an explicit expected binding supplied later.
  if (payload.data == null) {
    return { ok: false, code: 'MISSING_DATA', error: 'Decrypted payload missing data' };
  }
  if (typeof payload.data !== 'string') {
    // Persist as string — attendances.data is TEXT JSON.
    try {
      payload = Object.assign({}, payload, { data: JSON.stringify(payload.data) });
    } catch (_) {
      return { ok: false, code: 'INVALID_DATA', error: 'Decrypted data is not serialisable' };
    }
  }
  return { ok: true, payload };
}

/**
 * Build headers for auth-bound sync requests (pull/push).
 * Always includes licence-scoped correlation; Bearer when a session token exists.
 * Shared for Mac and Windows.
 *
 * @param {{
 *   authToken?: string|null,
 *   correlationId?: string|null,
 *   licenceKey?: string|null,
 *   accountId?: string|null,
 * }} parts
 * @returns {Record<string, string>}
 */
function buildSyncAuthHeaders(parts) {
  const p = parts || {};
  const headers = {};
  if (p.correlationId) headers['X-Correlation-Id'] = String(p.correlationId);
  if (p.licenceKey) {
    const k = String(p.licenceKey).trim().toUpperCase();
    if (k) headers['X-Custody-Licence'] = k.slice(0, 64);
  }
  if (p.accountId && String(p.accountId).trim()) {
    headers['X-Custody-Account'] = String(p.accountId).trim().slice(0, 128);
  }
  if (p.authToken && String(p.authToken).trim()) {
    headers.Authorization = 'Bearer ' + String(p.authToken).trim();
  }
  return headers;
}

/**
 * Explicit user confirmation required for renderer-triggered cloud download /
 * full re-sync / emergency index export. Prevents silent full-cloud dump IPC.
 *
 * @param {unknown} params
 * @returns {boolean}
 */
function hasExplicitUserConfirmation(params) {
  if (!params || typeof params !== 'object') return false;
  return params.confirmed === true || params.userConfirmed === true;
}

module.exports = {
  MAX_PULL_RECORDS_PER_BATCH,
  MAX_ENVELOPE_CHARS,
  looksLikePlaintextJsonEnvelope,
  validatePullResponse,
  validatePullRecordShell,
  bindDecryptedPullPayload,
  buildSyncAuthHeaders,
  hasExplicitUserConfirmation,
};
