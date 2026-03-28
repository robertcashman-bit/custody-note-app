/* ═══════════════════════════════════════════════════════
   BILLING VIEW — Top-level view for Documents & Billing
   Shows all records with billing status, filters, and
   launches the 3-step workflow for any selected record.
   Depends on: filenameUtils.js, billingUtils.js, workflow-stepper.js,
               app.js globals (showToast, safeJson, showView, formData, etc.)
   ═══════════════════════════════════════════════════════ */

var _billingViewData = [];
var _billingViewLoading = false;

function loadBillingView() {
  if (!window.api) return;

  var wrap = document.getElementById('billing-view-table-wrap');
  if (wrap) wrap.innerHTML = '<div class="bv-loading">Loading records&hellip;</div>';

  var summaryEl = document.getElementById('billing-view-summary');
  if (summaryEl) summaryEl.innerHTML = '';

  _billingViewLoading = true;

  var fetchFn = (window.api.billingViewRecords || window.api.billableAttendances);
  if (!fetchFn) { _billingViewLoading = false; return; }

  fetchFn().then(function (rows) {
    _billingViewData = (rows || []).map(function (r) {
      var d = (typeof safeJson === 'function') ? safeJson(r.data) : {};
      var hasInvoice = !!(r.quickfile_invoice_id);
      var invoiceSent = (d.invoiceSent === 'Yes');
      var hasAttachments = !!(d.photos && d.photos.attachments && d.photos.attachments.length);
      var attachCount = hasAttachments ? d.photos.attachments.length : 0;
      var allNamed = !hasAttachments || d.photos.attachments.every(function (a) { return !!a.documentType; });

      var status = 'needs_invoice';
      if (invoiceSent) status = 'sent';
      else if (hasInvoice) status = 'invoiced';
      else if (!hasAttachments || !allNamed) status = 'needs_documents';

      return {
        id: r.id,
        clientName: [d.forename, d.surname].filter(Boolean).join(' ') || r.client_name || '',
        firmName: d.firmName || '',
        stationName: d.policeStationName || r.station_name || '',
        date: d.date || r.attendance_date || '',
        attachCount: attachCount,
        allNamed: allNamed,
        hasInvoice: hasInvoice,
        invoiceNumber: r.quickfile_invoice_number || '',
        invoiceSent: invoiceSent,
        status: status,
        raw: d,
        recordStatus: r.status,
      };
    });

    _billingViewLoading = false;
    _bvPopulateFirmFilter();
    _bvRenderSummary();
    _bvRenderTable();
    _bvBindFilters();
  }).catch(function () {
    _billingViewLoading = false;
    if (wrap) wrap.innerHTML = '<div class="bv-empty">Could not load records.</div>';
  });
}

function _bvEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _bvFmtDate(val) {
  if (!val) return '';
  var m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : val;
}

function _bvPopulateFirmFilter() {
  var sel = document.getElementById('bv-firm-filter');
  if (!sel) return;
  var firms = {};
  _billingViewData.forEach(function (r) { if (r.firmName) firms[r.firmName] = true; });
  sel.innerHTML = '<option value="">All firms</option>';
  Object.keys(firms).sort().forEach(function (f) {
    sel.innerHTML += '<option value="' + _bvEsc(f) + '">' + _bvEsc(f) + '</option>';
  });
}

function _bvFilterData() {
  var search = (document.getElementById('bv-search') || {}).value || '';
  search = search.toLowerCase().trim();
  var firmFilter = (document.getElementById('bv-firm-filter') || {}).value || '';
  var statusFilter = (document.getElementById('bv-status-filter') || {}).value || '';
  var dateFrom = (document.getElementById('bv-date-from') || {}).value || '';
  var dateTo = (document.getElementById('bv-date-to') || {}).value || '';

  return _billingViewData.filter(function (r) {
    if (search) {
      var hay = (r.clientName + ' ' + r.firmName + ' ' + r.stationName + ' ' + r.invoiceNumber).toLowerCase();
      if (hay.indexOf(search) === -1) return false;
    }
    if (firmFilter && r.firmName !== firmFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    return true;
  });
}

function _bvRenderSummary() {
  var el = document.getElementById('billing-view-summary');
  if (!el) return;
  var total = _billingViewData.length;
  var needsDocs = _billingViewData.filter(function (r) { return r.status === 'needs_documents'; }).length;
  var needsInvoice = _billingViewData.filter(function (r) { return r.status === 'needs_invoice'; }).length;
  var invoiced = _billingViewData.filter(function (r) { return r.status === 'invoiced'; }).length;
  var sent = _billingViewData.filter(function (r) { return r.status === 'sent'; }).length;

  el.innerHTML =
    '<div class="bv-summary-item"><span class="bv-summary-num">' + total + '</span><span class="bv-summary-label">Total</span></div>' +
    '<div class="bv-summary-item bv-summary-warn"><span class="bv-summary-num">' + needsDocs + '</span><span class="bv-summary-label">Needs docs</span></div>' +
    '<div class="bv-summary-item bv-summary-warn"><span class="bv-summary-num">' + needsInvoice + '</span><span class="bv-summary-label">Needs invoice</span></div>' +
    '<div class="bv-summary-item bv-summary-ok"><span class="bv-summary-num">' + invoiced + '</span><span class="bv-summary-label">Invoiced</span></div>' +
    '<div class="bv-summary-item bv-summary-done"><span class="bv-summary-num">' + sent + '</span><span class="bv-summary-label">Sent</span></div>';

  var badge = document.getElementById('billing-nav-badge');
  var actionCount = needsDocs + needsInvoice;
  if (badge) {
    if (actionCount > 0) {
      badge.textContent = String(actionCount);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
}

function _bvStatusBadge(status) {
  var map = {
    needs_documents: '<span class="bv-badge bv-badge--docs">Needs docs</span>',
    needs_invoice: '<span class="bv-badge bv-badge--invoice">Needs invoice</span>',
    invoiced: '<span class="bv-badge bv-badge--invoiced">Invoiced</span>',
    sent: '<span class="bv-badge bv-badge--sent">Sent</span>',
  };
  return map[status] || '<span class="bv-badge">—</span>';
}

function _bvRenderTable() {
  var wrap = document.getElementById('billing-view-table-wrap');
  if (!wrap) return;

  var filtered = _bvFilterData();

  if (!filtered.length) {
    wrap.innerHTML = '<div class="bv-empty">No records match the current filters.</div>';
    return;
  }

  filtered.sort(function (a, b) {
    if (a.date > b.date) return -1;
    if (a.date < b.date) return 1;
    return 0;
  });

  var html =
    '<table class="bv-table">' +
      '<thead><tr>' +
        '<th>Client</th>' +
        '<th>Station</th>' +
        '<th>Date</th>' +
        '<th>Firm</th>' +
        '<th>Attachments</th>' +
        '<th>Invoice</th>' +
        '<th>Status</th>' +
        '<th>Action</th>' +
      '</tr></thead><tbody>';

  filtered.forEach(function (r) {
    var invText = r.invoiceNumber ? '#' + _bvEsc(r.invoiceNumber) : '—';
    html += '<tr class="bv-row" data-record-id="' + r.id + '">' +
      '<td class="bv-cell-client">' + _bvEsc(r.clientName) + '</td>' +
      '<td>' + _bvEsc(r.stationName) + '</td>' +
      '<td>' + _bvEsc(_bvFmtDate(r.date)) + '</td>' +
      '<td>' + _bvEsc(r.firmName) + '</td>' +
      '<td>' + r.attachCount + (r.allNamed ? '' : ' <span class="bv-att-warn">&#9888;</span>') + '</td>' +
      '<td>' + invText + '</td>' +
      '<td>' + _bvStatusBadge(r.status) + '</td>' +
      '<td><button type="button" class="btn btn-small btn-primary bv-open-workflow" data-record-id="' + r.id + '">Open</button></td>' +
    '</tr>';
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('.bv-open-workflow').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var rid = btn.getAttribute('data-record-id');
      _bvOpenWorkflowForRecord(rid);
    });
  });

  wrap.querySelectorAll('.bv-row').forEach(function (row) {
    row.addEventListener('click', function () {
      var rid = row.getAttribute('data-record-id');
      _bvOpenWorkflowForRecord(rid);
    });
  });
}

function _bvOpenWorkflowForRecord(recordId) {
  if (!recordId || !window.api || !window.api.attendanceGet) {
    showToast('Cannot load record', 'error');
    return;
  }

  window.api.attendanceGet(parseInt(recordId, 10) || recordId).then(function (record) {
    if (!record) { showToast('Record not found', 'error'); return; }
    var d = (typeof safeJson === 'function') ? safeJson(record.data) : {};

    if (typeof window.formData !== 'undefined') {
      window.formData = d;
    }
    if (typeof formData !== 'undefined') {
      for (var k in formData) { if (formData.hasOwnProperty(k)) delete formData[k]; }
      for (var k2 in d) { if (d.hasOwnProperty(k2)) formData[k2] = d[k2]; }
    }
    window.currentAttendanceId = parseInt(recordId, 10) || recordId;

    if (typeof openWorkflow === 'function') {
      openWorkflow(0, function () { loadBillingView(); });
    } else if (typeof openBillingPanel === 'function') {
      openBillingPanel();
    }
  }).catch(function (err) {
    showToast('Failed to load record: ' + (err && err.message || ''), 'error');
  });
}

var _bvFiltersWired = false;
function _bvBindFilters() {
  if (_bvFiltersWired) return;
  _bvFiltersWired = true;

  ['bv-search', 'bv-firm-filter', 'bv-status-filter', 'bv-date-from', 'bv-date-to'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', function () { _bvRenderTable(); });
      el.addEventListener('change', function () { _bvRenderTable(); });
    }
  });

  var backBtn = document.getElementById('billing-view-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', function () { showView('home'); });
  }
}
