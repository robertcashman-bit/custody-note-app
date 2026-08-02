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
const {
  buildAskMessages,
  requestAskAnswer,
  resetAskInFlightForTests,
  normaliseHistory,
} = require('../main/openaiAsk');

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
    assert.ok(!pdfChunk.includes('aiAskQuestion'));
    assert.ok(!volChunk.includes('aiAskQuestion'));
    assert.ok(!pdfChunk.includes('lawElementsFilledViaAi'));
    assert.ok(!volChunk.includes('lawElementsFilledViaAi'));
    assert.ok(appJs.includes("type: 'aiLawFill'"));
    assert.ok(appJs.includes("type: 'aiAsk'"));
  });
});

describe('aiLawElements renderer — Insert-only write + confirm gate', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'aiLawElements.js'), 'utf8');

  it('never calls runFill without confirm OK', () => {
    assert.match(src, /confirmAsync\(msg/);
    assert.match(src, /if \(ok\) runFill\(\)/);
    assert.match(src, /else uncheckFillBoxes\(\)/);
    assert.ok(!/if \(typeof showConfirm === 'function'\)[\s\S]*runFill\(\);\s*\}\s*return;\s*\}\s*runFill\(\);/.test(src));
    assert.ok(!src.includes('runFill();\n  }\n\n  function observeForm'));
  });

  it('writes lawElements only via insertIntoLawElements / applyLawElementsDraft', () => {
    assert.match(src, /function insertIntoLawElements/);
    assert.match(src, /function applyLawElementsDraft/);
    assert.match(src, /Only write path into lawElements/);
    const runFillStart = src.indexOf('function runFill()');
    const runFillEnd = src.indexOf('function onFillCheckboxChange');
    assert.ok(runFillStart > 0 && runFillEnd > runFillStart);
    const runFillBody = src.slice(runFillStart, runFillEnd);
    assert.ok(!runFillBody.includes("setField('lawElements'"));
    assert.ok(runFillBody.includes('showReviewModal'));
  });

  it('marks lawElementsFilledViaAi only after insert/append', () => {
    assert.match(src, /lawElementsFilledViaAi/);
    assert.match(src, /function markFilledViaAi/);
    assert.match(src, /applyLawElementsDraft\(draft\)/);
  });

  it('wires Ask AI multi-turn session', () => {
    assert.match(src, /aiAskQuestion/);
    assert.match(src, /_askThread/);
    assert.match(src, /includeOffences/);
    assert.match(src, /appendLastToLawElements/);
    assert.match(src, /_askSessionConfirmed/);
  });
});

describe('openaiAsk', () => {
  beforeEach(() => {
    resetAskInFlightForTests();
  });

  it('builds free-form messages with history and no client fields', () => {
    const built = buildAskMessages({
      question: 'What are the elements of self-defence?',
      history: [
        { role: 'user', content: 'Explain intoxication briefly' },
        { role: 'assistant', content: 'Intoxication is usually...' },
        { role: 'user', content: 'SECRET CLIENT should not appear from form' },
      ],
      offences: [],
    });
    assert.equal(built.question, 'What are the elements of self-defence?');
    assert.ok(built.messages.some((m) => m.role === 'user' && /self-defence/.test(m.content)));
    assert.ok(built.messages.some((m) => m.role === 'assistant'));
    const blob = JSON.stringify(built.messages);
    assert.ok(!blob.includes('clientName'));
    assert.ok(!blob.includes('clientInstructions'));
  });

  it('optionally attaches offence context only', () => {
    const built = buildAskMessages({
      question: 'Sentencing?',
      history: [],
      offences: [{ details: 'ABH', statute: 's.47', modeOfTrial: 'EW' }],
    });
    const sys = built.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    assert.match(sys, /ABH/);
    assert.match(sys, /s\.47/);
    assert.ok(!sys.includes('clientName'));
  });

  it('normalises history roles and truncates junk', () => {
    const h = normaliseHistory([
      { role: 'user', content: 'a' },
      { role: 'system', content: 'bad' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: '' },
    ]);
    assert.equal(h.length, 2);
    assert.equal(h[0].role, 'user');
    assert.equal(h[1].role, 'assistant');
  });

  it('gates ask on confirmed and api key', async () => {
    let called = false;
    const r1 = await requestAskAnswer({
      confirmed: false,
      apiKey: 'sk-test',
      question: 'hello',
      fetchImpl: async () => {
        called = true;
        return { ok: true, json: async () => ({}) };
      },
    });
    assert.equal(r1.ok, false);
    assert.equal(called, false);

    const r2 = await requestAskAnswer({
      confirmed: true,
      apiKey: '',
      question: 'hello',
      fetchImpl: async () => {
        called = true;
        return { ok: true, json: async () => ({}) };
      },
    });
    assert.equal(r2.ok, false);
    assert.equal(called, false);
  });

  it('returns answer and supports multi-turn history in request body', async () => {
    let body = null;
    const res = await requestAskAnswer({
      confirmed: true,
      apiKey: 'sk-test',
      question: 'And intoxication?',
      history: [
        { role: 'user', content: 'Self-defence elements?' },
        { role: 'assistant', content: 'Honest belief...' },
      ],
      fetchImpl: async (_url, opts) => {
        body = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Intoxication generally...' } }],
          }),
        };
      },
    });
    assert.equal(res.ok, true);
    assert.match(res.answer, /Intoxication/);
    assert.ok(body.messages.some((m) => m.content === 'Self-defence elements?'));
    assert.ok(body.messages.some((m) => m.content === 'And intoxication?'));
  });

  it('preload and main expose ask IPC; PDF omit keys in app form builders', () => {
    const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(preload, /aiAskQuestion/);
    assert.match(main, /ai:ask-question/);
    assert.match(main, /requestAskAnswer/);
    assert.match(html, /id="ai-ask-modal"/);
    assert.match(html, /ai-ask-include-offences/);
  });
});
