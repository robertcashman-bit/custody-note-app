'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const sync = require('../lib/quickfileSettingsSync');
const cred = require('../lib/quickfileCredentialSync');
const { createMockSyncServer, getTestLicenceKey, resetMockSyncStores } = require('./fixtures/mockSyncServer.mjs');

const KEY_A = getTestLicenceKey();
const KEY_B = 'SYNC-TEST-0002-KEY2';
const ACCOUNT = 'acct-qf-cred-1';

async function httpPostJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}

describe('quickfileCredentialSync policy', () => {
  it('preferences blob never contains QuickFile credentials', () => {
    const settings = {
      quickfileAccountNumber: '1',
      quickfileApiKey: 'secret',
      quickfileAppId: 'app',
      email: 'a@b.c',
    };
    const picked = sync.pickSyncableSettings(settings);
    assert.equal(picked.quickfileApiKey, undefined);
    assert.ok(sync.NEVER_SYNC_SETTINGS_KEYS.includes('quickfileApiKey'));
  });

  it('licence key alone cannot decrypt credential ciphertext without wrap key', () => {
    const wrapKey = crypto.randomBytes(32).toString('hex');
    const blob = cred.encryptWithWrapKey(wrapKey, {
      quickfileAccountNumber: '99',
      quickfileApiKey: 'key',
      quickfileAppId: 'app',
    });
    assert.equal(cred.decryptCredentialBlob('f'.repeat(64), blob), null);
    assert.equal(sync.decryptQuickFileSettings(KEY_A, blob), null);
  });
});

describe('quickfileCredentialSync cross-install (mock server)', () => {
  let mock;
  let apiBase;

  before(async () => {
    resetMockSyncStores();
    mock = createMockSyncServer();
    apiBase = await mock.start();
  });

  after(async () => {
    await mock.stop();
  });

  it('device B with different licence key pulls credentials saved by device A', async () => {
    const httpPost = (url, body) => httpPostJson(url, body);
    const settings = {
      quickfileAccountNumber: '6131000000',
      quickfileApiKey: 'test-api-key',
      quickfileAppId: '6000',
    };
    const wrapA = await cred.fetchAccountWrapKey(httpPost, apiBase, KEY_A, 'machine-a', { accountId: ACCOUNT });
    assert.strictEqual(wrapA.ok, true);
    const push = await cred.pushQuickFileCredentialsToServer(
      httpPost, apiBase, KEY_A, 'machine-a', wrapA.wrapKeyHex, settings, { accountId: ACCOUNT }
    );
    assert.strictEqual(push.ok, true);

    const wrapB = await cred.fetchAccountWrapKey(httpPost, apiBase, KEY_B, 'machine-b', { accountId: ACCOUNT });
    assert.strictEqual(wrapB.ok, true);
    assert.strictEqual(wrapB.wrapKeyHex, wrapA.wrapKeyHex);

    const pull = await cred.pullQuickFileCredentialsFromServer(
      httpPost, apiBase, KEY_B, 'machine-b', wrapB.wrapKeyHex, { accountId: ACCOUNT }
    );
    assert.strictEqual(pull.ok, true, pull.error);
    const dec = cred.decryptCredentialBlob(wrapB.wrapKeyHex, pull.blob);
    assert.strictEqual(dec.quickfileApiKey, 'test-api-key');
  });

  it('revoked device cannot fetch wrap key', async () => {
    const httpPost = (url, body) => httpPostJson(url, body);
    const wrap = await cred.fetchAccountWrapKey(httpPost, apiBase, KEY_A, 'revoked-test-machine', { accountId: ACCOUNT });
    assert.strictEqual(wrap.ok, false);
    assert.match(String(wrap.error || ''), /revoked/i);
  });
});
