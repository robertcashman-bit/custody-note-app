/* Officer Emails — right-hand context panel (v1.9). Depends on window.api.officerEmails, formData, currentAttendanceId, showToast, showConfirm, showChoice. */
(function (global) {
  'use strict';

  var TEMPLATE_OPTIONS = (typeof OFFICER_EMAIL_TEMPLATE_OPTIONS !== 'undefined')
    ? OFFICER_EMAIL_TEMPLATE_OPTIONS
    : [];
  var Layout = global.OfficerEmailComposeLayout;
  var DT = global.OfficerEmailDateTime;
  var PREFIX = 'oep';

  var STATUS_LABELS = {
    draft: 'Draft',
    ready_for_outlook: 'Ready for Outlook',
    opened_in_outlook: 'Opened in Outlook',
    sent_manually: 'Sent manually',
    cancelled: 'Cancelled',
    deleted: 'Deleted',
  };

  var host = null;
  var selectedDraftId = null;
  var lastAttachedCustodyNoteId = null;
  var lastGenSig = '';
  var dirtySubjectBody = false;
  var autoGenerateTimer = null;
  var els = {};
  var recipientApi = null;
  var whenPicker = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getFormDataSafe() {
    try {
      return typeof formData !== 'undefined' && formData ? formData : {};
    } catch (_) {
      return {};
    }
  }

  function getCurrentAttendanceIdSafe() {
    try {
      return typeof currentAttendanceId !== 'undefined' ? currentAttendanceId : null;
    } catch (_) {
      return null;
    }
  }

  function buildShell() {
    if (!host || !Layout) return;
    host.innerHTML =
      '<div class="form-panel-card-label">Officer Emails</div>' +
      '<p id="oep-locked" class="officer-email-panel-hint hidden">Save the custody note before creating email drafts.</p>' +
      '<div id="oep-main" class="officer-email-panel-inner">' +
      '<div class="officer-email-compose-grid officer-email-panel-compose-grid">' +
      '<section class="officer-email-compose-form-card">' +
      '<div class="officer-email-compose-form">' + Layout.buildFormStepsHtml(PREFIX, { showFilledBadge: true }) + '</div>' +
      '<div class="officer-email-panel-draft-toolbar">' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-new">New draft</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-clear">Clear fields</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-save">Save draft</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-dup">Duplicate</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-cancel">Cancel draft</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-del">Delete</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-sent">Mark as sent</button>' +
      '</div></section>' +
      '<section class="officer-email-compose-preview-card">' + Layout.buildPreviewHtml(PREFIX) + '</section>' +
      '</div>' +
      '<div class="officer-email-drafts-head">Saved drafts for this custody note</div>' +
      '<div id="oep-drafts" class="officer-email-draft-list"></div>' +
      '</div>';

    var sel = host.querySelector('#' + PREFIX + '-template');
    sel.innerHTML = Layout.templateOptionsHtml();
    sel.dataset.oepLast = sel.value;

    els = {
      locked: host.querySelector('#oep-locked'),
      main: host.querySelector('#oep-main'),
      template: sel,
      templateChips: host.querySelector('[data-role="template-chips"]'),
      whenTitle: host.querySelector('#' + PREFIX + '-when-title'),
      whenMount: host.querySelector('#' + PREFIX + '-when-mount'),
      bailExtra: host.querySelector('#' + PREFIX + '-bail-extra'),
      recipientsHost: host.querySelector('#' + PREFIX + '-recipients'),
      multiOfficer: host.querySelector('#' + PREFIX + '-multi-officer'),
      dutySolicitor: host.querySelector('#' + PREFIX + '-duty-solicitor'),
      outlookSig: host.querySelector('#' + PREFIX + '-outlook-sig'),
      client: host.querySelector('#' + PREFIX + '-client'),
      station: host.querySelector('#' + PREFIX + '-station'),
      offence: host.querySelector('#' + PREFIX + '-offence'),
      bailCond: host.querySelector('#' + PREFIX + '-bail-cond'),
      extra: host.querySelector('#' + PREFIX + '-extra'),
      userEmail: host.querySelector('#' + PREFIX + '-user-email'),
      previewTo: host.querySelector('#' + PREFIX + '-preview-to'),
      subject: host.querySelector('#' + PREFIX + '-subject'),
      body: host.querySelector('#' + PREFIX + '-body'),
      refreshBtn: host.querySelector('#' + PREFIX + '-refresh'),
      drafts: host.querySelector('#oep-drafts'),
    };

    if (global.OfficerEmailDateTimePicker && els.whenMount) {
      whenPicker = global.OfficerEmailDateTimePicker.init(els.whenMount, {
        prefix: PREFIX,
        onChange: scheduleAutoGenerate,
      });
    }

    if (global.OfficerEmailRecipientRows && els.recipientsHost) {
      recipientApi = global.OfficerEmailRecipientRows.initRecipientBlock(els.recipientsHost, {
        prefix: 'oep',
        onInput: scheduleAutoGenerate,
        dutyCheckbox: els.dutySolicitor,
        multiOfficerCheckbox: els.multiOfficer,
      });
      global.OfficerEmailRecipientRows.bindOutlookSigCheckbox(els.outlookSig, scheduleAutoGenerate);
    }

    if (els.templateChips) {
      els.templateChips.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-template]');
        if (!btn) return;
        els.template.value = btn.getAttribute('data-template');
        els.template.dispatchEvent(new Event('change'));
      });
    }

    els.template.addEventListener('change', onTemplateChange);
    els.subject.addEventListener('input', function () { dirtySubjectBody = true; updateRefreshVisibility(); });
    els.body.addEventListener('input', function () { dirtySubjectBody = true; updateRefreshVisibility(); });
    [els.client, els.station, els.offence, els.extra, els.userEmail, els.bailCond].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', scheduleAutoGenerate);
    });
    if (els.refreshBtn) {
      els.refreshBtn.addEventListener('click', function () {
        dirtySubjectBody = false;
        generateFromTemplate(true);
      });
    }

    host.querySelector('#oep-new').addEventListener('click', newDraft);
    host.querySelector('#oep-clear').addEventListener('click', clearForm);
    host.querySelector('#oep-save').addEventListener('click', saveDraft);
    host.querySelector('#oep-dup').addEventListener('click', duplicateDraft);
    host.querySelector('#oep-cancel').addEventListener('click', cancelDraft);
    host.querySelector('#oep-del').addEventListener('click', deleteDraft);
    host.querySelector('#' + PREFIX + '-open').addEventListener('click', openOutlookClicked);
    host.querySelector('#' + PREFIX + '-copy-owa').addEventListener('click', copyOutlookLinkClicked);
    host.querySelector('#' + PREFIX + '-copy-to').addEventListener('click', function () {
      var rec = recipientApi ? recipientApi.getValues() : { toEmail: '' };
      copyField(rec.toEmail, 'Copied.');
    });
    host.querySelector('#' + PREFIX + '-copy-sub').addEventListener('click', function () { copyField(els.subject.value, 'Copied.'); });
    host.querySelector('#' + PREFIX + '-copy-body').addEventListener('click', function () { copyField(els.body.value, 'Copied.'); });
    host.querySelector('#oep-sent').addEventListener('click', markSentClicked);
  }

  function updateRefreshVisibility() {
    if (els.refreshBtn) els.refreshBtn.classList.toggle('hidden', !dirtySubjectBody);
  }

  function updatePreviewTo() {
    if (!els.previewTo) return;
    var rec = recipientApi ? recipientApi.getValues() : { toEmail: '' };
    els.previewTo.textContent = rec.toEmail || '—';
  }

  function cancelPendingAutoGenerate() {
    if (autoGenerateTimer) {
      clearTimeout(autoGenerateTimer);
      autoGenerateTimer = null;
    }
  }

  function syncTemplateUi(optionsSync) {
    var o = optionsSync || {};
    var tt = els.template.value;
    if (whenPicker && whenPicker.setTemplateType) {
      whenPicker.setTemplateType(tt, { silent: !!o.silent });
    }
    Layout.syncTemplateChipSelection(els.templateChips, tt);
    Layout.updateWhenTitle(els.whenTitle, tt);
    Layout.syncBailExtraVisibility(els.bailExtra, tt);
  }

  function syncBailVisibility(optionsSync) {
    syncTemplateUi(optionsSync);
  }

  function onTemplateChange() {
    var sel = els.template;
    var prev = sel && sel.dataset && sel.dataset.oepLast != null ? sel.dataset.oepLast : '';
    var next = sel ? sel.value : '';
    syncBailVisibility();
    if (!dirtySubjectBody) {
      generateFromTemplate(false);
      if (sel) sel.dataset.oepLast = next;
      return;
    }
    if (typeof window.showChoice !== 'function') {
      if (typeof showConfirm !== 'function') {
        generateFromTemplate(false);
        if (sel) sel.dataset.oepLast = next;
        return;
      }
      showConfirm(
        'Changing template may overwrite your edited subject and body. Continue?',
        'Change template'
      ).then(function (ok) {
        if (!ok) {
          if (sel) sel.value = prev || 'disclosure_confirm_attendance';
          syncBailVisibility({ silent: true });
          return;
        }
        generateFromTemplate(true);
        if (sel) sel.dataset.oepLast = sel.value;
      });
      return;
    }
    window.showChoice(
      'Changing template may overwrite your edited subject and body.',
      'Change template',
      [
        { id: 'keep', label: 'Keep current draft', variant: 'primary' },
        { id: 'apply', label: 'Apply new template', variant: 'secondary' },
      ]
    ).then(function (choice) {
      if (choice !== 'apply') {
        if (sel) sel.value = prev || 'disclosure_confirm_attendance';
        syncBailVisibility({ silent: true });
        return;
      }
      generateFromTemplate(true);
      if (sel) sel.dataset.oepLast = sel.value;
    });
  }

  function getSignOffNameSafe() {
    try {
      var s = (typeof window !== 'undefined' && window._appSettingsCache) ? window._appSettingsCache : {};
      return (s.feeEarnerNameDefault || s.feeEarnerName || '').trim();
    } catch (_) {
      return '';
    }
  }

  function collectFields() {
    var rec = recipientApi ? recipientApi.getValues() : { toEmail: '', recipientName: '' };
    var when = whenPicker ? whenPicker.getValues(els.template.value) : {
      attendanceDate: '', attendanceTime: '', bailReturnDate: '', bailReturnTime: '',
    };
    return {
      templateType: els.template.value,
      toEmail: rec.toEmail,
      recipientName: rec.recipientName,
      actingAsDutySolicitor: !!(els.dutySolicitor && els.dutySolicitor.checked),
      outlookSignatureIncludesName: !!(els.outlookSig && els.outlookSig.checked),
      clientName: els.client.value,
      policeStation: els.station.value,
      attendanceDate: when.attendanceDate,
      attendanceTime: when.attendanceTime,
      offence: els.offence.value,
      extraNote: els.extra.value,
      bailReturnDate: when.bailReturnDate,
      bailReturnTime: when.bailReturnTime,
      bailConditions: els.bailCond ? els.bailCond.value : '',
      userEmailAddress: els.userEmail.value,
      signOffName: getSignOffNameSafe(),
      subject: els.subject.value,
      body: els.body.value,
    };
  }

  function applyWhenValues(attendanceDate, attendanceTime, bailReturnDate, bailReturnTimeOrOpts, maybeOpts) {
    if (!whenPicker) return;
    var bailReturnTime = '';
    var o = {};
    if (typeof bailReturnTimeOrOpts === 'object' && bailReturnTimeOrOpts != null) {
      o = bailReturnTimeOrOpts;
    } else {
      bailReturnTime = bailReturnTimeOrOpts || '';
      o = maybeOpts || {};
    }
    whenPicker.setValues({
      templateType: els.template.value,
      attendanceDate: attendanceDate,
      attendanceTime: attendanceTime,
      bailReturnDate: bailReturnDate,
      bailReturnTime: bailReturnTime,
    }, o);
  }

  function scheduleAutoGenerate() {
    if (dirtySubjectBody) return;
    if (autoGenerateTimer) clearTimeout(autoGenerateTimer);
    autoGenerateTimer = setTimeout(function () {
      autoGenerateTimer = null;
      generateFromTemplate(false);
      updatePreviewTo();
    }, 120);
  }

  function applyPrefillFromMatter() {
    var fd = getFormDataSafe();
    var name = [fd.forename, fd.surname].filter(Boolean).join(' ').trim();
    if (!els.client.value.trim() && name) els.client.value = name;
    if (!els.station.value.trim() && fd.policeStationName) els.station.value = fd.policeStationName;
    var isBail = DT && DT.isBailTemplate(els.template.value);
    var whenVals = whenPicker ? whenPicker.getValues(els.template.value) : { attendanceDate: '', attendanceTime: '', bailReturnDate: '' };
    if (isBail) {
      if (!whenVals.attendanceDate && fd.date) {
        whenPicker.setAttendanceDateOnly(fd.date, { silent: true });
      }
      if (!whenVals.bailReturnDate && fd.bailDate) {
        applyWhenValues(
          whenVals.attendanceDate || fd.date || '',
          whenVals.attendanceTime,
          String(fd.bailDate).trim(),
          whenVals.bailReturnTime,
          { silent: true }
        );
      }
      if (!whenVals.bailReturnTime && fd.bailReturnTime) {
        applyWhenValues(
          whenVals.attendanceDate || fd.date || '',
          whenVals.attendanceTime,
          whenVals.bailReturnDate || (fd.bailDate ? String(fd.bailDate).trim() : ''),
          String(fd.bailReturnTime).trim(),
          { silent: true }
        );
      }
    } else {
      if (!whenVals.attendanceDate && fd.date) {
        applyWhenValues(fd.date, whenVals.attendanceTime, '', { silent: true });
      }
      if (!whenVals.attendanceTime) {
        var arrivalTime = fd.timeArrival || fd.timeArrivalStation || '';
        if (arrivalTime) {
          applyWhenValues(whenVals.attendanceDate || fd.date || '', String(arrivalTime).trim(), '', { silent: true });
        }
      }
    }
    if (!els.offence.value.trim() && fd.offenceSummary) els.offence.value = fd.offenceSummary;
    var recVals = recipientApi ? recipientApi.getValues() : { toEmail: '', recipientName: '' };
    if (!recVals.recipientName && fd.oicName && recipientApi) {
      recipientApi.setValues(recVals.toEmail, String(fd.oicName).trim());
      recVals = recipientApi.getValues();
    }
    if (!recVals.toEmail && recipientApi) {
      var oicEmail = (fd.oicEmail || '').trim();
      var disclosureEmail = (fd.disclosureOfficerEmail || '').trim();
      var email = '';
      if (oicEmail) email = oicEmail;
      else if (fd.disclosureOfficerIsOIC === 'No' && disclosureEmail) email = disclosureEmail;
      if (email) {
        recipientApi.setValues(email, recVals.recipientName || (fd.oicName ? String(fd.oicName).trim() : ''));
      }
    }
  }

  function clearForm() {
    Object.keys(els).forEach(function (key) {
      if (!els[key] || !('value' in els[key])) return;
      if (key === 'template' || key === 'recipientsHost' || key === 'dutySolicitor' || key === 'outlookSig') return;
      if (els[key].type === 'checkbox') {
        els[key].checked = false;
        return;
      }
      els[key].value = '';
    });
    if (recipientApi) recipientApi.setValues('', '');
    if (els.dutySolicitor && global.OfficerEmailRecipientRows) {
      els.dutySolicitor.checked = global.OfficerEmailRecipientRows.readDutySolicitorPreference();
    }
    if (els.outlookSig && global.OfficerEmailRecipientRows) {
      els.outlookSig.checked = global.OfficerEmailRecipientRows.readOutlookSigPreference();
    }
    if (els.template) {
      els.template.value = 'disclosure_confirm_attendance';
      els.template.dataset.oepLast = els.template.value;
    }
    selectedDraftId = null;
    dirtySubjectBody = false;
    if (whenPicker) whenPicker.clear({ silent: true });
    syncBailVisibility({ silent: true });
    applyPrefillFromMatter();
    generateFromTemplate(true);
    if (recipientApi) recipientApi.focusFirstEmail();
  }

  function generateFromTemplate(forceApply) {
    if (!window.api || !window.api.officerEmails || !window.api.officerEmails.buildPreview) {
      return Promise.resolve({ ok: false, error: 'Officer email preview is not available.' });
    }
    updatePreviewTo();
    var f = collectFields();
    f.extraNote = f.extraNote;
    return window.api.officerEmails.buildPreview(f).then(function (res) {
      if (!res || !res.ok) {
        if (typeof showToast === 'function') showToast((res && res.error) || 'Could not build preview', 'error');
        return res || { ok: false, error: 'Could not build preview' };
      }
      if (forceApply || !dirtySubjectBody) {
        els.subject.value = res.subject || '';
        els.body.value = res.body || '';
        dirtySubjectBody = false;
        updateRefreshVisibility();
        lastGenSig = (res.subject || '') + '\n' + (res.body || '');
      }
      return res;
    }).catch(function (err) {
      if (typeof showToast === 'function') showToast('Could not build preview.', 'error', 7000);
      try { console.error('[officerEmailsPanel] buildPreview failed', err); } catch (_) {}
      return { ok: false, error: (err && err.message) || String(err) };
    });
  }

  function newDraft() {
    cancelPendingAutoGenerate();
    selectedDraftId = null;
    if (recipientApi) recipientApi.setValues('', '');
    els.extra.value = '';
    els.userEmail.value = '';
    if (els.bailCond) els.bailCond.value = '';
    dirtySubjectBody = false;
    if (whenPicker) whenPicker.clear({ silent: true });
    applyPrefillFromMatter();
    generateFromTemplate(true);
  }

  function saveDraft(opts) {
    var options = opts || {};
    var aid = getCurrentAttendanceIdSafe();
    if (!aid) {
      if (typeof showToast === 'function') showToast('Please save the custody note before creating email drafts.', 'error');
      return Promise.resolve({ ok: false, errors: ['Save the custody note before creating email drafts.'] });
    }
    var payload = Object.assign({ custodyNoteId: String(aid) }, collectFields());
    var p = selectedDraftId
      ? window.api.officerEmails.updateDraft(selectedDraftId, payload)
      : window.api.officerEmails.createDraft(payload);
    return p.then(function (res) {
      if (!res || !res.ok) {
        if (typeof showToast === 'function') showToast((res && res.errors && res.errors[0]) || 'Draft could not be saved', 'error');
        return res || { ok: false, errors: ['Draft could not be saved'] };
      }
      selectedDraftId = res.draft && res.draft.id;
      if (!options.silent && typeof showToast === 'function') showToast('Draft saved', 'success');
      loadDrafts();
      return res;
    }).catch(function () {
      if (typeof showToast === 'function') showToast('Draft could not be saved. Please try again.', 'error');
      return { ok: false, errors: ['The draft could not be saved. Please try again.'] };
    });
  }

  function duplicateDraft() {
    if (!selectedDraftId) { saveDraft(); return; }
    window.api.officerEmails.duplicateDraft(selectedDraftId).then(function (res) {
      if (!res || !res.ok) {
        if (typeof showToast === 'function') showToast('Could not duplicate', 'error');
        return;
      }
      selectedDraftId = res.draft && res.draft.id;
      loadDraftIntoForm(res.draft);
      if (typeof showToast === 'function') showToast('Duplicate created', 'success');
      loadDrafts();
    });
  }

  function runCancelDraft(id) {
    window.api.officerEmails.cancelDraft(id).then(function (res) {
      if (res && res.ok) {
        if (typeof showToast === 'function') showToast('Draft cancelled', 'info');
        if (selectedDraftId === id) newDraft();
        loadDrafts();
      }
    });
  }

  function cancelDraft() {
    if (!selectedDraftId) return;
    if (typeof window.showChoice === 'function') {
      window.showChoice('Cancel this draft?', 'Cancel draft', [
        { id: 'keep', label: 'Keep Draft', variant: 'primary' },
        { id: 'cancel', label: 'Cancel Draft', variant: 'danger' },
      ]).then(function (choice) {
        if (choice !== 'cancel') return;
        runCancelDraft(selectedDraftId);
      });
      return;
    }
    if (typeof showConfirm !== 'function') return;
    showConfirm('Cancel this draft?', 'Cancel draft').then(function (ok) {
      if (!ok) return;
      runCancelDraft(selectedDraftId);
    });
  }

  function runDeleteDraft(id) {
    window.api.officerEmails.deleteDraft(id).then(function (res) {
      if (res && res.ok) {
        if (typeof showToast === 'function') showToast('Draft deleted', 'info');
        if (selectedDraftId === id) newDraft();
        loadDrafts();
      }
    });
  }

  function deleteDraft() {
    if (!selectedDraftId) return;
    if (typeof window.showChoice === 'function') {
      window.showChoice('Are you sure you want to delete this draft?', 'Delete draft', [
        { id: 'abort', label: 'Cancel', variant: 'secondary' },
        { id: 'del', label: 'Delete Draft', variant: 'danger' },
      ]).then(function (choice) {
        if (choice !== 'del') return;
        runDeleteDraft(selectedDraftId);
      });
      return;
    }
    if (typeof showConfirm !== 'function') return;
    showConfirm('Are you sure you want to delete this draft?', 'Delete draft').then(function (ok) {
      if (!ok) return;
      runDeleteDraft(selectedDraftId);
    });
  }

  function markSentClicked() {
    if (!selectedDraftId) { if (typeof showToast === 'function') showToast('Save the draft first.', 'error'); return; }
    function doMark() {
      window.api.officerEmails.markSentManually(selectedDraftId).then(function (res) {
        if (res && res.ok) {
          if (typeof showToast === 'function') showToast('Marked as sent manually', 'success');
          loadDrafts();
        } else if (typeof showToast === 'function') {
          showToast((res && res.errors && res.errors[0]) || 'Invalid status', 'error');
        }
      });
    }
    if (typeof window.showChoice === 'function') {
      window.showChoice(
        'Only mark this as sent if you have sent it manually in Outlook Web.',
        'Mark as sent',
        [
          { id: 'keep', label: 'Keep as-is', variant: 'secondary' },
          { id: 'sent', label: 'Mark as sent manually', variant: 'primary' },
        ]
      ).then(function (choice) {
        if (choice !== 'sent') return;
        doMark();
      });
      return;
    }
    if (typeof showConfirm !== 'function') return;
    showConfirm(
      'Only mark this as sent if you have sent it manually in Outlook Web.',
      'Mark as sent'
    ).then(function (ok) {
      if (!ok) return;
      doMark();
    });
  }

  function openOutlookClicked() {
    if (!dirtySubjectBody) {
      generateFromTemplate(true).then(function (res) {
        if (res && res.ok) openOutlookClickedAfterPreview();
      });
      return;
    }
    openOutlookClickedAfterPreview();
  }

  function openOutlookClickedAfterPreview() {
    var f = collectFields();
    var to = String(f.toEmail || '').trim();
    var sub = els.subject.value.trim();
    var bod = els.body.value.trim();
    var emailList = to.split(/[;,]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!emailList.length) {
      if (typeof showToast === 'function') showToast('Please enter a recipient email address.', 'error', 5000);
      return;
    }
    if (!sub) {
      if (typeof showToast === 'function') showToast('Please enter a subject before opening Outlook.', 'error', 5000);
      return;
    }
    if (!bod) {
      if (typeof showToast === 'function') showToast('Please enter an email body before opening Outlook.', 'error', 5000);
      return;
    }
    var warnings = [];
    emailList.forEach(function (em, idx) {
      var label = emailList.length > 1 ? 'Recipient ' + (idx + 1) : 'The recipient email address';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        warnings.push(label + ' does not look valid. Please check it carefully.');
      } else if (!isProfessionalDomain(em)) {
        warnings.push('Warning: ' + (emailList.length > 1 ? 'recipient ' + (idx + 1) : 'this recipient') +
          ' does not appear to be a recognised police, court, CPS, government, NHS, solicitor or professional email address. Please check carefully before proceeding.');
      }
    });
    var msg =
      'You are about to open this email in Outlook Web.\n\nTo:\n' + to + '\n\nSubject:\n' + sub + '\n\n' +
      (warnings.length ? warnings.join('\n\n') + '\n\n' : '') +
      'This app will not send the email. You must review and send it manually in Outlook Web.';
    function reportFatal(label, detail) {
      var fallback = 'Outlook Web could not be opened. The email content is still in the draft — try Copy Outlook link.';
      if (detail) fallback = fallback + ' (' + detail + ')';
      if (typeof showToast === 'function') showToast(fallback, 'error', 9000);
      else if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(fallback);
      try { console.warn('[officerEmailsPanel] ' + label + ': showToast undefined, fell back to alert/no-op'); } catch (_) {}
    }
    function doOpen() {
      var promise;
      try {
        promise = window.api.officerEmails.openOutlookDraft(selectedDraftId);
      } catch (syncErr) {
        try { console.error('[officerEmailsPanel] openOutlookDraft threw synchronously', syncErr); } catch (_) {}
        reportFatal('openOutlookDraft sync throw', (syncErr && syncErr.message) || String(syncErr));
        return;
      }
      if (!promise || typeof promise.then !== 'function') {
        try { console.error('[officerEmailsPanel] openOutlookDraft returned non-promise', promise); } catch (_) {}
        reportFatal('openOutlookDraft returned non-promise', 'IPC bridge unavailable');
        return;
      }
      promise.then(function (res) {
        try { console.info('[officerEmailsPanel] openOutlookDraft resolved', res); } catch (_) {}
        if (!res || !res.ok) {
          var errMsg = (res && res.errors && res.errors[0]) || 'Outlook Web could not be opened. You can still copy the recipient, subject and body manually.';
          if (typeof showToast === 'function') showToast(errMsg, 'error', 7000);
          else if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(errMsg);
          else try { console.warn('[officerEmailsPanel] openOutlookDraft not-ok with no toast/alert', res); } catch (_) {}
          return;
        }
        if (typeof showToast === 'function') {
          var openedMsg = res.method === 'outlook-desktop-eml'
            ? 'Opened Outlook draft with your message — review and send'
            : 'Opened in Outlook Web with your message — review and send';
          showToast(openedMsg, 'success', 5000);
        } else {
          try { console.warn('[officerEmailsPanel] openOutlookDraft ok but showToast undefined'); } catch (_) {}
        }
        loadDrafts();
      }).catch(function (err) {
        try { console.error('[officerEmailsPanel] openOutlookDraft rejected', err); } catch (_) {}
        reportFatal('openOutlookDraft rejected', (err && err.message) || String(err));
      });
    }
    function afterConfirm() {
      doOpen();
    }
    saveDraft({ silent: true }).then(function (saved) {
      if (!saved || !saved.ok || !selectedDraftId) {
        try { console.warn('[officerEmailsPanel] openOutlook aborted: saveDraft state', { saved: saved, selectedDraftId: selectedDraftId }); } catch (_) {}
        if (saved && saved.ok && !selectedDraftId) {
          if (typeof showToast === 'function') showToast('Draft saved but no draft id was returned, so Outlook Web cannot open. Please reopen the panel and try again.', 'error', 9000);
          else reportFatal('saveDraft ok but selectedDraftId empty', 'no draft id returned');
        }
        return;
      }
      if (typeof window.showChoice === 'function') {
        window.showChoice(msg, 'Open Outlook Web', [
          { id: 'abort', label: 'Cancel', variant: 'secondary' },
          { id: 'open', label: 'Open Outlook Web', variant: 'primary' },
        ]).then(function (choice) {
          if (choice !== 'open') return;
          afterConfirm();
        }).catch(function (err) {
          try { console.error('[officerEmailsPanel] showChoice rejected', err); } catch (_) {}
          reportFatal('showChoice rejected', (err && err.message) || String(err));
        });
        return;
      }
      if (typeof showConfirm !== 'function') {
        try { console.warn('[officerEmailsPanel] showChoice and showConfirm both undefined; using window.confirm fallback'); } catch (_) {}
        var ok = false;
        try {
          ok = (typeof window !== 'undefined' && typeof window.confirm === 'function')
            ? window.confirm(msg)
            : true;
        } catch (_) { ok = true; }
        if (ok) afterConfirm();
        return;
      }
      showConfirm(msg, 'Open Outlook Web').then(function (ok) {
        if (!ok) return;
        afterConfirm();
      }).catch(function (err) {
        try { console.error('[officerEmailsPanel] showConfirm rejected', err); } catch (_) {}
        reportFatal('showConfirm rejected', (err && err.message) || String(err));
      });
    }).catch(function (err) {
      try { console.error('[officerEmailsPanel] saveDraft rejected before Outlook open', err); } catch (_) {}
      reportFatal('saveDraft rejected', (err && err.message) || String(err));
    });
  }

  function copyOutlookLinkClicked() {
    if (!dirtySubjectBody) {
      generateFromTemplate(true).then(function (res) {
        if (res && res.ok) copyOutlookLinkClickedAfterPreview();
      });
      return;
    }
    copyOutlookLinkClickedAfterPreview();
  }

  function copyOutlookLinkClickedAfterPreview() {
    var f = collectFields();
    var to = String(f.toEmail || '').trim();
    var sub = els.subject.value.trim();
    var bod = els.body.value.trim();
    var emailList = to.split(/[;,]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!emailList.length) {
      if (typeof showToast === 'function') showToast('Please enter a recipient email address.', 'error', 5000);
      return;
    }
    if (!sub) {
      if (typeof showToast === 'function') showToast('Please enter a subject before copying the link.', 'error', 5000);
      return;
    }
    if (!bod) {
      if (typeof showToast === 'function') showToast('Please enter an email body before copying the link.', 'error', 5000);
      return;
    }
    if (!selectedDraftId) {
      if (typeof showToast === 'function') showToast('Save the draft first.', 'error', 5000);
      return;
    }
    if (!window.api || !window.api.officerEmails || !window.api.officerEmails.getComposeUrl) {
      if (typeof showToast === 'function') showToast('Copy Outlook link is not available.', 'error');
      return;
    }
    function onCopied(truncated, method) {
      var msg = 'Outlook compose link copied to clipboard.';
      if (method === 'outlook-desktop-eml' || truncated) {
        msg +=
          ' This link is recipient/subject only because the message is long — use Open Outlook to open a full draft with the body.';
      } else {
        msg += ' The link includes your message body.';
      }
      if (typeof showToast === 'function') showToast(msg, 'success', truncated ? 9000 : 4000);
    }
    saveDraft({ silent: true }).then(function (saved) {
      if (!saved || !saved.ok || !selectedDraftId) return;
      window.api.officerEmails.getComposeUrl({ draftId: selectedDraftId }).then(function (res) {
        if (!res || !res.ok) {
          if (typeof showToast === 'function') {
            showToast((res && res.errors && res.errors[0]) || 'Could not build Outlook link.', 'error', 7000);
          }
          return;
        }
        var url = res.url != null ? String(res.url) : '';
        var truncated = !!res.truncated;
        var method = res.method || '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            onCopied(truncated, method);
          }).catch(function () {
            if (window.api.officerEmails.copyText) {
              window.api.officerEmails.copyText(url).then(function (r) {
                if (r && r.ok) onCopied(truncated, method);
                else if (typeof showToast === 'function') showToast('Could not copy link.', 'error');
              });
            }
          });
        } else if (window.api.officerEmails.copyText) {
          window.api.officerEmails.copyText(url).then(function (r) {
            if (r && r.ok) onCopied(truncated, method);
            else if (typeof showToast === 'function') showToast('Could not copy link.', 'error');
          });
        }
      });
    });
  }

  function feeEarnerEmailDomain() {
    try {
      var em = (window._appSettingsCache && window._appSettingsCache.email) || '';
      em = String(em).trim();
      var at = em.lastIndexOf('@');
      if (at < 1) return '';
      return em.slice(at + 1).toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function isProfessionalDomain(email) {
    var d = (email.split('@')[1] || '').toLowerCase();
    if (!d) return false;
    var firmDom = feeEarnerEmailDomain();
    if (firmDom && (d === firmDom || d.endsWith('.' + firmDom))) return true;
    var roots = ['police.uk', 'met.police.uk', 'kent.police.uk', 'cps.gov.uk', 'justice.gov.uk', 'gov.uk', 'judiciary.uk', 'mod.gov.uk', 'nhs.net', 'nhs.uk'];
    for (var i = 0; i < roots.length; i++) {
      if (d === roots[i] || d.endsWith('.' + roots[i])) return true;
    }
    if (d.endsWith('.police.uk') || d.endsWith('police.uk')) return true;
    if (d.endsWith('.gov.uk') || d === 'gov.uk') return true;
    return false;
  }

  function copyField(text, okMsg) {
    var t = text != null ? String(text) : '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () {
        if (typeof showToast === 'function') showToast(okMsg || 'Copied', 'success', 2000);
      }).catch(function () {
        fallbackCopy(t, okMsg);
      });
    } else {
      fallbackCopy(t, okMsg);
    }
  }

  function fallbackCopy(t, okMsg) {
    if (window.api && window.api.officerEmails && window.api.officerEmails.copyText) {
      window.api.officerEmails.copyText(t).then(function (r) {
        if (r && r.ok && typeof showToast === 'function') showToast(okMsg || 'Copied', 'success', 2000);
      });
    }
  }

  function loadDraftIntoForm(d) {
    if (!d) return;
    cancelPendingAutoGenerate();
    dirtySubjectBody = !!(String(d.subject || '').trim() || String(d.body || '').trim());
    updateRefreshVisibility();
    selectedDraftId = d.id;
    els.template.value = d.templateType || 'disclosure_confirm_attendance';
    if (recipientApi) recipientApi.setValues(d.toEmail || '', d.recipientName || '');
    els.client.value = d.clientName || '';
    els.station.value = d.policeStation || '';
    var migrated = DT ? DT.migrateDraftDateTimeFields(d) : d;
    applyWhenValues(
      migrated.attendanceDate,
      migrated.attendanceTime,
      migrated.bailReturnDate,
      migrated.bailReturnTime,
      { silent: true }
    );
    els.offence.value = d.offence || '';
    els.extra.value = d.extraNote || '';
    if (els.bailCond) els.bailCond.value = d.bailConditions || '';
    els.userEmail.value = d.userEmailAddress || '';
    els.subject.value = d.subject || '';
    els.body.value = d.body || '';
    dirtySubjectBody = !!(String(d.subject || '').trim() || String(d.body || '').trim());
    updateRefreshVisibility();
    syncBailVisibility({ silent: true });
    cancelPendingAutoGenerate();
    updatePreviewTo();
    if (els.template) els.template.dataset.oepLast = els.template.value;
  }

  function loadDrafts() {
    var aid = getCurrentAttendanceIdSafe();
    if (!aid || !els.drafts || !window.api) return;
    window.api.officerEmails.listDrafts(String(aid)).then(function (rows) {
      els.drafts.innerHTML = '';
      if (!rows || !rows.length) {
        els.drafts.innerHTML = '<p class="muted" style="font-size:0.85rem;">No drafts yet.</p>';
        return;
      }
      rows.forEach(function (d) {
        if (d.status === 'deleted') return;
        var card = document.createElement('div');
        card.className = 'officer-email-draft-card' + (d.status === 'cancelled' ? ' officer-email-draft-card--muted' : '');
        var st = STATUS_LABELS[d.status] || d.status;
        var updated = d.updatedAt ? String(d.updatedAt).slice(0, 16).replace('T', ' ') : '';
        var tplLabel = d.templateType;
        for (var ti = 0; ti < TEMPLATE_OPTIONS.length; ti++) {
          if (TEMPLATE_OPTIONS[ti].value === d.templateType) {
            tplLabel = TEMPLATE_OPTIONS[ti].label;
            break;
          }
        }
        card.innerHTML =
          '<div class="officer-email-draft-card-title">' + esc(tplLabel) + '</div>' +
          '<div class="officer-email-draft-to">' + esc(d.toEmail || '—') + '</div>' +
          '<div class="officer-email-draft-meta">' + esc(st) + ' · ' + esc(updated) + '</div>' +
          '<div class="officer-email-draft-sub">' + esc(d.subject || '—') + '</div>' +
          '<div class="officer-email-draft-actions">' +
          '<button type="button" class="btn-small" data-act="load">Load</button>' +
          '<button type="button" class="btn-small" data-act="dup" data-id="' + esc(d.id) + '">Duplicate</button>' +
          (d.status === 'draft' || d.status === 'ready_for_outlook' || d.status === 'opened_in_outlook'
            ? '<button type="button" class="btn-small" data-act="cancel" data-id="' + esc(d.id) + '">Cancel</button>'
            : '') +
          (d.status !== 'sent_manually'
            ? '<button type="button" class="btn-small" data-act="del" data-id="' + esc(d.id) + '">Delete</button>'
            : '') +
          '</div>';
        card.querySelector('[data-act="load"]').addEventListener('click', function () {
          loadDraftIntoForm(d);
        });
        card.querySelector('[data-act="dup"]').addEventListener('click', function () {
          window.api.officerEmails.duplicateDraft(d.id).then(function (res) {
            if (res && res.ok) {
              selectedDraftId = res.draft && res.draft.id;
              loadDraftIntoForm(res.draft);
              loadDrafts();
            }
          });
        });
        var cancelBtn = card.querySelector('[data-act="cancel"]');
        if (cancelBtn) {
          cancelBtn.addEventListener('click', function () {
            var did = d.id;
            if (typeof window.showChoice === 'function') {
              window.showChoice('Cancel this draft?', 'Cancel draft', [
                { id: 'keep', label: 'Keep Draft', variant: 'primary' },
                { id: 'cancel', label: 'Cancel Draft', variant: 'danger' },
              ]).then(function (choice) {
                if (choice === 'cancel') runCancelDraft(did);
              });
            } else if (typeof showConfirm === 'function') {
              showConfirm('Cancel this draft?', 'Cancel draft').then(function (ok) {
                if (ok) runCancelDraft(did);
              });
            }
          });
        }
        var delBtn = card.querySelector('[data-act="del"]');
        if (!delBtn) {
          els.drafts.appendChild(card);
          return;
        }
        delBtn.addEventListener('click', function () {
          var did = d.id;
          function go() {
            runDeleteDraft(did);
          }
          if (typeof window.showChoice === 'function') {
            window.showChoice('Are you sure you want to delete this draft?', 'Delete draft', [
              { id: 'abort', label: 'Cancel', variant: 'secondary' },
              { id: 'del', label: 'Delete Draft', variant: 'danger' },
            ]).then(function (choice) {
              if (choice === 'del') go();
            });
          } else if (typeof showConfirm === 'function') {
            showConfirm('Are you sure you want to delete this draft?', 'Delete draft').then(function (ok) {
              if (ok) go();
            });
          } else {
            go();
          }
        });
        els.drafts.appendChild(card);
      });
    });
  }

  function attachToCustodyNote(id) {
    if (!host) return;
    var locked = !id;
    els.locked.classList.toggle('hidden', !locked);
    els.main.classList.toggle('officer-email-panel-disabled', locked);
    if (locked) {
      selectedDraftId = null;
      lastAttachedCustodyNoteId = null;
      return;
    }
    var sid = String(id);
    var switched =
      lastAttachedCustodyNoteId !== null && String(lastAttachedCustodyNoteId) !== sid;
    lastAttachedCustodyNoteId = sid;
    if (switched) {
      newDraft();
    } else {
      applyPrefillFromMatter();
      if (!selectedDraftId) generateFromTemplate(true);
    }
    loadDrafts();
  }

  function refresh() {
    applyPrefillFromMatter();
  }

  function init() {
    host = document.getElementById('officer-emails-panel-host');
    if (!host || host.dataset.oepBuilt) return;
    host.dataset.oepBuilt = '1';
    host.classList.add('form-panel-card', 'officer-email-panel');
    buildShell();
    newDraft();
  }

  global.OfficerEmailsPanel = {
    init: init,
    attachToCustodyNote: attachToCustodyNote,
    refresh: refresh,
  };
})(typeof window !== 'undefined' ? window : globalThis);
