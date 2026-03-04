#!/usr/bin/env node
/**
 * Syncs changelog and version from app to website without bumping or building.
 * Use when you've manually edited changelog.json and want to update the website.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WEBSITE_ROOT = join(APP_ROOT, '..', 'custody note - website production');

const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
const changelog = JSON.parse(readFileSync(join(APP_ROOT, 'changelog.json'), 'utf8'));

const websiteDataPath = join(WEBSITE_ROOT, 'src', 'data', 'releases.json');
writeFileSync(
  websiteDataPath,
  JSON.stringify({ version: pkg.version, releases: changelog.releases }, null, 2) + '\n',
  'utf8'
);
console.log(`Synced v${pkg.version} and ${changelog.releases.length} releases to website`);
