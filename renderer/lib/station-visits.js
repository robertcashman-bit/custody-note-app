/**
 * station-visits.js — multiple same-day station visits on one attendance (pure helpers + migration).
 * Used by app.js for aggregation, PDF, and validation. Unit-tested without the full app.
 */
(function (global) {
  'use strict';

  function emptyVisit() {
    return {
      label: '',
      timeSetOff: '',
      timeArrival: '',
      timeDeparture: '',
      timeOfficeHome: '',
      waitingTimeStart: '',
      waitingTimeEnd: '',
      waitingTimeNotes: '',
      milesClaimable: '',
      parkingCost: ''
    };
  }

  /**
   * Split a time span into social (09:30–17:30 weekday) and unsocial minutes.
   * Mirrors app.js splitSocialUnsocial for consistent billing.
   */
  function splitSocialUnsocial(startTime, endTime, isWeekendBH, crossesMidnight) {
    if (!startTime || !endTime) return { social: 0, unsocial: 0 };
    var sh = Number(startTime.split(':')[0]);
    var sm = Number(startTime.split(':')[1]);
    var eh = Number(endTime.split(':')[0]);
    var em = Number(endTime.split(':')[1]);
    var startMins = sh * 60 + sm;
    var endMins = eh * 60 + em;
    if (crossesMidnight === true) {
      if (endMins <= startMins) endMins += 1440;
    } else {
      if (endMins < startMins) endMins += 1440;
    }
    if (endMins === startMins && !crossesMidnight) return { social: 0, unsocial: 0 };
    var social = 0;
    var unsocial = 0;
    for (var m = startMins; m < endMins; m++) {
      var hh = m % 1440;
      if (isWeekendBH || hh < 570 || hh >= 1050) unsocial++;
      else social++;
    }
    return { social: social, unsocial: unsocial };
  }

  function migrateLegacyToVisits(d) {
    if (!d || typeof d !== 'object') return;
    if (Array.isArray(d.stationVisits) && d.stationVisits.length > 0) return;
    var v = emptyVisit();
    v.timeSetOff = d.timeSetOff != null ? String(d.timeSetOff) : '';
    v.timeArrival = d.timeArrival != null ? String(d.timeArrival) : '';
    v.timeDeparture = d.timeDeparture != null ? String(d.timeDeparture) : '';
    v.timeOfficeHome = d.timeOfficeHome != null ? String(d.timeOfficeHome) : '';
    v.waitingTimeStart = d.waitingTimeStart != null ? String(d.waitingTimeStart) : '';
    v.waitingTimeEnd = d.waitingTimeEnd != null ? String(d.waitingTimeEnd) : '';
    v.waitingTimeNotes = d.waitingTimeNotes != null ? String(d.waitingTimeNotes) : '';
    if (d.milesClaimable != null && d.milesClaimable !== '') {
      v.milesClaimable = String(d.milesClaimable);
    }
    if (d.parkingCost != null && d.parkingCost !== '') {
      v.parkingCost = String(d.parkingCost);
    }
    d.stationVisits = [v];
  }

  function ensureStationVisits(d) {
    if (!d || typeof d !== 'object') return;
    migrateLegacyToVisits(d);
    if (!Array.isArray(d.stationVisits) || d.stationVisits.length === 0) {
      d.stationVisits = [emptyVisit()];
    }
  }

  function parseNum(x) {
    var n = parseFloat(x);
    return isNaN(n) ? 0 : n;
  }

  /** Sum per-visit miles; falls back to legacy flat miles when single visit and visit miles empty. */
  function sumVisitMiles(visits, legacyMiles) {
    if (!visits || !visits.length) return parseNum(legacyMiles);
    var sum = 0;
    var any = false;
    for (var i = 0; i < visits.length; i++) {
      var m = visits[i] && visits[i].milesClaimable;
      if (m !== undefined && m !== null && String(m).trim() !== '') {
        sum += parseNum(m);
        any = true;
      }
    }
    if (any) return sum;
    if (visits.length === 1) return parseNum(legacyMiles);
    return parseNum(legacyMiles);
  }

  function sumVisitParking(visits, legacyParking) {
    if (!visits || !visits.length) return parseNum(legacyParking);
    var sum = 0;
    var any = false;
    for (var i = 0; i < visits.length; i++) {
      var p = visits[i] && visits[i].parkingCost;
      if (p !== undefined && p !== null && String(p).trim() !== '') {
        sum += parseNum(p);
        any = true;
      }
    }
    if (any) return sum;
    if (visits.length === 1) return parseNum(legacyParking);
    return parseNum(legacyParking);
  }

  /**
   * Writes legacy flat keys from stationVisits for exports and older code paths.
   */
  function syncLegacyMirror(d) {
    if (!d || !Array.isArray(d.stationVisits) || !d.stationVisits.length) return;
    var vis = d.stationVisits;
    var first = vis[0] || emptyVisit();
    var last = vis[vis.length - 1] || first;
    d.timeSetOff = first.timeSetOff != null ? String(first.timeSetOff) : '';
    d.timeArrival = first.timeArrival != null ? String(first.timeArrival) : '';
    d.timeDeparture = last.timeDeparture != null ? String(last.timeDeparture) : '';
    d.timeOfficeHome = last.timeOfficeHome != null ? String(last.timeOfficeHome) : '';
    if (vis.length === 1) {
      d.waitingTimeStart = first.waitingTimeStart != null ? String(first.waitingTimeStart) : '';
      d.waitingTimeEnd = first.waitingTimeEnd != null ? String(first.waitingTimeEnd) : '';
      d.waitingTimeNotes = first.waitingTimeNotes != null ? String(first.waitingTimeNotes) : '';
    } else {
      d.waitingTimeStart = '';
      d.waitingTimeEnd = '';
      d.waitingTimeNotes = '';
    }
    d.multipleJourneys = vis.length > 1 ? 'Yes' : (d.multipleJourneys || 'No');
    d.numAttendances = vis.length;
    var totalMiles = sumVisitMiles(vis, d.milesClaimable);
    d.milesClaimable = totalMiles > 0 ? String(totalMiles) : (d.milesClaimable != null ? String(d.milesClaimable) : '');
    var totalPark = sumVisitParking(vis, d.parkingCost);
    d.parkingCost = totalPark > 0 ? String(totalPark) : (d.parkingCost != null ? String(d.parkingCost) : '');
  }

  function getEarliestStationArrival(d) {
    ensureStationVisits(d);
    var best = '';
    (d.stationVisits || []).forEach(function (v) {
      var t = (v && v.timeArrival) ? String(v.timeArrival).trim() : '';
      if (!t) return;
      if (!best || t < best) best = t;
    });
    return best || (d.timeArrival || '').trim();
  }

  function getEffectiveTimeArrival(d) {
    ensureStationVisits(d);
    var v0 = d.stationVisits && d.stationVisits[0];
    if (v0 && v0.timeArrival) return String(v0.timeArrival).trim();
    return (d.timeArrival || '').trim();
  }

  /**
   * Returns aggregate minute buckets matching app.js autoCalcTimes semantics (summed across visits).
   */
  function aggregateMinuteBuckets(visits, isWBH) {
    var travelSocial = 0;
    var travelUnsocial = 0;
    var waitingSocial = 0;
    var waitingUnsocial = 0;
    var adviceSocial = 0;
    var adviceUnsocial = 0;

    (visits || []).forEach(function (v) {
      if (!v) return;
      if (v.timeSetOff && v.timeArrival) {
        var o = splitSocialUnsocial(v.timeSetOff, v.timeArrival, isWBH);
        travelSocial += o.social;
        travelUnsocial += o.unsocial;
      }
      if (v.timeDeparture && v.timeOfficeHome) {
        var r = splitSocialUnsocial(v.timeDeparture, v.timeOfficeHome, isWBH);
        travelSocial += r.social;
        travelUnsocial += r.unsocial;
      }
      if (v.waitingTimeStart && v.waitingTimeEnd) {
        var w = splitSocialUnsocial(v.waitingTimeStart, v.waitingTimeEnd, isWBH);
        waitingSocial += w.social;
        waitingUnsocial += w.unsocial;
      }
      if (v.timeArrival && v.timeDeparture) {
        var station = splitSocialUnsocial(v.timeArrival, v.timeDeparture, isWBH);
        var wSoc = v.waitingTimeStart && v.waitingTimeEnd
          ? splitSocialUnsocial(v.waitingTimeStart, v.waitingTimeEnd, isWBH).social : 0;
        var wUns = v.waitingTimeStart && v.waitingTimeEnd
          ? splitSocialUnsocial(v.waitingTimeStart, v.waitingTimeEnd, isWBH).unsocial : 0;
        adviceSocial += Math.max(0, station.social - wSoc);
        adviceUnsocial += Math.max(0, station.unsocial - wUns);
      }
    });

    return {
      travelSocial: travelSocial,
      travelUnsocial: travelUnsocial,
      waitingSocial: waitingSocial,
      waitingUnsocial: waitingUnsocial,
      adviceSocial: adviceSocial,
      adviceUnsocial: adviceUnsocial
    };
  }

  global.StationVisits = {
    emptyVisit: emptyVisit,
    splitSocialUnsocial: splitSocialUnsocial,
    migrateLegacyToVisits: migrateLegacyToVisits,
    ensureStationVisits: ensureStationVisits,
    syncLegacyMirror: syncLegacyMirror,
    sumVisitMiles: sumVisitMiles,
    sumVisitParking: sumVisitParking,
    getEarliestStationArrival: getEarliestStationArrival,
    getEffectiveTimeArrival: getEffectiveTimeArrival,
    aggregateMinuteBuckets: aggregateMinuteBuckets
  };
})(typeof window !== 'undefined' ? window : globalThis);
