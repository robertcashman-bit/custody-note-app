'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const dt = require('../lib/officerEmailDateTime');

describe('officerEmailDateTime', () => {
  const today = new Date(2026, 9, 23);

  it('does not declare top-level MONTH_NAMES (IIFE safe for app.js)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib/officerEmailDateTime.js'), 'utf8');
    assert.ok(!/^const MONTH_NAMES/m.test(src));
    assert.ok(!/^let MONTH_NAMES/m.test(src));
    assert.ok(!/^var MONTH_NAMES/m.test(src));
  });

  it('formats ISO dates for email as long UK date', () => {
    assert.strictEqual(dt.formatForEmailDate('2026-10-23'), 'Fri 23 Oct 2026');
  });

  it('parses UK dd/mm/yy as day/month/year', () => {
    assert.strictEqual(dt.formatForEmailDate('05/06/26'), 'Fri 5 Jun 2026');
  });

  it('keeps verbatim dates when unparseable or year missing', () => {
    assert.strictEqual(dt.formatForEmailDate('TBC — date not set'), 'TBC — date not set');
    assert.strictEqual(dt.formatForEmailDate('3 March'), '3 March');
    assert.strictEqual(dt.formatForEmailDate('12 Nov'), '12 Nov');
  });

  it('parses legacy draft text like 15 Mar 2026 into long UK form', () => {
    assert.strictEqual(dt.formatForEmailDate('15 Mar 2026'), 'Sun 15 Mar 2026');
  });

  it('empty date stays empty for email formatting', () => {
    assert.strictEqual(dt.formatForEmailDate(''), '');
    assert.deepStrictEqual(dt.parseFlexibleDate(''), { kind: 'empty' });
  });

  it('formats date with time and supports No time', () => {
    assert.strictEqual(
      dt.formatForEmailWhen('2026-10-24', '12:45'),
      'Sat 24 Oct 2026 at 12:45'
    );
    assert.strictEqual(dt.formatForEmailWhen('2026-10-24', ''), 'Sat 24 Oct 2026');
  });

  it('does not emit bare time without a date in when phrases', () => {
    assert.strictEqual(dt.formatForEmailWhen('', '10:00'), '');
    assert.strictEqual(dt.formatForEmailWhen('', '14:30'), '');
  });

  it('steps calendar days and minutes', () => {
    const d = new Date(2026, 9, 23);
    const next = dt.stepCalendarDay(d, 1);
    assert.strictEqual(dt.formatLongDate(next), 'Sat 24 Oct 2026');
    const stepped = dt.stepMinute(12, 30, 15);
    assert.deepStrictEqual(stepped, { h: 12, m: 45 });
    assert.strictEqual(dt.stepHour(23, 1), 0);
  });

  it('relativeDayLabel shows Tomorrow', () => {
    const tomorrow = dt.addDaysFromToday(1, today);
    assert.match(dt.relativeDayLabel(tomorrow, today), /^Tomorrow · 24\/10\/2026$/);
  });

  it('bail template detection and default +28 title', () => {
    assert.strictEqual(dt.isBailTemplate('bail_details_request'), true);
    assert.strictEqual(dt.isBailTemplate('disclosure_confirm_attendance'), false);
    assert.strictEqual(dt.getWhenStepTitle('bail_details_request'), 'Bail return date and time');
  });

  it('migrateDraftDateTimeFields keeps attendance and bail return separate', () => {
    const m = dt.migrateDraftDateTimeFields({
      templateType: 'bail_details_request',
      attendanceDate: '2026-01-15',
      bailReturnDate: '2026-11-20',
    });
    assert.strictEqual(m.attendanceDate, '2026-01-15');
    assert.strictEqual(m.bailReturnDate, '2026-11-20');
  });

  it('parseFlexibleTime treats empty as no time', () => {
    assert.deepStrictEqual(dt.parseFlexibleTime(''), { mode: 'none' });
    assert.deepStrictEqual(dt.parseFlexibleTime('14:30'), { mode: 'parsed', h: 14, m: 30 });
  });
});
