/* ═══════════════════════════════════════════════════════
   BILLING & GENERATED DOCUMENTS PANEL
   Full billing workflow: review docs → confirm → create invoice → email pack
   Depends on: showToast, esc, safeJson, getFormData, currentAttendanceId,
               formData, stations (app.js globals), window.api
   ═══════════════════════════════════════════════════════ */

var _billingPanelOpen = false;

function openBillingPanel() {
  if (_billingPanelOpen) return;
  _billingPanelOpen = true;

  var existing = document.getElementById('billing-panel-overlay');
  if (existing) existing.remove();

  var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
  var recordId = window.currentAttendanceId || null;

  var clientName = [data.forename, data.surname].filter(Boolean).join(' ') || '';
  var firmName = data.firmName || '';
  var stationName = data.policeStationName || '';
  var attendanceDate = data.date || data.instructionDateTime || '';
  if (attendanceDate && attendanceDate.length > 10) attendanceDate = attendanceDate.slice(0, 10);
  var offenceSummary = data.offenceSummary || data.offence1Details || '';

  var defaultAttendanceFee = 160.00;
  var defaultMileageRate = 0.45;
  var defaultVatRate = 0.20;
  var parkingFromRecord = parseFloat(data.parkingCost) || 0;
  var milesFromRecord = parseFloat(data.milesClaimable) || 0;

  var stationId = data.policeStationId || '';

  Promise.all([
    stationId && window.api && window.api.stationMileageGet ? window.api.stationMileageGet(stationId) : Promise.resolve(null),
    recordId && window.api && window.api.attendanceInvoiceStatus ? window.api.attendanceInvoiceStatus(recordId) : Promise.resolve({}),
    recordId && window.api && window.api.billingAuditLogGet ? window.api.billingAuditLogGet(recordId) : Promise.resolve([]),
  ]).then(function (results) {
    var stationMileage = results[0];
    var invoiceStatus = results[1] || {};
    var auditLog = results[2] || [];

    var hasExistingInvoice = !!(invoiceStatus.quickfile_invoice_id);

    if (stationMileage && stationMileage.mileage_from_base != null && !milesFromRecord) {
      milesFromRecord = stationMileage.mileage_from_base;
    }

    if (hasExistingInvoice && invoiceStatus.invoice_attendance_fee != null) {
      defaultAttendanceFee = invoiceStatus.invoice_attendance_fee;
    }
    if (hasExistingInvoice && invoiceStatus.invoice_mileage_miles != null) {
      milesFromRecord = invoiceStatus.invoice_mileage_miles;
    }
    if (hasExistingInvoice && invoiceStatus.invoice_mileage_rate != null) {
      defaultMileageRate = invoiceStatus.invoice_mileage_rate;
    }
    if (hasExistingInvoice && invoiceStatus.invoice_parking_amount != null) {
      parkingFromRecord = invoiceStatus.invoice_parking_amount;
    }
    if (hasExistingInvoice && invoiceStatus.invoice_vat_rate != null) {
      defaultVatRate = invoiceStatus.invoice_vat_rate;
    }

    var narrative = _buildInvoiceNarrative(clientName, stationName, attendanceDate, offenceSummary);
    if (hasExistingInvoice && invoiceStatus.invoice_narrative) {
      narrative = invoiceStatus.invoice_narrative;
    }

    _renderBillingPanel(data, recordId, {
      clientName: clientName,
      firmName: firmName,
      stationName: stationName,
      attendanceDate: attendanceDate,
      offenceSummary: offenceSummary,
      attendanceFee: defaultAttendanceFee,
      mileageMiles: milesFromRecord,
      mileageRate: defaultMileageRate,
      parkingAmount: parkingFromRecord,
      vatRate: defaultVatRate,
      narrative: narrative,
      invoiceStatus: invoiceStatus,
      hasExistingInvoice: hasExistingInvoice,
      auditLog: auditLog,
    });
  }).catch(function () {
    _renderBillingPanel(data, recordId, {
      clientName: clientName,
      firmName: firmName,
      stationName: stationName,
      attendanceDate: attendanceDate,
      offenceSummary: offenceSummary,
      attendanceFee: defaultAttendanceFee,
      mileageMiles: milesFromRecord,
      mileageRate: defaultMileageRate,
      parkingAmount: parkingFromRecord,
      vatRate: defaultVatRate,
      narrative: _buildInvoiceNarrative(clientName, stationName, attendanceDate, offenceSummary),
      invoiceStatus: {},
      hasExistingInvoice: false,
      auditLog: [],
    });
  });
}

function _buildInvoiceNarrative(client, station, date, offence) {
  var dateFmt = '';
  if (date) {
    var parts = date.split('-');
    if (parts.length === 3) dateFmt = parts[2] + '.' + parts[1] + '.' + parts[0].slice(2);
  }
  return ['Police Station Attendance Fixed Fee', client, station, dateFmt, offence]
    .map(function (s) { return (s || '').trim(); })
    .filter(Boolean)
    .join(' \u2013 ');
}

function _escAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _fmtCurrency(val) {
  return '\u00A3' + (parseFloat(val) || 0).toFixed(2);
}

function _getGeneratedDocuments(data) {
  var docs = [];
  docs.push({ name: 'Attendance Note PDF', type: 'attendance', available: true });
  if (data.conflictCheckResult) docs.push({ name: 'Conflict Check Certificate', type: 'conflict', available: true });
  if (data.clientInstructions) docs.push({ name: 'Client Instructions Document', type: 'instructions', available: true });
  if (data.preparedStatement) docs.push({ name: 'Prepared Statement', type: 'statement', available: true });
  if (data.officerEmailStatus === 'sent') docs.push({ name: 'Officer Email Copy', type: 'email', available: true });
  if (data.disclosure || data.disclosureSummary) docs.push({ name: 'Disclosure Summary', type: 'disclosure', available: true });
  if (data.interviews && data.interviews.length) docs.push({ name: 'Interview Notes', type: 'interview', available: true });
  if (data.bailConditions || data.bailDate) docs.push({ name: 'Bail Advice Letter', type: 'bail', available: true });
  return docs;
}

function _renderBillingPanel(data, recordId, opts) {
  var stale = document.getElementById('billing-panel-overlay');
  if (stale) stale.remove();

  var docs = _getGeneratedDocuments(data);

  var docsHtml = '';
  if (docs.length) {
    docsHtml = '<table class="billing-docs-table"><thead><tr>' +
      '<th>Document</th><th>Preview</th><th>Include</th>' +
      '</tr></thead><tbody>';
    docs.forEach(function (doc, idx) {
      docsHtml += '<tr>' +
        '<td>' + _escHtml(doc.name) + '</td>' +
        '<td><button type="button" class="btn btn-small billing-doc-preview" data-doc-type="' + doc.type + '">Preview</button></td>' +
        '<td><input type="checkbox" class="billing-doc-include" data-doc-idx="' + idx + '" checked></td>' +
        '</tr>';
    });
    docsHtml += '</tbody></table>';
  } else {
    docsHtml = '<p class="settings-hint">No generated documents found for this record.</p>';
  }

  var invoiceStatusHtml = '';
  if (opts.hasExistingInvoice) {
    invoiceStatusHtml =
      '<div class="billing-status-badge billing-status-invoiced">Invoiced</div>' +
      '<div class="billing-status-detail">' +
        '<span>Invoice #: <strong>' + _escHtml(opts.invoiceStatus.quickfile_invoice_number) + '</strong></span>' +
        (opts.invoiceStatus.quickfile_invoice_url
          ? ' <a href="#" class="billing-invoice-link" data-url="' + _escAttr(opts.invoiceStatus.quickfile_invoice_url) + '">View in QuickFile</a>'
          : '') +
        '<br><span class="settings-hint">Created: ' + _escHtml(opts.invoiceStatus.invoice_created_at || '') +
        (opts.invoiceStatus.invoice_created_by ? ' by ' + _escHtml(opts.invoiceStatus.invoice_created_by) : '') +
        '</span>' +
      '</div>';
  } else {
    invoiceStatusHtml = '<div class="billing-status-badge billing-status-not-invoiced">Not Invoiced</div>';
  }

  var mileageCost = (opts.mileageMiles || 0) * (opts.mileageRate || 0.45);
  var subtotal = (opts.attendanceFee || 0) + mileageCost + (opts.parkingAmount || 0);
  var vatAmt = subtotal * (opts.vatRate || 0.20);
  var total = subtotal + vatAmt;

  var auditHtml = '';
  if (opts.auditLog && opts.auditLog.length) {
    auditHtml = '<details class="billing-audit-details"><summary>Billing History (' + opts.auditLog.length + ' entries)</summary><div class="billing-audit-list">';
    opts.auditLog.forEach(function (entry) {
      auditHtml += '<div class="billing-audit-entry">' +
        '<span class="billing-audit-time">' + _escHtml(entry.timestamp) + '</span> ' +
        '<span class="billing-audit-action">' + _escHtml(entry.action) + '</span> ' +
        '<span class="billing-audit-user">' + _escHtml(entry.user_name || '') + '</span>' +
        (entry.details ? '<div class="billing-audit-detail">' + _escHtml(entry.details) + '</div>' : '') +
        '</div>';
    });
    auditHtml += '</div></details>';
  }

  var html =
    '<div id="billing-panel-overlay" class="billing-overlay" role="dialog" aria-modal="true" aria-label="Billing &amp; Generated Documents">' +
      '<div class="billing-panel">' +
        '<div class="billing-panel-header">' +
          '<h2 class="billing-panel-title">&#163; Billing &amp; Generated Documents</h2>' +
          '<button type="button" class="billing-panel-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="billing-panel-body">' +

          '<div class="billing-section">' +
            '<h3>Matter Details</h3>' +
            '<div class="billing-detail-grid">' +
              '<div><span class="billing-label">Firm</span><span class="billing-value">' + _escHtml(opts.firmName) + '</span></div>' +
              '<div><span class="billing-label">Client</span><span class="billing-value">' + _escHtml(opts.clientName) + '</span></div>' +
              '<div><span class="billing-label">Police Station</span><span class="billing-value">' + _escHtml(opts.stationName) + '</span></div>' +
              '<div><span class="billing-label">Attendance Date</span><span class="billing-value">' + _escHtml(opts.attendanceDate) + '</span></div>' +
              '<div style="grid-column:1/-1;"><span class="billing-label">Offence Summary</span><span class="billing-value">' + _escHtml(opts.offenceSummary) + '</span></div>' +
            '</div>' +
          '</div>' +

          '<div class="billing-section">' +
            '<h3>Generated Documents</h3>' +
            docsHtml +
          '</div>' +

          '<div class="billing-section">' +
            '<h3>Billing Preview</h3>' +
            '<div class="billing-edit-grid">' +
              '<div class="billing-edit-row">' +
                '<label for="billing-attendance-fee">Attendance Fee (&pound;)</label>' +
                '<input type="number" id="billing-attendance-fee" class="form-input billing-calc-input" value="' + (opts.attendanceFee || 160).toFixed(2) + '" step="0.01">' +
              '</div>' +
              '<div class="billing-edit-row">' +
                '<label for="billing-mileage-miles">Mileage (miles)</label>' +
                '<input type="number" id="billing-mileage-miles" class="form-input billing-calc-input" value="' + (opts.mileageMiles || 0) + '" step="0.1">' +
              '</div>' +
              '<div class="billing-edit-row">' +
                '<label for="billing-mileage-rate">Mileage Rate (&pound;/mile)</label>' +
                '<input type="number" id="billing-mileage-rate" class="form-input billing-calc-input" value="' + (opts.mileageRate || 0.45).toFixed(2) + '" step="0.01">' +
              '</div>' +
              '<div class="billing-edit-row">' +
                '<label for="billing-parking">Parking / Disbursements (&pound;)</label>' +
                '<input type="number" id="billing-parking" class="form-input billing-calc-input" value="' + (opts.parkingAmount || 0).toFixed(2) + '" step="0.01">' +
              '</div>' +
              '<div class="billing-edit-row">' +
                '<label for="billing-vat-rate">VAT Rate (%)</label>' +
                '<input type="number" id="billing-vat-rate" class="form-input billing-calc-input" value="' + ((opts.vatRate || 0.20) * 100).toFixed(0) + '" step="1">' +
              '</div>' +
            '</div>' +
            '<div class="billing-totals">' +
              '<div class="billing-total-row"><span>Subtotal</span><span id="billing-subtotal">' + _fmtCurrency(subtotal) + '</span></div>' +
              '<div class="billing-total-row"><span>VAT</span><span id="billing-vat">' + _fmtCurrency(vatAmt) + '</span></div>' +
              '<div class="billing-total-row billing-total-final"><span>Total</span><span id="billing-total">' + _fmtCurrency(total) + '</span></div>' +
            '</div>' +
          '</div>' +

          '<div class="billing-section">' +
            '<h3>Invoice Narrative</h3>' +
            '<textarea id="billing-narrative" class="form-input billing-narrative-input" rows="3">' + _escHtml(opts.narrative) + '</textarea>' +
          '</div>' +

          '<div class="billing-section">' +
            '<h3>QuickFile Status</h3>' +
            invoiceStatusHtml +
          '</div>' +

          '<div class="billing-section">' +
            '<h3>Review Confirmation</h3>' +
            '<div class="billing-checklist">' +
              '<label class="billing-check-item"><input type="checkbox" id="billing-check-attendance"> Attendance note reviewed</label>' +
              '<label class="billing-check-item"><input type="checkbox" id="billing-check-docs"> Generated documents reviewed</label>' +
              '<label class="billing-check-item"><input type="checkbox" id="billing-check-billing"> Billing details confirmed</label>' +
            '</div>' +
          '</div>' +

          auditHtml +

        '</div>' +

        '<div class="billing-panel-footer">' +
          '<button type="button" id="billing-create-invoice" class="btn btn-primary btn-billing-create" disabled>' +
            (opts.hasExistingInvoice ? '&#9888; Create Another Invoice' : 'Create QuickFile Invoice') +
          '</button>' +
          (opts.hasExistingInvoice
            ? '<button type="button" id="billing-email-pack" class="btn btn-secondary">Prepare Email to Firm</button>'
            : '') +
          '<button type="button" id="billing-cancel" class="btn btn-secondary">Close</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', html);
  _bindBillingEvents(recordId, opts);
}

function _bindBillingEvents(recordId, opts) {
  var overlay = document.getElementById('billing-panel-overlay');
  if (!overlay) return;

  overlay.querySelector('.billing-panel-close').addEventListener('click', closeBillingPanel);
  document.getElementById('billing-cancel').addEventListener('click', closeBillingPanel);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeBillingPanel(); });

  function onKeyDown(e) {
    if (e.key === 'Escape') { closeBillingPanel(); document.removeEventListener('keydown', onKeyDown); }
  }
  document.addEventListener('keydown', onKeyDown);

  overlay.querySelectorAll('.billing-calc-input').forEach(function (inp) {
    inp.addEventListener('input', _recalcBillingTotals);
  });

  var checkboxes = overlay.querySelectorAll('.billing-checklist input[type="checkbox"]');
  var createBtn = document.getElementById('billing-create-invoice');
  function updateCreateBtn() {
    var allChecked = true;
    checkboxes.forEach(function (cb) { if (!cb.checked) allChecked = false; });
    createBtn.disabled = !allChecked;
  }
  checkboxes.forEach(function (cb) { cb.addEventListener('change', updateCreateBtn); });

  createBtn.addEventListener('click', function () {
    _handleCreateInvoice(recordId, opts);
  });

  overlay.querySelectorAll('.billing-doc-preview').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var docType = btn.getAttribute('data-doc-type');
      _previewDocument(docType);
    });
  });

  overlay.querySelectorAll('.billing-invoice-link').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var url = link.getAttribute('data-url');
      if (url && window.api && window.api.openExternal) window.api.openExternal(url);
    });
  });

  var emailPackBtn = document.getElementById('billing-email-pack');
  if (emailPackBtn) {
    emailPackBtn.addEventListener('click', function () {
      _openEmailPackModal(recordId, opts);
    });
  }
}

function _recalcBillingTotals() {
  var fee = parseFloat(document.getElementById('billing-attendance-fee').value) || 0;
  var miles = parseFloat(document.getElementById('billing-mileage-miles').value) || 0;
  var rate = parseFloat(document.getElementById('billing-mileage-rate').value) || 0;
  var parking = parseFloat(document.getElementById('billing-parking').value) || 0;
  var vatPct = parseFloat(document.getElementById('billing-vat-rate').value) || 0;
  var vatRate = vatPct / 100;

  var mileageCost = miles * rate;
  var subtotal = fee + mileageCost + parking;
  var vat = subtotal * vatRate;
  var total = subtotal + vat;

  var subEl = document.getElementById('billing-subtotal');
  var vatEl = document.getElementById('billing-vat');
  var totEl = document.getElementById('billing-total');
  if (subEl) subEl.textContent = _fmtCurrency(subtotal);
  if (vatEl) vatEl.textContent = _fmtCurrency(vat);
  if (totEl) totEl.textContent = _fmtCurrency(total);
}

function _handleCreateInvoice(recordId, opts) {
  if (!recordId) {
    showToast('Save the record first before creating an invoice', 'error');
    return;
  }

  var fee = parseFloat(document.getElementById('billing-attendance-fee').value) || 0;
  var miles = parseFloat(document.getElementById('billing-mileage-miles').value) || 0;
  var rate = parseFloat(document.getElementById('billing-mileage-rate').value) || 0;
  var parking = parseFloat(document.getElementById('billing-parking').value) || 0;
  var vatPct = parseFloat(document.getElementById('billing-vat-rate').value) || 0;
  var vatRate = vatPct / 100;
  var narrative = document.getElementById('billing-narrative').value.trim();

  if (opts.hasExistingInvoice) {
    if (!confirm('This record already has an invoice (' + (opts.invoiceStatus.quickfile_invoice_number || 'unknown') + ').\n\nAre you sure you want to create another invoice?')) {
      return;
    }
  }

  if (!opts.firmName) {
    showToast('No firm name found — cannot create invoice', 'error');
    return;
  }

  var createBtn = document.getElementById('billing-create-invoice');
  createBtn.disabled = true;
  createBtn.textContent = 'Creating invoice...';

  var settings = window._appSettingsCache || {};
  var userName = settings.feeEarnerNameDefault || settings.feeEarnerName || '';
  var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
  var firmEmail = '';
  if (data.firmId && window.firms) {
    var firm = window.firms.find(function (f) { return String(f.id) === String(data.firmId); });
    if (firm) firmEmail = firm.contact_email || '';
  }

  window.api.quickfileCreateInvoice({
    attendanceId: recordId,
    firmName: opts.firmName,
    contactEmail: firmEmail,
    attendanceFee: fee,
    mileageMiles: miles,
    mileageRate: rate,
    parkingAmount: parking,
    vatRate: vatRate,
    narrative: narrative,
    invoiceDate: opts.attendanceDate || new Date().toISOString().slice(0, 10),
    userName: userName,
  }).then(function (result) {
    if (result.ok) {
      if (typeof formData === 'object' && formData) {
        formData.quickfileInvoiceNumber = result.invoiceNumber || '';
        formData.quickfileInvoiceUrl = result.invoiceUrl || '';
      }
      showToast('Invoice created: ' + (result.invoiceNumber || result.invoiceId), 'success');
      if (typeof updateBillingReadinessPanel === 'function') updateBillingReadinessPanel();
      if (typeof updateContextBar === 'function') updateContextBar();
      closeBillingPanel();
      if (window.api && window.api.billingAuditLogAdd) {
        window.api.billingAuditLogAdd({
          attendanceId: recordId,
          action: 'invoice_created',
          details: JSON.stringify({ invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber, total: result.total }),
          userName: userName,
        });
      }
      setTimeout(function () { openBillingPanel(); }, 300);
    } else {
      showToast('Invoice creation failed: ' + (result.error || 'Unknown error'), 'error');
      createBtn.disabled = false;
      createBtn.textContent = 'Create QuickFile Invoice';
    }
  }).catch(function (err) {
    showToast('Invoice creation failed: ' + (err.message || String(err)), 'error');
    createBtn.disabled = false;
    createBtn.textContent = 'Create QuickFile Invoice';
  });
}

function _previewDocument(docType) {
  if (typeof ensureAllSectionsRendered === 'function') ensureAllSectionsRendered();
  var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});

  if (window.api && window.api.billingAuditLogAdd && window.currentAttendanceId) {
    window.api.billingAuditLogAdd({
      attendanceId: window.currentAttendanceId,
      action: 'document_previewed',
      details: docType,
      userName: (window._appSettingsCache || {}).feeEarnerNameDefault || '',
    });
  }

  window.api.getSettings().then(function (settings) {
    var html = '';
    if (docType === 'attendance') {
      var builder = (typeof getActivePdfBuilder === 'function') ? getActivePdfBuilder() : (typeof buildPdfHtml === 'function' ? buildPdfHtml : null);
      if (builder) html = builder(data, settings);
    } else if (docType === 'conflict' && typeof generateConflictCert === 'function') {
      generateConflictCert();
      return;
    } else if (docType === 'instructions' && typeof generateClientInstructionsDoc === 'function') {
      generateClientInstructionsDoc();
      return;
    } else if (docType === 'statement' && typeof generatePreparedStatement === 'function') {
      generatePreparedStatement();
      return;
    } else if (docType === 'interview') {
      var builder2 = (typeof getActivePdfBuilder === 'function') ? getActivePdfBuilder() : null;
      if (builder2) html = builder2(data, settings);
    } else {
      var builder3 = (typeof getActivePdfBuilder === 'function') ? getActivePdfBuilder() : null;
      if (builder3) html = builder3(data, settings);
    }
    if (html && typeof printGeneratedDoc === 'function') {
      printGeneratedDoc(html);
    }
  });
}

function _openEmailPackModal(recordId, opts) {
  var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});

  var firmEmail = '';
  if (data.firmId && window.firms) {
    var firm = window.firms.find(function (f) { return String(f.id) === String(data.firmId); });
    if (firm) firmEmail = firm.contact_email || '';
  }

  var stale = document.getElementById('billing-email-modal');
  if (stale) stale.remove();

  var subject = 'Police Station Attendance Invoice \u2013 ' +
    [data.forename, data.surname].filter(Boolean).join(' ') + ' \u2013 ' +
    (opts.stationName || '') + ' \u2013 ' + (opts.attendanceDate || '');

  var body = 'Dear Sir/Madam,\n\nPlease find attached our invoice for the above police station attendance.\n\n' +
    'Invoice Number: ' + (opts.invoiceStatus.quickfile_invoice_number || '') + '\n' +
    'Amount: ' + _fmtCurrency(opts.invoiceStatus.invoice_total || 0) + '\n\n' +
    'Please do not hesitate to contact us if you have any queries.\n\nKind regards';

  var html =
    '<div id="billing-email-modal" class="billing-overlay" role="dialog" aria-modal="true" aria-label="Email to Firm">' +
      '<div class="billing-panel" style="max-width:600px;">' +
        '<div class="billing-panel-header">' +
          '<h2 class="billing-panel-title">&#9993; Prepare Email to Firm</h2>' +
          '<button type="button" class="billing-panel-close billing-email-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="billing-panel-body">' +
          '<div class="billing-section">' +
            '<label class="billing-label" for="billing-email-to">To</label>' +
            '<input type="email" id="billing-email-to" class="form-input" value="' + _escAttr(firmEmail) + '" placeholder="Firm contact email">' +
            '<label class="billing-label" for="billing-email-subject" style="margin-top:0.5rem;">Subject</label>' +
            '<input type="text" id="billing-email-subject" class="form-input" value="' + _escAttr(subject) + '">' +
            '<label class="billing-label" for="billing-email-body" style="margin-top:0.5rem;">Message</label>' +
            '<textarea id="billing-email-body" class="form-input" rows="10">' + _escHtml(body) + '</textarea>' +
          '</div>' +
        '</div>' +
        '<div class="billing-panel-footer">' +
          '<button type="button" id="billing-email-open" class="btn btn-primary">Open Email App</button>' +
          '<button type="button" id="billing-email-copy" class="btn btn-secondary">Copy Email</button>' +
          '<button type="button" class="btn btn-secondary billing-email-close">Cancel</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', html);

  document.querySelectorAll('.billing-email-close').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var m = document.getElementById('billing-email-modal');
      if (m) m.remove();
    });
  });

  document.getElementById('billing-email-open').addEventListener('click', function () {
    var to = document.getElementById('billing-email-to').value.trim();
    var subj = document.getElementById('billing-email-subject').value.trim();
    var b = document.getElementById('billing-email-body').value;
    var mailto = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(b);
    if (window.api && window.api.openExternal) window.api.openExternal(mailto);

    if (window.api && window.api.billingAuditLogAdd && recordId) {
      window.api.billingAuditLogAdd({
        attendanceId: recordId,
        action: 'email_prepared',
        details: 'Sent to: ' + to,
        userName: (window._appSettingsCache || {}).feeEarnerNameDefault || '',
      });
    }
  });

  document.getElementById('billing-email-copy').addEventListener('click', function () {
    var b = document.getElementById('billing-email-body').value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(b).then(function () {
        showToast('Email copied to clipboard', 'success');
      });
    }
  });
}

function closeBillingPanel() {
  _billingPanelOpen = false;
  var overlay = document.getElementById('billing-panel-overlay');
  if (overlay) overlay.remove();
}
