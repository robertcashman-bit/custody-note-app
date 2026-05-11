'use strict';

/* tests/officerEmailTemplates.test.js
 *
 * Pure-function tests for lib/officerEmailTemplates.js — locks the wording of
 * each template, default recipient salutations, placeholder behaviour for
 * missing fields, extra-note insertion, Outlook compose URL encoding, and
 * validation warnings. Run via `npm run test:unit`.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const T = require('../lib/officerEmailTemplates');

function baseData(overrides) {
  return Object.assign({
    templateType: 'disclosure_confirm_attendance',
    toEmail: 'oic@example.police.uk',
    recipientName: '',
    clientName: 'John Smith',
    policeStation: 'Charing Cross',
    offence: 'theft',
    attendanceDate: '2026-05-11',
    extraNote: '',
    bailReturnDate: '',
    bailConditions: '',
    userEmailAddress: '',
    subject: '',
    body: '',
  }, overrides || {});
}

describe('normaliseOfficerEmailDraft', function () {
  it('fills missing fields with empty strings and defaults templateType', function () {
    const out = T.normaliseOfficerEmailDraft({});
    assert.strictEqual(out.templateType, 'disclosure_confirm_attendance');
    assert.strictEqual(out.toEmail, '');
    assert.strictEqual(out.body, '');
    assert.strictEqual(typeof out.subject, 'string');
  });

  it('rejects unknown templateType by falling back to default', function () {
    const out = T.normaliseOfficerEmailDraft({ templateType: 'not-a-template' });
    assert.strictEqual(out.templateType, 'disclosure_confirm_attendance');
  });

  it('coerces non-string fields to strings', function () {
    const out = T.normaliseOfficerEmailDraft({ clientName: 12345, toEmail: null });
    assert.strictEqual(out.clientName, '12345');
    assert.strictEqual(out.toEmail, '');
  });
});

describe('defaultRecipientName', function () {
  it('returns DDO for custody log request', function () {
    assert.strictEqual(T.defaultRecipientName('custody_log_request'), 'DDO');
  });
  it('returns Officer otherwise', function () {
    assert.strictEqual(T.defaultRecipientName('disclosure_confirm_attendance'), 'Officer');
    assert.strictEqual(T.defaultRecipientName('free_text'), 'Officer');
    assert.strictEqual(T.defaultRecipientName(''), 'Officer');
  });
});

describe('generateOfficerEmailSubject', function () {
  it('builds [Client] - [Station] - [Offence] - [Type]', function () {
    const s = T.generateOfficerEmailSubject(baseData());
    assert.strictEqual(
      s,
      'John Smith - Charing Cross - theft - Disclosure / confirm attendance'
    );
  });

  it('uses bracketed placeholders for missing fields', function () {
    const s = T.generateOfficerEmailSubject(baseData({ clientName: '', offence: '' }));
    assert.ok(s.indexOf('[Client Name]') >= 0, 'expected [Client Name] placeholder');
    assert.ok(s.indexOf('[Offence]') >= 0, 'expected [Offence] placeholder');
  });

  it('uses the correct human label per template', function () {
    const s = T.generateOfficerEmailSubject(baseData({ templateType: 'bail_details_request' }));
    assert.ok(s.endsWith(' - Bail details request'));
  });
});

describe('generateOfficerEmailBody — all templates', function () {
  it('1. disclosure_confirm_attendance: contains client, station, date, offence + sign-off', function () {
    const b = T.generateOfficerEmailBody(baseData());
    assert.ok(b.startsWith('Dear Officer'), 'default salutation Officer');
    assert.ok(b.includes('John Smith'));
    assert.ok(b.includes('Charing Cross'));
    assert.ok(b.includes('2026-05-11'));
    assert.ok(b.includes('theft'));
    assert.ok(b.includes('Kind regards,'));
    assert.ok(b.includes('Robert Cashman'));
    assert.ok(b.includes('pre-interview disclosure'));
  });

  it('2. custody_log_request: salutes DDO by default', function () {
    const b = T.generateOfficerEmailBody(baseData({ templateType: 'custody_log_request' }));
    assert.ok(b.startsWith('Dear DDO'), 'default salutation DDO');
    assert.ok(b.includes('custody log'));
  });

  it('3. chase_disclosure: contains chase wording', function () {
    const b = T.generateOfficerEmailBody(baseData({ templateType: 'chase_disclosure' }));
    assert.ok(b.includes('Further to my earlier request'));
    assert.ok(b.includes('disclosure'));
  });

  it('4. confirm_matter_effective: contains effective wording', function () {
    const b = T.generateOfficerEmailBody(baseData({ templateType: 'confirm_matter_effective' }));
    assert.ok(b.includes('is effective'));
  });

  it('5. request_officer_contact: asks for officer contact details', function () {
    const b = T.generateOfficerEmailBody(baseData({ templateType: 'request_officer_contact' }));
    assert.ok(b.includes('contact details of the officer in charge'));
  });

  it('6. request_update_after_delay: asks for update', function () {
    const b = T.generateOfficerEmailBody(baseData({ templateType: 'request_update_after_delay' }));
    assert.ok(b.includes('following up'));
    assert.ok(b.includes('update'));
  });

  it('7. bail_details_request: with both bail fields populated', function () {
    const b = T.generateOfficerEmailBody(baseData({
      templateType: 'bail_details_request',
      bailReturnDate: '2026-06-01',
      bailConditions: 'No contact with witnesses; residence at home address.',
    }));
    assert.ok(b.includes('- Bail return date: 2026-06-01'));
    assert.ok(b.includes('- Bail conditions: No contact with witnesses'));
  });

  it('7. bail_details_request: bail fields missing → bracketed placeholders', function () {
    const b = T.generateOfficerEmailBody(baseData({ templateType: 'bail_details_request' }));
    assert.ok(b.includes('[Bail Return Date]'));
    assert.ok(b.includes('[Bail Conditions]'));
  });

  it('8. voluntary_interview_confirmation: confirms representation', function () {
    const b = T.generateOfficerEmailBody(baseData({ templateType: 'voluntary_interview_confirmation' }));
    assert.ok(b.includes('voluntary interview'));
    assert.ok(b.includes('representing'));
  });

  it('9. free_text: returns empty string (renderer keeps user-typed body)', function () {
    const b = T.generateOfficerEmailBody(baseData({ templateType: 'free_text' }));
    assert.strictEqual(b, '');
  });

  it('uses provided recipientName when set instead of default salutation', function () {
    const b = T.generateOfficerEmailBody(baseData({ recipientName: 'DC Brown' }));
    assert.ok(b.startsWith('Dear DC Brown'));
    assert.ok(!b.startsWith('Dear Officer'));
  });

  it('substitutes bracketed placeholders for missing fields', function () {
    const b = T.generateOfficerEmailBody(baseData({
      clientName: '',
      policeStation: '',
      offence: '',
      attendanceDate: '',
    }));
    assert.ok(b.includes('[Client Name]'));
    assert.ok(b.includes('[Police Station]'));
    assert.ok(b.includes('[Offence]'));
    assert.ok(b.includes('[Date]'));
  });

  it('inserts "Additional note:" before sign-off when extraNote present', function () {
    const b = T.generateOfficerEmailBody(baseData({ extraNote: 'Client has vulnerability flag.' }));
    const idxNote = b.indexOf('Additional note: Client has vulnerability flag.');
    const idxSignOff = b.indexOf('Kind regards,');
    assert.ok(idxNote > 0, 'Additional note line should be present');
    assert.ok(idxSignOff > idxNote, 'Sign-off must come after the additional note');
  });

  it('omits the additional note when extraNote is blank/whitespace', function () {
    const b = T.generateOfficerEmailBody(baseData({ extraNote: '   ' }));
    assert.ok(!b.includes('Additional note:'));
  });
});

describe('buildOutlookComposeUrl', function () {
  it('always points at the official Outlook Web compose deeplink', function () {
    const u = T.buildOutlookComposeUrl({ to: 'a@b.uk', subject: 'x', body: 'y' });
    assert.ok(u.startsWith('https://outlook.office.com/mail/deeplink/compose?'));
  });

  it('returns the bare endpoint when no fields supplied', function () {
    const u = T.buildOutlookComposeUrl({});
    assert.strictEqual(u, 'https://outlook.office.com/mail/deeplink/compose');
  });

  it('encodes spaces and reserved characters in the subject', function () {
    const u = T.buildOutlookComposeUrl({
      to: 'oic@example.police.uk',
      subject: 'Smith & Jones — disclosure?',
      body: '',
    });
    // URLSearchParams uses '+' for spaces, and percent-encodes & ? — properly.
    assert.ok(u.includes('subject=Smith+%26+Jones'));
    assert.ok(u.includes('disclosure%3F'));
    // En dash (U+2014) must round-trip as percent-encoded UTF-8.
    assert.ok(u.includes('%E2%80%94'));
  });

  it('encodes apostrophes in the body', function () {
    const u = T.buildOutlookComposeUrl({ to: '', subject: '', body: "Don't forget" });
    assert.ok(u.includes("Don%27t") || u.includes('Don%27t+forget'),
      'expected apostrophe to be percent-encoded as %27');
  });

  it('normalises line breaks to CRLF (%0D%0A) so Outlook preserves paragraphs', function () {
    const u = T.buildOutlookComposeUrl({ to: '', subject: '', body: 'line1\nline2\nline3' });
    // URLSearchParams percent-encodes CR and LF; count occurrences of %0D%0A.
    const matches = u.match(/%0D%0A/g) || [];
    assert.strictEqual(matches.length, 2, 'expected two CRLF separators in body encoding');
  });

  it('handles a long body without truncating', function () {
    const longBody = 'x'.repeat(20000);
    const u = T.buildOutlookComposeUrl({ to: '', subject: '', body: longBody });
    assert.ok(u.length > 20000, 'URL should contain the entire body');
    assert.ok(u.indexOf('body=') > 0);
  });

  it('omits empty fields entirely from the query', function () {
    const u = T.buildOutlookComposeUrl({ to: 'x@y.uk', subject: '', body: '' });
    assert.ok(u.includes('to=x%40y.uk'));
    assert.ok(!u.includes('subject='));
    assert.ok(!u.includes('body='));
  });
});

describe('validateOfficerEmailDraft', function () {
  it('warns when recipient is blank', function () {
    const r = T.validateOfficerEmailDraft(baseData({ toEmail: '' }));
    assert.ok(r.ok);
    assert.ok(r.warnings.some((w) => /Recipient email is blank/i.test(w)));
  });

  it('warns when recipient is not a plausible email', function () {
    const r = T.validateOfficerEmailDraft(baseData({ toEmail: 'not-an-email' }));
    assert.ok(r.warnings.some((w) => /does not look valid/i.test(w)));
  });

  it('does NOT warn for a fixed-list domain (police.uk)', function () {
    const r = T.validateOfficerEmailDraft(baseData({
      toEmail: 'oic@met.police.uk',
      subject: 'x', body: 'y',
    }));
    assert.ok(!r.warnings.some((w) => /not on the trusted list/i.test(w)));
  });

  it('warns when domain is unknown and no firm domains supplied', function () {
    const r = T.validateOfficerEmailDraft(
      baseData({ toEmail: 'someone@randomshop.com', subject: 'x', body: 'y' })
    );
    assert.ok(r.warnings.some((w) => /not on the trusted list/i.test(w)));
  });

  it('accepts firm domains passed in extraAllowedDomains', function () {
    const r = T.validateOfficerEmailDraft(
      baseData({ toEmail: 'partner@mylawfirm.co.uk', subject: 'x', body: 'y' }),
      { extraAllowedDomains: ['mylawfirm.co.uk'] }
    );
    assert.ok(!r.warnings.some((w) => /not on the trusted list/i.test(w)));
  });

  it('errors when body exceeds the hard limit', function () {
    const huge = 'x'.repeat(T.MAX_BODY_CHARS + 1);
    const r = T.validateOfficerEmailDraft(baseData({ body: huge }));
    assert.ok(!r.ok);
    assert.ok(r.errors.some((e) => /too long/i.test(e)));
  });

  it('warns when subject or body is blank (non-free_text)', function () {
    const r = T.validateOfficerEmailDraft(baseData({ subject: '', body: '' }));
    assert.ok(r.warnings.some((w) => /Subject is blank/i.test(w)));
    assert.ok(r.warnings.some((w) => /Body is blank/i.test(w)));
  });

  it('does NOT warn that body is blank for free_text template', function () {
    const r = T.validateOfficerEmailDraft(baseData({
      templateType: 'free_text',
      subject: 'Hi', body: '',
    }));
    assert.ok(!r.warnings.some((w) => /Body is blank/i.test(w)));
  });
});

describe('isPlausibleEmail / isAllowedDomain', function () {
  it('rejects strings without @ or without dotted domain', function () {
    assert.strictEqual(T.isPlausibleEmail(''), false);
    assert.strictEqual(T.isPlausibleEmail('foo'), false);
    assert.strictEqual(T.isPlausibleEmail('foo@bar'), false);
    assert.strictEqual(T.isPlausibleEmail('foo@bar.uk'), true);
  });

  it('matches subdomains of fixed allowed domains', function () {
    assert.strictEqual(T.isAllowedDomain('x@met.police.uk'), true);
    assert.strictEqual(T.isAllowedDomain('x@kent.police.uk'), true);
    assert.strictEqual(T.isAllowedDomain('x@cps.gov.uk'), true);
    assert.strictEqual(T.isAllowedDomain('x@anything.gov.uk'), true);
    assert.strictEqual(T.isAllowedDomain('x@evil.example'), false);
  });
});
