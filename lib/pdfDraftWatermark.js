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

  /** True when the note should render without a draft watermark. */
  function isAttendanceNoteFinalisedForPdf(d) {
    return isRecordStatusFinalisedForPdf(d) || isFeeEarnerCertificationFinalised(d);
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
  };
});
