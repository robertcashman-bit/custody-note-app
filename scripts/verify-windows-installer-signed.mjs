#!/usr/bin/env node
'use strict';

/**
 * Fail CI when a release NSIS installer is not Authenticode-signed.
 * Used only when Azure signing is enabled in release-windows.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function findSetupExe() {
  const dist = join(ROOT, 'dist');
  if (!existsSync(dist)) {
    throw new Error('dist/ missing — build the Windows NSIS installer first');
  }
  const candidates = readdirSync(dist)
    .filter((n) => /^Custody-Note-Setup-/.test(n) && n.endsWith('.exe'))
    .map((n) => join(dist, n));
  if (!candidates.length) {
    throw new Error('No Custody-Note-Setup-*.exe under dist/');
  }
  candidates.sort();
  return candidates[candidates.length - 1];
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[win-sign-verify] skip: not Windows (signature check runs on release-windows job)');
    return;
  }

  const exe = findSetupExe();
  const ps = [
    '$s = Get-AuthenticodeSignature -FilePath $args[0]',
    'Write-Output $s.Status',
    'if ($s.SignerCertificate) { Write-Output $s.SignerCertificate.Subject }',
  ].join('; ');
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ps, exe],
    { encoding: 'utf8' }
  ).trim();
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const status = lines[0] || '';
  console.log('[win-sign-verify]', exe, '→', status, lines[1] ? `(${lines[1]})` : '');

  if (status !== 'Valid') {
    console.error(
      '::error::Windows installer is not Authenticode-signed (status=' + status + '). '
      + 'Configure Azure Artifact Signing (SIGNING.md).'
    );
    process.exit(1);
  }
}

main();
