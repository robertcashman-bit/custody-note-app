const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-publish.yml'), 'utf8');

describe('Microsoft Store AppX/MSIX packaging config', () => {
  it('keeps NSIS artefact naming and adds AppX/MSIX target', () => {
    assert.equal(pkg.build.nsis.artifactName, 'Custody-Note-Setup-${version}.${ext}');
    assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
    const targets = pkg.build.win.target.map((t) => t.target);
    assert.deepEqual(targets.sort(), ['appx', 'nsis'].sort());
    assert.equal(pkg.build.appx.artifactName, 'Custody-Note-${version}.msix');
    assert.equal(pkg.build.appx.electronUpdaterAware, false);
    assert.equal(pkg.build.appId, 'com.custodynote.app');
  });

  it('wires Partner Center Product identity (not placeholders)', () => {
    assert.equal(pkg.build.appx.publisher, 'CN=E2B27EAF-500B-4615-A55C-DB01E913CBC7');
    assert.equal(pkg.build.appx.publisherDisplayName, 'Police Station Agent');
    assert.equal(pkg.build.appx.identityName, 'PoliceStationAgent.CustodyNoteforWindows');
    /* Package/Properties/DisplayName must match the reserved Store name exactly. */
    assert.equal(pkg.build.appx.displayName, 'Custody Note for Windows');
    /* UK-only markets: package must not declare en-US (Partner Center requires a listing per language). */
    assert.deepEqual(pkg.build.appx.languages, ['en-GB']);
    /* NSIS / desktop short name stays separate from Store DisplayName. */
    assert.equal(pkg.build.productName, 'Custody Note');
    const doc = fs.readFileSync(path.join(root, 'docs', 'MICROSOFT_STORE_RELEASE.md'), 'utf8');
    assert.match(doc, /Partner Center/);
    assert.match(doc, /CN=E2B27EAF-500B-4615-A55C-DB01E913CBC7/);
    assert.match(doc, /PoliceStationAgent\.CustodyNoteforWindows/);
    assert.match(doc, /Custody Note for Windows/);
    assert.match(doc, /9NFSRVT3T45V/);
    assert.match(doc, /electron-updater/);
    assert.match(doc, /Package\/Properties\/DisplayName/);
  });

  it('sets Partner Center–acceptable TargetDeviceFamily MinVersion', () => {
    assert.equal(pkg.build.appx.minVersion, '10.0.17763.0');
    assert.equal(pkg.build.appx.maxVersionTested, '10.0.22621.0');
    assert.ok(
      Array.isArray(pkg.build.appx.capabilities) && pkg.build.appx.capabilities.includes('runFullTrust'),
      'runFullTrust must remain declared for Electron full-trust MSIX'
    );
    const doc = fs.readFileSync(path.join(root, 'docs', 'MICROSOFT_STORE_RELEASE.md'), 'utf8');
    assert.match(doc, /10\.0\.17763\.0/);
    assert.match(doc, /runFullTrust/);
    assert.match(doc, /restricted capability/i);
  });

  it('validate:msix gate passes', () => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'validate-msix-config.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /validate:msix\] OK/);
  });

  it('release-windows builds NSIS and MSIX separately; MSIX failure must not block NSIS publish assets', () => {
    assert.match(workflow, /electron-builder --win nsis/);
    assert.match(workflow, /electron-builder --win appx/);
    assert.match(workflow, /release-windows-msix/);
    assert.match(workflow, /continue-on-error:\s*true/);
    assert.match(workflow, /prepare-release-draft:/);
    assert.match(workflow, /upload-single-release-asset\.mjs/);
    const waitScript = fs.readFileSync(path.join(root, 'scripts', 'wait-and-publish-release.mjs'), 'utf8');
    assert.match(waitScript, /Custody-Note-\$\{version\}\.msix/);
    assert.match(waitScript, /Custody-Note-Setup-\$\{version\}\.exe/);
  });

  it('PR Test workflow includes a Windows msix-package job', () => {
    const testWf = fs.readFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'utf8');
    assert.match(testWf, /msix-package:/);
    assert.match(testWf, /electron-builder --win appx --publish never/);
    assert.match(testWf, /custody-note-msix/);
  });

  it('Mac release job remains present and unchanged in structure', () => {
    assert.match(workflow, /release-mac:/);
    assert.match(workflow, /build:mac:signed/);
    assert.match(workflow, /release-mac:\s*\n\s*needs:\s*prepare-release-draft/m);
  });
});
