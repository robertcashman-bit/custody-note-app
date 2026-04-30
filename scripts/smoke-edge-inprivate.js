#!/usr/bin/env node
'use strict';

/* H62 smoke test — verifies that the same code path the Officer Emails
   feature uses to spawn Edge InPrivate actually works on this Windows
   machine. Run with: node scripts/smoke-edge-inprivate.js
   Optional first argv: a URL to launch. Defaults to a benign Microsoft
   support page so we don't open OWA / sign-in surfaces during the smoke. */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function resolveMsEdgeExecutable() {
  const candidates = [];
  if (process.env['PROGRAMFILES(X86)']) {
    candidates.push(path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  if (process.env.PROGRAMFILES) {
    candidates.push(path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  for (let i = 0; i < candidates.length; i++) {
    try { if (fs.existsSync(candidates[i])) return candidates[i]; } catch (_) {}
  }
  return null;
}

const url = process.argv[2] || 'https://www.microsoft.com/en-gb/edge';
const exe = resolveMsEdgeExecutable();

if (process.platform !== 'win32') {
  console.log('[smoke] Not Windows — skipping. (platform=' + process.platform + ')');
  process.exit(0);
}
if (!exe) {
  console.error('[smoke] FAIL — msedge.exe not found in any of the standard install paths.');
  process.exit(2);
}

console.log('[smoke] Edge executable: ' + exe);
console.log('[smoke] Launch URL:      ' + url);
console.log('[smoke] Spawn args:      --inprivate --new-window <url>');

const child = spawn(exe, ['--inprivate', '--new-window', url], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});

let errored = false;
child.once('error', (err) => {
  errored = true;
  console.error('[smoke] FAIL — spawn error: ' + (err && err.message ? err.message : err));
  process.exit(3);
});

child.unref();

setTimeout(() => {
  if (errored) return;
  console.log('[smoke] PASS — spawn returned with no error and child unref\u2019d. An InPrivate window should now be visible.');
  console.log('[smoke] If you do NOT see an Edge InPrivate window pop up within ~2 seconds, Edge is being suppressed by group policy or AV.');
  process.exit(0);
}, 1500);
