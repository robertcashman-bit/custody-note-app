/* ═══════════════════════════════════════════════════════
   BILLING VIEW — Top-level view for Documents & Billing
   Shows all records with billing status, filters, and
   launches the 3-step workflow for any selected record.
   Depends on: filenameUtils.js, billingUtils.js, workflow-stepper.js,
               app.js globals (showToast, safeJson, showView, formData, etc.)
   ═══════════════════════════════════════════════════════ */

var _billingViewData = [];
var _billingViewLoading = false;

var BV_LS_PREFIX = 'cn_bv_';
function _bvPersistFilters() {
  try {
    var s = document.getElementById('bv-search');
    var f = document.getElementById('bv-firm-filter');
    var st = document.getElementById('bv-status-filter');
    var df = document.getElementById('bv-date-from');
    var dt = document.getElementById('bv-date-to');
    if (s) localStorage.setItem(BV_LS_PREFIX + 'search', s.value || '');
    if (f) localStorage.setItem(BV_LS_PREFIX + 'firm', f.value || '');
    if (st) localStorage.setItem(BV_LS_PREFIX + 'status', st.value || '');
    if (df) localStorage.setItem(BV_LS_PREFIX + 'dateFrom', df.value || '');
    if (dt) localStorage.setItem(BV_LS_PREFIX + 'dateTo', dt.value || '');
  } catch (_) {}
}
function _bvRestoreFilters() {
  try {
    var s = document.getElementById('bv-search');
    var f = document.getElementById('bv-firm-filter');
    var st = document.getElementById('bv-status-filter');
    var df = document.getElementById('bv-date-from');
    var dt = document.getElementById('bv-date-to');
    if (s && localStorage.getItem(BV_LS_PREFIX + 'search') != null) s.value = localStorage.getItem(BV_LS_PREFIX + 'search') || '';
    if (f) {
      var fv = localStorage.getItem(BV_LS_PREFIX + 'firm') || '';
      if (fv && Array.prototype.some.call(f.options, function (o) { return o.value === fv; })) f.value = fv;
    }
    if (st) {
      var sv = localStorage.getItem(BV_LS_PREFIX + 'status') || '';
      if (!sv || Array.prototype.some.call(st.options, function (o) { return o.value === sv; })) st.value = sv;
    }
    if (df) df.value = localStorage.getItem(BV_LS_PREFIX + 'dateFrom') || '';
    if (dt) dt.value = localStorage.getItem(BV_LS_PREFIX + 'dateTo') || '';
  } catch (_) {}
}

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
    var defaults = window._billingDefaults || (typeof BILLING_DEFAULTS !== 'undefined' ? BILLING_DEFAULTS : { fixedFee: 160, mileageRate: 0.45, vatRate: 0.20 });
    _billingViewData = (rows || []).map(function (r) {
      var d = (typeof safeJson === 'function') ? safeJson(r.data) : {};
      var hasInvoice = !!(r.quickfile_invoice_id);
      var hasAttachments = !!(d.photos && d.photos.attachments && d.photos.attachments.length);
      var attachCount = hasAttachments ? d.photos.attachments.length : 0;
      var allNamed = !hasAttachments || d.photos.attachments.every(function (a) { return !!a.documentType; });

      var status = 'needs_invoice';
      if (hasInvoice) status = 'invoiced';
      else if (!hasAttachments || !allNamed) status = 'needs_documents';

      /* Projected total: prefer stored invoice_total when invoiced, otherwise compute
         from defaults + record values so the figure tracks live charge-out rates. */
      var projectedTotal = 0;
      if (hasInvoice && r.invoice_total != null) {
        projectedTotal = Number(r.invoice_total) || 0;
      } else {
        var fee = defaults.fixedFee;
        var miles = parseFloat(d.milesClaimable) || 0;
        var mileage = miles * defaults.mileageRate;
        var parking = parseFloat(d.parkingCost) || 0;
        var sub = fee + mileage + parking;
        projectedTotal = sub * (1 + defaults.vatRate);
      }

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
        status: status,
        projectedTotal: projectedTotal,
        raw: d,
        recordStatus: r.status,
      };
    });

    _billingViewLoading = false;
    console.log('[billing-view] Loaded ' + _billingViewData.length + ' records');
    _bvPopulateFirmFilter();
    _bvRestoreFilters();
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

/** Stamp billing/office completion times on matter data (same as workflow Step 3 archive path). */
function _bvStampCompletionTimes(data) {
  var d = data || {};
  var iso = new Date().toISOString();
  if (!d.billingProcessCompletedAt) d.billingProcessCompletedAt = iso;
  if (!d.officeWorkCompletedAt) d.officeWorkCompletedAt = iso;
  return d;
}

function _bvCloseMatter(recordId, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  var id = parseInt(recordId, 10);
  if (!id || !window.api || !window.api.attendanceGet || !window.api.attendanceSave) {
    showToast('Cannot update record', 'error');
    return;
  }
  if (typeof showConfirm !== 'function') {
    showToast('Confirmation not available', 'error');
    return;
  }
  showConfirm(
    'Mark billing and office work complete for this matter? The record stays in your active list (not moved to Archived).',
    'Complete matter'
  ).then(function (ok) {
    if (!ok) return;
    window.api.attendanceGet(id).then(function (record) {
      if (!record) {
        showToast('Record not found', 'error');
        return Promise.reject(new Error('notfound'));
      }
      var st = record.status;
      if (st !== 'finalised' && st !== 'completed') {
        showToast('Finalise the attendance note before completing this matter.', 'error');
        return Promise.reject(new Error('status'));
      }
      var d = (typeof safeJson === 'function') ? safeJson(record.data) : {};
      _bvStampCompletionTimes(d);
      return window.api.attendanceSave({ id: id, data: d, status: 'completed' });
    }).then(function (result) {
      if (result && typeof result === 'object' && result.error) {
        showToast(result.message || result.error || 'Save failed', 'error', 7000);
        return;
      }
      showToast('Matter marked complete', 'success');
      loadBillingView();
      if (typeof window.updateHomeBillingWidget === 'function') window.updateHomeBillingWidget();
    }).catch(function (err) {
      if (err && (err.message === 'notfound' || err.message === 'status')) return;
      showToast('Failed to complete matter', 'error');
    });
  });
}

function _bvArchiveMatter(recordId, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  var id = parseInt(recordId, 10);
  if (!id || !window.api || !window.api.attendanceGet || !window.api.attendanceSave || !window.api.attendanceArchive) {
    showToast('Cannot archive record', 'error');
    return;
  }
  if (typeof showConfirm !== 'function') {
    showToast('Confirmation not available', 'error');
    return;
  }
  showConfirm(
    'Archive this matter? Billing and office completion will be recorded if not already saved, then the file moves to Archived.',
    'Archive record'
  ).then(function (ok) {
    if (!ok) return;
    window.api.attendanceGet(id).then(function (record) {
      if (!record) {
        showToast('Record not found', 'error');
        return Promise.reject(new Error('notfound'));
      }
      if (record.archived_at) {
        showToast('Record is already archived', 'info');
        return Promise.reject(new Error('archived'));
      }
      var st = record.status;
      if (st !== 'finalised' && st !== 'completed') {
        showToast('Finalise the attendance note before archiving.', 'error');
        return Promise.reject(new Error('status'));
      }
      var d = (typeof safeJson === 'function') ? safeJson(record.data) : {};
      _bvStampCompletionTimes(d);
      return window.api.attendanceSave({ id: id, data: d, status: 'completed' }).then(function (result) {
        if (result && typeof result === 'object' && result.error) {
          showToast(result.message || result.error || 'Save failed', 'error', 7000);
          return Promise.reject(new Error('save'));
        }
        return window.api.attendanceArchive(id);
      });
    }).then(function () {
      showToast('Record archived', 'info');
      loadBillingView();
      if (typeof window.updateHomeBillingWidget === 'function') window.updateHomeBillingWidget();
    }).catch(function (err) {
      if (err && (err.message === 'notfound' || err.message === 'archived' || err.message === 'status' || err.message === 'save')) return;
      showToast('Failed to archive record', 'error');
    });
  });
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

  /* Projected uninvoiced revenue across all matters that have not yet been invoiced
     (covers both needs_documents and needs_invoice). Replaces the old standalone
     "Billable Attendances" report card on the Reports screen. */
  var uninvoicedRevenue = _billingViewData
    .filter(function (r) { return !r.hasInvoice; })
    .reduce(function (acc, r) { return acc + (Number(r.projectedTotal) || 0); }, 0);
  var uninvoicedRevenueText = '\u00A3' + uninvoicedRevenue.toFixed(2);

  el.innerHTML =
    '<div class="bv-summary-item"><span class="bv-summary-num">' + total + '</span><span class="bv-summary-label">Total</span></div>' +
    '<div class="bv-summary-item bv-summary-warn"><span class="bv-summary-num">' + needsDocs + '</span><span class="bv-summary-label">Needs docs</span></div>' +
    '<div class="bv-summary-item bv-summary-warn"><span class="bv-summary-num">' + needsInvoice + '</span><span class="bv-summary-label">Needs invoice</span></div>' +
    '<div class="bv-summary-item bv-summary-ok"><span class="bv-summary-num">' + invoiced + '</span><span class="bv-summary-label">Invoiced</span></div>' +
    '<div class="bv-summary-item bv-summary-revenue" id="bv-summary-revenue" title="Projected revenue across matters not yet invoiced (incl. VAT)"><span class="bv-summary-num">' + uninvoicedRevenueText + '</span><span class="bv-summary-label">Uninvoiced revenue</span></div>';

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
  };
  return map[status] || '<span class="bv-badge">—</span>';
}

function _bvRenderTable() {
  var wrap = document.getElementById('billing-view-table-wrap');
  if (!wrap) return;

  var filtered = _bvFilterData();

  if (!filtered.length) {
    var msg = _billingViewData.length
      ? 'No records match the current filters.'
      : 'No billable records yet. Finalise and archive an attendance to see it here.';
    wrap.innerHTML = '<div class="bv-empty">' + msg + '</div>';
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
        '<th class="bv-th-actions">Actions</th>' +
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
      '<td class="bv-actions-cell">' +
        '<button type="button" class="btn btn-small btn-primary bv-open-workflow" data-record-id="' + r.id + '" title="Open documents &amp; billing workflow">Open</button>' +
        '<button type="button" class="btn btn-small btn-secondary bv-close-matter" data-record-id="' + r.id + '" title="Mark office work complete (stay in active records)">Close</button>' +
        '<button type="button" class="btn btn-small btn-secondary bv-archive-matter" data-record-id="' + r.id + '" title="Complete and move to Archived">Archive</button>' +
      '</td>' +
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

  wrap.querySelectorAll('.bv-close-matter').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      var rid = btn.getAttribute('data-record-id');
      _bvCloseMatter(rid, e);
    });
  });

  wrap.querySelectorAll('.bv-archive-matter').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      var rid = btn.getAttribute('data-record-id');
      _bvArchiveMatter(rid, e);
    });
  });

  wrap.querySelectorAll('.bv-actions-cell').forEach(function (cell) {
    cell.addEventListener('click', function (e) {
      e.stopPropagation();
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
    /* Mirror onto local globals if app.js scope exposes them, so the
     * Billing screen reads the right status/archived flags on entry. */
    try {
      if (typeof currentRecordStatus !== 'undefined') {
        window.currentRecordStatus = record.status || null;
      }
      if (typeof currentRecordArchived !== 'undefined') {
        window.currentRecordArchived = !!record.archived_at;
      }
    } catch (_e) { /* best-effort */ }

    /* Per-row "Open" from the Open-matters list now lands on the new
     * full-page Billing screen for that record (replaces the old modal
     * workflow overlay). The screen auto-mounts the workflow when the
     * matter is ready to bill. */
    if (typeof showView === 'function') {
      showView('matter-billing');
      return;
    }
    if (typeof openWorkflow === 'function') {
      openWorkflow(undefined, function () { loadBillingView(); });
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
      el.addEventListener('input', function () { _bvPersistFilters(); _bvRenderTable(); });
      el.addEventListener('change', function () { _bvPersistFilters(); _bvRenderTable(); });
    }
  });

  var backBtn = document.getElementById('billing-view-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', function () { if (typeof goBack === 'function') goBack(); else showView('home'); });
  }
}
