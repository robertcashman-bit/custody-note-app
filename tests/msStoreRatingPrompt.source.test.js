const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

describe('Microsoft Store rating prompt wiring', () => {
  it('loads renderer module from index.html', () => {
    assert.ok(indexHtml.includes('renderer/ms-store-rating-prompt.js'));
  });

  it('schedules prompt only after returning to the records list', () => {
    assert.ok(appJs.includes('scheduleMsStoreRatingPromptAfterList'));
    assert.ok(appJs.includes('setListFilterAndShowList(filter)'));
    assert.match(appJs, /setListFilterAndShowList[\s\S]*scheduleMsStoreRatingPromptAfterList/);
  });

  it('exposes eligibility IPC and store detection in main/preload', () => {
    assert.ok(mainJs.includes("ipcMain.handle('ms-store-rating-eligibility'"));
    assert.ok(mainJs.includes('detectMsStoreBuildRuntime'));
    assert.ok(preloadJs.includes('msStoreRatingEligibility'));
  });
});
