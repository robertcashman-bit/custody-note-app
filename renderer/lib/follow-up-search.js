/* follow-up-search.js — filter/sort station attendances for follow-up picker (testable). */
(function (global) {
  'use strict';

  var MIN_QUERY_LEN = 2;

  function isStationAttendanceData(data) {
    if (!data || typeof data !== 'object') return false;
    if (data._formType === 'telephone') return false;
    return true;
  }

  function normalizeQuery(q) {
    return String(q || '').trim().toLowerCase();
  }

  function attendanceDataMatchesQuery(data, queryNorm) {
    if (!queryNorm || queryNorm.length < MIN_QUERY_LEN) return false;
    if (!isStationAttendanceData(data)) return false;
    var sn = String(data.surname || '').toLowerCase();
    var fn = String(data.forename || '').toLowerCase();
    var dob = String(data.dob || '').toLowerCase();
    var ufn = String(data.ufn || '').toLowerCase();
    if (sn.indexOf(queryNorm) >= 0 || fn.indexOf(queryNorm) >= 0) return true;
    if (dob && dob.indexOf(queryNorm) >= 0) return true;
    if (ufn && ufn.indexOf(queryNorm) >= 0) return true;
    return false;
  }

  function rowRecencyKey(row) {
    if (!row) return '';
    if (row.updated_at) return String(row.updated_at);
    if (row.created_at) return String(row.created_at);
    if (row.attendance_date) return String(row.attendance_date);
    if (row.data && typeof row.data === 'object' && row.data.date) return String(row.data.date);
    return String(row.id || '');
  }

  function sortAttendanceRowsByRecency(rows) {
    return (rows || []).slice().sort(function (a, b) {
      return rowRecencyKey(b).localeCompare(rowRecencyKey(a));
    });
  }

  /**
   * @param {Array} rows — attendance list rows with .data (object or JSON string)
   * @param {string} query
   * @param {function} [parseData] — optional JSON parse
   */
  function filterAttendanceRowsForFollowUpSearch(rows, query, parseData) {
    var parse = parseData || function (raw) {
      if (raw && typeof raw === 'object') return raw;
      try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
    };
    var q = normalizeQuery(query);
    if (q.length < MIN_QUERY_LEN) return [];
    var out = [];
    (rows || []).forEach(function (row) {
      var data = parse(row.data);
      if (!attendanceDataMatchesQuery(data, q)) return;
      if (!data.surname && !data.forename && !data.ufn) return;
      out.push({ row: row, data: data });
    });
    return sortAttendanceRowsByRecency(out.map(function (x) { return x.row; })).map(function (row) {
      return { row: row, data: parse(row.data) };
    });
  }

  function clientIdentityKey(data) {
    if (!data) return '';
    return [
      String(data.surname || '').trim().toLowerCase(),
      String(data.forename || '').trim().toLowerCase(),
      String(data.dob || '').trim(),
    ].join('|');
  }

  function filterStationAttendancesForClientIdentity(rows, clientData, parseData, excludeId) {
    var parse = parseData || function (raw) {
      if (raw && typeof raw === 'object') return raw;
      try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
    };
    var key = clientIdentityKey(clientData);
    if (!key || key === '||') return [];
    var matches = [];
    (rows || []).forEach(function (row) {
      if (excludeId != null && String(row.id) === String(excludeId)) return;
      var data = parse(row.data);
      if (!isStationAttendanceData(data)) return;
      if (clientIdentityKey(data) !== key) return;
      matches.push({ row: row, data: data });
    });
    return sortAttendanceRowsByRecency(matches.map(function (x) { return x.row; })).map(function (row) {
      return { row: row, data: parse(row.data) };
    });
  }

  function formatFollowUpPickerPrimary(data) {
    var parts = [data.surname, data.forename].filter(Boolean);
    return parts.join(', ') || 'Unknown client';
  }

  function formatFollowUpPickerMeta(data, row) {
    var bits = [];
    if (data.dob) bits.push('DOB ' + data.dob);
    var date = (row && row.attendance_date) || data.date || '';
    if (date) {
      var dm = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
      bits.push(dm ? (dm[3] + '/' + dm[2] + '/' + dm[1]) : date);
    }
    var station = (row && row.station_name) || data.policeStationName || '';
    if (station) bits.push(station);
    if (data.ufn) bits.push('UFN ' + data.ufn);
    return bits.join(' · ');
  }

  global.FOLLOW_UP_SEARCH_MIN_LEN = MIN_QUERY_LEN;
  global.isStationAttendanceData = isStationAttendanceData;
  global.attendanceDataMatchesQuery = attendanceDataMatchesQuery;
  global.filterAttendanceRowsForFollowUpSearch = filterAttendanceRowsForFollowUpSearch;
  global.filterStationAttendancesForClientIdentity = filterStationAttendancesForClientIdentity;
  global.sortAttendanceRowsByRecency = sortAttendanceRowsByRecency;
  global.formatFollowUpPickerPrimary = formatFollowUpPickerPrimary;
  global.formatFollowUpPickerMeta = formatFollowUpPickerMeta;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      MIN_QUERY_LEN: MIN_QUERY_LEN,
      isStationAttendanceData: isStationAttendanceData,
      attendanceDataMatchesQuery: attendanceDataMatchesQuery,
      filterAttendanceRowsForFollowUpSearch: filterAttendanceRowsForFollowUpSearch,
      filterStationAttendancesForClientIdentity: filterStationAttendancesForClientIdentity,
      sortAttendanceRowsByRecency: sortAttendanceRowsByRecency,
      formatFollowUpPickerPrimary: formatFollowUpPickerPrimary,
      formatFollowUpPickerMeta: formatFollowUpPickerMeta,
      clientIdentityKey: clientIdentityKey,
    };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : globalThis));
