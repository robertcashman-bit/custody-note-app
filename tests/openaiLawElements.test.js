'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildOffencePayload,
  buildPromptMessages,
  requestLawElementsDraft,
  resetInFlightForTests,
} = require('../main/openaiLawElements');

describe('openaiLawElements', () => {
  beforeEach(() => {
    resetInFlightForTests();
  });

  it('builds offence-only payload and ignores client fields', () => {
    const payload = buildOffencePayload({
      clientName: 'SECRET CLIENT',
      clientInstructions: 'privileged',
      offence1Details: 'Theft',
      offence1Statute: 'Theft Act 1968 s.1',
      offence2Details: '',
    });
    assert.equal(payload.offences.length, 1);
    assert.equal(payload.offences[0].details, 'Theft');
    assert.ok(!JSON.stringify(payload).includes('SECRET'));
    assert.ok(!JSON.stringify(payload).includes('privileged'));
  });

  it('requires an offence', () => {
    const payload = buildOffencePayload({ clientName: 'x' });
    assert.ok(payload.error);
  });

  it('prompt mentions actus reus / mens rea / defences / sentencing', () => {
    const msg = buildPromptMessages([{ details: 'ABH', statute: 'OAPA 1861 s.47', modeOfTrial: 'Either way' }]);
    assert.match(msg.system, /Actus reus/i);
    assert.match(msg.system, /Mens rea/i);
    assert.match(msg.system, /defences/i);
    assert.match(msg.system, /Sentencing/i);
    assert.match(msg.user, /ABH/);
  });

  it('gates on confirmed and api key', async () => {
    let called = false;
    const r1 = await requestLawElementsDraft({
      confirmed: false,
      apiKey: 'sk-test',
      offences: [{ details: 'Theft', statute: '', modeOfTrial: '' }],
      fetchImpl: async () => {
        called = true;
        return { ok: true, json: async () => ({}) };
      },
    });
    assert.equal(r1.ok, false);
    assert.equal(called, false);

    const r2 = await requestLawElementsDraft({
      confirmed: true,
      apiKey: '',
      offences: [{ details: 'Theft', statute: '', modeOfTrial: '' }],
      fetchImpl: async () => {
        called = true;
        return { ok: true, json: async () => ({}) };
      },
    });
    assert.equal(r2.ok, false);
    assert.equal(called, false);
  });

  it('returns draft from OpenAI response', async () => {
    const res = await requestLawElementsDraft({
      confirmed: true,
      apiKey: 'sk-test',
      offences: [{ details: 'Theft', statute: 'TA 1968', modeOfTrial: '' }],
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Actus reus: appropriation...' } }],
        }),
      }),
    });
    assert.equal(res.ok, true);
    assert.match(res.draft, /Actus reus/);
  });

  it('PDF builders omit aiFillLawElements checkbox key', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const pdfStart = appJs.indexOf('function buildPdfHtml');
    const volStart = appJs.indexOf('function buildVoluntaryPdfHtml');
    assert.ok(pdfStart > 0 && volStart > 0);
    const pdfChunk = appJs.slice(pdfStart, pdfStart + 8000);
    const volChunk = appJs.slice(volStart, volStart + 8000);
    assert.ok(!pdfChunk.includes('aiFillLawElements'));
    assert.ok(!volChunk.includes('aiFillLawElements'));
    assert.ok(appJs.includes("type: 'aiLawFill'"));
  });
});
