'use strict';

/**
 * Post-bill permanent purge (data minimisation).
 * Shared Mac + Windows — no platform branches.
 *
 * Eligibility: matter must be billed (invoice linked, explicit billed mark, or
 * billing process completed). Confirmation phrase required before purge.
 */

const CONFIRM_PHRASE = 'DELETE';
const PURGE_REASON = 'post_bill_purge';

/**
 * @param {object} record — attendance row and/or parsed data fields
 * @returns {{ eligible: boolean, reason: string }}
 */
function isEligibleForPostBillPurge(record) {
  const r = record || {};
  if (r.deletedAt || r.deleted_at) {
    return { eligible: false, reason: 'already_deleted' };
  }
  if (r.purgeReason === PURGE_REASON || r.deletion_reason === PURGE_REASON) {
    return { eligible: false, reason: 'already_purged' };
  }

  const data = r.data && typeof r.data === 'object' ? r.data : {};
  const hasInvoice = !!(
    (r.quickfile_invoice_id && String(r.quickfile_invoice_id).trim()) ||
    (r.quickfileInvoiceNumber && String(r.quickfileInvoiceNumber).trim()) ||
    (data.quickfile_invoice_id && String(data.quickfile_invoice_id).trim()) ||
    (data.quickfileInvoiceNumber && String(data.quickfileInvoiceNumber).trim()) ||
    (data.quickfileInvoiceUrl && String(data.quickfileInvoiceUrl).trim())
  );
  const billedMark = !!(
    r.billedToFirmAt ||
    r.billed_to_firm_at ||
    data.billedToFirmAt ||
    data.billedToFirm === true ||
    data.billedToFirm === 'Yes'
  );
  const billingDone = !!(
    r.billingProcessCompletedAt ||
    data.billingProcessCompletedAt
  );
  const officeCompleted = (r.status === 'completed') || data.officeWorkCompletedAt;

  if (hasInvoice) return { eligible: true, reason: 'invoice_linked' };
  if (billedMark) return { eligible: true, reason: 'marked_billed_to_firm' };
  if (billingDone && officeCompleted) return { eligible: true, reason: 'billing_process_completed' };
  return { eligible: false, reason: 'not_billed' };
}

/**
 * @param {unknown} typed
 * @returns {boolean}
 */
function isValidPurgeConfirmation(typed) {
  return String(typed || '').trim().toUpperCase() === CONFIRM_PHRASE;
}

/**
 * Residual local row after purge — no client content, explicit tombstone.
 * @param {{ syncId?: string|null, nowIso?: string }} opts
 */
function buildPurgedAttendanceStub(opts) {
  const o = opts || {};
  const now = o.nowIso || new Date().toISOString();
  return {
    dataJson: JSON.stringify({
      purged: true,
      purgedAt: now,
      purgeReason: PURGE_REASON,
    }),
    status: 'completed',
    clientName: '',
    stationName: '',
    dsccRef: '',
    attendanceDate: '',
    supervisorNote: '',
    deletedAt: now,
    deletionReason: PURGE_REASON,
    syncId: o.syncId || null,
  };
}

/**
 * Cloud purge request body (website agent implements /api/sync/purge).
 * @param {{ licenceKey: string, machineId: string, syncId: string, attendanceId?: number|string }} parts
 */
function buildCloudPurgeRequest(parts) {
  const p = parts || {};
  return {
    key: String(p.licenceKey || '').trim().toUpperCase(),
    machineId: String(p.machineId || ''),
    syncId: String(p.syncId || ''),
    reason: PURGE_REASON,
    // Never include note body / client fields
  };
}

/**
 * @param {unknown} reason
 * @returns {boolean}
 */
function isPostBillPurgeReason(reason) {
  return String(reason || '') === PURGE_REASON;
}

/**
 * Sticky tombstone: never let a newer remote body revive a local post_bill_purge.
 * Prefer keeping the local tombstone; caller may re-push it to cloud.
 * If the remote row is also a purge tombstone, allow apply (metadata-only).
 *
 * @param {unknown} localDeletionReason
 * @param {unknown} remoteDeletionReason
 * @returns {boolean} true → skip remote body overwrite
 */
function shouldKeepLocalPostBillPurgeTombstone(localDeletionReason, remoteDeletionReason) {
  if (!isPostBillPurgeReason(localDeletionReason)) return false;
  if (isPostBillPurgeReason(remoteDeletionReason)) return false;
  return true;
}

/**
 * Version to push when retaining a sticky purge tombstone against a remote row.
 * Must overtake both sides in one bump (same pattern as keep_local).
 * @param {unknown} localVersion
 * @param {unknown} remoteVersion
 * @returns {number}
 */
function nextTombstoneSyncVersion(localVersion, remoteVersion) {
  const local = Number(localVersion);
  const remote = Number(remoteVersion);
  return Math.max(Number.isFinite(local) ? local : 1, Number.isFinite(remote) ? remote : 1) + 1;
}

/**
 * Redacted audit snapshot placeholder — proves history without note bodies.
 * @returns {string}
 */
function buildRedactedAuditSnapshotJson() {
  return JSON.stringify({ redacted: true, reason: PURGE_REASON });
}

module.exports = {
  CONFIRM_PHRASE,
  PURGE_REASON,
  isEligibleForPostBillPurge,
  isValidPurgeConfirmation,
  buildPurgedAttendanceStub,
  buildCloudPurgeRequest,
  isPostBillPurgeReason,
  shouldKeepLocalPostBillPurgeTombstone,
  nextTombstoneSyncVersion,
  buildRedactedAuditSnapshotJson,
};
