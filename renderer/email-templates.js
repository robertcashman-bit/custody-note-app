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
  var parts = [_oicClean(data.surname), _oicClean(data.forename)].filter(Boolean);
  var clientName = parts.join(', ') || 'Client';
  switch (templateId) {
    case 'follow_up': return 'Outcome Request \u2013 ' + clientName;
    case 'no_reply':  return 'Outcome Request Follow-Up \u2013 ' + clientName;
    default:          return 'First Attendance Disclosure Request \u2013 ' + clientName;
  }
}

function buildEmailBody(templateId, data, feeEarnerName) {
  data = data || {};
  var parsed     = _oicParseOicName(_oicClean(data.oicName));
  var salutation = _oicSalutation(parsed.rank, parsed.surname);
  var clientName = [_oicClean(data.forename), _oicClean(data.surname)].filter(Boolean).join(' ') || 'your client';
  var station    = _oicClean(data.policeStationName) || 'the police station';
  var firmName   = _oicClean(data.firmName) || 'the firm';
  var feeName    = _oicClean(feeEarnerName) || 'Fee Earner';
  var dateStr    = _oicFmtDate(_oicClean(data.date || data.instructionDateTime));
  var timeStr    = _oicFmtTime(_oicClean(data.timeArrival));
  var dateTime   = [dateStr, timeStr ? 'at ' + timeStr : ''].filter(Boolean).join(' ');

  /* ── Template 1: First Attendance Disclosure Request ── */
  if (templateId === 'first_attendance' || !templateId) {
    var intro;
    if (feeName !== 'Fee Earner' && firmName !== 'the firm') {
      intro = 'I have been asked by ' + feeName + ' of ' + firmName +
              ' to cover this matter' + (dateTime ? ' on ' + dateTime : '') + '.';
    } else if (firmName !== 'the firm') {
      intro = 'I have been asked to cover this matter on behalf of ' + firmName +
              (dateTime ? ' on ' + dateTime : '') + '.';
    } else {
      intro = 'I have been asked to cover this matter' + (dateTime ? ' on ' + dateTime : '') + '.';
    }
    return [
      salutation,
      '',
      intro,
      '',
      'Please would you confirm that the attendance will be effective and provide disclosure to the email address below.',
      '',
      'Many thanks,',
      '',
      feeName
    ].join('\n');
  }

  /* ── Template 2: Follow-Up / Outcome Request ── */
  if (templateId === 'follow_up') {
    return [
      salutation,
      '',
      'I write further to my attendance upon ' + clientName + ' at ' + station +
        ' Police Station on behalf of ' + firmName + '.',
      '',
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
      '\u2022 any bail conditions if applicable',
      '',
      'Many thanks,',
      '',
      feeName
    ].join('\n');
  }

  /* ── Template 3: No Reply Follow-Up ── */
  if (templateId === 'no_reply') {
    return [
      salutation,
      '',
      'I refer to my previous email regarding ' + clientName + ', following my attendance upon them at ' +
        station + ' Police Station on behalf of ' + firmName + '.',
      '',
      'I should be grateful if you would please now confirm the outcome of this matter.',
      '',
      'If the client was bailed, please provide the bail return date and time, the police station to ' +
        'which they are bailed, and details of any bail conditions.',
      '',
      'If the client was charged, please provide details of the charges, the court date and time, ' +
        'the relevant Magistrates\u2019 Court, and whether the client was granted bail or remanded ' +
        'together with any bail conditions if applicable.',
      '',
      'Many thanks,',
      '',
      feeName
    ].join('\n');
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
