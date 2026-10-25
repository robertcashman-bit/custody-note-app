'use strict';

/**
 * Two devices, same account — OpenAI API key save on A appears on B; clear on A clears B.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const openaiSync = require('../lib/openaiApiKeySync');
const { createMockSyncServer, getTestLicenceKey, getTestUserId, resetMockSyncStores } = require('./fixtures/mockSyncServer.mjs');

const KEY_A = getTestLicenceKey();
const KEY_B = 'SYNC-TEST-0002-KEY2';
const ACCOUNT_ID = getTestUserId();

async function httpPostJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}

describe('OpenAI API key account sync (two profiles)', () => {
  let mock;
  let apiBase;
  let wrapHex = '';

  before(async () => {
    resetMockSyncStores();
    mock = createMockSyncServer();
    apiBase = await mock.start();
    const wrap = await openaiSync.fetchAccountWrapKey(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY_A,
      'machine-a',
      { accountId: ACCOUNT_ID }
    );
    assert.equal(wrap.ok, true);
    wrapHex = wrap.wrapKeyHex;
  });

  after(async () => {
    await mock.stop();
  });

  it('save on device A, pull on device B', async () => {
    const testKey = 'sk-test-cross-device-' + Date.now();
    const pushA = await openaiSync.pushOpenAiApiKeyToServer(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY_A,
      'machine-a',
      wrapHex,
      testKey,
      { accountId: ACCOUNT_ID }
    );
    assert.equal(pushA.ok, true);

    const pullB = await openaiSync.pullOpenAiApiKeyFromServer(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY_B,
      'machine-b',
      wrapHex,
      { accountId: ACCOUNT_ID }
    );
    assert.equal(pullB.ok, true);
    const dec = openaiSync.decryptOpenAiApiKeyBlob(wrapHex, pullB.blob);
    assert.equal(dec.openaiApiKey, testKey);
  });

  it('clear on device A removes key for device B', async () => {
    const clearA = await openaiSync.pushOpenAiApiKeyToServer(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY_A,
      'machine-a',
      wrapHex,
      '',
      { accountId: ACCOUNT_ID }
    );
    assert.equal(clearA.ok, true);

    const pullB = await openaiSync.pullOpenAiApiKeyFromServer(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY_B,
      'machine-b',
      wrapHex,
      { accountId: ACCOUNT_ID }
    );
    assert.equal(pullB.ok, true);
    assert.equal(pullB.empty, true);
  });
});
