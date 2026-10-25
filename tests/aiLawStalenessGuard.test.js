'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  detectStaleLegalReferences,
  guardLawNoteStaleness,
  applyStatuteReplacements,
} = require('../main/aiLawStalenessGuard');
const { validateAiLegalResponse } = require('../main/aiAccuracyPolicy');

const FIXTURE_BURGLARY = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'ai-law-stale-domestic-burglary.txt'),
  'utf8',
);
const FIXTURE_S139 = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'ai-law-stale-s139-magistrates.txt'),
  'utf8',
);

describe('aiLawStalenessGuard', () => {
  it('detects repealed PCC(S)A 2000 for third domestic burglary', () => {
    const d = detectStaleLegalReferences(FIXTURE_BURGLARY);
    assert.ok(d.flags.includes('pccsa-2000'));
    assert.ok(d.warnings.some((w) => /Sentencing Act 2020/i.test(w)));
  });

  it('replaces PCC(S)A 2000 s.111 with Sentencing Act 2020 s.314', () => {
    const out = applyStatuteReplacements(FIXTURE_BURGLARY);
    assert.match(out.text, /Sentencing Act 2020/);
    assert.doesNotMatch(out.text, /Powers of Criminal Courts \(Sentencing\) Act 2000/i);
    assert.match(out.text, /s\.314/);
    assert.doesNotMatch(out.text, /s\.111/);
  });

  it('detects stale magistrates 6-month maximum for either-way s.139 context', () => {
    const d = detectStaleLegalReferences(FIXTURE_S139);
    assert.ok(d.flags.includes('magistrates-tew-12-months'));
  });

  it('corrects s.139 magistrates sentencing to 12-month SA 2020 limit', () => {
    const guarded = guardLawNoteStaleness(FIXTURE_S139);
    assert.equal(guarded.needsRegenerate, false);
    assert.match(guarded.noteText, /12 months/i);
    assert.match(guarded.noteText, /Sentencing Act 2020 s\.224/i);
    assert.doesNotMatch(guarded.noteText, /up to 6 months/i);
  });

  it('validateAiLegalResponse rejects raw stale note then accepts after guard correction path', () => {
    const raw =
      'Answer\n' +
      FIXTURE_BURGLARY +
      '\n\nUncertainties\nNone\n\nSources\n' +
      '1. SA 2020 — https://www.legislation.gov.uk/ukpga/2020/17/section/314\n' +
      '2. Burglary — https://www.legislation.gov.uk/ukpga/1968/60/section/9';
    const r = validateAiLegalResponse({
      text: raw,
      citations: [
        { title: 'SA 2020 s314', url: 'https://www.legislation.gov.uk/ukpga/2020/17/section/314' },
        { title: 'Theft Act', url: 'https://www.legislation.gov.uk/ukpga/1968/60/section/9' },
      ],
      noteMode: 'law',
    });
    assert.equal(r.ok, true);
    assert.doesNotMatch(r.text, /Powers of Criminal Courts \(Sentencing\) Act 2000/i);
    assert.match(r.text, /Sentencing Act 2020/);
  });
});
