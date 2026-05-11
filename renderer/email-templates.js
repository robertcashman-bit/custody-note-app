/* ═══════════════════════════════════════════════════════
   EMAIL TEMPLATES — Officer Email Templates Add-On
   Pure utility module: no DOM access, no globals written.
   Templates are loaded from data/email-templates.json.
   Rendering is fully placeholder-driven — no sentence assembly in JS.
   ═══════════════════════════════════════════════════════ */

/* Known UK police rank prefixes, longest first for greedy matching */
var _OIC_RANKS = [
  'Det Ch Supt', 'Det Ch Insp', 'Det Supt', 'Det Insp', 'Det Sgt', 'Det Con',
  'Ch Supt', 'Ch Insp', 'Supt', 'Insp', 'Sgt', 'Con',
  'DCI', 'DCS', 'DI', 'DS', 'DC', 'PC', 'PS', 'CI',
  'ACC', 'DCC', 'CC', 'PCSO', 'Cst'
];

var _emailTemplateStringsCache = null;

function _oicClean(val) {
  if (val == null || val === 'null' || val === 'undefined') return '';
  return String(val).trim();
}

function _oicParseOicName(oicName) {
  var name = _oicClean(oicName);
  if (!name) return { rank: '', surname: '' };
  for (var i = 0; i < _OIC_RANKS.length; i++) {
    var r = _OIC_RANKS[i];
    if (name.toLowerCase().indexOf(r.toLowerCase() + ' ') === 0) {
      return { rank: r, surname: name.slice(r.length).trim() };
    }
  }
  return { rank: '', surname: name };
}

function _oicFmtDate(dateStr) {
  var s = _oicClean(dateStr);
  if (!s) return '';
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : s;
}

function _oicFmtTime(timeStr) {
  var s = _oicClean(timeStr);
  return s ? s.slice(0, 5) : '';
}

function _loadEmailTemplateStrings() {
  if (_emailTemplateStringsCache !== null) return _emailTemplateStringsCache;
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'data/email-templates.json', false);
    xhr.send(null);
    if (xhr.status === 200 && xhr.responseText) {
      _emailTemplateStringsCache = JSON.parse(xhr.responseText);
      return _emailTemplateStringsCache;
    }
  } catch (e) {
    console.warn('[email-templates] Could not load data/email-templates.json', e);
  }
  _emailTemplateStringsCache = {};
  return _emailTemplateStringsCache;
}

/* ── Shared placeholder map — single source of truth ────── */

function buildPlaceholderMap(data, feeEarnerName) {
  data = data || {};
  var parsed     = _oicParseOicName(_oicClean(data.oicName));
  var clientName = [_oicClean(data.forename), _oicClean(data.surname)].filter(Boolean).join(' ');
  var attendanceType = (function() {
    if (data._formType === 'telephone') return 'telephone advice';
    if (data.attendanceMode === 'voluntary') return 'voluntary attendance';
    return 'attendance';
  })();
  return {
    clientName:     clientName,
    oicName:        parsed.surname || _oicClean(data.oicName),
    oicRank:        parsed.rank,
    oicFullName:    _oicClean(data.oicName),
    station:        _oicClean(data.policeStationName),
    date:           _oicFmtDate(_oicClean(data.date || data.instructionDateTime)),
    time:           _oicFmtTime(_oicClean(data.timeArrival)),
    attendanceType: attendanceType,
    offenceType:    _oicClean(data.offenceSummary),
    feeEarnerName:  _oicClean(feeEarnerName) || _oicClean(data.feeEarnerName) || '',
    firmName:       _oicClean(data.firmName),
    contactName:    _oicClean(data.firmContactName),
    ourFileNumber:  _oicClean(data.ourFileNumber || data.fileReference),
    ufn:            _oicClean(data.ufn),
    outcome:        _oicClean(data.outcomeDecision),
    nextStep:       [_oicClean(data.nextLocationName), _oicFmtDate(_oicClean(data.nextDate))].filter(Boolean).join(' - '),
    followUp:       _oicClean(data.followUpRequired),
    officerEmail:   _oicClean(data.oicEmail)
  };
}

/* ── Shared placeholder renderer ────────────────────────── */

function applyPlaceholders(text, data, feeEarnerName) {
  var map = buildPlaceholderMap(data, feeEarnerName);
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function(_, key) {
    return map[key] != null ? String(map[key]) : '';
  });
}

/* ── Raw template accessor (for missing-field scanning in email-modal) ── */

function getEmailTemplateRaw(templateId) {
  var S = _loadEmailTemplateStrings();
  return S[templateId] || null;
}

/* ── Public API ─────────────────────────────────────────── */

function buildEmailSubject(templateId, data, feeEarnerName) {
  console.log('[email-render]', templateId, data);
  var S   = _loadEmailTemplateStrings();
  var tpl = S[templateId] || S['first_attendance'];
  if (!tpl || !tpl.subject) {
    console.warn('[email-templates] Legacy template detected for:', templateId);
    var map = buildPlaceholderMap(data, feeEarnerName);
    return [map.clientName || 'Client', map.station || 'Police Station', map.date].filter(Boolean).join(' - ');
  }
  return applyPlaceholders(tpl.subject, data, feeEarnerName);
}

function buildEmailBody(templateId, data, feeEarnerName) {
  var S   = _loadEmailTemplateStrings();
  var tpl = S[templateId] || S['first_attendance'];
  if (!tpl || !tpl.body) {
    console.warn('[email-templates] Legacy template detected for:', templateId);
    return '';
  }
  return applyPlaceholders(tpl.body, data, feeEarnerName);
}

/* Email compose opens only via main-process IPC (Outlook Web). */
