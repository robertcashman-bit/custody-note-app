'use strict';
/**
 * Release hosting lives in the public releases-only repo
 * robertcashman-bit/custody-note-releases so custody-note-app can go private.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const wfDir = path.join(root, '.github', 'workflows');
const workflows = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ f, src: fs.readFileSync(path.join(wfDir, f), 'utf8') }));

describe('public releases repo', () => {
  it('electron-builder publish (baked app-update.yml feed) points at custody-note-releases', () => {
    assert.equal(pkg.build.publish.provider, 'github');
    assert.equal(pkg.build.publish.owner, 'robertcashman-bit');
    assert.equal(pkg.build.publish.repo, 'custody-note-releases');
  });

  it('mirror script targets custody-note-releases and uploads the public changelog asset', async () => {
    const api = await import('../scripts/github-release-api.mjs');
    assert.equal(api.PUBLIC_RELEASES_REPO, 'custody-note-releases');
    const m = await import('../scripts/mirror-release-to-public-repo.mjs');
    const names = m.requiredMirrorAssetNames('1.2.3');
    for (const n of ['latest.yml', 'latest-mac.yml', 'changelog.json', 'Custody-Note-Setup-1.2.3.exe',
      'Custody-Note-1.2.3-arm64.dmg', 'Custody-Note-1.2.3-x64.zip']) {
      assert.ok(names.includes(n), n);
    }
    const buf = m.buildPublicChangelogAsset({ releases: [{ version: '1.2.3', date: '2026-01-01', latest: true, changes: ['Faster saving'] }] }, '1.2.3');
    assert.equal(JSON.parse(buf.toString()).version, '1.2.3');
    assert.throws(() => m.buildPublicChangelogAsset({ releases: [{ version: '1.2.3', changes: ['Fixed for someone@gmail.com'] }] }, '1.2.3'));
  });

  it('no workflow uses pull_request_target, GH_PAT or VERCEL_TOKEN', () => {
    for (const { f, src } of workflows) {
      assert.doesNotMatch(src, /pull_request_target/, f);
      assert.doesNotMatch(src, /secrets\.GH_PAT|secrets\.VERCEL_TOKEN/, f);
    }
  });

  it('the PR test workflow exposes no secrets', () => {
    const t = workflows.find((w) => w.f === 'test.yml');
    assert.ok(t);
    assert.doesNotMatch(t.src, /secrets\./);
  });
});
