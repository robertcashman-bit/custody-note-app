'use strict';

/**
 * LAA Declaration block for attendance-note PDFs — privacy notice, applicant
 * declaration prose, partner / representative declarations, and shared table
 * row helpers. Shared by renderer (via <script>) and node --test.
 *
 * Wording is taken from the current Legal Aid Agency forms:
 *  - Police-station Advice & Assistance client declaration: CRM2 (v15, Oct 2025)
 *  - LAA Privacy Notice: as printed on CRM2 / Applicant's declaration form
 *  - Applicant / partner / representative declarations + Fraud Notice:
 *    "Criminal legal aid - Applicant's declaration for online submissions"
 *    (v7, Feb 2025)
 *
 * These constants double as built-in fallbacks so the PDF still reproduces the
 * statutory wording even if data/laa-reference-data.json fails to load in the
 * renderer.
 */

var PRIVACY_ACK_LABEL = 'Privacy Notice acknowledged?';

// CRM2 — Client's Declaration (Advice & Assistance, incl. police station).
var LAA_APPLICANT_DECLARATION =
  'As far as I know all the information I have given is true and I have not withheld any relevant information. ' +
  'I understand that if I give false information the services provided to me may be cancelled and I may be prosecuted.';

// Applicant's declaration form (Representation Order / CRM14) — Declaration by Applicant.
var CRM14_APPLICANT_DECLARATION =
  'I apply for the right to representation for the purposes of criminal proceedings under the Legal Aid, Sentencing and Punishment of Offenders Act 2012. ' +
  'I declare that my application will be made electronically by my legal representative. ' +
  'I understand that if I have declared anything that is not true, or left anything out: I may be prosecuted for fraud, and if convicted I may be sent to prison or pay a fine; my legal aid may be stopped and I may be asked to pay back my costs in full to the Legal Aid Agency (LAA); and if my case is in the Crown Court, the LAA may change the amount of the contribution which I must pay. ' +
  'I agree to tell the LAA or HM Courts & Tribunals Service (HMCTS) immediately if my income or capital, or those of my partner, change. ' +
  'I authorise such enquiries as are considered necessary to enable the LAA, its agents, HMCTS, or my solicitor to find out my income and capital, and those of my partner, including from my bank, building society, the Department for Work and Pensions, the DVLA or HM Revenue and Customs. ' +
  'I agree that, if I am convicted, the information in this form will be used by HMCTS to determine the appropriate level of any financial penalty ordered against me, and for its collection and enforcement. I have read the Fraud Notice.';

var LAA_PARTNER_DECLARATION_NOTE =
  'Partner\u2019s declaration: I declare that the information included in this application is a true statement of all my financial circumstances to the best of my knowledge and belief. I agree to the LAA checking the information I have given. I authorise those organisations to provide the information for which the LAA may ask. I have read the Fraud Notice.';

var CRM14_FRAUD_WARNING =
  'Making a false declaration is an offence. If you are found doing so, you may be prosecuted, potentially leading to a fine and/or a prison sentence. The Legal Aid Agency has a zero tolerance approach to fraud and will look to prosecute where there is evidence of fraud.';

var CRM14_PARTNER_DECLARATION_NOTE =
  'I declare that the information included in this application is a true statement of all my financial circumstances to the best of my knowledge and belief. I agree to the LAA and HMCTS, or my partner\u2019s solicitor, checking the information I have given, with the Department for Work and Pensions, HM Revenue and Customs or other people and organisations. I authorise those people and organisations to provide the information for which the LAA, HMCTS or my partner\u2019s solicitor may ask. I understand that this application will be made electronically by the legal representative. I have read the Fraud Notice.';

var CRM14_REP_DECLARATION_NOTE =
  'I represent the applicant. I confirm that I am authorised to provide representation under a contract issued by the LAA, and that I have been instructed to provide representation by a firm which holds a contract issued by the LAA, or by a solicitor employed by the LAA in the Public Defender Service who is authorised to provide representation. ' +
  'I confirm that I have gone through the questions on the Interests of Justice and financial assessment aspects of the application with the applicant. ' +
  'I confirm that the applicant has not provided me with any information which contradicts the information provided in this declaration of financial circumstances and has given me no indication that information declared is incomplete or untrue.';

// LAA Privacy Notice — as printed on the CRM2 and Applicant's declaration form.
var LAA_PRIVACY_NOTICE =
  'Purpose. This privacy notice sets out the standards that you can expect from the Legal Aid Agency (LAA) when we request or hold personal information (\u2018personal data\u2019) about you; how you can get access to a copy of your personal data; and what you can do if you think the standards are not being met. The LAA is an Executive Agency of the Ministry of Justice (MoJ). The MoJ is the data controller for the personal information we hold. The LAA collects and processes personal data for the exercise of its own and associated public functions. Our public function is to provide legal aid.\n\n' +
  'About personal information. Personal data is information about you as an individual \u2014 your name, address or telephone number \u2014 and can include the information you have provided in a legal aid application such as your financial circumstances and information relating to any current or previous legal proceedings concerning you. We will safeguard your personal data and will only disclose it where it is lawful to do so, or with your consent.\n\n' +
  'Purpose of processing and lawful basis. The LAA collects and processes the personal data provided in a legal aid application for the purposes of providing legal aid. Our lawful basis is \u2018the performance of a task carried out in the public interest or in the exercise of official authority\u2019 (Article 6(1)(e) UK GDPR); the tasks are those set out in the Legal Aid, Sentencing and Punishment of Offenders Act 2012. We use this data to decide eligibility and any contribution; to assess claims from your legal aid provider(s) for payment; to conduct assurance audits on legal aid files; and to produce statistics on our processes. Special categories of personal data and data relating to criminal convictions and offences are processed where necessary for these purposes.\n\n' +
  'Who the information may be shared with. We may share personal information with your instructed legal aid provider(s) (including any advocate); public authorities such as HMCTS, HMRC, DWP, the Home Office and HM Land Registry; non-public organisations such as credit reference agencies (Equifax, TransUnion) and our debt collection partner Advantis Credit Ltd; and, where fraud is identified, with fraud prevention agencies (including HMRC and DWP) to detect and prevent fraud and money laundering. Where a debt is owed to the LAA we may share your data for tracing, debt collection and enforcement.\n\n' +
  'Automated decision making. We do not use solely automated decision making within Article 22(1) UK GDPR; the overall decision on an application or claim is always made by a human decision maker.\n\n' +
  'Retention. Your personal information will not be retained for longer than is necessary for the lawful purposes for which it was collected. Retention periods are published at gov.uk. While retained, your data is kept securely; once the retention period is reached it is permanently and securely deleted.\n\n' +
  'Your rights and access. You can make a subject access request to find out if we hold personal data about you (Disclosure Team, Ministry of Justice, 102 Petty France, London SW1H 9AJ; Data.access@justice.gov.uk). You can withdraw consent where relevant, ask us to correct, stop processing or erase your data, and lodge a complaint with the Information Commissioner\u2019s Office (Wycliffe House, Water Lane, Wilmslow, Cheshire SK9 5AF; 0303 123 1113; www.ico.org.uk). For more information contact the Data Protection Officer, Ministry of Justice, 102 Petty France, London SW1H 9AJ; dataprotection@justice.gov.uk.';

function _esc(esc) {
  return esc || function (s) { return String(s == null ? '' : s); };
}

function _trim(v) {
  return (v == null ? '' : String(v)).trim();
}

function buildLaaDeclarationPdfCss() {
  return '.laa-privacy-box{font-size:9.5px;background:#fffbeb;border:1px solid #f59e0b;border-radius:5px;padding:8px 10px;margin:8px 0;line-height:1.5;white-space:pre-wrap;word-break:break-word;print-color-adjust:exact;}' +
    '.laa-decl-heading{font-size:10px;font-weight:700;margin:0 0 6px;color:#92400e;}' +
    '.laa-decl-applicant{font-size:10px;font-weight:700;margin:0 0 6px;color:#92400e;}' +
    '.laa-static-note{font-size:9px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;padding:6px 9px;margin:6px 0;line-height:1.45;white-space:pre-wrap;word-break:break-word;print-color-adjust:exact;}' +
    '.laa-fraud-warning{font-size:9px;background:#fef2f2;border:1px solid #fecaca;border-radius:5px;padding:6px 9px;margin:0 0 8px;line-height:1.45;word-break:break-word;print-color-adjust:exact;}';
}

function buildLaaPrivacyNoticeHtml(refData, esc) {
  esc = _esc(esc);
  var text = (refData && refData.privacyNoticeText && _trim(refData.privacyNoticeText)) || LAA_PRIVACY_NOTICE;
  return '<div class="laa-privacy-box"><p class="laa-decl-heading">Legal Aid Agency Privacy Notice</p><p>' + esc(text) + '</p></div>';
}

function buildLaaApplicantDeclarationHtml(refData, esc) {
  esc = _esc(esc);
  var text = (refData && refData.laaDeclarationText && _trim(refData.laaDeclarationText)) || LAA_APPLICANT_DECLARATION;
  return '<div class="decl-box"><p class="laa-decl-applicant">Client\u2019s Declaration (Advice &amp; Assistance \u2014 CRM1/CRM2)</p><p>' + esc(text) + '</p></div>';
}

function buildLaaPartnerDeclarationNoteHtml(esc) {
  esc = _esc(esc);
  return '<p class="laa-static-note"><em>' + esc(LAA_PARTNER_DECLARATION_NOTE) + '</em></p>';
}

function buildCrm14ApplicantDeclarationNoteHtml(esc) {
  esc = _esc(esc);
  return '<p class="laa-static-note"><strong>Declaration by the applicant.</strong> <em>' + esc(CRM14_APPLICANT_DECLARATION) + '</em></p>';
}

function buildCrm14FraudWarningHtml(esc) {
  esc = _esc(esc);
  return '<p class="laa-fraud-warning"><strong>Fraud notice.</strong> ' + esc(CRM14_FRAUD_WARNING) + '</p>';
}

function buildCrm14PartnerDeclarationNoteHtml(esc) {
  esc = _esc(esc);
  return '<p class="laa-static-note"><strong>Declaration by the applicant\u2019s partner.</strong> <em>' + esc(CRM14_PARTNER_DECLARATION_NOTE) + '</em></p>';
}

function buildCrm14RepDeclarationNoteHtml(esc) {
  esc = _esc(esc);
  return '<p class="laa-static-note"><strong>Declaration by the legal representative.</strong> <em>' + esc(CRM14_REP_DECLARATION_NOTE) + '</em></p>';
}

/**
 * Client's full name for the LAA declaration. Falls back to the record's
 * forename / middle name / surname (block capitals) when the dedicated
 * laaClientFullName field was never populated — e.g. when a PDF is generated
 * from a record whose LAA Declaration section was never opened in the form.
 */
function resolveLaaClientName(d) {
  d = d || {};
  var explicit = _trim(d.laaClientFullName);
  if (explicit) return explicit;
  var derived = [d.forename, d.middleName, d.surname].map(_trim).filter(Boolean).join(' ');
  return derived ? derived.toUpperCase() : '';
}

/** Fee earner full name for the LAA declaration, falling back to feeEarnerName. */
function resolveLaaFeeEarnerName(d) {
  d = d || {};
  return _trim(d.laaFeeEarnerFullName) || _trim(d.feeEarnerName);
}

var LaaDeclarationPdf = {
  PRIVACY_ACK_LABEL: PRIVACY_ACK_LABEL,
  LAA_APPLICANT_DECLARATION: LAA_APPLICANT_DECLARATION,
  LAA_PARTNER_DECLARATION_NOTE: LAA_PARTNER_DECLARATION_NOTE,
  LAA_PRIVACY_NOTICE: LAA_PRIVACY_NOTICE,
  CRM14_APPLICANT_DECLARATION: CRM14_APPLICANT_DECLARATION,
  CRM14_FRAUD_WARNING: CRM14_FRAUD_WARNING,
  CRM14_PARTNER_DECLARATION_NOTE: CRM14_PARTNER_DECLARATION_NOTE,
  CRM14_REP_DECLARATION_NOTE: CRM14_REP_DECLARATION_NOTE,
  buildLaaDeclarationPdfCss: buildLaaDeclarationPdfCss,
  buildLaaPrivacyNoticeHtml: buildLaaPrivacyNoticeHtml,
  buildLaaApplicantDeclarationHtml: buildLaaApplicantDeclarationHtml,
  buildLaaPartnerDeclarationNoteHtml: buildLaaPartnerDeclarationNoteHtml,
  buildCrm14ApplicantDeclarationNoteHtml: buildCrm14ApplicantDeclarationNoteHtml,
  buildCrm14FraudWarningHtml: buildCrm14FraudWarningHtml,
  buildCrm14PartnerDeclarationNoteHtml: buildCrm14PartnerDeclarationNoteHtml,
  buildCrm14RepDeclarationNoteHtml: buildCrm14RepDeclarationNoteHtml,
  resolveLaaClientName: resolveLaaClientName,
  resolveLaaFeeEarnerName: resolveLaaFeeEarnerName,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LaaDeclarationPdf;
}
if (typeof window !== 'undefined') {
  window.LaaDeclarationPdf = LaaDeclarationPdf;
}
