/* Officer Emails — standalone one-off compose view. */
(function (global) {
  'use strict';

  var Layout = global.OfficerEmailComposeLayout;
  var DT = global.OfficerEmailDateTime;

  var host = null;
  var els = {};
  var recipientApi = null;
  var whenPicker = null;
  var dirtySubjectBody = false;
  var autoGenerateTimer = null;
  var PREFIX = 'oes';

  function buildShell() {
    if (!host || !Layout) return;
    host.innerHTML =
      '<div class="officer-email-compose-grid">' +
      '<section class="form-panel-card officer-email-compose-form-card">' +
      '<div class="officer-email-compose-form">' + Layout.buildFormStepsHtml(PREFIX, { showFilledBadge: false }) + '</div>' +
      '<div class="officer-email-standalone-toolbar">' +
      '<button type="button" class="btn btn-secondary btn-small" id="oes-clear">Clear</button>' +
      '</div></section>' +
      '<section class="form-panel-card officer-email-compose-preview-card">' +
      Layout.buildPreviewHtml(PREFIX) +
      '</section></div>';

    var sel = host.querySelector('#' + PREFIX + '-template');
    sel.innerHTML = Layout.templateOptionsHtml();
    sel.dataset.oesLast = sel.value;

    els = {
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
    };

    if (global.OfficerEmailDateTimePicker && els.whenMount) {
      whenPicker = global.OfficerEmailDateTimePicker.init(els.whenMount, {
        prefix: PREFIX,
        onChange: scheduleAutoGenerate,
      });
    }

    if (global.OfficerEmailRecipientRows && els.recipientsHost) {
      recipientApi = global.OfficerEmailRecipientRows.initRecipientBlock(els.recipientsHost, {
        prefix: PREFIX,
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

    host.querySelector('#oes-clear').addEventListener('click', clearForm);
    if (els.refreshBtn) {
      els.refreshBtn.addEventListener('click', function () {
        dirtySubjectBody = false;
        generateFromTemplate(true);
      });
    }
    host.querySelector('#' + PREFIX + '-open').addEventListener('click', openOutlookClicked);
    host.querySelector('#' + PREFIX + '-copy-owa').addEventListener('click', copyOutlookLinkClicked);
    host.querySelector('#' + PREFIX + '-copy-to').addEventListener('click', function () {
      var rec = recipientApi ? recipientApi.getValues() : { toEmail: '' };
      copyField(rec.toEmail, 'Recipient copied.');
    });
    host.querySelector('#' + PREFIX + '-copy-sub').addEventListener('click', function () { copyField(els.subject.value, 'Subject copied.'); });
    host.querySelector('#' + PREFIX + '-copy-body').addEventListener('click', function () { copyField(els.body.value, 'Body copied.'); });
  }

  function updateRefreshVisibility() {
    if (els.refreshBtn) els.refreshBtn.classList.toggle('hidden', !dirtySubjectBody);
  }

  function syncTemplateUi() {
    var tt = els.template.value;
    Layout.syncTemplateChipSelection(els.templateChips, tt);
    Layout.updateWhenTitle(els.whenTitle, tt);
    Layout.syncBailExtraVisibility(els.bailExtra, tt);
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
    var when = whenPicker ? whenPicker.getValues() : { attendanceDate: '', attendanceTime: '' };
    var isBail = DT && DT.isBailTemplate(els.template.value);
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
      bailReturnDate: isBail ? when.attendanceDate : '',
      bailConditions: isBail && els.bailCond ? els.bailCond.value : '',
      userEmailAddress: els.userEmail.value,
      signOffName: getSignOffNameSafe(),
      subject: els.subject.value,
      body: els.body.value,
    };
  }

  function applyWhenValues(attendanceDate, attendanceTime, bailReturnDate) {
    if (whenPicker) whenPicker.setValues(attendanceDate, attendanceTime, bailReturnDate);
  }

  function syncBailVisibility() {
    syncTemplateUi();
  }

  function onTemplateChange() {
    if (whenPicker) whenPicker.applyBailDefaultIfNeeded(els.template.value);
    syncBailVisibility();
    if (!dirtySubjectBody) {
      generateFromTemplate(true);
      if (els.template) els.template.dataset.oesLast = els.template.value;
      return;
    }
    if (typeof window.showChoice !== 'function') {
      generateFromTemplate(true);
      return;
    }
    window.showChoice(
      'Changing template may overwrite your edited subject and body.',
      'Change template',
      [
        { id: 'keep', label: 'Keep current email', variant: 'primary' },
        { id: 'apply', label: 'Apply new template', variant: 'secondary' },
      ]
    ).then(function (choice) {
      if (choice !== 'apply') {
        if (els.template) els.template.value = els.template.dataset.oesLast || 'disclosure_confirm_attendance';
        syncBailVisibility();
        return;
      }
      generateFromTemplate(true);
      if (els.template) els.template.dataset.oesLast = els.template.value;
    });
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

  function updatePreviewTo() {
    if (!els.previewTo) return;
    var rec = recipientApi ? recipientApi.getValues() : { toEmail: '' };
    els.previewTo.textContent = rec.toEmail || '—';
  }

  function highlightWhenInBody(bodyText) {
    if (!whenPicker || !bodyText) return bodyText;
    var phrase = whenPicker.getWhenPhrase();
    if (!phrase || bodyText.indexOf(phrase) < 0) return bodyText;
    return bodyText.split(phrase).join('⟦' + phrase + '⟧');
  }

  function stripHighlightMarkers(text) {
    return String(text || '').replace(/⟦/g, '').replace(/⟧/g, '');
  }

  function generateFromTemplate(forceApply) {
    if (!window.api || !window.api.officerEmails || !window.api.officerEmails.buildPreview) {
      return Promise.resolve({ ok: false, error: 'Officer email preview is not available.' });
    }
    updatePreviewTo();
    return window.api.officerEmails.buildPreview(collectFields()).then(function (res) {
      if (!res || !res.ok) {
        if (typeof showToast === 'function') showToast((res && res.error) || 'Could not build preview', 'error');
        return res || { ok: false, error: 'Could not build preview' };
      }
      if (forceApply || !dirtySubjectBody) {
        els.subject.value = res.subject || '';
        var body = res.body || '';
        els.body.value = body;
        dirtySubjectBody = false;
        updateRefreshVisibility();
      }
      return res;
    }).catch(function (err) {
      if (typeof showToast === 'function') showToast('Could not build preview.', 'error', 7000);
      try { console.error('[officerEmailsStandalone] buildPreview failed', err); } catch (_) {}
      return { ok: false, error: (err && err.message) || String(err) };
    });
  }

  function clearForm() {
    Object.keys(els).forEach(function (key) {
      var el = els[key];
      if (!el || !('value' in el)) return;
      if (key === 'template' || key === 'recipientsHost' || key === 'dutySolicitor' || key === 'outlookSig') return;
      if (el.type === 'checkbox') {
        el.checked = false;
        return;
      }
      el.value = '';
    });
    if (recipientApi) recipientApi.setValues('', '');
    if (els.dutySolicitor && global.OfficerEmailRecipientRows) {
      els.dutySolicitor.checked = global.OfficerEmailRecipientRows.readDutySolicitorPreference();
    }
    if (els.outlookSig && global.OfficerEmailRecipientRows) {
      els.outlookSig.checked = global.OfficerEmailRecipientRows.readOutlookSigPreference();
    }
    els.template.value = 'disclosure_confirm_attendance';
    els.template.dataset.oesLast = els.template.value;
    applyWhenValues('', '', '');
    dirtySubjectBody = false;
    syncBailVisibility();
    generateFromTemplate(true);
    if (recipientApi) recipientApi.focusFirstEmail();
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

  function isProfessionalDomain(email) {
    var d = (String(email || '').split('@')[1] || '').toLowerCase();
    if (!d) return false;
    var roots = ['police.uk', 'met.police.uk', 'kent.police.uk', 'cps.gov.uk', 'justice.gov.uk', 'gov.uk', 'judiciary.uk', 'mod.gov.uk', 'nhs.net', 'nhs.uk'];
    for (var i = 0; i < roots.length; i++) {
      if (d === roots[i] || d.endsWith('.' + roots[i])) return true;
    }
    if (d.endsWith('.police.uk') || d.endsWith('police.uk')) return true;
    if (d.endsWith('.gov.uk') || d === 'gov.uk') return true;
    return false;
  }

  function openOutlookClicked() {
    var f = collectFields();
    f.body = stripHighlightMarkers(f.body);
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
    f.body = stripHighlightMarkers(f.body);
    var to = String(f.toEmail || '').trim();
    var sub = String(f.subject || '').trim();
    var bod = String(f.body || '').trim();
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
      'You are about to open this one-off email in Outlook Web.\n\nTo:\n' + to + '\n\nSubject:\n' + sub + '\n\n' +
      (warnings.length ? warnings.join('\n\n') + '\n\n' : '') +
      'Custody Note will not send the email. You must review and send it manually in Outlook Web.';

    function reportFatal(label, detail) {
      var fallback = 'Outlook Web could not be opened. The email content is still in the form — try Copy link.';
      if (detail) fallback = fallback + ' (' + detail + ')';
      if (typeof showToast === 'function') showToast(fallback, 'error', 9000);
      else if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(fallback);
      try { console.warn('[officerEmailsStandalone] ' + label + ': showToast undefined, fell back to alert/no-op'); } catch (_) {}
    }
    function go() {
      var promise;
      try {
        promise = window.api.officerEmails.openOneOffOutlook(f);
      } catch (syncErr) {
        try { console.error('[officerEmailsStandalone] openOneOffOutlook threw synchronously', syncErr); } catch (_) {}
        reportFatal('openOneOffOutlook sync throw', (syncErr && syncErr.message) || String(syncErr));
        return;
      }
      if (!promise || typeof promise.then !== 'function') {
        try { console.error('[officerEmailsStandalone] openOneOffOutlook returned non-promise', promise); } catch (_) {}
        reportFatal('openOneOffOutlook returned non-promise', 'IPC bridge unavailable');
        return;
      }
      promise.then(function (res) {
        try { console.info('[officerEmailsStandalone] openOneOffOutlook resolved', res); } catch (_) {}
        if (!res || !res.ok) {
          var errMsg = (res && res.errors && res.errors[0]) || 'Outlook Web could not be opened. You can still copy the recipient, subject and body manually.';
          if (typeof showToast === 'function') showToast(errMsg, 'error', 7000);
          else if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(errMsg);
          else try { console.warn('[officerEmailsStandalone] openOneOffOutlook not-ok with no toast/alert', res); } catch (_) {}
          return;
        }
        if (typeof showToast === 'function') {
          var openedMsg = res.method === 'outlook-desktop-eml'
            ? 'Opened Outlook draft with your message — review and send'
            : 'Opened in Outlook Web with your message — review and send';
          showToast(openedMsg, 'success', 5000);
        }
      }).catch(function (err) {
        try { console.error('[officerEmailsStandalone] openOneOffOutlook rejected', err); } catch (_) {}
        reportFatal('openOneOffOutlook rejected', (err && err.message) || String(err));
      });
    }

    if (typeof window.showChoice === 'function') {
      window.showChoice(msg, 'Open Outlook Web', [
        { id: 'open', label: 'Open Outlook Web', variant: 'primary' },
        { id: 'abort', label: 'Cancel', variant: 'secondary' },
      ]).then(function (choice) {
        if (choice === 'open') go();
      }).catch(function (err) {
        try { console.error('[officerEmailsStandalone] showChoice rejected', err); } catch (_) {}
        reportFatal('showChoice rejected', (err && err.message) || String(err));
      });
      return;
    }
    if (typeof showConfirm !== 'function') {
      try { console.warn('[officerEmailsStandalone] showChoice and showConfirm both undefined; using window.confirm fallback'); } catch (_) {}
      var ok = (typeof window !== 'undefined' && typeof window.confirm === 'function')
        ? window.confirm(msg)
        : true;
      if (ok) go();
      return;
    }
    showConfirm(msg, 'Open Outlook Web').then(function (ok) {
      if (ok) go();
    }).catch(function (err) {
      try { console.error('[officerEmailsStandalone] showConfirm rejected', err); } catch (_) {}
      reportFatal('showConfirm rejected', (err && err.message) || String(err));
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
    f.body = stripHighlightMarkers(f.body);
    var to = String(f.toEmail || '').trim();
    var sub = String(f.subject || '').trim();
    var bod = String(f.body || '').trim();
    if (!to || !sub || !bod) {
      if (typeof showToast === 'function') showToast('Complete recipient, subject and body before copying the link.', 'error', 5000);
      return;
    }
    if (!window.api || !window.api.officerEmails || !window.api.officerEmails.getComposeUrl) {
      if (typeof showToast === 'function') showToast('Copy link is not available.', 'error');
      return;
    }
    function onCopied(truncated, method) {
      var msg = 'Outlook compose link copied to clipboard.';
      if (method === 'outlook-desktop-eml' || truncated) {
        msg += ' This link is recipient/subject only because the message is long — use Open in Outlook to open a full draft with the body.';
      } else {
        msg += ' The link includes your message body.';
      }
      if (typeof showToast === 'function') showToast(msg, 'success', truncated ? 9000 : 4000);
    }
    window.api.officerEmails.getComposeUrl({ fields: f }).then(function (res) {
      if (!res || !res.ok) {
        if (typeof showToast === 'function') {
          showToast((res && res.errors && res.errors[0]) || 'Could not build Outlook link.', 'error', 7000);
        }
        return;
      }
      var url = res.url != null ? String(res.url) : '';
      copyField(url, 'Link copied.');
    });
  }

  function focusFirstField() {
    if (recipientApi) recipientApi.focusFirstEmail();
  }

  function init() {
    host = document.getElementById('officer-emails-standalone-host');
    if (!host || host.dataset.oesBuilt) return;
    host.dataset.oesBuilt = '1';
    buildShell();
    syncBailVisibility();
    generateFromTemplate(true);
  }

  global.OfficerEmailsStandalone = {
    init: init,
    focusFirstField: focusFirstField,
  };
})(typeof window !== 'undefined' ? window : globalThis);
