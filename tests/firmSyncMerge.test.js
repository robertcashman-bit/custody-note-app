'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mergeFirmRecords, matchLocalFirm, dedupeLocalFirms } = require('../lib/firmSyncMerge');

describe('firmSyncMerge', () => {
  it('merge keeps non-empty fields and newest edit on conflict', () => {
    const local = {
      id: 1,
      sync_id: 'f1',
      name: 'Alpha LLP',
      contact_email: 'old@example.com',
      updated_at: '2026-01-01T10:00:00.000Z',
      sync_version: 2,
    };
    const remote = {
      sync_id: 'f1',
      name: 'Alpha LLP',
      contact_email: 'new@example.com',
      contact_phone: '0123',
      updated_at: '2026-02-01T10:00:00.000Z',
      sync_version: 3,
    };
    const { merged, changed } = mergeFirmRecords(local, remote);
    assert.strictEqual(changed, true);
    assert.strictEqual(merged.contact_email, 'new@example.com');
    assert.strictEqual(merged.contact_phone, '0123');
    assert.ok(Number(merged.sync_version) >= 3);
  });

  it('match prefers sync_id then quickfile_client_id then name', () => {
    const rows = [
      { id: 1, sync_id: 's1', name: 'A', quickfile_client_id: 'qf-9' },
      { id: 2, sync_id: 's2', name: 'B', quickfile_client_id: '' },
    ];
    assert.strictEqual(matchLocalFirm(rows, { sync_id: 's2' }).id, 2);
    assert.strictEqual(matchLocalFirm(rows, { quickfile_client_id: 'qf-9' }).id, 1);
    assert.strictEqual(matchLocalFirm(rows, { name: 'B' }).id, 2);
  });

  it('dedupe removes duplicate name rows without losing merged fields', () => {
    const rows = [
      { id: 1, sync_id: 'a', name: 'Same Co', contact_phone: '', updated_at: '2026-01-01T00:00:00.000Z', sync_version: 1 },
      { id: 2, sync_id: 'b', name: 'Same Co', contact_phone: '999', updated_at: '2026-06-01T00:00:00.000Z', sync_version: 2 },
    ];
    const { rows: kept, removedIds } = dedupeLocalFirms(rows);
    assert.strictEqual(removedIds.length, 1);
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(kept[0].contact_phone, '999');
  });
});
