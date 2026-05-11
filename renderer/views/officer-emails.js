/* ═══════════════════════════════════════════════════════════════════════════
   OFFICER EMAILS — renderer view module
   ───────────────────────────────────────────────────────────────────────────
   Right-hand drawer that prepares Outlook Web compose drafts for the current
   custody note. SECURITY: no passwords / MFA codes are ever requested; the
   only outbound action is a single `window.api.officerEmails.openOutlookDraft`
   call which delegates the URL build and `shell.openExternal` to main.js.

   The drawer is mounted on the form view and toggled by the #officer-emails-btn
   button in the form header. Drafts are scoped to `window.currentAttendanceId`.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  /* ── Template constants (must mirror lib/officerEmailTemplates.js) ─────── */
  var TEMPLATE_LABELS = {
    disclosure_confirm_attendance: 'Disclosure / confirm attendance',
    custody_log_request: 'Custody log request',
    chase_disclosure: 'Chase disclosure',
    confirm_matter_effective: 'Confirm matter is effective',
    request_officer_contact: 'Request officer contact details',
    request_update_after_delay: 'Request update after delay',
    bail_details_request: 'Bail details request',
    voluntary_interview_confirmation: 'Voluntary interview confirmation',
    free_text: 'Free text email',
  };
  var STATUS_LABELS = {
    draft: 'Draft',
    ready_for_outlook: 'Ready for Outlook',
    opened_in_outlook: 'Opened in Outlook',
    sent_manually: 'Sent manually',
    cancelled: 'Cancelled',
    deleted: 'Deleted',
  };
  var FIXED_ALLOWED_DOMAINS = [
    'police.uk', 'cps.gov.uk', 'justice.gov.uk', 'gov.uk',
    'judiciary.uk', 'mod.gov.uk', 'nhs.net', 'nhs.uk',
  ];
  var PLACEHOLDERS = {
    clientName: '[Client Name]',
    policeStation: '[Police Station]',
    offence: '[Offence]',
    attendanceDate: '[Date]',
    bailReturnDate: '[Bail Return Date]',
    bailConditions: '[Bail Conditions]',
  };
  var SIGNATURE_NAME = 'Robert Cashman';
  var MAX_BODY_CHARS = 50000;

  function escHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function $(id) { return document.getElementById(id); }
  function val(id) { var el = $(id); return el ? String(el.value || '') : ''; }
  function setVal(id, v) { var el = $(id); if (el) el.value = (v == null ? '' : String(v)); }

  /* ── Pure helpers (template + URL + validation, mirrored from lib) ─────── */
  function defaultRecipientName(templateType) {
    return templateType === 'custody_log_request' ? 'DDO' : 'Officer';
  }

  function generateSubject(d) {
    return [
      d.clientName || PLACEHOLDERS.clientName,
      d.policeStation || PLACEHOLDERS.policeStation,
      d.offence || PLACEHOLDERS.offence,
      TEMPLATE_LABELS[d.templateType] || 'Officer email',
    ].join(' - ');
  }

  function salutation(recipientName, templateType) {
    var trimmed = (recipientName || '').trim();
    return 'Dear ' + (trimmed || defaultRecipientName(templateType));
  }

  function placeholderOr(v, fallback) {
    var t = (v || '').trim();
    return t || fallback;
  }

  function generateBody(d) {
    var client = placeholderOr(d.clientName, PLACEHOLDERS.clientName);
    var station = placeholderOr(d.policeStation, PLACEHOLDERS.policeStation);
    var offence = placeholderOr(d.offence, PLACEHOLDERS.offence);
    var dateText = placeholderOr(d.attendanceDate, PLACEHOLDERS.attendanceDate);
    var lines = [];
    lines.push(salutation(d.recipientName, d.templateType));
    lines.push('');
    switch (d.templateType) {
      case 'disclosure_confirm_attendance':
        lines.push('I am writing to confirm my attendance as the solicitor representing ' +
          client + ' at ' + station + ' on ' + dateText + ' in relation to ' + offence + '.');
        lines.push('');
        lines.push('Please send pre-interview disclosure at your earliest convenience.');
        break;
      case 'custody_log_request':
        lines.push('Please could you send through a copy of the custody log for ' +
          client + ' in relation to ' + offence + ' at ' + station + ' on ' + dateText + '.');
        break;
      case 'chase_disclosure':
        lines.push('Further to my earlier request, please could you send the disclosure for ' +
          client + ' (offence: ' + offence + ') at ' + station + ' on ' + dateText + ' as soon as possible.');
        break;
      case 'confirm_matter_effective':
        lines.push('Please can you confirm that the ' + client + ' matter (offence: ' +
          offence + ') at ' + station + ' on ' + dateText + ' is effective.');
        break;
      case 'request_officer_contact':
        lines.push('Please could you confirm the contact details of the officer in charge for ' +
          client + ' (offence: ' + offence + ') at ' + station + ' on ' + dateText + '.');
        break;
      case 'request_update_after_delay':
        lines.push('I am following up regarding ' + client + ' at ' + station +
          ' (offence: ' + offence + ') on ' + dateText + '. Please can you provide an update.');
        break;
      case 'bail_details_request':
        lines.push('Please could you provide the bail details for ' + client +
          ' (offence: ' + offence + ') at ' + station + ' on ' + dateText + ', including:');
        lines.push('- Bail return date: ' + placeholderOr(d.bailReturnDate, PLACEHOLDERS.bailReturnDate));
        lines.push('- Bail conditions: ' + placeholderOr(d.bailConditions, PLACEHOLDERS.bailConditions));
        break;
      case 'voluntary_interview_confirmation':
        lines.push('I confirm that I will be representing ' + client +
          ' in relation to the voluntary interview on ' + dateText +
          ' at ' + station + ' regarding ' + offence + '.');
        break;
      case 'free_text':
        return '';
      default:
        return '';
    }
    var extra = (d.extraNote || '').trim();
    if (extra) {
      lines.push('');
      lines.push('Additional note: ' + extra);
    }
    lines.push('');
    lines.push('Kind regards,');
    lines.push(SIGNATURE_NAME);
    return lines.join('\n');
  }

  function isPlausibleEmail(value) {
    var v = (value || '').trim();
    if (!v) return false;
    if (v.split('@').length !== 2) return false;
    var parts = v.split('@');
    if (!parts[0]) return false;
    if (!parts[1] || parts[1].indexOf('.') < 0) return false;
    return true;
  }

  function extractDomain(value) {
    var v = (value || '').trim().toLowerCase();
    var at = v.lastIndexOf('@');
    return at < 0 ? '' : v.slice(at + 1);
  }

  function domainMatches(emailDomain, allowed) {
    if (!emailDomain || !allowed) return false;
    var d = String(emailDomain).toLowerCase();
    var a = String(allowed).toLowerCase();
    return d === a || d.endsWith('.' + a);
  }

  function isAllowedDomain(value, extras) {
    var dom = extractDomain(value);
    if (!dom) return false;
    var lists = [FIXED_ALLOWED_DOMAINS, Array.isArray(extras) ? extras : []];
    for (var i = 0; i < lists.length; i++) {
      var list = lists[i];
      for (var j = 0; j < list.length; j++) {
        if (domainMatches(dom, list[j])) return true;
      }
    }
    return false;
  }

  function validateDraft(d, extraDomains) {
    var warnings = [];
    var errors = [];
    if ((d.body || '').length > MAX_BODY_CHARS) {
      errors.push('Body is too long (max ' + MAX_BODY_CHARS + ' characters).');
    }
    if (!(d.toEmail || '').trim()) {
      warnings.push('Recipient email is blank.');
    } else if (!isPlausibleEmail(d.toEmail)) {
      warnings.push('Recipient email does not look valid.');
    } else if (!isAllowedDomain(d.toEmail, extraDomains)) {
      warnings.push('Recipient domain is not on the trusted list (police.uk, cps.gov.uk, gov.uk, judiciary.uk, mod.gov.uk, nhs.net, nhs.uk, plus your firm domains).');
    }
    if (!(d.subject || '').trim()) warnings.push('Subject is blank.');
    if (d.templateType !== 'free_text' && !(d.body || '').trim()) warnings.push('Body is blank.');
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  /* ── Local state (single-draft editor) ─────────────────────────────────── */
  var state = {
    currentDraft: null,        // server-saved draft object, or null for unsaved-new
    draftsCache: [],           // list of saved drafts for the current custody note
    userEditedBody: false,     // tracks manual edits so we can warn on template switch
    userEditedSubject: false,
    firmDomains: [],
    openLock: false,           // single-flight guard around Outlook open
  };

  /* ── Drawer open/close ─────────────────────────────────────────────────── */
  function openDrawer() {
    var drawer = $('officer-emails-drawer');
    var backdrop = $('officer-emails-backdrop');
    if (!drawer) return;
    drawer.classList.remove('hidden');
    drawer.setAttribute('aria-hidden', 'false');
    if (backdrop) {
      backdrop.classList.remove('hidden');
      backdrop.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('officer-email-open');
    refreshFromCurrentNote();
    document.addEventListener('keydown', onKeyDown);
  }

  function closeDrawer() {
    var drawer = $('officer-emails-drawer');
    var backdrop = $('officer-emails-backdrop');
    if (!drawer) return;
    drawer.classList.add('hidden');
    drawer.setAttribute('aria-hidden', 'true');
    if (backdrop) {
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('officer-email-open');
    document.removeEventListener('keydown', onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') closeDrawer();
  }

  /* ── Form ↔ object helpers ─────────────────────────────────────────────── */
  function readForm() {
    return {
      templateType: val('oe-template-type') || 'disclosure_confirm_attendance',
      toEmail: val('oe-to-email').trim(),
      recipientName: val('oe-recipient-name').trim(),
      clientName: val('oe-client-name').trim(),
      policeStation: val('oe-police-station').trim(),
      offence: val('oe-offence').trim(),
      attendanceDate: val('oe-attendance-date').trim(),
      extraNote: val('oe-extra-note').trim(),
      bailReturnDate: val('oe-bail-return-date').trim(),
      bailConditions: val('oe-bail-conditions').trim(),
      userEmailAddress: val('oe-user-email').trim(),
      subject: val('oe-subject'),
      body: val('oe-body'),
    };
  }

  function writeForm(d) {
    setVal('oe-template-type', d.templateType || 'disclosure_confirm_attendance');
    setVal('oe-to-email', d.toEmail || '');
    setVal('oe-recipient-name', d.recipientName || '');
    setVal('oe-client-name', d.clientName || '');
    setVal('oe-police-station', d.policeStation || '');
    setVal('oe-offence', d.offence || '');
    setVal('oe-attendance-date', d.attendanceDate || '');
    setVal('oe-extra-note', d.extraNote || '');
    setVal('oe-bail-return-date', d.bailReturnDate || '');
    setVal('oe-bail-conditions', d.bailConditions || '');
    setVal('oe-user-email', d.userEmailAddress || '');
    setVal('oe-subject', d.subject || '');
    setVal('oe-body', d.body || '');
    syncBailFieldVisibility();
    renderWarnings();
  }

  function syncBailFieldVisibility() {
    var section = $('oe-bail-fields');
    if (!section) return;
    section.style.display = val('oe-template-type') === 'bail_details_request' ? '' : 'none';
  }

  /* ── Prefill helpers — pull defaults from current form, but never mutate it */
  function pickFormDataField() {
    if (window.formData && typeof window.formData === 'object') return window.formData;
    return null;
  }

  function getCurrentNoteDefaults() {
    var fd = pickFormDataField();
    if (!fd) return {};
    var clientName = '';
    var first = (fd.forename || '').trim();
    var last = (fd.surname || '').trim();
    if (first || last) clientName = (first + ' ' + last).trim();
    return {
      clientName: clientName,
      policeStation: (fd.policeStationName || '').trim(),
      offence: (fd.offence || fd.allegation || '').trim(),
      attendanceDate: (fd.date || fd.attendanceDate || '').trim(),
    };
  }

  function getUserEmailDefault() {
    try {
      var s = window._latestSettings || {};
      if (typeof s.userEmail === 'string' && s.userEmail) return s.userEmail;
    } catch (_) {}
    return '';
  }

  /* ── Subject + body auto-generation (with overwrite protection) ────────── */
  function refreshSubjectIfDefault() {
    if (state.userEditedSubject) return;
    var d = readForm();
    setVal('oe-subject', generateSubject(d));
  }

  function refreshBodyForTemplate(force) {
    var d = readForm();
    if (d.templateType === 'free_text') {
      if (force) setVal('oe-body', '');
      return;
    }
    if (force || !state.userEditedBody) {
      setVal('oe-body', generateBody(d));
      state.userEditedBody = false;
    }
  }

  /* ── Firm domains (best-effort, ignore errors) ─────────────────────────── */
  function loadFirmDomains() {
    if (!window.api || typeof window.api.firmsList !== 'function') return;
    window.api.firmsList().then(function (rows) {
      if (!Array.isArray(rows)) return;
      var seen = {};
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var email = rows[i] && rows[i].contact_email ? String(rows[i].contact_email) : '';
        var dom = extractDomain(email);
        if (dom && !seen[dom]) {
          seen[dom] = 1;
          out.push(dom);
        }
      }
      state.firmDomains = out;
    }).catch(function () { /* best-effort */ });
  }

  /* ── Warnings UI ───────────────────────────────────────────────────────── */
  function renderWarnings() {
    var holder = $('oe-warnings');
    if (!holder) return;
    var v = validateDraft(readForm(), state.firmDomains);
    var messages = v.errors.concat(v.warnings);
    if (!messages.length) {
      holder.style.display = 'none';
      holder.innerHTML = '';
      return;
    }
    holder.style.display = '';
    holder.innerHTML = '<ul class="officer-email-warning-list">' +
      messages.map(function (m) { return '<li>' + escHtml(m) + '</li>'; }).join('') +
      '</ul>';
  }

  /* ── Draft list rendering ──────────────────────────────────────────────── */
  function fmtTimestamp(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString();
    } catch (_) { return iso; }
  }

  function renderDraftsList() {
    var holder = $('officer-emails-list');
    if (!holder) return;
    if (!state.draftsCache.length) {
      holder.innerHTML = '<p class="officer-email-list-empty">No drafts yet.</p>';
      return;
    }
    var html = state.draftsCache.map(function (d) {
      var isOpen = state.currentDraft && state.currentDraft.id === d.id;
      return '<article class="officer-email-draft-card' + (isOpen ? ' officer-email-draft-card-active' : '') +
        '" data-draft-id="' + escHtml(d.id) + '">' +
        '  <header class="officer-email-draft-card-head">' +
        '    <span class="officer-email-draft-card-type">' + escHtml(TEMPLATE_LABELS[d.templateType] || d.templateType) + '</span>' +
        '    <span class="officer-email-status officer-email-status-' + escHtml(d.status) + '">' +
              escHtml(STATUS_LABELS[d.status] || d.status) + '</span>' +
        '  </header>' +
        '  <div class="officer-email-draft-card-line"><span class="officer-email-draft-card-label">To:</span> ' + escHtml(d.toEmail || '—') + '</div>' +
        '  <div class="officer-email-draft-card-line"><span class="officer-email-draft-card-label">Subject:</span> ' + escHtml(d.subject || '—') + '</div>' +
        '  <div class="officer-email-draft-card-meta">Updated ' + escHtml(fmtTimestamp(d.updatedAt)) + '</div>' +
        '  <div class="officer-email-draft-card-actions">' +
        '    <button type="button" class="btn btn-small" data-oe-action="load">Load</button>' +
        '    <button type="button" class="btn btn-small btn-secondary" data-oe-action="duplicate">Duplicate</button>' +
        '    <button type="button" class="btn btn-small btn-danger" data-oe-action="delete">Delete</button>' +
        '  </div>' +
        '</article>';
    }).join('');
    holder.innerHTML = html;
  }

  function loadDraftIntoForm(draft) {
    state.currentDraft = draft;
    state.userEditedBody = false;
    state.userEditedSubject = false;
    writeForm({
      templateType: draft.templateType || 'disclosure_confirm_attendance',
      toEmail: draft.toEmail || '',
      recipientName: draft.recipientName || '',
      clientName: draft.clientName || '',
      policeStation: draft.policeStation || '',
      offence: draft.offence || '',
      attendanceDate: draft.attendanceDate || '',
      extraNote: draft.extraNote || '',
      bailReturnDate: draft.bailReturnDate || '',
      bailConditions: draft.bailConditions || '',
      userEmailAddress: draft.userEmailAddress || '',
      subject: draft.subject || '',
      body: draft.body || '',
    });
    syncEditingButtons();
    renderDraftsList();
  }

  function syncEditingButtons() {
    var hasDraft = !!(state.currentDraft && state.currentDraft.id);
    $('oe-duplicate').style.display = hasDraft ? '' : 'none';
    $('oe-cancel').style.display = hasDraft && state.currentDraft.status !== 'cancelled' ? '' : 'none';
    $('oe-delete').style.display = hasDraft ? '' : 'none';
    var markSent = $('oe-mark-sent');
    var canMarkSent = hasDraft && (state.currentDraft.status === 'opened_in_outlook' || state.currentDraft.status === 'ready_for_outlook');
    if (markSent) markSent.style.display = canMarkSent ? '' : 'none';
  }

  /* ── New draft (in-form, no DB write yet) ──────────────────────────────── */
  function startNewDraft() {
    state.currentDraft = null;
    state.userEditedBody = false;
    state.userEditedSubject = false;
    var defaults = getCurrentNoteDefaults();
    var fresh = {
      templateType: 'disclosure_confirm_attendance',
      toEmail: '',
      recipientName: '',
      clientName: defaults.clientName || '',
      policeStation: defaults.policeStation || '',
      offence: defaults.offence || '',
      attendanceDate: defaults.attendanceDate || '',
      extraNote: '',
      bailReturnDate: '',
      bailConditions: '',
      userEmailAddress: getUserEmailDefault(),
      subject: '',
      body: '',
    };
    fresh.subject = generateSubject(fresh);
    fresh.body = generateBody(fresh);
    writeForm(fresh);
    syncEditingButtons();
    renderDraftsList();
  }

  /* ── Refresh from server when the drawer opens / the note changes ─────── */
  function refreshFromCurrentNote() {
    var id = window.currentAttendanceId;
    var noNote = $('officer-emails-no-note');
    var body = $('officer-emails-body');
    if (!id) {
      if (noNote) noNote.style.display = '';
      if (body) body.style.display = 'none';
      return;
    }
    if (noNote) noNote.style.display = 'none';
    if (body) body.style.display = '';

    if (!window.api || !window.api.officerEmails || typeof window.api.officerEmails.listDrafts !== 'function') {
      console.error('[officer-emails] preload bridge missing window.api.officerEmails');
      return;
    }
    window.api.officerEmails.listDrafts(String(id)).then(function (rows) {
      state.draftsCache = Array.isArray(rows) ? rows : [];
      if (!state.currentDraft) {
        startNewDraft();
      } else {
        renderDraftsList();
      }
    }).catch(function (err) {
      console.error('[officer-emails] listDrafts failed:', err);
      if (typeof window.showToast === 'function') window.showToast('Could not load drafts.', 'error');
    });
  }

  /* ── Save / update / duplicate / cancel / delete / mark-sent ───────────── */
  function buildDraftPayload() {
    var d = readForm();
    return {
      custodyNoteId: String(window.currentAttendanceId || ''),
      templateType: d.templateType,
      toEmail: d.toEmail,
      recipientName: d.recipientName,
      clientName: d.clientName,
      policeStation: d.policeStation,
      offence: d.offence,
      attendanceDate: d.attendanceDate,
      extraNote: d.extraNote,
      bailReturnDate: d.bailReturnDate,
      bailConditions: d.bailConditions,
      userEmailAddress: d.userEmailAddress,
      subject: d.subject,
      body: d.body,
    };
  }

  function saveDraft() {
    if (!window.currentAttendanceId) {
      window.showToast && window.showToast('Save the custody note before creating email drafts.', 'error');
      return Promise.resolve(null);
    }
    var payload = buildDraftPayload();
    var promise = state.currentDraft && state.currentDraft.id
      ? window.api.officerEmails.updateDraft(state.currentDraft.id, payload)
      : window.api.officerEmails.createDraft(payload);
    return promise.then(function (saved) {
      state.currentDraft = saved;
      // Reset user-edit flags after a clean save so subsequent template changes
      // do not falsely warn about losing edits that are already persisted.
      state.userEditedBody = false;
      state.userEditedSubject = false;
      window.showToast && window.showToast('Draft saved.', 'success');
      return refreshFromCurrentNote().then ? refreshFromCurrentNote() : null;
    }).catch(function (err) {
      console.error('[officer-emails] save failed:', err);
      window.showToast && window.showToast('Could not save draft: ' + (err && err.message ? err.message : err), 'error');
      return null;
    });
  }

  function duplicateCurrent() {
    if (!state.currentDraft || !state.currentDraft.id) {
      window.showToast && window.showToast('Save the draft first, then duplicate.', 'info');
      return;
    }
    window.api.officerEmails.duplicateDraft(state.currentDraft.id).then(function (copy) {
      window.showToast && window.showToast('Draft duplicated.', 'success');
      loadDraftIntoForm(copy);
      refreshFromCurrentNote();
    }).catch(function (err) {
      console.error('[officer-emails] duplicate failed:', err);
      window.showToast && window.showToast('Could not duplicate: ' + (err && err.message ? err.message : err), 'error');
    });
  }

  function cancelCurrent() {
    if (!state.currentDraft || !state.currentDraft.id) return;
    var confirmFn = window.showConfirm || function (msg) { return Promise.resolve(window.confirm(msg)); };
    confirmFn('Cancel this draft? It will be kept but marked as cancelled.', 'Cancel draft').then(function (ok) {
      if (!ok) return;
      window.api.officerEmails.cancelDraft(state.currentDraft.id).then(function (updated) {
        state.currentDraft = updated;
        window.showToast && window.showToast('Draft cancelled.', 'success');
        refreshFromCurrentNote();
      }).catch(function (err) {
        console.error('[officer-emails] cancel failed:', err);
        window.showToast && window.showToast('Could not cancel: ' + (err && err.message ? err.message : err), 'error');
      });
    });
  }

  function deleteCurrent() {
    if (!state.currentDraft || !state.currentDraft.id) return;
    var confirmFn = window.showConfirm || function (msg) { return Promise.resolve(window.confirm(msg)); };
    confirmFn('Delete this draft permanently from the panel? (Soft-delete; the row remains in the database for audit.)', 'Delete draft').then(function (ok) {
      if (!ok) return;
      window.api.officerEmails.deleteDraft(state.currentDraft.id).then(function () {
        window.showToast && window.showToast('Draft deleted.', 'success');
        state.currentDraft = null;
        refreshFromCurrentNote();
      }).catch(function (err) {
        console.error('[officer-emails] delete failed:', err);
        window.showToast && window.showToast('Could not delete: ' + (err && err.message ? err.message : err), 'error');
      });
    });
  }

  function deleteById(draftId) {
    var confirmFn = window.showConfirm || function (msg) { return Promise.resolve(window.confirm(msg)); };
    confirmFn('Delete this draft? (Soft-delete; the row remains in the database for audit.)', 'Delete draft').then(function (ok) {
      if (!ok) return;
      window.api.officerEmails.deleteDraft(draftId).then(function () {
        if (state.currentDraft && state.currentDraft.id === draftId) state.currentDraft = null;
        refreshFromCurrentNote();
      }).catch(function (err) {
        console.error('[officer-emails] delete failed:', err);
      });
    });
  }

  function duplicateById(draftId) {
    window.api.officerEmails.duplicateDraft(draftId).then(function (copy) {
      window.showToast && window.showToast('Draft duplicated.', 'success');
      loadDraftIntoForm(copy);
      refreshFromCurrentNote();
    }).catch(function (err) {
      console.error('[officer-emails] duplicate failed:', err);
    });
  }

  function loadById(draftId) {
    var found = state.draftsCache.filter(function (d) { return d.id === draftId; })[0];
    if (found) loadDraftIntoForm(found);
  }

  function markSentManually() {
    if (!state.currentDraft || !state.currentDraft.id) return;
    var confirmFn = window.showConfirm || function (msg) { return Promise.resolve(window.confirm(msg)); };
    confirmFn('Mark this draft as sent manually? This only updates the status — it does not send anything.', 'Mark as sent').then(function (ok) {
      if (!ok) return;
      window.api.officerEmails.markSentManually(state.currentDraft.id).then(function (updated) {
        state.currentDraft = updated;
        window.showToast && window.showToast('Marked as sent.', 'success');
        refreshFromCurrentNote();
      }).catch(function (err) {
        console.error('[officer-emails] mark-sent failed:', err);
      });
    });
  }

  /* ── Outlook Web open (single-flight, server-built URL) ─────────────────── */
  function openInOutlookWeb() {
    if (state.openLock) return;
    if (!window.currentAttendanceId) {
      window.showToast && window.showToast('Save the custody note first.', 'error');
      return;
    }
    var d = readForm();
    var v = validateDraft(d, state.firmDomains);
    if (!v.ok) {
      window.showToast && window.showToast(v.errors[0] || 'Cannot open: draft has errors.', 'error');
      return;
    }
    var proceedAfterWarnings = v.warnings.length === 0
      ? Promise.resolve(true)
      : (window.showConfirm
          ? window.showConfirm('Heads-up before opening Outlook Web:\n\n• ' + v.warnings.join('\n• ') + '\n\nContinue?', 'Confirm draft')
          : Promise.resolve(window.confirm(v.warnings.join('\n') + '\n\nContinue?')));

    proceedAfterWarnings.then(function (ok1) {
      if (!ok1) return;
      var preview =
        'To: ' + (d.toEmail || '(blank)') + '\n' +
        'Subject: ' + (d.subject || '(blank)') + '\n\n' +
        'Outlook Web will open in your default browser. Review and click Send manually — nothing is sent automatically.';
      var confirmFn = window.showConfirm || function (msg) { return Promise.resolve(window.confirm(msg)); };
      confirmFn(preview, 'Open in Outlook Web').then(function (ok2) {
        if (!ok2) return;
        state.openLock = true;
        // Save first (the main process opens the URL from the stored row), then
        // mark "ready_for_outlook" before opening so the audit trail is correct
        // even if the browser launch fails.
        var payload = buildDraftPayload();
        payload.status = 'ready_for_outlook';
        var saver = state.currentDraft && state.currentDraft.id
          ? window.api.officerEmails.updateDraft(state.currentDraft.id, payload)
          : window.api.officerEmails.createDraft(payload);
        saver.then(function (saved) {
          state.currentDraft = saved;
          return window.api.officerEmails.openOutlookDraft(saved.id);
        }).then(function (res) {
          if (res && res.ok) {
            return window.api.officerEmails.markOpenedInOutlook(state.currentDraft.id).then(function (updated) {
              state.currentDraft = updated;
              window.showToast && window.showToast('Opened in Outlook Web. Review and send manually.', 'success', 4500);
              refreshFromCurrentNote();
            });
          }
          throw new Error((res && res.error) || 'Failed to open Outlook Web');
        }).catch(function (err) {
          console.error('[officer-emails] openInOutlookWeb failed:', err);
          window.showToast && window.showToast('Could not open Outlook Web: ' + (err && err.message ? err.message : err), 'error', 5000);
        }).then(function () { state.openLock = false; });
      });
    });
  }

  /* ── Copy buttons (clipboard with main-process fallback) ───────────────── */
  function copyText(text, label) {
    var onSuccess = function () {
      window.showToast && window.showToast('Copied — ' + label + '.', 'success');
    };
    var onFail = function () {
      window.showToast && window.showToast('Could not copy ' + label + '.', 'error');
    };
    if (typeof text !== 'string' || !text.length) {
      window.showToast && window.showToast('Nothing to copy.', 'info');
      return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(onSuccess, function () {
        if (window.api && window.api.officerEmails && window.api.officerEmails.clipboardWrite) {
          window.api.officerEmails.clipboardWrite(text).then(function (res) {
            if (res && res.ok) onSuccess(); else onFail();
          }, onFail);
        } else { onFail(); }
      });
      return;
    }
    if (window.api && window.api.officerEmails && window.api.officerEmails.clipboardWrite) {
      window.api.officerEmails.clipboardWrite(text).then(function (res) {
        if (res && res.ok) onSuccess(); else onFail();
      }, onFail);
      return;
    }
    onFail();
  }

  /* ── Wiring ────────────────────────────────────────────────────────────── */
  function wireEvents() {
    var openBtn = $('officer-emails-btn');
    var closeBtn = $('officer-emails-close');
    var backdrop = $('officer-emails-backdrop');
    if (openBtn) openBtn.addEventListener('click', function (e) { e.preventDefault(); openDrawer(); });
    if (closeBtn) closeBtn.addEventListener('click', function (e) { e.preventDefault(); closeDrawer(); });
    if (backdrop) backdrop.addEventListener('click', closeDrawer);

    // Template type change — may overwrite body. Warn if user has edited it.
    var tmpl = $('oe-template-type');
    if (tmpl) {
      tmpl.addEventListener('change', function () {
        syncBailFieldVisibility();
        var hasUserBody = state.userEditedBody;
        if (!hasUserBody) {
          refreshBodyForTemplate(true);
          refreshSubjectIfDefault();
          renderWarnings();
          return;
        }
        var choose = window.showChoice || function (msg, _t, opts) {
          var ok = window.confirm(msg + '\n\nApply new template? (Cancel keeps your edits.)');
          return Promise.resolve(ok ? (opts[1] && opts[1].id) : (opts[0] && opts[0].id));
        };
        choose('Changing template may overwrite your edited email. Continue?', 'Template change', [
          { id: 'keep', label: 'Keep current draft', variant: 'secondary' },
          { id: 'apply', label: 'Apply new template', variant: 'primary' },
        ]).then(function (choice) {
          if (choice === 'apply') {
            refreshBodyForTemplate(true);
            refreshSubjectIfDefault();
          }
          renderWarnings();
        });
      });
    }

    // Fields that should re-flow into subject/body when changed.
    var liveFields = ['oe-to-email', 'oe-recipient-name', 'oe-client-name', 'oe-police-station',
                      'oe-offence', 'oe-attendance-date', 'oe-extra-note',
                      'oe-bail-return-date', 'oe-bail-conditions'];
    liveFields.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        refreshSubjectIfDefault();
        // Only auto-refresh the body when the user has not manually edited it.
        if (!state.userEditedBody) refreshBodyForTemplate(false);
        renderWarnings();
      });
    });

    var subjectEl = $('oe-subject');
    if (subjectEl) {
      subjectEl.addEventListener('input', function () {
        state.userEditedSubject = true;
        renderWarnings();
      });
    }
    var bodyEl = $('oe-body');
    if (bodyEl) {
      bodyEl.addEventListener('input', function () {
        state.userEditedBody = true;
        renderWarnings();
      });
    }

    $('oe-save').addEventListener('click', function (e) { e.preventDefault(); saveDraft(); });
    $('oe-new').addEventListener('click', function (e) {
      e.preventDefault();
      var unsavedNew = !state.currentDraft && (val('oe-body') || val('oe-subject'));
      if (unsavedNew) {
        var confirmFn = window.showConfirm || function (msg) { return Promise.resolve(window.confirm(msg)); };
        confirmFn('Start a new draft? The current unsaved draft will be discarded.', 'New draft').then(function (ok) {
          if (ok) startNewDraft();
        });
      } else {
        startNewDraft();
      }
    });
    $('oe-duplicate').addEventListener('click', function (e) { e.preventDefault(); duplicateCurrent(); });
    $('oe-cancel').addEventListener('click', function (e) { e.preventDefault(); cancelCurrent(); });
    $('oe-delete').addEventListener('click', function (e) { e.preventDefault(); deleteCurrent(); });
    $('oe-mark-sent').addEventListener('click', function (e) { e.preventDefault(); markSentManually(); });
    $('oe-open-outlook').addEventListener('click', function (e) { e.preventDefault(); openInOutlookWeb(); });

    $('oe-copy-recipient').addEventListener('click', function (e) { e.preventDefault(); copyText(val('oe-to-email'), 'recipient'); });
    $('oe-copy-subject').addEventListener('click', function (e) { e.preventDefault(); copyText(val('oe-subject'), 'subject'); });
    $('oe-copy-body').addEventListener('click', function (e) { e.preventDefault(); copyText(val('oe-body'), 'body'); });

    var list = $('officer-emails-list');
    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('button[data-oe-action]') : null;
        if (!btn) return;
        var card = btn.closest('.officer-email-draft-card');
        if (!card) return;
        var draftId = card.getAttribute('data-draft-id');
        if (!draftId) return;
        var action = btn.getAttribute('data-oe-action');
        if (action === 'load') loadById(draftId);
        else if (action === 'duplicate') duplicateById(draftId);
        else if (action === 'delete') deleteById(draftId);
      });
    }
  }

  /* ── Boot ──────────────────────────────────────────────────────────────── */
  function init() {
    if (!$('officer-emails-drawer')) return;       // safety: markup missing
    wireEvents();
    loadFirmDomains();
    // Expose a tiny hook so app.js can refresh the draft list when the user
    // switches between attendance records. Calling refresh when the drawer is
    // closed simply primes the in-memory state for the next open.
    window.refreshOfficerEmails = function () {
      state.currentDraft = null;
      state.userEditedBody = false;
      state.userEditedSubject = false;
      var drawer = $('officer-emails-drawer');
      if (drawer && !drawer.classList.contains('hidden')) {
        refreshFromCurrentNote();
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
