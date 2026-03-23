#!/usr/bin/env node
/**
 * Syncs changelog and version from app to website without bumping or building.
 * Use when you've manually edited changelog.json and want to update the website.
 *
 * Runs verify-release-consistency checks first to catch drift early.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
// custody-note-website is the custodynote.com product site (separate repo)
const WEBSITE_ROOT = join(APP_ROOT, '..', 'custody-note-website');

// Run consistency check first
try {
  execSync('node scripts/verify-release-consistency.mjs', { cwd: APP_ROOT, stdio: 'inherit' });
} catch {
  console.error('[sync-website] Aborting — release consistency check failed. Fix errors above first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
const changelog = JSON.parse(readFileSync(join(APP_ROOT, 'changelog.json'), 'utf8'));

const websiteDataDir = join(WEBSITE_ROOT, 'data');
const websiteDataPath = join(websiteDataDir, 'releases.json');

if (!existsSync(websiteDataDir)) {
  mkdirSync(websiteDataDir, { recursive: true });
}

writeFileSync(
  websiteDataPath,
  JSON.stringify({ version: pkg.version, releases: changelog.releases }, null, 2) + '\n',
  'utf8'
);
console.log(`[sync-website] Synced v${pkg.version} and ${changelog.releases.length} releases to website`);

// Auto-commit and push — Vercel deploys automatically from GitHub
try {
  execSync('git add -A', { cwd: WEBSITE_ROOT, stdio: 'inherit' });
  try {
    execSync(`git commit -m "Changelog: sync releases.json to v${pkg.version}"`, { cwd: WEBSITE_ROOT, stdio: 'inherit' });
  } catch {
    console.log('[sync-website] Nothing to commit (already up to date)');
  }
  execSync('git push origin master', { cwd: WEBSITE_ROOT, stdio: 'inherit' });
  console.log('[sync-website] Pushed to GitHub → Vercel will auto-deploy custodynote.com');
} catch (e) {
  console.error('[sync-website] Git push failed:', e.message);
}
