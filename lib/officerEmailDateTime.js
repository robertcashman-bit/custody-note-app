'use strict';

const DAY_NAMES = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const MONTH_NAMES = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

const BAIL_TEMPLATE_TYPES = Object.freeze(['bail_details_request', 'chase_bail_details_follow_up']);

/** Five most-used templates (chip shortcuts). */
const PINNED_TEMPLATE_CHIPS = Object.freeze([
  { value: 'disclosure_confirm_attendance', short: 'Confirm attendance + disclosure' },
  { value: 'voluntary_interview_confirmation', short: 'Voluntary interview' },
  { value: 'chase_disclosure', short: 'Chase disclosure' },
  { value: 'bail_details_request', short: 'Police bail details' },
  { value: 'confirm_outcome_after_attendance', short: 'Outcome after attendance' },
]);

const WHEN_STEP_TITLES = Object.freeze({
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
});

function pad2(n) {
  return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, '0');
}

function startOfCalendarDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseIsoDate(str) {
  const m = String(str || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(y, mo, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
  return d;
}

function parseDmySlash(str) {
  const m = String(str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const y = Number(m[3]);
  const d = new Date(y, mo, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
  return d;
}

function parseDmyDots(str) {
  const m = String(str || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const mo = Number(m[2]) - 1;
  const day = Number(m[1]);
  const d = new Date(y, mo, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
  return d;
}

function parseLongUkDate(str) {
  const m = String(str || '').trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const monKey = m[2].slice(0, 3).toLowerCase();
  const mo = MONTH_NAMES.findIndex((x) => x.toLowerCase() === monKey);
  if (mo < 0) return null;
  const y = Number(m[3]);
  const d = new Date(y, mo, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
  return d;
}

/**
 * @returns {{ kind: 'parsed', date: Date } | { kind: 'verbatim', text: string }}
 */
function parseFlexibleDate(str) {
  const raw = String(str == null ? '' : str).trim();
  if (!raw) return { kind: 'parsed', date: startOfCalendarDay(new Date()) };
  const parsers = [parseIsoDate, parseDmySlash, parseDmyDots, parseLongUkDate];
  for (let i = 0; i < parsers.length; i++) {
    const d = parsers[i](raw);
    if (d) return { kind: 'parsed', date: startOfCalendarDay(d) };
  }
  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) {
    return { kind: 'parsed', date: startOfCalendarDay(fallback) };
  }
  return { kind: 'verbatim', text: raw };
}

/**
 * @returns {{ mode: 'none' } | { mode: 'parsed', h: number, m: number } | { mode: 'verbatim', text: string }}
 */
function parseFlexibleTime(str) {
  const raw = String(str == null ? '' : str).trim();
  if (!raw || /^no\s*time$/i.test(raw)) return { mode: 'none' };
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) return { mode: 'parsed', h, m: mi };
  }
  return { mode: 'verbatim', text: raw };
}

function formatDmy(date) {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatLongDate(date) {
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function relativeDayLabel(date, todayRef) {
  const today = startOfCalendarDay(todayRef || new Date());
  const d = startOfCalendarDay(date);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return `Today · ${formatDmy(d)}`;
  if (diff === 1) return `Tomorrow · ${formatDmy(d)}`;
  if (diff === -1) return `Yesterday · ${formatDmy(d)}`;
  return `${DAY_NAMES[d.getDay()]} · ${formatDmy(d)}`;
}

function stepCalendarDay(date, deltaDays) {
  const d = startOfCalendarDay(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + deltaDays);
}

function stepHour(h, delta) {
  return ((Number(h) + delta) % 24 + 24) % 24;
}

function stepMinute(h, m, deltaMinutes) {
  let total = Number(h) * 60 + Number(m) + deltaMinutes;
  total = ((total % 1440) + 1440) % 1440;
  const abs = Math.abs(deltaMinutes);
  const step = abs >= 5 ? abs : 1;
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

/** Storage string for attendanceDate field (ISO when parsed). */
function serialiseDateForStorage(parsedOrVerbatim) {
  if (parsedOrVerbatim.kind === 'verbatim') return parsedOrVerbatim.text;
  const d = parsedOrVerbatim.date;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function serialiseTimeForStorage(timeState) {
  if (timeState.mode === 'none') return '';
  if (timeState.mode === 'verbatim') return timeState.text;
  return `${pad2(timeState.h)}:${pad2(timeState.m)}`;
}

function formatForEmailDate(attendanceDate) {
  const p = parseFlexibleDate(attendanceDate);
  if (p.kind === 'verbatim') return p.text;
  return formatLongDate(p.date);
}

function formatForEmailWhen(attendanceDate, attendanceTime) {
  const datePart = formatForEmailDate(attendanceDate);
  const t = parseFlexibleTime(attendanceTime);
  if (t.mode === 'none') return datePart;
  if (t.mode === 'verbatim') {
    if (!datePart || datePart === '[Date]') return t.text;
    return `${datePart} at ${t.text}`;
  }
  const timePart = `${pad2(t.h)}:${pad2(t.m)}`;
  if (!attendanceDate || !String(attendanceDate).trim()) return timePart;
  const p = parseFlexibleDate(attendanceDate);
  if (p.kind === 'verbatim') {
    return `${p.text} at ${timePart}`;
  }
  return `${formatLongDate(p.date)} at ${timePart}`;
}

function addDaysFromToday(days, todayRef) {
  const today = startOfCalendarDay(todayRef || new Date());
  return stepCalendarDay(today, days);
}

function migrateDraftDateTimeFields(fields) {
  const f = fields || {};
  let attendanceDate = f.attendanceDate != null ? f.attendanceDate : f.attendance_date;
  let attendanceTime = f.attendanceTime != null ? f.attendanceTime : f.attendance_time;
  let bailReturnDate = f.bailReturnDate != null ? f.bailReturnDate : f.bail_return_date;
  if (isBailTemplate(f.templateType) && bailReturnDate && !attendanceDate) {
    attendanceDate = bailReturnDate;
  }
  return {
    attendanceDate: attendanceDate == null ? '' : String(attendanceDate),
    attendanceTime: attendanceTime == null ? '' : String(attendanceTime),
    bailReturnDate: bailReturnDate == null ? '' : String(bailReturnDate),
  };
}

const OFFICER_EMAIL_DATE_TIME = {
  DAY_NAMES,
  MONTH_NAMES,
  BAIL_TEMPLATE_TYPES,
  PINNED_TEMPLATE_CHIPS,
  WHEN_STEP_TITLES,
  pad2,
  startOfCalendarDay,
  parseFlexibleDate,
  parseFlexibleTime,
  formatDmy,
  formatLongDate,
  relativeDayLabel,
  stepCalendarDay,
  stepHour,
  stepMinute,
  isBailTemplate,
  getWhenStepTitle,
  serialiseDateForStorage,
  serialiseTimeForStorage,
  formatForEmailDate,
  formatForEmailWhen,
  addDaysFromToday,
  migrateDraftDateTimeFields,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OFFICER_EMAIL_DATE_TIME;
}
if (typeof window !== 'undefined') {
  window.OfficerEmailDateTime = OFFICER_EMAIL_DATE_TIME;
}
