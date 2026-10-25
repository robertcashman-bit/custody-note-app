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

describe('stripTrailingMetaSections keeps law after horizontal rules', () => {
  const { stripTrailingMetaSections, cleanLawElementsNoteText } = require('../main/aiNoteTextCleanup');

  it('does not drop later headings separated by ---', () => {
    const raw = 'Actus reus\nAppropriation of property.\n\n---\n\nMens rea\nDishonesty.\n\n---\n\nSentencing\nCategory ranges.\n\nUncertainties\nNone\n\nSources\n- https://example.org/a\n- https://example.org/b';
    const out = stripTrailingMetaSections(raw);
    assert.match(out, /Mens rea/);
    assert.match(out, /Sentencing/);
    assert.doesNotMatch(out, /Uncertainties|Sources|example\.org/);
  });

  it('strips a rule-preceded markdown Sources heading', () => {
    const raw = 'Actus reus\nText.\n\n---\n\n**Sources**\n- https://example.org/a';
    const out = stripTrailingMetaSections(raw);
    assert.equal(out, 'Actus reus\nText.');
  });

  it('note text keeps all four headings when rules separate them', () => {
    const raw = '**1. Actus Reus**\nA.\n\n---\n\n**2. Mens Rea**\nB.\n\n---\n\n**3. Common Defences**\nC.\n\n---\n\n**4. Sentencing**\nD.\n\n## Uncertainties\nPoint X unverified.\n\n## Sources\n- https://example.org/a';
    const res = cleanLawElementsNoteText(raw);
    for (const h of ['Actus reus', 'Mens rea', 'Common defences', 'Sentencing']) {
      assert.match(res.noteText, new RegExp(h));
    }
    assert.doesNotMatch(res.noteText, /---|Uncertainties|https?:/);
  });
});

describe('markdown Uncertainties headings are kept for review', () => {
  const { cleanLawElementsNoteText, cleanAskAnswerNoteText } = require('../main/aiNoteTextCleanup');

  for (const heading of ['## Uncertainties', '**Uncertainties**', '**Uncertainties:**', 'Uncertainties:']) {
    it('extracts uncertainties under "' + heading + '"', () => {
      const raw = 'Actus reus\nA.\n\n---\n\n' + heading + '\nPoint X unverified.\n\n---\n\n**Sources**\n- https://example.org/a';
      const law = cleanLawElementsNoteText(raw);
      assert.equal(law.uncertainties, 'Point X unverified.');
      assert.equal(law.noteText, 'Actus reus\nA.');
      const ask = cleanAskAnswerNoteText(raw);
      assert.equal(ask.uncertainties, 'Point X unverified.');
    });
  }
});
