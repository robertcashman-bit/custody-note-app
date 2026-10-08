'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encryptBuffer, decryptBuffer } = require('../lib/dbCrypto');
const {
  mergeAttendanceRecords,
  planDuplicateCollapse,
  HISTORY_KEY,
  stampFieldUpdatedAt,
  capConflictHistory,
  backupThenMoveFoldFiles,
  parseTimestampMs,
} = require('../lib/syncFieldMerge');

const FOLD_KEY = 'ab'.repeat(32);
function foldEncrypt(buf) { return encryptBuffer(buf, FOLD_KEY); }
function foldDecrypt(buf) { return decryptBuffer(buf, FOLD_KEY); }

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
      row({ id: 4, created_at: '2026-01-01T08:00:00.000Z', data: JSON.stringify({ note: 'older', extra: 'from first' }), updated_at: '2026-01-01T00:00:00.000Z' }),
      row({ id: 9, created_at: '2026-01-01 08:00:00', data: JSON.stringify({ note: 'newer', other: 'from copy' }), updated_at: '2026-05-01T00:00:00.000Z', sync_version: 6 }),
    ]);
    assert.equal(plan.action, 'fold');
    assert.deepEqual(plan.removeIds, [9]);
    const data = JSON.parse(plan.keeper.data);
    assert.equal(data.note, 'newer');
    assert.equal(data.extra, 'from first');
    assert.equal(data.other, 'from copy');
    assert.ok(data[HISTORY_KEY].some((h) => h.field === 'note' && h.lost === 'older'));
  });

  it('copies a lone invoice id onto the kept row and refuses the fold when both differ', () => {
    const folded = planDuplicateCollapse([
      row({ id: 4, created_at: '2026-01-01T08:00:00.000Z', quickfile_invoice_id: null, data: '{}' }),
      row({ id: 9, created_at: '2026-01-01T08:00:00.000Z', quickfile_invoice_id: 'INV-9', data: '{}' }),
    ]);
    assert.equal(folded.collapse, true);
    assert.equal(folded.keeper.quickfile_invoice_id, 'INV-9');
    assert.deepEqual(folded.removeIds, [9]);

    const clash = planDuplicateCollapse([
      row({ id: 4, created_at: '2026-01-01T08:00:00.000Z', quickfile_invoice_id: 'INV-1', data: '{}' }),
      row({ id: 9, created_at: '2026-01-01T08:00:00.000Z', quickfile_invoice_id: 'INV-2', data: '{}' }),
    ]);
    assert.equal(clash.collapse, false);
    assert.deepEqual(clash.removeIds, []);
    assert.deepEqual(clash.rekeyIds, [9]);
  });

  it('marks the keeper dirty and keeps the higher version when either row is unsynced', () => {
    const plan = planDuplicateCollapse([
      row({ id: 4, created_at: '2026-01-01T08:00:00.000Z', sync_dirty: 0, sync_version: 3, data: '{}' }),
      row({ id: 9, created_at: '2026-01-01T08:00:00.000Z', sync_dirty: 1, sync_version: 8, data: '{}' }),
    ]);
    assert.equal(plan.keeper.sync_dirty, 1);
    assert.ok(plan.keeper.sync_version >= 8);
    assert.deepEqual(plan.removeIds, [9]);
  });

  it('keeps both notes when a shared sync_id is not the same attendance', () => {
    const plan = planDuplicateCollapse([
      row({
        id: 4,
        created_at: '2026-01-01T08:00:00.000Z',
        client_name: 'Ada',
        attendance_date: '2026-01-01',
        dscc_ref: 'DSCC/1',
        data: JSON.stringify({ note: 'one' }),
      }),
      row({
        id: 9,
        created_at: '2026-02-02T08:00:00.000Z',
        client_name: 'Grace',
        attendance_date: '2026-02-02',
        dscc_ref: 'DSCC/9',
        data: JSON.stringify({ note: 'two' }),
      }),
    ]);
    assert.deepEqual(plan.removeIds, []);
    assert.deepEqual(plan.rekeyIds, [9]);
    assert.equal(plan.action, 'rekey');
  });

  it('folds a subset row and moves its photos only after a verified backup', () => {
    const plan = planDuplicateCollapse([
      row({
        id: 4,
        created_at: '2026-01-01T08:00:00.000Z',
        data: JSON.stringify({ note: 'full', extra: 'kept' }),
      }),
      row({
        id: 9,
        created_at: '',
        client_name: 'Ada',
        dscc_ref: '',
        attendance_date: '',
        station_name: '',
        data: JSON.stringify({ note: 'full' }),
      }),
    ]);
    assert.deepEqual(plan.removeIds, [9]);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-fold-'));
    const photos = path.join(root, 'photos');
    fs.mkdirSync(path.join(photos, '9'), { recursive: true });
    fs.writeFileSync(path.join(photos, '9', 'p1.enc'), 'photo-bytes');
    const extra = row({ id: 9, quickfile_invoice_id: 'INV-9', data: JSON.stringify({ note: 'Client surname PRIVATE' }) });
    const prepared = backupThenMoveFoldFiles({
      fs: fs,
      path: path,
      photosRoot: photos,
      backupDir: path.join(root, 'backup'),
      keeperId: 4,
      extraRow: extra,
      related: { billingAudit: [{ attendance_id: 9, action: 'invoice' }] },
      encryptBuffer: foldEncrypt,
      decryptBuffer: foldDecrypt,
    });
    assert.equal(prepared.ok, true);
    assert.equal(fs.readFileSync(path.join(photos, '4', 'p1.enc'), 'utf8'), 'photo-bytes');
    assert.equal(fs.existsSync(path.join(photos, '9')), false);
    const onDisk = fs.readFileSync(prepared.backupPath);
    assert.equal(onDisk.slice(0, 4).toString(), 'CNDB');
    assert.equal(onDisk.toString('utf8').includes('PRIVATE'), false);
    assert.equal(onDisk.toString('utf8').includes('INV-9'), false);
    const saved = JSON.parse(foldDecrypt(onDisk).toString('utf8'));
    assert.equal(saved.attendance.quickfile_invoice_id, 'INV-9');
    assert.equal(JSON.parse(saved.attendance.data).note, 'Client surname PRIVATE');
    assert.equal(saved.related.billingAudit[0].action, 'invoice');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses the fold backup when encryption is not available', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-fold-plain-'));
    const photos = path.join(root, 'photos');
    fs.mkdirSync(path.join(photos, '9'), { recursive: true });
    fs.writeFileSync(path.join(photos, '9', 'p1.enc'), 'stay');
    const prepared = backupThenMoveFoldFiles({
      fs: fs,
      path: path,
      photosRoot: photos,
      backupDir: path.join(root, 'backup'),
      keeperId: 4,
      extraRow: row({ id: 9, data: JSON.stringify({ note: 'must not land in clear' }) }),
    });
    assert.equal(prepared.ok, false);
    assert.equal(prepared.reason, 'no_encryption');
    assert.equal(fs.existsSync(path.join(root, 'backup')), false);
    assert.equal(fs.readFileSync(path.join(photos, '9', 'p1.enc'), 'utf8'), 'stay');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('does not move photos when the backup directory cannot be written', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-fold-nobackup-'));
    const photos = path.join(root, 'photos');
    fs.mkdirSync(path.join(photos, '9'), { recursive: true });
    fs.writeFileSync(path.join(photos, '9', 'p1.enc'), 'stay');
    const prepared = backupThenMoveFoldFiles({
      fs: fs,
      path: path,
      photosRoot: photos,
      backupDir: null,
      keeperId: 4,
      extraRow: row({ id: 9 }),
    });
    assert.equal(prepared.ok, false);
    assert.equal(fs.readFileSync(path.join(photos, '9', 'p1.enc'), 'utf8'), 'stay');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('stamps a field time when that field changes and leaves unchanged fields', () => {
    const prev = { note: 'a', place: 'station', _cnFieldUpdatedAt: { note: '2026-01-01T00:00:00.000Z' } };
    const next = stampFieldUpdatedAt(prev, { note: 'b', place: 'station' }, '2026-08-08T08:08:00.000Z');
    assert.equal(next._cnFieldUpdatedAt.note, '2026-08-08T08:08:00.000Z');
    assert.equal(next._cnFieldUpdatedAt.place, undefined);
  });

  it('keeps background merge history when the open editor saves', () => {
    const prev = {
      note: 'merged',
      _cnConflictHistory: [
        { field: 'note', kept: 'merged', lost: 'background', keptFrom: 'remote', lostFrom: 'local', at: '2026-01-01T00:00:00.000Z' },
      ],
    };
    const incoming = {
      note: 'typed',
      _cnConflictHistory: [
        { field: 'note', kept: 'merged', lost: 'background', keptFrom: 'remote', lostFrom: 'local', at: '2026-01-01T00:00:00.000Z' },
        { field: 'place', kept: 'A', lost: 'B', keptFrom: 'local', lostFrom: 'remote', at: '2026-02-01T00:00:00.000Z' },
      ],
    };
    const next = stampFieldUpdatedAt(prev, incoming, '2026-08-01T00:00:00.000Z');
    const fields = next._cnConflictHistory.map((h) => h.field).sort();
    assert.deepEqual(fields, ['note', 'place']);
    const again = stampFieldUpdatedAt(next, { note: 'typed', place: 'station' }, '2026-08-02T00:00:00.000Z');
    assert.equal(again._cnConflictHistory.length, 2);
  });

  it('caps conflict history at 10 entries per field and about 50 KB', () => {
    const list = [];
    for (let i = 0; i < 12; i++) {
      list.push({ field: 'note', kept: 'k' + i, lost: 'l' + i, at: '2026-01-0' + (i < 9 ? i + 1 : 9) });
    }
    list.push({ field: 'place', kept: 'p', lost: 'q', at: '2026-02-01T00:00:00.000Z' });
    const capped = capConflictHistory(list);
    assert.equal(capped.filter((h) => h.field === 'note').length, 10);
    assert.equal(capped[0].lost, 'l2');
    assert.equal(capped.filter((h) => h.field === 'place').length, 1);

    const bulky = [];
    for (let i = 0; i < 8; i++) {
      bulky.push({ field: 'blob', kept: 'k', lost: 'x'.repeat(12000), at: String(i) });
    }
    const shrunk = capConflictHistory(bulky);
    assert.ok(Buffer.byteLength(JSON.stringify(shrunk), 'utf8') <= 50 * 1024);
    assert.ok(shrunk.length < bulky.length);
    assert.equal(shrunk[shrunk.length - 1].at, '7');
  });

  it('compares SQLite datetime and ISO timestamps as the same UTC instant', () => {
    const sqlite = '2026-06-02 12:00:00';
    const iso = '2026-06-02T12:00:00.000Z';
    assert.equal(parseTimestampMs(sqlite), parseTimestampMs(iso));
    const newer = mergeAttendanceRecords({
      base: null,
      local: row({ data: JSON.stringify({ note: 'local' }), updated_at: '2026-06-02T11:00:00.000Z' }),
      remote: row({ data: JSON.stringify({ note: 'remote' }), updated_at: sqlite, sync_dirty: 0 }),
    });
    assert.equal(newer.data.note, 'remote');
    const tie = mergeAttendanceRecords({
      base: null,
      local: row({ data: JSON.stringify({ note: 'local' }), updated_at: iso }),
      remote: row({ data: JSON.stringify({ note: 'remote' }), updated_at: sqlite, sync_dirty: 0 }),
    });
    assert.equal(tie.data.note, 'local');
  });
});
