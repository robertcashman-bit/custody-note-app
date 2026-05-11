/* ═══════════════════════════════════════════════════════════
   Officer Emails — vanilla-JS Custody Note feature.

   Primary workflow: {{placeholder}} templates → preview → copy / paste into
   Outlook (custodyCopyEmailText). v1.6.21: copy-and-paste only — no mail
   client launch. Pending-draft helpers remain for dev diagnostics.

   This module only manages the inner UI of #view-officer-emails.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STORAGE_KEY = 'custody_note_officer_email_records_v2';
  var activeTab = 'details';
  var activeRecordId = null;
  var records = [];
  var initialised = false;

  /** Legacy keys from older builds → current template ids */
  var LEGACY_TEMPLATE_KEYS = {
    bail_details: 'request_bail_details',
    attendance_confirmation: 'request_interview_recording',
    disclosure_update: 'followup_after_rui',
    general: 'confirm_representation',
  };

  /**
   * Built-in seed templates ({{fieldName}} placeholders). At runtime the
   * Officer Emails screen reads templates from OfficerEmailTemplatesStore
   * (settings-backed JSON), not from this constant — every template is
   * fully user-editable via the Manage templates… modal. This constant is
   * preserved for first-run seeding, the Restore defaults action, and the
   * regression test that pins the export name.
   */
  var OFFICER_EMAIL_TEMPLATES = {
    request_bail_details: {
      key: 'request_bail_details',
      name: 'Request Bail Details',
      subjectTemplate: '{{clientName}} - Bail Details Request',
      bodyTemplate:
        'Dear {{officerRank}} {{officerSurname}},\n\n' +
        'I am writing in relation to {{clientName}}, who was detained at {{policeStation}} on {{interviewDate}} under custody record number {{custodyNumber}}.\n\n' +
        'The DSCC reference is {{dsccReference}}.\n\n' +
        'We understand that {{clientName}} was released on police bail. Please could you confirm the bail return date, time, and any bail conditions imposed.',
    },
    request_interview_recording: {
      key: 'request_interview_recording',
      name: 'Request Interview Recording',
      subjectTemplate: '{{clientName}} - Interview Recording Request',
      bodyTemplate:
        'Dear {{officerRank}} {{officerSurname}},\n\n' +
        'I am writing in relation to {{clientName}}, who was interviewed at {{policeStation}} on {{interviewDate}}.\n\n' +
        'Please could you provide a copy of the interview recording, or confirm the process for obtaining it.\n\n' +
        'The custody record number is {{custodyNumber}} and the DSCC reference is {{dsccReference}}.',
    },
    followup_after_rui: {
      key: 'followup_after_rui',
      name: 'Follow-up After RUI',
      subjectTemplate: '{{clientName}} - Case Update Request',
      bodyTemplate:
        'Dear {{officerRank}} {{officerSurname}},\n\n' +
        'I am writing in relation to {{clientName}}, who was interviewed at {{policeStation}} on {{interviewDate}}.\n\n' +
        'Please could you confirm the current position regarding the investigation and whether any further action is anticipated.\n\n' +
        'The custody record number is {{custodyNumber}} and the DSCC reference is {{dsccReference}}.',
    },
    confirm_representation: {
      key: 'confirm_representation',
      name: 'Confirm Representation',
      subjectTemplate: '{{clientName}} - Confirmation of Representation',
      bodyTemplate:
        'Dear {{officerRank}} {{officerSurname}},\n\n' +
        'I write to confirm that I represent {{clientName}} in relation to this matter.\n\n' +
        'Please ensure that all future correspondence is sent to me by email.\n\n' +
        'The custody record number is {{custodyNumber}} and the DSCC reference is {{dsccReference}}.',
    },
  };

  function composeMerge(text, map) {
    var lib = window.CustodyEmailCompose;
    var merged = lib && lib.mergeTemplatePlaceholders
      ? lib.mergeTemplatePlaceholders(text, map)
      : String(text || '');
    return lib && lib.normalizeMergedEmailText
      ? lib.normalizeMergedEmailText(merged)
      : merged;
  }

  function buildPlaceholderMapFromForm(data) {
    data = data || {};
    var interviewDate = formatDateForEmail(data.attendanceDate);
    return {
      officerRank: data.officerRank || '',
      officerSurname: data.officerSurname || '',
      clientName: data.clientName || '',
      policeStation: data.policeStationOrUnit || '',
      interviewDate: interviewDate,
      custodyNumber: data.custodyNumber || '',
      dsccReference: data.dsccReference || '',
      matter: data.matter || '',
      attendanceNote: data.attendanceNote || '',
    };
  }

  function init() {
    if (initialised) return;
    var screen = document.getElementById('view-officer-emails');
    if (!screen) return;
    initialised = true;
    /* Initialise the user-editable template store. Seeds with the built-ins
       on first install, then every template is fully editable / deletable. */
    if (window.OfficerEmailTemplatesStore && typeof window.OfficerEmailTemplatesStore.init === 'function') {
      try { window.OfficerEmailTemplatesStore.init(); } catch (_) { /* still functional below */ }
      window.OfficerEmailTemplatesStore.subscribe(function () { refreshTemplateDropdown(); });
    }
    refreshTemplateDropdown();
    records = loadRecords();
    bindTabs();
    bindFormInputs();
    bindActionButtons();
    bindDiagnosticsCopyButtons();
    bindEmailComposeDiagnosticsButtons();
    renderRecords();
    updatePreviewAndSummary();
    updatePendingAndFallbackUi();
  }

  /** Rebuild the Compose Template <select> from the user-editable store. */
  function refreshTemplateDropdown() {
    var sel = $('officerTemplateSelect');
    if (!sel) return;
    var prev = sel.value;
    var rows = (window.OfficerEmailTemplatesStore && typeof window.OfficerEmailTemplatesStore.list === 'function')
      ? window.OfficerEmailTemplatesStore.list()
      : Object.keys(OFFICER_EMAIL_TEMPLATES).map(function (k) {
          var t = OFFICER_EMAIL_TEMPLATES[k];
          return { key: t.key, name: t.name, subjectTemplate: t.subjectTemplate, bodyTemplate: t.bodyTemplate };
        });
    if (!rows.length) {
      sel.innerHTML = '<option value="">No templates — click Manage templates… to add one</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    sel.innerHTML = rows.map(function (t) {
      var key = String(t.key || '');
      var name = String(t.name || 'Untitled');
      return '<option value="' + key.replace(/"/g, '&quot;') + '">' + name.replace(/</g, '&lt;') + '</option>';
    }).join('');
    var keys = rows.map(function (r) { return r.key; });
    if (keys.indexOf(prev) >= 0) sel.value = prev;
    else sel.value = rows[0].key;
    updatePreviewAndSummary();
  }

  /* Called by app.js when the home card is clicked and the view is shown. */
  function onShow() {
    if (!initialised) init();
    setActiveTab('details');
    updatePreviewAndSummary();
  }

  function $(id) { return document.getElementById(id); }

  function bindTabs() {
    var buttons = document.querySelectorAll('[data-officer-tab]');
    for (var i = 0; i < buttons.length; i++) {
      (function (button) {
        button.addEventListener('click', function () { setActiveTab(button.dataset.officerTab); });
      })(buttons[i]);
    }
  }

  function setActiveTab(tab) {
    activeTab = tab;
    var buttons = document.querySelectorAll('[data-officer-tab]');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.dataset.officerTab === tab) b.classList.add('active');
      else b.classList.remove('active');
    }
    var panels = {
      details: 'officerTabDetails',
      compose: 'officerTabCompose',
      preview: 'officerTabPreview',
      records: 'officerTabRecords',
      testing: 'officerTabTesting',
    };
    Object.keys(panels).forEach(function (key) {
      var panel = $(panels[key]);
      if (!panel) return;
      if (key === tab) panel.classList.remove('hidden');
      else panel.classList.add('hidden');
    });
    updatePreviewAndSummary();
  }

  function bindFormInputs() {
    var ids = [
      'officerEmailInput',
      'officerRankInput',
      'officerSurnameInput',
      'policeStationOrUnitInput',
      'custodyNumberInput',
      'dsccReferenceInput',
      'attendanceDateInput',
      'attendanceTimeInput',
      'clientNameInput',
      'matterInput',
      'attendanceNoteInput',
      'officerSubjectInput',
      'officerBodyInput',
      'officerTemplateSelect',
    ];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (!el) continue;
      el.addEventListener('input', updatePreviewAndSummary);
      el.addEventListener('change', updatePreviewAndSummary);
    }
  }

  function bindActionButtons() {
    /* v1.6.20+ copy-and-paste only. v1.6.21 removed main-process Outlook IPC,
       emailAPI bridge, and window mailto/OWA launch helpers. */
    bindClick('officerHeroCopyBodyBtn', function () { copyBody(); });
    bindClick('officerCopyBodyPreviewBtn', function () { copyBody(); });
    bindClick('officerSideCopyBodyBtn', function () { copyBody(); });

    /* Subject copy entry-points: hero, inline next to Compose Subject input, inline next to Preview Subject value. */
    bindClick('officerHeroCopySubjectBtn', function () { copySubject(); });
    bindClick('officerInlineCopySubjectBtn', function () { copySubject(); });
    bindClick('officerInlineCopySubjectPreviewBtn', function () { copySubject(); });

    bindClick('officerGenerateBtn', generateFromTemplate);
    bindClick('officerContinueComposeBtn', function () {
      generateFromTemplate();
      setActiveTab('compose');
    });

    bindClick('officerClearSubjectBodyBtn', clearSubjectBody);
    bindClick('officerCopyOfficerEmailBtn', copyOfficerEmail);
    bindClick('officerCopySubjectBtn', copySubject);
    bindClick('officerCopySubjectPreviewBtn', copySubject);
    bindClick('officerCopyBodyBtn', copyBody);
    bindClick('officerCopyFullBtn', copyFullEmail);
    bindClick('officerCopyFullPreviewBtn', copyFullEmail);
    bindClick('officerSaveDraftBtn', saveDraft);
    bindClick('officerMarkSentBtn', markAsSent);
    bindClick('officerCancelBtn', cancelEmail);
    bindClick('officerClearFormBtn', clearForm);
    bindClick('officerClearAllRecordsBtn', clearAllRecords);
    bindClick('officerRunTestsBtn', runTests);
    bindClick('officerRunDebugBtn', runDebugCheck);

    /* Open the user-editable template manager. After it closes, the dropdown
       refreshes via the store's subscribe() — no Outlook surfaces involved. */
    bindClick('officerManageTemplatesBtn', function () {
      if (typeof window.openOfficerEmailTemplatesManager === 'function') {
        window.openOfficerEmailTemplatesManager({ onChange: refreshTemplateDropdown });
      } else {
        showError('Template manager could not load. Please reload the page.');
      }
    });

    bindClick('officerPrevDayBtn', function () {
      var input = $('attendanceDateInput');
      if (!input) return;
      input.value = adjustDate(input.value, -1);
      updatePreviewAndSummary();
    });

    bindClick('officerNextDayBtn', function () {
      var input = $('attendanceDateInput');
      if (!input) return;
      input.value = adjustDate(input.value, 1);
      updatePreviewAndSummary();
    });

    bindClick('officerTimeMinusBtn', function () {
      var input = $('attendanceTimeInput');
      if (!input) return;
      input.value = adjustTime(input.value, -15);
      updatePreviewAndSummary();
    });

    bindClick('officerTimePlusBtn', function () {
      var input = $('attendanceTimeInput');
      if (!input) return;
      input.value = adjustTime(input.value, 15);
      updatePreviewAndSummary();
    });

    bindClick('officerNowBtn', function () {
      var now = new Date();
      var dInput = $('attendanceDateInput');
      var tInput = $('attendanceTimeInput');
      if (dInput) {
        dInput.value = now.getFullYear() + '-' +
          pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
      }
      if (tInput) {
        tInput.value = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      }
      updatePreviewAndSummary();
    });
  }

  function bindClick(id, handler) {
    var element = $(id);
    if (!element) return;
    element.addEventListener('click', handler);
  }

  function getFormData() {
    var tk = valueOf('officerTemplateSelect') || 'request_bail_details';
    if (LEGACY_TEMPLATE_KEYS[tk]) tk = LEGACY_TEMPLATE_KEYS[tk];
    return {
      officerEmail: valueOf('officerEmailInput'),
      officerRank: valueOf('officerRankInput'),
      officerSurname: valueOf('officerSurnameInput'),
      policeStationOrUnit: valueOf('policeStationOrUnitInput'),
      custodyNumber: valueOf('custodyNumberInput'),
      dsccReference: valueOf('dsccReferenceInput'),
      attendanceDate: valueOf('attendanceDateInput'),
      attendanceTime: valueOf('attendanceTimeInput'),
      clientName: valueOf('clientNameInput'),
      matter: valueOf('matterInput'),
      attendanceNote: valueOf('attendanceNoteInput'),
      templateKey: tk,
      subject: valueOf('officerSubjectInput'),
      body: valueOf('officerBodyInput'),
    };
  }

  function setFormData(data) {
    var tk = data.templateKey || 'request_bail_details';
    if (LEGACY_TEMPLATE_KEYS[tk]) tk = LEGACY_TEMPLATE_KEYS[tk];
    setValue('officerEmailInput', data.officerEmail || '');
    setValue('officerRankInput', data.officerRank || '');
    setValue('officerSurnameInput', data.officerSurname || '');
    setValue('policeStationOrUnitInput', data.policeStationOrUnit || '');
    setValue('custodyNumberInput', data.custodyNumber || '');
    setValue('dsccReferenceInput', data.dsccReference || '');
    setValue('attendanceDateInput', data.attendanceDate || '');
    setValue('attendanceTimeInput', data.attendanceTime || '');
    setValue('clientNameInput', data.clientName || '');
    setValue('matterInput', data.matter || '');
    setValue('attendanceNoteInput', data.attendanceNote || '');
    setValue('officerTemplateSelect', tk);
    setValue('officerSubjectInput', data.subject || '');
    setValue('officerBodyInput', data.body || '');
    updatePreviewAndSummary();
  }

  function valueOf(id) {
    var el = $(id);
    return el ? String(el.value || '').trim() : '';
  }

  function rawValueOf(id) {
    var el = $(id);
    return el ? String(el.value || '') : '';
  }

  function setValue(id, value) {
    var el = $(id);
    if (el) el.value = value;
  }

  /** Closing line for generated templates: fee earner from Settings when set, else neutral placeholder. */
  function feeEarnerClosingSignature() {
    try {
      var s = window._appSettingsCache || {};
      var n = String(s.feeEarnerName || '').trim();
      if (n) return 'Kind regards,\n' + n;
    } catch (_) { /* ignore */ }
    return 'Kind regards,\n[Your name]';
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatDateForEmail(dateValue) {
    if (!dateValue) return '';
    var date = new Date(dateValue + 'T00:00:00');
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  function getSelectedTemplate() {
    var key = valueOf('officerTemplateSelect') || '';
    if (LEGACY_TEMPLATE_KEYS[key]) key = LEGACY_TEMPLATE_KEYS[key];
    /* Prefer the user-editable store. */
    if (window.OfficerEmailTemplatesStore && typeof window.OfficerEmailTemplatesStore.list === 'function') {
      var rows = window.OfficerEmailTemplatesStore.list();
      if (rows.length) {
        var found = null;
        for (var i = 0; i < rows.length; i++) { if (rows[i].key === key) { found = rows[i]; break; } }
        return found || rows[0];
      }
    }
    /* Fallback to the seed constant for tests / boot-time race. */
    return OFFICER_EMAIL_TEMPLATES[key] || OFFICER_EMAIL_TEMPLATES.request_bail_details;
  }

  function generateFromTemplate() {
    var data = getFormData();
    var template = getSelectedTemplate();
    var map = buildPlaceholderMapFromForm(data);
    var subject = composeMerge(template.subjectTemplate, map);
    var bodyCore = composeMerge(template.bodyTemplate, map);
    var body = bodyCore ? bodyCore + '\n\n' + feeEarnerClosingSignature() : feeEarnerClosingSignature();
    setValue('officerSubjectInput', subject);
    setValue('officerBodyInput', body);
    showNotice('Email generated from selected template.');
    updatePreviewAndSummary();
  }

  function buildCurrentDraft(modeHint) {
    var data = getFormData();
    var bodyText = rawValueOf('officerBodyInput');
    return {
      to: data.officerEmail || '',
      cc: '',
      subject: data.subject || '',
      body: bodyText,
      templateId: data.templateKey || 'request_bail_details',
      createdAt: new Date().toISOString(),
      mode: modeHint || '',
    };
  }

  function updatePendingAndFallbackUi() {
    /* v1.6.20: officerEmailSignInPanel + officerEmailFallbackPanel were
       deleted with the Open in Outlook flow. The dev diagnostics block
       below still updates so Test/Debug shows the pending-draft helper
       state (it is dev-only, hidden in packaged builds). */
    var pending = typeof window.getPendingEmailDraft === 'function' ? window.getPendingEmailDraft() : null;

    var dp = $('officerDiagPending');
    var dpt = $('officerDiagPendingTime');
    var dtpl = $('officerDiagTemplate');
    if (dp) {
      dp.textContent = pending
        ? JSON.stringify({
          to: pending.to,
          cc: pending.cc,
          templateId: pending.templateId,
          mode: pending.mode,
          subjectPreview: pending.subject ? String(pending.subject).slice(0, 80) : '',
        }, null, 2)
        : '(none)';
    }
    if (dpt) dpt.textContent = (pending && pending.createdAt) ? pending.createdAt : '—';
    if (dtpl && isDevDiagnosticsVisible()) {
      try { dtpl.textContent = getSelectedTemplate().name; } catch (e) { dtpl.textContent = '—'; }
    }
  }

  function isDevDiagnosticsVisible() {
    try {
      return !!(window.custodyNoteBuildInfo && window.custodyNoteBuildInfo.isDevBuild);
    } catch (_) {
      return false;
    }
  }

  function syncEmailDevDiagnostics() {
    var wrap = $('officerEmailDevDiagnostics');
    if (!wrap) return;
    if (isDevDiagnosticsVisible()) wrap.classList.remove('hidden');
    else wrap.classList.add('hidden');
    if (!isDevDiagnosticsVisible()) return;
    var data = getFormData();
    var bodyVal = rawValueOf('officerBodyInput');
    setText('officerDiagTo', data.officerEmail || '(empty)');
    setText('officerDiagSubject', data.subject || '(empty)');
    var sel = getSelectedTemplate();
    var tid = $('officerDiagTemplateId');
    var tname = $('officerDiagTemplate');
    if (tid) tid.textContent = sel.key || '—';
    if (tname) tname.textContent = sel.name || '—';
    var bl = $('officerDiagBodyLen');
    if (bl) bl.textContent = String((bodyVal || '').length);
    var clip = $('officerDiagClipboardApi');
    if (clip) {
      clip.textContent = String(
        !!(typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function')
      );
    }
    var sec = $('officerDiagSecureCtx');
    if (sec) sec.textContent = String(typeof window !== 'undefined' && window.isSecureContext === true);
  }

  function bindDiagnosticsCopyButtons() {
    function wire(id, getText, notice) {
      var el = $(id);
      if (!el || el.dataset.bound === '1') return;
      el.dataset.bound = '1';
      el.addEventListener('click', function () {
        var data = getFormData();
        var bodyVal = rawValueOf('officerBodyInput');
        var text = typeof getText === 'function' ? getText(data, bodyVal) : '';
        copyWithNotice(text, notice);
      });
    }
    wire('officerDiagCopyBodyBtn', function (_d, bodyVal) { return bodyVal; }, 'Email body copied. You can now paste it into Outlook.');
    wire('officerDiagCopyOfficerEmailBtn', function (data) { return data.officerEmail || ''; }, 'Officer email copied.');
    wire('officerDiagCopySubjectBtn', function (data) { return data.subject || ''; }, 'Subject copied.');
  }

  function bindEmailComposeDiagnosticsButtons() {
    function bindOnce(id, fn) {
      var el = $(id);
      if (!el || el.dataset.boundDiag === '1') return;
      el.dataset.boundDiag = '1';
      el.addEventListener('click', fn);
    }
    bindOnce('officerDiagTestSavePending', function () {
      var d = buildCurrentDraft('saved');
      if (typeof window.savePendingEmailDraft === 'function') window.savePendingEmailDraft(d);
      updatePendingAndFallbackUi();
      showNotice('Diagnostics: pending draft saved from current form.');
    });
    bindOnce('officerDiagTestClearPending', function () {
      if (typeof window.clearPendingEmailDraft === 'function') window.clearPendingEmailDraft();
      updatePendingAndFallbackUi();
      showNotice('Diagnostics: pending cleared.');
    });
  }

  function validate() {
    var data = getFormData();
    var missing = getMissingRequiredFields(data);
    if (missing.length > 0) return 'Please complete: ' + missing.join(', ') + '.';
    return '';
  }

  function getMissingRequiredFields(dataArg) {
    var data = dataArg || getFormData();
    var missing = [];
    var bodyValue = data.body != null ? String(data.body) : '';
    if (!bodyValue.trim()) missing.push('Email body');
    if (!data.subject.trim()) missing.push('Subject');
    if (data.officerEmail && !isValidEmail(data.officerEmail)) missing.push('Valid officer email');
    return missing;
  }

  function updateComposeWarnings() {
    var el = $('officerComposeWarnings');
    if (!el) return;
    var data = getFormData();
    var parts = [];
    if (!data.officerEmail) {
      parts.push('Officer email is blank. You can still copy the subject and body.');
    }
    if (!data.subject.trim()) {
      parts.push('Subject is blank. You can still copy the body.');
    }
    if (!parts.length) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = parts.map(function (p) {
      return '<p style="margin:4px 0;">' + escapeHtml(p) + '</p>';
    }).join('');
  }

  function updateCopyButtonStates() {
    var bodyEmpty = !rawValueOf('officerBodyInput').trim();
    var bodyIds = [
      'officerCopyBodyBtn',
      'officerCopyFullBtn',
      'officerHeroCopyBodyBtn',
      'officerCopyBodyPreviewBtn',
      'officerSideCopyBodyBtn',
    ];
    for (var i = 0; i < bodyIds.length; i++) {
      var b = $(bodyIds[i]);
      if (b) b.disabled = bodyEmpty;
    }
    var subjectEmpty = !valueOf('officerSubjectInput');
    var subjIds = [
      'officerCopySubjectBtn',
      'officerCopySubjectPreviewBtn',
      'officerHeroCopySubjectBtn',
      'officerInlineCopySubjectBtn',
      'officerInlineCopySubjectPreviewBtn',
    ];
    for (var j = 0; j < subjIds.length; j++) {
      var s = $(subjIds[j]);
      if (s) s.disabled = subjectEmpty;
    }
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  function saveDraft() {
    var validationError = validate();
    if (validationError) { showError(validationError); return; }
    var record = buildRecord('Draft');
    upsertRecord(record);
    activeRecordId = record.id;
    showNotice('Draft saved.');
  }

  function markAsSent() {
    var validationError = validate();
    if (validationError) { showError(validationError); return; }
    var now = new Date().toISOString();
    var record = buildRecord('Marked Sent');
    record.markedSentAt = now;
    record.updatedAt = now;
    upsertRecord(record);
    activeRecordId = record.id;
    showNotice('Email marked as sent in Custody Note.');
  }

  function cancelEmail() {
    var now = new Date().toISOString();
    var record = buildRecord('Cancelled');
    record.cancelledAt = now;
    record.updatedAt = now;
    upsertRecord(record);
    activeRecordId = record.id;
    showNotice('Email marked as cancelled.');
  }

  function buildRecord(status) {
    var data = getFormData();
    var now = new Date().toISOString();
    var existing = activeRecordId ? findRecord(activeRecordId) : null;
    var template = getSelectedTemplate();
    return {
      id: activeRecordId || createId(),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      openedAt: existing ? existing.openedAt : undefined,
      markedSentAt: existing ? existing.markedSentAt : undefined,
      cancelledAt: existing ? existing.cancelledAt : undefined,
      status: status,
      officerEmail: data.officerEmail,
      officerRank: data.officerRank,
      officerSurname: data.officerSurname,
      policeStationOrUnit: data.policeStationOrUnit,
      custodyNumber: data.custodyNumber,
      dsccReference: data.dsccReference,
      attendanceDate: data.attendanceDate,
      attendanceTime: data.attendanceTime,
      clientName: data.clientName,
      matter: data.matter,
      attendanceNote: data.attendanceNote,
      templateKey: data.templateKey,
      templateName: template.name,
      subject: data.subject,
      body: rawValueOf('officerBodyInput'),
    };
  }

  function findRecord(id) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === id) return records[i];
    }
    return null;
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  function loadRecords() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveRecords() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
    catch (e) { /* storage may be unavailable; tested via runDebugCheck */ }
  }

  function upsertRecord(record) {
    var index = -1;
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === record.id) { index = i; break; }
    }
    if (index >= 0) records[index] = record;
    else records.unshift(record);
    saveRecords();
    renderRecords();
    updatePreviewAndSummary();
  }

  function deleteRecord(id) {
    if (!window.confirm('Delete this officer email record?')) return;
    records = records.filter(function (r) { return r.id !== id; });
    saveRecords();
    if (activeRecordId === id) activeRecordId = null;
    renderRecords();
    updatePreviewAndSummary();
    showNotice('Record deleted.');
  }

  function clearAllRecords() {
    if (!window.confirm('Delete all saved officer email records?')) return;
    records = [];
    saveRecords();
    renderRecords();
    updatePreviewAndSummary();
    showNotice('All officer email records deleted.');
  }

  function renderRecords() {
    var list = $('officerRecordsList');
    if (!list) return;
    if (!records.length) {
      list.innerHTML = '<p class="muted">No officer email records saved yet.</p>';
      return;
    }
    list.innerHTML = '';
    records.forEach(function (record) {
      var card = document.createElement('article');
      card.className = 'record-card';
      var safeStatusClass = String(record.status || 'draft').toLowerCase().replace(/\s+/g, '-');
      var updatedLabel = '';
      try { updatedLabel = new Date(record.updatedAt).toLocaleString('en-GB'); }
      catch (e) { updatedLabel = ''; }
      card.innerHTML =
        '<div class="record-main">' +
          '<strong>' + escapeHtml(record.clientName || 'No client name') + '</strong>' +
          '<span class="status-pill status-' + escapeHtml(safeStatusClass) + '">' + escapeHtml(record.status || '') + '</span>' +
          '<p>' + escapeHtml(record.subject || '') + '</p>' +
          '<small>' + escapeHtml(record.templateName || '') + ' · ' + escapeHtml(record.officerEmail || '') + ' · Updated ' + escapeHtml(updatedLabel) + '</small>' +
        '</div>' +
        '<div class="record-actions">' +
          '<button type="button" data-action="edit">Edit</button>' +
          '<button type="button" data-action="duplicate">Duplicate</button>' +
          '<button type="button" data-action="template">Use as Template</button>' +
          '<button type="button" data-action="copy-officer">Copy Officer Email</button>' +
          '<button type="button" data-action="copy-subject">Copy Subject</button>' +
          '<button type="button" data-action="copy-body">Copy Body</button>' +
          '<button type="button" data-action="copy-full">Copy Full</button>' +
          '<button type="button" data-action="mark-sent">Mark Sent</button>' +
          '<button type="button" data-action="cancel">Cancel</button>' +
          '<button type="button" data-action="delete" class="danger-button">Delete</button>' +
        '</div>';
      card.querySelector('[data-action="edit"]').addEventListener('click', function () { loadRecord(record); });
      card.querySelector('[data-action="duplicate"]').addEventListener('click', function () { duplicateRecord(record, false); });
      card.querySelector('[data-action="template"]').addEventListener('click', function () { duplicateRecord(record, true); });
      card.querySelector('[data-action="copy-officer"]').addEventListener('click', function () {
        copyWithNotice(record.officerEmail || '', 'Officer email copied.');
      });
      card.querySelector('[data-action="copy-subject"]').addEventListener('click', function () {
        copyWithNotice(record.subject || '', 'Subject copied.');
      });
      card.querySelector('[data-action="copy-body"]').addEventListener('click', function () {
        copyWithNotice(record.body || '', 'Record body copied.');
      });
      card.querySelector('[data-action="copy-full"]').addEventListener('click', function () {
        copyWithNotice(buildFullEmailText(record), 'Full record email copied.');
      });
      card.querySelector('[data-action="mark-sent"]').addEventListener('click', function () { updateRecordStatus(record, 'Marked Sent'); });
      card.querySelector('[data-action="cancel"]').addEventListener('click', function () { updateRecordStatus(record, 'Cancelled'); });
      card.querySelector('[data-action="delete"]').addEventListener('click', function () { deleteRecord(record.id); });
      list.appendChild(card);
    });
  }

  function loadRecord(record) {
    activeRecordId = record.id;
    setFormData(record);
    setActiveTab('details');
    showNotice('Record loaded for editing.');
  }

  function duplicateRecord(record, blankDetails) {
    activeRecordId = null;
    if (blankDetails) {
      setFormData({
        officerEmail: '',
        officerRank: '',
        officerSurname: '',
        policeStationOrUnit: '',
        custodyNumber: '',
        dsccReference: '',
        attendanceDate: '',
        attendanceTime: '',
        clientName: '',
        matter: '',
        attendanceNote: record.attendanceNote || '',
        templateKey: record.templateKey || 'request_bail_details',
        subject: record.subject || '',
        body: record.body || '',
      });
      showNotice('Email loaded as a reusable template with blank new details.');
    } else {
      setFormData(record);
      showNotice('Email duplicated.');
    }
    setActiveTab('details');
  }

  function updateRecordStatus(record, status) {
    var now = new Date().toISOString();
    var updated = Object.assign({}, record, { status: status, updatedAt: now });
    if (status === 'Marked Sent') updated.markedSentAt = now;
    if (status === 'Cancelled') updated.cancelledAt = now;
    var index = -1;
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === record.id) { index = i; break; }
    }
    if (index >= 0) records[index] = updated;
    saveRecords();
    renderRecords();
    updatePreviewAndSummary();
    showNotice('Record marked as ' + status + '.');
  }

  function clearForm() {
    activeRecordId = null;
    var ids = [
      'officerEmailInput',
      'officerRankInput',
      'officerSurnameInput',
      'policeStationOrUnitInput',
      'custodyNumberInput',
      'dsccReferenceInput',
      'attendanceDateInput',
      'attendanceTimeInput',
      'clientNameInput',
      'matterInput',
      'attendanceNoteInput',
      'officerSubjectInput',
      'officerBodyInput',
    ];
    for (var i = 0; i < ids.length; i++) setValue(ids[i], '');
    setValue('officerTemplateSelect', 'request_bail_details');
    if (typeof window.clearPendingEmailDraft === 'function') window.clearPendingEmailDraft();
    showNotice('Form cleared.');
    updatePreviewAndSummary();
  }

  function clearSubjectBody() {
    setValue('officerSubjectInput', '');
    setValue('officerBodyInput', '');
    showNotice('Subject and body cleared.');
    updatePreviewAndSummary();
  }

  async function copyWithNotice(text, message) {
    var fn = typeof window.custodyCopyEmailText === 'function' ? window.custodyCopyEmailText : null;
    if (!fn) {
      showError('Clipboard helper not loaded. Reload the page.');
      return false;
    }
    try {
      var ok = await fn(text, typeof window !== 'undefined' ? window : globalThis);
      if (ok) showNotice(message);
      else showError('Unable to copy to clipboard.');
      return ok;
    } catch (e) {
      console.error('[officerEmails] copyWithNotice', e);
      showError('Unable to copy to clipboard.');
      return false;
    }
  }

  async function copyOfficerEmail() {
    await copyWithNotice(valueOf('officerEmailInput'), 'Officer email copied.');
  }

  async function copySubject() {
    await copyWithNotice(valueOf('officerSubjectInput'), 'Subject copied.');
  }

  async function copyBody() {
    var raw = rawValueOf('officerBodyInput');
    if (!String(raw).trim()) {
      showNotice('Email body is empty — generate from a template or enter text first.');
      return;
    }
    await copyWithNotice(raw, 'Email body copied. You can now paste it into Outlook.');
  }

  async function copyFullEmail() {
    var data = getFormData();
    await copyWithNotice(buildFullEmailText(data), 'Full email copied.');
  }

  function buildFullEmailText(data) {
    var bodyText = (data.body && String(data.body)) || rawValueOf('officerBodyInput');
    var lib = window.CustodyEmailCompose;
    if (lib && typeof lib.buildFullEmailClipboardText === 'function') {
      return lib.buildFullEmailClipboardText({
        to: data.officerEmail || '',
        cc: '',
        subject: data.subject || '',
        body: bodyText,
      });
    }
    return 'To: ' + (data.officerEmail || '') + '\nSubject: ' + (data.subject || '') + '\n\n' + bodyText;
  }

  /* Date arithmetic in UTC so YYYY-MM-DD round-trips do not flip across
     DST boundaries (otherwise 2026-04-30 + 1 day in BST would slice back
     to "2026-04-30" and the test would fail). */
  function adjustDate(dateValue, days) {
    var base;
    if (dateValue) {
      base = new Date(dateValue + 'T00:00:00Z');
      if (isNaN(base.getTime())) base = new Date();
    } else {
      base = new Date();
    }
    base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
  }

  function adjustTime(timeValue, minutes) {
    var parts = (timeValue || '09:00').split(':');
    var h = Number(parts[0]); if (isNaN(h)) h = 9;
    var m = Number(parts[1]); if (isNaN(m)) m = 0;
    var d = new Date();
    d.setHours(h, m, 0, 0);
    d.setMinutes(d.getMinutes() + minutes);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function updatePreviewAndSummary() {
    var data = getFormData();
    var template = getSelectedTemplate();
    setText('previewTo', data.officerEmail || '—');
    setText('previewOfficer', data.officerSurname || '—');
    setText('previewClient', data.clientName || '—');
    setText('previewMatter', data.matter || '—');
    setText('previewSubject', data.subject || '—');
    setText('previewBody', rawValueOf('officerBodyInput') || '—');
    setText('summaryOfficer', data.officerSurname || 'Not entered');
    setText('summaryEmail', data.officerEmail || 'Not entered');
    setText('summaryClient', data.clientName || 'Not entered');
    setText('summaryMatter', data.matter || 'Not entered');
    setText('summaryTemplate', template.name);
    setText('summaryRecords', String(records.length));
    updateComposeWarnings();
    updateCopyButtonStates();
    syncEmailDevDiagnostics();
    updatePendingAndFallbackUi();
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function showError(message) {
    var error = $('officerEmailError');
    var notice = $('officerEmailNotice');
    if (notice) notice.classList.add('hidden');
    if (error) {
      error.textContent = message;
      error.classList.remove('hidden');
    }
  }

  function showNotice(message) {
    var error = $('officerEmailError');
    var notice = $('officerEmailNotice');
    if (error) error.classList.add('hidden');
    if (notice) {
      notice.textContent = message;
      notice.classList.remove('hidden');
    }
  }

  function isStorageAvailable() {
    try {
      var key = '__custody_note_storage_test__';
      localStorage.setItem(key, 'ok');
      localStorage.removeItem(key);
      return true;
    } catch (e) { return false; }
  }

  function runTests() {
    var sample = {
      officerEmail: 'officer.fisher@police.uk',
      officerRank: 'DC',
      officerSurname: 'Fisher',
      policeStationOrUnit: 'Kent Police',
      custodyNumber: 'CN-001',
      dsccReference: 'DSCC/42',
      attendanceDate: '2026-04-30',
      attendanceTime: '14:30',
      clientName: 'John Smith',
      matter: 'Assault allegation',
      attendanceNote: '',
      templateKey: 'request_bail_details',
      subject: '',
      body: '',
    };
    var tpl = OFFICER_EMAIL_TEMPLATES.request_bail_details;
    var subject = composeMerge(tpl.subjectTemplate, buildPlaceholderMapFromForm(sample));
    var bodyCore = composeMerge(tpl.bodyTemplate, buildPlaceholderMapFromForm(sample));
    var body = bodyCore + '\n\n' + feeEarnerClosingSignature();
    var copyTextValue = 'To: ' + sample.officerEmail + '\nSubject: ' + subject + '\n\n' + body;
    var beforeRecords = records.slice();

    var storageRoundTrip = false;
    if (isStorageAvailable()) {
      var testRecord = {
        id: 'test-record-' + Date.now(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'Draft',
        officerEmail: sample.officerEmail,
        officerRank: sample.officerRank,
        officerSurname: sample.officerSurname,
        policeStationOrUnit: sample.policeStationOrUnit,
        custodyNumber: sample.custodyNumber,
        dsccReference: sample.dsccReference,
        attendanceDate: sample.attendanceDate,
        attendanceTime: sample.attendanceTime,
        clientName: sample.clientName,
        matter: sample.matter,
        attendanceNote: sample.attendanceNote,
        templateKey: 'request_bail_details',
        templateName: 'Request Bail Details',
        subject: subject,
        body: body,
      };
      records = [testRecord].concat(beforeRecords.filter(function (r) { return r.id !== testRecord.id; }));
      saveRecords();
      var loaded = loadRecords();
      storageRoundTrip = loaded.some(function (r) { return r.id === testRecord.id; });
      records = beforeRecords;
      saveRecords();
      renderRecords();
    }

    var dateResult = adjustDate('2026-04-30', 1);
    var timeResult = adjustTime('10:00', 15);

    var results = [
      {
        name: 'Email validation rejects invalid email',
        passed: !isValidEmail('not-an-email'),
        detail: 'Invalid email rejected.',
      },
      {
        name: 'Template inserts officer surname',
        passed: body.indexOf('Fisher') >= 0,
        detail: 'Officer surname found in body.',
      },
      {
        name: 'Template inserts client name',
        passed: body.indexOf('John Smith') >= 0,
        detail: 'Client name found in body.',
      },
      {
        name: 'Template inserts police station',
        passed: body.indexOf('Kent Police') >= 0,
        detail: 'Police station placeholder merged.',
      },
      {
        name: 'Template inserts custody number',
        passed: body.indexOf('CN-001') >= 0,
        detail: 'Custody number merged.',
      },
      {
        name: 'Copy full email uses To / Subject / blank line / body (no Body: label)',
        passed: copyTextValue.indexOf('To:') >= 0 && copyTextValue.indexOf('Subject:') >= 0 &&
          copyTextValue.indexOf('\n\n') > 0 && copyTextValue.indexOf('Body:') < 0,
        detail: 'Clipboard format checked.',
      },
      {
        name: 'localStorage can save and load records',
        passed: storageRoundTrip,
        detail: storageRoundTrip ? 'Storage round trip passed.' : 'Storage round trip failed (or unavailable).',
      },
      {
        name: 'Date adjustment works',
        passed: dateResult === '2026-05-01',
        detail: '2026-04-30 + 1 day = ' + dateResult,
      },
      {
        name: 'Time adjustment works',
        passed: timeResult === '10:15',
        detail: '10:00 + 15 minutes = ' + timeResult,
      },
      {
        name: 'Required fields validation works for save/mark (subject + body)',
        passed: getMissingRequiredFields({
          subject: '',
          body: '',
          officerEmail: '',
        }).length >= 2,
        detail: 'Missing subject and body detected.',
      },
      {
        name: 'CustodyEmailCompose template merge is wired (preload)',
        passed: !!(window.CustodyEmailCompose && typeof window.CustodyEmailCompose.mergeTemplatePlaceholders === 'function'),
        detail: 'preload exposes CustodyEmailCompose for {{placeholder}} merging.',
      },
      {
        name: 'Salutation uses rank and surname with comma',
        passed: /^Dear DC Fisher,\n\n/.test(bodyCore),
        detail: 'Dear {{officerRank}} {{officerSurname}},',
      },
    ];

    renderTestResults(results);
    setActiveTab('testing');
    showNotice('Tests completed.');
  }

  function renderTestResults(results) {
    var container = $('officerTestResults');
    if (!container) return;
    container.innerHTML = '';
    results.forEach(function (result) {
      var row = document.createElement('div');
      row.className = result.passed ? 'test-pass' : 'test-fail';
      row.innerHTML =
        '<strong>' + (result.passed ? 'PASS' : 'FAIL') + ' — ' + escapeHtml(result.name) + '</strong>' +
        '<p>' + escapeHtml(result.detail) + '</p>';
      container.appendChild(row);
    });
  }

  function runDebugCheck() {
    var data = getFormData();
    var missing = getMissingRequiredFields(data);
    var output = {
      activeOfficerEmailTab: activeTab,
      selectedTemplate: getSelectedTemplate().name,
      formIsValid: missing.length === 0,
      missingRequiredFields: missing,
      savedRecordCount: records.length,
      localStorageAvailable: isStorageAvailable(),
      lastSavedRecordStatus: records[0] ? records[0].status : 'No saved records',
      activeRecordId: activeRecordId,
      custodyEmailComposeAvailable: !!(window.CustodyEmailCompose && typeof window.CustodyEmailCompose.mergeTemplatePlaceholders === 'function'),
      pendingDraftGlobalsAvailable: typeof window.getPendingEmailDraft === 'function',
      note: 'v1.6.21 — copy-and-paste only; no Outlook IPC or emailAPI bridge.',
    };
    var debug = $('officerDebugOutput');
    if (debug) debug.textContent = JSON.stringify(output, null, 2);
    setActiveTab('testing');
    showNotice('Debug check completed.');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  var OfficerEmails = {
    init: init,
    onShow: onShow,
    /* Internal helpers exposed for ad-hoc renderer-console testing only. */
    _internal: {
      adjustDate: adjustDate,
      adjustTime: adjustTime,
      isValidEmail: isValidEmail,
      getMissingRequiredFields: getMissingRequiredFields,
      templates: OFFICER_EMAIL_TEMPLATES,
    },
  };

  window.OfficerEmails = OfficerEmails;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
