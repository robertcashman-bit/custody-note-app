#!/usr/bin/env node
/**
 * Upload Windows NSIS updater assets to the canonical draft release (no electron-builder publish).
 */
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  fetchReleaseByTag,
  uploadReleaseAssetBuffer,
  normaliseReleaseTag,
} from './github-release-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function tokenFromEnv() {
  const t = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!t) throw new Error('GH_TOKEN or GITHUB_TOKEN required');
  return t;
}

async function uploadIfMissing(release, fileName, filePath, token) {
  const names = new Set((release.assets || []).map((a) => a.name));
  if (names.has(fileName)) {
    console.log(`[upload-windows-release] Skip existing ${fileName}`);
    return;
  }
  if (!existsSync(filePath)) {
    throw new Error(`Missing build artefact: ${filePath}`);
  }
  const buf = readFileSync(filePath);
  console.log(`[upload-windows-release] Uploading ${fileName} (${buf.length} bytes)`);
  await uploadReleaseAssetBuffer(release, fileName, buf, token);
}

async function main() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  const tag = normaliseReleaseTag(`v${version}`);
  const token = tokenFromEnv();
  const release = await fetchReleaseByTag(tag, token);

  const setup = join(root, 'dist', `Custody-Note-Setup-${version}.exe`);
  const blockmap = join(root, 'dist', `Custody-Note-Setup-${version}.exe.blockmap`);
  const latestYml = join(root, 'dist', 'latest.yml');

  await uploadIfMissing(release, `Custody-Note-Setup-${version}.exe`, setup, token);
  await uploadIfMissing(release, `Custody-Note-Setup-${version}.exe.blockmap`, blockmap, token);
  await uploadIfMissing(release, 'latest.yml', latestYml, token);

  console.log(`[upload-windows-release] Done for ${tag}.`);
}

main().catch((err) => {
  console.error('[upload-windows-release]', err && err.message ? err.message : err);
  process.exit(1);
});
