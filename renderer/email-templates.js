/* ═══════════════════════════════════════════════════════
   EMAIL TEMPLATES — Officer Email Templates Add-On
   Pure utility module: no DOM access, no globals written.
   Copy is loaded from data/email-templates.json (editable) with embedded fallback.
   ═══════════════════════════════════════════════════════ */

/* Known UK police rank prefixes, longest first for greedy matching */
var _OIC_RANKS = [
  'Det Ch Supt', 'Det Ch Insp', 'Det Supt', 'Det Insp', 'Det Sgt', 'Det Con',
  'Ch Supt', 'Ch Insp', 'Supt', 'Insp', 'Sgt', 'Con',
  'DCI', 'DCS', 'DI', 'DS', 'DC', 'PC', 'PS', 'CI',
  'ACC', 'DCC', 'CC', 'PCSO', 'Cst'
];

var _emailTemplateStringsCache = null;

/** Sync load for use from buildEmailBody (callers expect sync). Electron file:// OK. */
function _defaultEmailTemplateStrings() {
  /* Minimal fallback if data/email-templates.json missing — keep in sync with JSON */
  return JSON.parse(JSON.stringify(_emailTemplateStringsFallback));
}

var _emailTemplateStringsFallback = {
  version: 1,
  templates: [
    { id: 'first_attendance', name: 'First Attendance Disclosure Request', scope: 'officer' },
    { id: 'follow_up', name: 'Follow-Up / Outcome Request', scope: 'officer' },
    { id: 'no_reply', name: 'No Reply Follow-Up', scope: 'officer' }
  ],
  first_attendance: {
    disclosureRequest: 'Please would you confirm that the attendance will be effective and provide disclosure to this email address.',
    manyThanks: 'Many thanks,'
  },
  follow_up: {
    opening: 'I write following my attendance upon ',
    openingSuffix: ' on behalf of ',
    outcomePromptWhenUnknown: 'I would be grateful if you could confirm the outcome of this matter when convenient.'
  },
  no_reply: {
    referParagraph: 'I refer to my previous email regarding ',
    referMid: ', following my attendance upon them at ',
    referMid2: ' on behalf of ',
    referEnd: '. I have not yet received a reply and would be grateful if you could confirm the outcome at your earliest convenience.',
    copyBelow: 'For ease of reference, I set out a copy of my previous email below.',
    disregardIfReplied: 'If you have already replied to the firm, please disregard this email and accept my apologies.'
  },
  outcome_unknown: {
    concise: [
      'I should be grateful if you would please now confirm the outcome of this matter.',
      '',
      'If the client was bailed, please provide the bail return date and time, the police station to which they are bailed, and details of any bail conditions.',
      '',
      'If the client was charged, please provide details of the charges, the court date and time, the relevant Magistrates\u2019 Court, and whether the client was granted bail or remanded together with any bail conditions if applicable.'
    ],
    full: [
      'I would be grateful if you could please confirm the outcome of this matter.',
      '',
      'If the client was bailed, could you please provide:',
      '\u2022 bail return date and time',
      '\u2022 the police station to which they are bailed',
      '\u2022 details of any bail conditions',
      '',
      'If the client was charged, could you please provide:',
      '\u2022 details of the charges',
      '\u2022 the court date and time',
      '\u2022 the relevant Magistrates\u2019 Court',
      '\u2022 whether the client was granted bail or remanded',
      '\u2022 any bail conditions if applicable'
    ]
  },
  outcome_generic: {
    bailChargeDetail: [
      'If the client was bailed, please provide the bail return date and time, the police station to which they are bailed, and details of any bail conditions.',
      '',
      "If the client was charged, please provide details of the charges, the court date and time, the relevant Magistrates' Court, and whether the client was granted bail or remanded, together with any bail conditions if applicable."
    ]
  },
  charged: {
    chargesHeader: 'The client was charged with the following:',
    confirmDetails: 'Could you please confirm the above details and provide any additional information?',
    chargedWithoutBail: 'charged without bail',
    remandedInCustody: 'remanded in custody'
  },
  bail_no_charge: {
    confirmInvestigation: 'Could you please confirm these details and advise of the outcome of the investigation?'
  },
  other_outcome: {
    outcomePrefix: 'The outcome recorded is: ',
    confirmFurther: 'Could you please confirm this and provide any further information?'
  },
  bail_wording: {
    unconditional: 'The client was released on unconditional bail',
    conditional: 'The client was released on conditional bail',
    returnDateWith: ', with a return date of ',
    returnDateConditional: ' with a return date of ',
    bailConditions: '. Bail conditions: ',
    bailedToReturn: 'The client was bailed to return on '
  },
  court: {
    courtDate: 'The court date is ',
    at: ' at ',
    courtIs: 'The relevant court is '
  }
};

function _loadEmailTemplateStrings() {
  if (_emailTemplateStringsCache !== null) return _emailTemplateStringsCache;
  _emailTemplateStringsCache = _defaultEmailTemplateStrings();
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'data/email-templates.json', false);
    xhr.send(null);
    if (xhr.status === 200 && xhr.responseText) {
      _emailTemplateStringsCache = JSON.parse(xhr.responseText);
    }
  } catch (e) {
    console.warn('[email-templates] Could not load data/email-templates.json, using embedded fallback', e);
  }
  return _emailTemplateStringsCache;
}

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
  /* No known rank prefix — treat whole string as surname/name */
  return { rank: '', surname: name };
}

function _oicSalutation(rank, surname) {
  if (rank && surname) return 'Dear ' + rank + ' ' + surname + ',';
  if (surname)         return 'Dear ' + surname + ',';
  return 'Dear Officer,';
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

/* ── Public API ─────────────────────────────────────────── */

function buildEmailSubject(templateId, data) {
  data = data || {};
  var subjectParts = [
    _oicClean(data.forename) || 'Client',
    _oicClean(data.surname),
    _oicClean(data.policeStationName) || 'Police Station',
    _oicFmtDate(_oicClean(data.date || data.instructionDateTime))
  ].filter(Boolean);
  return subjectParts.join(' - ');
}

function buildEmailBody(templateId, data, feeEarnerName) {
  var S = _loadEmailTemplateStrings();
  data = data || {};
  var parsed     = _oicParseOicName(_oicClean(data.oicName));
  var salutation = _oicSalutation(parsed.rank, parsed.surname);
  var clientName = [_oicClean(data.forename), _oicClean(data.surname)].filter(Boolean).join(' ') || 'your client';
  var station    = _oicClean(data.policeStationName) || 'the police station';
  var feeName    = _oicClean(feeEarnerName) || 'Fee Earner';
  var firmName   = _oicClean(data.firmName) || 'the firm';
  var contactName = _oicClean(data.firmContactName);
  var requestedBy = contactName && firmName
    ? contactName + ' of ' + firmName
    : (contactName || firmName || feeName || 'the firm');
  var dateStr    = _oicFmtDate(_oicClean(data.date || data.instructionDateTime));
  var timeStr    = _oicFmtTime(_oicClean(data.timeArrival));
  var dateTime   = [dateStr, timeStr ? 'at ' + timeStr : ''].filter(Boolean).join(' ');
  var attendanceRef = ' at ' + station + (dateStr ? ' on ' + dateStr : '');

  var bw = S.bail_wording || {};
  var ct = S.court || {};

  /* ── Outcome-aware helpers ── */
  var od = _oicClean(data.outcomeDecision);
  var isChargedNoBail  = od === 'Charged without Bail' || od === 'Remanded in Custody';
  var isChargedWithBail = od === 'Charged with Bail';
  var isCharged        = isChargedNoBail || isChargedWithBail;
  var isBailNoCharge   = od === 'Bail without charge' || od === 'Released Under Investigation';
  var outcomeKnown     = !!(od);

  /* Build a list of charges from record data (up to 4) */
  function _chargeLines() {
    var lines = [];
    for (var n = 1; n <= 4; n++) {
      var det = _oicClean(data['outcomeOffence' + n + 'Details']);
      if (det) lines.push('\u2022 ' + det);
    }
    return lines;
  }

  /* Court paragraph when charged */
  function _courtPara() {
    var courtName = _oicClean(data.courtName);
    var courtDate = _oicFmtDate(_oicClean(data.courtDate));
    var courtTime = _oicClean(data.courtTime) || '10:00';
    var parts = [];
    if (courtDate) parts.push((ct.courtDate || 'The court date is ') + courtDate + (ct.at || ' at ') + courtTime + '.');
    if (courtName) parts.push((ct.courtIs || 'The relevant court is ') + courtName + '.');
    return parts.join(' ');
  }

  /* Bail conditions paragraph (only when bailed) */
  function _bailCondsPara() {
    var bailType = _oicClean(data.bailType);
    var bailDate = _oicFmtDate(_oicClean(data.bailDate));
    var includeReturnDate = od === 'Bail without charge';
    if (bailType === 'Unconditional') {
      return (bw.unconditional || 'The client was released on unconditional bail') +
        (includeReturnDate && bailDate ? (bw.returnDateWith || ', with a return date of ') + bailDate : '') + '.';
    }
    if (bailType === 'Conditional') {
      var conds = _oicClean(data.bailConditions) || _oicClean(data.bailConditionsChecklist || '').replace(/\|/g, ', ');
      return (bw.conditional || 'The client was released on conditional bail') +
        (includeReturnDate && bailDate ? (bw.returnDateConditional || ' with a return date of ') + bailDate : '') +
        (conds ? (bw.bailConditions || '. Bail conditions: ') + conds + '.' : '.');
    }
    if (includeReturnDate && bailDate) return (bw.bailedToReturn || 'The client was bailed to return on ') + bailDate + '.';
    return '';
  }

  var fa = S.first_attendance || {};
  var fu = S.follow_up || {};
  var nr = S.no_reply || {};
  var ou = S.outcome_unknown || {};
  var og = S.outcome_generic || {};
  var ch = S.charged || {};
  var bnc = S.bail_no_charge || {};
  var oo = S.other_outcome || {};

  /* ── Template 1: First Attendance Disclosure Request ── */
  if (templateId === 'first_attendance' || !templateId) {
    var intro = 'I have been asked by ' + requestedBy +
      ' to cover this matter' + (dateTime ? ' on ' + dateTime : '') + '.';
    return [
      salutation,
      '',
      intro,
      '',
      fa.disclosureRequest || 'Please would you confirm that the attendance will be effective and provide disclosure to this email address.',
      '',
      fa.manyThanks || 'Many thanks,',
      '',
      feeName
    ].join('\n');
  }

  /* ── Templates 2 & 3: build outcome-specific paragraphs ── */
  function _outcomeParas(concise) {
    if (!outcomeKnown) {
      if (concise) {
        return (ou.concise && ou.concise.length) ? ou.concise.slice() : _emailTemplateStringsFallback.outcome_unknown.concise.slice();
      }
      return (ou.full && ou.full.length) ? ou.full.slice() : _emailTemplateStringsFallback.outcome_unknown.full.slice();
    }

    var paras = [];

    if (isCharged) {
      var charges = _chargeLines();
      if (charges.length) {
        paras.push(ch.chargesHeader || 'The client was charged with the following:');
        charges.forEach(function(c) { paras.push(c); });
        paras.push('');
      }
      var courtP = _courtPara();
      if (courtP) { paras.push(courtP); paras.push(''); }

      if (isChargedWithBail) {
        var bailP = _bailCondsPara();
        if (bailP) { paras.push(bailP); paras.push(''); }
      } else {
        paras.push('The client was ' + (od === 'Remanded in Custody'
          ? (ch.remandedInCustody || 'remanded in custody')
          : (ch.chargedWithoutBail || 'charged without bail')) + '.');
        paras.push('');
      }

      paras.push(ch.confirmDetails || 'Could you please confirm the above details and provide any additional information?');
    } else if (isBailNoCharge) {
      var bailP2 = _bailCondsPara();
      if (bailP2) { paras.push(bailP2); paras.push(''); }
      paras.push(bnc.confirmInvestigation || 'Could you please confirm these details and advise of the outcome of the investigation?');
    } else {
      paras.push((oo.outcomePrefix || 'The outcome recorded is: ') + od + '.');
      paras.push('');
      paras.push(oo.confirmFurther || 'Could you please confirm this and provide any further information?');
    }

    return paras;
  }

  function _genericOutcomeRequestDetails() {
    var lines = (og.bailChargeDetail && og.bailChargeDetail.length)
      ? og.bailChargeDetail.slice()
      : _emailTemplateStringsFallback.outcome_generic.bailChargeDetail.slice();
    return lines;
  }

  /* ── Template 2: Follow-Up / Outcome Request ── */
  if (templateId === 'follow_up') {
    var body2 = [
      salutation,
      '',
      (fu.opening || 'I write following my attendance upon ') + clientName + attendanceRef + (fu.openingSuffix || ' on behalf of ') + firmName + '.',
      ''
    ];
    if (!outcomeKnown) {
      body2.push(fu.outcomePromptWhenUnknown || 'I would be grateful if you could confirm the outcome of this matter when convenient.', '');
      _genericOutcomeRequestDetails().forEach(function(l) { body2.push(l); });
    } else {
      _outcomeParas(false).forEach(function(l) { body2.push(l); });
    }
    body2.push('', fa.manyThanks || 'Many thanks,', '', feeName);
    return body2.join('\n');
  }

  /* ── Template 3: No Reply Follow-Up ── */
  if (templateId === 'no_reply') {
    var body3 = [
      salutation,
      '',
      (nr.referParagraph || 'I refer to my previous email regarding ') + clientName +
        (nr.referMid || ', following my attendance upon them at ') +
        station + (dateStr ? ' on ' + dateStr : '') +
        (nr.referMid2 || ' on behalf of ') + firmName + (nr.referEnd || '. I have not yet received a reply and would be grateful if you could confirm the outcome at your earliest convenience.'),
      '',
      nr.copyBelow || 'For ease of reference, I set out a copy of my previous email below.',
      '',
      (fu.opening || 'I write following my attendance upon ') + clientName + attendanceRef + (fu.openingSuffix || ' on behalf of ') + firmName + '.',
      ''
    ];
    if (!outcomeKnown) {
      _outcomeParas(true).forEach(function(l) { body3.push(l); });
    } else {
      _outcomeParas(false).forEach(function(l) { body3.push(l); });
    }
    body3.push('', nr.disregardIfReplied || 'If you have already replied to the firm, please disregard this email and accept my apologies.', '', fa.manyThanks || 'Many thanks,', '', feeName);
    return body3.join('\n');
  }

  return '';
}

/* Email compose opens only via main-process IPC (Outlook Web). */
