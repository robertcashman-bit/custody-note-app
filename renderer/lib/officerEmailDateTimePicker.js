/* Officer email — shared date/time stepper (standalone + custody-note panel). */
(function (global) {
  'use strict';

  var DT = global.OfficerEmailDateTime;
  if (!DT) {
    console.error('[officerEmailDateTimePicker] OfficerEmailDateTime not loaded');
    return;
  }

  function bindRepeatButton(btn, fn) {
    if (!btn) return;
    var t1 = null;
    var t2 = null;
    function stop() {
      if (t1) clearTimeout(t1);
      if (t2) clearInterval(t2);
      t1 = null;
      t2 = null;
    }
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      fn();
    });
    btn.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      stop();
      t1 = setTimeout(function () {
        t2 = setInterval(fn, 120);
      }, 450);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      btn.addEventListener(ev, stop);
    });
  }

  function bindSpinKeys(el, up, down) {
    if (!el) return;
    el.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        up();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        down();
      }
    });
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.deltaY < 0) up();
      else down();
    }, { passive: false });
  }

  /**
   * @param {HTMLElement} mount
   * @param {{ prefix: string, onChange?: function, getToday?: function }} options
   */
  function init(mount, options) {
    var opts = options || {};
    var prefix = opts.prefix || 'oe';
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
    var getToday = typeof opts.getToday === 'function' ? opts.getToday : function () { return new Date(); };

    mount.innerHTML =
      '<div class="officer-email-when">' +
      '<div class="officer-email-when-col">' +
      '<div class="officer-email-wlabel">Date</div>' +
      '<div class="officer-email-stepper officer-email-stepper--day">' +
      '<button type="button" class="officer-email-step-btn" data-act="d-minus" aria-label="Previous day">‹</button>' +
      '<div class="officer-email-step-val" data-role="d-val" tabindex="0" role="spinbutton" aria-label="Date"></div>' +
      '<button type="button" class="officer-email-step-btn" data-act="d-plus" aria-label="Next day">›</button>' +
      '</div>' +
      '<div class="officer-email-chips officer-email-date-chips">' +
      '<button type="button" class="officer-email-chip" data-d="0">Today</button>' +
      '<button type="button" class="officer-email-chip" data-d="1">Tomorrow</button>' +
      '<button type="button" class="officer-email-chip" data-d="7">+1 week</button>' +
      '<button type="button" class="officer-email-chip" data-d="28">+28 days</button>' +
      '</div></div>' +
      '<div class="officer-email-when-col">' +
      '<div class="officer-email-wlabel">Time (24h)</div>' +
      '<div class="officer-email-timebox">' +
      '<div class="officer-email-stepper officer-email-stepper--time">' +
      '<button type="button" class="officer-email-step-btn" data-act="h-plus" aria-label="Hour up">▲</button>' +
      '<div class="officer-email-step-val" data-role="h-val" tabindex="0" role="spinbutton" aria-label="Hour"></div>' +
      '<button type="button" class="officer-email-step-btn" data-act="h-minus" aria-label="Hour down">▼</button>' +
      '</div><span class="officer-email-time-colon">:</span>' +
      '<div class="officer-email-stepper officer-email-stepper--time">' +
      '<button type="button" class="officer-email-step-btn" data-act="m-plus" aria-label="Minutes up">▲</button>' +
      '<div class="officer-email-step-val" data-role="m-val" tabindex="0" role="spinbutton" aria-label="Minutes"></div>' +
      '<button type="button" class="officer-email-step-btn" data-act="m-minus" aria-label="Minutes down">▼</button>' +
      '</div></div>' +
      '<div class="officer-email-step-hint">hour ±1 · minutes ±15 · arrow keys / mouse wheel too</div>' +
      '<div class="officer-email-chips officer-email-time-chips">' +
      '<button type="button" class="officer-email-chip" data-act="now">Now</button>' +
      '<button type="button" class="officer-email-chip" data-tm="09:00">09:00</button>' +
      '<button type="button" class="officer-email-chip" data-tm="10:00">10:00</button>' +
      '<button type="button" class="officer-email-chip" data-tm="14:00">14:00</button>' +
      '<button type="button" class="officer-email-chip" data-act="no-time">No time</button>' +
      '</div></div>' +
      '<div class="officer-email-when-summary">' +
      '<span>Email will say:</span><strong data-role="when-text"></strong></div>' +
      '</div>' +
      '<input type="hidden" id="' + prefix + '-attendance-date-store" />' +
      '<input type="hidden" id="' + prefix + '-attendance-time-store" />';

    var els = {
      dVal: mount.querySelector('[data-role="d-val"]'),
      hVal: mount.querySelector('[data-role="h-val"]'),
      mVal: mount.querySelector('[data-role="m-val"]'),
      whenText: mount.querySelector('[data-role="when-text"]'),
      dateStore: mount.querySelector('#' + prefix + '-attendance-date-store'),
      timeStore: mount.querySelector('#' + prefix + '-attendance-time-store'),
    };

    var state = {
      dateParsed: parseFlexibleDateSafe(''),
      time: { mode: 'parsed', h: 14, m: 30 },
      hasTime: true,
    };

    function parseFlexibleDateSafe(str) {
      return DT.parseFlexibleDate(str);
    }

    function renderStores() {
      var dateOut;
      if (state.dateParsed.kind === 'verbatim') {
        dateOut = state.dateParsed.text;
      } else {
        dateOut = DT.serialiseDateForStorage(state.dateParsed);
      }
      var timeOut;
      if (!state.hasTime) timeOut = '';
      else if (state.time.mode === 'verbatim') timeOut = state.time.text;
      else timeOut = DT.serialiseTimeForStorage(state.time);
      if (els.dateStore) els.dateStore.value = dateOut;
      if (els.timeStore) els.timeStore.value = timeOut;
      if (els.dVal) {
        if (state.dateParsed.kind === 'verbatim') els.dVal.textContent = state.dateParsed.text;
        else els.dVal.textContent = DT.relativeDayLabel(state.dateParsed.date, getToday());
      }
      if (els.hVal) els.hVal.textContent = state.hasTime && state.time.mode === 'parsed' ? DT.pad2(state.time.h) : (state.hasTime ? '--' : '--');
      if (els.mVal) els.mVal.textContent = state.hasTime && state.time.mode === 'parsed' ? DT.pad2(state.time.m) : (state.hasTime ? '--' : '--');
      if (els.whenText) {
        els.whenText.textContent = DT.formatForEmailWhen(
          els.dateStore ? els.dateStore.value : '',
          els.timeStore ? els.timeStore.value : ''
        );
      }
      onChange();
    }

    function ensureParsedDate() {
      if (state.dateParsed.kind === 'verbatim') return;
    }

    function stepDay(n) {
      if (state.dateParsed.kind === 'verbatim') {
        var p = DT.parseFlexibleDate(state.dateParsed.text);
        state.dateParsed = p;
      }
      if (state.dateParsed.kind === 'verbatim') return;
      state.dateParsed = { kind: 'parsed', date: DT.stepCalendarDay(state.dateParsed.date, n) };
      renderStores();
    }

    function setDayOffset(offset) {
      state.dateParsed = { kind: 'parsed', date: DT.addDaysFromToday(Number(offset) || 0, getToday()) };
      renderStores();
    }

    function stepH(n) {
      state.hasTime = true;
      if (state.time.mode === 'verbatim') state.time = { mode: 'parsed', h: 12, m: 0 };
      state.time.h = DT.stepHour(state.time.h, n);
      renderStores();
    }

    function stepM(n) {
      state.hasTime = true;
      if (state.time.mode === 'verbatim') state.time = { mode: 'parsed', h: 12, m: 0 };
      var next = DT.stepMinute(state.time.h, state.time.m, n);
      state.time.h = next.h;
      state.time.m = next.m;
      renderStores();
    }

    bindRepeatButton(mount.querySelector('[data-act="d-minus"]'), function () { stepDay(-1); });
    bindRepeatButton(mount.querySelector('[data-act="d-plus"]'), function () { stepDay(1); });
    bindRepeatButton(mount.querySelector('[data-act="h-plus"]'), function () { stepH(1); });
    bindRepeatButton(mount.querySelector('[data-act="h-minus"]'), function () { stepH(-1); });
    bindRepeatButton(mount.querySelector('[data-act="m-plus"]'), function () { stepM(15); });
    bindRepeatButton(mount.querySelector('[data-act="m-minus"]'), function () { stepM(-15); });

    bindSpinKeys(els.dVal, function () { stepDay(1); }, function () { stepDay(-1); });
    bindSpinKeys(els.hVal, function () { stepH(1); }, function () { stepH(-1); });
    bindSpinKeys(els.mVal, function () { stepM(15); }, function () { stepM(-15); });

    mount.querySelectorAll('[data-d]').forEach(function (btn) {
      btn.addEventListener('click', function () { setDayOffset(btn.getAttribute('data-d')); });
    });
    mount.querySelectorAll('[data-tm]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = String(btn.getAttribute('data-tm') || '').split(':');
        state.hasTime = true;
        state.time = { mode: 'parsed', h: Number(parts[0]) || 0, m: Number(parts[1]) || 0 };
        renderStores();
      });
    });
    var nowBtn = mount.querySelector('[data-act="now"]');
    if (nowBtn) {
      nowBtn.addEventListener('click', function () {
        var n = new Date();
        state.dateParsed = { kind: 'parsed', date: DT.startOfCalendarDay(getToday()) };
        state.hasTime = true;
        state.time = { mode: 'parsed', h: n.getHours(), m: n.getMinutes() };
        renderStores();
      });
    }
    var noTimeBtn = mount.querySelector('[data-act="no-time"]');
    if (noTimeBtn) {
      noTimeBtn.addEventListener('click', function () {
        state.hasTime = false;
        renderStores();
      });
    }

    return {
      setValues: function (attendanceDate, attendanceTime, bailReturnDate) {
        var dateStr = attendanceDate || bailReturnDate || '';
        state.dateParsed = parseFlexibleDateSafe(dateStr);
        var t = DT.parseFlexibleTime(attendanceTime);
        if (t.mode === 'none') {
          state.hasTime = false;
          state.time = { mode: 'parsed', h: 14, m: 30 };
        } else if (t.mode === 'verbatim') {
          state.hasTime = true;
          state.time = t;
        } else {
          state.hasTime = true;
          state.time = t;
        }
        renderStores();
      },
      getValues: function () {
        return {
          attendanceDate: els.dateStore ? els.dateStore.value : '',
          attendanceTime: els.timeStore ? els.timeStore.value : '',
        };
      },
      getWhenPhrase: function () {
        return els.whenText ? els.whenText.textContent : '';
      },
      applyBailDefaultIfNeeded: function (templateType) {
        if (!DT.isBailTemplate(templateType)) return;
        var today = getToday();
        var cur = state.dateParsed.kind === 'parsed' ? state.dateParsed.date : today;
        if (cur <= DT.startOfCalendarDay(today)) {
          state.dateParsed = { kind: 'parsed', date: DT.addDaysFromToday(28, today) };
          renderStores();
        }
      },
      setParsedDate: function (date) {
        state.dateParsed = { kind: 'parsed', date: date };
        renderStores();
      },
    };
  }

  global.OfficerEmailDateTimePicker = { init: init };
})(typeof window !== 'undefined' ? window : globalThis);
