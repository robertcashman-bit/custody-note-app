const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '..', 'app.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');
const mainJsPath = path.join(__dirname, '..', 'main.js');
const mainJsSource = fs.readFileSync(mainJsPath, 'utf8');

describe('Performance — typing path', () => {

  it('uses single UI refresh debounce (scheduleUIRefresh) instead of multiple timers', () => {
    assert.ok(appJsSource.includes('scheduleUIRefresh'), 'app.js must use scheduleUIRefresh');
    assert.ok(appJsSource.includes('UI_REFRESH_DEBOUNCE_MS'), 'must define UI_REFRESH_DEBOUNCE_MS');
    assert.ok(appJsSource.includes('_uiRefreshDebounce'), 'must use single _uiRefreshDebounce');
  });

  it('section change handler does NOT call scheduleCollect or collectCurrentData', () => {
    const attachIdx = appJsSource.indexOf('function attachSectionListeners');
    assert.ok(attachIdx !== -1, 'attachSectionListeners must exist');
    const changeHandlerStart = appJsSource.indexOf("el.addEventListener('change'", attachIdx);
    assert.ok(changeHandlerStart !== -1, 'change listener must exist');
    const block = appJsSource.substring(changeHandlerStart, changeHandlerStart + 2200);
    assert.ok(!block.includes('scheduleCollect()'), 'change handler must not call scheduleCollect');
    assert.ok(!block.includes('collectCurrentData()'), 'change handler must not call collectCurrentData on every change');
  });

  it('section blur handler does NOT call collectCurrentData', () => {
    const attachIdx = appJsSource.indexOf('function attachSectionListeners');
    const blurIdx = appJsSource.indexOf("el.addEventListener('blur'", attachIdx);
    assert.ok(blurIdx !== -1, 'blur listener must exist');
    const blurBlock = appJsSource.substring(blurIdx, blurIdx + 350);
    assert.ok(!blurBlock.includes('collectCurrentData()'), 'blur must not call collectCurrentData (only scheduleQuietSave)');
  });

  it('scheduleQuietSave debounces reportEditorActivity', () => {
    assert.ok(appJsSource.includes('_editorActivityDebounceTimer'), 'must debounce editor activity');
    assert.ok(appJsSource.includes('EDITOR_ACTIVITY_DEBOUNCE_MS'), 'must define editor activity debounce');
  });

  it('autosave debounce is 800–1200ms', () => {
    assert.ok(appJsSource.includes('QUIET_SAVE_DEBOUNCE_MS = 1200'), 'QUIET_SAVE_DEBOUNCE_MS should be 1200');
  });
});

describe('Performance — list rendering', () => {

  it('refreshList caches parsed data per row (getParsed)', () => {
    assert.ok(appJsSource.includes('getParsed(r)'), 'refreshList must use getParsed for per-row cache');
    assert.ok(appJsSource.includes('parsedCache[r.id]'), 'must cache by r.id');
    assert.ok(appJsSource.includes('parsedCache[r.id] = safeJson(r.data)'), 'cache must store safeJson(r.data)');
  });
});

describe('Performance — main process', () => {

  it('attendance-save skips expensive audit diff for draft saves', () => {
    const handlerStart = mainJsSource.indexOf("ipcMain.handle('attendance-save'");
    assert.ok(handlerStart !== -1, 'attendance-save handler must exist');
    const block = mainJsSource.substring(handlerStart, handlerStart + 4500);
    const diffCondition = block.indexOf("existing && st === 'finalised'");
    assert.ok(diffCondition !== -1, 'audit diff must only run when existing && st === finalised');
  });

  it('has composite index for list query', () => {
    assert.ok(mainJsSource.includes('idx_att_list'), 'must have idx_att_list index');
    assert.ok(mainJsSource.includes('deleted_at, archived_at, updated_at'), 'index must cover list filter columns');
  });
});

describe('Performance — progress bar', () => {

  it('updateProgressBar does not call buildSectionIndexBar (avoids rebuild on every keystroke)', () => {
    const upbStart = appJsSource.indexOf('function updateProgressBar()');
    assert.ok(upbStart !== -1, 'updateProgressBar must exist');
    const bodyWindow = appJsSource.substring(upbStart, upbStart + 1200);
    assert.ok(!bodyWindow.includes('buildSectionIndexBar()'), 'updateProgressBar must not call buildSectionIndexBar');
  });
});
