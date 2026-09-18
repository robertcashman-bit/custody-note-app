'use strict';

/**
 * Hostile-cloud sync pull guard + exfil resistance (Mac + Windows parity).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validatePullResponse,
  validatePullRecordShell,
  bindDecryptedPullPayload,
  buildSyncAuthHeaders,
  hasExplicitUserConfirmation,
  looksLikePlaintextJsonEnvelope,
} = require('../lib/syncPullGuard');
const { encryptSyncEnvelope, decryptSyncEnvelope } = require('../lib/syncRecordCrypto');
const {
  writeRestrictedFile,
  assertPathInsideAllowedRoots,
  FILE_MODE_OWNER_RW,
} = require('../lib/secureLocalFiles');
const {
  evaluateAccessToken,
  applyIssuedTokens,
  clearSessionTokens,
  revokeSessionTokens,
} = require('../lib/cloudAuthSession');
const {
  sanitizeNoteBodyForDisplay,
  looksLikeHtmlMarkup,
} = require('../lib/noteDisplaySanitize');

describe('syncPullGuard — hostile cloud', () => {
  it('rejects non-object and non-ok responses', () => {
    assert.equal(validatePullResponse(null).ok, false);
    assert.equal(validatePullResponse({ ok: false }).ok, false);
    assert.equal(validatePullResponse({ ok: true, records: {} }).ok, false);
  });

  it('rejects cross-account licence / account echoes', () => {
    const badKey = validatePullResponse(
      { ok: true, records: [], licenceKey: 'OTHER-KEY' },
      { expectedLicenceKey: 'MY-KEY' }
    );
    assert.equal(badKey.ok, false);
    assert.equal(badKey.code, 'CROSS_ACCOUNT_LICENCE');

    const badAcct = validatePullResponse(
      { ok: true, records: [], accountId: 'acct-b' },
      { expectedAccountId: 'acct-a' }
    );
    assert.equal(badAcct.ok, false);
    assert.equal(badAcct.code, 'CROSS_ACCOUNT_ID');
  });

  it('rejects oversized batches', () => {
    const records = Array.from({ length: 501 }, (_, i) => ({ syncId: 'id-' + i }));
    const r = validatePullResponse({ ok: true, records });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'BATCH_TOO_LARGE');
  });

  it('rejects plaintext records and plaintext JSON envelopes', () => {
    assert.equal(
      validatePullRecordShell({ syncId: 'sync-abcdefgh', data: '{"x":1}' }).ok,
      false
    );
    assert.equal(
      validatePullRecordShell({
        syncId: 'sync-abcdefgh',
        envelope: JSON.stringify({ data: 'x' }),
      }).code,
      'PLAINTEXT_ENVELOPE_REJECTED'
    );
    assert.equal(looksLikePlaintextJsonEnvelope('{"a":1}'), true);
  });

  it('accepts encrypted envelope shells with valid syncId', () => {
    const key = crypto.randomBytes(32).toString('hex');
    const envelope = encryptSyncEnvelope(key, { data: '{}', status: 'draft', syncId: 'sync-abcdefgh' });
    const shell = validatePullRecordShell({
      syncId: 'sync-abcdefgh',
      envelope,
      version: 2,
    });
    assert.equal(shell.ok, true);
    assert.equal(shell.version, 2);
  });

  it('binds decrypted syncId and rejects mismatch', () => {
    const ok = bindDecryptedPullPayload(
      { data: '{}', status: 'draft', syncId: 'sync-abcdefgh' },
      'sync-abcdefgh'
    );
    assert.equal(ok.ok, true);
    const bad = bindDecryptedPullPayload(
      { data: '{}', syncId: 'sync-otherxxxx' },
      'sync-abcdefgh'
    );
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'SYNC_ID_MISMATCH');
  });

  it('buildSyncAuthHeaders binds bearer + licence', () => {
    const h = buildSyncAuthHeaders({
      authToken: 'tok-abc',
      licenceKey: 'cn-test',
      accountId: 'u1',
      correlationId: 'c1',
    });
    assert.equal(h.Authorization, 'Bearer tok-abc');
    assert.equal(h['X-Custody-Licence'], 'CN-TEST');
    assert.equal(h['X-Custody-Account'], 'u1');
    assert.equal(h['X-Correlation-Id'], 'c1');
  });

  it('requires explicit confirmation for dump-style IPC', () => {
    assert.equal(hasExplicitUserConfirmation(null), false);
    assert.equal(hasExplicitUserConfirmation({}), false);
    assert.equal(hasExplicitUserConfirmation({ confirmed: true }), true);
  });
});

describe('syncRecordCrypto — fail closed on plaintext', () => {
  it('rejects plaintext JSON by default (hostile cloud)', () => {
    const key = crypto.randomBytes(32).toString('hex');
    assert.equal(decryptSyncEnvelope(key, '{"data":"x"}'), null);
  });

  it('allows legacy plaintext only with explicit opt-in', () => {
    const key = crypto.randomBytes(32).toString('hex');
    const decoded = decryptSyncEnvelope(key, '{"data":"x"}', { allowLegacyPlaintext: true });
    assert.equal(decoded.data, 'x');
  });

  it('round-trips CNSYNC envelopes', () => {
    const key = crypto.randomBytes(32).toString('hex');
    const payload = { data: '{}', status: 'draft', syncId: 'sync-abcdefgh' };
    const env = encryptSyncEnvelope(key, payload);
    assert.deepEqual(decryptSyncEnvelope(key, env), payload);
  });
});

describe('secureLocalFiles — Win+Mac path', () => {
  it('writes restricted files and gates paths under allowed roots', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-secfiles-'));
    const file = path.join(dir, 'secret.dat');
    writeRestrictedFile(file, 'secret', { encoding: 'utf8' });
    assert.ok(fs.existsSync(file));
    if (process.platform !== 'win32') {
      const mode = fs.statSync(file).mode & 0o777;
      assert.equal(mode, FILE_MODE_OWNER_RW);
    }
    const inside = assertPathInsideAllowedRoots(file, [dir]);
    assert.equal(inside.allowed, true);
    const outside = assertPathInsideAllowedRoots(path.join(os.tmpdir(), 'other', 'x'), [dir]);
    assert.equal(outside.allowed, false);
  });
});

describe('cloudAuthSession — short-lived tokens + revoke', () => {
  it('fails closed on expired access tokens', () => {
    const r = evaluateAccessToken({
      authToken: 'abc',
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    assert.equal(r.usable, false);
    assert.equal(r.reason, 'expired');
  });

  it('applyIssuedTokens stamps expiry; clearSessionTokens removes secrets', () => {
    const data = {};
    applyIssuedTokens(data, { accessToken: 'a', refreshToken: 'r', expiresIn: 60 }, { now: 1_000_000 });
    assert.equal(data.authToken, 'a');
    assert.ok(data.tokenExpiresAt);
    clearSessionTokens(data);
    assert.equal(data.authToken, undefined);
    assert.equal(data.refreshToken, undefined);
  });

  it('revokeSessionTokens always clears local even if remote fails', async () => {
    const data = { authToken: 'a', refreshToken: 'r' };
    const out = await revokeSessionTokens(data, {
      apiUrl: 'https://custodynote.com',
      httpPost: async () => { throw new Error('offline'); },
    });
    assert.equal(out.localCleared, true);
    assert.equal(data.authToken, undefined);
  });
});

describe('noteDisplaySanitize', () => {
  it('escapes script tags in note bodies', () => {
    const html = sanitizeNoteBodyForDisplay('<script>alert(1)</script>Advice');
    assert.equal(html.includes('<script>'), false);
    assert.ok(html.includes('&lt;script&gt;'));
    assert.equal(looksLikeHtmlMarkup('<img onerror=x>'), true);
  });
});

describe('security hardening source tripwires (Mac+Windows shared)', () => {
  const root = path.join(__dirname, '..');
  function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  }

  it('main BrowserWindow sets webSecurity true with sandbox + contextIsolation', () => {
    const src = read('main.js');
    assert.match(src, /webSecurity:\s*true/);
    assert.match(src, /contextIsolation:\s*true/);
    assert.match(src, /sandbox:\s*true/);
    assert.match(src, /nodeIntegration:\s*false/);
  });

  it('sync pull uses auth-bound headers and pull guard', () => {
    const src = read('main.js');
    assert.ok(src.includes('buildSyncAuthHeaders'));
    assert.ok(src.includes('validatePullResponse'));
    assert.ok(src.includes('validatePullRecordShell'));
    assert.ok(src.includes('hasExplicitUserConfirmation'));
  });

  it('full resync and export index require confirmation', () => {
    const main = read('main.js');
    assert.ok(main.includes("ipcMain.handle('sync-full-resync'"));
    assert.ok(main.includes('CONFIRMATION_REQUIRED'));
    const app = read('app.js');
    assert.ok(app.includes('syncFullResync({ confirmed: true })'));
    assert.ok(app.includes('syncExportRecordIndex({ confirmed: true })'));
  });

  it('packaged builds refuse --dump-record', () => {
    const src = read('main.js');
    assert.ok(src.includes('--dump-record is disabled in packaged builds'));
  });

  it('updater fails closed on signature/checksum errors', () => {
    const src = read('updater.js');
    assert.ok(src.includes('isSignatureTamperError'));
    assert.ok(src.includes('SIGNATURE_TAMPER') || src.includes('Fail-closed'));
  });

  it('sync worker pushes with auth headers and syncId in envelope', () => {
    const src = read('main/syncWorker.js');
    assert.ok(src.includes('buildSyncAuthHeaders'));
    assert.ok(src.includes('syncId: row.sync_id'));
  });
});
