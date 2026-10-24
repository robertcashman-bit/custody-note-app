'use strict';

const { isQuickFileNetworkError, isQuickFileTimeoutError } = require('./quickfileClient');

const DEFAULT_DELAYS_MS = [1000, 3000, 8000];
const DEFAULT_MAX_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpStatus(statusCode) {
  const s = Number(statusCode);
  if (!Number.isFinite(s)) return false;
  if (s === 429) return true;
  return s >= 500 && s < 600;
}

function isRetryableQuickFileError(err) {
  if (!err) return false;
  if (isQuickFileNetworkError(err)) return true;
  if (isRetryableHttpStatus(err.httpStatus)) return true;
  const msg = String(err.message || '').toLowerCase();
  if (/http 5\d\d/.test(msg)) return true;
  if (/too many requests|rate limit|429/.test(msg)) return true;
  return false;
}

/**
 * Run an async QuickFile call with bounded retries (network, timeout, 429, 5xx only).
 * @param {object} opts
 * @param {() => Promise<*>} opts.run attempt function (receives { attempt })
 * @param {(attempt:number, err: unknown) => Promise<*|null|undefined>} [opts.beforeRetry]
 * @param {number} [opts.maxAttempts]
 * @param {number[]} [opts.delaysMs]
 */
async function runWithQuickFileRetries(opts) {
  const o = opts || {};
  const maxAttempts = Math.max(1, Number(o.maxAttempts) || DEFAULT_MAX_ATTEMPTS);
  const delays = Array.isArray(o.delaysMs) && o.delaysMs.length
    ? o.delaysMs
    : DEFAULT_DELAYS_MS;
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0 && typeof o.beforeRetry === 'function') {
      const recovered = await o.beforeRetry(attempt, lastErr);
      if (recovered !== undefined && recovered !== null) return recovered;
    }
    try {
      return await o.run({ attempt });
    } catch (err) {
      lastErr = err;
      if (!isRetryableQuickFileError(err) || attempt >= maxAttempts - 1) throw err;
      const delay = delays[Math.min(attempt, delays.length - 1)];
      await sleep(delay);
    }
  }
  throw lastErr || new Error('QuickFile request failed');
}

module.exports = {
  DEFAULT_DELAYS_MS,
  DEFAULT_MAX_ATTEMPTS,
  isRetryableHttpStatus,
  isRetryableQuickFileError,
  runWithQuickFileRetries,
};
