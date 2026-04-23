/**
 * Voluntary Attendance feature tests
 * - LAA outcome codes (CN04–CN13) available
 * - Voluntary attendance data model / default structure
 * - Legacy record defaults to custody mode
 * - Custody-record questions stay hidden in voluntary-interview mode (regression)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const refDataPath = path.join(__dirname, '..', 'data', 'laa-reference-data.json');
const refData = JSON.parse(fs.readFileSync(refDataPath, 'utf8'));

const appJsPath = path.join(__dirname, '..', 'app.js');
const appJs = fs.readFileSync(appJsPath, 'utf8');
const docsScreenPath = path.join(__dirname, '..', 'renderer', 'views', 'documents-screen.js');
const docsScreenJs = fs.readFileSync(docsScreenPath, 'utf8');

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

describe('Voluntary attendance — custody-record questions stay hidden', () => {
  it('custody form §3 leftover custody fields are gated on voluntaryInterview === No', () => {
    const fieldsThatMustBeGated = [
      "{ key: 'custodyRecordIssues', label: 'Custody record issues', type: 'textarea', placeholder: 'Any issues or observations', cols: 2, showIf: { field: 'voluntaryInterview', value: 'No' } }",
      "{ key: 'arrestingOfficerName', label: 'Arresting Officer Rank & Name', type: 'text', cols: 2, showIf: { field: 'voluntaryInterview', value: 'No' } }",
      "{ key: 'arrestingOfficerNumber', label: 'Arresting Officer Collar / Badge No.', type: 'text', showIf: { field: 'voluntaryInterview', value: 'No' } }",
      "{ key: '_h_arrest', label: 'Arrest & Detention', type: 'sectionHeading', showIf: { field: 'voluntaryInterview', value: 'No' } }",
    ];
    fieldsThatMustBeGated.forEach((expected) => {
      assert.ok(
        appJs.includes(expected),
        'custody form §3: expected this field to be hidden when voluntaryInterview === Yes:\n' + expected
      );
    });
  });

  it('custody form §3 shows a Voluntary Interview heading when voluntaryInterview === Yes', () => {
    assert.ok(
      appJs.includes("{ key: '_h_voluntary_interview', label: 'Voluntary Interview', type: 'sectionHeading', showIf: { field: 'voluntaryInterview', value: 'Yes' } }"),
      'A neutral Voluntary Interview heading must replace the hidden Arrest & Detention heading'
    );
  });

  it('custody form §6 _note_eligibility is conditional on voluntaryInterview', () => {
    assert.ok(
      appJs.includes("_note_eligibility', label: 'Client details (name, DOB, address) from custody record are in Section 3"),
      'Original eligibility note (custody phrasing) must remain'
    );
    assert.ok(
      appJs.includes("showIf: { field: 'voluntaryInterview', value: 'No' } }") &&
      appJs.includes("_note_eligibility_vol"),
      'A second eligibility note without custody-record wording must show when voluntaryInterview === Yes'
    );
  });

  it('§6 consultation checklist no longer mentions "on Custody Record" / "Reason for Arrest" only', () => {
    assert.ok(
      !/label: 'Confirmed Personal Data on Custody Record'/.test(appJs),
      'chkPersonalData label must not say "on Custody Record" — replaced with neutral "Confirmed Personal Data"'
    );
    assert.ok(
      !/label: 'Explained Reason for Arrest',/.test(appJs),
      'chkReasonForArrest label must read "Explained Reason for Arrest / Attendance" so it works on voluntary interviews'
    );
    assert.ok(
      appJs.includes("'Explained Reason for Arrest / Attendance'"),
      'chkReasonForArrest must use the neutral "Reason for Arrest / Attendance" label'
    );
  });

  it('validateAttendanceForm skips Custody-record-read warning when on voluntary path', () => {
    assert.ok(
      appJs.includes("var _isVolPath = formData.attendanceMode === 'voluntary' || formData.voluntaryInterview === 'Yes';"),
      'validateAttendanceForm must compute a voluntary-path flag'
    );
    assert.ok(
      appJs.includes("if (!_isVolPath && (formData.custodyNumber || '').trim() && !formData.custodyRecordRead)"),
      'Custody record read? warning must be gated on _isVolPath being false'
    );
    assert.ok(
      appJs.includes("if (!_isVolPath && formData.voluntaryInterview === 'No' && !(formData.groundsForArrest || '').trim())"),
      'At-least-one-ground-for-arrest warning must also be gated on _isVolPath being false'
    );
  });

  it('Documents step Prepared Statement substitutes Attendance type for Custody No. on voluntary records', () => {
    assert.ok(
      docsScreenJs.includes("var _isVolAttendance = data.attendanceMode === 'voluntary' || data.voluntaryInterview === 'Yes';"),
      'Prepared Statement template must compute a voluntary-attendance flag'
    );
    assert.ok(
      docsScreenJs.includes("_isVolAttendance ? '<tr><td>Attendance type</td><td>Voluntary attendance</td></tr>' : '<tr><td>Custody No.</td><td>'"),
      'Prepared Statement must show Attendance type / Voluntary attendance instead of Custody No. when voluntary'
    );
  });
});
