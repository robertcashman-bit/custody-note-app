#!/usr/bin/env node
/**
 * After a release: restore website data/releases.json from the app changelog
 * (authoritative), and apply honest Mac download copy for a Developer ID
 * signed build that may not yet be notarised.
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

// Honest copy for Developer ID–signed builds when notarization is pending.
const REPLACEMENTS = [
  // Split JSX in MacDownloadPicker (signed\n&amp; notarised)
  [
    'signed\n        &amp; notarised &middot; ~130 MB',
    'Developer ID signed &middot; ~130 MB',
  ],
  [
    'signed\n        & notarised · ~130 MB',
    'Developer ID signed · ~130 MB',
    { optional: true },
  ],
  [
    'Apple Silicon &amp; Intel &middot; signed &amp; notarised &middot; ~130 MB',
    'Apple Silicon &amp; Intel &middot; Developer ID signed &middot; ~130 MB',
    { optional: true },
  ],
  [
    'Apple Silicon & Intel · signed & notarised · ~130 MB',
    'Apple Silicon & Intel · Developer ID signed · ~130 MB',
    { optional: true },
  ],
  [
    'Developer ID signed & notarised',
    'Developer ID signed',
    { optional: true },
  ],
  [
    'Developer ID signed and notarised',
    'Developer ID signed',
    { optional: true },
  ],
  [
    'signed & notarised',
    'Developer ID signed',
    { optional: true },
  ],
  [
    'signed &amp; notarised',
    'Developer ID signed',
    { optional: true },
  ],
  [
    'On first launch, Custody Note is{" "}\n                <strong className="text-white">Developer ID signed</strong>.\n                If macOS Gatekeeper blocks the app, right-click Custody Note in\n                Applications and choose{" "}\n                <strong className="text-white">Open</strong> once.',
    'Custody Note is{" "}\n                <strong className="text-white">Developer ID signed</strong>\n                (Apple notarization pending). On first launch macOS Gatekeeper\n                may block open — right-click Custody Note in Applications and\n                choose{" "}\n                <strong className="text-white">Open</strong> once.',
    { optional: true },
  ],
  [
    'On first launch, Custody Note is{" "}\n                <strong className="text-white">Developer ID signed</strong> and\n                should open normally. If macOS Gatekeeper blocks the app,\n                right-click Custody Note in Applications and choose{" "}\n                <strong className="text-white">Open</strong> once.',
    'Custody Note is{" "}\n                <strong className="text-white">Developer ID signed</strong>\n                (Apple notarization pending). On first launch macOS Gatekeeper\n                may block open — right-click Custody Note in Applications and\n                choose{" "}\n                <strong className="text-white">Open</strong> once.',
    { optional: true },
  ],
  [
    'The Mac download is Developer ID signed and notarised by Apple. If\n            macOS Gatekeeper blocks launch, use right-click &rarr;{" "}\n            Open once, or check you downloaded the correct architecture (Apple\n            Silicon vs Intel).',
    'The Mac download is Developer ID signed; Apple notarization is still\n            pending for this build, so Gatekeeper may require right-click &rarr;{" "}\n            Open once on first launch. Always download the correct architecture\n            (Apple Silicon vs Intel).',
    { optional: true },
  ],
  [
    'The Mac download is Developer ID signed by Apple. You should not\n            see an &ldquo;unidentified developer&rdquo; warning under normal\n            circumstances. If macOS still blocks launch, use right-click &rarr;{" "}\n            Open once, or check you downloaded the correct architecture (Apple\n            Silicon vs Intel).',
    'The Mac download is Developer ID signed; Apple notarization is still\n            pending for this build, so Gatekeeper may require right-click &rarr;{" "}\n            Open once on first launch. Always download the correct architecture\n            (Apple Silicon vs Intel).',
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
      if (!opts.optional) report.misses.push({ file: rel, find: find.slice(0, 80) });
      continue;
    }
    next = next.split(find).join(replace);
    report.hits.push({ file: rel, find: find.slice(0, 80) });
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
if (report.misses.length) {
  console.log('[repair-website] non-optional misses:', JSON.stringify(report.misses, null, 2));
}
if (dup) {
  console.error('[repair-website] WARNING: duplicate version entries still present after sync');
  process.exit(1);
}
