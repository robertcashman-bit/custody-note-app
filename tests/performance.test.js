const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '..', 'app.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');
const mainJsPath = path.join(__dirname, '..', 'main.js');
const mainJsSource = fs.readFileSync(mainJsPath, 'utf8');
const stylesCssPath = path.join(__dirname, '..', 'styles.css');
const stylesCssSource = fs.readFileSync(stylesCssPath, 'utf8');
const indexHtmlPath = path.join(__dirname, '..', 'index.html');
const indexHtmlSource = fs.readFileSync(indexHtmlPath, 'utf8');
const syncWorkerPath = path.join(__dirname, '..', 'main', 'syncWorker.js');
const syncWorkerSource = fs.readFileSync(syncWorkerPath, 'utf8');

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

  it('configures calmer backup scheduler timings', () => {
    assert.ok(mainJsSource.includes('quickMinIntervalMs: 15 * 60 * 1000'),
      'main.js should set a 15 minute quick backup interval');
    assert.ok(mainJsSource.includes('userIdleGraceMs: 45 * 1000'),
      'main.js should defer backups until the user is idle for 45 seconds');
    assert.ok(mainJsSource.includes('periodicCheckMs: 3 * 60 * 1000'),
      'main.js should reduce periodic backup checks to every 3 minutes');
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

describe('Performance — footer and status rendering', () => {
  it('uses grouped footer chips instead of separator-heavy footer text', () => {
    assert.ok(indexHtmlSource.includes('class="footer-meta"'), 'index.html should group footer meta');
    assert.ok(indexHtmlSource.includes('class="footer-status-group"'), 'index.html should group footer statuses');
    assert.ok(indexHtmlSource.includes('class="footer-action-btn footer-chip"'),
      'check updates action should render as a footer chip');
  });

  it('uses shared footer indicator helper for compact status chips', () => {
    assert.ok(appJsSource.includes("function setFooterIndicator("),
      'app.js should centralize footer chip rendering');
    assert.ok(appJsSource.includes("setFooterIndicator(netStatusEl, online ? 'Online' : 'Offline'"),
      'network status should use compact chip wording');
  });

  it('does not poll backup status every 30 seconds anymore', () => {
    assert.ok(!appJsSource.includes('setInterval(updateBackupStatus, 30000)'),
      'must remove 30 second backup polling');
    assert.ok(appJsSource.includes("setInterval(function() { updateBackupStatus(); }, 180000)"),
      'must use a calmer 3 minute backup fallback poll');
  });
});

describe('Performance — sync cadence', () => {
  it('slows idle sync polling to 60 seconds', () => {
    assert.ok(syncWorkerSource.includes('const SYNC_POLL_INTERVAL_MS = 60000'),
      'sync worker should use a 60 second idle poll interval');
  });
});

describe('Performance — scrolling', () => {
  it('does not apply smooth scrolling globally', () => {
    assert.ok(!stylesCssSource.includes('* { scroll-behavior: smooth; }'),
      'styles.css must not force global smooth scrolling');
  });

  it('does not pin will-change on the main form scroll container', () => {
    assert.ok(!stylesCssSource.includes('will-change: scroll-position'),
      'styles.css should not permanently hint scroll-position changes');
  });
});
