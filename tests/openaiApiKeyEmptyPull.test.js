'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const openaiSync = require('../lib/openaiApiKeySync');
const migration = require('../lib/openaiApiKeyLocalMigration');

describe('resolveEmptyServerPullAction', () => {
  it('never wipes a local key when the account has never stored one', () => {
    assert.equal(openaiSync.resolveEmptyServerPullAction({
      localHasKey: true, localServerUpdatedAt: '', serverUpdatedAt: '',
    }), 'push-local');
  });

  it('pushes a never-synced local key even if the server has a timestamp', () => {
    assert.equal(openaiSync.resolveEmptyServerPullAction({
      localHasKey: true, localServerUpdatedAt: '', serverUpdatedAt: '2026-10-25T10:00:00.000Z',
    }), 'push-local');
  });

  it('keeps the local key when the server clear is not newer', () => {
    assert.equal(openaiSync.resolveEmptyServerPullAction({
      localHasKey: true,
      localServerUpdatedAt: '2026-10-25T12:00:00.000Z',
      serverUpdatedAt: '2026-10-25T11:00:00.000Z',
    }), 'keep-local');
  });

  it('clears only for a newer explicit remote clear', () => {
    assert.equal(openaiSync.resolveEmptyServerPullAction({
      localHasKey: true,
      localServerUpdatedAt: '2026-10-25T11:00:00.000Z',
      serverUpdatedAt: '2026-10-25T12:00:00.000Z',
    }), 'clear-local');
  });

  it('applies empty state when there is no local key', () => {
    assert.equal(openaiSync.resolveEmptyServerPullAction({
      localHasKey: false, localServerUpdatedAt: '', serverUpdatedAt: '',
    }), 'apply-empty');
  });
});

describe('shouldSealPlaintextKey', () => {
  it('does not overwrite a working sealed key with leftover plaintext', () => {
    assert.equal(migration.shouldSealPlaintextKey({ sealedKey: 'sk-current', plaintextKey: 'sk-stale' }), false);
  });
  it('seals plaintext when no sealed key exists', () => {
    assert.equal(migration.shouldSealPlaintextKey({ sealedKey: '', plaintextKey: 'sk-new' }), true);
  });
  it('does nothing with empty plaintext', () => {
    assert.equal(migration.shouldSealPlaintextKey({ sealedKey: '', plaintextKey: '' }), false);
  });
});
