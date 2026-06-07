'use strict';

/**
 * LAA Declaration block for attendance-note PDFs — privacy notice, applicant
 * declaration prose, and shared table row labels. Shared by renderer and node --test.
 */

var PRIVACY_ACK_LABEL = 'Privacy Notice acknowledged?';

function buildLaaDeclarationPdfCss() {
  return '.laa-privacy-box{font-size:8.5px;background:#fffbeb;border:1px solid #f59e0b;border-radius:5px;padding:6px 9px;margin:6px 0;line-height:1.4;print-color-adjust:exact;}' +
    '.laa-decl-heading{font-size:9px;font-weight:700;margin:0 0 4px;color:#92400e;}' +
    '.laa-decl-applicant{font-size:9px;font-weight:700;margin:0 0 4px;color:#92400e;}';
}

function buildLaaPrivacyNoticeHtml(refData, esc) {
  esc = esc || function(s) { return String(s == null ? '' : s); };
  var text = refData && refData.privacyNoticeText ? String(refData.privacyNoticeText).trim() : '';
  if (!text) return '';
  return '<div class="laa-privacy-box"><p class="laa-decl-heading">Privacy Notice</p><p>' + esc(text) + '</p></div>';
}

function buildLaaApplicantDeclarationHtml(refData, esc) {
  esc = esc || function(s) { return String(s == null ? '' : s); };
  var text = refData && refData.laaDeclarationText ? String(refData.laaDeclarationText).trim() : '';
  if (!text) return '';
  return '<div class="decl-box"><p class="laa-decl-applicant">Applicant\u2019s Declaration</p><p>' + esc(text) + '</p></div>';
}

module.exports = {
  PRIVACY_ACK_LABEL: PRIVACY_ACK_LABEL,
  buildLaaDeclarationPdfCss: buildLaaDeclarationPdfCss,
  buildLaaPrivacyNoticeHtml: buildLaaPrivacyNoticeHtml,
  buildLaaApplicantDeclarationHtml: buildLaaApplicantDeclarationHtml,
};

if (typeof window !== 'undefined') {
  window.LaaDeclarationPdf = module.exports;
}
