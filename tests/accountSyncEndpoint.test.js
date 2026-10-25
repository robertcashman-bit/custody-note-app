'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const accountSyncEndpoint = require('../lib/accountSyncEndpoint');

describe('accountSyncEndpoint graceful degradation', () => {
  it('detects 404 / not-found style server errors', () => {
    assert.strictEqual(accountSyncEndpoint.isAccountSyncEndpointMissingError('HTTP 404'), true);
    assert.strictEqual(accountSyncEndpoint.isAccountSyncEndpointMissingError('Not Found'), true);
    assert.strictEqual(accountSyncEndpoint.isAccountSyncEndpointMissingError('Unexpected token < in JSON'), true);
    assert.strictEqual(accountSyncEndpoint.isAccountSyncEndpointMissingError('DEVICE_REVOKED'), false);
  });

  it('exposes user-facing OpenAI not-live copy', () => {
    assert.match(accountSyncEndpoint.OPENAI_SYNC_NOT_LIVE_USER_MESSAGE, /custodynote\.com/i);
    assert.match(accountSyncEndpoint.OPENAI_SYNC_NOT_LIVE_USER_MESSAGE, /Enter your key/i);
  });
});
