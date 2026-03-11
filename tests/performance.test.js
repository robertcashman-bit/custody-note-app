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

  it('autosave interval is 15 seconds (not 10)', () => {
    assert.ok(appJsSource.includes('setInterval(quietSave, 15000)'), 'autoSaveTimer should be 15000ms');
    assert.ok(!appJsSource.includes('setInterval(quietSave, 10000)'), 'autoSaveTimer must not be 10000ms');
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
  it('uses single-line footer with grouped status chips', () => {
    assert.ok(indexHtmlSource.includes('class="footer-row"'), 'index.html should use single footer-row');
    assert.ok(indexHtmlSource.includes('class="footer-status-group"'), 'index.html should group footer statuses');
    assert.ok(!indexHtmlSource.includes('class="footer-line1"'), 'footer-line1 should be removed');
    assert.ok(!indexHtmlSource.includes('class="footer-line2"'), 'footer-line2 should be removed');
  });

  it('does not include build date or check-for-updates button in footer', () => {
    assert.ok(!indexHtmlSource.includes('home-check-update-btn'),
      'footer must not have home-check-update-btn element');
    const footerStart = indexHtmlSource.indexOf('<footer class="app-footer">');
    const footerEnd = indexHtmlSource.indexOf('</footer>', footerStart);
    const footerHtml = indexHtmlSource.substring(footerStart, footerEnd);
    assert.ok(!footerHtml.includes('>Build <span'), 'footer must not show build date');
  });

  it('uses shared footer indicator helper for compact status chips', () => {
    assert.ok(appJsSource.includes("function setFooterIndicator("),
      'app.js should centralize footer chip rendering');
    assert.ok(appJsSource.includes("setFooterIndicator(netStatusEl, online ? 'Online' : 'Offline'"),
      'network status should use compact chip wording');
  });

  it('backup status is event-driven only (no polling)', () => {
    assert.ok(!appJsSource.includes('setInterval(updateBackupStatus'),
      'must not poll backup status on an interval');
    assert.ok(!appJsSource.includes("setInterval(function() { updateBackupStatus"),
      'must not use setInterval wrapper for backup status');
    assert.ok(appJsSource.includes('onBackupStatusChanged'),
      'must use event-driven backup status updates');
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

  it('chrome-collapse uses transform/opacity instead of max-height for scroll perf', () => {
    assert.ok(stylesCssSource.includes('.chrome-collapsed .section-index-bar'),
      'chrome-collapsed section-index-bar rule must exist');
    assert.ok(stylesCssSource.includes('.chrome-collapsed .form-context-bar'),
      'chrome-collapsed form-context-bar rule must exist');
    const idxStart = stylesCssSource.indexOf('.chrome-collapsed .section-index-bar');
    const idxBlock = stylesCssSource.substring(idxStart, idxStart + 200);
    assert.ok(idxBlock.includes('transform: translateY'), 'collapse must use transform, not max-height');
    assert.ok(!idxBlock.includes('max-height: 0'), 'collapse must not use max-height animation');
  });

  it('scroll handler uses passive listener and requestAnimationFrame', () => {
    assert.ok(appJsSource.includes("{ passive: true }"),
      'scroll listener must use passive: true');
    assert.ok(appJsSource.includes('_chromeTicking'),
      'scroll handler must use rAF throttle via _chromeTicking');
  });
});

describe('Performance — compact bottom bar', () => {
  it('bottom buttons use compact sizing', () => {
    const baseStart = stylesCssSource.indexOf('.bottom-btn {');
    const baseBlock = stylesCssSource.substring(baseStart, stylesCssSource.indexOf('}', baseStart) + 1);
    assert.ok(baseBlock.includes('min-height: 30px'),
      'bottom-btn base rule min-height should be 30px');
    assert.ok(!baseBlock.match(/min-height:\s*4[48]px/),
      'bottom-btn base rule must not use 44-48px min-height');
  });

  it('bottom buttons do not use transition: all', () => {
    const btnStart = stylesCssSource.indexOf('.bottom-btn {');
    const btnBlock = stylesCssSource.substring(btnStart, btnStart + 300);
    assert.ok(!btnBlock.includes('transition: all'),
      'bottom-btn must not transition all properties (causes layout thrash)');
  });

  it('bottom buttons do not use gradient backgrounds', () => {
    const nextStart = stylesCssSource.indexOf('.bottom-btn.next-btn');
    const nextBlock = stylesCssSource.substring(nextStart, nextStart + 200);
    assert.ok(!nextBlock.includes('linear-gradient'),
      'primary bottom buttons should use flat color, not gradients');
  });

  it('progress dots are compact (7px or smaller)', () => {
    const dotStart = stylesCssSource.indexOf('.section-progress-bar .prog-dot {');
    const dotBlock = stylesCssSource.substring(dotStart, dotStart + 150);
    const widthMatch = dotBlock.match(/width:\s*(\d+)px/);
    assert.ok(widthMatch, 'prog-dot must have width in px');
    assert.ok(parseInt(widthMatch[1]) <= 8, 'prog-dot width should be 8px or less');
  });

  it('HTML buttons use short labels', () => {
    assert.ok(!indexHtmlSource.includes('>&#9783; Sections</button>'),
      'sections button should not have long "Sections" label');
    assert.ok(indexHtmlSource.includes('title="Jump to section"'),
      'sections button should have a tooltip');
    assert.ok(indexHtmlSource.includes('title="Save and exit (Ctrl+S)"'),
      'save button should show keyboard shortcut in tooltip');
  });
});

describe('Voluntary form and outcome statuses', () => {

  it('custody caseOutcomeStatus includes officer_to_notify and referred_to_cps', () => {
    const custodyOutcome = appJsSource.match(/id:\s*'outcome'[\s\S]*?caseOutcomeStatus[\s\S]*?options:\s*\[([^\]]+)\]/);
    assert.ok(custodyOutcome, 'custody outcome section must exist');
    const opts = custodyOutcome[1];
    assert.ok(opts.includes("'officer_to_notify'"), 'custody must include officer_to_notify');
    assert.ok(opts.includes("'referred_to_cps'"), 'custody must include referred_to_cps');
  });

  it('voluntary caseOutcomeStatus includes officer_to_notify and referred_to_cps', () => {
    const volOutcome = appJsSource.match(/id:\s*'volOutcome'[\s\S]*?caseOutcomeStatus[\s\S]*?options:\s*\[([^\]]+)\]/);
    assert.ok(volOutcome, 'voluntary outcome section must exist');
    const opts = volOutcome[1];
    assert.ok(opts.includes("'officer_to_notify'"), 'voluntary must include officer_to_notify');
    assert.ok(opts.includes("'referred_to_cps'"), 'voluntary must include referred_to_cps');
  });

  it('voluntary caseOutcomeStatus does NOT include bail_to_return', () => {
    const volOutcome = appJsSource.match(/id:\s*'volOutcome'[\s\S]*?caseOutcomeStatus[\s\S]*?options:\s*\[([^\]]+)\]/);
    assert.ok(volOutcome, 'voluntary outcome section must exist');
    assert.ok(!volOutcome[1].includes("'bail_to_return'"), 'voluntary must not include bail_to_return');
  });

  it('voluntary form includes client personal detail fields', () => {
    const start = appJsSource.indexOf("id: 'volMatterSetup'");
    const end = appJsSource.indexOf("id: 'volStatusRights'");
    assert.ok(start > 0 && end > start, 'volMatterSetup section must exist');
    const section = appJsSource.substring(start, end);
    assert.ok(section.includes("'clientPhone'"), 'voluntary must have clientPhone');
    assert.ok(section.includes("'clientEmail'"), 'voluntary must have clientEmail');
    assert.ok(section.includes("'address1'"), 'voluntary must have address1');
    assert.ok(section.includes("'niNumber'"), 'voluntary must have niNumber');
    assert.ok(section.includes("'nationality'"), 'voluntary must have nationality');
    assert.ok(section.includes("'gender'"), 'voluntary must have gender');
  });

  it('voluntary form includes firm contact fields', () => {
    const start = appJsSource.indexOf("id: 'volMatterSetup'");
    const end = appJsSource.indexOf("id: 'volStatusRights'");
    assert.ok(start > 0 && end > start, 'volMatterSetup section must exist');
    const section = appJsSource.substring(start, end);
    assert.ok(section.includes("'firmContactName'"), 'voluntary must have firmContactName');
    assert.ok(section.includes("'firmContactPhone'"), 'voluntary must have firmContactPhone');
    assert.ok(section.includes("'firmContactEmail'"), 'voluntary must have firmContactEmail');
  });

  it('voluntary aftercare does NOT include bailDate', () => {
    const volAftercare = appJsSource.match(/id:\s*'volAftercare'[\s\S]*?fields:\s*\[([\s\S]*?)\]\s*,?\s*\}/);
    assert.ok(volAftercare, 'volAftercare section must exist');
    assert.ok(!volAftercare[1].includes("'bailDate'"), 'voluntary aftercare must not have bailDate');
  });

  it('home screen has prominent primary cards for custody and voluntary', () => {
    assert.ok(indexHtmlSource.includes('home-primary-actions'), 'home must have primary actions container');
    assert.ok(indexHtmlSource.includes('home-primary-custody'), 'home must have primary custody card');
    assert.ok(indexHtmlSource.includes('home-primary-voluntary'), 'home must have primary voluntary card');
  });
});
