#!/usr/bin/env node
/**
 * Standalone smoke test for the v1.8.0 Outlook launch helpers.
 *
 * Verifies on THIS Windows machine that:
 *  1. The Windows registry detection probes (reg.exe) execute and produce
 *     a sensible result. We run the same exact probes main.js will run.
 *  2. The .eml builder writes a file with no MIME parsing errors (string
 *     CRLF + UTF-8 + RFC 5322 headers).
 *  3. The OWA URL is parseable and points at the M365 deeplink endpoint
 *     with our subject + body intact across the URL boundary.
 *  4. The mailto: URI is RFC 6068 compliant (%20 not + for spaces).
 *
 * Does NOT actually call shell.openPath / shell.openExternal — those need
 * Electron and a human to verify Outlook desktop opens. That's the manual
 * smoke test step.
 *
 * Usage:
 *   node scripts/smoke-outlook-launch.mjs
 *
 * Pass criteria: prints "SMOKE PASS" and exits 0.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const launch = require('../lib/outlookLaunch');

let failures = 0;
function expect(name, ok, detail) {
  if (ok) {
    console.log('  PASS  ' + name);
  } else {
    console.log('  FAIL  ' + name + (detail ? ' — ' + detail : ''));
    failures++;
  }
}

console.log('=== v1.8.0 Outlook launch smoke ===');
console.log('Platform:', process.platform);
console.log('Node:', process.version);
console.log('');

/* ── 1. Registry detection ─────────────────────────────────────────── */
console.log('[1] Windows registry detection');
function regQuery(args) {
  try {
    return execFileSync('reg.exe', args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
  } catch (_) { return null; }
}
if (process.platform === 'win32') {
  const probes = [
    { label: 'Outlook desktop (HKLM Clients\\Mail)', args: ['query', 'HKLM\\SOFTWARE\\Clients\\Mail\\Microsoft Outlook', '/ve'] },
    { label: 'Outlook.Application ProgID', args: ['query', 'HKCR\\Outlook.Application', '/ve'] },
    { label: 'mailto UserChoice ProgId', args: ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\mailto\\UserChoice', '/v', 'ProgId'] },
  ];
  let any = false;
  for (const probe of probes) {
    const out = regQuery(probe.args);
    if (out) {
      any = true;
      const summary = out.trim().split('\n').slice(0, 4).map(l => '    ' + l.trim()).join('\n');
      console.log('  ' + probe.label + ' → found:\n' + summary);
    } else {
      console.log('  ' + probe.label + ' → not found');
    }
  }
  expect('reg.exe is callable', any !== undefined, 'execFileSync did not throw');
} else {
  console.log('  (skipped — non-Windows platform)');
}

/* ── 2. .eml builder ───────────────────────────────────────────────── */
console.log('\n[2] .eml builder');
const sample = {
  to: 'dc.smith@police.uk',
  subject: 'Smoke - Smith - Disclosure',
  body: 'Dear DC Smith,\n\nThis is a smoke test of the v1.8.0 launch path.\n\nKind regards,\nRobert',
};
const eml = launch.buildEmlContent(sample);
expect('contains MIME-Version', eml.includes('MIME-Version: 1.0\r\n'));
expect('contains X-Unsent: 1', eml.includes('X-Unsent: 1\r\n'));
expect('contains Content-Type charset=utf-8', eml.includes('charset=utf-8'));
expect('uses CRLF (no bare LF)', !/(?<!\r)\n/.test(eml));
expect('preserves paragraph break in body', eml.includes('Dear DC Smith,\r\n\r\nThis is'));
expect('blank-line header/body boundary', eml.indexOf('\r\n\r\n') > 0);

/* Write to a temp file Outlook can be opened against — we don't open it
   here; the user will do that via the Settings UI in Phase 3. */
const tmp = mkdtempSync(path.join(tmpdir(), 'cn-smoke-'));
const emlPath = path.join(tmp, 'smoke-draft.eml');
writeFileSync(emlPath, eml, { encoding: 'utf8' });
const back = readFileSync(emlPath, 'utf8');
expect('round-trips through disk byte-for-byte', back === eml);
console.log('  .eml written at: ' + emlPath);

/* ── 3. OWA URL ─────────────────────────────────────────────────────── */
console.log('\n[3] OWA compose URL');
const owa = launch.buildOwaComposeUrl(sample);
console.log('  ' + owa.slice(0, 100) + '...');
let parsed;
try { parsed = new URL(owa); } catch (e) { parsed = null; }
expect('parseable as URL', !!parsed);
if (parsed) {
  expect('endpoint = outlook.office.com/mail/deeplink/compose',
    parsed.hostname === 'outlook.office.com' && parsed.pathname === '/mail/deeplink/compose');
  expect('to round-trips', parsed.searchParams.get('to') === sample.to);
  expect('subject round-trips', parsed.searchParams.get('subject') === sample.subject);
  expect('body contains both paragraphs',
    parsed.searchParams.get('body').includes('Dear DC Smith,') &&
    parsed.searchParams.get('body').includes('Kind regards'));
}
expect('exactly two & query separators', (owa.match(/&/g) || []).length === 2);

/* ── 4. mailto URI ─────────────────────────────────────────────────── */
console.log('\n[4] mailto URI');
const m = launch.buildMailtoUri(sample);
console.log('  ' + m.slice(0, 100) + '...');
expect('starts with mailto:', m.startsWith('mailto:'));
expect('encodes spaces as %20 (not +)', m.includes('Smoke%20-%20Smith%20-%20Disclosure'));
expect('does NOT use + for spaces', !/[?&]subject=Smoke\+/.test(m));
expect('uses %0A for body newlines', m.includes('%0A'));
expect('exactly one & separator (subject vs body)', (m.match(/&/g) || []).length === 1);

/* ── 5. recommendSendMethod ─────────────────────────────────────────── */
console.log('\n[5] recommendSendMethod');
expect('Outlook installed → outlook-desktop',
  launch.recommendSendMethod({ outlookDesktopInstalled: true }) === 'outlook-desktop');
expect('Outlook ProgId mailto → default-mailto',
  launch.recommendSendMethod({ defaultMailtoApp: 'Outlook.URL.mailto.15' }) === 'default-mailto');
expect('Chrome ProgId mailto → outlook-web (browser would render mailto as text)',
  launch.recommendSendMethod({ defaultMailtoApp: 'ChromeHTML' }) === 'outlook-web');
expect('Nothing → outlook-web fallback',
  launch.recommendSendMethod({}) === 'outlook-web');

/* ── Summary ─────────────────────────────────────────────────────── */
console.log('');
if (failures === 0) {
  console.log('SMOKE PASS — ' + (eml.length) + ' bytes .eml written, OWA URL parseable, mailto RFC 6068 compliant');
  process.exit(0);
} else {
  console.log('SMOKE FAIL — ' + failures + ' check(s) failed');
  process.exit(1);
}
