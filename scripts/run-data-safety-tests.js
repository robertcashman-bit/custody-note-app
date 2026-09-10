#!/usr/bin/env node
/**
 * Data-safety CI gate — focused suite that must pass before release/deploy.
 * Does not weaken assertions; failures block the pipeline.
 */
const { spawn } = require('child_process');
const path = require('path');
const { readdirSync } = require('fs');

const testsDir = path.join(__dirname, '..', 'tests');
const files = readdirSync(testsDir)
  .filter((f) => /^dataSafety.*\.test\.js$/.test(f) || f === 'attendanceDurability.test.js' || f === 'saveNowDurability.test.js' || f === 'emptySyncRecovery.test.js' || f === 'backupPathAndGenerational.test.js' || f === 'footerStatusChips.test.js')
  .sort()
  .map((f) => path.join('tests', f));

if (files.length === 0) {
  console.error('[test:data-safety] No data-safety test files found');
  process.exit(1);
}

console.log('[test:data-safety] Running', files.length, 'file(s)');
const proc = spawn(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  shell: false,
  cwd: path.join(__dirname, '..'),
});

proc.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code == null ? 1 : code);
});
