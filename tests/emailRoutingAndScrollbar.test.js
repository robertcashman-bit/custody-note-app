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
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

/* ── Copy-and-paste email (v1.6.21: no Outlook IPC) ─── */

describe('Email routing — copy-and-paste only (v1.6.21)', () => {
  it('email-modal is copy-and-paste only (no Open-in-Outlook buttons, no openExternal)', () => {
    /* v1.6.20: the Quick Email modal lost its "Open in Outlook" /
       "Open in Outlook Web" buttons. The user copies + pastes into
       Outlook themselves. Forbid every launch-side hook from creeping
       back in. */
    assert.ok(!emailModalJs.includes('email-oic-open-mailto'), 'mailto open button must be removed');
    assert.ok(!emailModalJs.includes('email-oic-open-app'), 'OWA open button must be removed');
    assert.ok(!emailModalJs.includes('_wireOpenDraft'), '_wireOpenDraft helper must be removed');
    assert.ok(!emailModalJs.includes('window.openEmailDraft'), 'modal must not call window.openEmailDraft');
    assert.ok(!emailModalJs.includes('openOutlookEmail'), 'no api.openOutlookEmail fallback');
    assert.ok(!emailModalJs.includes('mailto:'), 'email-modal must not contain mailto:');
    assert.ok(
      (emailModalJs.match(/window\.api\.openExternal/g) || []).length === 0,
      'email-modal must not call openExternal'
    );
    /* The copy + save-template + mark-sent surface stays. */
    assert.ok(emailModalJs.includes('email-oic-copy"'), 'Copy Email button must remain');
    assert.ok(emailModalJs.includes('email-oic-copy-subject'), 'Copy Subject button must be present');
    assert.ok(emailModalJs.includes('email-oic-mark-sent'), 'Mark Sent button must remain');
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

  it('app.js uses clipboard copy for contact/share/LAA email (no invokeOutlookWebCompose)', () => {
    assert.ok(appJs.includes('function copyOutlookComposeFields('), 'copyOutlookComposeFields must exist');
    assert.ok(!appJs.includes('invokeOutlookWebCompose'), 'invokeOutlookWebCompose removed in v1.6.21');
    assert.ok(!appJs.includes('function openOutlookWebCompose('), 'openOutlookWebCompose removed');
  });

  it('index.html loads pending-draft globals only (no outlook-invoke or draft-open scripts)', () => {
    assert.ok(indexHtml.includes('renderer/email-pending-globals.js'));
    assert.ok(!indexHtml.includes('renderer/email-draft-open.js'));
    assert.ok(!indexHtml.includes('renderer/outlook-email-invoke.js'));
  });

  it('main process does not expose Outlook compose IPC; mailto still blocked in open-external', () => {
    assert.ok(!mainJs.includes("ipcMain.handle('open-outlook-email'"), 'open-outlook-email IPC removed');
    assert.ok(!mainJs.includes("require('./main/openOutlookWebEmail')"));
    assert.ok(!mainJs.includes("ipcMain.handle('detect-outlook-desktop'"));
    assert.ok(!mainJs.includes("ipcMain.handle('open-email-send-trace'"));
    assert.ok(mainJs.includes("u.toLowerCase().startsWith('mailto:')"), 'mailto blocked in open-external');
  });

  it('preload does not expose emailAPI bridge', () => {
    assert.ok(!preloadJs.includes("exposeInMainWorld('emailAPI'"), 'emailAPI bridge removed');
    assert.ok(!preloadJs.includes('open-email-send-trace'));
    assert.ok(preloadJs.includes("exposeInMainWorld('CustodyEmailCompose'"), 'template merge bridge remains');
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

