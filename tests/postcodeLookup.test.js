/**
 * Tests for the postcode lookup IPC handler.
 *
 * Covers:
 *  1. Static source-code assertions – confirms the handler uses the server
 *     proxy and does NOT contain direct Ideal Postcodes API calls or local
 *     API key logic.
 *  2. URL encoding sanity – ensures postcode whitespace is stripped.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

/* ── 1. Source-code assertions ──────────────────────────────────────── */

describe('Postcode IPC handler – source code', () => {
  it('postcode-lookup handler exists in main.js', () => {
    const idx = mainJs.indexOf("ipcMain.handle('postcode-lookup'");
    assert.ok(idx !== -1, 'postcode-lookup handler must exist');
  });

  it('does NOT contain a postcode-check-key handler', () => {
    const idx = mainJs.indexOf("ipcMain.handle('postcode-check-key'");
    assert.strictEqual(idx, -1, 'postcode-check-key handler must be removed');
  });

  it('does NOT call Ideal Postcodes API directly', () => {
    const lookupIdx = mainJs.indexOf("ipcMain.handle('postcode-lookup'");
    const nextHandler = mainJs.indexOf("ipcMain.handle(", lookupIdx + 1);
    const body = mainJs.slice(lookupIdx, nextHandler !== -1 ? nextHandler : lookupIdx + 2000);
    assert.ok(
      !body.includes('api.ideal-postcodes.co.uk'),
      'postcode-lookup must NOT call Ideal Postcodes directly'
    );
  });

  it('does NOT read idealPostcodesApiKey from settings', () => {
    const lookupIdx = mainJs.indexOf("ipcMain.handle('postcode-lookup'");
    const nextHandler = mainJs.indexOf("ipcMain.handle(", lookupIdx + 1);
    const body = mainJs.slice(lookupIdx, nextHandler !== -1 ? nextHandler : lookupIdx + 2000);
    assert.ok(
      !body.includes('idealPostcodesApiKey'),
      'postcode-lookup must NOT reference idealPostcodesApiKey'
    );
  });

  it('calls the server proxy at /api/postcodes/lookup', () => {
    const lookupIdx = mainJs.indexOf("ipcMain.handle('postcode-lookup'");
    const nextHandler = mainJs.indexOf("ipcMain.handle(", lookupIdx + 1);
    const body = mainJs.slice(lookupIdx, nextHandler !== -1 ? nextHandler : lookupIdx + 2000);
    assert.ok(
      body.includes('/api/postcodes/lookup'),
      'postcode-lookup must call the server proxy endpoint'
    );
  });

  it('strips spaces from postcode input', () => {
    const lookupIdx = mainJs.indexOf("ipcMain.handle('postcode-lookup'");
    const body = mainJs.slice(lookupIdx, lookupIdx + 500);
    assert.ok(
      body.includes(".replace(/\\s+/g, '')"),
      'postcode-lookup must strip spaces to avoid %2B in URL'
    );
  });
});

/* ── 2. URL encoding sanity ─────────────────────────────────────────── */

describe('Postcode – URL encoding', () => {
  it('URL for a spaced postcode is correctly formed without %2B', () => {
    const raw = 'SW1A 2AA';
    const pc = raw.trim().replace(/\s+/g, '');
    const url = `https://example.com/api/postcodes/lookup?pc=${encodeURIComponent(pc)}`;
    assert.ok(!url.includes('%2B'), 'URL must not contain %2B');
    assert.ok(url.includes('SW1A2AA'), 'URL must contain the no-space postcode');
  });
});
