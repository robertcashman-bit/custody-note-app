const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const emailModalJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'email-modal.js'), 'utf8');

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
});

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
