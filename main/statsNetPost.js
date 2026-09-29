'use strict';

/**
 * POST JSON to Custody Note stats endpoints via Electron net (system / PAC proxy).
 * Used only for privacy-safe analytics pings (heartbeat, trial-started).
 */

/**
 * @param {{
 *   net: { fetch: (url: string, init?: object) => Promise<{ status: number, text: () => Promise<string> }> },
 *   isAllowedApiUrl: (url: string) => boolean,
 * }} deps
 * @returns {(url: string, body: object, opts?: { timeout?: number }) => Promise<object>}
 */
function createStatsNetPost(deps) {
  const net = deps && deps.net;
  const isAllowedApiUrl = deps && deps.isAllowedApiUrl;
  if (!net || typeof net.fetch !== 'function') {
    throw new Error('Electron net.fetch is required for stats POST');
  }
  if (typeof isAllowedApiUrl !== 'function') {
    throw new Error('isAllowedApiUrl is required for stats POST');
  }

  return async function statsNetPost(url, body, opts) {
    if (!isAllowedApiUrl(url)) {
      const err = new Error('API URL not allowed');
      throw err;
    }
    const timeoutMs = (opts && opts.timeout) || 8000;
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => {
      try {
        if (controller) controller.abort();
      } catch (_) {}
    }, timeoutMs + 2000);
    try {
      const init = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(payload)),
        },
        body: payload,
      };
      if (controller) init.signal = controller.signal;
      const response = await net.fetch(url, init);
      const status = response && response.status != null ? response.status : 0;
      if (status >= 400) {
        const err = new Error('Server error ' + status);
        err.statusCode = status;
        throw err;
      }
      let text = '';
      try {
        text = response.text ? await response.text() : '';
      } catch (_) {
        text = '';
      }
      if (status === 204 || status === 205 || !String(text || '').trim()) {
        return {};
      }
      try {
        return JSON.parse(text);
      } catch (_) {
        return {};
      }
    } catch (e) {
      if (controller && e && e.name === 'AbortError') {
        const err = new Error('Timeout');
        err.code = 'ETIMEDOUT';
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = {
  createStatsNetPost,
};
