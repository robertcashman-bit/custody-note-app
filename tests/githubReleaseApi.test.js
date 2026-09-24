'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
describe('github-release-api helpers', async () => {
  const mod = await import('../scripts/github-release-api.mjs');

  it('normaliseReleaseTag adds v prefix', () => {
    assert.equal(mod.normaliseReleaseTag('1.9.108'), 'v1.9.108');
    assert.equal(mod.normaliseReleaseTag('v1.9.108'), 'v1.9.108');
  });

  it('pickPrimaryRelease prefers more assets then higher id', () => {
    const primary = mod.pickPrimaryRelease([
      { id: 1, assets: [{ name: 'a' }] },
      { id: 2, assets: [{ name: 'a' }, { name: 'b' }] },
      { id: 3, assets: [{ name: 'a' }] },
    ]);
    assert.equal(primary.id, 2);
  });

  it('pickPrimaryRelease breaks ties by id', () => {
    const primary = mod.pickPrimaryRelease([
      { id: 10, assets: [] },
      { id: 20, assets: [] },
    ]);
    assert.equal(primary.id, 20);
  });
});

describe('release workflow — canonical draft + publish gate', () => {
  const fs = require('fs');
  const path = require('path');
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release-publish.yml'), 'utf8');
  const waitScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'wait-and-publish-release.mjs'), 'utf8');

  it('prepare-release-draft runs before parallel build jobs', () => {
    assert.match(wf, /^\s*prepare-release-draft:/m);
    assert.match(wf, /release-windows:\s*\n\s*needs:\s*prepare-release-draft/m);
    assert.match(wf, /release-windows-msix:\s*\n\s*needs:\s*prepare-release-draft/m);
    assert.match(wf, /release-mac:\s*\n\s*needs:\s*prepare-release-draft/m);
  });

  it('Windows NSIS uses publish never + explicit upload script', () => {
    assert.match(wf, /electron-builder --win nsis --publish never/);
    assert.match(wf, /upload-windows-release-assets\.mjs/);
    assert.doesNotMatch(wf, /gh release create.*Store artefact/);
  });

  it('publish-release waits for NSIS/Mac updater assets but not MSIX (MSIX job is continue-on-error)', () => {
    assert.match(wf, /needs:\s*\[release-windows,\s*release-mac,\s*release-windows-msix\]/);
    assert.doesNotMatch(waitScript, /Custody-Note-\$\{version\}\.msix/);
    assert.match(wf, /wait-and-publish-release\.mjs/);
  });
});
