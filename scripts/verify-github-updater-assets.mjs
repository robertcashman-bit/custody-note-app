#!/usr/bin/env node
/**
 * Verify GitHub release updater metadata matches uploaded binaries (SHA512).
 *
 * Usage:
 *   node scripts/verify-github-updater-assets.mjs --tag v1.9.27
 *   node scripts/verify-github-updater-assets.mjs --tag v1.9.27 --platform mac
 *   node scripts/verify-github-updater-assets.mjs --tag v1.9.27 --platform win
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
const OWNER = 'robertcashman-bit';
const REPO = 'custody-note-app';

function parseArgs(argv) {
  const opts = { tag: null, platform: 'both' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--tag' && argv[i + 1]) {
      opts.tag = argv[++i];
    } else if (argv[i] === '--platform' && argv[i + 1]) {
      opts.platform = argv[++i].toLowerCase();
    }
  }
  if (!opts.tag) {
    const version = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')).version;
    opts.tag = `v${version}`;
  }
  if (!/^v/.test(opts.tag)) opts.tag = `v${opts.tag}`;
  return opts;
}

function sha512Base64(buffer) {
  return createHash('sha512').update(buffer).digest('base64');
}

function parseYamlFeed(text) {
  /** electron-builder latest.yml / latest-mac.yml: top-level `files:` array of {url, sha512, size}. */
  const files = [];
  let inFiles = false;
  let current = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles && /^[^\s-]/.test(line) && line.trim()) {
      inFiles = false;
    }
    if (!inFiles) continue;
    const urlMatch = line.match(/^\s*-\s*url:\s*(.+)$/);
    if (urlMatch) {
      if (current && current.url) files.push(current);
      let url = urlMatch[1].trim();
      if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
        url = url.slice(1, -1);
      }
      current = { url };
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^\s+(sha512|size):\s*(.+)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    current[kv[1]] = val;
  }
  if (current && current.url) files.push(current);
  return files;
}

async function fetchRelease(tag, headers) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`, { headers });
  if (!res.ok) {
    throw new Error(`Release ${tag} not found: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function assetUrl(release, fileName) {
  const asset = (release.assets || []).find((a) => a.name === fileName);
  if (!asset) return null;
  return asset.browser_download_url;
}

async function verifyFeed({ tag, feedName, platformLabel, release, headers }) {
  const feedUrl = assetUrl(release, feedName);
  if (!feedUrl) {
    return [{ ok: false, file: feedName, error: 'feed missing on release' }];
  }

  const feedRes = await fetch(feedUrl, { headers });
  if (!feedRes.ok) {
    return [{ ok: false, file: feedName, error: `feed download failed: HTTP ${feedRes.status}` }];
  }
  const feedText = await feedRes.text();
  const entries = parseYamlFeed(feedText);
  const results = [];

  for (const entry of entries) {
    const fileName = entry.url;
    if (!fileName || !entry.sha512) {
      results.push({ ok: false, file: fileName || '(unknown)', error: 'missing url or sha512 in feed' });
      continue;
    }
    const downloadUrl = assetUrl(release, fileName);
    if (!downloadUrl) {
      results.push({ ok: false, file: fileName, error: 'asset missing on release' });
      continue;
    }
    const binRes = await fetch(downloadUrl, { headers });
    if (!binRes.ok) {
      results.push({ ok: false, file: fileName, error: `download failed: HTTP ${binRes.status}` });
      continue;
    }
    const buf = Buffer.from(await binRes.arrayBuffer());
    const actual = sha512Base64(buf);
    const expected = entry.sha512;
    if (actual !== expected) {
      results.push({
        ok: false,
        file: fileName,
        error: 'sha512 mismatch',
        expected,
        actual,
        platform: platformLabel,
        tag,
      });
    } else {
      results.push({ ok: true, file: fileName, platform: platformLabel, tag });
    }
  }

  return results;
}

async function main() {
  const { tag, platform } = parseArgs(process.argv);
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CustodyNote-VerifyUpdaterAssets',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  console.log(`[verify-updater] Checking ${tag} (platform=${platform})…`);
  const release = await fetchRelease(tag, headers);
  const allResults = [];

  if (platform === 'both' || platform === 'mac') {
    allResults.push(...await verifyFeed({
      tag,
      feedName: 'latest-mac.yml',
      platformLabel: 'mac',
      release,
      headers,
    }));
  }
  if (platform === 'both' || platform === 'win' || platform === 'windows') {
    allResults.push(...await verifyFeed({
      tag,
      feedName: 'latest.yml',
      platformLabel: 'win',
      release,
      headers,
    }));
  }

  let failed = 0;
  for (const r of allResults) {
    if (r.ok) {
      console.log(`[verify-updater] OK   ${r.file}`);
    } else {
      failed += 1;
      console.error(`[verify-updater] FAIL ${r.file}: ${r.error}`);
      if (r.expected && r.actual) {
        console.error(`  expected: ${r.expected}`);
        console.error(`  actual:   ${r.actual}`);
      }
    }
  }

  if (allResults.length === 0) {
    console.error('[verify-updater] No feed entries checked.');
    process.exit(1);
  }
  if (failed > 0) {
    console.error(`[verify-updater] ${failed} checksum failure(s) on ${tag}.`);
    process.exit(1);
  }
  console.log(`[verify-updater] All ${allResults.length} asset(s) verified for ${tag}.`);
}

main().catch((err) => {
  console.error('[verify-updater] Fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
