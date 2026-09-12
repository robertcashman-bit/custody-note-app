/**
 * Source guard: Email my licence key has one Settings recovery path (+ overlay),
 * must not invent success on sent:false, and must surface correlationId on failures.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const licenceJs = fs.readFileSync(path.join(root, 'renderer', 'licence.js'), 'utf8');
const licenceIpcJs = fs.readFileSync(path.join(root, 'main', 'licenceIpc.js'), 'utf8');
const payloadJs = fs.readFileSync(path.join(root, 'main', 'licenceEmailKeyPayload.js'), 'utf8');

function countMatches(source, pattern) {
  const re = new RegExp(pattern, 'g');
  return (source.match(re) || []).length;
}

describe('licence email-key UI entry points (source)', () => {
  it('keeps one Settings recovery control and one overlay control', () => {
    assert.match(indexHtml, /id="licence-email-key-btn"/);
    assert.match(indexHtml, /id="licence-email-key-email"/);
    assert.match(indexHtml, /id="licence-email-key-recovery"/);
    assert.match(indexHtml, /id="overlay-forgot-licence-btn"/);
    // Removed duplicates
    assert.doesNotMatch(indexHtml, /id="btn-licence-email-key"/);
    assert.doesNotMatch(indexHtml, /id="forgot-licence-btn"/);
    assert.doesNotMatch(indexHtml, /id="forgot-licence-email"/);
    assert.doesNotMatch(indexHtml, /id="licence-none-forgot-btn"/);
    assert.doesNotMatch(indexHtml, /id="licence-grace-forgot-email"/);
    assert.doesNotMatch(indexHtml, /id="btn-licence-grace-email-key"/);
    // Support links to Settings instead of a second form
    assert.match(indexHtml, /id="forgot-licence-goto-settings-btn"/);
  });

  it('has exactly one Settings Email my licence key button and one overlay button', () => {
    assert.equal(countMatches(indexHtml, 'id="licence-email-key-btn"'), 1);
    assert.equal(countMatches(indexHtml, 'id="overlay-forgot-licence-btn"'), 1);
    assert.equal(countMatches(indexHtml, 'id="forgot-licence-goto-settings-btn"'), 1);
  });

  it('keeps magic-link Send login link distinct from email-key', () => {
    assert.match(indexHtml, /magic-link-send-btn/);
    assert.match(licenceJs, /Send login link/);
    assert.doesNotMatch(indexHtml, /id="magic-link-send-btn"[^>]*>Email my licence key/);
  });
});

describe('licence email-key UI honesty (source)', () => {
  it('Settings recovery always calls licenceEmailKey and treats sent:false as error with Ref', () => {
    assert.match(appJs, /licence-email-key-btn/);
    assert.match(appJs, /window\.api\.licenceEmailKey\(payload\)/);
    assert.match(appJs, /r\.ok && r\.sent !== false/);
    assert.match(appJs, /r\.correlationId\) failMsg \+= ' \(Ref: ' \+ r\.correlationId/);
    assert.doesNotMatch(appJs, /custodyNote\.requestLicenceEmail\(email\)/);
    assert.doesNotMatch(appJs, /btn-licence-email-key/);
  });

  it('requestLicenceKeyEmail allows empty typed email for activated-key path', () => {
    assert.match(appJs, /window\.requestLicenceKeyEmail/);
    assert.match(appJs, /var payload = typed \? \{ email: typed \} : \{\}/);
  });

  it('overlay email-key uses licenceEmailKey, not legacy requestLicenceEmail', () => {
    assert.match(licenceJs, /licenceEmailKey\(\{ email: email \}\)/);
    assert.doesNotMatch(licenceJs, /requestLicenceEmail\(email\)/);
  });

  it('main licence:email-key uses retry orchestrator, rate-limits honestly, never logs full keys', () => {
    assert.match(mainJs, /requestLicenceEmailKeyWithRetry/);
    assert.match(mainJs, /requestLicenceEmailRateLimit\.checkRateLimit/);
    assert.match(mainJs, /Too many requests\. Please wait a minute/);
    assert.match(mainJs, /Never log full licence keys/);
    assert.doesNotMatch(mainJs, /console\.(info|log|error)\([^)]*payload\.key/);
    assert.doesNotMatch(payloadJs, /console\.(info|log|error)\([^)]*\.key/);
  });

  it('legacy custody:requestLicenceEmail does not fake success on rate limit or bad email', () => {
    assert.match(licenceIpcJs, /Enter a valid email address/);
    assert.match(licenceIpcJs, /Too many requests\. Please wait a minute/);
    const handlerSlice = licenceIpcJs.slice(
      licenceIpcJs.indexOf("ipcMain.handle('custody:requestLicenceEmail'"),
      licenceIpcJs.indexOf("ipcMain.handle('custody:adminLogin'"),
    );
    assert.doesNotMatch(handlerSlice, /if \(!validateEmail\(email\)\) return GENERIC_SUCCESS/);
    assert.doesNotMatch(
      handlerSlice,
      /if \(!requestLicenceEmailRateLimit\.checkRateLimit\(\)\) \{\s*return GENERIC_SUCCESS/,
    );
  });
});
