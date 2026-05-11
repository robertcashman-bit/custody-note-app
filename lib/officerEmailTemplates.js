'use strict';

/**
 * lib/officerEmailTemplates.js
 * ----------------------------------------------------------------------------
 * Pure helpers for the Officer Emails module. No DOM, no Electron, no IO —
 * safe to require from main.js, preload.js, the renderer (via `require`-shim
 * or a bundler), and node:test files.
 *
 * Responsibilities:
 *   - normaliseOfficerEmailDraft(data)          → coerces user input to a fixed shape
 *   - generateOfficerEmailSubject(data)         → builds the default subject line
 *   - generateOfficerEmailBody(data)            → builds the default body for each template
 *   - buildOutlookComposeUrl({to,subject,body}) → Outlook Web deeplink URL only
 *   - validateOfficerEmailDraft(data)           → warnings/errors used by main + renderer
 *
 * Security notes:
 *   - The Outlook URL is hard-pinned to outlook.office.com/mail/deeplink/compose
 *     and built with URLSearchParams; line breaks are preserved as CRLF so they
 *     survive the round-trip through Outlook Web's body parser.
 *   - There is no `mailto:` builder here. There is no `window.open` here.
 *   - validateOfficerEmailDraft only produces warnings; it never makes a network
 *     call and never throws. Callers decide whether to block on warnings.
 */

const SIGNATURE_NAME = 'Robert Cashman';
const OUTLOOK_COMPOSE_BASE = 'https://outlook.office.com/mail/deeplink/compose';
const MAX_BODY_CHARS = 50000;

const TEMPLATE_TYPES = Object.freeze([
  'disclosure_confirm_attendance',
  'custody_log_request',
  'chase_disclosure',
  'confirm_matter_effective',
  'request_officer_contact',
  'request_update_after_delay',
  'bail_details_request',
  'voluntary_interview_confirmation',
  'free_text',
]);

const TEMPLATE_LABELS = Object.freeze({
  disclosure_confirm_attendance: 'Disclosure / confirm attendance',
  custody_log_request: 'Custody log request',
  chase_disclosure: 'Chase disclosure',
  confirm_matter_effective: 'Confirm matter is effective',
  request_officer_contact: 'Request officer contact details',
  request_update_after_delay: 'Request update after delay',
  bail_details_request: 'Bail details request',
  voluntary_interview_confirmation: 'Voluntary interview confirmation',
  free_text: 'Free text email',
});

const STATUS_VALUES = Object.freeze([
  'draft',
  'ready_for_outlook',
  'opened_in_outlook',
  'sent_manually',
  'cancelled',
  'deleted',
]);

const STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  ready_for_outlook: 'Ready for Outlook',
  opened_in_outlook: 'Opened in Outlook',
  sent_manually: 'Sent manually',
  cancelled: 'Cancelled',
  deleted: 'Deleted',
});

/* Fixed allow-list of "official" recipient domains. The renderer can pass an
   `extraAllowedDomains` array (e.g. solicitor firm domains pulled from the
   firms table) — those are merged in as best-effort and treated equally. */
const FIXED_ALLOWED_DOMAINS = Object.freeze([
  'police.uk',
  'cps.gov.uk',
  'justice.gov.uk',
  'gov.uk',
  'judiciary.uk',
  'mod.gov.uk',
  'nhs.net',
  'nhs.uk',
]);

const PLACEHOLDERS = Object.freeze({
  clientName: '[Client Name]',
  policeStation: '[Police Station]',
  offence: '[Offence]',
  attendanceDate: '[Date]',
  bailReturnDate: '[Bail Return Date]',
  bailConditions: '[Bail Conditions]',
});

function _str(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function _trim(value) {
  return _str(value).trim();
}

/** Default recipient salutation: "DDO" for custody-log requests, "Officer" otherwise. */
function defaultRecipientName(templateType) {
  if (templateType === 'custody_log_request') return 'DDO';
  return 'Officer';
}

/** Coerce arbitrary input into the fixed draft shape. Strings only, all defaults filled. */
function normaliseOfficerEmailDraft(input) {
  const d = input || {};
  let templateType = _trim(d.templateType);
  if (!TEMPLATE_TYPES.includes(templateType)) templateType = 'disclosure_confirm_attendance';
  return {
    templateType: templateType,
    toEmail: _trim(d.toEmail),
    recipientName: _trim(d.recipientName),
    clientName: _trim(d.clientName),
    policeStation: _trim(d.policeStation),
    offence: _trim(d.offence),
    attendanceDate: _trim(d.attendanceDate),
    extraNote: _trim(d.extraNote),
    bailReturnDate: _trim(d.bailReturnDate),
    bailConditions: _trim(d.bailConditions),
    userEmailAddress: _trim(d.userEmailAddress),
    subject: _str(d.subject),
    body: _str(d.body),
  };
}

/** Subject default: "[Client Name] - [Police Station] - [Offence] - [Email Type]".
 *  Missing fields are replaced with readable bracketed placeholders. */
function generateOfficerEmailSubject(data) {
  const d = normaliseOfficerEmailDraft(data);
  const parts = [
    d.clientName || PLACEHOLDERS.clientName,
    d.policeStation || PLACEHOLDERS.policeStation,
    d.offence || PLACEHOLDERS.offence,
    TEMPLATE_LABELS[d.templateType] || 'Officer email',
  ];
  return parts.join(' - ');
}

function _salutation(recipientName, templateType) {
  const trimmed = _trim(recipientName);
  if (trimmed) return 'Dear ' + trimmed;
  return 'Dear ' + defaultRecipientName(templateType);
}

function _val(value, placeholder) {
  const t = _trim(value);
  return t || placeholder;
}

function _appendExtraNote(lines, extraNote) {
  const t = _trim(extraNote);
  if (!t) return;
  lines.push('');
  lines.push('Additional note: ' + t);
}

function _appendSignOff(lines) {
  lines.push('');
  lines.push('Kind regards,');
  lines.push(SIGNATURE_NAME);
}

/** Builds the default body for the chosen template. For "free_text", returns empty
 *  string — the renderer leaves whatever the user typed (or empty for new drafts). */
function generateOfficerEmailBody(data) {
  const d = normaliseOfficerEmailDraft(data);
  const client = _val(d.clientName, PLACEHOLDERS.clientName);
  const station = _val(d.policeStation, PLACEHOLDERS.policeStation);
  const offence = _val(d.offence, PLACEHOLDERS.offence);
  const dateText = _val(d.attendanceDate, PLACEHOLDERS.attendanceDate);
  const lines = [];
  lines.push(_salutation(d.recipientName, d.templateType));
  lines.push('');

  switch (d.templateType) {
    case 'disclosure_confirm_attendance':
      lines.push(
        'I am writing to confirm my attendance as the solicitor representing ' + client +
        ' at ' + station + ' on ' + dateText + ' in relation to ' + offence + '.'
      );
      lines.push('');
      lines.push('Please send pre-interview disclosure at your earliest convenience.');
      break;
    case 'custody_log_request':
      lines.push(
        'Please could you send through a copy of the custody log for ' + client +
        ' in relation to ' + offence + ' at ' + station + ' on ' + dateText + '.'
      );
      break;
    case 'chase_disclosure':
      lines.push(
        'Further to my earlier request, please could you send the disclosure for ' +
        client + ' (offence: ' + offence + ') at ' + station + ' on ' + dateText +
        ' as soon as possible.'
      );
      break;
    case 'confirm_matter_effective':
      lines.push(
        'Please can you confirm that the ' + client + ' matter (offence: ' + offence +
        ') at ' + station + ' on ' + dateText + ' is effective.'
      );
      break;
    case 'request_officer_contact':
      lines.push(
        'Please could you confirm the contact details of the officer in charge for ' +
        client + ' (offence: ' + offence + ') at ' + station + ' on ' + dateText + '.'
      );
      break;
    case 'request_update_after_delay':
      lines.push(
        'I am following up regarding ' + client + ' at ' + station +
        ' (offence: ' + offence + ') on ' + dateText + '. Please can you provide an update.'
      );
      break;
    case 'bail_details_request': {
      const bailDate = _val(d.bailReturnDate, PLACEHOLDERS.bailReturnDate);
      const bailConds = _val(d.bailConditions, PLACEHOLDERS.bailConditions);
      lines.push(
        'Please could you provide the bail details for ' + client +
        ' (offence: ' + offence + ') at ' + station + ' on ' + dateText + ', including:'
      );
      lines.push('- Bail return date: ' + bailDate);
      lines.push('- Bail conditions: ' + bailConds);
      break;
    }
    case 'voluntary_interview_confirmation':
      lines.push(
        'I confirm that I will be representing ' + client +
        ' in relation to the voluntary interview on ' + dateText +
        ' at ' + station + ' regarding ' + offence + '.'
      );
      break;
    case 'free_text':
      return '';
    default:
      return '';
  }

  _appendExtraNote(lines, d.extraNote);
  _appendSignOff(lines);
  return lines.join('\n');
}

/* ── Outlook Web compose URL ─────────────────────────────────────────────────
   Built with URLSearchParams so spaces become '+' and reserved characters
   (&, ?, =, #, line breaks, en-dashes, apostrophes) are percent-encoded. We
   normalise body line breaks to CRLF before encoding — Outlook Web treats
   that as a paragraph break in the rendered compose editor. */
function buildOutlookComposeUrl(fields) {
  const f = fields || {};
  const to = _trim(f.to);
  const subject = _str(f.subject);
  const body = _str(f.body);
  const params = new URLSearchParams();
  if (to) params.set('to', to);
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body.replace(/\r\n|\n/g, '\r\n'));
  const query = params.toString();
  return query ? OUTLOOK_COMPOSE_BASE + '?' + query : OUTLOOK_COMPOSE_BASE;
}

function isPlausibleEmail(value) {
  const v = _trim(value);
  if (!v) return false;
  // Intentionally lenient — we surface warnings, we don't gate sending. Must
  // contain exactly one '@' with at least one char before it and a '.' after.
  if (v.split('@').length !== 2) return false;
  const [local, domain] = v.split('@');
  if (!local) return false;
  if (!domain || domain.indexOf('.') < 0) return false;
  return true;
}

function extractDomain(value) {
  const v = _trim(value).toLowerCase();
  const at = v.lastIndexOf('@');
  if (at < 0) return '';
  return v.slice(at + 1);
}

function _domainMatches(emailDomain, allowed) {
  if (!emailDomain || !allowed) return false;
  const d = String(emailDomain).toLowerCase();
  const a = String(allowed).toLowerCase();
  return d === a || d.endsWith('.' + a);
}

function isAllowedDomain(emailValue, extraAllowedDomains) {
  const dom = extractDomain(emailValue);
  if (!dom) return false;
  const fixed = FIXED_ALLOWED_DOMAINS;
  for (let i = 0; i < fixed.length; i++) {
    if (_domainMatches(dom, fixed[i])) return true;
  }
  const extras = Array.isArray(extraAllowedDomains) ? extraAllowedDomains : [];
  for (let i = 0; i < extras.length; i++) {
    if (_domainMatches(dom, extras[i])) return true;
  }
  return false;
}

/** Returns { ok, errors, warnings }. `errors` is empty unless the draft is
 *  structurally unusable (e.g. empty subject + empty body + empty to). The
 *  renderer treats warnings as "ask the user to confirm". */
function validateOfficerEmailDraft(data, opts) {
  const d = normaliseOfficerEmailDraft(data);
  const options = opts || {};
  const extraDomains = Array.isArray(options.extraAllowedDomains)
    ? options.extraAllowedDomains
    : [];
  const errors = [];
  const warnings = [];

  if (d.body.length > MAX_BODY_CHARS) {
    errors.push('Body is too long (max ' + MAX_BODY_CHARS + ' characters).');
  }

  if (!d.toEmail) {
    warnings.push('Recipient email is blank.');
  } else if (!isPlausibleEmail(d.toEmail)) {
    warnings.push('Recipient email does not look valid.');
  } else if (!isAllowedDomain(d.toEmail, extraDomains)) {
    warnings.push(
      'Recipient domain is not on the trusted list (police.uk, cps.gov.uk, gov.uk, ' +
      'judiciary.uk, mod.gov.uk, nhs.net, nhs.uk, plus your firm domains).'
    );
  }

  if (!_trim(d.subject)) warnings.push('Subject is blank.');
  if (d.templateType !== 'free_text' && !_trim(d.body)) warnings.push('Body is blank.');

  return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

module.exports = {
  SIGNATURE_NAME,
  OUTLOOK_COMPOSE_BASE,
  MAX_BODY_CHARS,
  TEMPLATE_TYPES,
  TEMPLATE_LABELS,
  STATUS_VALUES,
  STATUS_LABELS,
  FIXED_ALLOWED_DOMAINS,
  PLACEHOLDERS,
  defaultRecipientName,
  normaliseOfficerEmailDraft,
  generateOfficerEmailSubject,
  generateOfficerEmailBody,
  buildOutlookComposeUrl,
  validateOfficerEmailDraft,
  isPlausibleEmail,
  isAllowedDomain,
  extractDomain,
};
