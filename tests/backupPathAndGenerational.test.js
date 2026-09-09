'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  assessBackupPathUsability,
  planBackupFolderReset,
} = require('../lib/backupPathSanitize');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

describe('backup path cross-platform sanitize', () => {
  it('rejects Mac userData path on Windows', () => {
    const a = assessBackupPathUsability(
      '/Users/robertcashman/Library/Application Support/custody-note/Backups',
      { platform: 'win32' }
    );
    assert.strictEqual(a.usable, false);
    assert.strictEqual(a.reason, 'unix_path_on_windows');
  });

  it('rejects Windows drive path on darwin', () => {
    const a = assessBackupPathUsability('C:\\Users\\Robert\\AppData\\Roaming\\custody-note\\Backups', {
      platform: 'darwin',
    });
    assert.strictEqual(a.usable, false);
    assert.strictEqual(a.reason, 'windows_path_on_unix');
  });

  it('plans reset to local default after foreign-OS restore', () => {
    const plan = planBackupFolderReset({
      storedPath: '/Users/robertcashman/Library/Application Support/custody-note/Backups',
      defaultPath: 'C:\\Users\\Robert\\AppData\\Roaming\\custody-note\\Backups',
      platform: 'win32',
      canCreate: () => true,
    });
    assert.strictEqual(plan.reset, true);
    assert.ok(plan.next.includes('AppData') || plan.next.includes('custody-note'));
  });

  it('keeps usable local path', () => {
    const plan = planBackupFolderReset({
      storedPath: 'C:\\Users\\Robert\\AppData\\Roaming\\custody-note\\Backups',
      defaultPath: 'C:\\Users\\Robert\\AppData\\Roaming\\custody-note\\Backups',
      platform: 'win32',
      canCreate: () => true,
    });
    assert.strictEqual(plan.reset, false);
  });
});

describe('generational quick backups + visible degradation', () => {
  it('quick backup writes attendance-quick generational files', () => {
    assert.match(mainJs, /attendance-quick-/);
    assert.match(mainJs, /pruneOldQuickBackups/);
    assert.match(mainJs, /MAX_QUICK_BACKUPS/);
    assert.match(mainJs, /generationalQuick:\s*true/);
  });

  it('quick min interval is ~2 minutes (not 15)', () => {
    const sched = fs.readFileSync(path.join(__dirname, '..', 'main', 'backupScheduler.js'), 'utf8');
    assert.match(sched, /2 \* 60 \* 1000/);
    assert.doesNotMatch(sched, /quickMinIntervalMs \|\| 15 \* 60 \* 1000/);
  });

  it('skipped/failed backup notifies renderer (no silent skip)', () => {
    assert.match(mainJs, /_notifyBackupDegraded/);
    assert.match(mainJs, /backup-degraded/);
    assert.match(preloadJs, /onBackupDegraded/);
    assert.match(appJs, /home-backup-degraded/);
    assert.match(indexHtml, /home-backup-degraded/);
  });

  it('Settings exposes effective backup paths and open-folder', () => {
    assert.match(mainJs, /effectiveBackupFolder/);
    assert.match(mainJs, /backup-open-folder/);
    assert.match(preloadJs, /backupOpenFolder/);
    assert.match(indexHtml, /setting-backup-open-folder/);
    assert.match(indexHtml, /settings-backup-effective-meta/);
    assert.match(appJs, /refreshBackupEffectivePaths/);
  });

  it('ensureBackupPathsSane runs on initDb', () => {
    assert.match(mainJs, /function ensureBackupPathsSane/);
    const initIdx = mainJs.indexOf('async function initDb');
    const chunk = mainJs.slice(initIdx, initIdx + 6000);
    assert.match(chunk, /ensureBackupPathsSane/);
  });
});
