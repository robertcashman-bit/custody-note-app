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

  it('includes attendance time in body when set', () => {
    const withTime = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'disclosure_confirm_attendance', attendanceTime: '14:30' })
    );
    assert.ok(withTime.includes('2025-01-01 at 14:30'), withTime);

    const withoutTime = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'disclosure_confirm_attendance', attendanceTime: '' })
    );
    assert.ok(withoutTime.includes('on 2025-01-01 in relation'), withoutTime);
    assert.ok(!withoutTime.includes(' at 14:30'), withoutTime);
  });

  it('custody_log_request adds Time line when attendance time set', () => {
    const b = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'custody_log_request', attendanceTime: '09:15' })
    );
    assert.ok(b.includes('Date: 2025-01-01'), b);
    assert.ok(b.includes('Time: 09:15'), b);
  });

  it('custody_log_request uses DDO default when recipient empty', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { templateType: 'custody_log_request' }));
    assert.ok(b.includes('Dear DDO'), b);
    assert.ok(b.includes('custody record'), b.toLowerCase());
  });

  it('chase_disclosure includes attendance when date or time set', () => {
    const b = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'chase_disclosure', attendanceTime: '10:00' })
    );
    assert.ok(b.includes('The attendance is listed for 2025-01-01 at 10:00'), b);
  });

  it('bail_details_request has four shape variants', () => {
    const none = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'bail_details_request', bailReturnDate: '', bailConditions: '' })
    );
    assert.ok(none.includes('bail return date and time'), none.toLowerCase());

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
    assert.ok(b.includes('[Type your message here]'), b);
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
