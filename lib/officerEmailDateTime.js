/* Officer email date/time — browser-safe IIFE (no top-level bindings that collide with app.js). */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.OfficerEmailDateTime = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function officerEmailDateTimeFactory() {
  'use strict';

  var OE_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var OE_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var OE_MONTH_LOOKUP = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  var BAIL_TEMPLATE_TYPES = ['bail_details_request', 'chase_bail_details_follow_up'];

  var PINNED_TEMPLATE_CHIPS = [
    { value: 'disclosure_confirm_attendance', short: 'Confirm attendance + disclosure' },
    { value: 'voluntary_interview_confirmation', short: 'Voluntary interview' },
    { value: 'chase_disclosure', short: 'Chase disclosure' },
    { value: 'bail_details_request', short: 'Police bail details' },
    { value: 'confirm_outcome_after_attendance', short: 'Outcome after attendance' },
  ];

  var WHEN_STEP_TITLES = {
    disclosure_confirm_attendance: 'When is the attendance?',
    confirm_matter_effective: 'When is the attendance?',
    voluntary_interview_confirmation: 'When is the voluntary interview?',
    confirm_outcome_after_attendance: 'When did you attend?',
    chase_disclosure: 'When is the attendance? (optional)',
    chase_disclosure_follow_up: 'When is the attendance? (optional)',
    request_officer_contact_details: 'When is the attendance?',
    custody_log_request: 'When is the attendance?',
    custody_record_detention_log_request: 'When is the attendance?',
    chase_custody_log_follow_up: 'When is the attendance?',
    request_update_after_delay: 'When is the attendance? (optional)',
    bail_details_request: 'Bail return date and time',
    chase_bail_details_follow_up: 'Bail return date and time',
    rui_details_request: 'When did they attend?',
    matter_stood_down: 'When was the attendance?',
    free_text_email: 'When (optional)',
  };

  function pad2(n) {
    return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, '0');
  }

  function startOfCalendarDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function parseIsoDate(str) {
    var m = String(str || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]) - 1;
    var day = Number(m[3]);
    var d = new Date(y, mo, day);
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
    return d;
  }

  /** UK dd/mm/yyyy or dd/mm/yy — day first, then month. */
  function parseUkSlashDate(str) {
    var m = String(str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    var day = Number(m[1]);
    var mo = Number(m[2]) - 1;
    var y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo < 0 || mo > 11 || day < 1 || day > 31) return null;
    var d = new Date(y, mo, day);
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
    return d;
  }

  function parseDmyDots(str) {
    var m = String(str || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (!m) return null;
    var day = Number(m[1]);
    var mo = Number(m[2]) - 1;
    var y = Number(m[3]);
    if (y < 100) y += 2000;
    var d = new Date(y, mo, day);
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
    return d;
  }

  /** Requires day + month name + 4-digit year (e.g. 15 Mar 2026). */
  function parseLongUkDateWithYear(str) {
    var m = String(str || '').trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
    if (!m) return null;
    var day = Number(m[1]);
    var monKey = m[2].slice(0, 3).toLowerCase();
    var mo = OE_MONTH_LOOKUP[monKey];
    if (mo == null) return null;
    var y = Number(m[3]);
    var d = new Date(y, mo, day);
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
    return d;
  }

  /**
   * @returns {{ kind: 'empty' } | { kind: 'parsed', date: Date } | { kind: 'verbatim', text: string }}
   */
  function parseFlexibleDate(str) {
    var raw = String(str == null ? '' : str).trim();
    if (!raw) return { kind: 'empty' };
    var parsers = [parseIsoDate, parseUkSlashDate, parseDmyDots, parseLongUkDateWithYear];
    for (var i = 0; i < parsers.length; i++) {
      var d = parsers[i](raw);
      if (d) return { kind: 'parsed', date: startOfCalendarDay(d) };
    }
    return { kind: 'verbatim', text: raw };
  }

  function parseFlexibleTime(str) {
    var raw = String(str == null ? '' : str).trim();
    if (!raw || /^no\s*time$/i.test(raw)) return { mode: 'none' };
    var m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m) {
      var h = Number(m[1]);
      var mi = Number(m[2]);
      if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) return { mode: 'parsed', h: h, m: mi };
    }
    return { mode: 'verbatim', text: raw };
  }

  function formatDmy(date) {
    return pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1) + '/' + date.getFullYear();
  }

  function formatLongDate(date) {
    return OE_DAY_NAMES[date.getDay()] + ' ' + date.getDate() + ' ' + OE_MONTH_NAMES[date.getMonth()] + ' ' + date.getFullYear();
  }

  function relativeDayLabel(date, todayRef) {
    var today = startOfCalendarDay(todayRef || new Date());
    var d = startOfCalendarDay(date);
    var diff = Math.round((d - today) / 86400000);
    if (diff === 0) return 'Today · ' + formatDmy(d);
    if (diff === 1) return 'Tomorrow · ' + formatDmy(d);
    if (diff === -1) return 'Yesterday · ' + formatDmy(d);
    return OE_DAY_NAMES[d.getDay()] + ' · ' + formatDmy(d);
  }

  function stepCalendarDay(date, deltaDays) {
    var d = startOfCalendarDay(date);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + deltaDays);
  }

  function stepHour(h, delta) {
    return ((Number(h) + delta) % 24 + 24) % 24;
  }

  function stepMinute(h, m, deltaMinutes) {
    var total = Number(h) * 60 + Number(m) + deltaMinutes;
    total = ((total % 1440) + 1440) % 1440;
    var abs = Math.abs(deltaMinutes);
    var step = abs >= 5 ? abs : 1;
    total = Math.round(total / step) * step;
    total = ((total % 1440) + 1440) % 1440;
    return { h: Math.floor(total / 60), m: total % 60 };
  }

  function isBailTemplate(templateType) {
    return BAIL_TEMPLATE_TYPES.indexOf(templateType) >= 0;
  }

  function getWhenStepTitle(templateType) {
    return WHEN_STEP_TITLES[templateType] || 'When is the attendance?';
  }

  function serialiseDateForStorage(parsedOrVerbatim) {
    if (parsedOrVerbatim.kind === 'empty') return '';
    if (parsedOrVerbatim.kind === 'verbatim') return parsedOrVerbatim.text;
    var d = parsedOrVerbatim.date;
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function serialiseTimeForStorage(timeState) {
    if (timeState.mode === 'none') return '';
    if (timeState.mode === 'verbatim') return timeState.text;
    return pad2(timeState.h) + ':' + pad2(timeState.m);
  }

  function formatForEmailDate(attendanceDate) {
    var raw = String(attendanceDate == null ? '' : attendanceDate).trim();
    if (!raw) return '';
    var p = parseFlexibleDate(raw);
    if (p.kind === 'verbatim') return p.text;
    if (p.kind === 'empty') return '';
    return formatLongDate(p.date);
  }

  function formatForEmailWhen(attendanceDate, attendanceTime) {
    var dateRaw = String(attendanceDate == null ? '' : attendanceDate).trim();
    var t = parseFlexibleTime(attendanceTime);
    if (!dateRaw && t.mode === 'none') return '';
    if (!dateRaw && t.mode === 'verbatim') return t.text;
    if (!dateRaw && t.mode === 'parsed') {
      return '';
    }
    var datePart = formatForEmailDate(dateRaw);
    if (t.mode === 'none') return datePart;
    if (t.mode === 'verbatim') {
      if (!datePart) return t.text;
      return datePart + ' at ' + t.text;
    }
    var timePart = pad2(t.h) + ':' + pad2(t.m);
    if (!datePart) return timePart;
    var p = parseFlexibleDate(dateRaw);
    if (p.kind === 'verbatim') return p.text + ' at ' + timePart;
    if (p.kind === 'empty') return timePart;
    return formatLongDate(p.date) + ' at ' + timePart;
  }

  function addDaysFromToday(days, todayRef) {
    var today = startOfCalendarDay(todayRef || new Date());
    return stepCalendarDay(today, days);
  }

  /** Preserve both attendance and bail return fields from stored drafts — never merge. */
  function migrateDraftDateTimeFields(fields) {
    var f = fields || {};
    return {
      attendanceDate: f.attendanceDate != null ? String(f.attendanceDate) : (f.attendance_date != null ? String(f.attendance_date) : ''),
      attendanceTime: f.attendanceTime != null ? String(f.attendanceTime) : (f.attendance_time != null ? String(f.attendance_time) : ''),
      bailReturnDate: f.bailReturnDate != null ? String(f.bailReturnDate) : (f.bail_return_date != null ? String(f.bail_return_date) : ''),
      bailReturnTime: f.bailReturnTime != null ? String(f.bailReturnTime) : (f.bail_return_time != null ? String(f.bail_return_time) : ''),
    };
  }

  return {
    DAY_NAMES: OE_DAY_NAMES,
    MONTH_NAMES: OE_MONTH_NAMES,
    BAIL_TEMPLATE_TYPES: BAIL_TEMPLATE_TYPES,
    PINNED_TEMPLATE_CHIPS: PINNED_TEMPLATE_CHIPS,
    WHEN_STEP_TITLES: WHEN_STEP_TITLES,
    pad2: pad2,
    startOfCalendarDay: startOfCalendarDay,
    parseFlexibleDate: parseFlexibleDate,
    parseFlexibleTime: parseFlexibleTime,
    formatDmy: formatDmy,
    formatLongDate: formatLongDate,
    relativeDayLabel: relativeDayLabel,
    stepCalendarDay: stepCalendarDay,
    stepHour: stepHour,
    stepMinute: stepMinute,
    isBailTemplate: isBailTemplate,
    getWhenStepTitle: getWhenStepTitle,
    serialiseDateForStorage: serialiseDateForStorage,
    serialiseTimeForStorage: serialiseTimeForStorage,
    formatForEmailDate: formatForEmailDate,
    formatForEmailWhen: formatForEmailWhen,
    addDaysFromToday: addDaysFromToday,
    migrateDraftDateTimeFields: migrateDraftDateTimeFields,
  };
});
