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
const WEBSITE_ROOT = join(APP_ROOT, '..', 'custody note - website production');

// Run consistency check first
try {
  execSync('node scripts/verify-release-consistency.mjs', { cwd: APP_ROOT, stdio: 'inherit' });
} catch {
  console.error('[sync-website] Aborting — release consistency check failed. Fix errors above first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
const changelog = JSON.parse(readFileSync(join(APP_ROOT, 'changelog.json'), 'utf8'));

const websiteDataDir = join(WEBSITE_ROOT, 'src', 'data');
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

// Auto-commit, push, and deploy the website
try {
  execSync('git add -A', { cwd: WEBSITE_ROOT, stdio: 'inherit' });
  try {
    execSync(`git commit -m "v${pkg.version}: sync releases"`, { cwd: WEBSITE_ROOT, stdio: 'inherit' });
  } catch {
    console.log('[sync-website] Nothing to commit (already up to date)');
  }
  execSync('git push origin master', { cwd: WEBSITE_ROOT, stdio: 'inherit' });
  console.log('[sync-website] Pushed to GitHub');
} catch (e) {
  console.error('[sync-website] Git push failed:', e.message);
}

try {
  console.log('[sync-website] Deploying to Vercel...');
  execSync('npx vercel --prod --yes', { cwd: WEBSITE_ROOT, stdio: 'inherit', timeout: 120000 });
  console.log('[sync-website] Vercel production deploy complete');
} catch (e) {
  console.error('[sync-website] Vercel deploy failed:', e.message);
  console.error('[sync-website] You can deploy manually with: cd "custody note - website production" && npx vercel --prod');
}
