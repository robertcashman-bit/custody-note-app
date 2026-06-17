'use strict';

/**
 * LAA Declaration block for attendance-note PDFs — privacy notice, applicant
 * declaration prose, and shared table row labels. Shared by renderer and node --test.
 */

var PRIVACY_ACK_LABEL = 'Privacy Notice acknowledged?';

var LAA_PARTNER_DECLARATION_NOTE =
  'Partner\u2019s declaration: I declare that the information included in this application is a true statement of all my financial circumstances to the best of my knowledge and belief. I agree to the LAA checking the information I have given. I authorise those organisations to provide the information for which the LAA may ask. I have read the Fraud Notice.';

var CRM14_FRAUD_WARNING =
  'Please note: Making a false declaration is an offence. If you are found doing so, you may be prosecuted, potentially leading to a fine and/or prison sentence. The Legal Aid Agency has a zero tolerance approach to fraud and will look to prosecute where there is evidence of fraud.';

var CRM14_PARTNER_DECLARATION_NOTE =
  'I declare that the information included in this application is a true statement of all my financial circumstances to the best of my knowledge and belief. I agree to the LAA and HMCTS, or my partner\u2019s solicitor, checking the information I have given, with the Department for Work and Pensions, HM Revenue and Customs or other people and organisations. I authorise those people and organisations to provide the information for which the LAA, HMCTS or my partner\u2019s solicitor may ask. I understand that this application will be made electronically by the legal representative. I have read the Fraud Notice.';

var CRM14_REP_DECLARATION_NOTE =
  'I confirm that I have gone through the questions on the Interests of Justice and financial assessment aspects of the application with the applicant. I confirm that the applicant has not provided me with any information which contradicts the information provided in this application.';

function buildLaaDeclarationPdfCss() {
  return '.laa-privacy-box{font-size:9.5px;background:#fffbeb;border:1px solid #f59e0b;border-radius:5px;padding:8px 10px;margin:8px 0;line-height:1.5;white-space:pre-wrap;word-break:break-word;print-color-adjust:exact;}' +
    '.laa-decl-heading{font-size:10px;font-weight:700;margin:0 0 6px;color:#92400e;}' +
    '.laa-decl-applicant{font-size:10px;font-weight:700;margin:0 0 6px;color:#92400e;}' +
    '.laa-static-note{font-size:9px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;padding:6px 9px;margin:6px 0;line-height:1.45;white-space:pre-wrap;word-break:break-word;print-color-adjust:exact;}' +
    '.laa-fraud-warning{font-size:9px;background:#fef2f2;border:1px solid #fecaca;border-radius:5px;padding:6px 9px;margin:0 0 8px;line-height:1.45;word-break:break-word;print-color-adjust:exact;}';
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

function buildLaaPartnerDeclarationNoteHtml(esc) {
  esc = esc || function(s) { return String(s == null ? '' : s); };
  return '<p class="laa-static-note"><em>' + esc(LAA_PARTNER_DECLARATION_NOTE) + '</em></p>';
}

function buildCrm14FraudWarningHtml(esc) {
  esc = esc || function(s) { return String(s == null ? '' : s); };
  return '<p class="laa-fraud-warning"><strong>Fraud notice.</strong> ' + esc(CRM14_FRAUD_WARNING) + '</p>';
}

function buildCrm14PartnerDeclarationNoteHtml(esc) {
  esc = esc || function(s) { return String(s == null ? '' : s); };
  return '<p class="laa-static-note"><em>' + esc(CRM14_PARTNER_DECLARATION_NOTE) + '</em></p>';
}

function buildCrm14RepDeclarationNoteHtml(esc) {
  esc = esc || function(s) { return String(s == null ? '' : s); };
  return '<p class="laa-static-note"><em>' + esc(CRM14_REP_DECLARATION_NOTE) + '</em></p>';
}

var LaaDeclarationPdf = {
  PRIVACY_ACK_LABEL: PRIVACY_ACK_LABEL,
  LAA_PARTNER_DECLARATION_NOTE: LAA_PARTNER_DECLARATION_NOTE,
  CRM14_FRAUD_WARNING: CRM14_FRAUD_WARNING,
  CRM14_PARTNER_DECLARATION_NOTE: CRM14_PARTNER_DECLARATION_NOTE,
  CRM14_REP_DECLARATION_NOTE: CRM14_REP_DECLARATION_NOTE,
  buildLaaDeclarationPdfCss: buildLaaDeclarationPdfCss,
  buildLaaPrivacyNoticeHtml: buildLaaPrivacyNoticeHtml,
  buildLaaApplicantDeclarationHtml: buildLaaApplicantDeclarationHtml,
  buildLaaPartnerDeclarationNoteHtml: buildLaaPartnerDeclarationNoteHtml,
  buildCrm14FraudWarningHtml: buildCrm14FraudWarningHtml,
  buildCrm14PartnerDeclarationNoteHtml: buildCrm14PartnerDeclarationNoteHtml,
  buildCrm14RepDeclarationNoteHtml: buildCrm14RepDeclarationNoteHtml,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LaaDeclarationPdf;
}
if (typeof window !== 'undefined') {
  window.LaaDeclarationPdf = LaaDeclarationPdf;
}
