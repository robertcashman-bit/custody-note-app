'use strict';

/**
 * Note-writing textareas (Narrative / Disclosure Notes, etc.) must expand by
 * default — not gated on html.larger-textareas — so long pastes are usable.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const styles = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

describe('note-writing textarea expand-by-default', () => {
  it('defines .note-writing-textarea with a soft max-height (not the C9 8.5em cap)', () => {
    assert.match(styles, /\.form-group\s+textarea\.note-writing-textarea\s*\{/);
    const noteBlock = styles.match(
      /\.form-group\s+textarea\.note-writing-textarea\s*\{[^}]+\}/
    );
    assert.ok(noteBlock, 'note-writing-textarea rule missing');
    assert.match(noteBlock[0], /max-height:\s*min\(70vh,\s*48em\)/);
    assert.ok(!/max-height:\s*8\.5em/.test(noteBlock[0]), 'must not keep the C9 8.5em cap');
    assert.match(noteBlock[0], /resize:\s*vertical/);
  });

  it('overrides focus max-height so note fields are not clamped to 14em', () => {
    assert.match(
      styles,
      /\.form-group\s+textarea\.note-writing-textarea:focus\s*\{[\s\S]*?max-height:\s*min\(70vh,\s*48em\)/
    );
  });

  it('still allows Settings → larger-textareas to uncap note fields fully', () => {
    assert.match(
      styles,
      /html\.larger-textareas\s+\.form-group\s+textarea\.note-writing-textarea\s*\{[\s\S]*?max-height:\s*none/
    );
  });

  it('marks the Timestamp note keys with note-writing-textarea in app.js', () => {
    assert.match(appSrc, /NOTE_WRITING_TEXTAREA_KEYS/);
    assert.match(appSrc, /isNoteWritingTextareaKey/);
    assert.match(appSrc, /note-writing-textarea/);
    for (const key of [
      'disclosureNarrative',
      'clientInstructions',
      'clientInstructionsDetail',
      'reasonsForAdvice',
      'firstContactOver45MinsReason',
    ]) {
      assert.ok(
        appSrc.includes("'" + key + "'"),
        'expected NOTE_WRITING_TEXTAREA_KEYS to include ' + key
      );
    }
    assert.match(appSrc, /classList\.add\('note-writing-textarea'\)/);
    assert.match(appSrc, /fitNoteWritingTextarea/);
  });
});
