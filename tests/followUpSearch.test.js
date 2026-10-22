const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  filterAttendanceRowsForFollowUpSearch,
  filterStationAttendancesForClientIdentity,
  isStationAttendanceData,
  attendanceDataMatchesQuery,
} = require('../renderer/lib/follow-up-search');

function row(id, data, extra) {
  return Object.assign({
    id: id,
    data: data,
    updated_at: '2025-03-01T10:00:00Z',
    attendance_date: data.date || '',
    station_name: data.policeStationName || '',
  }, extra || {});
}

describe('follow-up search', () => {
  it('excludes telephone attendances', () => {
    assert.strictEqual(isStationAttendanceData({ _formType: 'telephone' }), false);
    assert.strictEqual(isStationAttendanceData({ _formType: 'attendance' }), true);
  });

  it('matches surname, forename, DOB, and UFN with min length', () => {
    assert.strictEqual(attendanceDataMatchesQuery({ surname: 'Smith', _formType: 'attendance' }, 'sm'), true);
    assert.strictEqual(attendanceDataMatchesQuery({ forename: 'Jane', _formType: 'attendance' }, 'jan'), true);
    assert.strictEqual(attendanceDataMatchesQuery({ dob: '1990-01-15', _formType: 'attendance' }, '1990'), true);
    assert.strictEqual(attendanceDataMatchesQuery({ ufn: '010125/001', _formType: 'attendance' }, '0101'), true);
    assert.strictEqual(attendanceDataMatchesQuery({ surname: 'Smith', _formType: 'attendance' }, 's'), false);
  });

  it('filters and sorts station rows by recency', () => {
    var rows = [
      row(1, { surname: 'Alpha', forename: 'A', date: '2025-01-01', _formType: 'attendance' }, { updated_at: '2025-01-01T00:00:00Z' }),
      row(2, { surname: 'Beta', forename: 'B', date: '2025-02-01', _formType: 'attendance' }, { updated_at: '2025-03-01T00:00:00Z' }),
      row(3, { surname: 'Alpha', forename: 'Tele', _formType: 'telephone' }, { updated_at: '2025-04-01T00:00:00Z' }),
    ];
    var hits = filterAttendanceRowsForFollowUpSearch(rows, 'alpha');
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].row.id, 1);
    var beta = filterAttendanceRowsForFollowUpSearch(rows, 'beta');
    assert.strictEqual(beta[0].row.id, 2);
  });

  it('finds attendances for the same client identity', () => {
    var client = { surname: 'Doe', forename: 'Jane', dob: '1985-05-05' };
    var rows = [
      row(10, Object.assign({ _formType: 'attendance', workType: 'First' }, client), { updated_at: '2025-01-01T00:00:00Z' }),
      row(11, Object.assign({ _formType: 'attendance', workType: 'Further' }, client), { updated_at: '2025-02-01T00:00:00Z' }),
      row(12, { surname: 'Doe', forename: 'Other', dob: '1985-05-05', _formType: 'attendance' }),
    ];
    var matches = filterStationAttendancesForClientIdentity(rows, client);
    assert.strictEqual(matches.length, 2);
    assert.strictEqual(matches[0].row.id, 11, 'most recent first');
  });
});
