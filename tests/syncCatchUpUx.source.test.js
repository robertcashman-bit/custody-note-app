'use strict';

/**
 * Static wiring checks for sell-ready sync catch-up UX.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

describe('sync catch-up UX wiring', () => {
  it('exposes bulk resolve + catch-up + fix-now IPC in main and preload', () => {
    assert.match(mainJs, /sync-conflicts-resolve-bulk/);
    assert.match(mainJs, /sync-stale-catch-up/);
    assert.match(mainJs, /sync-fix-now/);
    assert.match(mainJs, /maybeRunStaleDeviceCatchUp/);
    assert.match(preloadJs, /syncConflictsResolveBulk/);
    assert.match(preloadJs, /syncStaleCatchUp/);
    assert.match(preloadJs, /syncFixNow/);
    assert.match(preloadJs, /onSyncCatchUpProgress/);
  });

  it('conflict modal has bulk Accept all remote / Keep all local / Use cloud for all', () => {
    assert.match(appJs, /cn-conflicts-accept-all/);
    assert.match(appJs, /cn-conflicts-keep-all/);
    assert.match(appJs, /Use cloud for all remaining/);
    assert.match(appJs, /syncConflictsResolveBulk/);
    assert.match(appJs, /runFixSyncNow/);
  });

  it('home banners exist for catch-up progress and success', () => {
    assert.match(indexHtml, /home-sync-catch-up-banner/);
    assert.match(indexHtml, /home-sync-catch-up-progress/);
    assert.match(indexHtml, /Caught up with other devices/);
  });

  it('never auto keep_local floods in catch-up runner', () => {
    const runner = fs.readFileSync(path.join(root, 'main/staleSyncCatchUpRunner.js'), 'utf8');
    assert.match(runner, /Does NOT auto keep_local/);
    assert.doesNotMatch(runner, /resolveConflict\([^)]*'keep_local'/);
  });
});
