/**
 * Policy: no mailto in production sources; single email IPC path.
 * Hard rule: the ONLY permitted email trigger is Outlook Web compose.
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
  'renderer/officerEmails.js',
  'renderer/views/email-modal.js',
  'renderer/views/billing.js',
  'renderer/email-templates.js',
  'renderer/views/list.js',
  'renderer/views/settings.js',
  'renderer/views/reports.js',
  'renderer/views/authorities.js',
  'renderer/views/station-mileage-admin.js',
  'renderer/templateSystem/templateEngine.js',
  'renderer/templateSystem/templateManager.js',
  'renderer/templateSystem/templateStore.js',
  'renderer/templateSystem/placeholders.js',
];

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'playwright-report', 'test-results'];

function walkJsHtml(dir) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return results; }
  for (const entry of entries) {
    if (SKIP_DIRS.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJsHtml(full));
    } else if (/\.(js|html|mjs|cjs)$/i.test(entry.name) && !entry.name.endsWith('.test.js')) {
      results.push(full);
    }
  }
  return results;
}

/* v1.6.2: mailto: is now an opt-in Outlook surface (Settings → "My default email
   app"), so the URL builders and the browser fallback are allowed to emit it.
   Other renderer/UI files (templates, list/billing/settings views, etc.) must
   STILL not contain raw mailto: strings — they have to go through emailAPI. */
const MAILTO_ALLOWED = new Set([
  'lib/outlookWebComposeUrl.js',
  'main/openOutlookWebEmail.js',
  'browser-api.js',
  /* Functional smoke test that drives the full Quick Email pipeline; it
     asserts mailto: URIs are produced for the desktop-mail account-type
     and so legitimately mentions the literal string. */
  'scripts/smoke-quick-email-asuser.js',
  'main.js', // contains the open-external mailto block
]);

describe('Email policy — production sources', () => {
  it('renderer/UI files still contain no mailto: (mailto only goes through the URL builders)', () => {
    const bad = [];
    for (const rel of PROD_FILES) {
      const f = path.join(root, rel);
      if (!fs.existsSync(f)) continue;
      if (MAILTO_ALLOWED.has(rel)) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (text.toLowerCase().includes('mailto:')) {
        bad.push(rel);
      }
    }
    assert.deepStrictEqual(bad, [], 'Unexpected mailto: in:\n' + bad.join('\n'));
  });

  it('FULL codebase scan: mailto: only appears in the allow-listed builder/fallback files', () => {
    const allFiles = walkJsHtml(root);
    const bad = [];
    for (const f of allFiles) {
      const rel = path.relative(root, f).replace(/\\/g, '/');
      if (rel.startsWith('tests/')) continue;
      if (MAILTO_ALLOWED.has(rel)) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (text.toLowerCase().includes('mailto:')) {
        bad.push(rel);
      }
    }
    assert.deepStrictEqual(bad, [], 'mailto: found in non-allow-listed source files:\n' + bad.join('\n'));
  });

  it('no navigator.share used for email in any JS file', () => {
    const allFiles = walkJsHtml(root);
    const bad = [];
    for (const f of allFiles) {
      const rel = path.relative(root, f).replace(/\\/g, '/');
      if (rel.startsWith('tests/')) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (text.includes('navigator.share')) {
        bad.push(rel);
      }
    }
    assert.deepStrictEqual(bad, [], 'navigator.share found in:\n' + bad.join('\n'));
  });

  it('no direct email client invocation patterns in renderer files', () => {
    const rendererFiles = walkJsHtml(path.join(root, 'renderer'));
    const bad = [];
    const patterns = [
      /window\.open\s*\([^)]*mail/i,
      /location\.href\s*=\s*['"]mailto/i,
      /shell\.openExternal/i,
    ];
    for (const f of rendererFiles) {
      const text = fs.readFileSync(f, 'utf8');
      for (const p of patterns) {
        if (p.test(text)) {
          bad.push(path.relative(root, f).replace(/\\/g, '/') + ' => ' + p.source);
        }
      }
    }
    assert.deepStrictEqual(bad, [], 'Direct email client invocation in renderer:\n' + bad.join('\n'));
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

  it('main.js blocks mailto in open-external handler', () => {
    const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    assert.ok(mainJs.includes("u.toLowerCase().startsWith('mailto:')"),
      'main.js must block mailto in open-external');
    const idx = mainJs.indexOf("u.toLowerCase().startsWith('mailto:')");
    const slice = mainJs.slice(Math.max(0, idx - 200), idx + 200);
    assert.ok(slice.includes('open-external'), 'mailto block must be inside open-external handler');
  });

  it('lib/outlookWebComposeUrl.js uses correct OWA base URL', () => {
    const lib = fs.readFileSync(path.join(root, 'lib', 'outlookWebComposeUrl.js'), 'utf8');
    assert.ok(lib.includes("outlook.office.com"),
      'work Outlook host must be outlook.office.com');
    assert.ok(lib.includes('/mail/deeplink/compose'),
      'canonical compose route must include /mail/deeplink/compose');
    assert.ok(lib.includes('encodeURIComponent'), 'must use encodeURIComponent for safety');
  });
});

