/* ═══════════════════════════════════════════════════════
   BILLING CALCULATION UTILITIES
   Invoice total calculations, QuickFile payload builder,
   and billing status helpers.
   ═══════════════════════════════════════════════════════ */

var BILLING_DEFAULTS = {
  fixedFee: 160.00,
  mileageRate: 0.45,
  vatRate: 0.20,
};

var INVOICE_STATUSES = {
  DRAFT: 'draft',
  INVOICE_READY: 'invoice_ready',
  INVOICED: 'invoiced',
  SENT: 'sent',
  ARCHIVED: 'archived',
};

var INVOICE_STATUS_LABELS = {
  draft: 'Draft',
  invoice_ready: 'Ready',
  invoiced: 'Invoiced',
  sent: 'Sent',
  archived: 'Archived',
};

function calculateInvoiceTotals(opts) {
  var fixedFee = parseFloat(opts.fixedFee);
  if (!Number.isFinite(fixedFee) || fixedFee < 0) fixedFee = 0;
  var mileageMiles = parseFloat(opts.mileageMiles);
  if (!Number.isFinite(mileageMiles) || mileageMiles < 0) mileageMiles = 0;
  var mileageRate = parseFloat(opts.mileageRate);
  if (!Number.isFinite(mileageRate)) mileageRate = BILLING_DEFAULTS.mileageRate;
  var vatRate = parseFloat(opts.vatRate);
  if (!Number.isFinite(vatRate)) vatRate = BILLING_DEFAULTS.vatRate;

  var mileageAmount = mileageMiles * mileageRate;
  var subTotal = fixedFee + mileageAmount;
  var parkingAmount = parseFloat(opts.parkingAmount) || 0;
  subTotal += parkingAmount;
  var vatTotal = subTotal * vatRate;

  var roundedSub = Number(subTotal.toFixed(2));
  var roundedVat = Number(vatTotal.toFixed(2));

  return {
    fixedFee: Number(fixedFee.toFixed(2)),
    mileageMiles: mileageMiles,
    mileageRate: Number(mileageRate.toFixed(2)),
    mileageAmount: Number(mileageAmount.toFixed(2)),
    parkingAmount: Number(parkingAmount.toFixed(2)),
    subTotal: roundedSub,
    vatRate: vatRate,
    vatTotal: roundedVat,
    grandTotal: Number((roundedSub + roundedVat).toFixed(2)),
  };
}

function buildQuickFileLineItems(record, totals) {
  var lines = [];
  var line1Desc = (typeof buildLine1Description === 'function')
    ? buildLine1Description(record)
    : 'Police Station Attendance Fixed Fee';

  if (totals.fixedFee > 0) {
    lines.push({
      description: line1Desc,
      unitCost: totals.fixedFee,
      qty: 1,
      vatRate: totals.vatRate,
    });
  }
  if (totals.mileageAmount > 0) {
    lines.push({
      description: 'Mileage',
      unitCost: totals.mileageAmount,
      qty: 1,
      vatRate: totals.vatRate,
    });
  }
  if (totals.parkingAmount > 0) {
    lines.push({
      description: 'Parking',
      unitCost: totals.parkingAmount,
      qty: 1,
      vatRate: totals.vatRate,
    });
  }
  return lines;
}

function buildQuickFilePayload(record) {
  var invoiceTitle = (typeof formatInvoiceTitle === 'function')
    ? formatInvoiceTitle(record.clientName, record.policeStation || record.stationName)
    : (record.clientName || '') + ' - ' + (record.policeStation || record.stationName || '');

  var totals = calculateInvoiceTotals({
    fixedFee: record.fixedFee != null ? record.fixedFee : (record.attendanceFee != null ? record.attendanceFee : BILLING_DEFAULTS.fixedFee),
    mileageMiles: record.mileageMiles,
    mileageRate: record.mileageRate != null ? record.mileageRate : BILLING_DEFAULTS.mileageRate,
    parkingAmount: record.parkingAmount,
    vatRate: record.vatRate != null ? record.vatRate : BILLING_DEFAULTS.vatRate,
  });

  var lineItems = buildQuickFileLineItems(record, totals);

  var linkedAttachments = [];
  if (record.attachments && Array.isArray(record.attachments)) {
    linkedAttachments = record.attachments.map(function (att) {
      return {
        originalName: att.originalName || att.name || '',
        formattedName: att.formattedName || att.storedName || '',
        documentType: att.documentType || '',
      };
    });
  }

  return {
    invoiceTitle: invoiceTitle,
    clientName: record.clientName || '',
    policeStation: record.policeStation || record.stationName || '',
    attendanceDate: record.attendanceDate || record.date || '',
    issueDate: record.invoiceDate || new Date().toISOString().slice(0, 10),
    firmName: record.firmName || '',
    lineItems: lineItems,
    linkedAttachments: linkedAttachments,
    totals: totals,
  };
}

function getInvoiceStatusLabel(status) {
  return INVOICE_STATUS_LABELS[status] || 'Draft';
}

function getInvoiceStatusClass(status) {
  switch (status) {
    case 'invoiced': return 'wf-status--invoiced';
    case 'sent': return 'wf-status--sent';
    case 'archived': return 'wf-status--archived';
    case 'invoice_ready': return 'wf-status--ready';
    default: return 'wf-status--draft';
  }
}
