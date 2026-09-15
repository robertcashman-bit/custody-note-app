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

  it('documents Partner Center publisher placeholder (not a secret)', () => {
    assert.equal(pkg.build.appx.publisher, 'CN=DEFENCELEGALSERVICES LIMITED');
    assert.equal(pkg.build.appx.publisherDisplayName, 'DEFENCELEGALSERVICES LIMITED');
    assert.equal(pkg.build.appx.identityName, 'DefenceLegalServices.CustodyNote');
    const doc = fs.readFileSync(path.join(root, 'docs', 'MICROSOFT_STORE_RELEASE.md'), 'utf8');
    assert.match(doc, /Partner Center/);
    assert.match(doc, /CN=DEFENCELEGALSERVICES LIMITED/);
    assert.match(doc, /electron-updater/);
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
    /* publish-release must still require NSIS updater assets, not MSIX */
    assert.match(workflow, /Custody-Note-Setup-\$\{VERSION\}\.exe/);
    assert.doesNotMatch(
      workflow,
      /REQUIRED=\([\s\S]*Custody-Note-\$\{VERSION\}\.msix/
    );
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
    assert.match(workflow, /needs:\s*\[release-windows,\s*release-mac\]/);
  });
});
