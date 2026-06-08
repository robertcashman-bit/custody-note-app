/**
 * List Bill button + billing entry helpers (isListBillEnabled, billAttendanceFromList).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJsSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const listJsSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'list.js'), 'utf8');

function extractFunction(source, funcName) {
  const idx = source.indexOf('function ' + funcName);
  if (idx === -1) return null;
  let depth = 0;
  let started = false;
  let end = idx;
  for (let i = idx; i < source.length; i++) {
    if (source[i] === '{') { depth++; started = true; }
    if (source[i] === '}') { depth--; }
    if (started && depth === 0) { end = i + 1; break; }
  }
  return source.substring(idx, end);
}

describe('isListBillEnabled', () => {
  const funcBody = extractFunction(appJsSource, 'isListBillEnabled');
  assert.ok(funcBody, 'isListBillEnabled must exist in app.js');
  const run = new Function(`
    ${funcBody}
    return isListBillEnabled;
  `)();

  it('enables Bill for finalised and completed non-archived records', () => {
    assert.strictEqual(run({ status: 'finalised' }), true);
    assert.strictEqual(run({ status: 'completed' }), true);
  });

  it('disables Bill for draft and archived records', () => {
    assert.strictEqual(run({ status: 'draft' }), false);
    assert.strictEqual(run({ status: 'finalised', archived_at: '2026-01-01' }), false);
  });
});

describe('list Bill button wiring', () => {
  it('list.js renders a Bill button before Edit', () => {
    assert.match(listJsSource, /_renderListBillButtonHtml\(r\)/);
    assert.match(listJsSource, /bill-btn/);
    assert.match(listJsSource, /billAttendanceFromList/);
  });

  it('app.js exposes billAttendanceFromList and matter billing picker', () => {
    assert.match(appJsSource, /window\.billAttendanceFromList\s*=\s*billAttendanceFromList/);
    assert.match(appJsSource, /billableAttendances/);
    assert.match(appJsSource, /getPrimaryRecordActionState/);
    assert.match(appJsSource, /bottom-bar-finish-pill/);
  });
});
