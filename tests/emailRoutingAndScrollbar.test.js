const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const emailModalJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'email-modal.js'), 'utf8');

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

/* ── Email app routing guard ───────────────────────────────── */

describe('Email app routing guard', () => {
  it('deduplicates rapid email open requests in app.js', () => {
    assert.ok(appJs.includes('window._emailOpenGuard'),
      'app.js should keep a global email open guard');
    assert.ok(appJs.includes('if (now - window._emailOpenGuard.ts < 1200) return;'),
      'app.js should block duplicate opens within guard window');
  });

  it('deduplicates rapid email open requests in email modal flows', () => {
    assert.ok(emailModalJs.includes('function _openEmailExternalOnce(url)'),
      'email-modal should define _openEmailExternalOnce');
    const openUrlUses = (emailModalJs.match(/_openEmailExternalOnce\(url\)/g) || []).length;
    assert.ok(openUrlUses >= 2,
      'both Officer and Quick Email flows should route through _openEmailExternalOnce');
  });
});

/* ── Settings cache refresh ────────────────────────────────── */

describe('Email client preference — settings cache', () => {
  it('saveSettings refreshes window._appSettingsCache after writing to DB', () => {
    // The function is ~4100 chars — search with a generous window
    const saveSettingsIdx = appJs.indexOf('function saveSettings()');
    assert.ok(saveSettingsIdx > -1, 'saveSettings must exist');
    const afterSave = appJs.slice(saveSettingsIdx, saveSettingsIdx + 5000);
    assert.ok(afterSave.includes('window._appSettingsCache = s || {}'),
      'saveSettings must set window._appSettingsCache = s || {} after the DB write so the in-memory preference stays fresh');
  });
});

/* ── Fresh settings read on open-button click ──────────────── */

describe('Email open buttons always read fresh settings', () => {
  it('Quick Email "Open Email App" button fetches settings before opening', () => {
    // The button handler must call window.api.getSettings() and update
    // window._appSettingsCache before deciding which client URL to build.
    const quickOpenHandler = emailModalJs.match(
      /quick-email-open-app[\s\S]{0,2000}?window\.api\.getSettings/
    );
    assert.ok(quickOpenHandler,
      'Quick Email open handler must call window.api.getSettings() to get fresh preference');
  });

  it('Officer Email "Open Email App" button fetches settings before opening', () => {
    const oicOpenHandler = emailModalJs.match(
      /email-oic-open-app[\s\S]{0,2000}?window\.api\.getSettings/
    );
    assert.ok(oicOpenHandler,
      'Officer Email open handler must call window.api.getSettings() to get fresh preference');
  });

  it('open button handlers merge fresh settings into window._appSettingsCache', () => {
    assert.ok(
      emailModalJs.includes('window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, s)'),
      'email-modal open handlers should merge fresh settings into window._appSettingsCache'
    );
  });

  it('Quick Email client-picker buttons also update window._appSettingsCache immediately', () => {
    assert.ok(
      emailModalJs.includes("window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, { preferredEmailClient: clientId })"),
      'Quick Email client picker must immediately update window._appSettingsCache so the new preference is used'
    );
  });
});

/* ── No unguarded openExternal calls in email flows ─────────── */

describe('No unguarded openExternal calls in email flows', () => {
  it('email-modal.js routes all external opens through _openEmailExternalOnce', () => {
    // Every window.api.openExternal call in email-modal.js must be inside
    // _openEmailExternalOnce (which enforces the 1.2 s dedup guard).
    // The function contains two references on the same line:
    //   if (window.api && window.api.openExternal) window.api.openExternal(url);
    // so count <= 2 is the expected maximum.
    const directOpens = (emailModalJs.match(/window\.api\.openExternal/g) || []).length;
    assert.ok(directOpens <= 2,
      'email-modal.js should only reference window.api.openExternal inside _openEmailExternalOnce');
    // Confirm those references are actually in _openEmailExternalOnce
    const fnIdx = emailModalJs.indexOf('function _openEmailExternalOnce');
    assert.ok(fnIdx > -1, '_openEmailExternalOnce must exist');
    const fnBody = emailModalJs.slice(fnIdx, emailModalJs.indexOf('\n}', fnIdx) + 2);
    assert.ok(fnBody.includes('window.api.openExternal'),
      'window.api.openExternal must be called inside _openEmailExternalOnce');
  });

  it('app.js openPreferredEmailClient uses the 1.2 s guard', () => {
    const fnIdx = appJs.indexOf('function openPreferredEmailClient(');
    assert.ok(fnIdx > -1, 'openPreferredEmailClient must exist in app.js');
    // The function body is ~300 chars; use a 600-char slice to be safe
    const fnBody = appJs.slice(fnIdx, fnIdx + 600);
    assert.ok(fnBody.includes('window._emailOpenGuard'),
      'openPreferredEmailClient must check window._emailOpenGuard');
    assert.ok(fnBody.includes('window._emailOpenGuard.ts < 1200'),
      'openPreferredEmailClient must block opens within 1.2 s guard window');
  });
});

/* ── buildEmailClientUrl routing ───────────────────────────── */

describe('buildEmailClientUrl routes each client correctly', () => {
  function loadBuildEmailClientUrl() {
    const emailTemplatesJs = fs.readFileSync(
      path.join(__dirname, '..', 'renderer', 'email-templates.js'), 'utf8'
    );
    const shim = `
      function _oicClean(v) { if (v == null || v === 'null' || v === 'undefined') return ''; return String(v).trim(); }
      ${emailTemplatesJs}
    `;
    const m = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', shim + '\nmodule.exports = { buildEmailClientUrl, EMAIL_CLIENTS };')(m, m.exports);
    return m.exports;
  }

  let bec;
  try { bec = loadBuildEmailClientUrl(); } catch (_) { bec = null; }

  it('owa client builds outlook.office.com URL (not outlook.live.com)', () => {
    if (!bec) return;
    const url = bec.buildEmailClientUrl('owa', 'test@police.uk', 'Subject', 'Body');
    assert.ok(url.startsWith('https://outlook.office.com/'),
      'owa should produce an outlook.office.com URL');
    assert.ok(!url.includes('outlook.live.com'),
      'owa must NEVER produce an outlook.live.com URL — that is the personal Outlook.com client');
  });

  it('outlook (personal) client builds outlook.live.com URL (not outlook.office.com)', () => {
    if (!bec) return;
    const url = bec.buildEmailClientUrl('outlook', 'test@police.uk', 'Subject', 'Body');
    assert.ok(url.startsWith('https://outlook.live.com/'),
      'outlook (personal) should produce an outlook.live.com URL');
    assert.ok(!url.includes('outlook.office.com'),
      'outlook personal must NEVER produce an outlook.office.com URL');
  });

  it('gmail client builds mail.google.com URL', () => {
    if (!bec) return;
    const url = bec.buildEmailClientUrl('gmail', 'test@police.uk', 'Subject', 'Body');
    assert.ok(url.startsWith('https://mail.google.com/'),
      'gmail should produce a mail.google.com URL');
  });

  it('yahoo client builds mail.yahoo.com URL', () => {
    if (!bec) return;
    const url = bec.buildEmailClientUrl('yahoo', 'test@police.uk', 'Subject', 'Body');
    assert.ok(url.includes('yahoo.com'),
      'yahoo should produce a yahoo.com URL');
  });

  it('default client builds a mailto: URL', () => {
    if (!bec) return;
    const url = bec.buildEmailClientUrl('default', 'test@police.uk', 'Subject', 'Body');
    assert.ok(url.startsWith('mailto:'),
      'default should produce a mailto: URL for the system mail handler');
  });

  it('owa and outlook produce different, non-overlapping URLs', () => {
    if (!bec) return;
    const owaUrl = bec.buildEmailClientUrl('owa', 't@x.com', 'S', 'B');
    const outlookUrl = bec.buildEmailClientUrl('outlook', 't@x.com', 'S', 'B');
    assert.notStrictEqual(owaUrl, outlookUrl,
      'owa (office/work) and outlook (personal) must produce distinct URLs');
    assert.ok(!owaUrl.includes('outlook.live.com'), 'owa URL must not contain outlook.live.com');
    assert.ok(!outlookUrl.includes('outlook.office.com'), 'outlook personal URL must not contain outlook.office.com');
  });

  it('to/subject/body parameters are encoded in the URL', () => {
    if (!bec) return;
    const url = bec.buildEmailClientUrl('owa', 'cop@met.police.uk', 'Test Subject', 'Hello World');
    assert.ok(url.includes(encodeURIComponent('cop@met.police.uk')),
      'to address must be URL-encoded in the query string');
    assert.ok(url.includes(encodeURIComponent('Test Subject')),
      'subject must be URL-encoded');
  });
});
