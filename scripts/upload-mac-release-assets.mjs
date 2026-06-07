#!/usr/bin/env node
/**
 * Upload Mac build artefacts to an existing GitHub release (when electron-builder
 * skips publish because the release is already published, not draft).
 */
import { execSync } from 'child_process';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function resolveGitHubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const out = execSync('printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  for (const line of out.split('\n')) {
    if (line.startsWith('password=')) return line.slice('password='.length);
  }
  throw new Error('GH_TOKEN required');
}

function loadEnvFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile('.env.local');
const token = resolveGitHubToken();
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const tag = `v${version}`;
const repo = 'robertcashman-bit/custody-note-app';
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'CustodyNote-UploadMacAssets',
};

const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers });
const release = await releaseRes.json();
if (!release.id) throw new Error(release.message || 'Release not found');

const existing = new Set((release.assets || []).map((a) => a.name));
const dist = join(root, 'dist');
const files = [
  `Custody-Note-${version}-arm64.dmg`,
  `Custody-Note-${version}-arm64.dmg.blockmap`,
  `Custody-Note-${version}-arm64.zip`,
  `Custody-Note-${version}-arm64.zip.blockmap`,
  `Custody-Note-${version}-x64.dmg`,
  `Custody-Note-${version}-x64.dmg.blockmap`,
  `Custody-Note-${version}-x64.zip`,
  `Custody-Note-${version}-x64.zip.blockmap`,
  'latest-mac.yml',
];

for (const name of files) {
  if (existing.has(name)) {
    console.log(`[upload-mac-assets] skip (exists): ${name}`);
    continue;
  }
  const path = join(dist, name);
  if (!existsSync(path)) {
    console.warn(`[upload-mac-assets] missing locally: ${name}`);
    continue;
  }
  console.log(`[upload-mac-assets] uploading ${name}…`);
  const stat = readFileSync(path);
  const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(stat.length),
    },
    body: stat,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload ${name} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  console.log(`[upload-mac-assets] uploaded ${name}`);
}

console.log('[upload-mac-assets] Done.');
