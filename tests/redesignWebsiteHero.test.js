const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');

describe('redesign-website-hero script', () => {
  test('script exists and targets product-first hero markers', () => {
    const p = join(root, 'scripts/redesign-website-hero.mjs');
    assert.ok(existsSync(p));
    const src = readFileSync(p, 'utf8');
    assert.match(src, /product-first \(Clio \/ LEAP pattern\)/);
    assert.match(src, /Watch demo/);
    assert.match(src, /hero-main-ui\.webp/);
    assert.match(src, /Structured PACE notes that work offline/);
    assert.doesNotMatch(src, /v\{version\} — UK criminal defence/);
    assert.match(src, /FloatingTrialCta/);
    assert.match(src, /No lightning/);
  });
});
