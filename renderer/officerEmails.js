/* ═══════════════════════════════════════════════════════════
   Officer Emails — vanilla-JS Custody Note feature.

   Prepares standard officer emails, opens them in Outlook on the
   web (https://outlook.office.com/mail/deeplink/compose), and keeps
   a local record in localStorage. The Outlook URL is launched via
   window.custodyNote.openExternalUrl(...) which is allowlisted in
   the main process to that exact deeplink/compose prefix.

   This module only manages the inner UI of #view-officer-emails.
   The home-card click and the back-button click are wired into the
   existing app.js click delegation (which calls showView), so we do
   NOT toggle the .view container ourselves — we only manage the
   inner tab panels and their .hidden state.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STORAGE_KEY = 'custody_note_officer_email_records_v2';
  var OUTLOOK_PREFIX = 'https://outlook.office.com/mail/deeplink/compose';

  var activeTab = 'details';
  var activeRecordId = null;
  var records = [];
  var initialised = false;

  var templates = {
    bail_details: {
      key: 'bail_details',
      name: 'Bail details request',
      subject: function (data) {
        return 'Bail details request – ' + safe(data.clientName, '[Client Name]') + ' – ' + safe(data.matter, '[Matter]');
      },
      body: function (data) {
        var note = (data.attendanceNote || '').trim();
        return 'Dear Officer ' + safe(data.officerSurname, '[Officer Surname]') + ',\n\n' +
          'I am writing in relation to ' + safe(data.clientName, '[Client Name]') + ', whom I attended on ' +
          formatDateForEmail(data.attendanceDate) + ' at ' + safe(data.attendanceTime, '[Time]') +
          ' in respect of ' + safe(data.matter, '[Matter]') + '.\n\n' +
          (note ? note + '\n\n' : '') +
          'Please could you confirm the bail return date, time, and any bail conditions imposed.\n\n' +
          'Kind regards,\nRobert Cashman';
      },
    },

    attendance_confirmation: {
      key: 'attendance_confirmation',
      name: 'Attendance confirmation',
      subject: function (data) {
        return 'Attendance confirmation – ' + safe(data.clientName, '[Client Name]') + ' – ' + safe(data.matter, '[Matter]');
      },
      body: function (data) {
        var note = (data.attendanceNote || '').trim();
        return 'Dear Officer ' + safe(data.officerSurname, '[Officer Surname]') + ',\n\n' +
          'I write to confirm that I attended upon ' + safe(data.clientName, '[Client Name]') + ' on ' +
          formatDateForEmail(data.attendanceDate) + ' at ' + safe(data.attendanceTime, '[Time]') +
          ' in respect of ' + safe(data.matter, '[Matter]') + '.\n\n' +
          (note ? note + '\n\n' : '') +
          'Please let me know if you require anything further.\n\n' +
          'Kind regards,\nRobert Cashman';
      },
    },

    /* Bug fix per spec: salutation MUST be "Dear Officer [Surname]," with
       the comma after the surname and a blank line below it. */
    disclosure_update: {
      key: 'disclosure_update',
      name: 'Disclosure / update request',
      subject: function (data) {
        return 'Request for update – ' + safe(data.clientName, '[Client Name]') + ' – ' + safe(data.matter, '[Matter]');
      },
      body: function (data) {
        var note = (data.attendanceNote || '').trim();
        return 'Dear Officer ' + safe(data.officerSurname, '[Officer Surname]') + ',\n\n' +
          'I am writing in relation to ' + safe(data.clientName, '[Client Name]') + ', whom I attended on ' +
          formatDateForEmail(data.attendanceDate) + ' at ' + safe(data.attendanceTime, '[Time]') +
          ' in respect of ' + safe(data.matter, '[Matter]') + '.\n\n' +
          (note ? note + '\n\n' : '') +
          'Please could you provide an update in relation to this matter, including any relevant bail, release, charging, NFA, or further investigation position.\n\n' +
          'Kind regards,\nRobert Cashman';
      },
    },

    general: {
      key: 'general',
      name: 'General officer email',
      subject: function (data) {
        return safe(data.clientName, '[Client Name]') + ' – ' + safe(data.matter, '[Matter]');
      },
      body: function (data) {
        var note = (data.attendanceNote || '').trim();
        return 'Dear Officer ' + safe(data.officerSurname, '[Officer Surname]') + ',\n\n' +
          'I am writing in relation to ' + safe(data.clientName, '[Client Name]') + ' in respect of ' +
          safe(data.matter, '[Matter]') + '.\n\n' +
          (note ? note + '\n\n' : '') +
          'Kind regards,\nRobert Cashman';
      },
    },
  };

  function init() {
    if (initialised) return;
    var screen = document.getElementById('view-officer-emails');
    if (!screen) return;
    initialised = true;
    records = loadRecords();
    bindTabs();
    bindFormInputs();
    bindActionButtons();
    renderRecords();
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
      'officerSurnameInput',
      'officerReferenceInput',
      'policeStationOrUnitInput',
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
    bindClick('officerOpenOutlookHeroBtn', openInOutlookWeb);
    bindClick('officerOpenOutlookBtn', openInOutlookWeb);
    bindClick('officerOpenOutlookPreviewBtn', openInOutlookWeb);
    bindClick('officerOpenOutlookSideBtn', openInOutlookWeb);

    bindClick('officerGenerateBtn', generateFromTemplate);
    bindClick('officerContinueComposeBtn', function () {
      generateFromTemplate();
      setActiveTab('compose');
    });

    bindClick('officerClearSubjectBodyBtn', clearSubjectBody);
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
    return {
      officerEmail: valueOf('officerEmailInput'),
      officerSurname: valueOf('officerSurnameInput'),
      officerReference: valueOf('officerReferenceInput'),
      policeStationOrUnit: valueOf('policeStationOrUnitInput'),
      attendanceDate: valueOf('attendanceDateInput'),
      attendanceTime: valueOf('attendanceTimeInput'),
      clientName: valueOf('clientNameInput'),
      matter: valueOf('matterInput'),
      attendanceNote: valueOf('attendanceNoteInput'),
      templateKey: valueOf('officerTemplateSelect') || 'bail_details',
      subject: valueOf('officerSubjectInput'),
      body: valueOf('officerBodyInput'),
    };
  }

  function setFormData(data) {
    setValue('officerEmailInput', data.officerEmail || '');
    setValue('officerSurnameInput', data.officerSurname || '');
    setValue('officerReferenceInput', data.officerReference || '');
    setValue('policeStationOrUnitInput', data.policeStationOrUnit || '');
    setValue('attendanceDateInput', data.attendanceDate || '');
    setValue('attendanceTimeInput', data.attendanceTime || '');
    setValue('clientNameInput', data.clientName || '');
    setValue('matterInput', data.matter || '');
    setValue('attendanceNoteInput', data.attendanceNote || '');
    setValue('officerTemplateSelect', data.templateKey || 'bail_details');
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

  function safe(value, fallback) {
    var s = value == null ? '' : String(value);
    return s.trim() ? s.trim() : fallback;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatDateForEmail(dateValue) {
    if (!dateValue) return '[Date]';
    var date = new Date(dateValue + 'T00:00:00');
    if (isNaN(date.getTime())) return '[Date]';
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  function getSelectedTemplate() {
    var key = valueOf('officerTemplateSelect') || 'bail_details';
    return templates[key] || templates.bail_details;
  }

  function generateFromTemplate() {
    var data = getFormData();
    var template = getSelectedTemplate();
    setValue('officerSubjectInput', template.subject(data));
    setValue('officerBodyInput', template.body(data));
    showNotice('Email generated from selected template.');
    updatePreviewAndSummary();
  }

  function buildOutlookWebUrl(data) {
    var params = new URLSearchParams({
      to: data.officerEmail || '',
      subject: data.subject || '',
      body: (typeof data.body === 'string' && data.body !== '')
        ? data.body
        : rawValueOf('officerBodyInput'),
    });
    return OUTLOOK_PREFIX + '?' + params.toString();
  }

  function openInOutlookWeb() {
    var validationError = validate();
    if (validationError) { showError(validationError); return; }
    var data = getFormData();
    var outlookUrl = buildOutlookWebUrl(data);

    var launch;
    if (window.custodyNote && typeof window.custodyNote.openExternalUrl === 'function') {
      launch = Promise.resolve(window.custodyNote.openExternalUrl(outlookUrl));
    } else {
      try {
        window.open(outlookUrl, '_blank', 'noopener,noreferrer');
        launch = Promise.resolve(true);
      } catch (err) {
        launch = Promise.reject(err);
      }
    }

    launch.then(function () {
      var now = new Date().toISOString();
      var record = buildRecord('Opened in Outlook Web');
      record.openedAt = now;
      record.updatedAt = now;
      upsertRecord(record);
      activeRecordId = record.id;
      showNotice('Outlook Web will open in your browser. If prompted, sign in to the email account you want to send from. Review the email in Outlook before sending.');
    }).catch(function (error) {
      showError('Unable to open Outlook Web: ' + (error && error.message ? error.message : String(error)));
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
    if (!data.officerEmail) missing.push('Officer email');
    if (data.officerEmail && !isValidEmail(data.officerEmail)) missing.push('Valid officer email');
    if (!data.officerSurname) missing.push('Officer surname');
    if (!data.attendanceDate) missing.push('Date of attendance');
    if (!data.attendanceTime) missing.push('Time of attendance');
    if (!data.clientName) missing.push('Client name');
    if (!data.matter) missing.push('Matter');
    if (!data.subject) missing.push('Subject');
    var bodyValue = (data.body != null ? String(data.body) : rawValueOf('officerBodyInput'));
    if (!bodyValue.trim()) missing.push('Email body');
    return missing;
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
      officerSurname: data.officerSurname,
      officerReference: data.officerReference,
      policeStationOrUnit: data.policeStationOrUnit,
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
      card.querySelector('[data-action="copy-body"]').addEventListener('click', function () { copyText(record.body || '', 'Record body copied.'); });
      card.querySelector('[data-action="copy-full"]').addEventListener('click', function () { copyText(buildFullEmailText(record), 'Full record email copied.'); });
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
        officerSurname: '',
        officerReference: '',
        policeStationOrUnit: '',
        attendanceDate: '',
        attendanceTime: '',
        clientName: '',
        matter: '',
        attendanceNote: record.attendanceNote || '',
        templateKey: record.templateKey || 'bail_details',
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
    var url = buildOutlookWebUrl({
      officerEmail: record.officerEmail,
      subject: record.subject,
      body: record.body,
    });
    var launch;
    if (window.custodyNote && typeof window.custodyNote.openExternalUrl === 'function') {
      launch = Promise.resolve(window.custodyNote.openExternalUrl(url));
    } else {
      try {
        window.open(url, '_blank', 'noopener,noreferrer');
        launch = Promise.resolve(true);
      } catch (err) { launch = Promise.reject(err); }
    }
    launch.then(function () {
      showNotice('Outlook Web opened for saved record.');
    }).catch(function (error) {
      showError('Unable to open Outlook Web: ' + (error && error.message ? error.message : String(error)));
    });
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
      'officerSurnameInput',
      'officerReferenceInput',
      'policeStationOrUnitInput',
      'attendanceDateInput',
      'attendanceTimeInput',
      'clientNameInput',
      'matterInput',
      'attendanceNoteInput',
      'officerSubjectInput',
      'officerBodyInput',
    ];
    for (var i = 0; i < ids.length; i++) setValue(ids[i], '');
    setValue('officerTemplateSelect', 'bail_details');
    showNotice('Form cleared.');
    updatePreviewAndSummary();
  }

  function clearSubjectBody() {
    setValue('officerSubjectInput', '');
    setValue('officerBodyInput', '');
    showNotice('Subject and body cleared.');
    updatePreviewAndSummary();
  }

  function copyBody() {
    return copyText(rawValueOf('officerBodyInput'), 'Email body copied.');
  }

  function copyFullEmail() {
    var data = getFormData();
    return copyText(buildFullEmailText(data), 'Full email copied.');
  }

  function buildFullEmailText(data) {
    var bodyText = (data.body && String(data.body)) || rawValueOf('officerBodyInput');
    return 'To: ' + (data.officerEmail || '') + '\n\n' +
      'Subject: ' + (data.subject || '') + '\n\n' +
      'Body:\n' + bodyText;
  }

  function copyText(text, message) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(String(text == null ? '' : text))
        .then(function () { showNotice(message); })
        .catch(function () { fallbackCopy(text, message); });
    }
    fallbackCopy(text, message);
    return Promise.resolve();
  }

  function fallbackCopy(text, message) {
    try {
      var ta = document.createElement('textarea');
      ta.value = String(text == null ? '' : text);
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) showNotice(message);
      else showError('Unable to copy to clipboard.');
    } catch (e) {
      showError('Unable to copy to clipboard.');
    }
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
    setText('previewTo', data.officerEmail || 'Not entered');
    setText('previewOfficer', data.officerSurname || 'Not entered');
    setText('previewClient', data.clientName || 'Not entered');
    setText('previewMatter', data.matter || 'Not entered');
    setText('previewSubject', data.subject || 'Not generated');
    setText('previewBody', rawValueOf('officerBodyInput') || 'Email body will appear here.');
    setText('summaryOfficer', data.officerSurname || 'Not entered');
    setText('summaryEmail', data.officerEmail || 'Not entered');
    setText('summaryClient', data.clientName || 'Not entered');
    setText('summaryMatter', data.matter || 'Not entered');
    setText('summaryTemplate', template.name);
    setText('summaryRecords', String(records.length));
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
      officerSurname: 'Fisher',
      officerReference: '1234',
      policeStationOrUnit: 'Kent Police',
      attendanceDate: '2026-04-30',
      attendanceTime: '14:30',
      clientName: 'John Smith',
      matter: 'Assault allegation',
      attendanceNote: 'The client was interviewed under caution.',
      templateKey: 'bail_details',
      subject: '',
      body: '',
    };
    var template = templates.bail_details;
    var subject = template.subject(sample);
    var body = template.body(sample);
    var url = buildOutlookWebUrl({
      officerEmail: sample.officerEmail,
      subject: subject,
      body: body,
    });
    var copyTextValue = 'To: ' + sample.officerEmail + '\n\nSubject: ' + subject + '\n\nBody:\n' + body;
    var beforeRecords = records.slice();

    var storageRoundTrip = false;
    if (isStorageAvailable()) {
      var testRecord = {
        id: 'test-record-' + Date.now(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'Draft',
        officerEmail: sample.officerEmail,
        officerSurname: sample.officerSurname,
        officerReference: sample.officerReference,
        policeStationOrUnit: sample.policeStationOrUnit,
        attendanceDate: sample.attendanceDate,
        attendanceTime: sample.attendanceTime,
        clientName: sample.clientName,
        matter: sample.matter,
        attendanceNote: sample.attendanceNote,
        templateKey: 'bail_details',
        templateName: 'Bail details request',
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
        name: 'Outlook URL uses Outlook Web deeplink',
        passed: url.indexOf(OUTLOOK_PREFIX) === 0,
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
        name: 'Template inserts matter',
        passed: body.indexOf('Assault allegation') >= 0,
        detail: 'Matter found in body.',
      },
      {
        name: 'Template inserts attendance note',
        passed: body.indexOf('The client was interviewed under caution.') >= 0,
        detail: 'Attendance note found in body.',
      },
      {
        name: 'Copy full email contains To, Subject and Body',
        passed: copyTextValue.indexOf('To:') >= 0 && copyTextValue.indexOf('Subject:') >= 0 && copyTextValue.indexOf('Body:') >= 0,
        detail: 'Copy format checked.',
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
        name: 'Required fields validation works',
        passed: getMissingRequiredFields({
          officerEmail: '',
          officerSurname: '',
          attendanceDate: '',
          attendanceTime: '',
          clientName: '',
          matter: '',
          subject: '',
          body: '',
        }).length > 0,
        detail: 'Missing fields detected.',
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
      outlookWebUrlPreview: buildOutlookWebUrl(data),
      lastSavedRecordStatus: records[0] ? records[0].status : 'No saved records',
      activeRecordId: activeRecordId,
      ipcOpenExternalUrlAvailable: !!(window.custodyNote && typeof window.custodyNote.openExternalUrl === 'function'),
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
      adjustDate: adjustDate,
      adjustTime: adjustTime,
      isValidEmail: isValidEmail,
      getMissingRequiredFields: getMissingRequiredFields,
      templates: templates,
    },
  };

  window.OfficerEmails = OfficerEmails;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
