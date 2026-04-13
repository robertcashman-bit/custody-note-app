/* ═══════════════════════════════════════════════════════
   BILLING SCREEN (Workflow Step 2)
   Invoice details, charges, QuickFile preview, document
   selection for attachment, and invoice generation.
   Rendered inside #wf-body by workflow-stepper.js.
   Depends on: filenameUtils.js, billingUtils.js, workflow-stepper.js,
               billing.js (_handleCreateInvoice, _previewDocument),
               documents-screen.js (_wfGeneratedDocs),
               app.js globals
   ═══════════════════════════════════════════════════════ */

var _wfBillingOpts = null;
var _wfSelectedDocs = {};

function _wfRenderBillingStep(body, footer) {
  var meta = _wfMatterMeta();
  var data = meta.data;
  var recordId = meta.recordId;
  var stationId = data.policeStationId || '';

  var billingSettings = (window._billingDefaults || {});
  var fee = billingSettings.attendanceFee || BILLING_DEFAULTS.fixedFee;
  var mileageRate = billingSettings.mileageRate || BILLING_DEFAULTS.mileageRate;
  var vatRate = billingSettings.vatRate || BILLING_DEFAULTS.vatRate;
  var parking = parseFloat(data.parkingCost) || 0;
  var miles = parseFloat(data.milesClaimable) || 0;

  body.innerHTML = '<div class="wf-loading">Loading billing data&hellip;</div>';
  footer.innerHTML = '';

  Promise.all([
    stationId && window.api && window.api.stationMileageGet ? window.api.stationMileageGet(stationId) : Promise.resolve(null),
    recordId && window.api && window.api.attendanceInvoiceStatus ? window.api.attendanceInvoiceStatus(recordId) : Promise.resolve({}),
    recordId && window.api && window.api.billingAuditLogGet ? window.api.billingAuditLogGet(recordId) : Promise.resolve([]),
  ]).then(function (results) {
    var stationMileage = results[0];
    var invoiceStatus = results[1] || {};
    var auditLog = results[2] || [];
    var hasExisting = !!(invoiceStatus.quickfile_invoice_id);

    if (stationMileage && stationMileage.mileage_from_base != null && !miles) {
      miles = stationMileage.mileage_from_base;
    }
    if (hasExisting && invoiceStatus.invoice_attendance_fee != null) fee = invoiceStatus.invoice_attendance_fee;
    if (hasExisting && invoiceStatus.invoice_mileage_miles != null) miles = invoiceStatus.invoice_mileage_miles;
    if (hasExisting && invoiceStatus.invoice_mileage_rate != null) mileageRate = invoiceStatus.invoice_mileage_rate;
    if (hasExisting && invoiceStatus.invoice_parking_amount != null) parking = invoiceStatus.invoice_parking_amount;
    if (hasExisting && invoiceStatus.invoice_vat_rate != null) vatRate = invoiceStatus.invoice_vat_rate;

    var invoiceTitle = formatInvoiceTitle(meta.clientName, meta.stationName);
    var narrative = (hasExisting && invoiceStatus.invoice_narrative)
      ? invoiceStatus.invoice_narrative
      : _buildInvoiceNarrative(meta.clientName, meta.stationName, meta.attendanceDate, meta.offenceSummary);

    _wfBillingOpts = {
      clientName: meta.clientName,
      firmName: meta.firmName,
      stationName: meta.stationName,
      attendanceDate: meta.attendanceDate,
      offenceSummary: meta.offenceSummary,
      attendanceFee: fee,
      mileageMiles: miles,
      mileageRate: mileageRate,
      parkingAmount: parking,
      vatRate: vatRate,
      narrative: narrative,
      invoiceTitle: invoiceTitle,
      invoiceStatus: invoiceStatus,
      hasExistingInvoice: hasExisting,
      auditLog: auditLog,
    };

    _wfRenderBillingBody(body, footer, meta, _wfBillingOpts);
  }).catch(function () {
    var invoiceTitle = formatInvoiceTitle(meta.clientName, meta.stationName);
    _wfBillingOpts = {
      clientName: meta.clientName, firmName: meta.firmName, stationName: meta.stationName,
      attendanceDate: meta.attendanceDate, offenceSummary: meta.offenceSummary,
      attendanceFee: fee, mileageMiles: miles, mileageRate: mileageRate,
      parkingAmount: parking, vatRate: vatRate,
      narrative: _buildInvoiceNarrative(meta.clientName, meta.stationName, meta.attendanceDate, meta.offenceSummary),
      invoiceTitle: invoiceTitle, invoiceStatus: {}, hasExistingInvoice: false, auditLog: [],
    };
    _wfRenderBillingBody(body, footer, meta, _wfBillingOpts);
  });
}

function _wfRenderBillingBody(body, footer, meta, opts) {
  var totals = calculateInvoiceTotals({
    fixedFee: opts.attendanceFee, mileageMiles: opts.mileageMiles,
    mileageRate: opts.mileageRate, parkingAmount: opts.parkingAmount,
    vatRate: opts.vatRate,
  });

  var line1Desc = buildLine1Description({
    clientName: meta.clientName, policeStation: meta.stationName,
    attendanceDate: meta.attendanceDate,
  });

  var statusBadge = '';
  if (opts.hasExistingInvoice) {
    statusBadge = '<span class="wf-status-badge wf-status--invoiced">Invoiced</span>';
    if (opts.invoiceStatus.quickfile_invoice_number) {
      statusBadge += ' <span class="wf-invoice-num">#' + _wfEsc(opts.invoiceStatus.quickfile_invoice_number) + '</span>';
    }
  } else {
    statusBadge = '<span class="wf-status-badge wf-status--draft">Draft</span>';
  }

  var firmMissing = !((opts.firmName || '').trim());
  var firmCallout = '';
  if (firmMissing) {
    firmCallout =
      '<div class="wf-callout wf-callout-warn" id="wf-firm-missing-callout">' +
        '<p><strong>Instructing firm required.</strong> Select the firm on this record before creating an invoice.</p>' +
        '<button type="button" class="btn btn-primary" id="wf-goto-firm-section">Go to firm section</button>' +
      '</div>';
  }

  var docSelectionHtml = _wfBuildDocumentSelectionPanel(meta);

  var auditHtml = '';
  if (opts.auditLog && opts.auditLog.length) {
    auditHtml = '<details class="wf-audit-details"><summary>Billing History (' + opts.auditLog.length + ')</summary><div class="wf-audit-list">';
    opts.auditLog.forEach(function (entry) {
      auditHtml += '<div class="wf-audit-entry">' +
        '<span class="wf-audit-time">' + _wfEsc(entry.timestamp) + '</span> ' +
        '<span class="wf-audit-action">' + _wfEsc(entry.action) + '</span> ' +
        '<span class="wf-audit-user">' + _wfEsc(entry.user_name || '') + '</span>' +
        (entry.details ? '<div class="wf-audit-detail">' + _wfEsc(entry.details) + '</div>' : '') +
      '</div>';
    });
    auditHtml += '</div></details>';
  }

  body.innerHTML =
    '<div class="wf-screen wf-billing">' +
      '<div class="wf-screen-header">' +
        '<h3>QuickFile invoice</h3>' +
        '<p class="wf-screen-sub">Create the QuickFile invoice and attach generated PDFs where selected.</p>' +
        statusBadge +
      '</div>' +
      firmCallout +

      '<div class="wf-billing-grid">' +
        '<div class="wf-card">' +
          '<h4 class="wf-card-title">Invoice Details</h4>' +
          '<div class="wf-detail-row"><span class="wf-label">Invoice Title</span><span class="wf-value" id="wf-invoice-title">' + _wfEsc(opts.invoiceTitle) + '</span></div>' +
          '<div class="wf-detail-row"><span class="wf-label">Issue Date</span><span class="wf-value">' + _wfEsc(_wfFmtDate(opts.attendanceDate)) + '</span></div>' +
          '<div class="wf-detail-row"><span class="wf-label">Firm</span><span class="wf-value">' + _wfEsc(opts.firmName) + '</span></div>' +
        '</div>' +

        '<div class="wf-card">' +
          '<h4 class="wf-card-title">Charges</h4>' +
          '<div class="wf-charges-form">' +
            '<div class="wf-charge-row"><label for="wf-fee">Fixed Fee (&pound;)</label><input type="number" id="wf-fee" class="form-input wf-calc" value="' + (opts.attendanceFee || 160).toFixed(2) + '" step="0.01"></div>' +
            '<div class="wf-charge-row"><label for="wf-miles">Mileage Miles</label><input type="number" id="wf-miles" class="form-input wf-calc" value="' + (opts.mileageMiles || 0) + '" step="0.1"></div>' +
            '<div class="wf-charge-row"><label for="wf-rate">Mileage Rate (&pound;/mile)</label><input type="number" id="wf-rate" class="form-input wf-calc" value="' + (opts.mileageRate || 0.45).toFixed(2) + '" step="0.01"></div>' +
            '<div class="wf-charge-row"><label for="wf-parking">Parking (&pound;)</label><input type="number" id="wf-parking" class="form-input wf-calc" value="' + (opts.parkingAmount || 0).toFixed(2) + '" step="0.01"></div>' +
            '<div class="wf-charge-row"><label for="wf-vat">VAT %</label><input type="number" id="wf-vat" class="form-input wf-calc" value="' + ((opts.vatRate || 0.20) * 100).toFixed(0) + '" step="1"></div>' +
          '</div>' +
          '<div class="wf-line-preview">' +
            '<p class="wf-line-label">Line 1:</p>' +
            '<p class="wf-line-text" id="wf-line1-preview">' + _wfEsc(line1Desc) + '</p>' +
            '<p class="wf-line-label">Line 2:</p>' +
            '<p class="wf-line-text">Mileage</p>' +
          '</div>' +
        '</div>' +

        '<div class="wf-card wf-preview-card">' +
          '<h4 class="wf-card-title">QuickFile Preview</h4>' +
          '<div class="wf-preview-title" id="wf-preview-title">' + _wfEsc(opts.invoiceTitle) + '</div>' +
          '<table class="wf-preview-table">' +
            '<thead><tr><th>Description</th><th class="wf-col-amount">Amount</th></tr></thead>' +
            '<tbody id="wf-preview-lines">' +
              '<tr><td>' + _wfEsc(line1Desc) + '</td><td class="wf-col-amount">' + _wfFmtCurrency(totals.fixedFee) + '</td></tr>' +
              (totals.mileageAmount > 0 ? '<tr><td>Mileage</td><td class="wf-col-amount">' + _wfFmtCurrency(totals.mileageAmount) + '</td></tr>' : '') +
              (totals.parkingAmount > 0 ? '<tr><td>Parking/disbursements</td><td class="wf-col-amount">' + _wfFmtCurrency(totals.parkingAmount) + '</td></tr>' : '') +
            '</tbody>' +
            '<tfoot>' +
              '<tr><td>Subtotal</td><td class="wf-col-amount" id="wf-prev-sub">' + _wfFmtCurrency(totals.subTotal) + '</td></tr>' +
              '<tr><td>VAT</td><td class="wf-col-amount" id="wf-prev-vat">' + _wfFmtCurrency(totals.vatTotal) + '</td></tr>' +
              '<tr class="wf-preview-total"><td>Total</td><td class="wf-col-amount" id="wf-prev-total">' + _wfFmtCurrency(totals.grandTotal) + '</td></tr>' +
            '</tfoot>' +
          '</table>' +
        '</div>' +
      '</div>' +

      docSelectionHtml +

      '<div class="wf-card">' +
        '<h4 class="wf-card-title">Invoice Narrative</h4>' +
        '<textarea id="wf-narrative" class="form-input wf-narrative-input" rows="3">' + _wfEsc(opts.narrative) + '</textarea>' +
      '</div>' +

      '<div class="wf-card">' +
        '<h4 class="wf-card-title">Review Confirmation</h4>' +
        '<div class="wf-checklist">' +
          '<label class="wf-check-item"><input type="checkbox" id="wf-check-attendance"> Attendance note reviewed</label>' +
          '<label class="wf-check-item"><input type="checkbox" id="wf-check-docs"> Documents reviewed &amp; named</label>' +
          '<label class="wf-check-item"><input type="checkbox" id="wf-check-billing"> Billing details confirmed</label>' +
        '</div>' +
      '</div>' +

      auditHtml +
    '</div>';

  _wfBuildBillingFooter(footer, meta, opts);
  _wfBindBillingEvents(meta, opts);
}

function _wfBuildDocumentSelectionPanel(meta) {
  var generatedDocs = _wfGeneratedDocs || {};
  var attachments = _wfGetAttachments(meta.data);
  var hasAnyDocs = Object.keys(generatedDocs).length > 0 || attachments.length > 0;

  if (!hasAnyDocs) {
    return '<div class="wf-card wf-doc-selection">' +
      '<h4 class="wf-card-title">&#128206; Documents to Attach to Invoice</h4>' +
      '<p class="wf-empty-state">No documents available. Go back to the Documents step to generate forms or upload files.</p>' +
    '</div>';
  }

  var html = '<div class="wf-card wf-doc-selection">' +
    '<h4 class="wf-card-title">&#128206; Documents to Attach to Invoice</h4>' +
    '<p class="wf-doc-sel-sub">Select which documents to upload to QuickFile with this invoice.</p>' +
    '<div class="wf-doc-sel-actions">' +
      '<button type="button" class="btn btn-small wf-doc-sel-all">Select All</button>' +
      '<button type="button" class="btn btn-small btn-secondary wf-doc-sel-none">Deselect All</button>' +
    '</div>' +
    '<div class="wf-doc-sel-list">';

  var genKeys = Object.keys(generatedDocs);
  if (genKeys.length) {
    html += '<div class="wf-doc-sel-group"><span class="wf-doc-sel-group-label">Generated Forms</span></div>';
    genKeys.forEach(function (key) {
      var doc = generatedDocs[key];
      var checked = _wfSelectedDocs['gen_' + key] !== false ? ' checked' : '';
      if (_wfSelectedDocs['gen_' + key] === undefined) _wfSelectedDocs['gen_' + key] = true;
      html += '<label class="wf-doc-sel-item">' +
        '<input type="checkbox" class="wf-doc-sel-cb" data-doc-key="gen_' + key + '"' + checked + '>' +
        '<span class="wf-doc-sel-icon">&#128196;</span>' +
        '<span class="wf-doc-sel-name">' + _wfEsc(doc.label) + '</span>' +
        '<span class="wf-doc-sel-size">' + _wfFmtFileSize(doc.size) + '</span>' +
      '</label>';
    });
  }

  if (attachments.length) {
    html += '<div class="wf-doc-sel-group"><span class="wf-doc-sel-group-label">Uploaded Files</span>' +
      '<span class="wf-doc-sel-hint">(uploaded files must be attached to QuickFile manually)</span></div>';
    attachments.forEach(function (att) {
      var renamed = att.documentType ? formatAttachmentFilename({
        clientName: meta.clientName, policeStation: meta.stationName,
        attendanceDate: meta.attendanceDate, documentType: att.documentType,
        customDocumentType: att.customDocumentType, firmName: meta.firmName,
        extension: _wfExtFromName(att.originalName),
      }) : att.originalName;
      html += '<label class="wf-doc-sel-item wf-doc-sel-item--disabled">' +
        '<span class="wf-doc-sel-icon">&#128206;</span>' +
        '<span class="wf-doc-sel-name">' + _wfEsc(renamed) + '</span>' +
      '</label>';
    });
  }

  html += '</div>';

  var selectedCount = Object.keys(_wfSelectedDocs).filter(function (k) { return _wfSelectedDocs[k]; }).length;
  html += '<div class="wf-doc-sel-summary" id="wf-doc-sel-summary">' + selectedCount + ' document' + (selectedCount !== 1 ? 's' : '') + ' selected for attachment</div>';
  html += '</div>';
  return html;
}

function _wfFmtCurrency(val) {
  return '\u00A3' + (parseFloat(val) || 0).toFixed(2);
}

function _wfBuildBillingFooter(footer, meta, opts) {
  var nextCompleteBtn = opts.hasExistingInvoice
    ? '<button type="button" id="wf-bill-next-complete" class="btn btn-primary">Next: Review &amp; complete &#9654;</button>'
    : '';
  footer.innerHTML =
    '<button type="button" id="wf-bill-back" class="btn btn-secondary">&#9664; Back</button>' +
    '<button type="button" id="wf-bill-create" class="btn btn-primary btn-billing-create" disabled>' +
      (opts.hasExistingInvoice ? '&#9888; Create Another Invoice' : 'Generate Invoice') +
    '</button>' +
    nextCompleteBtn +
    '<button type="button" id="wf-bill-close" class="btn btn-secondary">Close</button>';

  document.getElementById('wf-bill-back').addEventListener('click', _wfGoBack);
  document.getElementById('wf-bill-close').addEventListener('click', closeWorkflow);

  document.getElementById('wf-bill-create').addEventListener('click', function () {
    _wfHandleCreateInvoice(meta, opts);
  });

  var nextComplete = document.getElementById('wf-bill-next-complete');
  if (nextComplete) {
    nextComplete.addEventListener('click', function () {
      if (typeof _wfGoNext === 'function') _wfGoNext();
    });
  }
}

function _wfBindBillingEvents(meta, opts) {
  var overlay = document.getElementById('workflow-overlay');
  if (!overlay) return;

  var gotoFirm = document.getElementById('wf-goto-firm-section');
  if (gotoFirm) {
    gotoFirm.addEventListener('click', function () {
      if (typeof window.goToInstructingFirmSection === 'function') {
        window.goToInstructingFirmSection();
      } else {
        showToast('Open the record, go to Case Reference & Arrival, then select the instructing firm.', 'info', 6000);
      }
    });
  }

  overlay.querySelectorAll('.wf-calc').forEach(function (inp) {
    inp.addEventListener('input', function () { _wfRecalcPreview(meta); });
  });

  var checkboxes = overlay.querySelectorAll('.wf-checklist input[type="checkbox"]');
  var createBtn = document.getElementById('wf-bill-create');
  function updateBtn() {
    var allChecked = true;
    checkboxes.forEach(function (cb) { if (!cb.checked) allChecked = false; });
    if (createBtn) createBtn.disabled = !allChecked;
  }
  checkboxes.forEach(function (cb) { cb.addEventListener('change', updateBtn); });

  overlay.querySelectorAll('.wf-doc-sel-cb').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var key = cb.getAttribute('data-doc-key');
      _wfSelectedDocs[key] = cb.checked;
      _wfUpdateDocSelSummary();
    });
  });

  var selAllBtn = overlay.querySelector('.wf-doc-sel-all');
  if (selAllBtn) {
    selAllBtn.addEventListener('click', function () {
      overlay.querySelectorAll('.wf-doc-sel-cb').forEach(function (cb) {
        cb.checked = true;
        _wfSelectedDocs[cb.getAttribute('data-doc-key')] = true;
      });
      _wfUpdateDocSelSummary();
    });
  }

  var selNoneBtn = overlay.querySelector('.wf-doc-sel-none');
  if (selNoneBtn) {
    selNoneBtn.addEventListener('click', function () {
      overlay.querySelectorAll('.wf-doc-sel-cb').forEach(function (cb) {
        cb.checked = false;
        _wfSelectedDocs[cb.getAttribute('data-doc-key')] = false;
      });
      _wfUpdateDocSelSummary();
    });
  }
}

function _wfUpdateDocSelSummary() {
  var count = Object.keys(_wfSelectedDocs).filter(function (k) { return _wfSelectedDocs[k]; }).length;
  var el = document.getElementById('wf-doc-sel-summary');
  if (el) el.textContent = count + ' document' + (count !== 1 ? 's' : '') + ' selected for attachment';
}

function _wfRecalcPreview(meta) {
  var feeEl = document.getElementById('wf-fee');
  if (!feeEl) return;
  var fee = parseFloat(feeEl.value) || 0;
  var miles = parseFloat((document.getElementById('wf-miles') || {}).value) || 0;
  var rate = parseFloat((document.getElementById('wf-rate') || {}).value) || 0;
  var parking = parseFloat((document.getElementById('wf-parking') || {}).value) || 0;
  var vatPct = parseFloat((document.getElementById('wf-vat') || {}).value) || 0;
  var totals = calculateInvoiceTotals({
    fixedFee: fee, mileageMiles: miles, mileageRate: rate,
    parkingAmount: parking, vatRate: vatPct / 100,
  });
  var sub = document.getElementById('wf-prev-sub');
  var vat = document.getElementById('wf-prev-vat');
  var tot = document.getElementById('wf-prev-total');
  if (sub) sub.textContent = _wfFmtCurrency(totals.subTotal);
  if (vat) vat.textContent = _wfFmtCurrency(totals.vatTotal);
  if (tot) tot.textContent = _wfFmtCurrency(totals.grandTotal);

  var line1 = buildLine1Description({
    clientName: meta.clientName, policeStation: meta.stationName,
    attendanceDate: meta.attendanceDate,
  });
  var l1el = document.getElementById('wf-line1-preview');
  if (l1el) l1el.textContent = line1;
}

function _wfGetSelectedDocAttachments() {
  var attachments = [];
  var generatedDocs = _wfGeneratedDocs || {};

  Object.keys(_wfSelectedDocs).forEach(function (key) {
    if (!_wfSelectedDocs[key]) return;

    if (key.startsWith('gen_')) {
      var formId = key.slice(4);
      var doc = generatedDocs[formId];
      if (doc && doc.base64) {
        attachments.push({
          base64: doc.base64,
          filename: doc.filename || formId + '.pdf',
          description: doc.label || formId,
        });
      }
    }
  });

  return attachments;
}

function _wfHandleCreateInvoice(meta, opts) {
  var recordId = meta.recordId;
  var fee = parseFloat(document.getElementById('wf-fee').value) || 0;
  var miles = parseFloat(document.getElementById('wf-miles').value) || 0;
  var rate = parseFloat(document.getElementById('wf-rate').value) || 0;
  var parking = parseFloat(document.getElementById('wf-parking').value) || 0;
  var vatPct = parseFloat(document.getElementById('wf-vat').value) || 0;
  var narrative = (document.getElementById('wf-narrative') || {}).value || '';

  var extraAttachments = _wfGetSelectedDocAttachments();

  var mergedOpts = {
    clientName: meta.clientName,
    firmName: meta.firmName,
    stationName: meta.stationName,
    attendanceDate: meta.attendanceDate,
    attendanceFee: fee,
    mileageMiles: miles,
    mileageRate: rate,
    parkingAmount: parking,
    vatRate: vatPct / 100,
    narrative: narrative,
    hasExistingInvoice: opts.hasExistingInvoice,
    invoiceStatus: opts.invoiceStatus,
    extraAttachments: extraAttachments,
  };

  _wfHandleCreateInvoiceImpl(recordId, mergedOpts);
}

async function _wfHandleCreateInvoiceImpl(recordId, opts) {
  console.log('[billing] Invoice creation started for record', recordId);
  if (!recordId) {
    showToast('Save the record first before creating an invoice', 'error');
    return;
  }
  if (!window.api || !window.api.quickfileCreateInvoice || !window.api.getSettings) {
    showToast('Invoice API is not available in this environment', 'error');
    return;
  }

  var allowDuplicate = false;
  if (opts.hasExistingInvoice) {
    var confirmed = await showConfirm('This record already has an invoice (' + ((opts.invoiceStatus || {}).quickfile_invoice_number || 'unknown') + ').\n\nAre you sure you want to create another invoice?');
    if (!confirmed) return;
    allowDuplicate = true;
  }

  if (!opts.firmName) {
    showToast('Select the instructing firm on the record before creating an invoice.', 'error', 6500);
    return;
  }

  var createBtn = document.getElementById('wf-bill-create');
  if (createBtn) { createBtn.disabled = true; createBtn.textContent = 'Creating invoice...'; }

  var settings = window._appSettingsCache || {};
  var userName = settings.feeEarnerNameDefault || settings.feeEarnerName || '';
  var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
  var firmEmail = '';
  if (data.firmId && window.firms) {
    var firm = window.firms.find(function (f) { return String(f.id) === String(data.firmId); });
    if (firm) firmEmail = firm.contact_email || '';
  }

  var billingInv = '';
  if (typeof ensureBillingDisplayInvoiceNumber === 'function') {
    billingInv = ensureBillingDisplayInvoiceNumber({ skipSave: false });
  }

  var attachName = ([data.surname, data.forename].filter(Boolean).join('_') || 'attendance') + '-note.pdf';

  try {
    var fetchedSettings = await window.api.getSettings();
    var builder = (typeof getActivePdfBuilder === 'function') ? getActivePdfBuilder() : (typeof buildPdfHtml === 'function' ? buildPdfHtml : null);
    var attachHtml = builder ? builder(data, fetchedSettings || {}) : '';

    var result = await window.api.quickfileCreateInvoice({
      attendanceId: recordId,
      firmName: opts.firmName,
      contactEmail: firmEmail,
      clientName: opts.clientName || '',
      stationName: opts.stationName || '',
      attendanceFee: opts.attendanceFee,
      mileageMiles: opts.mileageMiles,
      mileageRate: opts.mileageRate,
      parkingAmount: opts.parkingAmount,
      vatRate: opts.vatRate,
      narrative: opts.narrative,
      invoiceDate: opts.attendanceDate || new Date().toISOString().slice(0, 10),
      userName: userName,
      billingInvoiceNumber: billingInv,
      attachAttendanceHtml: attachHtml || undefined,
      attachPdfFileName: attachName,
      allowDuplicate: allowDuplicate,
      extraAttachments: opts.extraAttachments || [],
    });

    if (result.ok) {
      if (typeof formData === 'object' && formData) {
        formData.quickfile_invoice_id = result.invoiceId || '';
        formData.quickfileInvoiceNumber = result.invoiceNumber || '';
      }
      if (typeof quietSave === 'function') quietSave();
      if (typeof refreshQuickFileInvoiceRefDisplay === 'function') refreshQuickFileInvoiceRefDisplay();

      var attachSummary = '';
      if (result.attachResults && result.attachResults.length) {
        var okCount = result.attachResults.filter(function (r) { return r.ok; }).length;
        var failCount = result.attachResults.filter(function (r) { return !r.ok; }).length;
        attachSummary = ' | ' + okCount + ' attachment' + (okCount !== 1 ? 's' : '') + ' uploaded';
        if (failCount > 0) attachSummary += ', ' + failCount + ' failed';
      }

      console.log('[billing] Invoice created: #' + (result.invoiceNumber || result.invoiceId));
      showToast('Invoice #' + (result.invoiceNumber || result.invoiceId) + ' created successfully' + attachSummary, 'success', 6000);
      showToast('Next: review and mark office work complete (step 3).', 'info', 5000);

      if (typeof _wfAfterInvoiceCreatedGoToCompletion === 'function') {
        _wfAfterInvoiceCreatedGoToCompletion();
      } else {
        _wfRenderCurrentStep();
      }
    } else {
      showToast('Invoice failed: ' + (result.error || 'Unknown error'), 'error', 8000);
    }
  } catch (err) {
    console.error('[billing] Invoice creation failed:', err);
    showToast('Invoice error: ' + (err.message || String(err)), 'error', 8000);
  } finally {
    if (createBtn) { createBtn.disabled = false; createBtn.textContent = opts.hasExistingInvoice ? '\u26A0 Create Another Invoice' : 'Generate Invoice'; }
  }
}
