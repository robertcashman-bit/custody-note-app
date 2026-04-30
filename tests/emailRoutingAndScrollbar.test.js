const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const emailModalJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'email-modal.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const billingJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'billing.js'), 'utf8');
const settingsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'settings.js'), 'utf8');

/* ── Custom scrollbar ──────────────────────────────────────── */

describe('Custom form scrollbar', () => {
  it('uses a custom scrollbar element on the form view', () => {
    assert.ok(appJs.includes('function ensureCustomFormScrollbar()'),
      'ensureCustomFormScrollbar must exist');
    assert.ok(appJs.includes("rail.id = 'form-custom-scrollbar'"),
      'custom scrollbar rail id must be created');
    assert.ok(stylesCss.includes('.form-custom-scrollbar'),
      'styles for custom scrollbar must exist');
  });

  it('hides the native attendance-form scrollbar', () => {
    assert.ok(stylesCss.includes('scrollbar-width: none !important;'),
      'attendance-form should hide native scrollbar in Firefox');
    assert.ok(stylesCss.includes('.attendance-form::-webkit-scrollbar { width: 0 !important; height: 0 !important; }'),
      'attendance-form should hide native scrollbar in WebKit');
  });

  it('track uses overflow:hidden to clip any thumb shadow (prevents reflection artifact)', () => {
    const trackIdx = stylesCss.indexOf('.form-custom-scrollbar-track');
    assert.ok(trackIdx > -1, 'track rule must exist');
    // Grab the content of the track rule block
    const trackBlock = stylesCss.slice(trackIdx, stylesCss.indexOf('}', trackIdx) + 1);
    assert.ok(trackBlock.includes('overflow: hidden') || trackBlock.includes('overflow:hidden'),
      'scrollbar track must have overflow:hidden to clip thumb shadow inside the rail');
  });

  it('thumb no longer has the old outward shadow that caused the reflection', () => {
    // The original shadow was "0 2px 8px rgba(15, 23, 42, 0.35)" — a positive Y-offset
    // shadow that leaked below the thumb and looked like a ghost/reflection.
    // It should have been removed or replaced with an inset-only shadow.
    const thumbIdx = stylesCss.indexOf('.form-custom-scrollbar-thumb {');
    assert.ok(thumbIdx > -1, 'thumb rule must exist');
    const thumbBlock = stylesCss.slice(thumbIdx, stylesCss.indexOf('}', thumbIdx) + 1);
    assert.ok(!thumbBlock.includes('0 2px 8px'),
      'old outward drop-shadow "0 2px 8px" should be removed from the thumb');
    // If a box-shadow is present, it should use the inset keyword
    if (thumbBlock.includes('box-shadow')) {
      assert.ok(thumbBlock.includes('inset'),
        'any remaining box-shadow on the thumb should use "inset" so it does not bleed outside');
    }
  });
});

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const openOutlookModule = fs.readFileSync(path.join(__dirname, '..', 'main', 'openOutlookWebEmail.js'), 'utf8');
const outlookUrlLib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'outlookWebComposeUrl.js'), 'utf8');

/* ── Outlook Web only (no mailto / no default mail client) ─── */

describe('Outlook Web email routing', () => {
  it('email-modal uses _invokeOutlookEmail → invokeOutlookWebCompose only', () => {
    assert.ok(emailModalJs.includes('function _invokeOutlookEmail'),
      'email-modal must define _invokeOutlookEmail');
    assert.ok(emailModalJs.includes('invokeOutlookWebCompose'), 'must use invokeOutlookWebCompose');
    assert.ok(!emailModalJs.includes('openOutlookEmail'), 'no api.openOutlookEmail fallback');
    assert.ok(!emailModalJs.includes('mailto:'), 'email-modal must not contain mailto:');
    assert.ok(
      (emailModalJs.match(/window\.api\.openExternal/g) || []).length === 0,
      'email-modal must not call openExternal'
    );
  });

  it('email-modal exports openQuickEmailModal (Records — quick email to officer)', () => {
    assert.ok(emailModalJs.includes('function openQuickEmailModal'),
      'openQuickEmailModal must exist for list toolbar');
    assert.ok(emailModalJs.includes('window.openQuickEmailModal'),
      'must assign openQuickEmailModal on window');
    assert.ok(emailModalJs.includes('openEmailModal(null'),
      'quick path opens modal without record id');
  });

  it('index.html includes Records toolbar + optional home quick-email card', () => {
    assert.ok(indexHtml.includes('id="list-quick-email-btn"'));
    assert.ok(indexHtml.includes('id="home-card-quick-email"'));
    assert.ok(indexHtml.includes('Quick email to officer'));
  });

  it('app.js updateAddonUIs controls list-quick-email-btn visibility', () => {
    assert.ok(appJs.includes('list-quick-email-btn'));
    assert.ok(appJs.includes('showQuickOfficerEmail'));
  });

  it('app.js openOutlookWebCompose uses invokeOutlookWebCompose only', () => {
    const fnIdx = appJs.indexOf('function openOutlookWebCompose(');
    assert.ok(fnIdx > -1, 'openOutlookWebCompose must exist');
    const fnBody = appJs.slice(fnIdx, fnIdx + 1200);
    assert.ok(fnBody.includes('invokeOutlookWebCompose'), 'must use invokeOutlookWebCompose');
    assert.ok(!fnBody.includes('openOutlookEmail'), 'no api.openOutlookEmail');
    assert.ok(!fnBody.includes('mailto:'), 'no mailto in openOutlookWebCompose');
  });

  it('bundled email-send-trace ships with app and Help opens it via IPC', () => {
    const tracePath = path.join(__dirname, '..', 'deployment', 'email-send-trace.txt');
    assert.ok(fs.existsSync(tracePath), 'deployment/email-send-trace.txt must exist');
    const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    assert.ok(preloadJs.includes('open-email-send-trace'), 'preload invokes open-email-send-trace');
    assert.ok(mainJs.includes("ipcMain.handle('open-email-send-trace'"), 'main registers handler');
    assert.ok(mainJs.includes('syncEmailSendTraceToUserData'), 'startup sync copies trace to userData');
    assert.ok(indexHtml.includes('help-open-email-send-trace'), 'Help button');
    assert.ok(indexHtml.includes('officerOpenEmailSendTraceBtn'), 'Officer Emails Testing button');
  });

  it('main process exposes open-outlook-email and blocks mailto in open-external', () => {
    assert.ok(mainJs.includes("ipcMain.handle('open-outlook-email'"), 'IPC handler present');
    assert.ok(mainJs.includes("require('./main/openOutlookWebEmail')"), 'delegates to module');
    assert.ok(openOutlookModule.includes('const launchUrl = url'), 'OWA opens as plain HTTPS compose URL');
    assert.ok(!openOutlookModule.includes("'microsoft-edge:' + url"), 'Windows must not wrap OWA with microsoft-edge:');
    assert.ok(outlookUrlLib.includes('outlook.office.com'), 'OWA host in lib/outlookWebComposeUrl.js');
    assert.ok(outlookUrlLib.includes('/mail/deeplink/compose'), 'OWA compose route in lib/outlookWebComposeUrl.js');
    assert.ok(mainJs.includes("u.toLowerCase().startsWith('mailto:')"), 'mailto blocked in open-external');
  });

  it('email-templates.js has no mailto or multi-client builders', () => {
    const tpl = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'email-templates.js'), 'utf8');
    assert.ok(!tpl.includes('mailto:'), 'email-templates must not contain mailto');
    assert.ok(!tpl.includes('buildEmailClientUrl'), 'buildEmailClientUrl removed');
  });

  it('billing panel does not embed firm email compose flow', () => {
    assert.ok(!billingJs.includes('billing-email-open'));
    assert.ok(!billingJs.includes('Prepare Email to Firm'));
  });

  it('settings.js no longer saves preferredEmailClient', () => {
    assert.ok(!settingsJs.includes('preferredEmailClient'), 'preferredEmailClient removed from settings.js');
  });
});

