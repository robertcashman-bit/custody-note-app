/* ═══════════════════════════════════════════════════════
   COMPLETION SCREEN (Workflow Step 3)
   Review file completion, safeguards, billing handover, mark office work complete.
   Depends: workflow-stepper.js, documents-screen.js (_wfGetAttachments),
            app.js globals (formData, currentRecordStatus, currentAttendanceId,
            getFormData, showConfirm, showToast, quietSave, hasQuickFileSettingsConfigured,
            matterBillingArchiveReady, currentRecordArchived)
   ═══════════════════════════════════════════════════════ */

function _wfCompletionNoteFinalised() {
  var st = typeof currentRecordStatus !== 'undefined' ? currentRecordStatus : null;
  return st === 'finalised' || st === 'completed';
}

function _wfCompletionHasInvoice(data) {
  var d = data || {};
  return !!(
    (d.quickfile_invoice_id && String(d.quickfile_invoice_id).trim()) ||
    (d.quickfileInvoiceNumber && String(d.quickfileInvoiceNumber).trim()) ||
    (d.quickfileInvoiceUrl && String(d.quickfileInvoiceUrl).trim())
  );
}

function _wfCompletionAttachmentsMeta(data) {
  var att = (typeof _wfGetAttachments === 'function') ? _wfGetAttachments(data || {}) : [];
  var allNamed = !att.length || att.every(function (a) {
    if (!a.documentType) return false;
    if (a.documentType === 'other' && !(String(a.customDocumentType || '').trim())) return false;
    return true;
  });
  return { count: att.length, allNamed: allNamed, list: att };
}

function _wfCompletionOfficeMarked() {
  return (typeof currentRecordStatus !== 'undefined' && currentRecordStatus === 'completed');
}

/** Billing handover done: explicit timestamp, or legacy office-work completion. */
function _wfBillingHandoverDone(data) {
  var d = data || {};
  if (d.billingProcessCompletedAt) return true;
  if (d.officeWorkCompletedAt) return true;
  return false;
}

function _wfShowMarkBillingButton(data) {
  var d = data || {};
  return !d.billingProcessCompletedAt && !d.officeWorkCompletedAt;
}

function _wfRenderCompletionStep(body, footer) {
  var meta = _wfMatterMeta();
  var d = meta.data || {};
  var noteOk = _wfCompletionNoteFinalised();
  var invOk = _wfCompletionHasInvoice(d);
  var am = _wfCompletionAttachmentsMeta(d);
  var officeOk = _wfCompletionOfficeMarked();
  var billingOk = _wfBillingHandoverDone(d);
  var showBillingBtn = _wfShowMarkBillingButton(d);
  var qfOn = (typeof hasQuickFileSettingsConfigured === 'function') && hasQuickFileSettingsConfigured();

  var hardWarnings = (typeof getBillingHardWarnings === 'function') ? getBillingHardWarnings() : [];
  var billingDataOk = hardWarnings.length === 0;

  var rows = [
    { key: 'note', label: 'Attendance note finalised', ok: noteOk, hint: !noteOk ? 'Finalise the note on the form first.' : '' },
    { key: 'data', label: 'Billing data complete', ok: billingDataOk, hint: !billingDataOk ? 'Missing: ' + hardWarnings.join(', ') + '.' : 'All required billing fields are present.' },
  ];
  if (qfOn) {
    rows.push({ key: 'inv', label: 'QuickFile invoice linked', ok: invOk, hint: !invOk ? 'Create the invoice in the Billing review step.' : '' });
  }
  rows.push(
    { key: 'att', label: 'Attachments named on file', ok: am.count === 0 || am.allNamed, hint: am.count && !am.allNamed ? 'Name every attachment (document type) on step 1 or the form.' : (am.count === 0 ? 'No attachments on this record \u2014 confirm if that is correct for this matter.' : '') },
    { key: 'bill', label: 'Billing process completed', ok: billingOk, hint: billingOk ? 'Recorded for your firm billing / finance handover.' : 'Confirm when your office billing steps are done, then you can archive.' },
    { key: 'off', label: 'Office work marked complete', ok: officeOk, hint: officeOk ? 'This matter is marked complete in your workflow.' : 'Use the button below when admin on this file is finished.' }
  );

  var strip = '<div class="wf-completion-strip">';
  rows.forEach(function (r) {
    strip += '<div class="wf-completion-row ' + (r.ok ? 'wf-completion-row--ok' : 'wf-completion-row--pending') + '">' +
      '<span class="wf-completion-icon">' + (r.ok ? '&#10003;' : '&#9711;') + '</span>' +
      '<span class="wf-completion-label">' + _wfEsc(r.label) + '</span>' +
      (r.hint ? '<span class="wf-completion-hint">' + _wfEsc(r.hint) + '</span>' : '') +
      '</div>';
  });
  strip += '</div>';

  var billingSummaryHtml = _wfBuildBillingSummaryCard(d);

  var completionGuideHtml = '<div class="wf-action-guide"><h4 class="wf-action-guide-title">What to do on this step &mdash; in order</h4><ol class="wf-action-guide-list">';
  if (!billingOk) {
    completionGuideHtml += '<li class="wf-action-guide-item"><strong>1.</strong> Review the billing summary below, then click <strong>Mark billing process complete</strong>.</li>';
  } else {
    completionGuideHtml += '<li class="wf-action-guide-item wf-action-guide-item--done">&#10003; Billing marked complete.</li>';
  }
  if (!officeOk) {
    completionGuideHtml += '<li class="wf-action-guide-item"><strong>' + (billingOk ? '1' : '2') + '.</strong> Click <strong>Mark office work complete</strong> when all admin is done.</li>';
  } else {
    completionGuideHtml += '<li class="wf-action-guide-item wf-action-guide-item--done">&#10003; Office work marked complete.</li>';
  }
  if (billingOk && officeOk && noteOk) {
    completionGuideHtml += '<li class="wf-action-guide-item"><strong>Final.</strong> Click <strong>Archive record</strong> to file this matter away.</li>';
  } else if (billingOk && officeOk) {
    completionGuideHtml += '<li class="wf-action-guide-item">Finalise the attendance note to unlock archiving.</li>';
  }
  completionGuideHtml += '</ol></div>';

  body.innerHTML =
    '<div class="wf-screen wf-completion">' +
      '<div class="wf-screen-header">' +
        '<h3>Step 3 &mdash; Review &amp; mark complete</h3>' +
        '<p class="wf-screen-sub">Confirm this matter is complete: billing data checked, documents in order, then archive when ready.</p>' +
      '</div>' +
      completionGuideHtml +
      '<div class="wf-card">' +
        '<h4 class="wf-card-title">Progress</h4>' +
        strip +
      '</div>' +
      billingSummaryHtml +
      '<div class="wf-card wf-completion-save-note">' +
        '<p class="settings-hint" style="margin:0;">You can close this window anytime \u2014 your place is remembered. Draft changes still autosave until the note is finalised.</p>' +
      '</div>' +
    '</div>';

  _wfBuildCompletionFooter(footer, {
    noteOk: noteOk,
    invOk: invOk,
    qfOn: qfOn,
    attMeta: am,
    officeOk: officeOk,
    billingOk: billingOk,
    showBillingBtn: showBillingBtn,
  });
}

function _wfBuildCompletionFooter(footer, ctx) {
  var matterReady = (typeof window.matterBillingArchiveReady === 'function')
    ? window.matterBillingArchiveReady()
    : ctx.billingOk;
  var archived = typeof currentRecordArchived !== 'undefined' && currentRecordArchived;
  var canArchive = matterReady && ctx.noteOk && !archived;

  var html =
    '<button type="button" id="wf-complete-back" class="btn btn-secondary btn-small">&#9664; Back</button>' +
    '<button type="button" id="wf-export-billing-pdf" class="btn btn-secondary btn-small">Export PDF</button>' +
    '<span class="wf-footer-spacer"></span>';

  if (ctx.showBillingBtn) {
    html += '<button type="button" id="wf-billing-done" class="btn btn-primary wf-btn-next-action">1. Mark billing complete</button>';
  }

  if (!ctx.officeOk) {
    var officeNum = ctx.showBillingBtn ? '2' : '1';
    html += '<button type="button" id="wf-complete-done" class="btn ' + (ctx.showBillingBtn ? 'btn-secondary' : 'btn-primary wf-btn-next-action') + '">' + officeNum + '. Mark office work complete</button>';
  } else {
    html += '<button type="button" id="wf-complete-done" class="btn btn-secondary btn-small" disabled>&#10003; Office complete</button>';
  }

  if (canArchive) {
    html += '<button type="button" id="wf-complete-archive" class="btn btn-primary wf-btn-next-action">Final: Archive record</button>';
  }

  html +=
    '<button type="button" id="wf-complete-close" class="btn btn-secondary btn-small">Close</button>';

  footer.innerHTML = html;

  document.getElementById('wf-complete-back').addEventListener('click', _wfGoBack);
  document.getElementById('wf-complete-close').addEventListener('click', closeWorkflow);
  var exportBillingBtn = document.getElementById('wf-export-billing-pdf');
  if (exportBillingBtn) {
    exportBillingBtn.addEventListener('click', function () {
      if (typeof window.exportBillingSummaryPdf === 'function') window.exportBillingSummaryPdf();
      else showToast('Billing summary export not available', 'error');
    });
  }

  var billBtn = document.getElementById('wf-billing-done');
  if (billBtn) {
    billBtn.addEventListener('click', function () {
      _wfRunMarkBillingComplete(ctx);
    });
  }

  var doneBtn = document.getElementById('wf-complete-done');
  if (doneBtn && !ctx.officeOk) {
    doneBtn.addEventListener('click', function () {
      _wfRunMarkOfficeComplete(ctx);
    });
  }

  var archBtn = document.getElementById('wf-complete-archive');
  if (archBtn) {
    archBtn.addEventListener('click', function () {
      _wfRunArchiveFromWorkflow();
    });
  }
}

function _wfRunMarkBillingComplete(ctx) {
  if (!ctx.noteOk) {
    showToast('Finalise the attendance note before marking billing complete.', 'error');
    return;
  }
  showConfirm(
    'Mark the billing process as completed for this matter?\n\nUse this after invoicing / firm finance steps are done. You can archive the record next.',
    'Billing process complete'
  ).then(function (ok) {
    if (!ok) return;
    if (!currentAttendanceId || !window.api || !window.api.attendanceSave) {
      showToast('Cannot save — open a saved record first.', 'error');
      return;
    }
    var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
    var st = typeof currentRecordStatus !== 'undefined' ? currentRecordStatus : 'finalised';
    var iso = new Date().toISOString();
    if (typeof formData === 'object' && formData) {
      formData.billingProcessCompletedAt = iso;
    }
    data.billingProcessCompletedAt = iso;

    window.api.attendanceSave({ id: currentAttendanceId, data: data, status: st }).then(function (result) {
      if (result && typeof result === 'object' && result.error) {
        showToast(result.message || result.error || 'Save failed', 'error', 7000);
        return;
      }
      if (typeof updateFormBarVisibility === 'function') updateFormBarVisibility();
      if (typeof updateBillingReadinessPanel === 'function') updateBillingReadinessPanel();
      if (typeof updateFormContextPanel === 'function') updateFormContextPanel();
      showToast('Billing marked complete. You can archive this record when ready.', 'success', 6000);
      _wfRenderCurrentStep();
    }).catch(function (err) {
      showToast('Could not save: ' + (err && err.message ? err.message : String(err)), 'error');
    });
  });
}

function _wfRunArchiveFromWorkflow() {
  if (typeof window.matterBillingArchiveReady === 'function' && !window.matterBillingArchiveReady()) {
    showToast('Complete billing handover (or office work) before archiving.', 'error');
    return;
  }
  if (!currentAttendanceId) return;
  showConfirm(
    'Archive this record? It will be hidden from the main list but you can restore it from the Archived filter.',
    'Archive record'
  ).then(function (ok) {
    if (!ok) return;
    if (!window.api || !window.api.attendanceArchive) {
      showToast('Archive is not available.', 'error');
      return;
    }
    window.api.attendanceArchive(currentAttendanceId).then(function () {
      if (typeof closeWorkflow === 'function') closeWorkflow();
      showToast('Record archived', 'info');
      if (typeof setListFilterAndShowList === 'function') setListFilterAndShowList('archived');
    }).catch(function () {
      showToast('Failed to archive record', 'error');
    });
  });
}

function _wfRunMarkOfficeComplete(ctx) {
  var blockers = [];
  if (!ctx.noteOk) blockers.push('The attendance note is not finalised.');
  if (ctx.qfOn && !ctx.invOk) blockers.push('QuickFile is set up but this record has no linked invoice.');
  if (ctx.attMeta.count && !ctx.attMeta.allNamed) blockers.push('Some attachments do not have a document type selected.');

  var intro = 'Mark office work complete for this matter?\n\n';
  if (blockers.length) {
    intro += 'Outstanding:\n\u2022 ' + blockers.join('\n\u2022 ') + '\n\n';
    intro += 'You can go back to fix these, or continue if you intentionally leave them open.\n\nContinue anyway?';
  } else {
    intro += 'This confirms admin on the file is finished (separate from the legal finalised note). Mark billing complete before archiving if you have not already.';
  }

  showConfirm(intro, 'Mark office work complete').then(function (ok) {
    if (!ok) return;
    if (!currentAttendanceId || !window.api || !window.api.attendanceSave) {
      showToast('Cannot save — open a saved record first.', 'error');
      return;
    }
    var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
    if (typeof formData === 'object' && formData) {
      formData.officeWorkCompletedAt = new Date().toISOString();
    }
    data.officeWorkCompletedAt = new Date().toISOString();

    window.api.attendanceSave({ id: currentAttendanceId, data: data, status: 'completed' }).then(function (result) {
      if (result && typeof result === 'object' && result.error) {
        showToast(result.message || result.error || 'Save failed', 'error', 7000);
        return;
      }
      currentRecordStatus = 'completed';
      if (typeof updateFormBarVisibility === 'function') updateFormBarVisibility();
      if (typeof updateBillingReadinessPanel === 'function') updateBillingReadinessPanel();
      if (typeof updateFormContextPanel === 'function') updateFormContextPanel();
      showToast('Office work marked complete. You can archive when ready.', 'success', 6500);
      _wfRenderCurrentStep();
    }).catch(function (err) {
      showToast('Could not mark complete: ' + (err && err.message ? err.message : String(err)), 'error');
    });
  });
}

function _wfAfterInvoiceCreatedGoToCompletion() {
  if (typeof _wfGoToStep !== 'function') return;
  _wfGoToStep(2);
}

function _wfBuildBillingSummaryCard(d) {
  if (!d) return '';
  var travelSoc = parseInt(d.travelSocial) || 0;
  var travelUns = parseInt(d.travelUnsocial) || 0;
  var waitSoc = parseInt(d.waitingSocial) || 0;
  var waitUns = parseInt(d.waitingUnsocial) || 0;
  var advSoc = parseInt(d.adviceSocial) || 0;
  var advUns = parseInt(d.adviceUnsocial) || 0;
  var totalMins = parseInt(d.totalMinutes) || 0;
  var miles = parseFloat(d.milesClaimable) || 0;
  var parking = parseFloat(d.parkingCost) || 0;
  var disbTotal = 0;
  if (d.disbursements && Array.isArray(d.disbursements)) {
    d.disbursements.forEach(function (x) { disbTotal += parseFloat(x && x.amount) || 0; });
  }

  var LAA = (typeof window !== 'undefined' && window.LAA) ? window.LAA : { fixedFee: 320, escapeThreshold: 650, mileageRate: 0.45, vatRate: 0.20, national: { attendance: { social: 54.57, unsocial: 72.46 }, travel: { social: 27.29, unsocial: 27.29 }, waiting: { social: 27.29, unsocial: 27.29 } } };
  var rates = LAA.national || {};

  function laaVal(mins, rate) { return (mins / 60) * rate; }
  var travelVal = laaVal(travelSoc, (rates.travel || {}).social || 27.29) + laaVal(travelUns, (rates.travel || {}).unsocial || 27.29);
  var waitVal = laaVal(waitSoc, (rates.waiting || {}).social || 27.29) + laaVal(waitUns, (rates.waiting || {}).unsocial || 27.29);
  var advVal = laaVal(advSoc, (rates.attendance || {}).social || 54.57) + laaVal(advUns, (rates.attendance || {}).unsocial || 72.46);
  var mileVal = miles * (LAA.mileageRate || 0.45);
  var net = travelVal + waitVal + advVal + mileVal + parking + disbTotal;
  var vat = net * (LAA.vatRate || 0.20);
  var total = net + vat;
  var isEscape = net > (LAA.escapeThreshold || 650);
  var feeType = isEscape
    ? '<span style="color:#b91c1c;font-weight:600;">ESCAPE FEE \u2014 claim exceeds \u00A3' + (LAA.escapeThreshold || 650).toFixed(0) + '</span>'
    : '<span style="color:#059669;">FIXED FEE (\u00A3' + (LAA.fixedFee || 320).toFixed(0) + ' inc. VAT)</span>';

  function fmtCurr(v) { return '\u00A3' + (v || 0).toFixed(2); }
  function timeRow(label, soc, uns, rate) {
    var tot = soc + uns;
    if (tot === 0) return '';
    var val = laaVal(soc, rate) + laaVal(uns, rate);
    return '<tr><td>' + label + '</td><td style="text-align:right;">' + soc + '</td><td style="text-align:right;">' + uns + '</td><td style="text-align:right;">' + tot + '</td><td style="text-align:right;">' + fmtCurr(val) + '</td></tr>';
  }

  var html = '<div class="wf-card">' +
    '<h4 class="wf-card-title">Billing Summary (LAA rates)</h4>' +
    '<table class="wf-billing-summary-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
    '<thead><tr style="border-bottom:2px solid var(--border-color,#e2e8f0);"><th style="text-align:left;">Category</th><th style="text-align:right;">Social</th><th style="text-align:right;">Unsocial</th><th style="text-align:right;">Total</th><th style="text-align:right;">Value</th></tr></thead>' +
    '<tbody>' +
    timeRow('Travel', travelSoc, travelUns, (rates.travel || {}).social || 27.29) +
    timeRow('Waiting', waitSoc, waitUns, (rates.waiting || {}).social || 27.29) +
    timeRow('Attendance & Advice', advSoc, advUns, (rates.attendance || {}).social || 54.57);

  if (advSoc > 0 && advUns > 0) {
    html += '<tr style="font-size:0.78rem;color:var(--text-muted,#94a3b8);"><td colspan="4" style="text-align:right;">Advice social: ' + advSoc + ' min \u00D7 \u00A3' + ((rates.attendance || {}).social || 54.57).toFixed(2) + '/hr + unsocial: ' + advUns + ' min \u00D7 \u00A3' + ((rates.attendance || {}).unsocial || 72.46).toFixed(2) + '/hr</td><td></td></tr>';
  }

  html += '<tr style="border-top:1px solid var(--border-color,#e2e8f0);font-weight:600;"><td>Total time</td><td></td><td></td><td style="text-align:right;">' + totalMins + ' min</td><td style="text-align:right;">' + fmtCurr(travelVal + waitVal + advVal) + '</td></tr>';

  if (miles > 0) html += '<tr><td>Mileage (' + miles + ' mi \u00D7 \u00A3' + (LAA.mileageRate || 0.45).toFixed(2) + ')</td><td></td><td></td><td></td><td style="text-align:right;">' + fmtCurr(mileVal) + '</td></tr>';
  if (parking > 0) html += '<tr><td>Parking</td><td></td><td></td><td></td><td style="text-align:right;">' + fmtCurr(parking) + '</td></tr>';
  if (disbTotal > 0) html += '<tr><td>Disbursements</td><td></td><td></td><td></td><td style="text-align:right;">' + fmtCurr(disbTotal) + '</td></tr>';

  html += '<tr style="border-top:2px solid var(--border-color,#e2e8f0);"><td><strong>Net</strong></td><td></td><td></td><td></td><td style="text-align:right;"><strong>' + fmtCurr(net) + '</strong></td></tr>';
  html += '<tr><td>VAT (20%)</td><td></td><td></td><td></td><td style="text-align:right;">' + fmtCurr(vat) + '</td></tr>';
  html += '<tr style="font-weight:700;font-size:1rem;"><td>Total (inc. VAT)</td><td></td><td></td><td></td><td style="text-align:right;">' + fmtCurr(total) + '</td></tr>';
  html += '</tbody></table>';
  html += '<p style="margin:0.75rem 0 0;font-size:0.85rem;">' + feeType + '</p>';
  html += '</div>';
  return html;
}
