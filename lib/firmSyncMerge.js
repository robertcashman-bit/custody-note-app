'use strict';

/**
 * Automatic firm merge — no user prompts. Field-level newest-wins; never drop
 * a non-empty value for an empty remote/local unless the newer side cleared it.
 */

const FIRM_SCALAR_FIELDS = [
  'name',
  'laa_account',
  'contact_name',
  'contact_email',
  'contact_phone',
  'address',
  'source_of_referral',
  'quickfile_client_id',
];

function parseTime(iso) {
  if (!iso) return 0;
  const n = Date.parse(String(iso));
  return Number.isFinite(n) ? n : 0;
}

function normStr(v) {
  return v == null ? '' : String(v).trim();
}

function normName(name) {
  return normStr(name).toLowerCase();
}

function pickField(localVal, remoteVal, localUpdated, remoteUpdated) {
  const l = normStr(localVal);
  const r = normStr(remoteVal);
  if (l && !r) return l;
  if (r && !l) return r;
  if (l === r) return l;
  return localUpdated >= remoteUpdated ? l : r;
}

/**
 * @param {object|null} local
 * @param {object} remote
 * @returns {{ merged: object, changed: boolean }}
 */
function mergeFirmRecords(local, remote) {
  const loc = local || {};
  const rem = remote || {};
  const localUpdated = parseTime(loc.updated_at);
  const remoteUpdated = parseTime(rem.updated_at);
  const merged = {
    id: loc.id,
    sync_id: loc.sync_id || rem.sync_id || '',
    name: pickField(loc.name, rem.name, localUpdated, remoteUpdated) || normStr(rem.name) || normStr(loc.name),
    laa_account: pickField(loc.laa_account, rem.laa_account, localUpdated, remoteUpdated),
    contact_name: pickField(loc.contact_name, rem.contact_name, localUpdated, remoteUpdated),
    contact_email: pickField(loc.contact_email, rem.contact_email, localUpdated, remoteUpdated),
    contact_phone: pickField(loc.contact_phone, rem.contact_phone, localUpdated, remoteUpdated),
    address: pickField(loc.address, rem.address, localUpdated, remoteUpdated),
    source_of_referral: pickField(loc.source_of_referral, rem.source_of_referral, localUpdated, remoteUpdated),
    quickfile_client_id: pickField(loc.quickfile_client_id, rem.quickfile_client_id, localUpdated, remoteUpdated),
    is_default: Math.max(Number(loc.is_default) || 0, Number(rem.is_default) || 0) ? 1 : 0,
    updated_at: new Date(Math.max(localUpdated, remoteUpdated, Date.now())).toISOString(),
    sync_version: Math.max(Number(loc.sync_version) || 1, Number(rem.sync_version) || 1) + 1,
    sync_dirty: 1,
  };
  let changed = !local;
  if (local) {
    for (let i = 0; i < FIRM_SCALAR_FIELDS.length; i++) {
      const f = FIRM_SCALAR_FIELDS[i];
      if (normStr(local[f]) !== normStr(merged[f])) {
        changed = true;
        break;
      }
    }
    if (!changed && Number(local.is_default) !== Number(merged.is_default)) changed = true;
  }
  return { merged, changed };
}

/**
 * Choose a local row to merge with an incoming remote firm.
 * @param {object[]} localRows
 * @param {object} remote
 */
function matchLocalFirm(localRows, remote) {
  const remSync = normStr(remote.sync_id);
  if (remSync) {
    const bySync = localRows.find((r) => normStr(r.sync_id) === remSync);
    if (bySync) return bySync;
  }
  const remQf = normStr(remote.quickfile_client_id);
  if (remQf) {
    const byQf = localRows.find((r) => normStr(r.quickfile_client_id) === remQf);
    if (byQf) return byQf;
  }
  const remName = normName(remote.name);
  if (remName) {
    const byName = localRows.find((r) => normName(r.name) === remName);
    if (byName) return byName;
  }
  return null;
}

/**
 * Dedupe local firms that share the same sync_id or quickfile_client_id or name.
 * Keeps the row with the highest sync_version / updated_at and merges fields in.
 * @param {object[]} rows mutable list
 * @returns {{ rows: object[], removedIds: number[] }}
 */
function dedupeLocalFirms(rows) {
  const list = (rows || []).slice();
  const removedIds = [];
  const bySync = new Map();
  const byQf = new Map();
  const byName = new Map();

  function score(row) {
    return parseTime(row.updated_at) + (Number(row.sync_version) || 0) * 1000;
  }

  for (const row of list) {
    const syncKey = normStr(row.sync_id);
    const qfKey = normStr(row.quickfile_client_id);
    const nameKey = normName(row.name);
    let keeper = row;

    if (syncKey && bySync.has(syncKey)) {
      const other = bySync.get(syncKey);
      const pick = score(other) >= score(row) ? other : row;
      const drop = pick === other ? row : other;
      const { merged } = mergeFirmRecords(pick, drop);
      Object.assign(pick, merged);
      if (drop.id && drop.id !== pick.id) removedIds.push(drop.id);
      keeper = pick;
    }
    if (qfKey && byQf.has(qfKey)) {
      const other = byQf.get(qfKey);
      if (other !== keeper) {
        const pick = score(other) >= score(keeper) ? other : keeper;
        const drop = pick === other ? keeper : other;
        const { merged } = mergeFirmRecords(pick, drop);
        Object.assign(pick, merged);
        if (drop.id && drop.id !== pick.id && removedIds.indexOf(drop.id) === -1) removedIds.push(drop.id);
        keeper = pick;
      }
    }
    if (nameKey && byName.has(nameKey)) {
      const other = byName.get(nameKey);
      if (other !== keeper && normStr(keeper.sync_id) && normStr(other.sync_id) && keeper.sync_id !== other.sync_id) {
        // Different sync_ids with same name — merge into newer, keep both ids only if QF ids differ; prefer merge
        const pick = score(other) >= score(keeper) ? other : keeper;
        const drop = pick === other ? keeper : other;
        const { merged } = mergeFirmRecords(pick, drop);
        Object.assign(pick, merged);
        if (drop.id && drop.id !== pick.id && removedIds.indexOf(drop.id) === -1) removedIds.push(drop.id);
        keeper = pick;
      }
    }
    if (syncKey) bySync.set(syncKey, keeper);
    if (qfKey) byQf.set(qfKey, keeper);
    if (nameKey) byName.set(nameKey, keeper);
  }

  const keepIds = new Set();
  for (const v of bySync.values()) if (v && v.id) keepIds.add(v.id);
  for (const v of byQf.values()) if (v && v.id) keepIds.add(v.id);
  for (const v of byName.values()) if (v && v.id) keepIds.add(v.id);
  for (const row of list) if (row && row.id) keepIds.add(row.id);

  const filtered = list.filter((r) => r && r.id && keepIds.has(r.id) && removedIds.indexOf(r.id) === -1);
  return { rows: filtered, removedIds };
}

module.exports = {
  FIRM_SCALAR_FIELDS,
  mergeFirmRecords,
  matchLocalFirm,
  dedupeLocalFirms,
  normName,
};
