'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAdminLicence,
  shouldSkipOnlineValidation,
  applyOnlineValidationResult,
} = require('../main/licenceValidationPolicy');

const ADMIN = 'owner@example.com';
const ADMINS = [ADMIN];

describe('licenceValidationPolicy', () => {
  it('recognises admin licences by email', () => {
    assert.equal(isAdminLicence({ email: ADMIN, key: 'CN-1' }, ADMINS), true);
    assert.equal(isAdminLicence({ email: 'user@example.com', key: 'CN-1' }, ADMINS), false);
  });

  it('skips online validation for synthetic Free/trial without auth', () => {
    assert.equal(shouldSkipOnlineValidation({ key: 'FREE-ABC', status: 'active' }), true);
    assert.equal(shouldSkipOnlineValidation({ key: 'TRIAL-ABC', status: 'active' }), true);
    assert.equal(
      shouldSkipOnlineValidation({ key: 'FREE-ABC', authToken: 'tok', status: 'active' }),
      false
    );
    assert.equal(shouldSkipOnlineValidation({ key: 'CN-AAAA-BBBB-CCCC-DDDD' }), false);
  });

  it('never persists revoked for admin when server says invalid', () => {
    const data = {
      key: 'CN-AAAA-BBBB-CCCC-DDDD',
      email: ADMIN,
      status: 'active',
    };
    const apply = applyOnlineValidationResult(
      data,
      { valid: false, serverStatus: 'revoked', message: 'revoked' },
      { adminEmails: ADMINS }
    );
    assert.equal(apply.skippedPersistRevoke, true);
    assert.equal(data.status, 'active');
  });

  it('clears a stale revoked stamp for admin', () => {
    const data = {
      key: 'CN-AAAA-BBBB-CCCC-DDDD',
      email: ADMIN,
      status: 'revoked',
    };
    const apply = applyOnlineValidationResult(
      data,
      { valid: false, serverStatus: 'revoked' },
      { adminEmails: ADMINS }
    );
    assert.equal(apply.clearedRevoked, true);
    assert.equal(data.status, 'active');
  });

  it('does not stamp Free keys as revoked', () => {
    const data = { key: 'FREE-ABCDEF0123456789', status: 'active' };
    const apply = applyOnlineValidationResult(
      data,
      { valid: false, serverStatus: 'revoked' },
      { adminEmails: ADMINS }
    );
    assert.equal(apply.skippedPersistRevoke, true);
    assert.equal(apply.persisted, false);
    assert.equal(data.status, 'active');
  });

  it('persists revoked for ordinary paid licences', () => {
    const data = {
      key: 'CN-AAAA-BBBB-CCCC-DDDD',
      email: 'user@example.com',
      status: 'active',
    };
    const apply = applyOnlineValidationResult(
      data,
      { valid: false, serverStatus: 'revoked' },
      { adminEmails: ADMINS }
    );
    assert.equal(apply.persisted, true);
    assert.equal(data.status, 'revoked');
  });

  it('defaults missing serverStatus to revoked for ordinary licences', () => {
    const data = {
      key: 'CN-AAAA-BBBB-CCCC-DDDD',
      email: 'user@example.com',
      status: 'active',
    };
    applyOnlineValidationResult(data, { valid: false }, { adminEmails: ADMINS });
    assert.equal(data.status, 'revoked');
  });

  it('on valid response clears revoked and refreshes fields', () => {
    const data = {
      key: 'CN-AAAA-BBBB-CCCC-DDDD',
      email: 'user@example.com',
      status: 'revoked',
    };
    const apply = applyOnlineValidationResult(
      data,
      {
        valid: true,
        email: 'user@example.com',
        expiresAt: '2099-01-01T00:00:00.000Z',
        serverStatus: 'active',
      },
      { adminEmails: ADMINS }
    );
    assert.equal(apply.clearedRevoked, false);
    assert.equal(data.status, 'active');
    assert.equal(data.expiresAt, '2099-01-01T00:00:00.000Z');
    assert.ok(data.lastValidated);
  });

  it('a valid free tier clears entitlements and a later pro tier upgrades', () => {
    const data = {
      key: 'CNF-AAAA-BBBB-CCCC-DDDD',
      status: 'active',
      tier: 'free',
      entitlements: { quickfile: { expiresAt: '2099-01-01' } },
      cloudBackup: true,
    };
    applyOnlineValidationResult(data, {
      valid: true,
      tier: 'free',
      plan: 'free_sync',
      serverStatus: 'active',
      entitlements: { quickfile: { expiresAt: '2099-01-01' } },
    }, { adminEmails: ADMINS });
    assert.equal(data.tier, 'free');
    assert.equal(data.entitlements, null);
    assert.equal(data.cloudBackup, false);

    applyOnlineValidationResult(data, {
      valid: true,
      tier: 'pro',
      serverStatus: 'active',
      entitlements: { quickfile: { expiresAt: '2099-06-01' } },
    }, { adminEmails: ADMINS });
    assert.equal(data.tier, 'pro');
    assert.equal(data.isFree, false);
    assert.ok(data.entitlements && data.entitlements.quickfile);
  });
});
