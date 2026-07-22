const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isProAiEntitled, describeProAiGate } = require('../main/proAiEntitlement');

describe('proAiEntitlement scaffold', () => {
  it('allows active Pro only', () => {
    assert.equal(isProAiEntitled({ tier: 'pro', status: 'active' }), true);
    assert.equal(isProAiEntitled({ tier: 'free', status: 'active' }), false);
    assert.equal(isProAiEntitled({ tier: 'pro', status: 'revoked' }), false);
  });

  it('describeProAiGate returns stable reason codes', () => {
    assert.equal(describeProAiGate({ tier: 'pro', status: 'active' }).reason, 'PRO_AI_ENTITLED');
    assert.equal(describeProAiGate({ tier: 'free', status: 'active' }).reason, 'PRO_AI_NOT_ENTITLED');
  });
});
