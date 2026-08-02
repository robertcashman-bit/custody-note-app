/**
 * Opt-in free-form OpenAI Q&A for solicitors.
 * Sends the typed question + optional session history (+ optional offence names).
 * Never auto-pulls client or privileged form fields.
 */

'use strict';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

let _inFlight = false;

const ASK_SYSTEM_PROMPT =
  'You are a UK criminal defence solicitor assistant helping a qualified solicitor. ' +
  'Answer the question asked clearly and practically. This is a draft for solicitor review — not legal advice. ' +
  'Do not invent case facts about a specific client. Do not require or request client identifiers. ' +
  'UK law only unless the user asks about another jurisdiction.';

function normaliseHistory(history) {
  if (!Array.isArray(history)) return [];
  const out = [];
  for (let i = 0; i < history.length; i++) {
    const turn = history[i];
    if (!turn || typeof turn !== 'object') continue;
    const role = turn.role === 'assistant' ? 'assistant' : turn.role === 'user' ? 'user' : '';
    const content = String(turn.content || '').trim();
    if (!role || !content) continue;
    out.push({ role: role, content: content });
    if (out.length >= 40) break;
  }
  return out;
}

function formatOffencesContext(offences) {
  if (!Array.isArray(offences) || !offences.length) return '';
  const lines = offences.map(function (o, idx) {
    return (
      (idx + 1) +
      '. ' +
      (o.details || '(unnamed)') +
      (o.statute ? ' — ' + o.statute : '') +
      (o.modeOfTrial ? ' (mode: ' + o.modeOfTrial + ')' : '')
    );
  });
  return 'Offence name(s)/statute(s) from the attendance note (optional context):\n' + lines.join('\n');
}

function buildAskMessages(opts) {
  const options = opts || {};
  const question = String(options.question || '').trim();
  const history = normaliseHistory(options.history);
  const offences = Array.isArray(options.offences) ? options.offences : [];
  const messages = [{ role: 'system', content: ASK_SYSTEM_PROMPT }];
  const offenceCtx = formatOffencesContext(offences);
  if (offenceCtx) {
    messages.push({
      role: 'system',
      content: offenceCtx + '\n\nUse this only if relevant to the user question. Do not invent further case facts.',
    });
  }
  for (let i = 0; i < history.length; i++) {
    messages.push(history[i]);
  }
  if (question) {
    messages.push({ role: 'user', content: question });
  }
  return { messages: messages, question: question, history: history };
}

async function requestAskAnswer(opts) {
  const options = opts || {};
  if (options.confirmed !== true) {
    return { ok: false, error: 'Explicit confirmation required before calling OpenAI.' };
  }
  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'Add your OpenAI API key in Settings → Integrations first.' };
  }
  const built = buildAskMessages(options);
  if (!built.question) {
    return { ok: false, error: 'Enter a question first.' };
  }
  if (_inFlight) {
    return { ok: false, error: 'An AI request is already in progress.' };
  }

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
        temperature: 0.4,
        messages: built.messages,
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
      answer: text,
      model: model,
      message: 'AI answer — review before relying on it. Not legal advice.',
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'OpenAI request failed' };
  } finally {
    _inFlight = false;
  }
}

function resetAskInFlightForTests() {
  _inFlight = false;
}

module.exports = {
  ASK_SYSTEM_PROMPT,
  buildAskMessages,
  normaliseHistory,
  formatOffencesContext,
  requestAskAnswer,
  resetAskInFlightForTests,
  DEFAULT_MODEL,
  OPENAI_URL,
};
