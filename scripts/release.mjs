#!/usr/bin/env node
/**
 * Release script: bumps version, updates changelog, syncs to website, builds app, publishes to GitHub, deploys website.
 *
 * Usage:
 *   npm run release [patch|minor|major] [-- --changes "item1; item2; item3"]
 *   npm run release patch
 *   npm run release minor -- --changes "New feature X"
 *
 * If --changes is not provided, reads one change per line from stdin until empty line.
 *
 * Requires: GH_TOKEN or GITHUB_TOKEN (GitHub PAT with repo scope) for publishing.
 *
 * This script:
 * 1. Bumps version in package.json
 * 2. Appends to changelog.json
 * 3. Syncs version + changelog to website (custody note - website production)
 * 4. Builds the Electron app and publishes to GitHub (creates release, uploads installer)
 * 5. Deploys the website to Vercel (so download page serves new version)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WEBSITE_ROOT = join(APP_ROOT, '..', 'custody note - website production');

/** Load GH_TOKEN from .env or .env.local if not already set */
function loadEnvToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return;
  for (const name of ['.env', '.env.local']) {
    const p = join(APP_ROOT, name);
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*GH_TOKEN\s*=\s*(.+?)\s*$/);
        if (m) {
          process.env.GH_TOKEN = m[1].replace(/^["']|["']$/g, '').trim();
          return;
        }
      }
    } catch (_) {}
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function parseVersion(v) {
  return v.split('.').map(Number);
}

function bumpVersion(version, type) {
  const [major, minor, patch] = parseVersion(version);
  if (type === 'major') return [major + 1, 0, 0].join('.');
  if (type === 'minor') return [major, minor + 1, 0].join('.');
  return [major, minor, (patch || 0) + 1].join('.');
}

async function readChangesFromStdin() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const changes = [];
  process.stderr.write('Enter changelog items (one per line, empty line to finish):\n');
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) break;
    changes.push(trimmed);
  }
  return changes;
}

function parseChangesArg(argv) {
  const idx = argv.indexOf('--changes');
  if (idx !== -1 && argv[idx + 1]) {
    return argv[idx + 1].split(';').map(s => s.trim()).filter(Boolean);
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const type = ['patch', 'minor', 'major'].includes(argv[0]) ? argv[0] : 'patch';
  let changes = parseChangesArg(argv);

  const pkgPath = join(APP_ROOT, 'package.json');
  const changelogPath = join(APP_ROOT, 'changelog.json');
  const pkg = readJson(pkgPath);

  const newVersion = bumpVersion(pkg.version, type);
  const today = new Date().toISOString().slice(0, 10);

  if (!changes || changes.length === 0) {
    changes = await readChangesFromStdin();
  }
  if (changes.length === 0) {
    changes = ['Bug fixes and improvements'];
  }

  // Update package.json
  pkg.version = newVersion;
  pkg.lastUpdated = today;
  writeJson(pkgPath, pkg);
  console.log(`Version bumped to ${newVersion}`);

  // Update changelog.json
  const changelog = existsSync(changelogPath) ? readJson(changelogPath) : { releases: [] };
  const releases = changelog.releases || [];
  for (const r of releases) r.latest = false;
  releases.unshift({
    version: newVersion,
    date: today,
    latest: true,
    changes,
  });
  changelog.releases = releases;
  writeJson(changelogPath, changelog);
  console.log('Changelog updated');

  // Sync to website
  const websiteDataPath = join(WEBSITE_ROOT, 'src', 'data', 'releases.json');
  const websiteDataDir = dirname(websiteDataPath);
  if (!existsSync(websiteDataDir)) {
    const { mkdirSync } = await import('fs');
    mkdirSync(websiteDataDir, { recursive: true });
  }
  writeJson(websiteDataPath, {
    version: newVersion,
    releases,
  });
  console.log('Website data synced');

  // Build and publish app to GitHub
  loadEnvToken();
  const { spawn } = await import('child_process');
  const hasToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const doPublish = hasToken && !argv.includes('--no-publish');

  if (doPublish) {
    console.log('Building and publishing to GitHub...');
    await new Promise((resolve, reject) => {
      const proc = spawn(
        'npx',
        ['electron-builder', '--win', '--publish', 'always'],
        {
          cwd: APP_ROOT,
          stdio: 'inherit',
          shell: true,
          env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN },
        }
      );
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Build/publish exited ${code}`))));
    });
  } else {
    if (!hasToken) {
      console.warn('GH_TOKEN or GITHUB_TOKEN not set — skipping GitHub publish. Build only.');
    }
    await new Promise((resolve, reject) => {
      const proc = spawn('npm', ['run', 'build:only'], {
        cwd: APP_ROOT,
        stdio: 'inherit',
        shell: true,
      });
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Build exited ${code}`))));
    });
  }
  console.log('Build complete.');

  // Deploy website (fetch-latest-release + Vercel)
  if (existsSync(join(WEBSITE_ROOT, 'package.json'))) {
    console.log('Deploying website...');
    await new Promise((resolve, reject) => {
      const proc = spawn('npm', ['run', 'deploy'], {
        cwd: WEBSITE_ROOT,
        stdio: 'inherit',
        shell: true,
      });
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Website deploy exited ${code}`))));
    });
    console.log('Website deployed.');
  } else {
    console.log('Website not found, skipping deploy.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
