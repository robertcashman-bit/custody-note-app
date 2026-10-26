'use strict';

/**
 * Page-1 "Times & travel" summary for attendance-note PDFs.
 * Pure helpers — used by app.js (script tag) and node --test.
 * Minute buckets and visit aggregation mirror app.js + renderer/lib/station-visits.js.
 */

function trim(val) {
  return val == null ? '' : String(val).trim();
}

function hm(start, end) {
  if (!start || !end) return 0;
  var a = start.split(':').map(Number);
  var b = end.split(':').map(Number);
  if (a.length < 2 || b.length < 2) return 0;
  var diff = (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
  if (diff < 0) diff += 1440;
  return diff;
}

function fmtMins(m) {
  m = Math.max(0, parseInt(m, 10) || 0);
  if (!m) return '';
  var h = Math.floor(m / 60);
  var mm = m % 60;
  if (!h) return mm + 'm';
  return h + 'h ' + (mm < 10 ? '0' : '') + mm + 'm';
}

function fmtTime(t) {
  return trim(t);
}

function fmtTimeSpan(start, end) {
  if (!trim(start) && !trim(end)) return '';
  if (trim(start) && trim(end)) {
    var mins = hm(start, end);
    var dur = fmtMins(mins);
    return fmtTime(start) + ' \u2192 ' + fmtTime(end) + (dur ? ' (' + dur + ')' : '');
  }
  return trim(start) || trim(end);
}

function fmtMoney(v) {
  var n = parseFloat(v);
  if (isNaN(n) || n <= 0) return '';
  return '\u00a3' + n.toFixed(2);
}

function getStationVisitsModule() {
  if (typeof globalThis !== 'undefined' && globalThis.StationVisits) return globalThis.StationVisits;
  if (typeof window !== 'undefined' && window.StationVisits) return window.StationVisits;
  return null;
}

function loadStationVisitsForNode() {
  try {
    // eslint-disable-next-line global-require
    require('../renderer/lib/station-visits.js');
    return globalThis.StationVisits || null;
  } catch (_) {
    return null;
  }
}

function resolveStationVisitsApi() {
  var SV = getStationVisitsModule();
  if (SV && SV.aggregateMinuteBuckets) return SV;
  return loadStationVisitsForNode();
}

function ensureVisits(d, SV) {
  if (!d || typeof d !== 'object') return [];
  if (SV && SV.ensureStationVisits) {
    SV.ensureStationVisits(d);
  } else if (!Array.isArray(d.stationVisits) || !d.stationVisits.length) {
    d.stationVisits = [{
      timeSetOff: d.timeSetOff,
      timeArrival: d.timeArrival,
      timeDeparture: d.timeDeparture,
      timeOfficeHome: d.timeOfficeHome,
      waitingTimeStart: d.waitingTimeStart,
      waitingTimeEnd: d.waitingTimeEnd,
      milesClaimable: d.milesClaimable,
      parkingCost: d.parkingCost,
    }];
  }
  return d.stationVisits || [];
}

function sumInterviewMins(interviews) {
  if (!Array.isArray(interviews) || !interviews.length) return 0;
  var total = 0;
  interviews.forEach(function (iv) {
    if (iv && iv.startTime && iv.endTime) total += hm(iv.startTime, iv.endTime);
  });
  return total;
}

function interviewTimeDisplay(interviews) {
  if (!Array.isArray(interviews) || !interviews.length) return '';
  var parts = [];
  interviews.forEach(function (iv, idx) {
    if (!iv || !iv.startTime || !iv.endTime) return;
    var span = fmtTimeSpan(iv.startTime, iv.endTime);
    if (span) parts.push((interviews.length > 1 ? 'Interview ' + (idx + 1) + ': ' : '') + span);
  });
  return parts.join('; ');
}

function formatMilesDisplay(miles) {
  var n = parseFloat(miles);
  if (isNaN(n) || n <= 0) return '';
  var SM = (typeof globalThis !== 'undefined' && globalThis.StationMileage)
    || (typeof window !== 'undefined' && window.StationMileage);
  if (SM && typeof SM.formatMilesForDisplay === 'function') {
    return SM.formatMilesForDisplay(n);
  }
  return String(miles);
}

function sumDisbursements(d) {
  var list = d && d.disbursements;
  if (!Array.isArray(list) || !list.length) return { total: 0, count: 0 };
  var total = 0;
  var count = 0;
  list.forEach(function (dis) {
    var amt = parseFloat(dis && dis.amount);
    if (!dis || !(trim(dis.description) || amt > 0)) return;
    if (amt > 0) total += amt;
    count += 1;
  });
  return { total: total, count: count };
}

function computeTravelThereMins(visits, SV, isWBH) {
  var mins = 0;
  (visits || []).forEach(function (v) {
    if (!v || !v.timeSetOff || !v.timeArrival) return;
    if (SV && SV.splitSocialUnsocial) {
      var o = SV.splitSocialUnsocial(v.timeSetOff, v.timeArrival, isWBH);
      mins += (o.social || 0) + (o.unsocial || 0);
    } else {
      mins += hm(v.timeSetOff, v.timeArrival);
    }
  });
  return mins;
}

function computeTravelBackMins(visits, SV, isWBH) {
  var mins = 0;
  (visits || []).forEach(function (v) {
    if (!v || !v.timeDeparture || !v.timeOfficeHome) return;
    if (SV && SV.splitSocialUnsocial) {
      var r = SV.splitSocialUnsocial(v.timeDeparture, v.timeOfficeHome, isWBH);
      mins += (r.social || 0) + (r.unsocial || 0);
    } else {
      mins += hm(v.timeDeparture, v.timeOfficeHome);
    }
  });
  return mins;
}

function travelThereClock(visits) {
  var parts = [];
  (visits || []).forEach(function (v, vi) {
    if (!v || !v.timeSetOff || !v.timeArrival) return;
    var p = fmtTimeSpan(v.timeSetOff, v.timeArrival);
    if (visits.length > 1) p = 'Visit ' + (vi + 1) + ': ' + p;
    if (p) parts.push(p);
  });
  return parts.join('; ');
}

function travelBackClock(visits) {
  var parts = [];
  (visits || []).forEach(function (v, vi) {
    if (!v || !v.timeDeparture || !v.timeOfficeHome) return;
    var p = fmtTimeSpan(v.timeDeparture, v.timeOfficeHome);
    if (visits.length > 1) p = 'Visit ' + (vi + 1) + ': ' + p;
    if (p) parts.push(p);
  });
  return parts.join('; ');
}

function waitingClock(visits) {
  var parts = [];
  (visits || []).forEach(function (v, vi) {
    if (!v || !v.waitingTimeStart || !v.waitingTimeEnd) return;
    var p = fmtTimeSpan(v.waitingTimeStart, v.waitingTimeEnd);
    if (visits.length > 1) p = 'Visit ' + (vi + 1) + ': ' + p;
    if (p) parts.push(p);
  });
  return parts.join('; ');
}

function attendanceClock(visits, SV) {
  var parts = [];
  (visits || []).forEach(function (v, vi) {
    var arr = SV && SV.getVisitOnSiteArrival ? SV.getVisitOnSiteArrival(v) : (v && v.timeArrival);
    var dep = SV && SV.getVisitOnSiteDeparture ? SV.getVisitOnSiteDeparture(v) : (v && v.timeDeparture);
    if (!trim(arr) && !trim(dep)) return;
    var p = fmtTimeSpan(arr, dep);
    if (visits.length > 1) p = 'Visit ' + (vi + 1) + ': ' + p;
    if (p) parts.push(p);
  });
  return parts.join('; ');
}

function dayWindowClock(visits) {
  if (!visits || !visits.length) return '';
  var first = visits[0] || {};
  var last = visits[visits.length - 1] || first;
  if (!first.timeSetOff && !last.timeOfficeHome) return '';
  if (first.timeSetOff && last.timeOfficeHome) {
    return fmtTime(first.timeSetOff) + ' \u2192 ' + fmtTime(last.timeOfficeHome);
  }
  return trim(first.timeSetOff) || trim(last.timeOfficeHome);
}

function resolveTotalMinutes(d, travelMins, waitMins, adviceMins) {
  var stored = parseInt(d && d.totalMinutes, 10);
  if (!isNaN(stored) && stored > 0) return stored;
  var fromFields =
    (parseInt(d.travelSocial, 10) || 0) + (parseInt(d.travelUnsocial, 10) || 0) +
    (parseInt(d.waitingSocial, 10) || 0) + (parseInt(d.waitingUnsocial, 10) || 0) +
    (parseInt(d.adviceSocial, 10) || 0) + (parseInt(d.adviceUnsocial, 10) || 0);
  if (fromFields > 0) return fromFields;
  return (travelMins || 0) + (waitMins || 0) + (adviceMins || 0);
}

/**
 * @returns {{ rows: Array<{label:string,value:string,hint?:string}>, hasContent: boolean }}
 */
function buildTimesTravelSummaryModel(d, opts) {
  d = d || {};
  opts = opts || {};
  var variant = opts.variant || 'custody';
  var SV = resolveStationVisitsApi();
  var isWBH = d.weekendBankHoliday === 'Yes';
  var rows = [];

  if (variant === 'telephone') {
    if (trim(d.timeFirstContactWithClient)) {
      rows.push({ label: 'First contact', value: fmtTime(d.timeFirstContactWithClient) });
    }
    var callDur = parseInt(d.telephoneCallDuration, 10);
    if (!isNaN(callDur) && callDur > 0) {
      rows.push({ label: 'Call duration', value: fmtMins(callDur) });
    }
    var numCalls = parseInt(d.numberOfCalls, 10);
    if (!isNaN(numCalls) && numCalls > 0) {
      rows.push({ label: 'Number of calls', value: String(numCalls) });
    }
  }

  var visits = ensureVisits(Object.assign({}, d), SV);
  var hasVisitTimes = visits.some(function (v) {
    return v && (v.timeSetOff || v.timeArrival || v.timeDeparture || v.timeOfficeHome ||
      v.waitingTimeStart || v.waitingTimeEnd);
  });

  if (hasVisitTimes || variant !== 'telephone') {
    var travelThereMins = 0;
    var travelBackMins = 0;
    var waitMins = 0;
    var adviceMins = 0;

    if (SV && SV.aggregateMinuteBuckets && visits.length) {
      var agg = SV.aggregateMinuteBuckets(visits, isWBH);
      waitMins = (agg.waitingSocial || 0) + (agg.waitingUnsocial || 0);
      adviceMins = (agg.adviceSocial || 0) + (agg.adviceUnsocial || 0);
      travelThereMins = computeTravelThereMins(visits, SV, isWBH);
      travelBackMins = computeTravelBackMins(visits, SV, isWBH);
    } else {
      travelThereMins = computeTravelThereMins(visits, SV, isWBH);
      travelBackMins = computeTravelBackMins(visits, SV, isWBH);
      waitMins = (parseInt(d.waitingSocial, 10) || 0) + (parseInt(d.waitingUnsocial, 10) || 0);
      adviceMins = (parseInt(d.adviceSocial, 10) || 0) + (parseInt(d.adviceUnsocial, 10) || 0);
      if (!travelThereMins && !travelBackMins) {
        travelThereMins = (parseInt(d.travelSocial, 10) || 0) + (parseInt(d.travelUnsocial, 10) || 0);
      }
    }

    var dayWin = dayWindowClock(visits);
    if (dayWin) rows.push({ label: 'Day window', value: dayWin });

    var thClock = travelThereClock(visits);
    if (thClock || travelThereMins > 0) {
      rows.push({
        label: 'Travel there',
        value: fmtMins(travelThereMins) || thClock,
        hint: travelThereMins > 0 && thClock ? thClock : undefined,
      });
    }

    var tbClock = travelBackClock(visits);
    if (tbClock || travelBackMins > 0) {
      rows.push({
        label: 'Travel back',
        value: fmtMins(travelBackMins) || tbClock,
        hint: travelBackMins > 0 && tbClock ? tbClock : undefined,
      });
    }

    var wClock = waitingClock(visits);
    if (wClock || waitMins > 0) {
      rows.push({
        label: 'Waiting',
        value: fmtMins(waitMins) || wClock,
        hint: waitMins > 0 && wClock ? wClock : undefined,
      });
    }

    var attClock = attendanceClock(visits, SV);
    var attLabel = 'Attendance & consultation';
    if (attClock || adviceMins > 0) {
      rows.push({
        label: attLabel,
        value: fmtMins(adviceMins) || attClock,
        hint: adviceMins > 0 && attClock ? attClock : undefined,
      });
    }

    var ivDisplay = interviewTimeDisplay(d.interviews);
    var ivMins = sumInterviewMins(d.interviews);
    if (ivDisplay || ivMins > 0) {
      rows.push({
        label: 'Interview time',
        value: fmtMins(ivMins) || '',
        hint: ivDisplay || undefined,
      });
    }

    var totalMins = resolveTotalMinutes(d, travelThereMins + travelBackMins, waitMins, adviceMins);
    if (totalMins > 0) {
      rows.push({ label: 'Total time', value: fmtMins(totalMins) });
    }

    var miles = SV && SV.sumVisitMiles
      ? SV.sumVisitMiles(visits, d.milesClaimable)
      : parseFloat(d.milesClaimable);
    var milesStr = formatMilesDisplay(miles);
    if (milesStr) {
      rows.push({ label: 'Mileage', value: milesStr + ' miles' });
    }

    var parking = SV && SV.sumVisitParking
      ? SV.sumVisitParking(visits, d.parkingCost)
      : parseFloat(d.parkingCost);
    var parkStr = fmtMoney(parking);
    if (parkStr) rows.push({ label: 'Parking', value: parkStr });

    var disb = sumDisbursements(d);
    if (disb.total > 0) {
      rows.push({
        label: 'Other travel costs',
        value: fmtMoney(disb.total) + (disb.count > 1 ? ' (' + disb.count + ' items)' : ''),
      });
    }
  }

  var filtered = rows.filter(function (r) { return r && trim(r.value); });
  return { rows: filtered, hasContent: filtered.length > 0 };
}

function buildPdfTimesTravelCss() {
  return '.tt-summary{margin:8px 0 10px;border:2px solid #2563eb;border-radius:6px;background:#f0f4ff;padding:10px 12px;print-color-adjust:exact;}' +
    '.tt-summary h3{margin:0 0 8px;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:#1e40af;font-weight:700;}' +
    '.tt-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;}' +
    '.tt-item{min-width:0;}' +
    '.tt-label{font-size:8.5px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 2px;}' +
    '.tt-value{font-size:13px;font-weight:800;color:#0f172a;line-height:1.25;word-break:break-word;}' +
    '.tt-hint{font-size:8px;color:#64748b;margin-top:2px;line-height:1.35;}' +
    '.tt-item.tt-wide{grid-column:1 / -1;}';
}

function buildPdfTimesTravelHtml(d, esc, opts) {
  esc = esc || function (s) { return String(s == null ? '' : s); };
  var model = buildTimesTravelSummaryModel(d, opts);
  if (!model.hasContent || !model.rows.length) return '';

  var cells = model.rows.map(function (r) {
    var wide = r.hint ? ' tt-wide' : '';
    var hintHtml = r.hint ? '<div class="tt-hint">' + esc(r.hint) + '</div>' : '';
    return '<div class="tt-item' + wide + '">' +
      '<div class="tt-label">' + esc(r.label) + '</div>' +
      '<div class="tt-value">' + esc(r.value) + '</div>' +
      hintHtml +
      '</div>';
  }).join('');

  return '<div class="tt-summary"><h3>Times &amp; travel</h3><div class="tt-grid">' + cells + '</div></div>';
}

var PdfTimesTravelSummary = {
  hm: hm,
  fmtMins: fmtMins,
  fmtTimeSpan: fmtTimeSpan,
  buildTimesTravelSummaryModel: buildTimesTravelSummaryModel,
  buildPdfTimesTravelCss: buildPdfTimesTravelCss,
  buildPdfTimesTravelHtml: buildPdfTimesTravelHtml,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PdfTimesTravelSummary;
}
if (typeof window !== 'undefined') {
  window.PdfTimesTravelSummary = PdfTimesTravelSummary;
}
