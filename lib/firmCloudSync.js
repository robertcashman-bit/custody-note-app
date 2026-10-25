'use strict';

/**
 * Cloud sync for instructing firms (same account + master key as attendance sync).
 */

const { encryptSyncEnvelope, decryptSyncEnvelope } = require('./syncRecordCrypto');
const { mergeFirmRecords, matchLocalFirm, dedupeLocalFirms } = require('./firmSyncMerge');
const { buildSyncAuthHeaders } = require('./syncPullGuard');

const FIRM_PULL_SINCE_KEY = 'firmsLastSyncPullAt';

function firmRowToPayload(row) {
  return {
    syncId: row.sync_id,
    name: row.name || '',
    laa_account: row.laa_account || '',
    contact_name: row.contact_name || '',
    contact_email: row.contact_email || '',
    contact_phone: row.contact_phone || '',
    address: row.address || '',
    source_of_referral: row.source_of_referral || '',
    quickfile_client_id: row.quickfile_client_id || '',
    is_default: Number(row.is_default) || 0,
    updated_at: row.updated_at || new Date().toISOString(),
    version: Number(row.sync_version) || 1,
  };
}

function payloadToFirmRow(payload) {
  const p = payload || {};
  return {
    sync_id: p.syncId || p.sync_id || '',
    name: p.name || '',
    laa_account: p.laa_account || '',
    contact_name: p.contact_name || '',
    contact_email: p.contact_email || '',
    contact_phone: p.contact_phone || '',
    address: p.address || '',
    source_of_referral: p.source_of_referral || '',
    quickfile_client_id: p.quickfile_client_id || '',
    is_default: Number(p.is_default) || 0,
    updated_at: p.updated_at || new Date().toISOString(),
    sync_version: Number(p.version || p.sync_version) || 1,
    sync_dirty: 0,
  };
}

function buildPushRecords(rows, masterKeyHex) {
  return (rows || []).map((row) => {
    const body = firmRowToPayload(row);
    return {
      syncId: body.syncId,
      envelope: encryptSyncEnvelope(masterKeyHex, body),
      encrypted: true,
      updatedAt: body.updated_at,
      version: body.version,
    };
  });
}

function decryptRemoteFirm(envelope, masterKeyHex) {
  const dec = decryptSyncEnvelope(masterKeyHex, envelope);
  if (!dec) return null;
  return payloadToFirmRow(dec);
}

/**
 * @param {object} deps db + http + licence (mirrors sync pull)
 */
async function pullFirmsFromCloud(deps) {
  const apiUrl = deps.getSyncApiUrl && deps.getSyncApiUrl();
  if (!apiUrl) return { pulled: 0, skipped: 'no_api' };
  const data = deps.readLicenceData && deps.readLicenceData();
  if (!data || !data.key) return { pulled: 0, skipped: 'auth_required' };
  const licenceKey = deps.normalizeLicenceKeyForSync(data.key);
  const masterKeyHex = deps.getMasterKeyHex && deps.getMasterKeyHex();
  if (!masterKeyHex) return { pulled: 0, skipped: 'no_master_key' };

  const since = deps.getSetting(FIRM_PULL_SINCE_KEY) || '1970-01-01T00:00:00.000Z';
  const headers = buildSyncAuthHeaders({
    authToken: data.authToken || null,
    licenceKey,
    accountId: data.accountId || null,
  });
  let resp;
  try {
    resp = await deps.httpPost(`${apiUrl.replace(/\/$/, '')}/api/sync/firms/pull`, {
      key: licenceKey,
      machineId: deps.getMachineId(),
      accountId: data.accountId || undefined,
      since,
    }, { headers, timeout: 30000 });
  } catch (e) {
    return { pulled: 0, error: e && e.message ? e.message : String(e) };
  }
  if (!resp || !resp.ok) {
    return { pulled: 0, error: (resp && resp.error) || 'pull_failed' };
  }
  const remoteList = Array.isArray(resp.firms) ? resp.firms : [];
  const localRows = deps.dbAll(
    'SELECT id, sync_id, name, laa_account, contact_name, contact_email, contact_phone, address, source_of_referral, quickfile_client_id, is_default, updated_at, sync_dirty, sync_version FROM firms'
  ) || [];
  let merged = 0;
  for (let i = 0; i < remoteList.length; i++) {
    const item = remoteList[i];
    const remote = decryptRemoteFirm(item.envelope, masterKeyHex);
    if (!remote || !remote.sync_id) continue;
    const localMatch = matchLocalFirm(localRows, remote);
    if (localMatch) {
      const { merged: m, changed } = mergeFirmRecords(localMatch, remote);
      if (changed) {
        deps.dbRun(
          'UPDATE firms SET name=?, laa_account=?, contact_name=?, contact_email=?, contact_phone=?, address=?, source_of_referral=?, quickfile_client_id=?, is_default=?, updated_at=?, sync_version=?, sync_dirty=? WHERE id=?',
          [
            m.name, m.laa_account, m.contact_name, m.contact_email, m.contact_phone, m.address,
            m.source_of_referral, m.quickfile_client_id, m.is_default, m.updated_at, m.sync_version, 0, localMatch.id,
          ]
        );
        Object.assign(localMatch, m, { sync_dirty: 0 });
        merged++;
      }
    } else {
      deps.dbRun(
        'INSERT INTO firms (sync_id, name, laa_account, contact_name, contact_email, contact_phone, address, source_of_referral, quickfile_client_id, is_default, updated_at, sync_version, sync_dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)',
        [
          remote.sync_id, remote.name, remote.laa_account, remote.contact_name, remote.contact_email,
          remote.contact_phone, remote.address, remote.source_of_referral, remote.quickfile_client_id,
          remote.is_default, remote.updated_at, remote.sync_version,
        ]
      );
      localRows.push(Object.assign({ id: null }, remote));
      merged++;
    }
  }
  if (resp.serverTime) deps.setSetting(FIRM_PULL_SINCE_KEY, resp.serverTime);
  const dedupe = dedupeLocalFirms(deps.dbAll('SELECT id, sync_id, name, laa_account, contact_name, contact_email, contact_phone, address, source_of_referral, quickfile_client_id, is_default, updated_at, sync_dirty, sync_version FROM firms') || []);
  for (let j = 0; j < dedupe.removedIds.length; j++) {
    deps.dbRun('DELETE FROM firms WHERE id=?', [dedupe.removedIds[j]]);
  }
  if (merged > 0 || dedupe.removedIds.length) deps.markDbDirty && deps.markDbDirty();
  return { pulled: merged, deduped: dedupe.removedIds.length, received: remoteList.length };
}

async function pushDirtyFirmsToCloud(deps) {
  const apiUrl = deps.getSyncApiUrl && deps.getSyncApiUrl();
  if (!apiUrl) return { pushed: 0, skipped: 'no_api' };
  const data = deps.readLicenceData && deps.readLicenceData();
  if (!data || !data.key) return { pushed: 0, skipped: 'auth_required' };
  const licenceKey = deps.normalizeLicenceKeyForSync(data.key);
  const masterKeyHex = deps.getMasterKeyHex && deps.getMasterKeyHex();
  if (!masterKeyHex) return { pushed: 0, skipped: 'no_master_key' };

  const dirty = deps.dbAll(
    'SELECT id, sync_id, name, laa_account, contact_name, contact_email, contact_phone, address, source_of_referral, quickfile_client_id, is_default, updated_at, sync_dirty, sync_version FROM firms WHERE sync_dirty=1 LIMIT 100'
  ) || [];
  if (!dirty.length) return { pushed: 0 };

  for (let i = 0; i < dirty.length; i++) {
    if (!dirty[i].sync_id && deps.generateSyncId) {
      const sid = deps.generateSyncId();
      deps.dbRun('UPDATE firms SET sync_id=? WHERE id=?', [sid, dirty[i].id]);
      dirty[i].sync_id = sid;
    }
  }

  const records = buildPushRecords(dirty, masterKeyHex);
  const headers = buildSyncAuthHeaders({
    authToken: data.authToken || null,
    licenceKey,
    accountId: data.accountId || null,
  });
  let resp;
  try {
    resp = await deps.httpPost(`${apiUrl.replace(/\/$/, '')}/api/sync/firms/push`, {
      key: licenceKey,
      machineId: deps.getMachineId(),
      accountId: data.accountId || undefined,
      firms: records,
    }, { headers, timeout: 30000 });
  } catch (e) {
    return { pushed: 0, error: e && e.message ? e.message : String(e) };
  }
  if (!resp || !resp.ok) {
    return { pushed: 0, error: (resp && resp.error) || 'push_failed' };
  }
  const written = Number(resp.written) || 0;
  for (let k = 0; k < dirty.length; k++) {
    deps.dbRun('UPDATE firms SET sync_dirty=0 WHERE id=?', [dirty[k].id]);
  }
  if (written > 0) deps.markDbDirty && deps.markDbDirty();
  return { pushed: written };
}

module.exports = {
  FIRM_PULL_SINCE_KEY,
  pullFirmsFromCloud,
  pushDirtyFirmsToCloud,
  firmRowToPayload,
  buildPushRecords,
  decryptRemoteFirm,
};
