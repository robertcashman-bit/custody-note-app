#!/usr/bin/env node
/**
 * After a release: restore website data/releases.json from the app changelog
 * (authoritative), and apply honest Mac download copy for a Developer ID
 * signed build. Does NOT globally rewrite historical version strings.
 *
 *   WEBSITE_ROOT=../custody-note-website node scripts/repair-website-release-copy.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WEBSITE_ROOT =
  (process.env.WEBSITE_ROOT && process.env.WEBSITE_ROOT.trim()) ||
  join(APP_ROOT, '..', 'custody-note-website');

if (!existsSync(WEBSITE_ROOT)) {
  console.error('[repair-website] WEBSITE_ROOT not found:', WEBSITE_ROOT);
  process.exit(1);
}

// 1) Authoritative releases.json from app changelog (no historical rewrite).
execSync('node scripts/sync-website.mjs', {
  cwd: APP_ROOT,
  stdio: 'inherit',
  env: { ...process.env, WEBSITE_ROOT, SYNC_WEBSITE_NO_PUSH: '1' },
});

const targets = [
  'app/download/page.tsx',
  'components/MacDownloadPicker.tsx',
  'src/app/download/page.tsx',
  'src/components/MacDownloadPicker.tsx',
];

const REPLACEMENTS = [
  // Restore / clarify Mac card subtitle (component or page).
  [
    'signed & notarised',
    'Developer ID signed & notarised',
  ],
  [
    'signed &amp; notarised',
    'Developer ID signed &amp; notarised',
    { optional: true },
  ],
  // Fix awkward partial rewrite from earlier global replace.
  [
    'The Mac download is Developer ID signed by Apple. You should not see an “unidentified developer” warning under normal circumstances. If macOS still blocks launch, use right-click → Open once, or check you downloaded the correct architecture (Apple Silicon vs Intel).',
    'The Mac download is Developer ID signed and notarised by Apple. If macOS Gatekeeper blocks launch, use right-click → Open once, or check you downloaded the correct architecture (Apple Silicon vs Intel).',
    { optional: true },
  ],
  [
    'The Mac download is Developer ID signed by Apple. You should not\n            see an &ldquo;unidentified developer&rdquo; warning under normal\n            circumstances. If macOS still blocks launch, use right-click &rarr;{" "}\n            Open once, or check you downloaded the correct architecture (Apple\n            Silicon vs Intel).',
    'The Mac download is Developer ID signed and notarised by Apple. If\n            macOS Gatekeeper blocks launch, use right-click &rarr;{" "}\n            Open once, or check you downloaded the correct architecture (Apple\n            Silicon vs Intel).',
    { optional: true },
  ],
  [
    'On first launch, Custody Note is{" "}\n                <strong className="text-white">Developer ID signed</strong> and\n                should open normally. If macOS Gatekeeper blocks the app,\n                right-click Custody Note in Applications and choose{" "}\n                <strong className="text-white">Open</strong> once.',
    'On first launch, Custody Note is{" "}\n                <strong className="text-white">Developer ID signed and notarised</strong>.\n                If macOS Gatekeeper blocks the app, right-click Custody Note in\n                Applications and choose{" "}\n                <strong className="text-white">Open</strong> once.',
    { optional: true },
  ],
];

const report = { filesTouched: [], hits: [], misses: [] };

for (const rel of targets) {
  const abs = join(WEBSITE_ROOT, rel);
  if (!existsSync(abs)) continue;
  let text = readFileSync(abs, 'utf8');
  let next = text;
  for (const [find, replace, opts = {}] of REPLACEMENTS) {
    if (!next.includes(find)) {
      if (!opts.optional) report.misses.push({ file: rel, find: find.slice(0, 60) });
      continue;
    }
    next = next.split(find).join(replace);
    report.hits.push({ file: rel, find: find.slice(0, 60) });
  }
  if (next !== text) {
    writeFileSync(abs, next, 'utf8');
    report.filesTouched.push(rel);
  }
}

writeFileSync(
  join(WEBSITE_ROOT, '.repair-website-release-copy-report.json'),
  JSON.stringify(report, null, 2) + '\n',
);

const releases = JSON.parse(readFileSync(join(WEBSITE_ROOT, 'data/releases.json'), 'utf8'));
const versions = (releases.releases || []).map((r) => r.version);
const dup = versions.length !== new Set(versions).size;
console.log(`[repair-website] releases.json version=${releases.version}; entries=${versions.length}; duplicateVersions=${dup}`);
console.log(`[repair-website] touched ${report.filesTouched.length} file(s); hits=${report.hits.length}`);
if (dup) {
  console.error('[repair-website] WARNING: duplicate version entries still present after sync');
  process.exit(1);
}
