'use strict';

/**
 * Parity: Anywhere file bridge must stay shared on Mac + Windows —
 * same preload API, same IPC channels, no platform-gated handlers.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const freemiumSrc = fs.readFileSync(path.join(ROOT, 'renderer/freemiumFeatures.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

describe('anywhere bridge — cross-platform parity surface', () => {
  it('preload exposes import and export choose APIs', () => {
    assert.match(preloadSrc, /anywhereBridgeChooseAndImport:/);
    assert.match(preloadSrc, /anywhereBridgeChooseAndExport:/);
    assert.match(preloadSrc, /anywhere-bridge:choose-and-import/);
    assert.match(preloadSrc, /anywhere-bridge:choose-and-export/);
  });

  it('main registers shared IPC handlers without platform gates', () => {
    assert.match(mainSrc, /ipcMain\.handle\('anywhere-bridge:choose-and-import'/);
    assert.match(mainSrc, /ipcMain\.handle\('anywhere-bridge:choose-and-export'/);
    assert.match(mainSrc, /ipcMain\.handle\('anywhere-bridge:import'/);
    const exportBlock = mainSrc.slice(
      mainSrc.indexOf("ipcMain.handle('anywhere-bridge:choose-and-export'"),
      mainSrc.indexOf("ipcMain.handle('anywhere-bridge:choose-and-export'") + 1200
    );
    assert.doesNotMatch(exportBlock, /process\.platform|win32|darwin/);
  });

  it('settings UI wires both Import and Export without Pro upsell', () => {
    assert.match(htmlSrc, /btn-anywhere-bridge-import/);
    assert.match(htmlSrc, /btn-anywhere-bridge-export/);
    assert.doesNotMatch(
      htmlSrc.slice(htmlSrc.indexOf('anywhere-bridge-section'), htmlSrc.indexOf('anywhere-bridge-section') + 900),
      /Pro path|Subscribe|Lemon/
    );
    assert.match(freemiumSrc, /anywhereBridgeChooseAndImport/);
    assert.match(freemiumSrc, /anywhereBridgeChooseAndExport/);
  });
});
