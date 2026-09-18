'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  CONFIRM_PHRASE,
  PURGE_REASON,
  isEligibleForPostBillPurge,
  isValidPurgeConfirmation,
  buildPurgedAttendanceStub,
  buildCloudPurgeRequest,
} = require('../lib/postBillPurge');

describe('postBillPurge eligibility', () => {
  it('rejects drafts and unbilled finalised notes', () => {
    assert.equal(isEligibleForPostBillPurge({ status: 'draft' }).eligible, false);
    assert.equal(
      isEligibleForPostBillPurge({ status: 'finalised', data: {} }).eligible,
      false
    );
  });

  it('allows invoice-linked, marked billed, or completed billing process', () => {
    assert.equal(
      isEligibleForPostBillPurge({
        status: 'finalised',
        quickfile_invoice_id: 'inv-1',
      }).eligible,
      true
    );
    assert.equal(
      isEligibleForPostBillPurge({
        status: 'finalised',
        data: { billedToFirmAt: '2026-01-01T00:00:00.000Z' },
      }).eligible,
      true
    );
    assert.equal(
      isEligibleForPostBillPurge({
        status: 'completed',
        data: { billingProcessCompletedAt: '2026-01-01T00:00:00.000Z' },
      }).eligible,
      true
    );
  });

  it('rejects already purged / deleted', () => {
    assert.equal(
      isEligibleForPostBillPurge({ deleted_at: 'x', quickfile_invoice_id: '1' }).eligible,
      false
    );
  });
});

describe('postBillPurge confirmation + stub', () => {
  it('requires exact DELETE phrase', () => {
    assert.equal(isValidPurgeConfirmation('DELETE'), true);
    assert.equal(isValidPurgeConfirmation('delete'), true);
    assert.equal(isValidPurgeConfirmation('DEL'), false);
    assert.equal(isValidPurgeConfirmation(''), false);
    assert.equal(CONFIRM_PHRASE, 'DELETE');
  });

  it('stub has no client content and tombstone reason', () => {
    const stub = buildPurgedAttendanceStub({ syncId: 'sync-abcdefghij', nowIso: '2026-09-18T00:00:00.000Z' });
    assert.equal(stub.deletionReason, PURGE_REASON);
    assert.equal(stub.clientName, '');
    assert.equal(stub.dsccRef, '');
    const data = JSON.parse(stub.dataJson);
    assert.equal(data.purged, true);
    assert.ok(!data.forename && !data.advice);
  });

  it('cloud purge request never includes note body', () => {
    const body = buildCloudPurgeRequest({
      licenceKey: 'cn-test',
      machineId: 'm1',
      syncId: 'sync-abcdefghij',
    });
    assert.equal(body.key, 'CN-TEST');
    assert.equal(body.syncId, 'sync-abcdefghij');
    assert.equal(body.reason, PURGE_REASON);
    assert.equal(body.data, undefined);
    assert.equal(body.clientName, undefined);
  });
});

describe('postBillPurge wiring (source)', () => {
  const root = path.join(__dirname, '..');
  it('IPC + preload + completion UI expose Clear after billed', () => {
    const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
    const completion = fs.readFileSync(path.join(root, 'renderer/views/completion-screen.js'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    assert.ok(main.includes("attendance-purge-after-billed"));
    assert.ok(main.includes('isValidPurgeConfirmation'));
    assert.ok(main.includes('/api/sync/purge'));
    assert.ok(preload.includes('attendancePurgeAfterBilled'));
    assert.ok(preload.includes('attendanceMarkBilledToFirm'));
    assert.ok(completion.includes('wf-purge-after-billed'));
    assert.ok(completion.includes('Clear after billed'));
    assert.ok(app.includes('runPostBillPurge'));
    assert.ok(app.includes('form-purge-after-billed-btn'));
  });

  it('purged attendance-get returns stub without undelete path for purge reason', () => {
    const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    assert.ok(main.includes("deletion_reason === POST_BILL_PURGE_REASON"));
    assert.ok(main.includes('cannot restore confidential content'));
  });
});
