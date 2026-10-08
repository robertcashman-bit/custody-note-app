'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeAttendanceRecords,
  planDuplicateCollapse,
  HISTORY_KEY,
  stampFieldUpdatedAt,
} = require('../lib/syncFieldMerge');

function row(overrides) {
  return Object.assign({
    id: 1,
    sync_id: 'sync-1',
    data: '{}',
    status: 'draft',
    client_name: 'Ada',
    station_name: 'East',
    dscc_ref: 'DSCC/1',
    attendance_date: '2026-01-01',
    supervisor_note: '',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    deletion_reason: null,
    sync_version: 2,
    sync_dirty: 1,
  }, overrides || {});
}

describe('automatic field merge', () => {
  it('keeps the only side that changed a field', () => {
    const base = row({
      data: JSON.stringify({ note: 'shared', localOnly: 'keep me' }),
      sync_dirty: 0,
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    const local = row({
      data: JSON.stringify({ note: 'shared', localOnly: 'keep me', localEdit: 'from this pc' }),
      updated_at: '2026-03-01T00:00:00.000Z',
      sync_version: 3,
    });
    const remote = row({
      data: JSON.stringify({ note: 'from other pc', localOnly: 'keep me' }),
      updated_at: '2026-02-01T00:00:00.000Z',
      sync_version: 4,
      sync_dirty: 0,
    });
    const merged = mergeAttendanceRecords({ base: base, local: local, remote: remote });
    assert.equal(merged.data.localOnly, 'keep me');
    assert.equal(merged.data.localEdit, 'from this pc');
    assert.equal(merged.data.note, 'from other pc');
    assert.equal(merged.syncDirty, 1);
    const history = merged.data[HISTORY_KEY] || [];
    assert.equal(history.some((h) => h.field === 'localEdit'), false);
    assert.equal(history.some((h) => h.field === 'note'), false);
  });

  it('newest edit wins when both sides changed the same field, and keeps the loser', () => {
    const local = row({
      data: JSON.stringify({ note: 'local note' }),
      updated_at: '2026-01-02T00:00:00.000Z',
      sync_version: 3,
    });
    const remote = row({
      data: JSON.stringify({ note: 'remote note' }),
      updated_at: '2026-04-01T00:00:00.000Z',
      sync_version: 5,
      sync_dirty: 0,
    });
    const merged = mergeAttendanceRecords({ base: null, local: local, remote: remote });
    assert.equal(merged.data.note, 'remote note');
    const history = merged.data[HISTORY_KEY];
    assert.ok(Array.isArray(history));
    const noteHist = history.filter((h) => h.field === 'note');
    assert.equal(noteHist.length, 1);
    assert.equal(noteHist[0].lost, 'local note');
    assert.equal(noteHist[0].kept, 'remote note');
    assert.equal(merged.syncDirty, 0, 'winning body matches the cloud, so the note is not left dirty');
    assert.equal(merged.version, 5);
  });

  it('uses a newer per-field timestamp over the record timestamp', () => {
    const local = row({
      data: JSON.stringify({
        note: 'local newer field',
        _cnFieldUpdatedAt: { note: '2026-08-01T00:00:00.000Z' },
      }),
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    const remote = row({
      data: JSON.stringify({
        note: 'remote older field',
        _cnFieldUpdatedAt: { note: '2026-02-01T00:00:00.000Z' },
      }),
      updated_at: '2026-07-01T00:00:00.000Z',
      sync_dirty: 0,
    });
    const merged = mergeAttendanceRecords({ base: null, local: local, remote: remote });
    assert.equal(merged.data.note, 'local newer field');
    assert.equal(merged.data[HISTORY_KEY][0].lost, 'remote older field');
  });

  it('a tie keeps the local unsynced edit', () => {
    const at = '2026-05-01T12:00:00.000Z';
    const merged = mergeAttendanceRecords({
      base: null,
      local: row({ data: JSON.stringify({ note: 'local tie' }), updated_at: at, sync_version: 4 }),
      remote: row({ data: JSON.stringify({ note: 'remote tie' }), updated_at: at, sync_version: 4, sync_dirty: 0 }),
    });
    assert.equal(merged.data.note, 'local tie');
    assert.equal(merged.data[HISTORY_KEY][0].lost, 'remote tie');
    assert.equal(merged.syncDirty, 1);
  });

  it('restores a note when a delete meets an edit', () => {
    const edited = mergeAttendanceRecords({
      base: null,
      local: row({
        data: JSON.stringify({ note: 'edited after delete' }),
        updated_at: '2026-06-01T00:00:00.000Z',
        deleted_at: null,
      }),
      remote: row({
        data: JSON.stringify({ note: 'old' }),
        updated_at: '2026-02-01T00:00:00.000Z',
        deleted_at: '2026-03-01T00:00:00.000Z',
        deletion_reason: 'removed on other pc',
        sync_dirty: 0,
      }),
    });
    assert.equal(edited.restored, true);
    assert.equal(edited.deletedAt, null);
    assert.equal(edited.data.note, 'edited after delete');
    assert.ok(edited.data[HISTORY_KEY].some((h) => h.field === 'deletedAt'));
    assert.equal(edited.syncDirty, 1);

    const remoteEdited = mergeAttendanceRecords({
      base: null,
      local: row({
        data: JSON.stringify({ note: 'old local' }),
        deleted_at: '2026-03-01T00:00:00.000Z',
        deletion_reason: 'deleted here',
        updated_at: '2026-03-01T00:00:00.000Z',
      }),
      remote: row({
        data: JSON.stringify({ note: 'edited remotely' }),
        deleted_at: null,
        updated_at: '2026-06-02T00:00:00.000Z',
        sync_dirty: 0,
      }),
    });
    assert.equal(remoteEdited.restored, true);
    assert.equal(remoteEdited.deletedAt, null);
    assert.equal(remoteEdited.data.note, 'edited remotely');
  });

  it('does not add another history copy when the same merge repeats', () => {
    const local = row({ data: JSON.stringify({ note: 'L' }), updated_at: '2026-01-01T00:00:00.000Z', sync_version: 2 });
    const remote = row({ data: JSON.stringify({ note: 'R' }), updated_at: '2026-04-01T00:00:00.000Z', sync_version: 4, sync_dirty: 0 });
    const first = mergeAttendanceRecords({ base: null, local: local, remote: remote });
    const againLocal = row({
      data: first.dataJson,
      updated_at: first.updatedAt,
      sync_version: first.version,
      sync_dirty: first.syncDirty,
      client_name: first.clientName,
      station_name: first.stationName,
      dscc_ref: first.dsccRef,
      attendance_date: first.attendanceDate,
    });
    const second = mergeAttendanceRecords({ base: null, local: againLocal, remote: remote });
    assert.equal(second.unchanged, true);
    assert.equal(second.version, first.version);
    assert.equal((second.data[HISTORY_KEY] || first.data[HISTORY_KEY]).length, first.data[HISTORY_KEY].length);
  });

  it('folds duplicate sync_id rows into the keeper without dropping fields', () => {
    const plan = planDuplicateCollapse([
      row({ id: 4, data: JSON.stringify({ note: 'older', extra: 'from first' }), updated_at: '2026-01-01T00:00:00.000Z' }),
      row({ id: 9, data: JSON.stringify({ note: 'newer', other: 'from copy' }), updated_at: '2026-05-01T00:00:00.000Z', sync_version: 6 }),
    ]);
    assert.deepEqual(plan.removeIds, [9]);
    const data = JSON.parse(plan.keeper.data);
    assert.equal(data.note, 'newer');
    assert.equal(data.extra, 'from first');
    assert.equal(data.other, 'from copy');
    assert.ok(data[HISTORY_KEY].some((h) => h.field === 'note' && h.lost === 'older'));
  });

  it('stamps a field time when that field changes and leaves unchanged fields', () => {
    const prev = { note: 'a', place: 'station', _cnFieldUpdatedAt: { note: '2026-01-01T00:00:00.000Z' } };
    const next = stampFieldUpdatedAt(prev, { note: 'b', place: 'station' }, '2026-08-08T08:08:00.000Z');
    assert.equal(next._cnFieldUpdatedAt.note, '2026-08-08T08:08:00.000Z');
    assert.equal(next._cnFieldUpdatedAt.place, undefined);
  });
});
