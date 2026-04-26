/**
 * Tests for the new {{#if}}/{{else}}/{{/if}} block syntax,
 * blank-line cleanup, snake_case alias resolution, and the
 * tokens<->friendly-labels conversion helpers.
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

describe('conditional rendering', () => {
  it('keeps the truthy branch when key has a value', () => {
    const out = w.applyQuickEmailTokens(
      'Dear {{#if oicName}}DC {{oicName}}{{else}}Officer{{/if}},',
      { oicName: 'Smith' }
    );
    assert.strictEqual(out.trim(), 'Dear DC Smith,');
  });

  it('uses the else branch when key is missing or blank', () => {
    const blank   = w.applyQuickEmailTokens('Dear {{#if oicName}}DC {{oicName}}{{else}}Officer{{/if}},', { oicName: '' });
    const missing = w.applyQuickEmailTokens('Dear {{#if oicName}}DC {{oicName}}{{else}}Officer{{/if}},', {});
    assert.strictEqual(blank.trim(),   'Dear Officer,');
    assert.strictEqual(missing.trim(), 'Dear Officer,');
  });

  it('removes the whole block when there is no else and value is missing', () => {
    const out = w.applyQuickEmailTokens(
      'Hello.\n{{#if bailConditions}}Conditions: {{bailConditions}}.\n{{/if}}Goodbye.',
      {}
    );
    assert.strictEqual(out.trim(), 'Hello.\nGoodbye.');
  });

  it('collapses multiple blank lines created by stripped conditionals', () => {
    const tpl = 'A\n\n{{#if a}}line a{{/if}}\n\n{{#if b}}line b{{/if}}\n\nB';
    const out = w.applyQuickEmailTokens(tpl, {});
    /* Should not produce 3+ consecutive newlines. */
    assert.ok(!/\n{3,}/.test(out), 'unexpected blank-line run: ' + JSON.stringify(out));
    assert.ok(out.includes('A'));
    assert.ok(out.includes('B'));
  });
});

describe('alias resolution', () => {
  it('snake_case aliases map to canonical values', () => {
    const out = w.applyQuickEmailTokens(
      '{{officer_name}} at {{police_station}} re {{client_name}}.',
      { oicName: 'Lee', station: 'Camden', clientName: 'Alex' }
    );
    assert.strictEqual(out.trim(), 'Lee at Camden re Alex.');
  });

  it('todayDate is auto-populated when missing', () => {
    const out = w.applyQuickEmailTokens('Today is {{today_date}}.', {});
    assert.ok(/Today is \d{2}\/\d{2}\/\d{4}\.$/.test(out.trim()), out);
  });
});

describe('placeholder extraction (with conditionals)', () => {
  it('returns canonical keys from both plain tokens and {{#if}} blocks', () => {
    const keys = w.extractQuickEmailPlaceholderKeys(
      '{{client_name}}',
      '{{#if oicName}}Hi {{oicName}}{{else}}Hi{{/if}} - {{police_station}}'
    );
    assert.ok(keys.includes('clientName'));
    assert.ok(keys.includes('oicName'));
    assert.ok(keys.includes('station'));
    assert.ok(!keys.includes('else'));
    assert.ok(!keys.includes('/if'));
    assert.ok(!keys.includes('#if'));
  });
});

describe('listMissingQuickEmailPlaceholders', () => {
  it('does NOT report fields wrapped in conditionals as missing', () => {
    const missing = w.listMissingQuickEmailPlaceholders(
      '{{clientName}}',
      'Hello {{clientName}}.{{#if bailConditions}} Conditions: {{bailConditions}}.{{/if}}',
      { clientName: 'A' }
    );
    assert.strictEqual(missing.length, 0, JSON.stringify(missing));
  });

  it('reports unconditional missing fields', () => {
    const missing = w.listMissingQuickEmailPlaceholders(
      '',
      'Dear {{clientName}}, station {{station}}.',
      { clientName: 'A' }
    );
    assert.strictEqual(missing.length, 1);
    assert.strictEqual(missing[0].key, 'station');
  });
});

describe('friendly label conversion', () => {
  it('tokensToFriendlyLabels replaces {{clientName}} with [CLIENT NAME]', () => {
    const out = w.tokensToFriendlyLabels('Dear {{oicName}}, regarding {{clientName}}.');
    assert.strictEqual(out, 'Dear [OFFICER NAME], regarding [CLIENT NAME].');
  });

  it('tokensToFriendlyLabels leaves {{#if}} / {{else}} / {{/if}} markers alone', () => {
    const tpl = 'Dear {{#if oicName}}DC {{oicName}}{{else}}Officer{{/if}},';
    const out = w.tokensToFriendlyLabels(tpl);
    assert.ok(out.includes('{{#if oicName}}'));
    assert.ok(out.includes('{{else}}'));
    assert.ok(out.includes('{{/if}}'));
    assert.ok(out.includes('[OFFICER NAME]'));
  });

  it('friendlyLabelsToTokens round-trips known labels', () => {
    const original = 'Dear {{oicName}}, regarding {{clientName}} at {{station}}.';
    const friendly = w.tokensToFriendlyLabels(original);
    const back     = w.friendlyLabelsToTokens(friendly);
    assert.strictEqual(back, original);
  });

  it('friendlyLabelsToTokens accepts snake_case in brackets', () => {
    const out = w.friendlyLabelsToTokens('Dear [client_name].');
    assert.strictEqual(out, 'Dear {{clientName}}.');
  });

  it('friendlyLabelsToTokens preserves unknown bracket text', () => {
    const out = w.friendlyLabelsToTokens('See [Annex A] of [CLIENT NAME].');
    assert.strictEqual(out, 'See [Annex A] of {{clientName}}.');
  });
});
