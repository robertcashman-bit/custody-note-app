'use strict';

/**
 * Draft watermark for attendance-note PDF HTML (custody, telephone, voluntary).
 * Record-level status (finalised/completed) and fee-earner certification both
 * suppress the watermark — they were previously out of sync (Bug v1.9.118).
 *
 * Dual-export: Node tests + renderer <script> (window.PdfDraftWatermark).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.PdfDraftWatermark = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var WATERMARK_LABEL = 'DRAFT';

  function recordStatusFromData(d) {
    if (!d || typeof d !== 'object') return '';
    var st = d._recordStatus != null ? d._recordStatus : d.recordStatus;
    return String(st || '').trim().toLowerCase();
  }

  function isRecordStatusFinalisedForPdf(d) {
    var st = recordStatusFromData(d);
    return st === 'finalised' || st === 'completed';
  }

  function isFeeEarnerCertificationFinalised(d) {
    if (!d) return false;
    return String(d.feeEarnerCertification || '').trim() === 'Finalised';
  }

  /**
   * True when the note should render without a draft watermark.
   * Certification alone does not suppress the watermark on an explicit draft record
   * (avoids false "final" PDFs when finalise aborted or amend reset save failed).
   */
  function isAttendanceNoteFinalisedForPdf(d) {
    if (isRecordStatusFinalisedForPdf(d)) return true;
    if (!isFeeEarnerCertificationFinalised(d)) return false;
    var st = recordStatusFromData(d);
    return st !== 'draft';
  }

  /** Payload for IPC finalise save — includes Finalised cert without touching live form state. */
  function buildFinaliseAttendanceSavePayload(data) {
    var base = data && typeof data === 'object' ? data : {};
    var out = Object.assign({}, base);
    if (out.feeEarnerCertification !== 'Finalised') {
      out.feeEarnerCertification = 'Finalised';
    }
    return out;
  }

  function shouldResetCertificationForDraftRecord(recordStatus, certification) {
    var st = String(recordStatus || 'draft').trim().toLowerCase();
    if (st !== 'draft') return false;
    return String(certification || '').trim() === 'Finalised';
  }

  function shouldShowPdfDraftWatermark(d) {
    return !isAttendanceNoteFinalisedForPdf(d);
  }

  function pdfDraftWatermarkHtml(d) {
    if (!shouldShowPdfDraftWatermark(d)) return '';
    return '<div class="watermark">' + WATERMARK_LABEL + '</div>';
  }

  return {
    WATERMARK_LABEL: WATERMARK_LABEL,
    recordStatusFromData: recordStatusFromData,
    isRecordStatusFinalisedForPdf: isRecordStatusFinalisedForPdf,
    isFeeEarnerCertificationFinalised: isFeeEarnerCertificationFinalised,
    isAttendanceNoteFinalisedForPdf: isAttendanceNoteFinalisedForPdf,
    shouldShowPdfDraftWatermark: shouldShowPdfDraftWatermark,
    pdfDraftWatermarkHtml: pdfDraftWatermarkHtml,
    buildFinaliseAttendanceSavePayload: buildFinaliseAttendanceSavePayload,
    shouldResetCertificationForDraftRecord: shouldResetCertificationForDraftRecord,
  };
});
