/**
 * Source guard: Email my key UI must not invent success on sent:false,
 * and must surface correlationId on failures.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const payloadJs = fs.readFileSync(
  path.join(__dirname, '..', 'main', 'licenceEmailKeyPayload.js'),
  'utf8',
);

describe('licence email-key UI honesty (source)', () => {
  it('settings Email my key treats sent:false as error with Ref', () => {
    assert.match(appJs, /btn-licence-email-key/);
    assert.match(appJs, /r\.ok && r\.sent !== false/);
    assert.match(appJs, /r\.correlationId\) err \+= ' \(Ref: ' \+ r\.correlationId/);
  });

  it('requestLicenceKeyEmail maps sent:false to success:false with Ref', () => {
    assert.match(appJs, /window\.requestLicenceKeyEmail/);
    assert.match(appJs, /success: false, message: failMsg/);
    assert.match(appJs, /r\.correlationId\) failMsg \+= ' \(Ref: '/);
  });

  it('main licence:email-key uses retry orchestrator and never logs full keys', () => {
    assert.match(mainJs, /requestLicenceEmailKeyWithRetry/);
    assert.match(mainJs, /Never log full licence keys/);
    assert.doesNotMatch(mainJs, /console\.(info|log|error)\([^)]*payload\.key/);
    assert.doesNotMatch(payloadJs, /console\.(info|log|error)\([^)]*\.key/);
  });
});
