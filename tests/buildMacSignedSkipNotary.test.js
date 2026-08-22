'use strict';

/**
 * Locks the CN_SKIP_NOTARIZE fallback used when Apple notarization credentials
 * are stale but the Developer ID .p12 still imports in CI.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'scripts', 'build-mac-signed.mjs'), 'utf8');

describe('build-mac-signed.mjs — CN_SKIP_NOTARIZE', () => {
  it('reads CN_SKIP_NOTARIZE from the environment', () => {
    assert.match(src, /CN_SKIP_NOTARIZE/);
    assert.match(src, /SKIP_NOTARIZE/);
  });

  it('disables electron-builder notarize when skipping', () => {
    assert.match(src, /notarize:\s*!SKIP_NOTARIZE/);
  });

  it('uses codesign --verify instead of hard-failing spctl when skipping', () => {
    assert.match(src, /codesign/);
    assert.match(src, /--verify/);
    assert.match(src, /notarization skipped/i);
  });

  it('still requires APPLE_TEAM_ID for Developer ID identity selection', () => {
    assert.match(src, /APPLE_TEAM_ID/);
    assert.match(src, /Developer ID Application/);
  });

  it('does not require APPLE_APP_SPECIFIC_PASSWORD when skipping notarization', () => {
    // Password validation must sit inside the non-skip branch.
    const skipBlockStart = src.indexOf('if (SKIP_NOTARIZE)');
    const elseStart = src.indexOf('} else {', skipBlockStart);
    const passwordFormatCheck = src.indexOf('xxxx-xxxx-xxxx-xxxx', elseStart);
    assert.ok(skipBlockStart !== -1 && elseStart !== -1 && passwordFormatCheck !== -1);
    assert.ok(passwordFormatCheck > elseStart);
  });
});
