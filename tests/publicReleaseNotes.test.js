'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  findPublicNotesViolations,
  findViolationsInText,
  buildPublicReleaseBody,
} = require('../lib/publicReleaseNotes');

describe('public release notes (changelog.json)', () => {
  it('changelog.json contains no personal data or internal security detail', () => {
    const changelog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'changelog.json'), 'utf8'));
    const v = findPublicNotesViolations(changelog.releases);
    assert.deepEqual(v, [], 'Rewrite these lines as customer-level notes: ' + JSON.stringify(v.slice(0, 5)));
  });

  it('flags personal email addresses but allows company domains', () => {
    assert.ok(findViolationsInText('Licence added for someone@gmail.com').length > 0);
    assert.deepEqual(findViolationsInText('Support email now uses @defencelegalservices.co.uk'), []);
  });

  it('flags internal implementation detail', () => {
    assert.ok(findViolationsInText('admin IPC channels rate-limited to 5 attempts per minute').length > 0);
    assert.ok(findViolationsInText('PBKDF2 iterations bumped for key escrow').length > 0);
    assert.ok(findViolationsInText('reject padded syncId arrays in outbox').length > 0);
    assert.deepEqual(findViolationsInText('Improved encrypted cross-device sync and recovery reliability'), []);
  });

  it('builds a customer-level GitHub release body', () => {
    const body = buildPublicReleaseBody({ version: '9.9.9', changes: ['Faster PDF export', 'Fix main.js IPC race'] });
    assert.match(body, /Faster PDF export/);
    assert.doesNotMatch(body, /IPC/);
    assert.match(body, /custodynote\.com\/changelog/);
  });
});
