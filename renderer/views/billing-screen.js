/* ═══════════════════════════════════════════════════════
   BILLING SCREEN (Workflow Step 2)
   Invoice details, charges, QuickFile preview, linked attachments.
   Rendered inside #wf-body by workflow-stepper.js.
   Depends on: filenameUtils.js, billingUtils.js, workflow-stepper.js,
               billing.js (_handleCreateInvoice, _previewDocument),
               app.js globals
   ═══════════════════════════════════════════════════════ */

var _wfBillingLoaded = false;
var _wfBillingOpts = null;

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

  var attachments = _wfGetAttachments(meta.data);
  var linkedHtml = '';
  if (attachments.length) {
    linkedHtml = '<div class="wf-card"><h4 class="wf-card-title">Linked Supporting PDFs</h4><ul class="wf-linked-list">';
    attachments.forEach(function (att) {
      var renamed = att.documentType ? formatAttachmentFilename({
        clientName: meta.clientName, policeStation: meta.stationName,
        attendanceDate: meta.attendanceDate, documentType: att.documentType,
        customDocumentType: att.customDocumentType, firmName: meta.firmName,
        extension: _wfExtFromName(att.originalName),
      }) : att.originalName;
      linkedHtml += '<li class="wf-linked-file">&#128196; ' + _wfEsc(renamed) + '</li>';
    });
    linkedHtml += '</ul></div>';
  }

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
        '<h3>Billing &amp; Invoice</h3>' +
        '<p class="wf-screen-sub">Create the QuickFile invoice and link supporting PDFs.</p>' +
        statusBadge +
      '</div>' +

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

      linkedHtml +

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

function _wfFmtCurrency(val) {
  return '\u00A3' + (parseFloat(val) || 0).toFixed(2);
}

function _wfBuildBillingFooter(footer, meta, opts) {
  footer.innerHTML =
    '<button type="button" id="wf-bill-back" class="btn btn-secondary">&#9664; Back</button>' +
    '<button type="button" id="wf-bill-create" class="btn btn-primary btn-billing-create" disabled>' +
      (opts.hasExistingInvoice ? '&#9888; Create Another Invoice' : 'Generate Invoice') +
    '</button>' +
    '<button type="button" id="wf-bill-next" class="btn btn-accent">Next: Complete &#9654;</button>';

  document.getElementById('wf-bill-back').addEventListener('click', _wfGoBack);
  document.getElementById('wf-bill-next').addEventListener('click', _wfGoNext);

  document.getElementById('wf-bill-create').addEventListener('click', function () {
    _wfHandleCreateInvoice(meta, opts);
  });
}

function _wfBindBillingEvents(meta, opts) {
  var overlay = document.getElementById('workflow-overlay');
  if (!overlay) return;

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
}

function _wfRecalcPreview(meta) {
  var fee = parseFloat(document.getElementById('wf-fee').value) || 0;
  var miles = parseFloat(document.getElementById('wf-miles').value) || 0;
  var rate = parseFloat(document.getElementById('wf-rate').value) || 0;
  var parking = parseFloat(document.getElementById('wf-parking').value) || 0;
  var vatPct = parseFloat(document.getElementById('wf-vat').value) || 0;
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

function _wfHandleCreateInvoice(meta, opts) {
  var recordId = meta.recordId;
  var fee = parseFloat(document.getElementById('wf-fee').value) || 0;
  var miles = parseFloat(document.getElementById('wf-miles').value) || 0;
  var rate = parseFloat(document.getElementById('wf-rate').value) || 0;
  var parking = parseFloat(document.getElementById('wf-parking').value) || 0;
  var vatPct = parseFloat(document.getElementById('wf-vat').value) || 0;
  var narrative = (document.getElementById('wf-narrative') || {}).value || '';

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
  };

  _handleCreateInvoice(recordId, mergedOpts);
}


/* ═══════════════════════════════════════════════════════
   COMPLETE SCREEN (Workflow Step 3)
   Finalisation checklist and archive action.
   ═══════════════════════════════════════════════════════ */

function _wfRenderCompleteStep(body, footer) {
  var meta = _wfMatterMeta();
  var data = meta.data;
  var attachments = _wfGetAttachments(data);

  var allNamed = attachments.length === 0 || attachments.every(function (a) { return !!a.documentType; });
  var hasInvoice = !!(data.quickfile_invoice_id || (data.invoiceSent === 'Yes'));
  var detailsComplete = !!(meta.clientName && meta.stationName && meta.attendanceDate && meta.firmName);

  var checks = [
    { label: 'Required matter details complete', done: detailsComplete },
    { label: 'Attachments standardised', done: allNamed },
    { label: 'Invoice created', done: hasInvoice },
    { label: 'Invoice sent', done: data.invoiceSent === 'Yes' },
  ];

  var allDone = checks.every(function (c) { return c.done; });

  var html =
    '<div class="wf-screen wf-complete">' +
      '<div class="wf-screen-header">' +
        '<h3>Ready to Archive</h3>' +
        '<p class="wf-screen-sub">Confirm all steps are complete before archiving this record.</p>' +
      '</div>' +
      '<div class="wf-card wf-finalise-card">' +
        '<ul class="wf-finalise-list">';

  checks.forEach(function (c) {
    var icon = c.done ? '<span class="wf-check-done">&#10003;</span>' : '<span class="wf-check-pending">&#9744;</span>';
    html += '<li class="wf-finalise-item">' + icon + ' ' + _wfEsc(c.label) + '</li>';
  });

  html += '</ul></div></div>';

  body.innerHTML = html;

  footer.innerHTML =
    '<button type="button" id="wf-comp-back" class="btn btn-secondary">&#9664; Back</button>' +
    '<button type="button" id="wf-comp-archive" class="btn btn-primary"' + (allDone ? '' : ' disabled') + '>Archive Record</button>' +
    '<button type="button" id="wf-comp-close" class="btn btn-secondary">Close</button>';

  document.getElementById('wf-comp-back').addEventListener('click', _wfGoBack);
  document.getElementById('wf-comp-close').addEventListener('click', closeWorkflow);
  document.getElementById('wf-comp-archive').addEventListener('click', function () {
    if (!allDone) {
      showToast('Complete all items before archiving', 'error');
      return;
    }
    if (typeof showConfirm === 'function') {
      showConfirm('Archive this record? It will be hidden from the main records list.').then(function (ok) {
        if (!ok) return;
        if (typeof archiveRecord === 'function') {
          archiveRecord();
          closeWorkflow();
        } else {
          showToast('Archive function not available', 'error');
        }
      });
    } else if (typeof archiveRecord === 'function') {
      archiveRecord();
      closeWorkflow();
    }
  });
}
