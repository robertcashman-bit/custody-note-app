/**
 * Quick Email built-in templates – unit tests.
 * Templates now ship in data/quick-email-templates.json. We render each
 * template using only its declared required fields and assert the output
 * is clean (no unfilled tokens, no dangling punctuation, no orphan blank
 * paragraphs).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* Load the template engine (sandboxed, no DOM). */
const engineSrc = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'quick-email-template-render.js'),
  'utf8'
);
const sandbox = { window: {} };
vm.runInNewContext(engineSrc, sandbox);
const engine = sandbox.window;

const catalogPath = path.join(__dirname, '..', 'data', 'quick-email-templates.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const templates = catalog.templates;

const FIXTURE = {
  feeEarnerName: 'Robert Cashman',
  oicName:       'Jones',
  clientName:    'John Doe',
  station:       'Holborn',
  offenceType:   'ABH',
  date:          '18/04/2026',
  time:          '2 p.m.'
};

function renderWithRequiredOnly(tpl, extra) {
  const map = Object.assign({}, extra || {});
  /* Always include fee-earner so the sign-off is clean. */
  map.feeEarnerName = FIXTURE.feeEarnerName;
  /* Provide every declared required field from the fixture. */
  (tpl.requiredFields || []).forEach((k) => {
    if (FIXTURE[k] != null) map[k] = FIXTURE[k];
  });
  return engine.renderQuickEmailFromTemplates(tpl.subjectTemplate, tpl.bodyTemplate, map);
}

describe('Quick Email system templates (data/quick-email-templates.json)', () => {
  it('ships the expected 5 templates', () => {
    assert.ok(Array.isArray(templates), 'templates array missing');
    assert.strictEqual(templates.length, 5);
    const ids = templates.map((t) => t.id).sort();
    assert.deepStrictEqual(
      ids,
      [
        'system:bail-details',
        'system:disclosure',
        'system:follow-up',
        'system:representation',
        'system:voluntary-attendance'
      ]
    );
  });

  it('every template has id, name, category, description, subject, body, requiredFields', () => {
    for (const tpl of templates) {
      assert.ok(tpl.id, 'missing id');
      assert.ok(tpl.name, 'missing name');
      assert.ok(tpl.category, tpl.id + ' missing category');
      assert.ok(typeof tpl.description === 'string' && tpl.description.length, tpl.id + ' missing description');
      assert.ok(tpl.subjectTemplate, tpl.id + ' missing subjectTemplate');
      assert.ok(tpl.bodyTemplate, tpl.id + ' missing bodyTemplate');
      assert.ok(Array.isArray(tpl.requiredFields), tpl.id + ' requiredFields not array');
    }
  });

  it('renders cleanly with only required fields populated (no dangling tokens / punctuation)', () => {
    for (const tpl of templates) {
      const out = renderWithRequiredOnly(tpl);
      const ctx = '\n--- ' + tpl.id + ' subject:\n' + out.subject + '\n--- body:\n' + out.body + '\n---';
      assert.ok(!out.body.includes('{{'),       tpl.id + ' body has raw token' + ctx);
      assert.ok(!out.subject.includes('{{'),    tpl.id + ' subject has raw token' + ctx);
      assert.ok(!/\n{3,}/.test(out.body),       tpl.id + ' body has 3+ blank lines' + ctx);
      assert.ok(!/Dear DC ,/.test(out.body),    tpl.id + ' body has dangling "Dear DC ,"' + ctx);
      assert.ok(!/ on \./.test(out.body),       tpl.id + ' body has dangling " on ."' + ctx);
      assert.ok(!/regarding \./.test(out.body), tpl.id + ' body has dangling "regarding ."' + ctx);
    }
  });

  it('falls back to "Dear Officer" when oicName is empty', () => {
    const tpl = templates.find((t) => t.id === 'system:bail-details');
    const out = engine.renderQuickEmailFromTemplates(
      tpl.subjectTemplate,
      tpl.bodyTemplate,
      { clientName: 'Jane', station: 'Paddington', feeEarnerName: 'RC' }
    );
    assert.ok(out.body.startsWith('Dear Officer,'), 'expected "Dear Officer," fallback, got: ' + out.body.slice(0, 40));
  });

  it('uses "Dear Officer <name>" when oicName is a bare name (no rank duplication)', () => {
    /* v1.6.4 — system templates use {{officerSalutation}} which adds
       "Officer " in front of bare names but leaves rank-prefixed names
       alone. So "Jones" → "Officer Jones" (was "DC Jones"). */
    const tpl = templates.find((t) => t.id === 'system:bail-details');
    const out = renderWithRequiredOnly(tpl, { oicName: 'Jones' });
    assert.ok(out.body.startsWith('Dear Officer Jones,'),
      'expected "Dear Officer Jones," got: ' + out.body.slice(0, 60));
  });

  it('preserves rank when oicName already includes one (e.g. DC, Sgt, Inspector)', () => {
    const tpl = templates.find((t) => t.id === 'system:bail-details');
    for (const name of ['DC Jones', 'PC Khan', 'Sgt Patel', 'Inspector Wood', 'Detective Chen']) {
      const out = renderWithRequiredOnly(tpl, { oicName: name });
      assert.ok(out.body.startsWith('Dear ' + name + ','),
        'expected "Dear ' + name + '," got: ' + out.body.slice(0, 60));
    }
  });

  it('disclosure template subject contains client + station', () => {
    const tpl = templates.find((t) => t.id === 'system:disclosure');
    const out = renderWithRequiredOnly(tpl);
    assert.ok(out.subject.includes('John Doe'));
    assert.ok(out.subject.includes('Holborn'));
    assert.ok(out.subject.toLowerCase().includes('disclosure'));
  });
});

describe('Quick Email modal source integrity (template-first refactor)', () => {
  const modalSrc = fs.readFileSync(
    path.join(__dirname, '..', 'renderer', 'views', 'email-modal.js'),
    'utf8'
  );

  it('uses the new catalog API (no _QUICK_BUILTIN_TEMPLATES, no quick-email-crn)', () => {
    assert.ok(!modalSrc.includes('_QUICK_BUILTIN_TEMPLATES'), 'old built-in array still present');
    assert.ok(!modalSrc.includes('quick-email-crn'),         'old crn input still present');
    assert.ok(!modalSrc.includes('quick-email-dscc-ref'),    'old dscc-ref input still present');
  });

  it('relies on getQuickEmailCatalog and getFieldsUsedByTemplate', () => {
    assert.ok(modalSrc.includes('getQuickEmailCatalog'));
    assert.ok(modalSrc.includes('getFieldsUsedByTemplate'));
  });
});
