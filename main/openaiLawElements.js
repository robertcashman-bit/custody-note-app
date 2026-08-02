/**
 * Opt-in OpenAI fill for The Law / Elements of offence.
 * Sends offence name + statute only — never client or privileged case content.
 */

'use strict';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

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
      'Use clear headings. UK law only. This is a draft for a qualified solicitor to review — not legal advice. ' +
      'Do not invent case facts. Do not ask for client details.',
    user:
      'Offence(s) on the attendance note:\n' +
      lines.join('\n') +
      '\n\nProduce structured text suitable to paste into the Law / Elements of offence field.',
  };
}

async function requestLawElementsDraft(opts) {
  const options = opts || {};
  if (options.confirmed !== true) {
    return { ok: false, error: 'Explicit confirmation required before calling OpenAI.' };
  }
  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'Add your OpenAI API key in Settings → Integrations first.' };
  }
  if (!Array.isArray(options.offences) || !options.offences.length) {
    return { ok: false, error: 'Enter at least one offence before using AI fill.' };
  }
  if (_inFlight) {
    return { ok: false, error: 'An AI request is already in progress.' };
  }

  const messages = buildPromptMessages(options.offences);
  const model = String(options.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const fetchFn = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch;

  _inFlight = true;
  try {
    const res = await fetchFn(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ],
      }),
    });
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }
    if (!res.ok) {
      const msg =
        (body && body.error && body.error.message) ||
        'OpenAI request failed (HTTP ' + res.status + ')';
      return { ok: false, error: msg };
    }
    const text =
      body &&
      body.choices &&
      body.choices[0] &&
      body.choices[0].message &&
      body.choices[0].message.content
        ? String(body.choices[0].message.content).trim()
        : '';
    if (!text) {
      return { ok: false, error: 'OpenAI returned an empty response.' };
    }
    return {
      ok: true,
      draft: text,
      model: model,
      message: 'AI draft — review before inserting. Not legal advice.',
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'OpenAI request failed' };
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
  OPENAI_URL,
};
