/* ═══════════════════════════════════════════════════════
   QUICK EMAIL — central token rendering (no DOM)
   Used by Quick Email modal and tests. Placeholders: {{token}}
   Canonical keys match buildPlaceholderMap / form (oicName, station, …).
   Aliases: {{officerName}}, {{policeStation}}, {{offence}} → same values.
   ═══════════════════════════════════════════════════════ */

(function (global) {
  var ALIAS_TO_CANONICAL = {
    officerName: 'oicName',
    policeStation: 'station',
    offence: 'offenceType'
  };

  function canonicalPlaceholderKey(key) {
    var k = String(key || '').trim();
    return ALIAS_TO_CANONICAL[k] || k;
  }

  /** Expand map so both {{oicName}} and {{officerName}} resolve. */
  function expandQuickEmailValueMap(map) {
    map = map || {};
    var out = Object.assign({}, map);
    if (out.oicName != null && out.officerName == null) out.officerName = out.oicName;
    if (out.station != null && out.policeStation == null) out.policeStation = out.station;
    if (out.offenceType != null && out.offence == null) out.offence = out.offenceType;
    return out;
  }

  function applyQuickEmailTokens(text, map) {
    var m = expandQuickEmailValueMap(map);
    return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function (_, rawKey) {
      var key = String(rawKey || '').trim();
      var val = m[key];
      return val != null ? String(val) : '';
    });
  }

  function renderQuickEmailFromTemplates(subjectTpl, bodyTpl, map) {
    return {
      subject: applyQuickEmailTokens(subjectTpl, map),
      body: applyQuickEmailTokens(bodyTpl, map)
    };
  }

  /** Unique placeholder keys in canonical form (deduped, order preserved). */
  function extractQuickEmailPlaceholderKeys(subjectTpl, bodyTpl) {
    var text = String(subjectTpl || '') + '\n' + String(bodyTpl || '');
    var re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    var seen = Object.create(null);
    var keys = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      var c = canonicalPlaceholderKey(m[1]);
      if (!seen[c]) {
        seen[c] = true;
        keys.push(c);
      }
    }
    return keys;
  }

  var LABELS = {
    clientName: 'Client name',
    oicName: 'Officer name',
    officerName: 'Officer name',
    station: 'Police station',
    policeStation: 'Police station',
    offenceType: 'Offence / case',
    offence: 'Offence / case',
    feeEarnerName: 'Fee earner',
    date: 'Date',
    time: 'Time',
    time24: 'Time (24h)',
    attendanceType: 'Attendance type',
    officerEmail: 'Officer email',
    contactName: 'Firm contact',
    firmName: 'Firm',
    outcome: 'Outcome',
    nextStep: 'Next step',
    followUp: 'Follow-up',
    ourFileNumber: 'File number',
    ufn: 'UFN'
  };

  function labelForQuickEmailKey(key) {
    return LABELS[key] || LABELS[canonicalPlaceholderKey(key)] || key;
  }

  /**
   * Which template placeholders are empty in map (after canonical lookup).
   * @returns {Array<{ key: string, label: string }>}
   */
  function listMissingQuickEmailPlaceholders(subjectTpl, bodyTpl, map) {
    var keys = extractQuickEmailPlaceholderKeys(subjectTpl, bodyTpl);
    var missing = [];
    for (var i = 0; i < keys.length; i++) {
      var ck = keys[i];
      var rawVal = map[ck];
      if (rawVal == null || String(rawVal).trim() === '') {
        missing.push({ key: ck, label: labelForQuickEmailKey(ck) });
      }
    }
    return missing;
  }

  global.canonicalPlaceholderKey = canonicalPlaceholderKey;
  global.expandQuickEmailValueMap = expandQuickEmailValueMap;
  global.applyQuickEmailTokens = applyQuickEmailTokens;
  global.renderQuickEmailFromTemplates = renderQuickEmailFromTemplates;
  global.extractQuickEmailPlaceholderKeys = extractQuickEmailPlaceholderKeys;
  global.quickEmailPlaceholderLabel = labelForQuickEmailKey;
  global.listMissingQuickEmailPlaceholders = listMissingQuickEmailPlaceholders;
})(typeof window !== 'undefined' ? window : globalThis);
