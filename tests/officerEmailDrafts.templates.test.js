'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  TEMPLATE_TYPES,
  generateOfficerEmailBody,
  insertExtraNote,
} = require('../lib/officerEmailDrafts');

const base = {
  recipientName: '',
  clientName: 'Jane Doe',
  policeStation: 'Norwich',
  attendanceDate: '2025-01-01',
  offence: 'Theft',
  bailReturnDate: '',
  bailConditions: '',
};

describe('officerEmailDrafts — template bodies', () => {
  it('exports 9 template types', () => {
    assert.strictEqual(TEMPLATE_TYPES.length, 9);
  });

  it('disclosure_confirm_attendance mentions disclosure', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { templateType: 'disclosure_confirm_attendance' }));
    assert.ok(b.includes('disclosure'), b);
    assert.ok(b.includes('Robert Cashman'), b);
  });

  it('custody_log_request uses DDO default when recipient empty', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { templateType: 'custody_log_request' }));
    assert.ok(b.includes('Dear DDO'), b);
    assert.ok(b.includes('custody log'), b.toLowerCase());
  });

  it('bail_details_request has four shape variants', () => {
    const none = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'bail_details_request', bailReturnDate: '', bailConditions: '' })
    );
    assert.ok(none.includes('bail return date'), none.toLowerCase());

    const both = generateOfficerEmailBody(
      Object.assign({}, base, {
        templateType: 'bail_details_request',
        bailReturnDate: '2025-02-01',
        bailConditions: 'Curfew 9pm',
      })
    );
    assert.ok(both.includes('2025-02-01'), both);
    assert.ok(both.includes('Curfew'), both);

    const dateOnly = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'bail_details_request', bailReturnDate: '2025-03-01', bailConditions: '' })
    );
    assert.ok(dateOnly.includes('2025-03-01'), dateOnly);

    const condOnly = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'bail_details_request', bailReturnDate: '', bailConditions: 'Report weekly' })
    );
    assert.ok(condOnly.includes('Report weekly'), condOnly);
  });

  it('free_text_email contains placeholder', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { templateType: 'free_text_email' }));
    assert.ok(b.includes('[Type message here]'), b);
  });

  it('insertExtraNote goes before Many thanks when present', () => {
    const raw = generateOfficerEmailBody(Object.assign({}, base, { templateType: 'chase_disclosure' }));
    const withNote = insertExtraNote(raw, 'Please call me');
    assert.ok(withNote.includes('Additional note: Please call me'), withNote);
    const idxNote = withNote.indexOf('Additional note');
    const idxThanks = withNote.indexOf('Many thanks');
    assert.ok(idxThanks > 0);
    assert.ok(idxNote < idxThanks);
  });
});
