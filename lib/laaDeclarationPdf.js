'use strict';

/**
 * LAA Declaration blocks — official wording for in-app signature sections and PDFs.
 * Shared by renderer (script tag) and node --test.
 *
 * Sources:
 *  - CRM2 v15 Oct 2025 — Advice & Assistance client declaration + Privacy Notice
 *  - Applicant's declaration for online submissions v7 Feb 2025 — CRM14 / Apply
 */

var PRIVACY_ACK_LABEL = 'Privacy Notice acknowledged?';

// CRM2 — Client's Declaration (Advice & Assistance, incl. police station).
var LAA_APPLICANT_DECLARATION =
  'As far as I know all the information I have given is true and I have not withheld any relevant information. ' +
  'I understand that if I give false information the services provided to me may be cancelled and I may be prosecuted.';

var LAA_PARTNER_DECLARATION_NOTE =
  'Partner\u2019s declaration: I declare that the information included in this application is a true statement of all my financial circumstances to the best of my knowledge and belief. I agree to the LAA checking the information I have given. I authorise those organisations to provide the information for which the LAA may ask. I have read the Fraud Notice.';

var CRM14_FRAUD_WARNING =
  'Making a false declaration is an offence. If you are found doing so, you may be prosecuted, potentially leading to a fine and/or a prison sentence. The Legal Aid Agency has a zero tolerance approach to fraud and will look to prosecute where there is evidence of fraud.';

var CRM14_PARTNER_DECLARATION_NOTE =
  'I declare that the information included in this application is a true statement of all my financial circumstances to the best of my knowledge and belief. I agree to the LAA and HMCTS, or my partner\u2019s solicitor, checking the information I have given, with the Department for Work and Pensions, HM Revenue and Customs or other people and organisations. I authorise those people and organisations to provide the information for which the LAA, HMCTS or my partner\u2019s solicitor may ask. I understand that this application will be made electronically by the legal representative. I have read the Fraud Notice.';

var CRM14_REP_DECLARATION_NOTE =
  'I represent the applicant. I confirm that I am authorised to provide representation under a contract issued by the LAA. ' +
  'I confirm that I have been instructed to provide representation by a firm which holds a contract issued by the LAA, or by a solicitor employed by the LAA in the Public Defender Service who is authorised to provide representation. ' +
  'I confirm that I have gone through the questions on the Interests of Justice and financial assessment aspects of the application with the applicant. ' +
  'I confirm that the applicant has not provided me with any information which contradicts the information provided in this declaration of financial circumstances and has given me no indication that information declared is incomplete or untrue.';

// Full v7 Applicant's Declaration — structured paragraphs (online criminal legal aid).
var CRM14_APPLICANT_PARAGRAPHS = [
  'I apply for the right to representation for the purposes of criminal proceedings under the Legal Aid, Sentencing and Punishment of Offenders Act 2012.',
  'I declare that my application will be made electronically by my legal representative.',
  'I understand that if I have declared anything that is not true, or left anything out:',
  'I may be prosecuted for fraud. I understand that if I am convicted, I may be sent to prison or pay a fine.',
  'My legal aid may be stopped and I may be asked to pay back my costs in full to the Legal Aid Agency (LAA).',
  'If my case is in the Crown Court, the LAA may change the amount of the contribution which I must pay.',
  'I agree to tell the LAA or HM Courts & Tribunals Service (HMCTS) immediately if my income or capital or those of my partner, change. These changes include the sale of property, change of address, change in employment and change in capital.',
  'Evidence: I agree to provide, when asked, further details and evidence of my finances and those of my partner, to the LAA, its agents, or HMCTS, to help them decide whether an Order should be made and its terms.',
  'Ending legal aid: I understand that I must tell my solicitor and write to the court if I no longer want public representation. I understand that if I decline representation I may be liable for costs incurred to the date when my solicitor and the court receive my letter.',
  'I authorise such enquiries as are considered necessary to enable the LAA, its agents, HMCTS, or my solicitor to find out my income and capital, and those of my partner. This includes my consent for parties such as my bank, building society, the Department for Work and Pensions, the Driver and Vehicle Licensing Agency or HM Revenue and Customs to provide information to assist the LAA, its agents or HMCTS with their enquiries.',
  'I consent to the LAA or my solicitor contacting my partner for information and evidence about my partner\u2019s means. This includes circumstances where my partner is unable to sign or complete the form.',
  'I understand that if the information which my partner provides is incorrect, or if my partner refuses to provide information, then: if my case is in the magistrates\u2019 court, my legal aid may be withdrawn or, if my case is in the Crown Court, I may be liable to sanctions. I understand that the sanctions may result in me paying, or paying more towards my legal costs, or paying my legal aid costs in full.',
  'I understand that in Crown Court proceedings the information I have given in this form will be used to determine whether I am eligible for legal aid and, if so, whether I am liable to contribute to the costs of my defence under an Income contribution Order during my case or, if I am convicted, under a Final Contribution Order at the end of my case, or both.',
  'I understand that if I am ordered to pay towards my legal aid under an Income Contribution Order, or if I am convicted and ordered to pay under a Final Contribution Order but fail to pay as the Order instructs me, interest may be charged or enforcement proceedings may be brought against me or both.',
  'I understand that I may have to pay the costs of the enforcement proceedings in addition to the payments required under the Contribution Order, and the enforcement proceedings could result in a charge being placed on my home.',
  'Data sharing: I agree that, if I am convicted, the information in this form will be used by HMCTS or a designated officer to determine the appropriate level of any financial penalty ordered against me, and for its collection and enforcement. I have read the Fraud Notice.',
];

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

function _privacyText(refData) {
  return (refData && refData.privacyNoticeText && _trim(refData.privacyNoticeText)) || LAA_PRIVACY_NOTICE;
}

function _adviceDeclarationText(refData) {
  return (refData && refData.laaDeclarationText && _trim(refData.laaDeclarationText)) || LAA_APPLICANT_DECLARATION;
}

function _crm14ApplicantHtml(esc, forPdf) {
  esc = _esc(esc);
  var cls = forPdf ? '' : ' class="declaration-text"';
  var parts = CRM14_APPLICANT_PARAGRAPHS.map(function (p) {
    return '<p' + cls + '>' + esc(p) + '</p>';
  }).join('');
  if (forPdf) {
    return '<div class="decl-box"><p class="laa-decl-applicant">Declaration by the applicant (Apply for criminal legal aid \u2014 v7 Feb 2025)</p>' + parts + '</div>';
  }
  return '<h3>Applicant\u2019s Declaration</h3>' + parts;
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
  return '<div class="laa-privacy-box"><p class="laa-decl-heading">Legal Aid Agency Privacy Notice</p><p>' + esc(_privacyText(refData)) + '</p></div>';
}

function buildLaaApplicantDeclarationHtml(refData, esc) {
  esc = _esc(esc);
  return '<div class="decl-box"><p class="laa-decl-applicant">Client\u2019s Declaration (Advice &amp; Assistance \u2014 CRM1/CRM2)</p><p>' + esc(_adviceDeclarationText(refData)) + '</p></div>';
}

function buildLaaPartnerDeclarationNoteHtml(esc) {
  esc = _esc(esc);
  return '<p class="laa-static-note"><em>' + esc(LAA_PARTNER_DECLARATION_NOTE) + '</em></p>';
}

function buildCrm14ApplicantDeclarationNoteHtml(esc) {
  return _crm14ApplicantHtml(esc, true);
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
 * In-app declaration blocks — shown immediately before signature fields.
 * @param {string} variant - adviceAssistance | crm14Applicant | partnerAdvice | partnerCrm14 | representative
 */
function buildLaaDeclarationFormHtml(variant, refData, esc) {
  esc = _esc(esc);
  var html = '<div class="declaration-box laa-decl-block" data-laa-decl-variant="' + esc(variant) + '">';
  if (variant === 'adviceAssistance') {
    html += '<p class="privacy-text"><strong>Legal Aid Agency Privacy Notice</strong></p>';
    html += '<p class="privacy-text">' + esc(_privacyText(refData)) + '</p>';
    html += '<h3>Client\u2019s Declaration (Advice &amp; Assistance \u2014 CRM1/CRM2)</h3>';
    html += '<p class="declaration-text">' + esc(_adviceDeclarationText(refData)) + '</p>';
  } else if (variant === 'crm14Applicant') {
    html += '<p class="privacy-text"><strong>Legal Aid Agency Privacy Notice</strong></p>';
    html += '<p class="privacy-text">' + esc(_privacyText(refData)) + '</p>';
    html += '<p class="laa-fraud-warning"><strong>Fraud notice.</strong> ' + esc(CRM14_FRAUD_WARNING) + '</p>';
    html += _crm14ApplicantHtml(esc, false);
  } else if (variant === 'partnerAdvice') {
    html += '<p class="declaration-text"><em>' + esc(LAA_PARTNER_DECLARATION_NOTE) + '</em></p>';
  } else if (variant === 'partnerCrm14') {
    html += '<p class="declaration-text"><strong>Declaration by the applicant\u2019s partner.</strong></p>';
    html += '<p class="declaration-text"><em>' + esc(CRM14_PARTNER_DECLARATION_NOTE) + '</em></p>';
  } else if (variant === 'representative') {
    html += '<p class="declaration-text"><strong>Declaration by the legal representative.</strong></p>';
    html += '<p class="declaration-text"><em>' + esc(CRM14_REP_DECLARATION_NOTE) + '</em></p>';
  }
  html += '</div>';
  return html;
}

function resolveLaaClientName(d) {
  d = d || {};
  var explicit = _trim(d.laaClientFullName);
  if (explicit) return explicit;
  var derived = [d.forename, d.middleName, d.surname].map(_trim).filter(Boolean).join(' ');
  return derived ? derived.toUpperCase() : '';
}

function resolveLaaFeeEarnerName(d) {
  d = d || {};
  return _trim(d.laaFeeEarnerFullName) || _trim(d.feeEarnerName);
}

var CRM14_APPLICANT_DECLARATION = CRM14_APPLICANT_PARAGRAPHS.join(' ');

var LaaDeclarationPdf = {
  PRIVACY_ACK_LABEL: PRIVACY_ACK_LABEL,
  LAA_APPLICANT_DECLARATION: LAA_APPLICANT_DECLARATION,
  LAA_PARTNER_DECLARATION_NOTE: LAA_PARTNER_DECLARATION_NOTE,
  LAA_PRIVACY_NOTICE: LAA_PRIVACY_NOTICE,
  CRM14_APPLICANT_DECLARATION: CRM14_APPLICANT_DECLARATION,
  CRM14_APPLICANT_PARAGRAPHS: CRM14_APPLICANT_PARAGRAPHS,
  CRM14_FRAUD_WARNING: CRM14_FRAUD_WARNING,
  CRM14_PARTNER_DECLARATION_NOTE: CRM14_PARTNER_DECLARATION_NOTE,
  CRM14_REP_DECLARATION_NOTE: CRM14_REP_DECLARATION_NOTE,
  buildLaaDeclarationPdfCss: buildLaaDeclarationPdfCss,
  buildLaaPrivacyNoticeHtml: buildLaaPrivacyNoticeHtml,
  buildLaaApplicantDeclarationHtml: buildLaaApplicantDeclarationHtml,
  buildLaaPartnerDeclarationNoteHtml: buildLaaPartnerDeclarationNoteHtml,
  buildLaaDeclarationFormHtml: buildLaaDeclarationFormHtml,
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
