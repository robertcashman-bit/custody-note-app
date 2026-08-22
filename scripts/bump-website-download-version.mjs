#!/usr/bin/env node
/**
 * Bump custodynote.com download page + stats API defaults to the app package
 * version, and soften Mac notarization marketing copy when shipping a
 * Developer ID–signed (not yet notarised) build.
 *
 * Run against a clone of robertcashman-bit/custody-note-website:
 *   WEBSITE_ROOT=../custody-note-website node scripts/bump-website-download-version.mjs
 *
 * Env:
 *   WEBSITE_ROOT — path to website clone (required)
 *   FROM_VERSION — previous version string (default: detect from website sources)
 *   TO_VERSION — target version (default: app package.json version)
 *   SOFTEN_NOTARY_COPY — "0" to skip copy softening (default: soften)
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WEBSITE_ROOT =
  (process.env.WEBSITE_ROOT && process.env.WEBSITE_ROOT.trim()) ||
  join(APP_ROOT, '..', 'custody-note-website');

if (!existsSync(WEBSITE_ROOT)) {
  console.error('[bump-website-download] WEBSITE_ROOT not found:', WEBSITE_ROOT);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
const TO_VERSION = String(process.env.TO_VERSION || pkg.version || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(TO_VERSION)) {
  console.error('[bump-website-download] Invalid TO_VERSION:', TO_VERSION);
  process.exit(1);
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'out',
  'coverage',
  '.vercel',
]);

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else {
      const dot = name.lastIndexOf('.');
      const ext = dot >= 0 ? name.slice(dot) : '';
      if (TEXT_EXT.has(ext)) out.push(p);
    }
  }
  return out;
}

function detectFromVersion(files) {
  if (process.env.FROM_VERSION && process.env.FROM_VERSION.trim()) {
    return process.env.FROM_VERSION.trim();
  }
  const counts = new Map();
  const re = /\b1\.\d+\.\d+\b/g;
  for (const f of files) {
    // Prefer download + API routes for the live product version pin.
    const rel = relative(WEBSITE_ROOT, f).replace(/\\/g, '/');
    if (
      !rel.includes('download') &&
      !rel.includes('stats/download') &&
      !rel.endsWith('releases.json') &&
      !rel.includes('lib/site') &&
      !rel.includes('product-copy')
    ) {
      continue;
    }
    const text = readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(text))) {
      const v = m[0];
      if (v === TO_VERSION) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  let best = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

const files = walk(WEBSITE_ROOT);
const FROM_VERSION = detectFromVersion(files);
if (!FROM_VERSION) {
  console.error(
    '[bump-website-download] Could not detect FROM_VERSION. Set FROM_VERSION=1.9.68 explicitly.',
  );
  process.exit(1);
}

if (FROM_VERSION === TO_VERSION) {
  console.log(`[bump-website-download] Already at ${TO_VERSION} — nothing to bump.`);
} else {
  console.log(`[bump-website-download] ${FROM_VERSION} → ${TO_VERSION}`);
}

const soften = process.env.SOFTEN_NOTARY_COPY !== '0';

/** Ordered string replacements applied after version bump. */
const COPY_REPLACEMENTS = [
  [
    'macOS 11 or later · Apple Silicon & Intel · signed & notarised · ~130 MB',
    'macOS 11 or later · Apple Silicon & Intel · Developer ID signed · ~130 MB',
  ],
  [
    'macOS 11 or later · Apple Silicon &amp; Intel · signed &amp; notarised · ~130 MB',
    'macOS 11 or later · Apple Silicon &amp; Intel · Developer ID signed · ~130 MB',
    { optional: true },
  ],
  [
    'On first launch, Custody Note is signed and notarised and should open normally. If macOS Gatekeeper blocks the app, right-click Custody Note in Applications and choose Open once.',
    'Custody Note is Developer ID signed. Notarization may still be pending, so on first launch macOS Gatekeeper may block open — right-click Custody Note in Applications and choose Open once.',
  ],
  [
    'The Mac download is signed and notarised by Apple. You should not see an “unidentified developer” warning under normal circumstances. If macOS still blocks launch, use right-click → Open once, or check you downloaded the correct architecture (Apple Silicon vs Intel).',
    'The Mac download is Developer ID signed. Apple notarization may still be pending for this build, so Gatekeeper may ask you to right-click → Open once on first launch. Always download the correct architecture (Apple Silicon vs Intel).',
  ],
  [
    'signed and notarised',
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
  // Fragment forms used in MacDownload client components / split JSX
  [
    '· signed & notarised ·',
    '· Developer ID signed ·',
    { optional: true },
  ],
  [
    '· signed &amp; notarised ·',
    '· Developer ID signed ·',
    { optional: true },
  ],
  [
    'signed {"&"} notarised',
    'Developer ID signed',
    { optional: true },
  ],
  [
    'signed {\'&\'} notarised',
    'Developer ID signed',
    { optional: true },
  ],
  [
    'signed {"\\u0026"} notarised',
    'Developer ID signed',
    { optional: true },
  ],
];

const report = {
  from: FROM_VERSION,
  to: TO_VERSION,
  versionReplacements: 0,
  filesTouched: [],
  copyHits: [],
  copyMisses: [],
};

for (const file of files) {
  let text = readFileSync(file, 'utf8');
  let next = text;
  let changed = false;

  if (FROM_VERSION !== TO_VERSION && next.includes(FROM_VERSION)) {
    const occurrences = next.split(FROM_VERSION).length - 1;
    next = next.split(FROM_VERSION).join(TO_VERSION);
    report.versionReplacements += occurrences;
    changed = true;
  }

  if (soften) {
    for (const entry of COPY_REPLACEMENTS) {
      const [find, replace, opts = {}] = entry;
      if (!next.includes(find)) {
        if (!opts.optional) {
          // Only record misses for high-priority download-related files.
          const rel = relative(WEBSITE_ROOT, file).replace(/\\/g, '/');
          if (rel.includes('download') || rel.includes('MacDownload') || rel.includes('product-copy')) {
            report.copyMisses.push({ file: rel, find: find.slice(0, 80) });
          }
        }
        continue;
      }
      next = next.split(find).join(replace);
      changed = true;
      report.copyHits.push({
        file: relative(WEBSITE_ROOT, file).replace(/\\/g, '/'),
        find: find.slice(0, 80),
      });
    }
  }

  if (changed && next !== text) {
    writeFileSync(file, next, 'utf8');
    report.filesTouched.push(relative(WEBSITE_ROOT, file).replace(/\\/g, '/'));
  }
}

writeFileSync(
  join(WEBSITE_ROOT, '.bump-website-download-report.json'),
  JSON.stringify(report, null, 2) + '\n',
  'utf8',
);

console.log(
  `[bump-website-download] Touched ${report.filesTouched.length} file(s); ` +
    `${report.versionReplacements} version string replacement(s); ` +
    `${report.copyHits.length} copy hit(s).`,
);

if (FROM_VERSION !== TO_VERSION && report.versionReplacements === 0) {
  console.error('[bump-website-download] No version strings were replaced — aborting.');
  process.exit(1);
}
