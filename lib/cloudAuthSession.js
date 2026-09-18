'use strict';

/**
 * Client hooks for short-lived cloud auth tokens + remote revoke.
 * ----------------------------------------------------------------------------
 * Website/server owns issuance and revocation. This module is the desktop
 * contract so Mac and Windows share one path when those APIs land.
 *
 * Today: local expiry enforcement + stub refresh/revoke that call optional
 * HTTP helpers when the website agent exposes:
 *   POST /api/auth/refresh  { refreshToken }
 *   POST /api/auth/revoke   { token } or { refreshToken }
 *
 * Fail closed: expired access tokens are treated as absent.
 */

const DEFAULT_ACCESS_TTL_MS = 60 * 60 * 1000; // 1h until server returns expiresAt

/**
 * @param {{ authToken?: string|null, refreshToken?: string|null,
 *           tokenExpiresAt?: string|number|null, accountId?: string|null }} licence
 * @param {{ now?: number }} [opts]
 * @returns {{ usable: boolean, reason: string, expiresAt: number|null }}
 */
function evaluateAccessToken(licence, opts) {
  const data = licence || {};
  const now = (opts && opts.now) || Date.now();
  const token = data.authToken != null ? String(data.authToken).trim() : '';
  if (!token) return { usable: false, reason: 'missing', expiresAt: null };

  let expiresAt = null;
  if (data.tokenExpiresAt != null && data.tokenExpiresAt !== '') {
    const n = typeof data.tokenExpiresAt === 'number'
      ? data.tokenExpiresAt
      : Date.parse(String(data.tokenExpiresAt));
    if (Number.isFinite(n)) expiresAt = n;
  }
  if (expiresAt != null && expiresAt <= now) {
    return { usable: false, reason: 'expired', expiresAt };
  }
  return { usable: true, reason: 'ok', expiresAt };
}

/**
 * Stamp a newly issued access token with expiry when the server omits it.
 * @param {object} licenceData mutable licence object
 * @param {{ accessToken?: string, refreshToken?: string, expiresAt?: string|number, expiresIn?: number, accountId?: string }} issued
 * @param {{ now?: number, defaultTtlMs?: number }} [opts]
 */
function applyIssuedTokens(licenceData, issued, opts) {
  const data = licenceData || {};
  const iss = issued || {};
  const now = (opts && opts.now) || Date.now();
  if (iss.accessToken) data.authToken = String(iss.accessToken);
  if (iss.refreshToken != null) data.refreshToken = String(iss.refreshToken || '');
  if (iss.accountId) data.accountId = String(iss.accountId);
  if (iss.expiresAt != null && iss.expiresAt !== '') {
    data.tokenExpiresAt = iss.expiresAt;
  } else if (iss.expiresIn != null && Number.isFinite(Number(iss.expiresIn))) {
    data.tokenExpiresAt = new Date(now + Number(iss.expiresIn) * 1000).toISOString();
  }
  // Do NOT invent a synthetic TTL when the server omits expiry. A fake 1h
  // tokenExpiresAt caused magic-link sessions to look "expired" and then be
  // wiped (including refreshToken) without attempting refresh.
  return data;
}

/**
 * Clear local session tokens after revoke / 401 / logout.
 * @param {object} licenceData
 */
function clearSessionTokens(licenceData) {
  const data = licenceData || {};
  delete data.authToken;
  delete data.refreshToken;
  delete data.tokenExpiresAt;
  return data;
}

/**
 * Attempt refresh when access token is expired and refreshToken exists.
 * @param {object} licenceData
 * @param {{ httpPost: Function, apiUrl: string, getAuthHeaders?: Function }} deps
 * @returns {Promise<{ ok: boolean, refreshed: boolean, reason?: string }>}
 */
async function refreshAccessTokenIfNeeded(licenceData, deps) {
  const evalResult = evaluateAccessToken(licenceData);
  if (evalResult.usable) return { ok: true, refreshed: false, reason: 'still_valid' };
  const refresh = licenceData && licenceData.refreshToken
    ? String(licenceData.refreshToken).trim()
    : '';
  if (!refresh) return { ok: false, refreshed: false, reason: 'no_refresh_token' };
  if (!deps || typeof deps.httpPost !== 'function' || !deps.apiUrl) {
    return { ok: false, refreshed: false, reason: 'no_transport' };
  }
  try {
    const url = String(deps.apiUrl).replace(/\/$/, '') + '/api/auth/refresh';
    const resp = await deps.httpPost(url, { refreshToken: refresh }, {
      headers: deps.getAuthHeaders ? deps.getAuthHeaders() : {},
      timeout: 15000,
    });
    if (!resp || !(resp.accessToken || resp.token)) {
      return { ok: false, refreshed: false, reason: 'refresh_rejected' };
    }
    applyIssuedTokens(licenceData, {
      accessToken: resp.accessToken || resp.token,
      refreshToken: resp.refreshToken,
      expiresAt: resp.expiresAt,
      expiresIn: resp.expiresIn,
      accountId: resp.accountId || resp.userId,
    });
    return { ok: true, refreshed: true };
  } catch (err) {
    return {
      ok: false,
      refreshed: false,
      reason: err && err.message ? String(err.message).slice(0, 120) : 'refresh_error',
    };
  }
}

/**
 * Best-effort remote revoke (device loss / logout). Always clears local tokens.
 * @param {object} licenceData
 * @param {{ httpPost: Function, apiUrl: string }} deps
 */
async function revokeSessionTokens(licenceData, deps) {
  const token = licenceData && licenceData.authToken
    ? String(licenceData.authToken).trim()
    : '';
  const refresh = licenceData && licenceData.refreshToken
    ? String(licenceData.refreshToken).trim()
    : '';
  let remote = { ok: false, reason: 'skipped' };
  if (deps && typeof deps.httpPost === 'function' && deps.apiUrl && (token || refresh)) {
    try {
      const url = String(deps.apiUrl).replace(/\/$/, '') + '/api/auth/revoke';
      await deps.httpPost(url, {
        token: token || undefined,
        refreshToken: refresh || undefined,
      }, { timeout: 10000 });
      remote = { ok: true, reason: 'revoked' };
    } catch (err) {
      remote = {
        ok: false,
        reason: err && err.message ? String(err.message).slice(0, 120) : 'revoke_error',
      };
    }
  }
  clearSessionTokens(licenceData);
  return { localCleared: true, remote };
}

module.exports = {
  DEFAULT_ACCESS_TTL_MS,
  evaluateAccessToken,
  applyIssuedTokens,
  clearSessionTokens,
  refreshAccessTokenIfNeeded,
  revokeSessionTokens,
};
