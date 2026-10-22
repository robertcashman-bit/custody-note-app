/* followUpAttendance.test.js — policy for Follow-up attendance (same client, new visit). */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { duplicateAttendanceData } = require('../renderer/lib/duplicate-attendance');
const {
  followUpAttendanceData,
  appendFollowUpIdToSourceData,
  FOLLOW_UP_REASON_CODES,
} = require('../renderer/lib/follow-up-attendance');

function baseSource() {
  return {
    title: 'Mr', forename: 'Jane', surname: 'Doe', dob: '1985-05-05', custodyNumber: 'CN99',
    ufn: '010125/002', dsccRef: '110154321A', maatId: 'M9',
    firmId: 2, firmName: 'Acme Law', feeEarnerName: 'Rep One',
    policeStationName: 'Main St Custody', policeStationId: 5, schemeId: 'MS1',
    oicName: 'DC Smith', oicEmail: 'dc@police.uk', oicPhone: '101',
    offenceSummary: 'Burglary', offence1Details: 'S1 burglary',
    matterTypeCode: 'BB',
    workType: 'First Police Station Attendance',
    caseStatus: 'New case',
    clientType: 'New',
    date: '2025-01-10',
    bailDate: '2025-02-15',
    bailReturnStationName: 'Other Custody', bailReturnStationCode: 'OC9',
    interviews: [{ startTime: '12:00', notes: 'No comment' }],
    outcomeDecision: 'Bail without charge',
    clientInstructions: 'No comment',
    timeArrival: '09:00', timeDeparture: '17:00',
    quickfile_invoice_id: 99, invoiceNumberRef: 'INV-OLD',
    clientSig: 'data:image/png;base64,x',
    vidParadeDate: '2025-01-11', vidParadeResult: 'Not identified',
    commsLog: [{ time: '10:00', note: 'called firm' }],
    _formType: 'attendance',
  };
}

describe('followUpAttendanceData', () => {
  it('sets work type, case status, client type, and link metadata', () => {
    const out = followUpAttendanceData(baseSource(), 42, 'bail_return');
    assert.strictEqual(out.workType, 'Further Police Station Attendance');
    assert.strictEqual(out.caseStatus, 'Existing case');
    assert.strictEqual(out.clientType, 'Existing');
    assert.strictEqual(out._followUpFromAttendanceId, 42);
    assert.strictEqual(out._followUpReason, 'bail_return');
    assert.ok(out._followUpInstanceId);
  });

  it('keeps client, firm, UFN, offences, custody number, and OIC', () => {
    const out = followUpAttendanceData(baseSource(), 1, 'other');
    assert.strictEqual(out.forename, 'Jane');
    assert.strictEqual(out.surname, 'Doe');
    assert.strictEqual(out.ufn, '010125/002');
    assert.strictEqual(out.firmName, 'Acme Law');
    assert.strictEqual(out.custodyNumber, 'CN99');
    assert.strictEqual(out.oicName, 'DC Smith');
    assert.strictEqual(out.offenceSummary, 'Burglary');
  });

  it('uses bail return station and date when present', () => {
    const out = followUpAttendanceData(baseSource(), 1, 'bail_return');
    assert.strictEqual(out.policeStationName, 'Other Custody');
    assert.strictEqual(out.schemeId, 'OC9');
    assert.strictEqual(out.date, '2025-02-15');
    assert.strictEqual(out.policeStationId, undefined);
  });

  it('clears interviews, advice, outcome, time, signatures, billing, and video parade', () => {
    const out = followUpAttendanceData(baseSource(), 1, 'identification');
    assert.strictEqual(out.interviews, undefined);
    assert.strictEqual(out.clientInstructions, undefined);
    assert.strictEqual(out.outcomeDecision, undefined);
    assert.strictEqual(out.timeArrival, undefined);
    assert.strictEqual(out.clientSig, undefined);
    assert.strictEqual(out.quickfile_invoice_id, undefined);
    assert.strictEqual(out.invoiceNumberRef, undefined);
    assert.strictEqual(out.vidParadeDate, undefined);
    assert.strictEqual(out.vidParadeResult, undefined);
    assert.strictEqual(out.commsLog, undefined);
  });

  it('does not mirror duplicate-attendance identity clear', () => {
    const dup = duplicateAttendanceData(baseSource(), 1);
    assert.strictEqual(dup.forename, '');
    const follow = followUpAttendanceData(baseSource(), 1, 'other');
    assert.strictEqual(follow.forename, 'Jane');
  });

  it('exposes reason labels', () => {
    assert.ok(FOLLOW_UP_REASON_CODES.bail_return);
    assert.ok(FOLLOW_UP_REASON_CODES.identification);
  });
});

describe('appendFollowUpIdToSourceData', () => {
  it('appends unique follow-up ids on the source record', () => {
    const src = { ufn: '1' };
    const a = appendFollowUpIdToSourceData(src, 100);
    assert.deepStrictEqual(a._followUpAttendanceIds, [100]);
    const b = appendFollowUpIdToSourceData(a, 101);
    assert.deepStrictEqual(b._followUpAttendanceIds, [100, 101]);
    const c = appendFollowUpIdToSourceData(b, 100);
    assert.deepStrictEqual(c._followUpAttendanceIds, [100, 101]);
  });
});
