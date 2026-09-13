/**
 * tests/windowsAzureSigning.test.js
 * ----------------------------------------------------------------------------
 * Locks Windows Azure Artifact Signing posture:
 *   - Default package.json build.win does NOT set azureSignOptions (unsigned
 *     local / PR builds must not force the Azure sign manager).
 *   - release-windows uses OIDC (id-token + azure/login) and CLI
 *     -c.win.azureSignOptions.* when signing is enabled.
 *   - Tag releases (and CN_WINDOWS_SIGN=1) fail closed without secrets.
 *   - electron-builder is new enough for DefaultAzureCredential / OIDC.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const win = (pkg.build && pkg.build.win) || {};
const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-publish.yml'), 'utf8');
const signingDoc = fs.readFileSync(path.join(root, 'SIGNING.md'), 'utf8');

function electronBuilderVersion() {
  const raw = pkg.devDependencies && pkg.devDependencies['electron-builder'];
  assert.ok(raw, 'electron-builder must be a devDependency');
  const m = String(raw).match(/(\d+)\.(\d+)\.(\d+)/);
  assert.ok(m, `unexpected electron-builder version string: ${raw}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), raw };
}

describe('Windows signing — Azure Artifact Signing posture', () => {
  it('default build.win does NOT embed azureSignOptions (CLI-only in CI)', () => {
    assert.strictEqual(
      win.azureSignOptions,
      undefined,
      'build.win.azureSignOptions must stay unset so unsigned local builds work'
    );
  });

  it('pins electron-builder new enough for OIDC / DefaultAzureCredential Azure signing', () => {
    const v = electronBuilderVersion();
    const ok =
      v.major > 26 ||
      (v.major === 26 && v.minor > 15) ||
      (v.major === 26 && v.minor === 15 && v.patch >= 0);
    assert.ok(ok, `electron-builder ${v.raw} is too old for Azure OIDC signing (need >= 26.15)`);
  });

  it('release-windows uses the windows-signing environment for OIDC subject matching', () => {
    const jobIdx = wf.indexOf('release-windows:');
    assert.ok(jobIdx !== -1);
    const nextJob = wf.indexOf('\n  release-mac:', jobIdx + 1);
    const block = wf.slice(jobIdx, nextJob === -1 ? undefined : nextJob);
    assert.match(block, /environment:\s*windows-signing/);
  });

  it('release-windows requests OIDC token permissions', () => {
    const jobIdx = wf.indexOf('release-windows:');
    assert.ok(jobIdx !== -1);
    const nextJob = wf.indexOf('\n  release-mac:', jobIdx + 1);
    const block = wf.slice(jobIdx, nextJob === -1 ? undefined : nextJob);
    assert.match(block, /contents:\s*write/);
    assert.match(block, /id-token:\s*write/);
  });

  it('release-windows authenticates with azure/login and Artifact Signing secrets', () => {
    assert.match(wf, /uses:\s*azure\/login@v/);
    for (const k of [
      'AZURE_CLIENT_ID',
      'AZURE_TENANT_ID',
      'AZURE_SUBSCRIPTION_ID',
      'AZURE_CODE_SIGNING_ENDPOINT',
      'AZURE_CODE_SIGNING_ACCOUNT_NAME',
      'AZURE_CERTIFICATE_PROFILE_NAME',
      'AZURE_TRUSTED_SIGNING_PUBLISHER_NAME',
    ]) {
      assert.match(wf, new RegExp(`secrets\\.${k}`), `expected workflow to reference secrets.${k}`);
    }
  });

  it('passes azureSignOptions via electron-builder CLI when signing is enabled', () => {
    assert.match(wf, /electron-builder --win --publish always/);
    assert.match(wf, /-c\.win\.azureSignOptions\.publisherName=/);
    assert.match(wf, /-c\.win\.azureSignOptions\.endpoint=/);
    assert.match(wf, /-c\.win\.azureSignOptions\.codeSigningAccountName=/);
    assert.match(wf, /-c\.win\.azureSignOptions\.certificateProfileName=/);
  });

  it('fails closed on tag releases or CN_WINDOWS_SIGN=1 when secrets are missing', () => {
    assert.match(wf, /refs\/tags\/v\*/);
    assert.match(wf, /CN_WINDOWS_SIGN/);
    assert.match(wf, /Windows Azure Artifact Signing is required/);
    assert.match(wf, /Building unsigned Windows installer/);
  });

  it('SIGNING.md documents Azure Artifact Signing Basic + publisher legal name', () => {
    assert.match(signingDoc, /Azure Artifact Signing/);
    assert.match(signingDoc, /DEFENCELEGALSERVICES LIMITED/);
    assert.match(signingDoc, /Organization:\s*`robertcashman-bit`/);
    assert.match(signingDoc, /Repository:\s*`custody-note-app`/);
    assert.match(signingDoc, /Environment name:\s*`windows-signing`/);
    assert.match(signingDoc, /YOUR_ACCOUNT/);
    assert.match(signingDoc, /https:\/\/eus\.codesigning\.azure\.net\//);
    assert.match(signingDoc, /Federated credentials|OIDC/i);
  });
});
