'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const analyticsMd = fs.readFileSync(path.join(ROOT, 'docs', 'ANALYTICS.md'), 'utf8');

describe('usage heartbeat wiring (source)', () => {
  it('posts to /api/stats/heartbeat and not trial-started for the daily ping', () => {
    assert.match(mainJs, /reportUsageHeartbeatToServer/);
    assert.match(mainJs, /scheduleUsageHeartbeat/);
    assert.match(mainJs, /\/api\/stats\/heartbeat/);
    assert.match(mainJs, /usageHeartbeat/);
    assert.match(mainJs, /HEARTBEAT_STATE_FILE|cn-usage-heartbeat\.json/);
  });

  it('is packaged-only, deferred, retries, and stamps only after success', () => {
    assert.match(mainJs, /function reportUsageHeartbeatToServer/);
    const fnStart = mainJs.indexOf('function reportUsageHeartbeatToServer');
    assert.ok(fnStart > 0);
    const fnBody = mainJs.slice(fnStart, fnStart + 2200);
    assert.match(fnBody, /app\.isPackaged/);
    assert.match(fnBody, /postStatsWithRetry/);
    assert.match(fnBody, /getStatsNetPost\(\)/);
    assert.match(fnBody, /onSuccess:/);
    assert.doesNotMatch(fnBody, /writeLastHeartbeatAt[\s\S]{0,120}postStatsWithRetry/);
    assert.doesNotMatch(fnBody, /postFn:\s*httpPost/);

    const scheduleStart = mainJs.indexOf('function scheduleUsageHeartbeat');
    assert.ok(scheduleStart > 0);
    const scheduleBody = mainJs.slice(scheduleStart, scheduleStart + 900);
    assert.match(scheduleBody, /deferAfterWebContentsLoad|HEARTBEAT_RECHECK_INTERVAL_MS/);
    assert.match(scheduleBody, /setInterval/);

    assert.match(mainJs, /scheduleUsageHeartbeat\(mainWindow\)/);
  });

  it('retries trial-started and records sentAt only after success', () => {
    const trialStart = mainJs.indexOf('function reportTrialStartedToServer');
    assert.ok(trialStart > 0);
    const trialBody = mainJs.slice(trialStart, trialStart + 1800);
    assert.match(trialBody, /TRIAL_STARTED_STATE_FILE/);
    assert.match(trialBody, /postStatsWithRetry/);
    assert.match(trialBody, /getStatsNetPost\(\)/);
    assert.match(trialBody, /writeTrialStartedSentAt/);
    assert.doesNotMatch(trialBody, /postFn:\s*httpPost/);
  });

  it('uses Electron net for stats POST (system proxy)', () => {
    assert.match(mainJs, /createStatsNetPost/);
    assert.match(mainJs, /main\/statsNetPost/);
    assert.match(mainJs, /reconcileTrialStartedPendingFlag/);
    const statusStart = mainJs.indexOf("ipcMain.handle('licence:status'");
    assert.ok(statusStart > 0);
    const statusChunk = mainJs.slice(statusStart, statusStart + 3500);
    assert.doesNotMatch(statusChunk, /writeLicenceData\(data\);\s*\n\s*reportTrialStartedToServer/);
  });

  it('documents the heartbeat in ANALYTICS.md', () => {
    assert.match(analyticsMd, /usage_heartbeat/);
    assert.match(analyticsMd, /\/api\/stats\/heartbeat/);
    assert.match(analyticsMd, /machineId/);
    assert.match(analyticsMd, /unique machines/i);
    assert.match(analyticsMd, /Do \*\*not\*\* reuse `trial-started`/);
  });
});
