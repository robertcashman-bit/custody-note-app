'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

describe('httpPost stats endpoints', () => {
  it('treats 204/205 and empty bodies as success (heartbeat returns 204)', () => {
    const start = mainJs.indexOf('function httpPost');
    assert.ok(start > 0);
    const body = mainJs.slice(start, start + 3500);
    assert.match(body, /res\.statusCode === 204/);
    assert.match(body, /!String\(data \|\| ''\)\.trim\(\)/);
  });
});
