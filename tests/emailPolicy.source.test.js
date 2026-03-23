/**
 * Policy: no mailto in production sources; single email IPC path.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const PROD_FILES = [
  'preload.js',
  'app.js',
  'index.html',
  'browser-api.js',
  'renderer/outlook-email-invoke.js',
  'renderer/views/email-modal.js',
  'renderer/views/billing.js',
  'renderer/email-templates.js',
];

describe('Email policy — production sources', () => {
  it('listed JS/HTML files contain no mailto: (mailto is blocked in main only)', () => {
    const bad = [];
    for (const rel of PROD_FILES) {
      const f = path.join(root, rel);
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (text.toLowerCase().includes('mailto:')) {
        bad.push(rel);
      }
    }
    assert.deepStrictEqual(bad, [], 'Unexpected mailto: in:\n' + bad.join('\n'));
  });

  it('preload does not expose openOutlookEmail on window.api', () => {
    const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
    assert.ok(!preloadJs.includes('openOutlookEmail'), 'use emailAPI.open only');
  });

  it('main wires open-outlook-email to main/openOutlookWebEmail.js', () => {
    const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    assert.ok(mainJs.includes("require('./main/openOutlookWebEmail')"));
    assert.ok(mainJs.includes("ipcMain.handle('open-outlook-email'"));
  });
});
