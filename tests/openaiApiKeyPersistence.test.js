'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const openAiKeyLocalMigration = require('../lib/openaiApiKeyLocalMigration');
const openAiKeyCopy = require('../lib/openaiApiKeyCopy');
const openaiSync = require('../lib/openaiApiKeySync');
const { createMockSyncServer, getTestLicenceKey, getTestUserId, resetMockSyncStores } = require('./fixtures/mockSyncServer.mjs');

const KEY = getTestLicenceKey();
const ACCOUNT_ID = getTestUserId();

describe('openaiApiKeyLocalMigration', () => {
  it('prefers DB plaintext over legacy local file', () => {
    const picked = openAiKeyLocalMigration.pickPlaintextOpenAiKeyForMigration('sk-db', 'sk-local');
    assert.equal(picked.key, 'sk-db');
    assert.equal(picked.source, 'db');
  });

  it('migrates legacy local file when DB is empty', () => {
    const picked = openAiKeyLocalMigration.pickPlaintextOpenAiKeyForMigration('', 'sk-local');
    assert.equal(picked.key, 'sk-local');
    assert.equal(picked.source, 'local-file');
  });

  it('plans cleanup only after successful seal', () => {
    const fail = openAiKeyLocalMigration.planPostSealCleanup({
      sealedOk: false,
      hadDbPlaintext: true,
      hadLocalFile: true,
    });
    assert.equal(fail.clearDbPlaintext, false);
    assert.equal(fail.deleteLocalFile, false);
    const ok = openAiKeyLocalMigration.planPostSealCleanup({
      sealedOk: true,
      hadDbPlaintext: true,
      hadLocalFile: true,
    });
    assert.ok(ok.clearDbPlaintext);
    assert.ok(ok.deleteLocalFile);
  });

  it('forces server pull before AI when key missing or sealed unreadable', () => {
    assert.equal(
      openAiKeyLocalMigration.shouldForceServerPullBeforeAi({ localKey: '', sealedUnreadable: false }),
      true,
    );
    assert.equal(
      openAiKeyLocalMigration.shouldForceServerPullBeforeAi({ localKey: 'sk-x', sealedUnreadable: false }),
      false,
    );
    assert.equal(
      openAiKeyLocalMigration.shouldForceServerPullBeforeAi({ localKey: '', sealedUnreadable: true }),
      true,
    );
  });
});

describe('openaiApiKeyCopy user messages', () => {
  it('uses Account & cloud path and settings focus token', () => {
    assert.match(openAiKeyCopy.OPENAI_KEY_MISSING_USER_MESSAGE, /Account & cloud/);
    assert.match(openAiKeyCopy.OPENAI_KEY_MISSING_USER_MESSAGE, /all your computers/);
    const missing = openAiKeyCopy.openAiKeyMissingResult();
    assert.equal(missing.settingsFocus, openAiKeyCopy.OPENAI_KEY_SETTINGS_FOCUS);
    assert.equal(missing.error, openAiKeyCopy.OPENAI_KEY_MISSING_USER_MESSAGE);
  });
});

describe('main.js OpenAI key persistence wiring', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  it('pulls from server after sign-in and on AI use', () => {
    assert.match(main, /scheduleOpenAiKeyPullAfterAuth\('auth-poll'\)/);
    assert.match(main, /scheduleOpenAiKeyPullAfterAuth\('licence-activate'\)/);
    assert.match(main, /async function resolveOpenAiApiKeyForAiUse/);
    assert.match(main, /ensureOpenAiApiKeyFromServer\(\{ reason: 'ai-use', force: true \}\)/);
  });

  it('migrates openai-api-key.local and deletes after seal', () => {
    assert.match(main, /openAiKeyLocalMigration\.LOCAL_FALLBACK_BASENAME/);
    assert.match(main, /deleteOpenAiLocalFallbackFile/);
    assert.match(main, /scheduleOpenAiApiKeyCloudPush\('local-plaintext-migrate'\)/);
  });

  it('re-pulls when sealed file is unreadable', () => {
    assert.match(main, /sealedUnreadable && !localHasKey/);
    assert.match(main, /openAiUnreadable/);
  });

  it('returns missing-key payload with settings focus from AI IPC', () => {
    assert.match(main, /openAiKeyCopy\.openAiKeyMissingResult\(\)/);
  });

  it('exposes openOpenAiApiKeySettings in renderer', () => {
    assert.match(app, /function openOpenAiApiKeySettings/);
    assert.match(app, /openai-settings-card/);
    assert.match(app, /Account & cloud/);
  });

  it('does not point users at hidden Integrations tab for OpenAI key', () => {
    assert.doesNotMatch(main, /Integrations → OpenAI/);
    assert.doesNotMatch(app, /OpenAI API key in Settings → Integrations/);
  });
});

describe('OpenAI key account push (mock server)', () => {
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

  it('simulates save-on-device-A then pull on fresh device B userData', async () => {
    const wrap = await openaiSync.fetchAccountWrapKey(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY,
      'persist-machine-a',
      { accountId: ACCOUNT_ID },
    );
    assert.equal(wrap.ok, true);
    const testKey = 'sk-persist-' + Date.now();
    const push = await openaiSync.pushOpenAiApiKeyToServer(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY,
      'persist-machine-a',
      wrap.wrapKeyHex,
      testKey,
      { accountId: ACCOUNT_ID },
    );
    assert.equal(push.ok, true);

    const pullFresh = await openaiSync.pullOpenAiApiKeyFromServer(
      (url, body) => httpPostJson(url, body),
      apiBase,
      KEY,
      'persist-machine-b-fresh',
      wrap.wrapKeyHex,
      { accountId: ACCOUNT_ID },
    );
    assert.equal(pullFresh.ok, true);
    const dec = openaiSync.decryptOpenAiApiKeyBlob(wrap.wrapKeyHex, pullFresh.blob);
    assert.equal(dec.openaiApiKey, testKey);
  });
});
