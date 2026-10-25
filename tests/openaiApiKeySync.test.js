'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const openaiSync = require('../lib/openaiApiKeySync');
const qfSettings = require('../lib/quickfileSettingsSync');
const { createMockSyncServer, getTestLicenceKey, getTestUserId, resetMockSyncStores } = require('./fixtures/mockSyncServer.mjs');

const KEY = getTestLicenceKey();
const ACCOUNT_ID = getTestUserId();
const WRAP = crypto.randomBytes(32).toString('hex');

describe('openaiApiKeySync crypto', () => {
  it('encrypts and decrypts with account wrap key', () => {
    const blob = openaiSync.encryptOpenAiApiKeyBlob(WRAP, 'sk-test-openai-abc');
    assert.ok(blob.length > 20);
    const out = openaiSync.decryptOpenAiApiKeyBlob(WRAP, blob);
    assert.equal(out.openaiApiKey, 'sk-test-openai-abc');
  });

  it('licence-key preferences blob never contains openaiApiKey', () => {
    const blob = qfSettings.encryptQuickFileSettings(KEY, { openaiApiKey: 'sk-test', email: 'a@b.c' });
    const dec = qfSettings.decryptQuickFileSettings(KEY, blob);
    assert.equal(dec.openaiApiKey, undefined);
    assert.equal(dec.email, 'a@b.c');
  });

  it('resolveNewestOpenAiKey picks newer timestamp', () => {
    const r = openaiSync.resolveNewestOpenAiKey(
      'sk-local',
      '2026-01-01T00:00:00.000Z',
      'sk-remote',
      '2026-06-01T00:00:00.000Z'
    );
    assert.equal(r.key, 'sk-remote');
    assert.equal(r.winner, 'remote');
  });
});

describe('openaiApiKeySync mock server', () => {
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

  async function httpPostJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return res.json();
  }

  it('revoked machine cannot fetch wrap key', async () => {
    const wrap = await openaiSync.fetchAccountWrapKey(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY,
      'revoked-test-machine',
      { accountId: ACCOUNT_ID }
    );
    assert.equal(wrap.ok, false);
    assert.match(String(wrap.error || ''), /revoked/i);
  });

  it('push and pull round-trip without logging secrets', async () => {
    const wrap = await openaiSync.fetchAccountWrapKey(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY,
      'machine-openai-a',
      { accountId: ACCOUNT_ID }
    );
    assert.equal(wrap.ok, true);
    const push = await openaiSync.pushOpenAiApiKeyToServer(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY,
      'machine-openai-a',
      wrap.wrapKeyHex,
      'sk-test-profile-a',
      { accountId: ACCOUNT_ID }
    );
    assert.equal(push.ok, true);
    const pull = await openaiSync.pullOpenAiApiKeyFromServer(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY,
      'machine-openai-b',
      wrap.wrapKeyHex,
      { accountId: ACCOUNT_ID }
    );
    assert.equal(pull.ok, true);
    const dec = openaiSync.decryptOpenAiApiKeyBlob(wrap.wrapKeyHex, pull.blob);
    assert.equal(dec.openaiApiKey, 'sk-test-profile-a');
  });

  it('clear removes blob on server', async () => {
    const wrap = await openaiSync.fetchAccountWrapKey(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY,
      'machine-openai-clear',
      { accountId: ACCOUNT_ID }
    );
    await openaiSync.pushOpenAiApiKeyToServer(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY,
      'machine-openai-clear',
      wrap.wrapKeyHex,
      '',
      { accountId: ACCOUNT_ID }
    );
    const pull = await openaiSync.pullOpenAiApiKeyFromServer(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY,
      'machine-openai-clear',
      wrap.wrapKeyHex,
      { accountId: ACCOUNT_ID }
    );
    assert.equal(pull.ok, true);
    assert.equal(pull.empty, true);
  });
});

describe('main.js OpenAI key sync wiring', () => {
  const fs = require('fs');
  const path = require('path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  it('defines account-backed OpenAI sync helpers', () => {
    assert.match(main, /async function ensureOpenAiApiKeyFromServer/);
    assert.match(main, /async function pushOpenAiApiKeyToCloud/);
    assert.match(main, /function scheduleOpenAiApiKeyCloudPush/);
    assert.match(main, /openaiApiKeyUnreadable/);
  });

  it('schedules cloud push when OpenAI key is saved or cleared', () => {
    assert.match(main, /scheduleOpenAiApiKeyCloudPush\('openai-save'\)/);
    assert.match(main, /scheduleOpenAiApiKeyCloudPush\('openai-clear'\)/);
  });
});

describe('app.js unreadable OpenAI key warning', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  it('shows warning when openaiApiKeyUnreadable is set', () => {
    assert.match(app, /openaiApiKeyUnreadable/);
    assert.match(app, /openai-apikey-unreadable-hint/);
  });
});
