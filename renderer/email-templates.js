/* ═══════════════════════════════════════════════════════
   EMAIL TEMPLATES — Officer Email Templates Add-On
   Pure utility module: no DOM access, no globals written.
   All functions are globally accessible (vanilla JS / shared scope).
   ═══════════════════════════════════════════════════════ */

/* Known UK police rank prefixes, longest first for greedy matching */
var _OIC_RANKS = [
  'Det Ch Supt', 'Det Ch Insp', 'Det Supt', 'Det Insp', 'Det Sgt', 'Det Con',
  'Ch Supt', 'Ch Insp', 'Supt', 'Insp', 'Sgt', 'Con',
  'DCI', 'DCS', 'DI', 'DS', 'DC', 'PC', 'PS', 'CI',
  'ACC', 'DCC', 'CC', 'PCSO', 'Cst'
];

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
    if (courtDate) parts.push('The court date is ' + courtDate + ' at ' + courtTime + '.');
    if (courtName) parts.push('The relevant court is ' + courtName + '.');
    return parts.join(' ');
  }

  /* Bail conditions paragraph (only when bailed) */
  function _bailCondsPara() {
    var bailType = _oicClean(data.bailType);
    var bailDate = _oicFmtDate(_oicClean(data.bailDate));
    var includeReturnDate = od === 'Bail without charge';
    if (bailType === 'Unconditional') {
      return 'The client was released on unconditional bail' + (includeReturnDate && bailDate ? ', with a return date of ' + bailDate : '') + '.';
    }
    if (bailType === 'Conditional') {
      var conds = _oicClean(data.bailConditions) || _oicClean(data.bailConditionsChecklist || '').replace(/\|/g, ', ');
      return 'The client was released on conditional bail' +
        (includeReturnDate && bailDate ? ' with a return date of ' + bailDate : '') +
        (conds ? '. Bail conditions: ' + conds + '.' : '.');
    }
    if (includeReturnDate && bailDate) return 'The client was bailed to return on ' + bailDate + '.';
    return '';
  }

  /* ── Template 1: First Attendance Disclosure Request ── */
  if (templateId === 'first_attendance' || !templateId) {
    var intro = 'I have been asked by ' + requestedBy +
      ' to cover this matter' + (dateTime ? ' on ' + dateTime : '') + '.';
    return [
      salutation,
      '',
      intro,
      '',
      'Please would you confirm that the attendance will be effective and provide disclosure to this email address.',
      '',
      'Many thanks,',
      '',
      feeName
    ].join('\n');
  }

  /* ── Templates 2 & 3: build outcome-specific paragraphs ── */
  function _outcomeParas(concise) {
    if (!outcomeKnown) {
      /* No outcome recorded — use generic "please confirm" language */
      if (concise) {
        return [
          'I should be grateful if you would please now confirm the outcome of this matter.',
          '',
          'If the client was bailed, please provide the bail return date and time, the police station ' +
            'to which they are bailed, and details of any bail conditions.',
          '',
          'If the client was charged, please provide details of the charges, the court date and time, ' +
            'the relevant Magistrates\u2019 Court, and whether the client was granted bail or remanded ' +
            'together with any bail conditions if applicable.'
        ];
      }
      return [
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
      ];
    }

    var paras = [];

    if (isCharged) {
      var charges = _chargeLines();
      if (charges.length) {
        paras.push('The client was charged with the following:');
        charges.forEach(function(c) { paras.push(c); });
        paras.push('');
      }
      var courtP = _courtPara();
      if (courtP) { paras.push(courtP); paras.push(''); }

      if (isChargedWithBail) {
        var bailP = _bailCondsPara();
        if (bailP) { paras.push(bailP); paras.push(''); }
      } else {
        /* Charged without Bail / Remanded — do NOT ask about bail conditions */
        paras.push('The client was ' + (od === 'Remanded in Custody' ? 'remanded in custody' : 'charged without bail') + '.');
        paras.push('');
      }

      paras.push('Could you please confirm the above details and provide any additional information?');
    } else if (isBailNoCharge) {
      var bailP2 = _bailCondsPara();
      if (bailP2) { paras.push(bailP2); paras.push(''); }
      paras.push('Could you please confirm these details and advise of the outcome of the investigation?');
    } else {
      /* Other known outcome — just confirm */
      paras.push('The outcome recorded is: ' + od + '.');
      paras.push('');
      paras.push('Could you please confirm this and provide any further information?');
    }

    return paras;
  }

  function _genericOutcomeRequestDetails() {
    return [
      'If the client was bailed, please provide the bail return date and time, the police station to which they are bailed, and details of any bail conditions.',
      '',
      'If the client was charged, please provide details of the charges, the court date and time, the relevant Magistrates\' Court, and whether the client was granted bail or remanded, together with any bail conditions if applicable.'
    ];
  }

  /* ── Template 2: Follow-Up / Outcome Request ── */
  if (templateId === 'follow_up') {
    var body2 = [
      salutation,
      '',
      'I write following my attendance upon ' + clientName + attendanceRef + ' on behalf of ' + firmName + '.',
      ''
    ];
    if (!outcomeKnown) {
      body2.push('I would be grateful if you could confirm the outcome of this matter when convenient.', '');
      _genericOutcomeRequestDetails().forEach(function(l) { body2.push(l); });
    } else {
      _outcomeParas(false).forEach(function(l) { body2.push(l); });
    }
    body2.push('', 'Many thanks,', '', feeName);
    return body2.join('\n');
  }

  /* ── Template 3: No Reply Follow-Up ── */
  if (templateId === 'no_reply') {
    var body3 = [
      salutation,
      '',
      'I refer to my previous email regarding ' + clientName + ', following my attendance upon them at ' +
        station + (dateStr ? ' on ' + dateStr : '') + ' on behalf of ' + firmName + '. I have not yet received a reply and would be grateful if you could confirm the outcome at your earliest convenience.',
      '',
      'For ease of reference, I set out a copy of my previous email below.',
      '',
      'I write following my attendance upon ' + clientName + attendanceRef + ' on behalf of ' + firmName + '.',
      ''
    ];
    if (!outcomeKnown) {
      _outcomeParas(true).forEach(function(l) { body3.push(l); });
    } else {
      _outcomeParas(false).forEach(function(l) { body3.push(l); });
    }
    body3.push('', 'If you have already replied to the firm, please disregard this email and accept my apologies.', '', 'Many thanks,', '', feeName);
    return body3.join('\n');
  }

  return '';
}

function buildMailtoHref(toEmail, subject, body) {
  var to  = _oicClean(toEmail);
  var bodyStr = String(body || '');
  /* mailto: URIs break on some clients above ~2000 chars — truncate the href only */
  var bodyForHref = bodyStr.length > 1800
    ? bodyStr.slice(0, 1800) + '\n\n[Full text copied to clipboard]'
    : bodyStr;
  return 'mailto:' + encodeURIComponent(to) +
    '?subject=' + encodeURIComponent(subject || '') +
    '&body='    + encodeURIComponent(bodyForHref);
}

/* ── Email client definitions ─────────────────────────────── */

var EMAIL_CLIENTS = [
  { id: 'default',  label: 'Default Mail App' },
  { id: 'gmail',    label: 'Gmail' },
  { id: 'owa',      label: 'Outlook Web (work)' },
  { id: 'outlook',  label: 'Outlook.com (personal)' },
  { id: 'yahoo',    label: 'Yahoo Mail' },
  { id: 'aol',      label: 'AOL Mail' }
];

function getEmailClientLabel(clientId) {
  var found = EMAIL_CLIENTS.filter(function(c) { return c.id === clientId; })[0];
  return found ? found.label : 'Default Mail App';
}

function buildEmailClientUrl(clientId, toEmail, subject, body) {
  var to  = encodeURIComponent(_oicClean(toEmail));
  var sub = encodeURIComponent(String(subject || ''));
  /* Web clients have generous body limits; still cap at 4000 chars to be safe */
  var bodyTrunc = String(body || '').length > 4000
    ? String(body || '').slice(0, 4000) + '\n\n[continued]'
    : String(body || '');
  var bod = encodeURIComponent(bodyTrunc);

  switch (clientId) {
    case 'gmail':
      return 'https://mail.google.com/mail/?view=cm' +
        '&to='   + to +
        '&su='   + sub +
        '&body=' + bod;

    case 'owa':
      return 'https://outlook.office.com/mail/deeplink/compose' +
        '?to='      + to +
        '&subject=' + sub +
        '&body='    + bod;

    case 'outlook':
      return 'https://outlook.live.com/mail/0/deeplink/compose' +
        '?to='      + to +
        '&subject=' + sub +
        '&body='    + bod;

    case 'yahoo':
      return 'https://compose.mail.yahoo.com/' +
        '?to='    + to +
        '&subj='  + sub +
        '&body='  + bod;

    case 'aol':
      return 'https://mail.aol.com/webmail-std/en-us/suite' +
        '?compose=1' +
        '&to='      + to +
        '&subject=' + sub +
        '&body='    + bod;

    default:
      return buildMailtoHref(toEmail, subject, body);
  }
}
