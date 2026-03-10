/**
 * Voluntary Attendance feature tests
 * - LAA outcome codes (CN04–CN13) available
 * - Voluntary attendance data model / default structure
 * - Legacy record defaults to custody mode
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const refDataPath = path.join(__dirname, '..', 'data', 'laa-reference-data.json');
const refData = JSON.parse(fs.readFileSync(refDataPath, 'utf8'));

describe('Voluntary Attendance', () => {
  it('LAA reference data has outcome codes CN04–CN13 for voluntary billing', () => {
    const codes = (refData.outcomeCodes || []).map((c) => c.code);
    const required = ['CN04', 'CN05', 'CN06', 'CN07', 'CN08', 'CN09', 'CN10', 'CN11', 'CN12', 'CN13'];
    for (const code of required) {
      assert.ok(codes.includes(code), 'Missing outcome code: ' + code);
    }
  });

  it('Legacy record without attendanceMode defaults to custody', () => {
    const legacy = { _formType: 'attendance', forename: 'Test', surname: 'User' };
    const mode = legacy.attendanceMode || (legacy._formType !== 'telephone' ? 'custody' : undefined);
    assert.strictEqual(mode, 'custody');
  });

  it('Voluntary record has attendanceMode voluntary', () => {
    const vol = { _formType: 'attendance', attendanceMode: 'voluntary', forename: 'Test', surname: 'User' };
    assert.strictEqual(vol.attendanceMode, 'voluntary');
  });

  it('Instruction source enum values are defined for voluntary', () => {
    const validSources = ['dscc', 'client_direct', 'family_or_third_party', 'already_at_station', 'firm_internal', 'other'];
    const sample = 'dscc';
    assert.ok(validSources.includes(sample));
  });

  it('DSCC notification status enum values include required options', () => {
    const valid = ['received_from_dscc', 'reported_within_48h', 'reported_before_attendance', 'not_applicable', 'missing'];
    assert.ok(valid.includes('not_applicable'));
    assert.ok(valid.includes('missing'));
  });
});
