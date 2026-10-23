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
    var holdTimer = null;
    var holdInterval = null;
    var didHoldStep = false;

    function stopHold() {
      if (holdTimer) clearTimeout(holdTimer);
      if (holdInterval) clearInterval(holdInterval);
      holdTimer = null;
      holdInterval = null;
    }

    btn.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      didHoldStep = false;
      stopHold();
      holdTimer = setTimeout(function () {
        didHoldStep = true;
        fn();
        holdInterval = setInterval(fn, 120);
      }, 450);
    });

    btn.addEventListener('pointerup', function () {
      var wasHold = didHoldStep;
      stopHold();
      if (!wasHold) fn();
      didHoldStep = false;
    });

    btn.addEventListener('pointerleave', function () {
      stopHold();
      didHoldStep = false;
    });
    btn.addEventListener('pointercancel', function () {
      stopHold();
      didHoldStep = false;
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

  function init(mount, options) {
    var opts = options || {};
    var prefix = opts.prefix || 'oe';
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
    var getToday = typeof opts.getToday === 'function' ? opts.getToday : function () { return new Date(); };
    var silentChange = false;

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
      '<input type="hidden" id="' + prefix + '-attendance-time-store" />' +
      '<input type="hidden" id="' + prefix + '-bail-return-date-store" />' +
      '<input type="hidden" id="' + prefix + '-bail-return-time-store" />';

    var els = {
      dVal: mount.querySelector('[data-role="d-val"]'),
      hVal: mount.querySelector('[data-role="h-val"]'),
      mVal: mount.querySelector('[data-role="m-val"]'),
      whenText: mount.querySelector('[data-role="when-text"]'),
      attendanceDateStore: mount.querySelector('#' + prefix + '-attendance-date-store'),
      attendanceTimeStore: mount.querySelector('#' + prefix + '-attendance-time-store'),
      bailReturnDateStore: mount.querySelector('#' + prefix + '-bail-return-date-store'),
      bailReturnTimeStore: mount.querySelector('#' + prefix + '-bail-return-time-store'),
    };

    var state = {
      templateType: 'disclosure_confirm_attendance',
      attendanceDate: { kind: 'empty' },
      bailReturnDate: { kind: 'empty' },
      displayDate: { kind: 'empty' },
      attendanceTime: { mode: 'none' },
      bailReturnTime: { mode: 'none' },
    };

    function activeTime() {
      return isBailMode() ? state.bailReturnTime : state.attendanceTime;
    }

    function setActiveTime(t) {
      if (isBailMode()) state.bailReturnTime = t;
      else state.attendanceTime = t;
    }

    function isBailMode() {
      return DT.isBailTemplate(state.templateType);
    }

    function syncDisplayFromStores() {
      state.displayDate = isBailMode() ? state.bailReturnDate : state.attendanceDate;
    }

    function writeStoresFromState() {
      var attDateOut = serialise(state.attendanceDate);
      var bailDateOut = serialise(state.bailReturnDate);
      var timeOut = DT.serialiseTimeForStorage(state.attendanceTime);
      if (els.attendanceDateStore) els.attendanceDateStore.value = attDateOut;
      if (els.bailReturnDateStore) els.bailReturnDateStore.value = bailDateOut;
      var bailTimeOut = DT.serialiseTimeForStorage(state.bailReturnTime);
      if (els.attendanceTimeStore) els.attendanceTimeStore.value = timeOut;
      if (els.bailReturnTimeStore) els.bailReturnTimeStore.value = bailTimeOut;
    }

    function serialise(d) {
      if (d.kind === 'empty') return '';
      return DT.serialiseDateForStorage(d);
    }

    function parseDate(str) {
      return DT.parseFlexibleDate(str);
    }

    function renderStores() {
      syncDisplayFromStores();
      writeStoresFromState();
      var d = state.displayDate;
      if (els.dVal) {
        if (d.kind === 'empty') els.dVal.textContent = '—';
        else if (d.kind === 'verbatim') els.dVal.textContent = d.text;
        else els.dVal.textContent = DT.relativeDayLabel(d.date, getToday());
      }
      var tShow = activeTime();
      if (els.hVal) {
        els.hVal.textContent = tShow.mode === 'parsed' ? DT.pad2(tShow.h) : '—';
      }
      if (els.mVal) {
        els.mVal.textContent = tShow.mode === 'parsed' ? DT.pad2(tShow.m) : '—';
      }
      if (els.whenText) {
        var dateForPhrase = isBailMode() ? serialise(state.bailReturnDate) : serialise(state.attendanceDate);
        var phrase = DT.formatForEmailWhen(dateForPhrase, DT.serialiseTimeForStorage(tShow));
        els.whenText.textContent = phrase || '—';
      }
      if (!silentChange) onChange();
    }

    function ensureDisplayDateForStep() {
      if (state.displayDate.kind !== 'empty') return;
      state.displayDate = { kind: 'parsed', date: DT.startOfCalendarDay(getToday()) };
      if (isBailMode()) state.bailReturnDate = state.displayDate;
      else state.attendanceDate = state.displayDate;
    }

    function ensureTimeForStep() {
      var t = activeTime();
      if (t.mode === 'parsed') return;
      var n = new Date();
      setActiveTime({ mode: 'parsed', h: n.getHours(), m: n.getMinutes() });
    }

    function stepDay(n) {
      ensureDisplayDateForStep();
      if (state.displayDate.kind === 'verbatim') {
        var reparsed = parseDate(state.displayDate.text);
        state.displayDate = reparsed;
      }
      if (state.displayDate.kind === 'empty' || state.displayDate.kind === 'verbatim') return;
      var next = { kind: 'parsed', date: DT.stepCalendarDay(state.displayDate.date, n) };
      state.displayDate = next;
      if (isBailMode()) state.bailReturnDate = next;
      else state.attendanceDate = next;
      renderStores();
    }

    function setDayOffset(offset) {
      var next = { kind: 'parsed', date: DT.addDaysFromToday(Number(offset) || 0, getToday()) };
      state.displayDate = next;
      if (isBailMode()) state.bailReturnDate = next;
      else state.attendanceDate = next;
      renderStores();
    }

    function stepH(n) {
      ensureTimeForStep();
      var t = activeTime();
      if (t.mode === 'verbatim') t = { mode: 'parsed', h: 12, m: 0 };
      t.h = DT.stepHour(t.h, n);
      setActiveTime(t);
      renderStores();
    }

    function stepM(n) {
      ensureTimeForStep();
      var t = activeTime();
      if (t.mode === 'verbatim') t = { mode: 'parsed', h: 12, m: 0 };
      var next = DT.stepMinute(t.h, t.m, n);
      t.h = next.h;
      t.m = next.m;
      setActiveTime(t);
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
        setActiveTime({ mode: 'parsed', h: Number(parts[0]) || 0, m: Number(parts[1]) || 0 });
        renderStores();
      });
    });
    var nowBtn = mount.querySelector('[data-act="now"]');
    if (nowBtn) {
      nowBtn.addEventListener('click', function () {
        var n = new Date();
        var day = { kind: 'parsed', date: DT.startOfCalendarDay(getToday()) };
        state.displayDate = day;
        if (isBailMode()) state.bailReturnDate = day;
        else state.attendanceDate = day;
        setActiveTime({ mode: 'parsed', h: n.getHours(), m: n.getMinutes() });
        renderStores();
      });
    }
    var noTimeBtn = mount.querySelector('[data-act="no-time"]');
    if (noTimeBtn) {
      noTimeBtn.addEventListener('click', function () {
        setActiveTime({ mode: 'none' });
        renderStores();
      });
    }

    renderStores();

    var api = {
      setTemplateType: function (templateType, optionsSet) {
        var o = optionsSet || {};
        silentChange = !!o.silent;
        state.templateType = templateType || state.templateType;
        syncDisplayFromStores();
        renderStores();
        silentChange = false;
      },
      setValues: function (payload, optionsSet) {
        var o = optionsSet || {};
        silentChange = !!o.silent;
        var p = payload || {};
        if (p.templateType) state.templateType = p.templateType;
        state.attendanceDate = parseDate(p.attendanceDate != null ? p.attendanceDate : '');
        state.bailReturnDate = parseDate(p.bailReturnDate != null ? p.bailReturnDate : '');
        var attT = DT.parseFlexibleTime(p.attendanceTime);
        state.attendanceTime = attT.mode === 'none' ? { mode: 'none' } : attT;
        var bailT = DT.parseFlexibleTime(p.bailReturnTime);
        state.bailReturnTime = bailT.mode === 'none' ? { mode: 'none' } : bailT;
        syncDisplayFromStores();
        renderStores();
        silentChange = false;
      },
      clear: function (optionsClear) {
        var o = optionsClear || {};
        silentChange = !!o.silent;
        state.attendanceDate = { kind: 'empty' };
        state.bailReturnDate = { kind: 'empty' };
        state.displayDate = { kind: 'empty' };
        state.attendanceTime = { mode: 'none' };
        state.bailReturnTime = { mode: 'none' };
        renderStores();
        silentChange = false;
      },
      getValues: function (templateType) {
        if (templateType) state.templateType = templateType;
        writeStoresFromState();
        return {
          attendanceDate: els.attendanceDateStore ? els.attendanceDateStore.value : '',
          attendanceTime: els.attendanceTimeStore ? els.attendanceTimeStore.value : '',
          bailReturnDate: els.bailReturnDateStore ? els.bailReturnDateStore.value : '',
          bailReturnTime: els.bailReturnTimeStore ? els.bailReturnTimeStore.value : '',
        };
      },
      getWhenPhrase: function () {
        return els.whenText ? els.whenText.textContent : '';
      },
      setAttendanceDateOnly: function (dateStr, optionsAtt) {
        var o = optionsAtt || {};
        silentChange = !!o.silent;
        state.attendanceDate = parseDate(dateStr);
        syncDisplayFromStores();
        renderStores();
        silentChange = false;
      },
    };
    mount.__officerEmailWhenPicker = api;
    return api;
  }

  global.OfficerEmailDateTimePicker = { init: init };
})(typeof window !== 'undefined' ? window : globalThis);
