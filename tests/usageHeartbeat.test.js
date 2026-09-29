'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STATE_FILE,
  TRIAL_STARTED_STATE_FILE,
  ALLOWED_PAYLOAD_KEYS,
  shouldSendHeartbeat,
  buildHeartbeatPayload,
  resolveAnalyticsTier,
  payloadIsPrivacySafe,
  readLastHeartbeatAt,
  writeLastHeartbeatAt,
  readTrialStartedSentAt,
  writeTrialStartedSentAt,
  shouldAttemptTrialStartedPing,
  postStatsWithRetry,
  deferAfterWebContentsLoad,
} = require('../main/usageHeartbeat');

describe('usageHeartbeat gate', () => {
  const now = Date.parse('2026-08-31T12:00:00.000Z');

  it('sends when lastHeartbeatAt is missing', () => {
    assert.equal(shouldSendHeartbeat(null, now), true);
    assert.equal(shouldSendHeartbeat(undefined, now), true);
    assert.equal(shouldSendHeartbeat('', now), true);
  });

  it('sends when lastHeartbeatAt is unparseable', () => {
    assert.equal(shouldSendHeartbeat('not-a-date', now), true);
  });

  it('sends when lastHeartbeatAt is older than 24h', () => {
    const staleIso = new Date(now - HEARTBEAT_INTERVAL_MS - 1).toISOString();
    const staleMs = now - HEARTBEAT_INTERVAL_MS - 1000;
    assert.equal(shouldSendHeartbeat(staleIso, now), true);
    assert.equal(shouldSendHeartbeat(staleMs, now), true);
  });

  it('skips when lastHeartbeatAt is within 24h', () => {
    const recentIso = new Date(now - HEARTBEAT_INTERVAL_MS + 60_000).toISOString();
    const recentMs = now - 1000;
    assert.equal(shouldSendHeartbeat(recentIso, now), false);
    assert.equal(shouldSendHeartbeat(recentMs, now), false);
    assert.equal(shouldSendHeartbeat(now, now), false);
  });

  it('sends exactly at the 24h boundary', () => {
    assert.equal(shouldSendHeartbeat(now - HEARTBEAT_INTERVAL_MS, now), true);
  });
});

describe('usageHeartbeat payload', () => {
  it('builds only machineId, platform, appVersion, tier', () => {
    const machineId = crypto.createHash('sha256').update('host|linux|x64|cpu|mem').digest('hex').slice(0, 32);
    const payload = buildHeartbeatPayload({
      machineId,
      platform: 'linux',
      appVersion: '1.9.80',
      tier: 'pro',
      email: 'should-not-appear@example.com',
      ufn: 'UFN123',
      licenceKey: 'CN-AAAA-BBBB-CCCC-DDDD',
      clientName: 'Secret Client',
    });
    assert.deepEqual(Object.keys(payload).sort(), [...ALLOWED_PAYLOAD_KEYS].sort());
    assert.equal(payload.machineId, machineId);
    assert.equal(payload.platform, 'linux');
    assert.equal(payload.appVersion, '1.9.80');
    assert.equal(payload.tier, 'pro');
    assert.equal(payload.email, undefined);
    assert.equal(payload.ufn, undefined);
    assert.equal(payload.licenceKey, undefined);
    assert.equal(payload.clientName, undefined);
    assert.equal(payloadIsPrivacySafe(payload), true);
  });

  it('defaults missing tier to none and requires hashed machineId', () => {
    const bad = buildHeartbeatPayload({
      machineId: 'hostname-not-hashed',
      platform: 'win32',
      appVersion: '1.9.80',
    });
    assert.equal(bad.tier, 'none');
    assert.equal(payloadIsPrivacySafe(bad), false);

    const goodId = 'a'.repeat(32);
    const good = buildHeartbeatPayload({
      machineId: goodId,
      platform: 'darwin',
      appVersion: '1.9.80',
      tier: 'free',
    });
    assert.equal(payloadIsPrivacySafe(good), true);
  });

  it('coerces invalid tier values to none', () => {
    const payload = buildHeartbeatPayload({
      machineId: 'b'.repeat(32),
      platform: 'win32',
      appVersion: '1.9.80',
      tier: 'enterprise',
    });
    assert.equal(payload.tier, 'none');
  });
});

describe('resolveAnalyticsTier', () => {
  it('maps admin and cloud-backup users to pro', () => {
    assert.equal(resolveAnalyticsTier({ tier: 'free', isAdmin: true }, {}), 'pro');
    assert.equal(
      resolveAnalyticsTier(
        { tier: 'trial' },
        { cachedCloudBackup: true, cachedCloudBackupAt: new Date().toISOString() }
      ),
      'pro'
    );
    const staleAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(
      resolveAnalyticsTier({ tier: 'trial' }, { cachedCloudBackup: true, cachedCloudBackupAt: staleAt }),
      'trial'
    );
    assert.equal(resolveAnalyticsTier({ tier: 'pro' }, {}), 'pro');
  });

  it('falls back to licence key shape', () => {
    assert.equal(resolveAnalyticsTier(null, { key: 'FREE-ABC' }), 'free');
    assert.equal(resolveAnalyticsTier(null, { key: 'TRIAL-ABC' }), 'trial');
    assert.equal(resolveAnalyticsTier(null, { key: 'CN-AAAA-BBBB' }), 'pro');
  });
});

describe('usageHeartbeat persistence', () => {
  it('reads and writes lastHeartbeatAt under a local stamp file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-heartbeat-'));
    const stampPath = path.join(dir, HEARTBEAT_STATE_FILE);
    assert.equal(readLastHeartbeatAt(stampPath, fs), null);

    const at = '2026-08-31T10:00:00.000Z';
    writeLastHeartbeatAt(stampPath, fs, at);
    assert.equal(readLastHeartbeatAt(stampPath, fs), at);
    assert.equal(shouldSendHeartbeat(readLastHeartbeatAt(stampPath, fs), Date.parse('2026-08-31T12:00:00.000Z')), false);
    assert.equal(shouldSendHeartbeat(readLastHeartbeatAt(stampPath, fs), Date.parse('2026-09-01T11:00:00.000Z')), true);
  });

  it('tracks trial-started one-shot sentAt separately', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-trial-'));
    const sentPath = path.join(dir, TRIAL_STARTED_STATE_FILE);
    assert.equal(readTrialStartedSentAt(sentPath, fs), null);
    writeTrialStartedSentAt(sentPath, fs, '2026-09-01T00:00:00.000Z');
    assert.equal(readTrialStartedSentAt(sentPath, fs), '2026-09-01T00:00:00.000Z');
  });
});

describe('shouldAttemptTrialStartedPing', () => {
  it('skips when already sent', () => {
    assert.equal(shouldAttemptTrialStartedPing({ key: 'FREE-X' }, '2026-01-01'), false);
  });

  it('retries only while trialStartedPending is set', () => {
    assert.equal(shouldAttemptTrialStartedPing({ key: 'FREE-X', trialStartedPending: true }, null), true);
    assert.equal(shouldAttemptTrialStartedPing({ key: 'TRIAL-X' }, null), false);
    assert.equal(shouldAttemptTrialStartedPing({ key: 'CN-PRO', trialStartedPending: true }, null), true);
    assert.equal(shouldAttemptTrialStartedPing({ key: 'FREE-X' }, '2026-01-01'), false);
  });
});

describe('postStatsWithRetry', () => {
  it('calls onSuccess only after postFn succeeds', async () => {
    let calls = 0;
    let stamped = false;
    const ok = await postStatsWithRetry({
      postFn: async () => {
        calls += 1;
        if (calls < 2) throw new Error('offline');
        return {};
      },
      url: 'https://custodynote.com/api/stats/heartbeat',
      body: { machineId: 'c'.repeat(32), platform: 'win32', appVersion: '1.0.0', tier: 'free' },
      retryDelaysMs: [0, 0],
      onSuccess: () => {
        stamped = true;
      },
    });
    assert.equal(ok, true);
    assert.equal(calls, 2);
    assert.equal(stamped, true);
  });

  it('does not call onSuccess when all attempts fail', async () => {
    let stamped = false;
    const ok = await postStatsWithRetry({
      postFn: async () => {
        throw new Error('fail');
      },
      url: 'https://example.com/x',
      body: {},
      retryDelaysMs: [0],
      onSuccess: () => {
        stamped = true;
      },
    });
    assert.equal(ok, false);
    assert.equal(stamped, false);
  });
});

describe('deferAfterWebContentsLoad', () => {
  it('runs immediately when webContents is not loading', async () => {
    let ran = false;
    deferAfterWebContentsLoad(
      {
        isDestroyed: () => false,
        isLoading: () => false,
        once: () => {
          throw new Error('should not attach listener');
        },
      },
      0,
      () => {
        ran = true;
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(ran, true);
  });

  it('waits for did-finish-load when still loading', async () => {
    let handler = null;
    let ran = false;
    deferAfterWebContentsLoad(
      {
        isDestroyed: () => false,
        isLoading: () => true,
        once: (_ev, fn) => {
          handler = fn;
        },
      },
      0,
      () => {
        ran = true;
      }
    );
    assert.equal(ran, false);
    assert.equal(typeof handler, 'function');
    handler();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(ran, true);
  });
});
