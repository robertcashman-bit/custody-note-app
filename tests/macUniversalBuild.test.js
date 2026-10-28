'use strict';

/**
 * macOS ships ONE universal (arm64 + x86_64) app so Apple silicon runs natively
 * (no Rosetta / "Support Ending for Intel-based Apps" warning) and Intel Macs
 * keep working. These tests pin the config + release plumbing to that layout.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

describe('macOS universal build', () => {
  it('electron-builder mac dmg + zip targets are universal only', () => {
    const targets = pkg.build.mac.target;
    for (const name of ['dmg', 'zip']) {
      const t = targets.find((x) => x.target === name);
      assert.ok(t, `mac target ${name} present`);
      assert.deepStrictEqual(t.arch, ['universal'], `${name} must be universal`);
    }
    assert.match(pkg.build.mac.artifactName, /\$\{arch\}/);
    assert.match(pkg.build.dmg.artifactName, /\$\{arch\}/);
  });

  it('has no production native (.node) dependencies that would block a universal merge', () => {
    const lock = require(path.join(root, 'package-lock.json'));
    const native = Object.entries(lock.packages || {}).filter(
      ([k, v]) => k && !v.dev && (v.gypfile || v.hasInstallScript),
    );
    assert.deepStrictEqual(native.map(([k]) => k), [],
      'a native prod dependency needs x64ArchFiles/singleArchFiles review before shipping universal');
  });

  it('release asset helper lists the universal dmg + zip (+ blockmaps and feed)', async () => {
    const m = await import('../scripts/mac-release-assets.mjs');
    assert.deepStrictEqual(m.macReleaseAssetNames('1.2.3'), [
      'Custody-Note-1.2.3-universal.dmg',
      'Custody-Note-1.2.3-universal.zip',
    ]);
    const up = m.macUploadAssetNames('1.2.3');
    for (const n of ['Custody-Note-1.2.3-universal.dmg.blockmap', 'Custody-Note-1.2.3-universal.zip.blockmap', 'latest-mac.yml']) {
      assert.ok(up.includes(n), n);
    }
    assert.ok(!up.some((n) => /-(arm64|x64)\./.test(n)), 'no per-arch assets');
    assert.strictEqual(m.macSentinelDmg('1.2.3'), 'Custody-Note-1.2.3-universal.dmg');
    assert.ok(m.MAC_APP_OUT_DIRS.includes('mac-universal'));
  });

  it('latest-mac.yml primary path prefers the universal zip, then arm64 zip (legacy)', async () => {
    const { pickPrimaryMacFeedEntry } = await import('../scripts/mac-release-assets.mjs');
    const uni = [
      { url: 'Custody-Note-1.2.3-universal.dmg' },
      { url: 'Custody-Note-1.2.3-universal.zip' },
    ];
    assert.strictEqual(pickPrimaryMacFeedEntry(uni).url, 'Custody-Note-1.2.3-universal.zip');
    const legacy = [
      { url: 'Custody-Note-1.2.3-arm64.dmg' },
      { url: 'Custody-Note-1.2.3-arm64.zip' },
      { url: 'Custody-Note-1.2.3-x64.zip' },
    ];
    assert.strictEqual(pickPrimaryMacFeedEntry(legacy).url, 'Custody-Note-1.2.3-arm64.zip');
  });

  it('universal-only feed is picked up by electron-updater on BOTH arm64 and Intel Macs', () => {
    // Mirrors electron-updater MacUpdater.filterFilesForArch: arm64 Macs prefer
    // "arm64" files only when some exist, otherwise fall back to the rest.
    const filterFilesForArch = (files, isArm64Mac) => {
      const isArm64File = (f) => f.url.includes('arm64');
      if (isArm64Mac && files.some(isArm64File)) return files.filter((f) => isArm64File(f));
      return files.filter((f) => !isArm64File(f));
    };
    const files = [{ url: 'Custody-Note-1.2.3-universal.zip' }, { url: 'Custody-Note-1.2.3-universal.dmg' }];
    for (const isArm of [true, false]) {
      const picked = filterFilesForArch(files, isArm).find((f) => f.url.endsWith('.zip'));
      assert.ok(picked, `zip found for isArm64Mac=${isArm}`);
      assert.strictEqual(picked.url, 'Custody-Note-1.2.3-universal.zip');
    }
  });

  it('fuses hook skips per-arch temp builds and resets ad-hoc signature on universal', async () => {
    const Module = require('module');
    const calls = [];
    const origLoad = Module._load;
    Module._load = function (request, ...rest) {
      if (request === '@electron/fuses') {
        return {
          FuseVersion: { V1: '1' },
          FuseV1Options: new Proxy({}, { get: (_t, k) => String(k) }),
          flipFuses: async (p, cfg) => { calls.push({ p, cfg }); },
        };
      }
      return origLoad.call(this, request, ...rest);
    };
    try {
      const hookPath = require.resolve(path.join(root, 'scripts', 'flip-electron-fuses.cjs'));
      delete require.cache[hookPath];
      const hook = require(hookPath);
      const ctx = (appOutDir, arch) => ({
        appOutDir,
        arch,
        electronPlatformName: 'darwin',
        packager: { config: {}, appInfo: { productFilename: 'Custody Note' } },
      });
      await hook(ctx('/x/dist/mac-universal-x64-temp', 1));
      await hook(ctx('/x/dist/mac-universal-arm64-temp', 3));
      assert.strictEqual(calls.length, 0, 'temp per-arch builds are skipped');
      await hook(ctx('/x/dist/mac-universal', 4));
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].cfg.resetAdHocDarwinSignature, true);
      assert.match(calls[0].p, /mac-universal[\\/]Custody Note\.app$/);
    } finally {
      Module._load = origLoad;
    }
  });
});
