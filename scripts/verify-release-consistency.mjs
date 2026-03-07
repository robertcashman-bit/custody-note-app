#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fail(message) {
  console.error('[release:verify] ' + message);
  process.exit(1);
}

const pkg = readJson(join(APP_ROOT, 'package.json'));
const changelog = readJson(join(APP_ROOT, 'changelog.json'));
const releases = Array.isArray(changelog.releases) ? changelog.releases : [];

if (!pkg.version || typeof pkg.version !== 'string') {
  fail('package.json version is missing or invalid.');
}

if (releases.length === 0) {
  fail('changelog.json has no releases.');
}

const latest = releases.filter((r) => r && r.latest === true);
if (latest.length !== 1) {
  fail(`changelog.json must have exactly one latest=true entry (found ${latest.length}).`);
}

const latestRelease = latest[0];
if (!latestRelease.version) {
  fail('Latest changelog entry has no version.');
}

if (latestRelease.version !== pkg.version) {
  fail(`Version mismatch: package.json=${pkg.version}, changelog latest=${latestRelease.version}.`);
}

if (!releases[0] || releases[0].version !== latestRelease.version || releases[0].latest !== true) {
  fail('Latest changelog entry must be the first item in releases array.');
}

console.log('[release:verify] OK - package.json and changelog.json are in sync at v' + pkg.version);
