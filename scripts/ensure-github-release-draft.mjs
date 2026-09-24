#!/usr/bin/env node
/**
 * Ensure exactly one draft GitHub release exists for the current package version tag.
 * Used by CI prepare-release-draft before parallel build jobs upload assets.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  ensureDraftRelease,
  normaliseReleaseTag,
  waitForReleaseByTag,
  consolidateDuplicateReleases,
} from './github-release-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function tokenFromEnv() {
  const t = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!t) throw new Error('GH_TOKEN or GITHUB_TOKEN required');
  return t;
}

function parseArgs(argv) {
  const opts = { mode: 'create', tag: null, maxAttempts: 60 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wait-only') opts.mode = 'wait';
    else if (a === '--consolidate-only') opts.mode = 'consolidate';
    else if (a === '--tag' && argv[i + 1]) {
      opts.tag = argv[++i];
    } else if (a === '--max-attempts' && argv[i + 1]) {
      opts.maxAttempts = parseInt(argv[++i], 10);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const tag = normaliseReleaseTag(opts.tag || `v${pkg.version}`);
  const token = tokenFromEnv();

  if (opts.mode === 'consolidate') {
    const release = await consolidateDuplicateReleases(tag, token);
    if (!release) {
      console.error(`[ensure-release-draft] No release found for ${tag}`);
      process.exit(1);
    }
    console.log(`[ensure-release-draft] Canonical release ${tag} id=${release.id} assets=${(release.assets || []).length}`);
    return;
  }

  if (opts.mode === 'wait') {
    const release = await waitForReleaseByTag(tag, token, {
      maxAttempts: opts.maxAttempts,
      delayMs: 5000,
    });
    console.log(`[ensure-release-draft] Release ${tag} ready (id=${release.id}).`);
    return;
  }

  const release = await ensureDraftRelease(tag, token, { title: pkg.version });
  console.log(`[ensure-release-draft] Draft ${tag} id=${release.id} (single canonical release for uploads).`);
}

main().catch((err) => {
  console.error('[ensure-release-draft]', err && err.message ? err.message : err);
  process.exit(1);
});
