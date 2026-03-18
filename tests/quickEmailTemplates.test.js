/**
 * Quick Email built-in templates – unit tests
 * Verifies that the disclosure and bail templates exist in email-modal.js,
 * use the correct placeholder tokens, and produce expected output
 * when placeholders are substituted.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const modalSrc = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'views', 'email-modal.js'),
  'utf8'
);

// Extract the _QUICK_BUILTIN_TEMPLATES array from source via regex so we can
// test it without needing a DOM / Electron runtime.
function extractBuiltinTemplates(src) {
  var match = src.match(
    /var _QUICK_BUILTIN_TEMPLATES\s*=\s*(\[[\s\S]*?\n\s*\]);/
  );
  if (!match) return null;
  // The array uses single-quoted strings with \n escapes – eval is safe here
  // because we control the source and it's a static array literal.
  return eval('(' + match[1] + ')');
}

function applyPlaceholders(text, map) {
  return String(text || '').replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    function (_, key) {
      return map[key] != null ? String(map[key]) : '';
    }
  );
}

const templates = extractBuiltinTemplates(modalSrc);

describe('Quick Email built-in templates', () => {
  it('_QUICK_BUILTIN_TEMPLATES array is present in source', () => {
    assert.ok(templates, '_QUICK_BUILTIN_TEMPLATES not found in email-modal.js');
    assert.ok(Array.isArray(templates));
  });

  it('contains exactly 2 built-in templates (disclosure, bail)', () => {
    assert.strictEqual(templates.length, 2);
    const ids = templates.map((t) => t.id);
    assert.ok(ids.includes('builtin:disclosure'));
    assert.ok(ids.includes('builtin:bail'));
  });

  it('each template has id, name, subject, and body', () => {
    for (const tpl of templates) {
      assert.ok(tpl.id, 'missing id');
      assert.ok(tpl.name, 'missing name');
      assert.ok(tpl.subject, 'missing subject');
      assert.ok(tpl.body, 'missing body');
    }
  });

  it('templates do NOT reference {{crn}} or {{dsccRef}}', () => {
    for (const tpl of templates) {
      assert.ok(!tpl.body.includes('{{crn}}'), tpl.name + ' body still references {{crn}}');
      assert.ok(!tpl.body.includes('{{dsccRef}}'), tpl.name + ' body still references {{dsccRef}}');
      assert.ok(!tpl.subject.includes('{{crn}}'), tpl.name + ' subject still references {{crn}}');
      assert.ok(!tpl.subject.includes('{{dsccRef}}'), tpl.name + ' subject still references {{dsccRef}}');
    }
  });

  it('templates use only valid placeholder tokens', () => {
    const validKeys = [
      'clientName', 'oicName', 'station', 'offenceType',
      'feeEarnerName', 'date', 'time', 'contactName',
      'firmName', 'outcome', 'nextStep', 'followUp',
      'attendanceType', 'ourFileNumber', 'ufn'
    ];
    for (const tpl of templates) {
      const used = [];
      (tpl.subject + tpl.body).replace(
        /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
        (_, key) => { used.push(key); }
      );
      for (const key of used) {
        assert.ok(
          validKeys.includes(key),
          tpl.name + ' uses unknown placeholder: {{' + key + '}}'
        );
      }
    }
  });

  it('disclosure template produces expected output', () => {
    const tpl = templates.find((t) => t.id === 'builtin:disclosure');
    const map = {
      oicName: 'Smith',
      clientName: 'John Doe',
      station: 'Holborn',
      date: '18/03/2026',
      feeEarnerName: 'Robert Cashman'
    };
    const body = applyPlaceholders(tpl.body, map);
    assert.ok(body.includes('Dear DC Smith'));
    assert.ok(body.includes('John Doe'));
    assert.ok(body.includes('Holborn'));
    assert.ok(body.includes('18/03/2026'));
    assert.ok(body.includes('provide disclosure'));
    assert.ok(body.includes('Robert Cashman'));
    assert.ok(!body.includes('{{'), 'unfilled placeholder in output');
  });

  it('bail template produces expected output', () => {
    const tpl = templates.find((t) => t.id === 'builtin:bail');
    const map = {
      oicName: 'Jones',
      clientName: 'Jane Smith',
      station: 'Paddington',
      date: '18/03/2026',
      feeEarnerName: 'Robert Cashman'
    };
    const body = applyPlaceholders(tpl.body, map);
    assert.ok(body.includes('Dear DC Jones'));
    assert.ok(body.includes('Jane Smith'));
    assert.ok(body.includes('Paddington'));
    assert.ok(body.includes('18/03/2026'));
    assert.ok(body.includes('police bail'));
    assert.ok(body.includes('Robert Cashman'));
    assert.ok(!body.includes('{{'), 'unfilled placeholder in output');
  });

  it('subject lines fill placeholders correctly', () => {
    const map = { clientName: 'Alice', station: 'Camden' };
    for (const tpl of templates) {
      const subject = applyPlaceholders(tpl.subject, map);
      assert.ok(subject.includes('Alice'), tpl.name + ' subject missing clientName');
      assert.ok(subject.includes('Camden'), tpl.name + ' subject missing station');
      assert.ok(!subject.includes('{{'), tpl.name + ' subject has unfilled placeholder');
    }
  });
});

describe('Quick Email modal source integrity', () => {
  it('template dropdown includes Built-in optgroup', () => {
    assert.ok(modalSrc.includes("'<optgroup label=\"Built-in\">"));
  });

  it('_getBuiltinTemplateById helper is defined', () => {
    assert.ok(modalSrc.includes('function _getBuiltinTemplateById('));
  });

  it('_applyCustomTemplate tries built-in before custom', () => {
    assert.ok(modalSrc.includes('_getBuiltinTemplateById(templateId) || _getCustomTemplateByIdQuick(templateId)'));
  });

  it('no references to crn or dsccRef input fields remain', () => {
    assert.ok(!modalSrc.includes('quick-email-crn'), 'quick-email-crn input still present');
    assert.ok(!modalSrc.includes('quick-email-dscc-ref'), 'quick-email-dscc-ref input still present');
  });
});
