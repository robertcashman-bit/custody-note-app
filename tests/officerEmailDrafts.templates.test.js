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
  it('exports 16 template types', () => {
    assert.strictEqual(TEMPLATE_TYPES.length, 16);
  });

  it('disclosure_confirm_attendance mentions disclosure', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, {
      templateType: 'disclosure_confirm_attendance',
      signOffName: 'Jane Solicitor',
    }));
    assert.ok(b.includes('disclosure'), b);
    assert.ok(b.includes('Jane Solicitor'), b);
  });

  it('includes attendance time in body when set', () => {
    const withTime = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'disclosure_confirm_attendance', attendanceTime: '14:30' })
    );
    assert.ok(withTime.includes('Wed 1 Jan 2025 at 14:30'), withTime);

    const withoutTime = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'disclosure_confirm_attendance', attendanceTime: '' })
    );
    assert.ok(withoutTime.includes('on Wed 1 Jan 2025 in relation'), withoutTime);
    assert.ok(!withoutTime.includes(' at 14:30'), withoutTime);
  });

  it('custody_log_request adds Time line when attendance time set', () => {
    const b = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'custody_log_request', attendanceTime: '09:15' })
    );
    assert.ok(b.includes('Date: Wed 1 Jan 2025'), b);
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
    assert.ok(b.includes('The attendance is listed for Wed 1 Jan 2025 at 10:00'), b);
  });

  it('bail_details_request mentions return station and conditions when set', () => {
    const plain = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'bail_details_request', bailConditions: '' })
    );
    assert.ok(plain.includes('return station'), plain.toLowerCase());
    assert.ok(plain.includes('Wed 1 Jan 2025'), plain);

    const withCond = generateOfficerEmailBody(
      Object.assign({}, base, {
        templateType: 'bail_details_request',
        attendanceDate: '2025-02-01',
        bailConditions: 'Curfew 9pm',
      })
    );
    assert.ok(withCond.includes('Sat 1 Feb 2025'), withCond);
    assert.ok(withCond.includes('Curfew 9pm'), withCond);
  });

  it('chase_bail_details_follow_up references prior email', () => {
    const b = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'chase_bail_details_follow_up', bailConditions: '' })
    );
    assert.ok(b.includes('emailed previously'), b);
    assert.ok(b.includes('return station'), b.toLowerCase());
  });

  it('custody_record_detention_log_request asks for detention log', () => {
    const b = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'custody_record_detention_log_request' })
    );
    assert.ok(b.includes('detention log'), b.toLowerCase());
    assert.ok(b.includes('Dear DDO'), b);
  });

  it('chase_custody_log_follow_up references prior request', () => {
    const b = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'chase_custody_log_follow_up' })
    );
    assert.ok(b.includes('requested a copy of the custody record previously'), b);
  });

  it('rui_details_request does not ask for bail conditions', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { templateType: 'rui_details_request' }));
    assert.ok(b.includes('released under investigation'), b.toLowerCase());
    assert.ok(!b.includes('bail conditions'), b.toLowerCase());
  });

  it('confirm_outcome_after_attendance asks for outcome options', () => {
    const b = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'confirm_outcome_after_attendance', attendanceTime: '14:30' })
    );
    assert.ok(b.includes('I attended'), b);
    assert.ok(b.includes('released on police bail'), b.toLowerCase());
  });

  it('chase_disclosure_follow_up references prior disclosure request', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { templateType: 'chase_disclosure_follow_up' }));
    assert.ok(b.includes('requested disclosure previously'), b);
  });

  it('request_update_after_delay mentions release basis', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { templateType: 'request_update_after_delay' }));
    assert.ok(b.includes('released under investigation'), b.toLowerCase());
  });

  it('matter_stood_down mentions stand down', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { templateType: 'matter_stood_down' }));
    assert.ok(b.includes('stood down'), b.toLowerCase());
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
