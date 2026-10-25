/**
 * Opt-in OpenAI fill for The Law / Elements of offence (web-search grounded + accuracy gate).
 * Sends offence name + statute only — never client or privileged case content.
 */

'use strict';

const { requestGroundedLegalAnswer, DEFAULT_MODEL, RESPONSES_URL } = require('./openaiClient');
const { OPENAI_KEY_MISSING_USER_MESSAGE } = require('../lib/openaiApiKeyCopy');
const { LAW_ELEMENTS_PLAIN_NOTE_RULES } = require('./aiAccuracyPolicy');

let _inFlight = false;

function buildOffencePayload(formData) {
  const data = formData && typeof formData === 'object' ? formData : {};
  const offences = [];
  for (let i = 1; i <= 4; i++) {
    const details = String(data['offence' + i + 'Details'] || '').trim();
    const statute = String(data['offence' + i + 'Statute'] || '').trim();
    const modeOfTrial = String(data['offence' + i + 'ModeOfTrial'] || '').trim();
    if (!details && !statute) continue;
    offences.push({ details, statute, modeOfTrial });
  }
  if (!offences.length) {
    return { offences: [], error: 'Enter at least one offence (details or statute) before using AI fill.' };
  }
  return { offences };
}

function buildPromptMessages(offences) {
  const lines = offences.map(function (o, idx) {
    return (
      (idx + 1) +
      '. ' +
      (o.details || '(unnamed)') +
      (o.statute ? ' — ' + o.statute : '') +
      (o.modeOfTrial ? ' (mode: ' + o.modeOfTrial + ')' : '')
    );
  });
  return {
    system:
      'You are a UK criminal defence solicitor assistant. Draft concise attendance-note content for "The Law / Elements of offence". ' +
      'Cover for each offence: (1) Actus reus, (2) Mens rea, (3) Common defences, (4) Sentencing guidelines summary (Sentencing Council / magistrates where relevant). ' +
      'UK law only. Use web search. Follow ACCURACY RULES — no unsourced case law. ' +
      'Do not invent case facts. Do not ask for client details.\n\n' +
      LAW_ELEMENTS_PLAIN_NOTE_RULES,
    user:
      'Offence(s) on the attendance note:\n' +
      lines.join('\n') +
      '\n\nDraft plain-text note content (Actus reus / Mens rea / Common defences / Sentencing). ' +
      'No intro, no inline URLs, no markdown. Verify all section numbers and sentence maximums on legislation.gov.uk (Sentencing Act 2020 where relevant). ' +
      'Put unverified points under Uncertainties and list sources under Sources only.',
  };
}

async function requestLawElementsDraft(opts) {
  const options = opts || {};
  if (options.confirmed !== true) {
    return { ok: false, error: 'Explicit confirmation required before calling OpenAI.' };
  }
  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) {
    return { ok: false, error: OPENAI_KEY_MISSING_USER_MESSAGE };
  }
  if (!Array.isArray(options.offences) || !options.offences.length) {
    return { ok: false, error: 'Enter at least one offence before using AI fill.' };
  }
  if (_inFlight) {
    return { ok: false, error: 'An AI request is already in progress.' };
  }

  const messages = buildPromptMessages(options.offences);
  _inFlight = true;
  try {
    const result = await requestGroundedLegalAnswer({
      apiKey: apiKey,
      model: options.model,
      fetchImpl: options.fetchImpl,
      inputMessages: [
        { role: 'system', content: messages.system },
        { role: 'user', content: messages.user },
      ],
      requireWebSearch: true,
      retryOnValidationFail: true,
      noteMode: 'law',
    });
    if (!result.ok) return result;
    return {
      ok: true,
      draft: result.text,
      sources: result.sources || [],
      uncertainties: result.uncertainties || '',
      stalenessWarnings: result.stalenessWarnings || [],
      refusal: !!result.refusal,
      model: result.model || DEFAULT_MODEL,
      message: result.message,
    };
  } finally {
    _inFlight = false;
  }
}

function resetInFlightForTests() {
  _inFlight = false;
}

module.exports = {
  buildOffencePayload,
  buildPromptMessages,
  requestLawElementsDraft,
  resetInFlightForTests,
  DEFAULT_MODEL,
  OPENAI_URL: RESPONSES_URL,
};
