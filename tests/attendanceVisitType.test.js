'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { runMigrations } = require('../main/dbMigrations');
const {
  applyAttendanceVisitType,
  resolveAttendanceVisitType,
  syncVisitTypeFromWorkType,
  syncWorkTypeFromVisitType,
  listAttendanceVisitTypeOptions,
  followUpReasonCodesForChooser,
  TELEPHONE_VISIT_TYPE_BLOCK_MESSAGE,
  WORK_TYPE_FURTHER,
  ATTENDANCE_VISIT_TYPES,
  REASON_CODE_BY_VISIT_TYPE,
} = require('../renderer/lib/attendance-visit-type');

function syntheticCustodyRecord(extra) {
  return Object.assign({
    _formType: 'attendance',
    attendanceMode: 'custody',
    workType: 'First Police Station Attendance',
    caseStatus: 'New case',
    clientType: 'New',
    forename: 'Alex',
    surname: 'Tester',
    clientInstructions: 'No comment',
    arrivalNotes: 'Met at custody desk',
    offenceSummary: 'Theft',
    voluntaryInterview: 'No',
    outcomeDecision: 'Ongoing / Unknown',
    customFieldOnlyOnThisRecord: 'keep-me',
  }, extra || {});
}

function syntheticVoluntaryRecord(extra) {
  return Object.assign(syntheticCustodyRecord(), {
    attendanceMode: 'voluntary',
    workType: 'Voluntary Police Station Attendance',
    volOutcomeDecision: 'Released without charge',
    voluntaryChronologyNotes: 'Vol-only notes',
  }, extra || {});
}

function assertAllKeysPreserved(before, after, label) {
  Object.keys(before).forEach(function (k) {
    assert.ok(Object.prototype.hasOwnProperty.call(after, k), label + ': missing key ' + k);
  });
}

describe('attendance-visit-type (in-place conversion)', () => {
  it('lists all attendance types for the dropdown (no breach of bail)', () => {
    const opts = listAttendanceVisitTypeOptions();
    const codes = opts.map(function (o) { return o.code; });
    assert.deepStrictEqual(codes, [
      ATTENDANCE_VISIT_TYPES.first,
      ATTENDANCE_VISIT_TYPES.bail_return,
      ATTENDANCE_VISIT_TYPES.further,
      ATTENDANCE_VISIT_TYPES.re_interview,
      ATTENDANCE_VISIT_TYPES.charge_only,
      ATTENDANCE_VISIT_TYPES.identification,
      ATTENDANCE_VISIT_TYPES.rui_return,
    ]);
    const labelsJoined = opts.map(function (o) { return o.label; }).join(' ');
    assert.ok(!/breach of bail/i.test(labelsJoined));
  });

  it('resolves stored follow-up reasons and further work type', () => {
    assert.strictEqual(
      resolveAttendanceVisitType({ workType: WORK_TYPE_FURTHER, _followUpReason: 'bail_return' }),
      ATTENDANCE_VISIT_TYPES.bail_return
    );
    assert.strictEqual(
      resolveAttendanceVisitType({ workType: WORK_TYPE_FURTHER, _followUpReason: 'other' }),
      ATTENDANCE_VISIT_TYPES.further
    );
    assert.strictEqual(
      resolveAttendanceVisitType({ workType: WORK_TYPE_FURTHER, _followUpReason: 're_interview' }),
      ATTENDANCE_VISIT_TYPES.re_interview
    );
    assert.strictEqual(
      resolveAttendanceVisitType({ workType: WORK_TYPE_FURTHER, _followUpReason: 'identification' }),
      ATTENDANCE_VISIT_TYPES.identification
    );
    assert.strictEqual(
      resolveAttendanceVisitType({ workType: WORK_TYPE_FURTHER, _followUpReason: 'rui_return' }),
      ATTENDANCE_VISIT_TYPES.rui_return
    );
    assert.strictEqual(
      resolveAttendanceVisitType({ workType: 'First Police Station Attendance' }),
      ATTENDANCE_VISIT_TYPES.first
    );
  });

  it('syncWorkTypeFromVisitType derives LAA workType from visit type + mode', () => {
    var d = syntheticCustodyRecord();
    assert.strictEqual(syncWorkTypeFromVisitType(d), 'First Police Station Attendance');
    applyAttendanceVisitType(d, ATTENDANCE_VISIT_TYPES.bail_return);
    assert.strictEqual(syncWorkTypeFromVisitType(d), WORK_TYPE_FURTHER);
    var v = syntheticVoluntaryRecord();
    assert.strictEqual(syncWorkTypeFromVisitType(v), 'Voluntary Police Station Attendance');
  });

  it('maps extended follow-up types onto Further + _followUpReason', () => {
    const d = syntheticCustodyRecord();
    applyAttendanceVisitType(d, ATTENDANCE_VISIT_TYPES.re_interview);
    assert.strictEqual(d.workType, WORK_TYPE_FURTHER);
    assert.strictEqual(d._followUpReason, 're_interview');
    assert.strictEqual(d.caseStatus, 'Existing case');
    assert.strictEqual(d.clientType, 'Existing');

    const d2 = syntheticCustodyRecord();
    applyAttendanceVisitType(d2, ATTENDANCE_VISIT_TYPES.identification);
    assert.strictEqual(d2._followUpReason, 'identification');
    assert.strictEqual(REASON_CODE_BY_VISIT_TYPE.identification, 'identification');

    const d3 = syntheticCustodyRecord();
    applyAttendanceVisitType(d3, ATTENDANCE_VISIT_TYPES.rui_return);
    assert.strictEqual(d3._followUpReason, 'rui_return');

    const d4 = syntheticCustodyRecord();
    applyAttendanceVisitType(d4, ATTENDANCE_VISIT_TYPES.charge_only);
    assert.strictEqual(d4.workType, WORK_TYPE_FURTHER);
    assert.strictEqual(d4._followUpReason, 'charge_only');
    assert.strictEqual(
      resolveAttendanceVisitType(d4),
      ATTENDANCE_VISIT_TYPES.charge_only
    );
  });

  it('custody → bail return → first preserves every data key and non-managed values', () => {
    const before = syntheticCustodyRecord({ notesToOffice: 'Ring firm' });
    const keys = Object.keys(before);
    const d = JSON.parse(JSON.stringify(before));
    let r = applyAttendanceVisitType(d, ATTENDANCE_VISIT_TYPES.bail_return);
    assert.strictEqual(r.changed, true);
    assert.strictEqual(d.attendanceMode, 'custody');
    assert.strictEqual(d.workType, WORK_TYPE_FURTHER);
    assert.strictEqual(d.caseStatus, 'Existing case');
    assert.strictEqual(d.clientType, 'Existing');
    assert.strictEqual(d._followUpReason, 'bail_return');
    assertAllKeysPreserved(before, d, 'after bail');
    keys.forEach(function (k) {
      if (['workType', 'caseStatus', 'clientType', '_followUpReason', '_followUpInstanceId'].includes(k)) return;
      assert.strictEqual(d[k], before[k], 'unexpected change on ' + k);
    });

    r = applyAttendanceVisitType(d, ATTENDANCE_VISIT_TYPES.first);
    assert.strictEqual(r.changed, true);
    assertAllKeysPreserved(before, d, 'after revert');
    assert.strictEqual(d.workType, before.workType);
    assert.strictEqual(d.caseStatus, before.caseStatus);
    assert.strictEqual(d.clientType, before.clientType);
    assert.strictEqual(d.notesToOffice, 'Ring firm');
    assert.strictEqual(d._followUpReason, undefined);
  });

  it('voluntary → bail return keeps voluntary-only fields while switching to custody profile', () => {
    const before = syntheticVoluntaryRecord();
    const d = JSON.parse(JSON.stringify(before));
    const r = applyAttendanceVisitType(d, ATTENDANCE_VISIT_TYPES.bail_return);
    assert.strictEqual(r.changed, true);
    assert.strictEqual(d.attendanceMode, 'custody');
    assert.strictEqual(d.volOutcomeDecision, before.volOutcomeDecision);
    assert.strictEqual(d.voluntaryChronologyNotes, before.voluntaryChronologyNotes);
    assert.strictEqual(d._followUpReason, 'bail_return');
    assert.ok(Object.keys(d).length >= Object.keys(before).length);
  });

  it('blocks telephone records with plain message', () => {
    const d = { _formType: 'telephone', workType: 'Police Station Telephone Attendance' };
    const r = applyAttendanceVisitType(d, ATTENDANCE_VISIT_TYPES.bail_return);
    assert.strictEqual(r.blocked, true);
    assert.strictEqual(r.message, TELEPHONE_VISIT_TYPE_BLOCK_MESSAGE);
  });

  it('syncVisitTypeFromWorkType aligns further work type and clears follow-up on first work type', () => {
    const d = syntheticCustodyRecord();
    d.workType = WORK_TYPE_FURTHER;
    d._followUpReason = 'identification';
    syncVisitTypeFromWorkType(d);
    assert.strictEqual(resolveAttendanceVisitType(d), ATTENDANCE_VISIT_TYPES.identification);
    d.workType = 'First Police Station Attendance';
    syncVisitTypeFromWorkType(d);
    assert.strictEqual(resolveAttendanceVisitType(d), ATTENDANCE_VISIT_TYPES.first);
    assert.strictEqual(d._followUpReason, undefined);
  });

  it('logs visit type changes in _visitTypeChangeLog', () => {
    const d = syntheticCustodyRecord();
    applyAttendanceVisitType(d, ATTENDANCE_VISIT_TYPES.bail_return);
    assert.ok(Array.isArray(d._visitTypeChangeLog) && d._visitTypeChangeLog.length === 1);
    assert.strictEqual(d._visitTypeChangeLog[0].from, ATTENDANCE_VISIT_TYPES.first);
    assert.strictEqual(d._visitTypeChangeLog[0].to, ATTENDANCE_VISIT_TYPES.bail_return);
  });

  it('followUpReasonCodesForChooser matches follow-up attendance model', () => {
    const codes = followUpReasonCodesForChooser();
    assert.ok(codes.re_interview);
    assert.ok(codes.identification);
    assert.ok(!codes.breach);
  });
});

describe('attendance-visit-type work_type column on save', () => {
  it('persists work_type from parsed JSON like attendance-save', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    runMigrations(db);
    const data = syntheticCustodyRecord();
    applyAttendanceVisitType(data, ATTENDANCE_VISIT_TYPES.bail_return);
    const dataStr = JSON.stringify(data);
    const workType = data.workType || '';
    db.run(
      'INSERT INTO attendances (data, status, updated_at, client_name, work_type) VALUES (?,?,?,?,?)',
      [dataStr, 'draft', '2026-10-24 12:00:00', 'Tester, Alex', workType]
    );
    const row = db.exec('SELECT work_type FROM attendances WHERE id=1')[0].values[0][0];
    assert.strictEqual(row, WORK_TYPE_FURTHER);
  });
});

describe('attendance-visit-type UI wiring (source)', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  it('loads attendance-visit-type.js and renders attendance type dropdown bar', () => {
    assert.match(indexHtml, /attendance-visit-type\.js/);
    assert.match(indexHtml, /attendance-visit-outcome\.js/);
    assert.match(indexHtml, /id="form-visit-type-bar"/);
    assert.match(appJs, /function updateVisitTypeBar/);
    assert.match(appJs, /handleAttendanceVisitTypeChange/);
    assert.match(appJs, /id="visit-type-attendance-select"/);
    assert.doesNotMatch(appJs, /id="visit-type-outcome-select"/);
    assert.match(appJs, /f\.key === 'workType' && formData\._formType !== 'telephone'/);
    assert.match(appJs, /syncWorkTypeFromVisitType/);
    assert.doesNotMatch(appJs, /visit-type-segmented/);
  });

  it('hides duplicate attendanceMode field in section 1 for station forms', () => {
    assert.match(appJs, /f\.key === 'attendanceMode' && formData\._formType !== 'telephone'/);
  });
});
