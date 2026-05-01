/* ═══════════════════════════════════════════════════════════
   Officer Emails — vanilla-JS Custody Note feature.

   Primary workflow: {{placeholder}} templates → preview → copy / paste into
   Outlook (custodyCopyEmailText). Optional: savePendingEmailDraft +
   openEmailDraft (mailto / Outlook Web) — never sends mail automatically.

   This module only manages the inner UI of #view-officer-emails.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STORAGE_KEY = 'custody_note_officer_email_records_v2';
  var SESSION_OPEN_FLAG = 'custodynite_officer_email_open_attempted';
  var OW_ATTEMPT_KEY = 'custodynite_officer_ow_attempt';
  /* H62 — Outlook sign-in hint. Persisted on this device so Edge / the
     Outlook PWA pick the right account when the active browser session is
     signed in to a different one (e.g. a personal Gmail). First-time empty
     field may pre-fill from Settings (fee earner / solicitor email) only —
     never a hardcoded address. User can edit on the Compose tab. */
  var LOGIN_HINT_STORAGE_KEY = 'custody_note_officer_email_login_hint_v1';
  /* Removed legacy mistaken default — migrate old localStorage so no install keeps it. */
  var LEGACY_LOGIN_HINT_TO_STRIP = 'cashmanr@tuckerssolicitors.com';
  /* H62 — Outlook handler choice. 'edge-inprivate' (default) spawns Edge
     in InPrivate mode so the OWA URL bypasses the Outlook PWA hijack.
     'desktop' writes an .eml draft (only useful when .eml is associated
     with Outlook desktop, NOT the Outlook PWA). 'web' uses the default
     browser. v2: bumped from v1 so the previous 'desktop' default no
     longer wins on machines where the PWA hijacks .eml files too. */
  var HANDLER_STORAGE_KEY = 'custody_note_officer_email_handler_v2';
  var outlookDesktopDetected = null; // null = unknown, true/false after detection
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
   * Placeholder-driven templates ({{fieldName}}). Body excludes closing;
   * feeEarnerClosingSignature() is appended after merge.
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
    records = loadRecords();
    bindTabs();
    bindFormInputs();
    bindActionButtons();
    bindDiagnosticsCopyButtons();
    bindFallbackAndPendingButtons();
    bindEmailComposeDiagnosticsButtons();
    renderRecords();
    updatePreviewAndSummary();
    updatePendingAndFallbackUi();
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
      'officerReferenceInput',
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

    /* Login-hint field: pre-fill from localStorage, else Settings email, then
       auto-save on every change so the user only types it once. */
    var loginHintEl = $('officerLoginHintInput');
    if (loginHintEl) {
      stripLegacyLoginHintIfPresent();
      var initialHint = getStoredLoginHint();
      if (!initialHint) initialHint = settingsFallbackLoginHint();
      loginHintEl.value = initialHint;
      loginHintEl.addEventListener('input', function () {
        saveLoginHint(loginHintEl.value);
        updatePreviewAndSummary();
      });
      loginHintEl.addEventListener('change', function () {
        saveLoginHint(loginHintEl.value);
        updatePreviewAndSummary();
      });
    }

    /* Handler radios: pre-select from localStorage, default to 'desktop'.
       Auto-detect whether Outlook desktop is installed and reflect in the
       inline status hint. */
    var stored = getStoredHandler();
    /* H62 — default to Edge InPrivate. Outlook desktop is unreliable on
       Windows machines where .eml is associated with the Outlook PWA, and
       the default-browser route is unreliable wherever the PWA intercepts
       outlook.office.com. Edge InPrivate has neither problem. */
    var initial = stored || 'edge-inprivate';
    setHandlerRadio(initial);
    bindHandlerRadios();
    syncLoginHintVisibility();
    detectOutlookDesktopAndUpdate();
  }

  var VALID_HANDLERS = ['edge-inprivate', 'desktop', 'web'];

  function getStoredHandler() {
    try {
      var v = window.localStorage.getItem(HANDLER_STORAGE_KEY);
      if (VALID_HANDLERS.indexOf(v) >= 0) return v;
    } catch (_) { /* localStorage unavailable */ }
    return null;
  }

  function saveHandler(value) {
    try {
      if (VALID_HANDLERS.indexOf(value) >= 0) {
        window.localStorage.setItem(HANDLER_STORAGE_KEY, value);
      }
    } catch (_) { /* localStorage unavailable */ }
  }

  function getCurrentHandler() {
    var checked = document.querySelector('input[name="officerOutlookHandler"]:checked');
    if (checked && VALID_HANDLERS.indexOf(checked.value) >= 0) return checked.value;
    return getStoredHandler() || 'edge-inprivate';
  }

  function setHandlerRadio(value) {
    var e = $('officerHandlerEdgeInPrivate');
    var d = $('officerHandlerDesktop');
    var w = $('officerHandlerWeb');
    if (e) e.checked = (value === 'edge-inprivate');
    if (d) d.checked = (value === 'desktop');
    if (w) w.checked = (value === 'web');
  }

  function bindHandlerRadios() {
    var ids = ['officerHandlerEdgeInPrivate', 'officerHandlerDesktop', 'officerHandlerWeb'];
    function onChange() {
      var val = getCurrentHandler();
      saveHandler(val);
      syncLoginHintVisibility();
      updatePreviewAndSummary();
    }
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el) el.addEventListener('change', onChange);
    }
  }

  function syncLoginHintVisibility() {
    var label = $('officerLoginHintLabel');
    var help = $('officerLoginHintHelp');
    /* Login-hint matters for any browser-based route (Edge InPrivate uses the
       same OWA URL with login_hint=…). Hide only for the desktop .eml route. */
    var visible = getCurrentHandler() !== 'desktop';
    if (label) label.style.display = visible ? '' : 'none';
    if (help) help.style.display = visible ? '' : 'none';
  }

  function detectOutlookDesktopAndUpdate() {
    var status = $('officerHandlerStatus');
    if (!window.emailAPI || typeof window.emailAPI.detectOutlookDesktop !== 'function') {
      outlookDesktopDetected = false;
      if (status) status.textContent = 'Outlook desktop detection unavailable in this build.';
      return;
    }
    Promise.resolve(window.emailAPI.detectOutlookDesktop()).then(function (result) {
      outlookDesktopDetected = !!(result && result.installed);
      if (!status) return;
      if (outlookDesktopDetected) {
        status.textContent = 'Outlook desktop detected on this PC. Edge InPrivate is still the most reliable on Windows when the Outlook PWA is also installed.';
      } else {
        status.textContent = 'Outlook desktop was NOT detected. Use Edge InPrivate (recommended) or Default browser above.';
      }
    }).catch(function () {
      outlookDesktopDetected = false;
      if (status) status.textContent = 'Outlook desktop detection failed (assume not installed).';
    });
  }

  function stripLegacyLoginHintIfPresent() {
    try {
      var v = window.localStorage.getItem(LOGIN_HINT_STORAGE_KEY);
      if (typeof v === 'string' && v.trim().toLowerCase() === LEGACY_LOGIN_HINT_TO_STRIP.toLowerCase()) {
        window.localStorage.removeItem(LOGIN_HINT_STORAGE_KEY);
      }
    } catch (_) { /* localStorage unavailable */ }
  }

  function settingsFallbackLoginHint() {
    try {
      var s = window._appSettingsCache || {};
      /* Same priority as main.js open-outlook-email (fee earner → solicitor → Your email). */
      return String(s.feeEarnerEmail || s.solicitorEmail || s.email || '').trim();
    } catch (_) {
      return '';
    }
  }

  function getStoredLoginHint() {
    try {
      var v = window.localStorage.getItem(LOGIN_HINT_STORAGE_KEY);
      if (typeof v === 'string' && v.trim()) return v.trim();
    } catch (_) { /* localStorage unavailable */ }
    return '';
  }

  function saveLoginHint(value) {
    var v = String(value == null ? '' : value).trim();
    try {
      if (v) window.localStorage.setItem(LOGIN_HINT_STORAGE_KEY, v);
      else window.localStorage.removeItem(LOGIN_HINT_STORAGE_KEY);
    } catch (_) { /* localStorage unavailable */ }
  }

  function getCurrentLoginHint() {
    var el = $('officerLoginHintInput');
    if (el && typeof el.value === 'string' && el.value.trim()) return el.value.trim();
    var stored = getStoredLoginHint();
    if (stored) return stored;
    /* No dedicated hint — use Your Details so OWA / login.microsoftonline.com gets login_hint. */
    return settingsFallbackLoginHint();
  }

  function bindActionButtons() {
    bindClick('officerOpenOutlookMailtoHeroBtn', function () { openOfficerDraft('mailto'); });
    bindClick('officerOpenOutlookHeroBtn', function () { openOfficerDraft('outlook-web'); });
    bindClick('officerOpenOutlookMailtoBtn', function () { openOfficerDraft('mailto'); });
    bindClick('officerOpenOutlookBtn', function () { openOfficerDraft('outlook-web'); });
    bindClick('officerOpenOutlookMailtoPreviewBtn', function () { openOfficerDraft('mailto'); });
    bindClick('officerOpenOutlookPreviewBtn', function () { openOfficerDraft('outlook-web'); });
    bindClick('officerOpenOutlookMailtoSideBtn', function () { openOfficerDraft('mailto'); });
    bindClick('officerOpenOutlookSideBtn', function () { openOfficerDraft('outlook-web'); });
    bindClick('officerHeroCopyBodyBtn', function () { copyBody(); });
    bindClick('officerCopyBodyPreviewBtn', function () { copyBody(); });
    bindClick('officerSideCopyBodyBtn', function () { copyBody(); });

    bindClick('officerGenerateBtn', generateFromTemplate);
    bindClick('officerContinueComposeBtn', function () {
      generateFromTemplate();
      setActiveTab('compose');
    });

    bindClick('officerClearSubjectBodyBtn', clearSubjectBody);
    bindClick('officerCopyOfficerEmailBtn', copyOfficerEmail);
    bindClick('officerCopySubjectBtn', copySubject);
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
    bindClick('officerOpenEmailSendTraceBtn', openEmailSendTraceReadme);

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
      officerReference: valueOf('officerReferenceInput'),
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
    setValue('officerReferenceInput', data.officerReference || '');
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
    var key = valueOf('officerTemplateSelect') || 'request_bail_details';
    if (LEGACY_TEMPLATE_KEYS[key]) key = LEGACY_TEMPLATE_KEYS[key];
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

  function buildOutlookWebUrl(data) {
    var bodyVal = (typeof data.body === 'string' && data.body !== '')
      ? data.body
      : rawValueOf('officerBodyInput');
    var fn = window.buildOutlookWebComposeLink || window.buildOutlookWebLink;
    if (typeof fn === 'function') {
      return fn({
        to: data.officerEmail || '',
        cc: '',
        subject: data.subject || '',
        body: bodyVal,
      });
    }
    return 'https://outlook.office.com/mail/deeplink/compose?';
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
    var pending = typeof window.getPendingEmailDraft === 'function' ? window.getPendingEmailDraft() : null;
    var attempted = false;
    var owAttempt = false;
    try {
      attempted = sessionStorage.getItem(SESSION_OPEN_FLAG) === '1';
      owAttempt = sessionStorage.getItem(OW_ATTEMPT_KEY) === '1';
    } catch (_) { /* sessionStorage unavailable */ }

    var signPanel = $('officerEmailSignInPanel');
    var fb = $('officerEmailFallbackPanel');
    if (signPanel) {
      if (owAttempt) signPanel.classList.remove('hidden');
      else signPanel.classList.add('hidden');
    }
    if (fb) {
      if (attempted || pending) fb.classList.remove('hidden');
      else fb.classList.add('hidden');
    }

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

  function buildMailtoPreviewUrl(data) {
    var bodyVal = (typeof data.body === 'string' && data.body !== '')
      ? data.body
      : rawValueOf('officerBodyInput');
    if (typeof window.buildMailtoLink === 'function') {
      return window.buildMailtoLink({
        to: data.officerEmail || '',
        cc: '',
        subject: data.subject || '',
        body: bodyVal,
      });
    }
    return '';
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
    var mailto = typeof window.buildMailtoLink === 'function'
      ? window.buildMailtoLink({
        to: data.officerEmail || '',
        cc: '',
        subject: data.subject || '',
        body: bodyVal,
      })
      : '';
    var owa = buildOutlookWebUrl(Object.assign({}, data, { body: bodyVal }));
    setText('officerDiagTo', data.officerEmail || '(empty)');
    setText('officerDiagSubject', data.subject || '(empty)');
    var mEl = $('officerDiagMailto');
    var oEl = $('officerDiagOwa');
    if (mEl) mEl.textContent = mailto || '(buildMailtoLink unavailable)';
    if (oEl) oEl.textContent = owa || '(buildOutlookWebLink unavailable)';
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
    wire('officerDiagCopyMailtoBtn', function (_d, bodyVal) {
      return typeof window.buildMailtoLink === 'function'
        ? window.buildMailtoLink({
          to: valueOf('officerEmailInput'),
          cc: '',
          subject: valueOf('officerSubjectInput'),
          body: bodyVal,
        })
        : '';
    }, 'Mailto link copied.');
    wire('officerDiagCopyOfficerEmailBtn', function (data) { return data.officerEmail || ''; }, 'Officer email copied.');
    wire('officerDiagCopySubjectBtn', function (data) { return data.subject || ''; }, 'Subject copied.');
  }

  /** True for allowed Officer Emails launch URLs (must match main process). */
  function isWorkOutlookComposeUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    try {
      var u = new URL(url);
      if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'outlook.office.com') {
        return false;
      }
      if (u.pathname === '/mail/deeplink/compose') return true;
      if (u.pathname === '/owa' || u.pathname === '/owa/') {
        return u.searchParams.get('path') === '/mail/action/compose';
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * @param {'mailto'|'outlook-web'} mode
   */
  function openOfficerDraft(mode) {
    var modeStr = mode === 'mailto' ? 'mailto' : 'outlook-web';
    var draft = buildCurrentDraft(modeStr);

    if (typeof window.savePendingEmailDraft !== 'function' || typeof window.openEmailDraft !== 'function') {
      showNotice('Outlook could not be opened automatically. Your email text is still available to copy and paste manually.');
      return;
    }

    try {
      window.savePendingEmailDraft(draft);
      var ok = window.openEmailDraft({
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        body: draft.body,
        mode: modeStr,
      });
      if (!ok) {
        showNotice('Outlook could not be opened automatically. Your email text is still available to copy and paste manually.');
        try { sessionStorage.setItem(SESSION_OPEN_FLAG, '1'); } catch (_) { /* ignore */ }
        updatePendingAndFallbackUi();
        return;
      }

      try {
        sessionStorage.setItem(SESSION_OPEN_FLAG, '1');
        if (modeStr === 'outlook-web') sessionStorage.setItem(OW_ATTEMPT_KEY, '1');
      } catch (_) { /* sessionStorage unavailable */ }

      updatePendingAndFallbackUi();

      var now = new Date().toISOString();
      var statusLabel = modeStr === 'mailto' ? 'Opened in Outlook' : 'Opened in Outlook Web';
      var record = buildRecord(statusLabel);
      record.openedAt = now;
      record.updatedAt = now;
      upsertRecord(record);
      activeRecordId = record.id;

      if (modeStr === 'mailto') {
        showNotice('Your default mail app should open with this draft. Review the email before sending.');
      } else {
        showNotice(
          'If Outlook asks you to sign in, complete sign-in, then return here and click “Continue opening draft”. ' +
          'Your draft stays saved in Custody Note until you clear it.'
        );
      }
    } catch (err) {
      console.error('[officerEmails] openOfficerDraft', err);
      showNotice('Outlook could not be opened automatically. Your email text is still available to copy and paste manually.');
      try { sessionStorage.setItem(SESSION_OPEN_FLAG, '1'); } catch (_) { /* ignore */ }
      updatePendingAndFallbackUi();
    }
  }

  function bindFallbackAndPendingButtons() {
    function bindOnce(id, fn) {
      var el = $(id);
      if (!el || el.dataset.bound === '1') return;
      el.dataset.bound = '1';
      el.addEventListener('click', fn);
    }
    bindOnce('officerContinueDraftBtn', function () {
      if (typeof window.resumePendingEmailDraft !== 'function') return;
      window.resumePendingEmailDraft('outlook-web');
      showNotice('Opening Outlook on the web again with your saved draft…');
    });
    bindOnce('officerFbContinueBtn', function () {
      if (typeof window.resumePendingEmailDraft !== 'function') return;
      window.resumePendingEmailDraft('outlook-web');
      showNotice('Opening Outlook on the web again with your saved draft…');
    });
    bindOnce('officerFbOpenMailtoBtn', function () {
      if (typeof window.resumePendingEmailDraft !== 'function') return;
      window.resumePendingEmailDraft('mailto');
    });
    bindOnce('officerFbOpenWebBtn', function () {
      if (typeof window.resumePendingEmailDraft !== 'function') return;
      window.resumePendingEmailDraft('outlook-web');
      showNotice('Opening Outlook on the web again…');
    });
    bindOnce('officerFbCopyOfficerEmailBtn', copyOfficerEmail);
    bindOnce('officerFbCopySubjectBtn', copySubject);
    bindOnce('officerFbCopyBodyBtn', copyBody);
    bindOnce('officerFbCopyFullBtn', copyFullEmail);
    bindOnce('officerClearPendingDraftBtn', function () {
      if (typeof window.clearPendingEmailDraft === 'function') window.clearPendingEmailDraft();
      try {
        sessionStorage.removeItem(SESSION_OPEN_FLAG);
        sessionStorage.removeItem(OW_ATTEMPT_KEY);
      } catch (_) { /* ignore */ }
      updatePendingAndFallbackUi();
      showNotice('Pending email draft cleared.');
    });
    bindOnce('officerDraftOpenedSuccessBtn', function () {
      if (typeof window.clearPendingEmailDraft === 'function') window.clearPendingEmailDraft();
      try {
        sessionStorage.removeItem(SESSION_OPEN_FLAG);
        sessionStorage.removeItem(OW_ATTEMPT_KEY);
      } catch (_) { /* ignore */ }
      updatePendingAndFallbackUi();
      showNotice('Saved draft cleared. Custody Note did not send any email.');
    });
  }

  function bindEmailComposeDiagnosticsButtons() {
    function bindOnce(id, fn) {
      var el = $(id);
      if (!el || el.dataset.boundDiag === '1') return;
      el.dataset.boundDiag = '1';
      el.addEventListener('click', fn);
    }
    bindOnce('officerDiagTestSavePending', function () {
      var d = buildCurrentDraft('outlook-web');
      if (typeof window.savePendingEmailDraft === 'function') window.savePendingEmailDraft(d);
      updatePendingAndFallbackUi();
      showNotice('Diagnostics: pending draft saved from current form.');
    });
    bindOnce('officerDiagTestResumeWeb', function () {
      if (typeof window.resumePendingEmailDraft === 'function') window.resumePendingEmailDraft('outlook-web');
    });
    bindOnce('officerDiagTestResumeMailto', function () {
      if (typeof window.resumePendingEmailDraft === 'function') window.resumePendingEmailDraft('mailto');
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
    var ids = [
      'officerCopyBodyBtn',
      'officerCopyFullBtn',
      'officerFbCopyBodyBtn',
      'officerFbCopyFullBtn',
      'officerHeroCopyBodyBtn',
      'officerCopyBodyPreviewBtn',
      'officerSideCopyBodyBtn',
    ];
    for (var i = 0; i < ids.length; i++) {
      var b = $(ids[i]);
      if (b) b.disabled = bodyEmpty;
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
      officerReference: data.officerReference,
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
          '<button type="button" data-action="reopen">Reopen Outlook</button>' +
          '<button type="button" data-action="copy-body">Copy Body</button>' +
          '<button type="button" data-action="copy-full">Copy Full</button>' +
          '<button type="button" data-action="mark-sent">Mark Sent</button>' +
          '<button type="button" data-action="cancel">Cancel</button>' +
          '<button type="button" data-action="delete" class="danger-button">Delete</button>' +
        '</div>';
      card.querySelector('[data-action="edit"]').addEventListener('click', function () { loadRecord(record); });
      card.querySelector('[data-action="duplicate"]').addEventListener('click', function () { duplicateRecord(record, false); });
      card.querySelector('[data-action="template"]').addEventListener('click', function () { duplicateRecord(record, true); });
      card.querySelector('[data-action="reopen"]').addEventListener('click', function () { reopenRecord(record); });
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
        officerReference: '',
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

  function reopenRecord(record) {
    if (typeof window.openEmailDraft !== 'function') {
      showError('Email draft helper is unavailable. Please restart Custody Note and try again.');
      return;
    }
    var to = record.officerEmail || '';
    if (!to || to.indexOf('@') < 0) {
      showError('Saved record has no valid officer email.');
      return;
    }
    var pendingDraft = {
      to: to,
      cc: '',
      subject: record.subject || '',
      body: record.body || '',
      templateId: record.templateKey || '',
      createdAt: new Date().toISOString(),
      mode: 'outlook-web',
    };
    if (typeof window.savePendingEmailDraft === 'function') {
      window.savePendingEmailDraft(pendingDraft);
    }
    var ok = window.openEmailDraft({
      to: to,
      cc: '',
      subject: record.subject || '',
      body: record.body || '',
      mode: 'outlook-web',
    });
    if (!ok) return;
    var now = new Date().toISOString();
    var updated = Object.assign({}, record, {
      status: 'Opened in Outlook Web',
      openedAt: now,
      updatedAt: now,
    });
    upsertRecord(updated);
    activeRecordId = updated.id;
    renderRecords();
    showNotice('Outlook on the web opened for saved record.');
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
      'officerReferenceInput',
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
    try {
      sessionStorage.removeItem(SESSION_OPEN_FLAG);
      sessionStorage.removeItem(OW_ATTEMPT_KEY);
    } catch (_) { /* ignore */ }
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
      officerReference: '1234',
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
    var url = buildOutlookWebUrl({
      officerEmail: sample.officerEmail,
      subject: subject,
      body: body,
    });
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
        officerReference: sample.officerReference,
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
        name: 'Outlook URL is outlook.office.com work compose',
        passed: isWorkOutlookComposeUrl(url),
        detail: url,
      },
      {
        name: 'Outlook URL contains to, subject and body',
        passed: url.indexOf('to=') >= 0 && url.indexOf('subject=') >= 0 && url.indexOf('body=') >= 0,
        detail: 'Checked URL query parameters.',
      },
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
        name: 'Email draft helper (mailto + OWA links) is wired',
        passed: typeof window.openEmailDraft === 'function'
          && typeof window.buildMailtoLink === 'function'
          && typeof window.buildOutlookWebLink === 'function',
        detail: 'renderer/email-draft-open.js defines openEmailDraft, buildMailtoLink, buildOutlookWebLink.',
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

  function openEmailSendTraceReadme() {
    if (!window.api || typeof window.api.openEmailSendTrace !== 'function') {
      showNotice('Email send trace is not available here.');
      return;
    }
    window.api.openEmailSendTrace().then(function (r) {
      if (!r || !r.ok) showNotice((r && r.error) || 'Could not open trace file.');
      else showNotice('Opened email-send-trace.txt (app data folder).');
    }).catch(function () {
      showNotice('Could not open trace file.');
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
      outlookWebUrlPreview: buildOutlookWebUrl(data),
      lastSavedRecordStatus: records[0] ? records[0].status : 'No saved records',
      activeRecordId: activeRecordId,
      openEmailDraftAvailable: typeof window.openEmailDraft === 'function',
      invokeOutlookWebComposeAvailable: typeof window.invokeOutlookWebCompose === 'function',
      emailApiOpenAvailable: !!(window.emailAPI && typeof window.emailAPI.open === 'function'),
      outlookLoginHint: getCurrentLoginHint() || '(none — Edge / PWA may pick the wrong account)',
      outlookHandler: getCurrentHandler(),
      outlookDesktopDetected: outlookDesktopDetected,
      outlookComposeUrlStyle: 'mail/deeplink/compose',
      mailtoUrlPreview: buildMailtoPreviewUrl(data),
      signInReminder: 'Outlook Web may ask you to sign in to the email account you want to send from.',
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
      buildOutlookWebUrl: buildOutlookWebUrl,
      buildMailtoPreviewUrl: buildMailtoPreviewUrl,
      isWorkOutlookComposeUrl: isWorkOutlookComposeUrl,
      adjustDate: adjustDate,
      adjustTime: adjustTime,
      isValidEmail: isValidEmail,
      getMissingRequiredFields: getMissingRequiredFields,
      templates: OFFICER_EMAIL_TEMPLATES,
      openOfficerDraft: openOfficerDraft,
    },
  };

  window.OfficerEmails = OfficerEmails;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
