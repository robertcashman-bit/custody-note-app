/**
 * Integration/source tests for the QuickFile connection status panel & reliability.
 *
 * Confirms:
 *  - main.js exposes a DB-backed `quickfile-connection-state` IPC (reliable, not browser state);
 *  - a failed health check is recorded but NEVER overwrites the saved credentials;
 *  - preload bridges it; index.html renders a status panel with reconnect guidance;
 *  - app.js derives the state via the shared helper and refreshes after a test.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const HTML = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

describe('QuickFile connection reliability (main process)', () => {
  it('adds a DB-backed quickfile-connection-state IPC', () => {
    assert.ok(MAIN.includes("ipcMain.handle('quickfile-connection-state'"), 'IPC handler missing');
    assert.ok(MAIN.includes('quickfileLastConnectionOkAt'), 'must return last-success timestamp');
    assert.ok(MAIN.includes('quickfileLastConnectionError'), 'must return last error');
  });

  it('persists the result of the real health check (test-connection)', () => {
    assert.ok(MAIN.includes('recordQuickFileConnectionResult'), 'helper missing');
    assert.ok(/recordQuickFileConnectionResult\(true/.test(MAIN), 'must record success');
    assert.ok(/recordQuickFileConnectionResult\(false/.test(MAIN), 'must record failure');
  });

  it('never writes the credential keys when recording a connection result (no corruption on failure)', () => {
    const start = MAIN.indexOf('function recordQuickFileConnectionResult');
    const end = MAIN.indexOf('ipcMain.handle(\'quickfile-test-connection\'');
    assert.ok(start > -1 && end > start);
    const body = MAIN.slice(start, end);
    assert.ok(!body.includes('quickfileAccountNumber'), 'must not touch account number');
    assert.ok(!body.includes('quickfileApiKey'), 'must not touch API key');
    assert.ok(!body.includes('quickfileAppId'), 'must not touch application id');
  });
});

describe('QuickFile connection panel (renderer)', () => {
  it('preload bridges quickfileConnectionState', () => {
    assert.ok(PRELOAD.includes('quickfileConnectionState'));
    assert.ok(PRELOAD.includes("ipcRenderer.invoke('quickfile-connection-state')"));
  });

  it('index.html includes the status panel and loads the shared helper', () => {
    assert.ok(HTML.includes('id="qf-connection-status"'), 'status panel missing');
    assert.ok(HTML.includes('renderer/lib/quickfileConnectionState.js'), 'helper script not loaded');
    assert.ok(/this computer only/i.test(HTML), 'must explain per-machine credential storage');
  });

  it('app.js renders the panel via the shared derivation helper and refreshes after a test', () => {
    assert.ok(APP.includes('refreshQuickFileConnectionPanel'), 'render function missing');
    assert.ok(APP.includes('QuickFileConnectionState.deriveQuickFileConnectionState'), 'must use shared helper');
  });
});
