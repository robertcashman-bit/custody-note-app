/**
 * Unit tests for renderer/quick-email-template-render.js (token aliases + extraction).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'quick-email-template-render.js'),
  'utf8'
);
const sandbox = { window: {} };
vm.runInNewContext(src, sandbox);
const w = sandbox.window;

describe('quick-email-template-render', () => {
  it('resolves officerName / policeStation / offence aliases', () => {
    const map = {
      oicName: 'Gray',
      station: 'Maidstone',
      offenceType: 'Theft'
    };
    const body = 'Dear {{officerName}}, at {{policeStation}} re {{offence}}.';
    const out = w.applyQuickEmailTokens(body, map);
    assert.ok(out.includes('Gray'), out);
    assert.ok(out.includes('Maidstone'), out);
    assert.ok(out.includes('Theft'), out);
    assert.ok(!out.includes('{{'), out);
  });

  it('extractQuickEmailPlaceholderKeys returns canonical keys', () => {
    const keys = w.extractQuickEmailPlaceholderKeys(
      '{{officerName}} - test',
      'Hi {{policeStation}} and {{offence}}'
    );
    assert.strictEqual(keys.length, 3);
    assert.ok(keys.includes('oicName'));
    assert.ok(keys.includes('station'));
    assert.ok(keys.includes('offenceType'));
  });

  it('listMissingQuickEmailPlaceholders detects empty canonical values', () => {
    const missing = w.listMissingQuickEmailPlaceholders(
      '{{clientName}}',
      '{{oicName}}',
      { clientName: 'A', oicName: '' }
    );
    assert.strictEqual(missing.length, 1);
    assert.strictEqual(missing[0].key, 'oicName');
  });
});
