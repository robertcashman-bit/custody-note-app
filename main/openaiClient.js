/**
 * OpenAI Responses API client with web_search grounding for legal answers.
 */

'use strict';

const safeLog = require('../lib/safeLog');

const {
  ACCURACY_SYSTEM_RULES,
  REQUIRED_OUTPUT_SHAPE,
  PREFERRED_UK_LEGAL_DOMAINS,
  validateAiLegalResponse,
} = require('./aiAccuracyPolicy');

const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = process.env.OPENAI_MODEL && String(process.env.OPENAI_MODEL).trim()
  ? String(process.env.OPENAI_MODEL).trim()
  : 'gpt-4o';

/**
 * Prefer Electron net.fetch (Chromium network stack — OS proxy / corporate SSL)
 * over Node/undici global fetch in the main process. Tests may pass fetchImpl.
 */
function getDefaultFetchImpl() {
  try {
    const electron = require('electron');
    if (electron && electron.net && typeof electron.net.fetch === 'function') {
      return electron.net.fetch.bind(electron.net);
    }
  } catch (_) {
    /* Not running inside Electron, or net unavailable. */
  }
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  if (typeof fetch === 'function') {
    return fetch;
  }
  return null;
}

/**
 * Turn undici/Electron "fetch failed" (+ cause) into a user-facing string.
 * Never include API keys, prompts, or response bodies.
 */
function formatOpenAiNetworkError(err) {
  const e = err || {};
  const topMsg = String(e.message || '').trim() || 'OpenAI request failed';
  const cause = e.cause && typeof e.cause === 'object' ? e.cause : null;
  const code = cause
    ? String(cause.code || cause.errno || '').trim()
    : '';
  const causeMsg = cause ? String(cause.message || '').trim() : '';
  const hostMatch =
    causeMsg.match(/\b([a-z0-9.-]+\.[a-z]{2,})\b/i) ||
    topMsg.match(/\b([a-z0-9.-]+\.[a-z]{2,})\b/i);
  const host = hostMatch ? hostMatch[1] : '';

  const isBareFetchFailed = /^fetch failed$/i.test(topMsg);
  const looksCert =
    /cert|SSL|TLS|UNABLE_TO_VERIFY|unable to verify|self.signed|CERTIFICATE/i.test(
      code + ' ' + causeMsg + ' ' + topMsg
    );
  const looksTimeout =
    /ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timeout/i.test(
      code + ' ' + causeMsg + ' ' + topMsg
    );
  const looksReset =
    /ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR_SOCKET/i.test(code + ' ' + causeMsg);

  if (looksCert) {
    return 'Could not reach OpenAI (certificate). Check VPN/proxy/firewall.';
  }
  if (code === 'ENOTFOUND' || /ENOTFOUND/i.test(causeMsg)) {
    return (
      'Could not reach OpenAI (ENOTFOUND' +
      (host ? ' ' + host : '') +
      '). Check DNS, VPN, or offline network.'
    );
  }
  if (looksTimeout) {
    return (
      'Could not reach OpenAI (' +
      (code || 'timeout') +
      '). Check VPN/proxy/firewall.'
    );
  }
  if (looksReset) {
    return (
      'Could not reach OpenAI (' +
      (code || 'connection reset') +
      '). Check VPN/proxy/firewall.'
    );
  }
  if (isBareFetchFailed && (code || causeMsg)) {
    const detail = code || causeMsg;
    return (
      'Could not reach OpenAI (' +
      detail +
      '). Check VPN/proxy/firewall.'
    );
  }
  if (isBareFetchFailed) {
    return 'Could not reach OpenAI (network error). Check VPN/proxy/firewall.';
  }
  if (code && !topMsg.includes(code)) {
    return topMsg + ' (' + code + ')';
  }
  return topMsg;
}

/** Log OpenAI metadata only — never prompts, offences, or client context. */
function debugOpenAiMeta(label, meta) {
  if (process.env.CUSTODYNOTE_DEBUG === '1') {
    safeLog.debug('[openai]', label, meta || {});
  }
}

function buildWebSearchTool() {
  /* Domain filters when supported by the API; ignored safely if not. */
  return {
    type: 'web_search',
    filters: {
      allowed_domains: PREFERRED_UK_LEGAL_DOMAINS.map(function (d) {
        return d.replace(/^www\./, '');
      }).filter(function (d, i, arr) {
        return arr.indexOf(d) === i;
      }),
    },
  };
}

function extractTextAndCitations(body) {
  let text = '';
  const citations = [];
  if (!body || typeof body !== 'object') {
    return { text: text, citations: citations };
  }
  if (typeof body.output_text === 'string' && body.output_text.trim()) {
    text = body.output_text.trim();
  }
  const output = Array.isArray(body.output) ? body.output : [];
  for (let i = 0; i < output.length; i++) {
    const item = output[i];
    if (!item || item.type !== 'message') continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (let j = 0; j < content.length; j++) {
      const part = content[j];
      if (!part) continue;
      if ((part.type === 'output_text' || part.type === 'text') && part.text) {
        if (!text) text = String(part.text).trim();
        const anns = Array.isArray(part.annotations) ? part.annotations : [];
        for (let k = 0; k < anns.length; k++) {
          const a = anns[k];
          if (!a) continue;
          if (a.type === 'url_citation' || a.url) {
            citations.push({
              title: String(a.title || a.url || '').trim(),
              url: String(a.url || '').trim(),
            });
          }
        }
      }
    }
  }
  return { text: text, citations: citations };
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {Array<{role:string,content:string}>} opts.inputMessages - Responses input messages
 * @param {string} [opts.model]
 * @param {function} [opts.fetchImpl]
 * @param {boolean} [opts.requireWebSearch=true]
 * @param {boolean} [opts.retryOnValidationFail=true]
 */
async function requestGroundedLegalAnswer(opts) {
  const options = opts || {};
  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'Add your OpenAI API key in Settings → Integrations first.' };
  }
  const inputMessages = Array.isArray(options.inputMessages) ? options.inputMessages : [];
  if (!inputMessages.length) {
    return { ok: false, error: 'No prompt provided.' };
  }
  const model = String(options.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const fetchFn =
    typeof options.fetchImpl === 'function'
      ? options.fetchImpl
      : getDefaultFetchImpl();
  if (typeof fetchFn !== 'function') {
    return { ok: false, error: 'No HTTP fetch available for OpenAI requests.' };
  }
  const requireWebSearch = options.requireWebSearch !== false;
  const retryOnFail = options.retryOnValidationFail !== false;

  debugOpenAiMeta('request', {
    model: model,
    messageCount: inputMessages.length,
    requireWebSearch: requireWebSearch,
  });

  const systemBits = [ACCURACY_SYSTEM_RULES, REQUIRED_OUTPUT_SHAPE];
  const input = [
    { role: 'system', content: systemBits.join('\n\n') },
  ].concat(inputMessages);

  async function callOnce(extraUserNote) {
    const payloadInput = extraUserNote
      ? input.concat([{ role: 'user', content: extraUserNote }])
      : input;
    const body = {
      model: model,
      input: payloadInput,
      tools: [buildWebSearchTool()],
      temperature: 0.2,
    };
    if (requireWebSearch) {
      body.tool_choice = { type: 'web_search' };
    }
    const res = await fetchFn(RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify(body),
    });
    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      json = null;
    }
    if (!res.ok) {
      /* Retry without domain filters / strict tool_choice if API rejects shape. */
      const errMsg =
        (json && json.error && json.error.message) ||
        'OpenAI request failed (HTTP ' + res.status + ')';
      debugOpenAiMeta('http-error', { status: res.status, message: errMsg });
      if (
        /unknown|invalid|unsupported|tool_choice|filters|allowed_domains/i.test(errMsg) &&
        !options._simplified
      ) {
        return callOnceSimplified(extraUserNote);
      }
      return { ok: false, error: errMsg };
    }
    const parsed = extractTextAndCitations(json);
    if (!parsed.text) {
      return { ok: false, error: 'OpenAI returned an empty response.' };
    }
    const validated = validateAiLegalResponse({
      text: parsed.text,
      citations: parsed.citations,
    });
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.error || 'AI response failed accuracy validation.',
        _rawText: validated.text,
        _sources: validated.sources,
      };
    }
    return {
      ok: true,
      text: validated.text,
      sources: validated.sources || [],
      uncertainties: validated.uncertainties || '',
      refusal: !!validated.refusal,
      model: model,
      message:
        'Web-sourced draft for solicitor verification — not legal advice. Check primary sources before relying on it.',
    };
  }

  async function callOnceSimplified(extraUserNote) {
    const payloadInput = extraUserNote
      ? input.concat([{ role: 'user', content: extraUserNote }])
      : input;
    const res = await fetchFn(RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: model,
        input: payloadInput,
        tools: [{ type: 'web_search' }],
        temperature: 0.2,
      }),
    });
    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      json = null;
    }
    if (!res.ok) {
      const errMsg =
        (json && json.error && json.error.message) ||
        'OpenAI request failed (HTTP ' + res.status + ')';
      return { ok: false, error: errMsg };
    }
    const parsed = extractTextAndCitations(json);
    if (!parsed.text) {
      return { ok: false, error: 'OpenAI returned an empty response.' };
    }
    const validated = validateAiLegalResponse({
      text: parsed.text,
      citations: parsed.citations,
    });
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.error || 'AI response failed accuracy validation.',
        _rawText: validated.text,
        _sources: validated.sources,
      };
    }
    return {
      ok: true,
      text: validated.text,
      sources: validated.sources || [],
      uncertainties: validated.uncertainties || '',
      refusal: !!validated.refusal,
      model: model,
      message:
        'Web-sourced draft for solicitor verification — not legal advice. Check primary sources before relying on it.',
    };
  }

  try {
    let result = await callOnce(null);
    if (!result.ok && retryOnFail && /rejected|Sources|case-law|accuracy/i.test(result.error || '')) {
      result = await callOnce(
        'Previous answer was REJECTED by the app accuracy gate: ' +
          (result.error || 'missing/unverified sources') +
          '. Regenerate using web search. Do not invent sources or case law. ' +
          'If you cannot verify, refuse honestly with Sources: None.',
      );
    }
    if (!result.ok) {
      return {
        ok: false,
        error:
          (result.error || 'AI request failed') +
          ' The app will not show unsourced or unverified legal answers.',
      };
    }
    return result;
  } catch (e) {
    const formatted = formatOpenAiNetworkError(e);
    debugOpenAiMeta('network-error', {
      message: formatted,
      code: e && e.cause && (e.cause.code || e.cause.errno) ? String(e.cause.code || e.cause.errno) : '',
    });
    return { ok: false, error: formatted };
  }
}

module.exports = {
  RESPONSES_URL,
  DEFAULT_MODEL,
  buildWebSearchTool,
  extractTextAndCitations,
  requestGroundedLegalAnswer,
  debugOpenAiMeta,
  getDefaultFetchImpl,
  formatOpenAiNetworkError,
};
