'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { extractTextAndCitations } = require('../main/openaiClient');
const { validateAiLegalResponse } = require('../main/aiAccuracyPolicy');
const { cleanLawElementsNoteText, demarkdownForNote } = require('../main/aiNoteTextCleanup');

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'openai-law-theft-response.json'), 'utf8'),
);

describe('aiNoteTextCleanup — theft fixture', () => {
  it('cleans real OpenAI Responses output to plain attendance-note text', () => {
    const parsed = extractTextAndCitations(FIXTURE);
    assert.ok(parsed.text.length > 200);
    assert.ok(parsed.citations.length >= 2);

    const validated = validateAiLegalResponse({
      text: parsed.text,
      citations: parsed.citations,
      noteMode: 'law',
    });
    assert.equal(validated.ok, true, validated.error || 'validation failed');
    const note = validated.text;

    assert.doesNotMatch(note, /^Answer/m);
    assert.doesNotMatch(note, /The following is structured content/i);
    assert.doesNotMatch(note, /https?:\/\//);
    assert.doesNotMatch(note, /utm_source/);
    assert.doesNotMatch(note, /\*\*/);
    assert.doesNotMatch(note, /\nSources\n/i);
    assert.doesNotMatch(note, /\nUncertainties\n/i);
    assert.doesNotMatch(note, /^\s*---\s*$/m);
    assert.doesNotMatch(note, /\[[^\]]+\]\([^)]+\)/);

    assert.match(note, /Actus reus/i);
    assert.match(note, /Mens rea/i);
    assert.match(note, /Common defences/i);
    assert.match(note, /Sentencing/i);
    assert.match(note, /appropriat/i);

    assert.ok(validated.sources.length >= 2);
    validated.sources.forEach(function (s) {
      assert.doesNotMatch(s.url, /utm_source/);
    });
  });

  it('demarkdownForNote removes inline markdown citations', () => {
    const sample =
      '- Dishonest taking. ([cps.gov.uk](https://www.cps.gov.uk/x?utm_source=openai))';
    const out = demarkdownForNote(sample);
    assert.doesNotMatch(out, /utm_source/);
    assert.doesNotMatch(out, /\(/);
    assert.match(out, /Dishonest taking/);
  });
});
