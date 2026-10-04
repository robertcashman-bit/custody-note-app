#!/usr/bin/env node
/**
 * Mirror a fully-built release from the app repo (CI staging draft) to the public,
 * releases-only repo robertcashman-bit/custody-note-releases, which is the
 * electron-updater feed (package.json build.publish) and the website download host.
 *
 * - Creates the public release as a DRAFT, uploads every asset (installers, msix,
 *   dmgs, zips, blockmaps, latest.yml, latest-mac.yml) plus the public
 *   changelog.json, then publishes it as "latest" — updaters never see a
 *   half-uploaded release. latest*.yml use relative URLs, so they work verbatim.
 * - Release body is customer-level (lib/publicReleaseNotes.js).
 * - Idempotent: assets already present with the same size are skipped.
 *
 * Usage:
 *   node scripts/mirror-release-to-public-repo.mjs [--tag v1.9.111]
 *
 * Env:
 *   SOURCE_GH_TOKEN (or GH_TOKEN / GITHUB_TOKEN) — reads the staging draft in the app repo
 *   RELEASES_REPO_TOKEN — token that can write releases on custody-note-releases ONLY
 *                         (fine-grained PAT: that single repo, Contents: read & write)
 *   GITHUB_REPOSITORY   — source repo (default robertcashman-bit/custody-note-app)
 *   CN_PUBLIC_RELEASES_REPO — override target "owner/repo"
 *
 * If RELEASES_REPO_TOKEN is missing, the script only checks (unauthenticated) that
 * the public release is already complete — e.g. after a manual mirror — and exits
 * non-zero with instructions otherwise.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import {
  PUBLIC_RELEASES_OWNER,
  PUBLIC_RELEASES_REPO,
  downloadReleaseAsset,
  fetchReleaseByTag,
  listReleasesByTagName,
  normaliseReleaseTag,
  releaseApiHeaders,
  resolveReleaseRepo,
  uploadReleaseAssetBuffer,
  deleteReleaseAsset,
} from './github-release-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildPublicReleaseBody, findPublicNotesViolations } = require('../lib/publicReleaseNotes.js');

export function requiredMirrorAssetNames(version) {
  return [
    `Custody-Note-Setup-${version}.exe`,
    `Custody-Note-Setup-${version}.exe.blockmap`,
    'latest.yml',
    `Custody-Note-${version}-arm64.dmg`,
    `Custody-Note-${version}-arm64.zip`,
    `Custody-Note-${version}-x64.dmg`,
    `Custody-Note-${version}-x64.zip`,
    'latest-mac.yml',
    'changelog.json',
  ];
}

function parseArgs(argv) {
  const opts = { tag: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--tag' && argv[i + 1]) opts.tag = argv[++i];
  }
  return opts;
}

function targetRepo() {
  const o = String(process.env.CN_PUBLIC_RELEASES_REPO || '').trim();
  if (o.includes('/')) {
    const [owner, repo] = o.split('/');
    return { owner, repo };
  }
  return { owner: PUBLIC_RELEASES_OWNER, repo: PUBLIC_RELEASES_REPO };
}

/** Public changelog asset — the website sync reads this (no token needed). */
export function buildPublicChangelogAsset(changelog, version) {
  const releases = (changelog.releases || []).map((r) => ({
    version: r.version,
    date: r.date,
    ...(r.latest ? { latest: true } : {}),
    changes: Array.isArray(r.changes) ? r.changes : [],
  }));
  const violations = findPublicNotesViolations(releases);
  if (violations.length) {
    throw new Error(
      `changelog.json fails the public release-notes check (${violations.length} issue(s)); refusing to publish.`,
    );
  }
  return Buffer.from(JSON.stringify({ version, releases }, null, 2) + '\n', 'utf8');
}

async function publicReleaseIsComplete(tag, version, target) {
  const res = await fetch(
    `https://api.github.com/repos/${target.owner}/${target.repo}/releases/tags/${encodeURIComponent(tag)}`,
    { headers: releaseApiHeaders(null) },
  );
  if (!res.ok) return { ok: false, missing: ['<release>'] };
  const rel = await res.json();
  const have = new Set((rel.assets || []).map((a) => a.name));
  const missing = requiredMirrorAssetNames(version).filter((n) => !have.has(n));
  return { ok: missing.length === 0 && !rel.draft, missing };
}

async function api(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: { ...releaseApiHeaders(token), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function main() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const args = parseArgs(process.argv);
  const tag = normaliseReleaseTag(args.tag || `v${pkg.version}`);
  const version = tag.replace(/^v/, '');
  const target = targetRepo();
  const source = resolveReleaseRepo();
  const targetToken = String(process.env.RELEASES_REPO_TOKEN || '').trim();
  const sourceToken = process.env.SOURCE_GH_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  if (!targetToken) {
    const state = await publicReleaseIsComplete(tag, version, target);
    if (state.ok) {
      console.log(`[mirror] RELEASES_REPO_TOKEN not set, but ${target.owner}/${target.repo} ${tag} is already published and complete — OK.`);
      return;
    }
    console.error(
      `[mirror] RELEASES_REPO_TOKEN is not set and ${target.owner}/${target.repo} ${tag} is incomplete ` +
        `(missing: ${state.missing.join(', ')}).\n` +
        '  Fix: add a fine-grained PAT scoped ONLY to custody-note-releases (Contents: read & write) as the ' +
        'Actions secret RELEASES_REPO_TOKEN, or run this script locally with RELEASES_REPO_TOKEN set, then re-run the failed job.',
    );
    process.exit(1);
  }
  if (!sourceToken) throw new Error('SOURCE_GH_TOKEN / GH_TOKEN / GITHUB_TOKEN required to read the staging release');

  const changelog = JSON.parse(readFileSync(join(root, 'changelog.json'), 'utf8'));
  const relNotes = (changelog.releases || []).find((r) => r.version === version);
  const body = relNotes ? buildPublicReleaseBody(relNotes) : `Custody Note ${version}.`;
  const changelogAsset = buildPublicChangelogAsset(changelog, version);

  const src = await fetchReleaseByTag(tag, sourceToken, source);
  const srcNames = new Set((src.assets || []).map((a) => a.name));
  const missingSrc = requiredMirrorAssetNames(version).filter((n) => n !== 'changelog.json' && !srcNames.has(n));
  if (missingSrc.length) throw new Error(`Staging release ${source.owner}/${source.repo} ${tag} is missing: ${missingSrc.join(', ')}`);

  const base = `https://api.github.com/repos/${target.owner}/${target.repo}`;
  let matches = await listReleasesByTagName(tag, targetToken, target);
  let dst = matches[0];
  if (!dst) {
    dst = await api('POST', `${base}/releases`, targetToken, {
      tag_name: tag,
      target_commitish: 'main',
      name: `Custody Note ${version}`,
      body,
      draft: true,
      prerelease: false,
      generate_release_notes: false,
    });
    console.log(`[mirror] Created draft ${target.owner}/${target.repo} ${tag} (id ${dst.id}).`);
  }

  const existing = new Map((dst.assets || []).map((a) => [a.name, a]));
  const uploads = [...(src.assets || []).map((a) => ({ name: a.name, size: a.size, srcAsset: a }))];
  uploads.push({ name: 'changelog.json', size: changelogAsset.length, buffer: changelogAsset });

  for (const u of uploads) {
    const have = existing.get(u.name);
    if (have && have.size === u.size && have.state === 'uploaded') {
      console.log(`[mirror] = ${u.name} (already present, ${u.size} bytes)`);
      continue;
    }
    if (have) await deleteReleaseAsset(have.id, targetToken, target.owner, target.repo);
    const buf = u.buffer || (await downloadReleaseAsset(u.srcAsset, sourceToken));
    if (u.size && buf.length !== u.size) throw new Error(`${u.name}: downloaded ${buf.length} bytes, expected ${u.size}`);
    await uploadReleaseAssetBuffer(dst, u.name, buf, targetToken);
    console.log(`[mirror] + ${u.name} (${buf.length} bytes)`);
  }

  const final = await api('PATCH', `${base}/releases/${dst.id}`, targetToken, {
    draft: false,
    make_latest: 'true',
    name: `Custody Note ${version}`,
    body,
  });
  console.log(`[mirror] Published ${final.html_url}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error('[mirror]', err && err.message ? err.message : err);
    process.exit(1);
  });
}
