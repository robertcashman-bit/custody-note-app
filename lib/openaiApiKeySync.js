'use strict';

/**
 * OpenAI API key sync for a Custody Note account.
 *
 * Same protection model as QuickFile credentials (lib/quickfileCredentialSync.js):
 * - Per-account wrap key from the server (not derivable from licence key alone).
 * - Opaque ciphertext at POST /api/settings/openai-api-key.
 * - Never in the licence-key /api/settings/quickfile preferences blob.
 * - Never log key values or wrap keys.
 */

const quickfileCredentialSync = require('./quickfileCredentialSync');
const { encryptWithWrapKey, decryptWithWrapKey } = require('./quickfileWrapKeyCrypto');

const PAYLOAD_KEY = 'openaiApiKey';
const BLOB_PATH = '/api/settings/openai-api-key';

function pickOpenAiApiKey(settings) {
  const src = settings && typeof settings === 'object' ? settings : {};
  return {
    [PAYLOAD_KEY]: src[PAYLOAD_KEY] != null ? String(src[PAYLOAD_KEY]).trim() : '',
  };
}

function hasOpenAiApiKey(settings) {
  return String(pickOpenAiApiKey(settings)[PAYLOAD_KEY] || '').length > 0;
}

function encryptOpenAiApiKeyBlob(wrapKeyHex, apiKey) {
  return encryptWithWrapKey(wrapKeyHex, pickOpenAiApiKey({ [PAYLOAD_KEY]: apiKey }));
}

function decryptOpenAiApiKeyBlob(wrapKeyHex, blob) {
  const parsed = decryptWithWrapKey(wrapKeyHex, blob);
  if (!parsed || typeof parsed !== 'object') return null;
  return pickOpenAiApiKey(parsed);
}

async function fetchAccountWrapKey(httpPost, apiUrl, licenceKey, machineId, opts) {
  return quickfileCredentialSync.fetchAccountWrapKey(httpPost, apiUrl, licenceKey, machineId, opts);
}

async function pullOpenAiApiKeyFromServer(httpPost, apiUrl, licenceKey, machineId, wrapKeyHex, opts) {
  if (!httpPost || !apiUrl || !licenceKey || !wrapKeyHex) {
    return { ok: false, error: 'OpenAI key pull not configured' };
  }
  const headers = opts && opts.headers ? opts.headers : {};
  try {
    const resp = await httpPost(`${apiUrl.replace(/\/$/, '')}${BLOB_PATH}`, {
      key: licenceKey,
      machineId: machineId,
      accountId: opts && opts.accountId ? String(opts.accountId) : undefined,
    }, { headers, timeout: opts && opts.timeout || 15000 });
    if (resp && resp.ok && resp.empty === true) {
      return {
        ok: true,
        empty: true,
        updatedAt: resp.updatedAt || '',
      };
    }
    if (resp && resp.ok && resp.blob) {
      return {
        ok: true,
        blob: resp.blob,
        updatedAt: resp.updatedAt || '',
      };
    }
    if (resp && resp.ok && !resp.blob) {
      return { ok: false, error: 'No OpenAI API key saved for this account yet' };
    }
    return { ok: false, error: (resp && resp.error) || 'OpenAI key pull failed', code: resp && resp.code };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function pushOpenAiApiKeyToServer(httpPost, apiUrl, licenceKey, machineId, wrapKeyHex, apiKey, opts) {
  if (!httpPost || !apiUrl || !licenceKey || !wrapKeyHex) {
    return { ok: false, error: 'OpenAI key push not configured' };
  }
  const trimmed = apiKey != null ? String(apiKey).trim() : '';
  let blob;
  try {
    blob = encryptOpenAiApiKeyBlob(wrapKeyHex, trimmed);
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Encrypt failed' };
  }
  const headers = opts && opts.headers ? opts.headers : {};
  try {
    const resp = await httpPost(`${apiUrl.replace(/\/$/, '')}${BLOB_PATH}`, {
      key: licenceKey,
      machineId: machineId,
      accountId: opts && opts.accountId ? String(opts.accountId) : undefined,
      blob,
      clear: trimmed.length === 0,
    }, { headers, timeout: opts && opts.timeout || 20000 });
    if (resp && resp.ok) {
      return { ok: true, updatedAt: resp.updatedAt || new Date().toISOString(), cleared: trimmed.length === 0 };
    }
    return { ok: false, error: (resp && resp.error) || 'OpenAI key push failed', code: resp && resp.code };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function resolveNewestOpenAiKey(localKey, localUpdatedAt, remoteKey, remoteUpdatedAt) {
  const lk = String(localKey || '').trim();
  const rk = String(remoteKey || '').trim();
  const lt = Date.parse(String(localUpdatedAt || '')) || 0;
  const rt = Date.parse(String(remoteUpdatedAt || '')) || 0;
  if (!rk && !lk) return { key: '', winner: 'none' };
  if (!rk) return { key: lk, winner: 'local' };
  if (!lk) return { key: rk, winner: 'remote' };
  if (rt > lt) return { key: rk, winner: 'remote' };
  if (lt > rt) return { key: lk, winner: 'local' };
  return { key: lk, winner: 'local' };
}

/**
 * Decide what to do when the account returns an empty OpenAI key blob.
 * An empty response with no timestamp means the account never stored a key, so
 * it must never wipe a key that exists only on this computer.
 * @returns {'apply-empty'|'push-local'|'keep-local'|'clear-local'}
 */
function resolveEmptyServerPullAction({ localHasKey, localServerUpdatedAt, serverUpdatedAt }) {
  if (!localHasKey) return 'apply-empty';
  const localTs = String(localServerUpdatedAt || '').trim();
  const serverTs = String(serverUpdatedAt || '').trim();
  if (!serverTs || !localTs) return 'push-local';
  const lt = Date.parse(localTs) || 0;
  const st = Date.parse(serverTs) || 0;
  if (st <= lt) return 'keep-local';
  return 'clear-local';
}

module.exports = {
  resolveEmptyServerPullAction,
  PAYLOAD_KEY,
  BLOB_PATH,
  pickOpenAiApiKey,
  hasOpenAiApiKey,
  encryptOpenAiApiKeyBlob,
  decryptOpenAiApiKeyBlob,
  fetchAccountWrapKey,
  pullOpenAiApiKeyFromServer,
  pushOpenAiApiKeyToServer,
  resolveNewestOpenAiKey,
};
