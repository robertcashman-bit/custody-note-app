'use strict';

/**
 * Standard police-station mileages from the fee-earner's base.
 *
 * These are the authoritative claim figures. They must be stored and applied
 * exactly (46 stays 46). Live/calculated road distances (Google/OS/km↔miles)
 * must never silently overwrite or nudge a known standard unless the caller
 * sets allowLiveOverride: true.
 */

/** LAA station code → exact miles from base (Kent / Medway practice). */
const STANDARD_MILEAGES_BY_CODE = Object.freeze({
  BG039: 46, // Tonbridge
  BG028: 46, // Gillingham, Kent (Medway custody)
  BG027: 46, // Rochester (Medway scheme)
  BG030: 46, // Chatham (Medway scheme)
});

/**
 * Parse/clean a mileage value for storage.
 * Near-integers (float noise only) snap to exact integers.
 * Intentional fractions (e.g. 12.5) are preserved — this does NOT round 45.8→46.
 *
 * @param {*} value
 * @returns {number|null}
 */
function normalizeMileageForStorage(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).trim().replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 1e-9) return rounded;
  // Cap binary float junk without changing intentional one-decimal road figures
  const cleaned = Math.round(n * 10000) / 10000;
  const oneDec = Math.round(cleaned * 10) / 10;
  if (Math.abs(cleaned - oneDec) < 1e-9) return oneDec;
  return cleaned;
}

/**
 * Exact string form for form fields / DB mirrors — whole miles have no ".0".
 * @param {*} value
 * @returns {string}
 */
function formatExactMiles(value) {
  const n = normalizeMileageForStorage(value);
  if (n == null) return '';
  return String(n);
}

/**
 * Look up the canonical standard for a station code (case-insensitive).
 * @param {string} code
 * @returns {number|null}
 */
function getStandardMileageForCode(code) {
  if (!code) return null;
  const key = String(code).trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(STANDARD_MILEAGES_BY_CODE, key)) {
    return STANDARD_MILEAGES_BY_CODE[key];
  }
  return null;
}

/**
 * Decide miles when filling a custody note / invoice from the station table.
 * Never lets a live/calculated figure replace a known standard unless
 * allowLiveOverride is explicitly true.
 *
 * @param {{
 *   standardMiles?: *,
 *   existingMiles?: *,
 *   liveMiles?: *,
 *   allowLiveOverride?: boolean,
 *   stationCode?: string
 * }} opts
 * @returns {number|null}
 */
function resolveMilesForAutofill(opts) {
  opts = opts || {};
  const existing = normalizeMileageForStorage(opts.existingMiles);
  if (existing != null && existing > 0) return existing;

  let standard = normalizeMileageForStorage(opts.standardMiles);
  if (standard == null && opts.stationCode) {
    standard = getStandardMileageForCode(opts.stationCode);
  }
  if (standard != null && standard > 0) return standard;

  if (opts.allowLiveOverride === true) {
    const live = normalizeMileageForStorage(opts.liveMiles);
    if (live != null && live > 0) return live;
  }
  return null;
}

/**
 * Decide what value to keep on the station mileage table when a proposed or
 * live figure arrives. Known standards are never nudged by live distance.
 *
 * @param {{
 *   stationCode?: string,
 *   currentMiles?: *,
 *   proposedMiles?: *,
 *   liveMiles?: *,
 *   allowLiveOverride?: boolean
 * }} opts
 * @returns {number|null}
 */
function resolveMilesForStationTable(opts) {
  opts = opts || {};
  const canonical = getStandardMileageForCode(opts.stationCode);
  const current = normalizeMileageForStorage(opts.currentMiles);
  const proposed = normalizeMileageForStorage(opts.proposedMiles);
  const live = normalizeMileageForStorage(opts.liveMiles);

  if (opts.allowLiveOverride === true && live != null && live > 0) {
    return live;
  }

  // Explicit admin edit (proposed) updates the stored standard for this machine
  if (proposed != null) {
    return proposed;
  }

  // Protect known standards from live/calculated drift
  if (canonical != null && canonical > 0) {
    if (live != null && live > 0 && live !== canonical) {
      return canonical;
    }
    if (current != null && current > 0) return current;
    return canonical;
  }

  if (current != null) return current;
  if (live != null && live > 0) return live;
  return null;
}

/**
 * True when a candidate looks like a drifted road distance vs an exact standard
 * (e.g. 45.8 / 46.6 vs 46) rather than an intentional different integer.
 */
function isLiveDriftFromStandard(standardMiles, candidateMiles) {
  const standard = normalizeMileageForStorage(standardMiles);
  const candidate = normalizeMileageForStorage(candidateMiles);
  if (standard == null || candidate == null) return false;
  if (standard === candidate) return false;
  if (Number.isInteger(candidate) && candidate !== standard) return false;
  const delta = Math.abs(candidate - standard);
  return delta > 0 && delta < 1.5;
}

/**
 * Merge a replacement LAA station catalogue while preserving per-station
 * mileage_from_base and postcode (matched by name+code).
 *
 * @param {Array<{name?:string,code?:string,mileage_from_base?:*,postcode?:string}>} existingRows
 * @param {Array<{name?:string,code?:string,scheme?:string,region?:string,schemeCode?:string,kind?:string}>} incoming
 * @returns {Array<object>}
 */
function mergeStationsPreservingMileage(existingRows, incoming) {
  const byKey = new Map();
  (existingRows || []).forEach(function (r) {
    byKey.set(String(r.name || '') + '\0' + String(r.code || ''), r);
  });
  return (incoming || []).map(function (s) {
    const key = String(s.name || '') + '\0' + String(s.code || '');
    const prev = byKey.get(key);
    let mileage = prev && prev.mileage_from_base != null
      ? normalizeMileageForStorage(prev.mileage_from_base)
      : null;
    const canonical = getStandardMileageForCode(s.code);
    if (mileage == null && canonical != null) {
      mileage = canonical;
    } else if (canonical != null && isLiveDriftFromStandard(canonical, mileage)) {
      mileage = canonical;
    } else if (mileage == null) {
      mileage = null;
    }
    return {
      name: s.name || '',
      code: s.code || '',
      scheme: s.scheme || '',
      region: s.region || '',
      schemeCode: s.schemeCode || s.scheme_code || '',
      kind: s.kind || 'station',
      mileage_from_base: mileage,
      postcode: prev && prev.postcode != null ? String(prev.postcode) : '',
    };
  });
}

/**
 * SQL updates to (re)apply canonical standards. Safe to run repeatedly.
 * @returns {Array<{sql:string, params:Array}>}
 */
function canonicalStandardMileageStatements() {
  return Object.keys(STANDARD_MILEAGES_BY_CODE).map(function (code) {
    return {
      sql: 'UPDATE police_stations SET mileage_from_base = ? WHERE code = ?',
      params: [STANDARD_MILEAGES_BY_CODE[code], code],
    };
  });
}

const StationMileage = {
  STANDARD_MILEAGES_BY_CODE,
  normalizeMileageForStorage,
  formatExactMiles,
  getStandardMileageForCode,
  resolveMilesForAutofill,
  resolveMilesForStationTable,
  isLiveDriftFromStandard,
  mergeStationsPreservingMileage,
  canonicalStandardMileageStatements,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StationMileage;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StationMileage = StationMileage;
}
