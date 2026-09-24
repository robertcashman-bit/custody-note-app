#!/usr/bin/env node
/**
 * Wait for all release assets on the single canonical GitHub release, verify updater
 * checksums, then publish (draft → latest).
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import {
  consolidateDuplicateReleases,
  fetchReleaseByTag,
  normaliseReleaseTag,
  resolveReleaseRepo,
} from './github-release-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function tokenFromEnv() {
  const t = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!t) throw new Error('GH_TOKEN or GITHUB_TOKEN required');
  return t;
}

function requiredAssetNames(version) {
  return [
    `Custody-Note-Setup-${version}.exe`,
    `Custody-Note-Setup-${version}.exe.blockmap`,
    'latest.yml',
    `Custody-Note-${version}-arm64.dmg`,
    `Custody-Note-${version}-arm64.zip`,
    `Custody-Note-${version}-x64.dmg`,
    `Custody-Note-${version}-x64.zip`,
    'latest-mac.yml',
    `Custody-Note-${version}.msix`,
  ];
}

function missingAssets(release, required) {
  const have = new Set((release.assets || []).map((a) => a.name));
  return required.filter((name) => !have.has(name));
}

async function publishDraft(tag, token) {
  const { owner, repo } = resolveReleaseRepo();
  const release = await fetchReleaseByTag(tag, token);
  if (!release.draft) {
    console.log(`[publish-release] ${tag} already published.`);
    execSync(`gh release edit "${tag}" --repo "${owner}/${repo}" --latest`, { stdio: 'inherit' });
    return;
  }
  execSync(`gh release edit "${tag}" --repo "${owner}/${repo}" --draft=false --latest`, {
    stdio: 'inherit',
    env: { ...process.env, GH_TOKEN: token },
  });
  console.log(`[publish-release] Published ${tag}.`);
}

async function main() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  const tag = normaliseReleaseTag(`v${version}`);
  const token = tokenFromEnv();
  const required = requiredAssetNames(version);

  await consolidateDuplicateReleases(tag, token);

  for (let attempt = 1; attempt <= 45; attempt++) {
    const release = await fetchReleaseByTag(tag, token);
    const missing = missingAssets(release, required);
    if (missing.length === 0) {
      console.log('[publish-release] All required asset names present — waiting 45s for uploads to settle…');
      await new Promise((r) => setTimeout(r, 45000));

      let verifyOk = false;
      for (let v = 1; v <= 5; v++) {
        console.log(`[publish-release] Verifying updater checksums (${v}/5)…`);
        try {
          execSync(`node scripts/verify-github-updater-assets.mjs --tag "${tag}"`, {
            cwd: root,
            stdio: 'inherit',
            env: { ...process.env, GH_TOKEN: token },
          });
          verifyOk = true;
          break;
        } catch (_) {
          await new Promise((r) => setTimeout(r, 15000));
        }
      }

      if (!verifyOk) {
        console.log('[publish-release] Checksum verify failed — running Mac updater feed repair…');
        try {
          execSync(`node scripts/repair-github-mac-updater-feed.mjs --tag "${tag}"`, {
            cwd: root,
            stdio: 'inherit',
            env: { ...process.env, GH_TOKEN: token },
          });
        } catch (_) {}
        for (let v = 1; v <= 12; v++) {
          console.log(`[publish-release] Post-repair verify (${v}/12)…`);
          try {
            execSync(`node scripts/verify-github-updater-assets.mjs --tag "${tag}"`, {
              cwd: root,
              stdio: 'inherit',
              env: { ...process.env, GH_TOKEN: token },
            });
            verifyOk = true;
            break;
          } catch (_) {
            await new Promise((r) => setTimeout(r, 15000));
          }
        }
      }

      if (!verifyOk) {
        console.error('[publish-release] Checksum verification failed — release stays draft.');
        process.exit(1);
      }

      await publishDraft(tag, token);
      return;
    }
    console.log(`[publish-release] Waiting on ${tag} (${attempt}/45): missing ${missing.join(', ')}`);
    await new Promise((r) => setTimeout(r, 10000));
  }

  const release = await fetchReleaseByTag(tag, token);
  const missing = missingAssets(release, required);
  console.error(`[publish-release] Timed out. Still missing: ${missing.join(' ')}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('[publish-release]', err && err.message ? err.message : err);
  process.exit(1);
});
