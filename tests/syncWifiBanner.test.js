'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const W = require('../lib/syncWifiBanner');
const { deriveSaveSyncButton, STATES, PENDING_TOOLTIP } = require('../lib/saveSyncButton');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function clock(start) {
  let t = start || 1_000_000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('Wi-Fi sync banner copy', () => {
  it('uses the approved wording exactly', () => {
    assert.equal(W.BOLD, 'Saved on this computer.');
    assert.equal(W.BODY, "Police station Wi-Fi often blocks sync. Your notes will sync once you're on your own Wi-Fi or a phone hotspot.");
    assert.equal(W.TEXT, W.BOLD + ' ' + W.BODY);
  });

  it('the Save & Sync tooltip uses the same text while sync is pending', () => {
    assert.equal(PENDING_TOOLTIP, W.TEXT);
    const pending = deriveSaveSyncButton({ noteDurable: true, backupOk: true, centralConfirmed: false, pullOk: false, pendingCount: 1 });
    assert.equal(pending.state, STATES.PENDING);
    assert.equal(pending.title, W.TEXT);
    const offline = deriveSaveSyncButton({ noteDurable: true, backupOk: true, centralConfirmed: false, offline: true, pendingCount: 1 });
    assert.equal(offline.title, W.TEXT);
    const synced = deriveSaveSyncButton({ noteDurable: true, backupOk: true, centralConfirmed: true, pullOk: true, pendingCount: 0 });
    assert.notEqual(synced.title, W.TEXT);
    const local = deriveSaveSyncButton({ noteDurable: true, backupOk: true, localOnly: true });
    assert.notEqual(local.title, W.TEXT, 'local-only keys never get the Wi-Fi tooltip');
  });

  it('index.html has the bar under the top bar with bold lead, Don\'t show again link, and a settings toggle', () => {
    const headerEnd = indexHtml.indexOf('</header>');
    const bar = indexHtml.indexOf('id="sync-wifi-banner"');
    const main = indexHtml.indexOf('<main class="app-main">');
    assert.ok(headerEnd > 0 && bar > headerEnd && bar < main, 'banner sits directly under the top bar');
    assert.match(indexHtml, /id="sync-wifi-banner"[^>]*\shidden>/, 'hidden by default');
    assert.match(indexHtml, /<strong>Saved on this computer\.<\/strong> Police station Wi-Fi often blocks sync\. Your notes will sync once you're on your own Wi-Fi or a phone hotspot\./);
    assert.match(indexHtml, /id="sync-wifi-banner-dismiss"[^>]*>Don't show again</);
    assert.match(indexHtml, /id="setting-show-wifi-sync-banner"/);
    assert.ok(indexHtml.indexOf('src="lib/syncWifiBanner.js"') < indexHtml.indexOf('src="app.js"'));
    assert.match(appJs, /SyncWifiBanner\.DISMISS_STORAGE_KEY/);
    assert.match(appJs, /localStorage\.setItem\(key, '1'\)/);
  });
});

describe('Wi-Fi sync banner show/hide rules', () => {
  it('stays hidden while sync has been pending for under 60 seconds, then shows', () => {
    const c0 = clock();
    const c = W.createController({ now: c0.now });
    c.setAccountSnapshot({ enabled: true, pendingCaseCount: 1, key: 'CN-ABC' });
    let r = c.evaluate();
    assert.equal(r.show, false);
    assert.equal(r.msUntilShow, 60000);
    c0.advance(59_000);
    assert.equal(c.evaluate().show, false);
    c0.advance(1_000);
    r = c.evaluate();
    assert.equal(r.show, true);
    assert.equal(r.reason, 'pending');
  });

  it('open-note pending alone also starts the clock; saving does not reset it', () => {
    const c0 = clock();
    const c = W.createController({ now: c0.now });
    c.setNotePending(true);
    c0.advance(30_000);
    c.setNotePending(true);
    c0.advance(31_000);
    assert.equal(c.evaluate().show, true);
  });

  it('shows immediately when a sync attempt fails with a network error', () => {
    for (const ev of [
      { status: 'error', lastError: 'fetch failed', retryable: true },
      { status: 'error', lastError: 'getaddrinfo ENOTFOUND custodynote.com' },
      { status: 'error', lastError: 'connect ETIMEDOUT 76.76.21.21:443' },
      { status: 'error', lastError: 'unable to verify the first certificate' },
      { status: 'error', lastSyncSkipReason: 'offline', lastError: 'offline' },
      { status: 'error', lastSyncSkipReason: 'api_unreachable', lastError: 'x' },
    ]) {
      const c = W.createController({ now: clock().now });
      c.noteSyncEvent(ev);
      const r = c.evaluate();
      assert.equal(r.show, true, JSON.stringify(ev));
      assert.equal(r.reason, 'network');
    }
  });

  it('does not show for licence/auth/device/quota/rate-limit errors', () => {
    for (const ev of [
      { status: 'error', authRequired: true, lastSyncSkipReason: 'auth_required', lastError: 'Invalid licence key' },
      { status: 'error', lastError: 'Invalid licence key (network check passed)' },
      { status: 'error', lastError: 'A licence key is required' },
      { status: 'device_revoked', deviceRevoked: true, lastSyncSkipReason: 'device_revoked', lastError: 'network' },
      { status: 'device_not_activated', lastSyncSkipReason: 'device_not_activated', lastError: 'DEVICE_NOT_ACTIVATED' },
      { status: 'free_quota_exceeded', freeQuotaExceeded: true, lastError: 'FREE_QUOTA_EXCEEDED' },
      { status: 'rate_limited', rateLimited: true, lastSyncSkipReason: 'rate_limited', lastError: 'Too many requests' },
      { status: 'error', lastSyncSkipReason: 'in_progress', lastError: 'sync already in progress' },
      { status: 'error', lastError: 'Server error 400: Missing sync envelope' },
    ]) {
      const c = W.createController({ now: clock().now });
      c.noteSyncEvent(ev);
      assert.equal(c.evaluate().show, false, JSON.stringify(ev));
    }
  });

  it('an auth failure also suppresses the 60-second pending path', () => {
    const c0 = clock();
    const c = W.createController({ now: c0.now });
    c.setAccountSnapshot({ enabled: true, pendingCaseCount: 3, authRequired: true, connectivity: 'auth_required' });
    c0.advance(120_000);
    assert.equal(c.evaluate().show, false);
  });

  it('never shows for FREE-/TRIAL- keys that never sync', () => {
    for (const key of ['FREE-1234-ABCD', 'TRIAL-9999', 'free-lower']) {
      const c0 = clock();
      const c = W.createController({ now: c0.now });
      c.setLicence({ key, status: 'active' });
      c.setAccountSnapshot({ enabled: true, pendingCaseCount: 2 });
      c.noteSyncEvent({ status: 'error', lastError: 'fetch failed' });
      c0.advance(300_000);
      assert.equal(c.evaluate().show, false, key);
    }
    const local = W.createController({ now: clock().now });
    local.setAccountSnapshot({ enabled: true, localOnly: true, connectivity: 'local_only', pendingCaseCount: 1 });
    local.noteSyncEvent({ status: 'error', lastError: 'network' });
    assert.equal(local.evaluate().show, false);
    const disabled = W.createController({ now: clock().now });
    disabled.setAccountSnapshot({ enabled: false, pendingCaseCount: 1 });
    disabled.noteSyncEvent({ status: 'error', lastError: 'network' });
    assert.equal(disabled.evaluate().show, false);
    // Signed-in free accounts (CNF- keys) do sync, so they do get the warning.
    const cnf = W.createController({ now: clock().now });
    cnf.setLicence({ key: 'CNF-ABCD-1234', tier: 'free', signInWithAccount: true });
    cnf.noteSyncEvent({ status: 'error', lastError: 'fetch failed' });
    assert.equal(cnf.evaluate().show, true);
  });

  it('disappears automatically when sync succeeds', () => {
    const c0 = clock();
    const c = W.createController({ now: c0.now });
    c.setAccountSnapshot({ enabled: true, pendingCaseCount: 1 });
    c.noteSyncEvent({ status: 'error', lastError: 'socket hang up' });
    c0.advance(90_000);
    assert.equal(c.evaluate().show, true);
    c.noteSyncEvent({ status: 'synced', lastSync: new Date().toISOString() });
    assert.equal(c.evaluate().show, false);
    c.setAccountSnapshot({ enabled: true, pendingCaseCount: 0 });
    c0.advance(600_000);
    assert.equal(c.evaluate().show, false);
  });

  it('a skipped cycle reported as synced (heal/in-progress) does not hide the warning', () => {
    const c = W.createController({ now: clock().now });
    c.noteSyncEvent({ status: 'error', lastError: 'ECONNRESET' });
    c.noteSyncEvent({ status: 'synced', lastSyncSkipReason: 'heal_pending' });
    assert.equal(c.evaluate().show, true);
    c.noteSyncEvent({ status: 'synced', lastSyncSkipReason: 'ok_pushed' });
    assert.equal(c.evaluate().show, false);
  });

  it("Don't show again hides it, and turning it back on shows it again", () => {
    const c = W.createController({ now: clock().now, dismissed: false });
    c.noteSyncEvent({ status: 'error', lastError: 'network timeout' });
    assert.equal(c.evaluate().show, true);
    c.setDismissed(true);
    const r = c.evaluate();
    assert.equal(r.show, false);
    assert.equal(r.reason, 'dismissed');
    c.setDismissed(false);
    assert.equal(c.evaluate().show, true);
    const persisted = W.createController({ now: clock().now, dismissed: true });
    persisted.noteSyncEvent({ status: 'error', lastError: 'fetch failed' });
    assert.equal(persisted.evaluate().show, false);
  });
});
