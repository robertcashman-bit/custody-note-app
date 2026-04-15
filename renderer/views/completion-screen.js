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

  var rows = [
    { key: 'note', label: 'Attendance note finalised', ok: noteOk, hint: !noteOk ? 'Finalise the note on the form first.' : '' },
    { key: 'inv', label: 'QuickFile invoice linked', ok: invOk, hint: (!invOk && qfOn) ? 'Create the invoice in step 2 (QuickFile).' : (!invOk && !qfOn ? 'QuickFile not configured — add settings if you use invoicing here.' : '') },
    { key: 'att', label: 'Attachments named on file', ok: am.count === 0 || am.allNamed, hint: am.count && !am.allNamed ? 'Name every attachment (document type) on step 1 or the form.' : (am.count === 0 ? 'No attachments on this record — confirm if that is correct for this matter.' : '') },
    { key: 'bill', label: 'Billing process completed', ok: billingOk, hint: billingOk ? 'Recorded for your firm billing / finance handover.' : 'Confirm when your office billing steps are done, then you can archive.' },
    { key: 'off', label: 'Office work marked complete', ok: officeOk, hint: officeOk ? 'This matter is marked complete in your workflow.' : 'Use the button below when admin on this file is finished.' },
  ];

  var strip = '<div class="wf-completion-strip">';
  rows.forEach(function (r) {
    strip += '<div class="wf-completion-row ' + (r.ok ? 'wf-completion-row--ok' : 'wf-completion-row--pending') + '">' +
      '<span class="wf-completion-icon">' + (r.ok ? '&#10003;' : '&#9711;') + '</span>' +
      '<span class="wf-completion-label">' + _wfEsc(r.label) + '</span>' +
      (r.hint ? '<span class="wf-completion-hint">' + _wfEsc(r.hint) + '</span>' : '') +
      '</div>';
  });
  strip += '</div>';

  body.innerHTML =
    '<div class="wf-screen wf-completion">' +
      '<div class="wf-screen-header">' +
        '<h3>Review &amp; mark complete</h3>' +
        '<p class="wf-screen-sub">Confirm this police station matter is fully dealt with in the office: invoiced where you use QuickFile, documents in order, billing handover recorded, then archive when you are ready.</p>' +
      '</div>' +
      '<div class="wf-card">' +
        '<h4 class="wf-card-title">Progress</h4>' +
        strip +
      '</div>' +
      '<div class="wf-card wf-completion-save-note">' +
        '<p class="settings-hint" style="margin:0;">You can close this window anytime — your place in these steps is remembered until you finish or clear browser data. Draft changes still autosave until the note is finalised.</p>' +
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
    '<button type="button" id="wf-complete-back" class="btn btn-secondary">&#9664; Back</button>';

  if (ctx.showBillingBtn) {
    html += '<button type="button" id="wf-billing-done" class="btn btn-primary">Mark billing process complete</button>';
  }

  if (!ctx.officeOk) {
    html += '<button type="button" id="wf-complete-done" class="btn ' + (ctx.showBillingBtn ? 'btn-secondary' : 'btn-primary') + '">Mark office work complete</button>';
  } else {
    html += '<button type="button" id="wf-complete-done" class="btn btn-secondary" disabled>Office work complete</button>';
  }

  if (canArchive) {
    html += '<button type="button" id="wf-complete-archive" class="btn btn-primary">Archive record</button>';
  }

  html +=
    '<button type="button" id="wf-complete-close" class="btn btn-secondary">Close</button>';

  footer.innerHTML = html;

  document.getElementById('wf-complete-back').addEventListener('click', _wfGoBack);
  document.getElementById('wf-complete-close').addEventListener('click', closeWorkflow);

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
