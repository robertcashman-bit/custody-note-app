/* ═══════════════════════════════════════════════════════
   QUICK EMAIL — central token rendering (no DOM)
   Used by Quick Email modal and tests. Placeholders: {{token}}
   Canonical keys match buildPlaceholderMap / form (oicName, station, …).
   Aliases let templates use natural names like {{officer_name}}, {{client_name}}, …
   Conditional blocks: {{#if KEY}}…{{/if}} and {{#if KEY}}…{{else}}…{{/if}}
   ═══════════════════════════════════════════════════════ */

(function (global) {
  /* ── Aliases → canonical keys ─────────────────────────────
     Keep both camelCase and snake_case forms so templates
     can be written in whichever style reads naturally.
     ─────────────────────────────────────────────────────── */
  var ALIAS_TO_CANONICAL = {
    /* legacy camelCase aliases */
    officerName:       'oicName',
    policeStation:     'station',
    offence:           'offenceType',

    /* snake_case forms used in spec & friendly editor labels */
    officer_name:      'oicName',
    officer_email:     'officerEmail',
    client_name:       'clientName',
    police_station:    'station',
    attendance_type:   'attendanceType',
    attendance_date:   'date',
    attendance_time:   'time',
    today_date:        'todayDate',
    user_name:         'feeEarnerName',
    user_firm:         'firmName',
    user_email:        'feeEarnerEmail',
    user_phone:        'feeEarnerPhone',

    /* optional matter fields */
    custody_number:    'custodyNumber',
    custodyNo:         'custodyNumber',
    dscc_ref:          'dsccRef',
    bail_date:         'bailDate',
    bail_time:         'bailTime',
    bail_conditions:   'bailConditions',
    allegation_summary:'allegationSummary',
    reply_deadline:    'replyDeadline'
  };

  function canonicalPlaceholderKey(key) {
    var k = String(key || '').trim();
    return ALIAS_TO_CANONICAL[k] || k;
  }

  /** Expand map so both {{oicName}} and {{officerName}} resolve, etc. */
  function expandQuickEmailValueMap(map) {
    map = map || {};
    var out = Object.assign({}, map);

    /* For every alias, mirror its value into the alias name too,
       so templates using either style render identically. */
    for (var alias in ALIAS_TO_CANONICAL) {
      if (!Object.prototype.hasOwnProperty.call(ALIAS_TO_CANONICAL, alias)) continue;
      var canonical = ALIAS_TO_CANONICAL[alias];
      if (out[alias] == null && out[canonical] != null) {
        out[alias] = out[canonical];
      }
      if (out[canonical] == null && out[alias] != null) {
        out[canonical] = out[alias];
      }
    }
    /* todayDate fallback */
    if (out.todayDate == null || String(out.todayDate).trim() === '') {
      var d = new Date();
      var dd = String(d.getDate()).padStart(2, '0');
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      out.todayDate = dd + '/' + mm + '/' + d.getFullYear();
      out.today_date = out.todayDate;
    }
    return out;
  }

  /* ── Conditional pre-pass ─────────────────────────────────
     {{#if KEY}}A{{else}}B{{/if}}  → A if KEY has value, else B
     {{#if KEY}}A{{/if}}            → A if KEY has value, else ""
     Nested ifs are NOT supported (intentionally simple).
     ─────────────────────────────────────────────────────── */
  function _hasValue(map, rawKey) {
    var k = canonicalPlaceholderKey(rawKey);
    var v = map[k];
    if (v == null) v = map[rawKey];
    return v != null && String(v).trim() !== '';
  }

  function _resolveConditionals(text, map) {
    if (!text) return '';
    var out = String(text);
    /* Match the INNERMOST {{#if X}}…{{/if}} block on each pass: the body
       must not itself contain a nested {{#if. Re-running until stable
       resolves outer blocks too — supports arbitrary nesting depth. */
    var re = /\{\{\s*#if\s+([a-zA-Z0-9_]+)\s*\}\}((?:(?!\{\{\s*#if\b)[\s\S])*?)\{\{\s*\/if\s*\}\}/g;
    var prev;
    var safety = 0;
    do {
      prev = out;
      out = out.replace(re, function(_match, key, body) {
        var elseIdx = body.indexOf('{{else}}');
        var truthy, falsy;
        if (elseIdx === -1) {
          truthy = body;
          falsy = '';
        } else {
          truthy = body.slice(0, elseIdx);
          falsy = body.slice(elseIdx + '{{else}}'.length);
        }
        return _hasValue(map, key) ? truthy : falsy;
      });
      safety++;
    } while (out !== prev && safety < 10);
    return out;
  }

  /* ── Cleanup: collapse blank-line runs left by removed conditionals ── */
  function _tidyWhitespace(text) {
    var s = String(text || '');
    /* Trim trailing spaces on each line */
    s = s.replace(/[ \t]+\n/g, '\n');
    /* Collapse 3+ consecutive newlines down to 2 (one blank line max) */
    s = s.replace(/\n{3,}/g, '\n\n');
    /* Trim leading/trailing blank lines */
    s = s.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '\n');
    return s;
  }

  function applyQuickEmailTokens(text, map) {
    var m = expandQuickEmailValueMap(map);
    var resolved = _resolveConditionals(text, m);
    var substituted = resolved.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function (_, rawKey) {
      var key = String(rawKey || '').trim();
      var val = m[key];
      if (val == null) val = m[canonicalPlaceholderKey(key)];
      return val != null ? String(val) : '';
    });
    return _tidyWhitespace(substituted);
  }

  function renderQuickEmailFromTemplates(subjectTpl, bodyTpl, map) {
    return {
      subject: applyQuickEmailTokens(subjectTpl, map).replace(/\n+/g, ' ').trim(),
      body:    applyQuickEmailTokens(bodyTpl, map)
    };
  }

  /** Unique placeholder keys in canonical form (deduped, order preserved).
      Walks both plain {{tokens}} and conditional {{#if KEY}}…{{/if}} blocks. */
  function extractQuickEmailPlaceholderKeys(subjectTpl, bodyTpl) {
    var text = String(subjectTpl || '') + '\n' + String(bodyTpl || '');
    var seen = Object.create(null);
    var keys = [];

    var ifRe = /\{\{\s*#if\s+([a-zA-Z0-9_]+)\s*\}\}/g;
    var tokenRe = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    var m;
    while ((m = ifRe.exec(text)) !== null) {
      var ck = canonicalPlaceholderKey(m[1]);
      if (!seen[ck]) { seen[ck] = true; keys.push(ck); }
    }
    while ((m = tokenRe.exec(text)) !== null) {
      var name = m[1];
      if (name === 'else' || name === '/if') continue;
      if (/^#if$/.test(name)) continue;
      var c = canonicalPlaceholderKey(name);
      if (!seen[c]) { seen[c] = true; keys.push(c); }
    }
    return keys;
  }

  /* ── Friendly labels ──────────────────────────────────────
     Editor displays {{clientName}}  as  [CLIENT NAME].
     Saving converts back. Unknown tokens fall back to a
     generic UPPER_SNAKE_CASE rendering so nothing is lost.
     ─────────────────────────────────────────────────────── */
  /* Canonical label table — one entry per canonical key only. Aliases
     (officerName, policeStation, offence) are resolved via canonicalPlaceholderKey
     before lookup, so the friendly-label round-trip always returns the
     canonical token form. */
  var LABELS = {
    clientName:        'Client name',
    oicName:           'Officer name',
    station:           'Police station',
    offenceType:       'Offence',
    feeEarnerName:     'Fee earner name',
    feeEarnerEmail:    'Fee earner email',
    feeEarnerPhone:    'Fee earner phone',
    firmName:          'Firm name',
    date:              'Date',
    time:              'Time',
    time24:            'Time (24h)',
    todayDate:         "Today's date",
    attendanceType:    'Attendance type',
    officerEmail:      'Officer email',
    contactName:       'Firm contact',
    outcome:           'Outcome',
    nextStep:          'Next step',
    followUp:          'Follow-up',
    ourFileNumber:     'File number',
    ufn:               'UFN',
    custodyNumber:     'Custody number',
    dsccRef:           'DSCC reference',
    bailDate:          'Bail return date',
    bailTime:          'Bail return time',
    bailConditions:    'Bail conditions',
    allegationSummary: 'Allegation summary',
    replyDeadline:     'Reply by'
  };

  function labelForQuickEmailKey(key) {
    return LABELS[key] || LABELS[canonicalPlaceholderKey(key)] || _humaniseKey(key);
  }

  function _humaniseKey(key) {
    var s = String(key || '');
    /* camelCase → "Camel Case", snake_case → "Snake Case" */
    s = s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function _labelToBracketToken(label) {
    return '[' + String(label).toUpperCase() + ']';
  }

  /** Replace every {{token}} with its [FRIENDLY LABEL] for editor display.
      Conditional blocks {{#if X}}…{{/if}} are kept intact (rare in user-edited
      templates; advanced authors can still see them). */
  function tokensToFriendlyLabels(text) {
    return String(text || '').replace(
      /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
      function(match, name) {
        if (name === 'else' || name === '/if') return match;
        if (/^#if$/.test(name)) return match;
        return _labelToBracketToken(labelForQuickEmailKey(name));
      }
    );
  }

  /** Inverse of tokensToFriendlyLabels: turn [LABEL] / [labelText] back into
      {{canonicalKey}}. Unknown labels are kept as plain text. */
  function friendlyLabelsToTokens(text) {
    /* Build a label → canonical-key index (case-insensitive). */
    var labelIndex = {};
    for (var canon in LABELS) {
      if (!Object.prototype.hasOwnProperty.call(LABELS, canon)) continue;
      labelIndex[LABELS[canon].toLowerCase()] = canon;
    }
    /* Also accept the canonical key written in brackets, e.g. [CLIENT_NAME]. */
    return String(text || '').replace(/\[([A-Za-z][A-Za-z0-9 _\-']*)\]/g, function(match, inner) {
      var raw = String(inner).trim();
      var lower = raw.toLowerCase();
      if (labelIndex[lower]) return '{{' + labelIndex[lower] + '}}';
      /* Try canonical alias resolution (e.g. [client_name]) */
      var aliasResolved = canonicalPlaceholderKey(raw);
      if (aliasResolved && aliasResolved !== raw && LABELS[aliasResolved]) {
        return '{{' + aliasResolved + '}}';
      }
      /* Try snake_case version of the bracket text */
      var snake = lower.replace(/[ \-]+/g, '_');
      if (ALIAS_TO_CANONICAL[snake]) return '{{' + ALIAS_TO_CANONICAL[snake] + '}}';
      /* Try direct lookup against LABELS keys (e.g. [oicName]) */
      if (LABELS[raw]) return '{{' + raw + '}}';
      return match;
    });
  }

  /**
   * Which template placeholders are empty in map (after canonical lookup).
   * Conditional placeholders are considered "optional" — a missing value just
   * removes the wrapped block, so we don't report it as missing.
   * @returns {Array<{ key: string, label: string }>}
   */
  function listMissingQuickEmailPlaceholders(subjectTpl, bodyTpl, map) {
    var fullText = String(subjectTpl || '') + '\n' + String(bodyTpl || '');
    /* Strip everything inside {{#if X}}…{{/if}} so conditional placeholders
       don't get reported as missing — they're allowed to be blank. */
    var stripped = fullText.replace(
      /\{\{\s*#if\s+[a-zA-Z0-9_]+\s*\}\}[\s\S]*?\{\{\s*\/if\s*\}\}/g,
      ''
    );
    var keys = extractQuickEmailPlaceholderKeys('', stripped);
    var expanded = expandQuickEmailValueMap(map || {});
    var missing = [];
    for (var i = 0; i < keys.length; i++) {
      var ck = keys[i];
      var rawVal = expanded[ck];
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
  global.tokensToFriendlyLabels = tokensToFriendlyLabels;
  global.friendlyLabelsToTokens = friendlyLabelsToTokens;
})(typeof window !== 'undefined' ? window : globalThis);
