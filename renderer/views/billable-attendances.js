/* ═══════════════════════════════════════════════════════
   BILLABLE ATTENDANCES REPORT
   Shows completed attendances not yet invoiced.
   Depends on: showToast, esc, safeJson (app.js globals), window.api
   ═══════════════════════════════════════════════════════ */

var _billableData = [];

function loadBillableAttendances() {
  if (!window.api || !window.api.billableAttendances) return;

  window.api.billableAttendances().then(function (rows) {
    _billableData = (rows || []).map(function (r) {
      var d = safeJson(r.data);
      return {
        id: r.id,
        clientName: [d.forename, d.surname].filter(Boolean).join(' ') || r.client_name || '',
        firmName: d.firmName || '',
        stationName: d.policeStationName || r.station_name || '',
        date: d.date || r.attendance_date || '',
        offenceSummary: d.offenceSummary || d.offence1Details || '',
        attendanceFee: 160.00,
        mileageMiles: parseFloat(d.milesClaimable) || 0,
        mileageRate: 0.45,
        parkingAmount: parseFloat(d.parkingCost) || 0,
        raw: d,
      };
    });

    _populateBillableFirmFilter();
    _renderBillableTable();
  }).catch(function () {
    showToast('Could not load billable attendances', 'error');
  });
}

function _populateBillableFirmFilter() {
  var sel = document.getElementById('billable-firm-filter');
  if (!sel) return;
  var firms = {};
  _billableData.forEach(function (r) { if (r.firmName) firms[r.firmName] = true; });
  sel.innerHTML = '<option value="">All firms</option>';
  Object.keys(firms).sort().forEach(function (f) {
    sel.innerHTML += '<option value="' + _billableEsc(f) + '">' + _billableEsc(f) + '</option>';
  });
}

function _billableEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _filterBillableData() {
  var search = (document.getElementById('billable-search')?.value || '').toLowerCase().trim();
  var dateFrom = document.getElementById('billable-date-from')?.value || '';
  var dateTo = document.getElementById('billable-date-to')?.value || '';
  var firmFilter = document.getElementById('billable-firm-filter')?.value || '';

  return _billableData.filter(function (r) {
    if (search) {
      var haystack = (r.clientName + ' ' + r.firmName + ' ' + r.stationName + ' ' + r.offenceSummary).toLowerCase();
      if (haystack.indexOf(search) === -1) return false;
    }
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    if (firmFilter && r.firmName !== firmFilter) return false;
    return true;
  });
}

function _renderBillableTable() {
  var wrap = document.getElementById('billable-attendances-table-wrap');
  if (!wrap) return;

  var filtered = _filterBillableData();

  var totalBillable = filtered.length;
  var totalRevenue = 0;
  filtered.forEach(function (r) {
    var mileageCost = r.mileageMiles * r.mileageRate;
    var sub = r.attendanceFee + mileageCost + r.parkingAmount;
    var total = sub * 1.20;
    totalRevenue += total;
  });

  var summary = document.getElementById('billable-summary-text');
  if (summary) {
    summary.textContent = totalBillable + ' billable attendance' + (totalBillable !== 1 ? 's' : '') +
      ' \u2014 Total potential revenue: \u00A3' + totalRevenue.toFixed(2);
  }

  if (!filtered.length) {
    wrap.innerHTML = '<p class="settings-hint">No billable attendances found. All completed records have been invoiced.</p>';
    return;
  }

  var html = '<table class="billable-table"><thead><tr>' +
    '<th>Client</th><th>Firm</th><th>Station</th><th>Date</th>' +
    '<th>Offence</th><th>Fee</th><th>Mileage</th><th>Parking</th><th>Total</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  filtered.forEach(function (r) {
    var mileageCost = r.mileageMiles * r.mileageRate;
    var sub = r.attendanceFee + mileageCost + r.parkingAmount;
    var total = sub * 1.20;
    html += '<tr>' +
      '<td>' + _billableEsc(r.clientName) + '</td>' +
      '<td>' + _billableEsc(r.firmName) + '</td>' +
      '<td>' + _billableEsc(r.stationName) + '</td>' +
      '<td>' + _billableEsc(r.date) + '</td>' +
      '<td class="billable-offence">' + _billableEsc(r.offenceSummary) + '</td>' +
      '<td>\u00A3' + r.attendanceFee.toFixed(2) + '</td>' +
      '<td>\u00A3' + mileageCost.toFixed(2) + '</td>' +
      '<td>\u00A3' + r.parkingAmount.toFixed(2) + '</td>' +
      '<td><strong>\u00A3' + total.toFixed(2) + '</strong></td>' +
      '<td class="billable-actions">' +
        '<button type="button" class="btn btn-small billable-open" data-id="' + r.id + '">Open</button> ' +
        '<button type="button" class="btn btn-small btn-accent billable-invoice" data-id="' + r.id + '">Invoice</button>' +
      '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('.billable-open').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = parseInt(btn.getAttribute('data-id'), 10);
      if (typeof openAttendance === 'function') openAttendance(id);
      else if (typeof window.openAttendance === 'function') window.openAttendance(id);
    });
  });

  wrap.querySelectorAll('.billable-invoice').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = parseInt(btn.getAttribute('data-id'), 10);
      if (typeof openAttendance === 'function') openAttendance(id);
      else if (typeof window.openAttendance === 'function') window.openAttendance(id);
      setTimeout(function () { openBillingPanel(); }, 500);
    });
  });
}

(function _initBillableListeners() {
  document.addEventListener('DOMContentLoaded', function () {
    var searchEl = document.getElementById('billable-search');
    var dateFromEl = document.getElementById('billable-date-from');
    var dateToEl = document.getElementById('billable-date-to');
    var firmEl = document.getElementById('billable-firm-filter');

    if (searchEl) searchEl.addEventListener('input', _renderBillableTable);
    if (dateFromEl) dateFromEl.addEventListener('change', _renderBillableTable);
    if (dateToEl) dateToEl.addEventListener('change', _renderBillableTable);
    if (firmEl) firmEl.addEventListener('change', _renderBillableTable);
  });
})();
