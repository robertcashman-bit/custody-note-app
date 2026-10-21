'use strict';

/**
 * QuickFile API credentials sync for a Custody Note account.
 *
 * Policy
 * ------
 * - Credentials (account number, API key, application ID) sync between computers
 *   on the same account.
 * - They are NOT stored in the general /api/settings/quickfile preferences blob
 *   (that blob stays licence-key encrypted and must never expose API keys to
 *   someone who only knows the licence key string).
 * - Credentials are encrypted client-side with a random per-account wrap key
 *   held on custodynote.com and released only to authenticated, activated
 *   devices (within the 5-computer limit). Revoked devices must not receive
 *   the wrap key.
 * - Never log credential values or wrap keys.
 */

const { encryptWithWrapKey, decryptWithWrapKey } = require('./quickfileWrapKeyCrypto');

const CREDENTIAL_KEYS = ['quickfileAccountNumber', 'quickfileApiKey', 'quickfileAppId'];

const WRAP_KEY_PATH = '/api/account/quickfile-wrap-key';
const CREDENTIALS_BLOB_PATH = '/api/settings/quickfile-credentials';

function pickQuickFileCredentials(settings) {
  const src = settings && typeof settings === 'object' ? settings : {};
  const out = {};
  for (let i = 0; i < CREDENTIAL_KEYS.length; i++) {
    const k = CREDENTIAL_KEYS[i];
    out[k] = src[k] != null ? String(src[k]) : '';
  }
  return out;
}

function hasCompleteQuickFileCredentials(settings) {
  const p = pickQuickFileCredentials(settings);
  return !!(
    String(p.quickfileAccountNumber || '').trim()
    && String(p.quickfileApiKey || '').trim()
    && String(p.quickfileAppId || '').trim()
  );
}

function mergeCredentialMaps(local, remote) {
  const l = pickQuickFileCredentials(local);
  const r = pickQuickFileCredentials(remote);
  const merged = {};
  for (let i = 0; i < CREDENTIAL_KEYS.length; i++) {
    const key = CREDENTIAL_KEYS[i];
    const lv = String(l[key] || '').trim();
    const rv = String(r[key] || '').trim();
    merged[key] = lv || rv;
  }
  return merged;
}

/**
 * Fetch the per-account wrap key. Server must verify Bearer auth, licence,
 * machineId, and active device registration before responding.
 */
async function fetchAccountWrapKey(httpPost, apiUrl, licenceKey, machineId, opts) {
  if (!httpPost || !apiUrl || !licenceKey) {
    return { ok: false, error: 'Credential sync not configured' };
  }
  const headers = opts && opts.headers ? opts.headers : {};
  try {
    const resp = await httpPost(`${apiUrl.replace(/\/$/, '')}${WRAP_KEY_PATH}`, {
      key: licenceKey,
      machineId: machineId,
      accountId: opts && opts.accountId ? String(opts.accountId) : undefined,
    }, { headers, timeout: opts && opts.timeout || 15000 });
    if (resp && resp.ok && resp.wrapKeyHex) {
      return { ok: true, wrapKeyHex: String(resp.wrapKeyHex).trim() };
    }
    return { ok: false, error: (resp && resp.error) || 'Wrap key unavailable', code: resp && resp.code };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function pullQuickFileCredentialsFromServer(httpPost, apiUrl, licenceKey, machineId, wrapKeyHex, opts) {
  if (!httpPost || !apiUrl || !licenceKey || !wrapKeyHex) {
    return { ok: false, error: 'Credential pull not configured' };
  }
  const headers = opts && opts.headers ? opts.headers : {};
  try {
    const resp = await httpPost(`${apiUrl.replace(/\/$/, '')}${CREDENTIALS_BLOB_PATH}`, {
      key: licenceKey,
      machineId: machineId,
      accountId: opts && opts.accountId ? String(opts.accountId) : undefined,
    }, { headers, timeout: opts && opts.timeout || 15000 });
    if (resp && resp.ok && resp.blob) {
      return {
        ok: true,
        blob: resp.blob,
        updatedAt: resp.updatedAt || '',
      };
    }
    if (resp && resp.ok && !resp.blob) {
      return { ok: false, error: 'No QuickFile credentials saved for this account yet' };
    }
    return { ok: false, error: (resp && resp.error) || 'Credential pull failed' };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function pushQuickFileCredentialsToServer(httpPost, apiUrl, licenceKey, machineId, wrapKeyHex, settings, opts) {
  if (!httpPost || !apiUrl || !licenceKey || !wrapKeyHex) {
    return { ok: false, error: 'Credential push not configured' };
  }
  if (!hasCompleteQuickFileCredentials(settings)) {
    return { ok: false, error: 'QuickFile credentials incomplete' };
  }
  let blob;
  try {
    blob = encryptWithWrapKey(wrapKeyHex, pickQuickFileCredentials(settings));
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Encrypt failed' };
  }
  const headers = opts && opts.headers ? opts.headers : {};
  try {
    const resp = await httpPost(`${apiUrl.replace(/\/$/, '')}${CREDENTIALS_BLOB_PATH}`, {
      key: licenceKey,
      machineId: machineId,
      accountId: opts && opts.accountId ? String(opts.accountId) : undefined,
      blob,
    }, { headers, timeout: opts && opts.timeout || 20000 });
    if (resp && resp.ok) {
      return { ok: true, updatedAt: resp.updatedAt || new Date().toISOString() };
    }
    return { ok: false, error: (resp && resp.error) || 'Credential push failed' };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function decryptCredentialBlob(wrapKeyHex, blob) {
  const parsed = decryptWithWrapKey(wrapKeyHex, blob);
  if (!parsed) return null;
  return pickQuickFileCredentials(parsed);
}

module.exports = {
  CREDENTIAL_KEYS,
  WRAP_KEY_PATH,
  CREDENTIALS_BLOB_PATH,
  pickQuickFileCredentials,
  hasCompleteQuickFileCredentials,
  mergeCredentialMaps,
  fetchAccountWrapKey,
  pullQuickFileCredentialsFromServer,
  pushQuickFileCredentialsToServer,
  decryptCredentialBlob,
  encryptWithWrapKey,
  decryptWithWrapKey,
};
