'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  generateOfficerEmailBody,
  buildDearRecipientLine,
  buildOutlookComposeUrl,
  formatRecipientEmailsForOutlook,
  parseRecipientEmails,
  validateOpenOutlookFields,
  resolveClosingSignOff,
  signOffNameAlreadyInContent,
} = require('../lib/officerEmailDrafts');

const base = {
  templateType: 'disclosure_confirm_attendance',
  recipientName: 'Officer',
  clientName: 'Synthetic Client',
  policeStation: 'Synthetic Station',
  attendanceDate: '1 Jan 2026',
  attendanceTime: '09:00',
  offence: 'Synthetic Offence',
  signOffName: 'Synthetic Fee Earner',
};

describe('officerEmailDrafts — duty solicitor instruction sentence', () => {
  it('adds duty solicitor phrase with full stop when ticked', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { actingAsDutySolicitor: true }));
    assert.ok(
      b.includes(
        'I have been instructed to represent Synthetic Client at Synthetic Station on 1 Jan 2026 at 09:00 in relation to an allegation of Synthetic Offence as duty solicitor.'
      ),
      b
    );
  });

  it('omits duty solicitor phrase when unticked', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { actingAsDutySolicitor: false }));
    assert.ok(
      b.includes(
        'in relation to an allegation of Synthetic Offence.\n\nPlease confirm that the matter remains effective'
      ),
      b
    );
    assert.ok(!b.includes('as duty solicitor'), b);
  });
});

describe('officerEmailDrafts — multiple recipients', () => {
  it('parses and formats semicolon-separated emails for Outlook', () => {
    const list = parseRecipientEmails('a@x.police.uk; b@y.police.uk , c@z.police.uk');
    assert.deepStrictEqual(list, ['a@x.police.uk', 'b@y.police.uk', 'c@z.police.uk']);
    assert.strictEqual(
      formatRecipientEmailsForOutlook(list),
      'a@x.police.uk;b@y.police.uk;c@z.police.uk'
    );
  });

  it('builds combined greeting for two named officers', () => {
    const line = buildDearRecipientLine('chase_disclosure', 'PC Alpha; PC Beta', 'a@x.police.uk;b@y.police.uk');
    assert.strictEqual(line, 'Dear PC Alpha and PC Beta,');
  });

  it('uses Dear Officers when multiple emails and no names', () => {
    const line = buildDearRecipientLine('chase_disclosure', '', 'a@x.police.uk;b@y.police.uk');
    assert.strictEqual(line, 'Dear Officers,');
  });

  it('encodes multiple recipients in Outlook compose URL', () => {
    const u = buildOutlookComposeUrl({
      toEmail: 'one@x.police.uk; two@y.police.uk',
      subject: 'Test',
      body: 'Body',
    });
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('to'), 'one@x.police.uk;two@y.police.uk');
  });

  it('validates each recipient email', () => {
    const bad = validateOpenOutlookFields(
      { toEmail: 'bad@x.police.uk;not-an-email', subject: 'S', body: 'B' },
      { extraDomains: [] }
    );
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.errors.some((e) => e.includes('Recipient 2')));
    const ok = validateOpenOutlookFields(
      { toEmail: 'a@x.police.uk;b@y.police.uk', subject: 'S', body: 'B' },
      { extraDomains: [] }
    );
    assert.strictEqual(ok.ok, true);
  });
});

describe('officerEmailDrafts — sign-off / Outlook signature', () => {
  it('includes fee earner name after Kind regards by default', () => {
    const b = generateOfficerEmailBody(base);
    assert.ok(b.endsWith('Kind regards,\n\nSynthetic Fee Earner'), b);
  });

  it('omits name when Outlook signature preference is ticked', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { outlookSignatureIncludesName: true }));
    assert.ok(b.endsWith('Kind regards,'), b);
    assert.ok(!b.includes('Synthetic Fee Earner'), b);
  });

  it('omits duplicate name when already in extra note', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { extraNote: 'Synthetic Fee Earner will attend' }));
    assert.ok(b.endsWith('Kind regards,'), b);
    assert.ok(!b.match(/Kind regards,\n\nSynthetic Fee Earner$/), b);
  });

  it('resolveClosingSignOff returns empty when redundant', () => {
    assert.strictEqual(
      resolveClosingSignOff(
        Object.assign({}, base, { outlookSignatureIncludesName: true }),
        'Main'
      ),
      ''
    );
    assert.strictEqual(
      resolveClosingSignOff(
        Object.assign({}, base, { extraNote: 'Contact Synthetic Fee Earner' }),
        'Main'
      ),
      ''
    );
    assert.strictEqual(resolveClosingSignOff(base, 'Main'), 'Synthetic Fee Earner');
  });

  it('signOffNameAlreadyInContent matches case-insensitively', () => {
    assert.strictEqual(
      signOffNameAlreadyInContent('Synthetic Fee Earner', 'Line one', '  synthetic   fee earner  '),
      true
    );
  });
});
