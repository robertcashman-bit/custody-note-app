#!/usr/bin/env node
/**
 * Upload one file to the canonical GitHub release for the current package version.
 */
import { readFileSync, existsSync } from 'fs';
import { basename, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  fetchReleaseByTag,
  uploadReleaseAssetBuffer,
  normaliseReleaseTag,
  deleteReleaseAsset,
} from './github-release-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const filePath = process.argv[2];
  if (!filePath || !existsSync(filePath)) {
    console.error('Usage: upload-single-release-asset.mjs <path-to-file>');
    process.exit(1);
  }
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GH_TOKEN or GITHUB_TOKEN required');

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const tag = normaliseReleaseTag(`v${pkg.version}`);
  const release = await fetchReleaseByTag(tag, token);
  const name = basename(filePath);
  const existing = (release.assets || []).find((a) => a.name === name);
  if (existing) {
    console.log(`[upload-single-release] Replacing existing ${name}`);
    await deleteReleaseAsset(existing.id, token);
  }
  const buf = readFileSync(filePath);
  await uploadReleaseAssetBuffer(release, name, buf, token);
  console.log(`[upload-single-release] Uploaded ${name} to ${tag}.`);
}

main().catch((e) => {
  console.error('[upload-single-release]', e.message || e);
  process.exit(1);
});
