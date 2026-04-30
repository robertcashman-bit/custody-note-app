/* ═══════════════════════════════════════════════════════
   EMAIL MODAL — Officer Email Templates Add-On
   Depends on: buildEmailBody, buildEmailSubject (email-templates.js)
   Compose opens only via window.invokeOutlookWebCompose → emailAPI.open (main IPC).
   ═══════════════════════════════════════════════════════ */

var _EMAIL_TEMPLATES = [
  { id: 'first_attendance',               label: 'First Attendance Disclosure Request' },
  { id: 'follow_up',                      label: 'Follow-Up / Outcome Request' },
  { id: 'no_reply',                       label: 'No Reply Follow-Up' },
  { id: 'bail_details_after_interview',   label: 'Bail Details After Interview' },
  { id: 'voluntary_interview_disclosure', label: 'Voluntary Interview Disclosure' },
  { id: 'custody_disclosure_request',     label: 'Custody Disclosure Request' },
  { id: 'pre_interview_chase',            label: 'Pre-Interview Chase for Disclosure' },
  { id: 'rui_update_request',             label: 'RUI / Investigation Update Request' },
  { id: 'file_reference_request',         label: 'Reference Confirmation Request' }
];

function _truncateBodyForOutlook(body) {
  var s = String(body || '');
  if (s.length > 4000) return s.slice(0, 4000) + '\n\n[continued]';
  return s;
}

function _invokeOutlookEmail(payload) {
  if (typeof window.invokeOutlookWebCompose !== 'function') {
    return Promise.reject(new Error('Email unavailable'));
  }
  /* Forward the saved account-type hint (work | personal | mailto) so the
     main process picks the right Outlook surface and the dialog wording
     matches what the user chose in Settings. v1.6.4: default surface is
     'work' (outlook.office.com/mail/deeplink/compose) — that's the URL
     that actually opens compose for users on M365 firm accounts (the
     common case for solicitors). Personal Outlook.com users can opt in
     via Settings → Your Details → "Quick Email opens in". */
  var settings = window._appSettingsCache || {};
  var requestedType = String((payload && payload.accountType) || '').toLowerCase();
  var accountType = String(requestedType || settings.outlookAccountType || '').toLowerCase();
  if (accountType !== 'personal' && accountType !== 'mailto') accountType = 'work';
  var enriched = Object.assign({}, payload || {}, { accountType: accountType });
  return window.invokeOutlookWebCompose(enriched).then(function(result) {
    /* Main returns { ok:false, cancelled:true } when the user dismisses the
       privacy dialog — must not show success toasts or callers think Outlook opened. */
    if (result && result.cancelled) {
      if (typeof showToast === 'function') {
        showToast(
          'Outlook was not opened — the confirmation dialog was cancelled. Use "Open in Outlook" on that dialog to launch compose.',
          'warning',
          6500
        );
      }
      return result;
    }
    if (result && result.skipped && result.reason === 'busy') {
      if (typeof showToast === 'function') {
        showToast('Already opening an email — please wait for it to finish.', 'info', 3500);
      }
      return result;
    }
    if (result && result.ok === false) {
      if (typeof showToast === 'function') {
        showToast('Outlook could not be opened. Try again or use Copy.', 'error', 5500);
      }
      return result;
    }
    if (result && result.composeSignature === false) {
      if (typeof showToast === 'function') {
        showToast(
          'Outlook opened but did not confirm a compose route (' + (result.composeReason || 'unknown') + '). Please use Copy and report this if it repeats.',
          'warning',
          7000
        );
      }
      return result;
    }
    var surface = accountType === 'mailto' ? 'your email app' : (accountType === 'work' ? 'Outlook on the web' : 'Outlook.com');
    showToast('Opening ' + surface + '…', 'success');
    if (result && result.truncated && result.clipboardCopied) {
      showToast('Email body was too long for the link — full body copied to clipboard, paste it into Outlook.', 'warning', 6000);
    } else if (result && result.truncated) {
      showToast('Email body was too long for the link — it has been trimmed. Paste the rest manually.', 'warning', 6000);
    }
    return result;
  }).catch(function(err) {
    console.error('[email-modal]', err);
    showToast(err && err.message ? err.message : 'Could not open email', 'error');
    return Promise.reject(err);
  });
}

function openEmailModal(recordId, recordData, recordStatus) {
  var stale = document.getElementById('email-oic-modal');
  if (stale) stale.remove();

  var data          = recordData || {};
  var settings      = window._appSettingsCache || {};
  var feeEarnerName = _oicClean(data.feeEarnerName) || _oicClean(settings.feeEarnerNameDefault) || '';
  var lastTplUsed   = _oicClean(data.lastOfficerEmailTemplateUsed);
  var currentTpl    = _EMAIL_TEMPLATES.some(function(t) { return t.id === lastTplUsed; }) ? lastTplUsed : 'first_attendance';
  var currentCustomTpl = '';

  /* ── Helpers ─────────────────────────────────────────── */

  function _escAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _openUrl(to, subject, body) {
    return _invokeOutlookEmail({
      to: String(to || '').trim(),
      cc: '',
      bcc: '',
      subject: subject || '',
      body: _truncateBodyForOutlook(body),
    });
  }

  function _getOfficerCustomTemplates() {
    var list = typeof window._getCustomEmailTemplates === 'function'
      ? (window._getCustomEmailTemplates() || [])
      : [];
    return list.map(function(tpl, idx) {
      return { id: 'custom:' + idx, template: tpl };
    }).filter(function(entry) {
      var tpl = entry.template;
      var scope = tpl && tpl.scope ? tpl.scope : 'all';
      return scope === 'all' || scope === 'officer';
    });
  }

  function _getOfficerCustomTemplateById(templateId) {
    if (!templateId || String(templateId).indexOf('custom:') !== 0) return null;
    var idx = parseInt(String(templateId).slice(7), 10);
    if (!Number.isFinite(idx) || idx < 0) return null;
    var list = typeof window._getCustomEmailTemplates === 'function'
      ? (window._getCustomEmailTemplates() || [])
      : [];
    var tpl = list[idx] || null;
    if (!tpl) return null;
    var scope = tpl.scope || 'all';
    return (scope === 'all' || scope === 'officer') ? tpl : null;
  }

  function _getOfficerPlaceholderMap() {
    return buildPlaceholderMap(data, feeEarnerName);
  }

  function _applyOfficerPlaceholders(text) {
    return applyPlaceholders(text, data, feeEarnerName);
  }

  /* ── Missing-field detection ─────────────────────────── */

  function _tplFieldLabel(key) {
    var L = {
      clientName: 'Client name', station: 'Police station', date: 'Date', time: 'Time',
      oicName: 'Officer name', firmName: 'Firm', contactName: 'Firm contact',
      feeEarnerName: 'Fee earner', outcome: 'Outcome', ourFileNumber: 'File number',
      ufn: 'UFN', offenceType: 'Offence', nextStep: 'Next step',
      attendanceType: 'Attendance type', officerEmail: 'Officer email'
    };
    return L[key] || key;
  }

  function _computeMissing() {
    var map = _getOfficerPlaceholderMap();
    var missing = [];
    var toEl = document.getElementById('email-oic-to');
    if (!toEl || !String(toEl.value || '').trim()) {
      missing.push({ key: 'to', label: 'Officer email address' });
    }
    var rawText = '';
    if (currentCustomTpl) {
      var custom = _getOfficerCustomTemplateById(currentCustomTpl);
      if (custom) rawText = (custom.subject || '') + '\n' + (custom.body || '');
    } else {
      var tplRaw = getEmailTemplateRaw(currentTpl);
      if (tplRaw) rawText = (tplRaw.subject || '') + '\n' + (tplRaw.body || '');
    }
    if (rawText) {
      var re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
      var seen = {};
      var m;
      while ((m = re.exec(rawText)) !== null) {
        var key = m[1];
        if (seen[key]) continue;
        seen[key] = true;
        var val = map[key];
        if (val == null || String(val).trim() === '') {
          missing.push({ key: key, label: _tplFieldLabel(key) });
        }
      }
    }
    return missing;
  }

  function _updateMissingWarn() {
    var warnEl = document.getElementById('email-oic-missing-warn');
    if (!warnEl) return;
    var missing = _computeMissing();
    if (!missing.length) { warnEl.style.display = 'none'; return; }
    warnEl.innerHTML = '&#9888;&nbsp;<strong>Missing:</strong> ' +
      missing.map(function(f) {
        return '<span class="email-oic-missing-tag">' + _escAttr(f.label) + '</span>';
      }).join('');
    warnEl.style.display = '';
  }

  function _currentTemplateKey() {
    return currentCustomTpl || currentTpl;
  }

  function _currentTemplateContent() {
    if (currentCustomTpl) {
      var custom = _getOfficerCustomTemplateById(currentCustomTpl);
      if (custom) {
        return {
          subject: _applyOfficerPlaceholders(custom.subject || ''),
          body: _applyOfficerPlaceholders(custom.body || '')
        };
      }
    }
    return {
      subject: buildEmailSubject(currentTpl, data),
      body: buildEmailBody(currentTpl, data, feeEarnerName)
    };
  }

  /* ── Render ──────────────────────────────────────────── */

  function _renderModal() {
    var stale2 = document.getElementById('email-oic-modal');
    if (stale2) stale2.remove();

    var oicEmail = _oicClean(data.oicEmail);
    var customTemplates = _getOfficerCustomTemplates();
    if (lastTplUsed && String(lastTplUsed).indexOf('custom:') === 0 && !currentCustomTpl && _getOfficerCustomTemplateById(lastTplUsed)) {
      currentCustomTpl = lastTplUsed;
    }
    var tplContent = _currentTemplateContent();
    var subject  = tplContent.subject;
    var body     = tplContent.body;

    var tabsHtml = _EMAIL_TEMPLATES.map(function(t) {
      return '<button type="button" class="email-oic-tab' +
        (!currentCustomTpl && t.id === currentTpl ? ' active' : '') +
        '" data-tpl="' + t.id + '">' + _escAttr(t.label) + '</button>';
    }).join('');

    var customTemplateHtml = customTemplates.length
      ? '<label class="email-oic-label" for="email-oic-custom-template">Saved custom template</label>' +
        '<select id="email-oic-custom-template" class="email-oic-input">' +
          '<option value="">Use built-in templates below</option>' +
          customTemplates.map(function(entry) {
            var tpl = entry.template || {};
            var templateId = entry.id || '';
            var scope = tpl.scope || 'all';
            var prefix = scope === 'officer' ? '[Officer] ' : '';
            return '<option value="' + _escAttr(templateId) + '"' + (currentCustomTpl === templateId ? ' selected' : '') + '>' +
              _escAttr(prefix + (tpl.name || 'Custom template')) + '</option>';
          }).join('') +
        '</select>' +
        '<p class="email-oic-hint">Officer-only and shared templates appear here.</p>'
      : '';

    var noEmailNote = !oicEmail
      ? '<p class="email-oic-hint">No OIC email address is stored for this record. Enter one below or leave blank to copy the email body manually.</p>'
      : '';

    var html =
      '<div id="email-oic-modal" class="email-oic-overlay" role="dialog" aria-modal="true" aria-label="Email OIC">' +
        '<div class="email-oic-box">' +
          '<div class="email-oic-header">' +
            '<h3 class="email-oic-title">&#9993; Email OIC</h3>' +
            '<button type="button" class="email-oic-close" aria-label="Close modal">&times;</button>' +
          '</div>' +
          '<div class="email-oic-tabs" role="group" aria-label="Email template">' + tabsHtml + '</div>' +
          '<div class="email-oic-fields">' +
            noEmailNote +
            customTemplateHtml +
            '<label class="email-oic-label" for="email-oic-to">To</label>' +
            '<input type="email" id="email-oic-to" class="email-oic-input" value="' + _escAttr(oicEmail) +
              '" placeholder="Enter officer email address">' +
            '<label class="email-oic-label" for="email-oic-subject">Subject</label>' +
            '<input type="text" id="email-oic-subject" class="email-oic-input" value="' + _escAttr(subject) + '">' +
            '<label class="email-oic-label" for="email-oic-body">Message</label>' +
            '<textarea id="email-oic-body" class="email-oic-textarea" rows="14">' + _escAttr(body) + '</textarea>' +
          '</div>' +
          '<div id="email-oic-missing-warn" class="email-oic-missing-warn" style="display:none"></div>' +
          '<div class="email-oic-actions">' +
            '<button type="button" id="email-oic-open-app" class="btn btn-primary">Open in Outlook Web</button>' +
            '<button type="button" id="email-oic-copy"      class="btn btn-secondary">Copy Email</button>' +
            '<button type="button" id="email-oic-save-tpl"  class="btn btn-secondary">Save as Template</button>' +
            '<button type="button" id="email-oic-mark-sent" class="btn btn-secondary">Mark Sent</button>' +
            '<button type="button" id="email-oic-clear"     class="btn btn-tertiary" title="Reset subject and message to the template defaults">Clear</button>' +
            '<button type="button" id="email-oic-cancel"    class="btn btn-secondary">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
    _bindEvents();
  }

  /* ── Events ──────────────────────────────────────────── */

  function _bindEvents() {
    var modal = document.getElementById('email-oic-modal');
    if (!modal) return;

    modal.getPlaceholderMap = _getOfficerPlaceholderMap;

    modal.querySelector('.email-oic-close').addEventListener('click', closeEmailModal);
    document.getElementById('email-oic-cancel').addEventListener('click', closeEmailModal);
    modal.addEventListener('click', function(e) { if (e.target === modal) closeEmailModal(); });

    function _onKeyDown(e) {
      if (e.key === 'Escape') closeEmailModal();
    }
    document.addEventListener('keydown', _onKeyDown);
    modal._escHandler = _onKeyDown;

    /* Template tabs */
    modal.querySelectorAll('.email-oic-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        currentTpl = btn.getAttribute('data-tpl');
        currentCustomTpl = '';
        modal.querySelectorAll('.email-oic-tab').forEach(function(b) {
          b.classList.toggle('active', b.getAttribute('data-tpl') === currentTpl);
        });
        var customSelect = document.getElementById('email-oic-custom-template');
        if (customSelect) customSelect.value = '';
        var tplContent = _currentTemplateContent();
        document.getElementById('email-oic-subject').value = tplContent.subject;
        document.getElementById('email-oic-body').value    = tplContent.body;
        _updateMissingWarn();
      });
    });

    document.getElementById('email-oic-custom-template')?.addEventListener('change', function(e) {
      currentCustomTpl = e.target.value || '';
      modal.querySelectorAll('.email-oic-tab').forEach(function(b) {
        b.classList.toggle('active', !currentCustomTpl && b.getAttribute('data-tpl') === currentTpl);
      });
      var tplContent = _currentTemplateContent();
      document.getElementById('email-oic-subject').value = tplContent.subject;
      document.getElementById('email-oic-body').value    = tplContent.body;
      _updateMissingWarn();
    });

    document.getElementById('email-oic-open-app').addEventListener('click', function() {
      var to      = document.getElementById('email-oic-to').value.trim();
      var subject = document.getElementById('email-oic-subject').value.trim();
      var body    = document.getElementById('email-oic-body').value;
      if (!to) {
        showToast('Please enter an officer email address first', 'warning');
        document.getElementById('email-oic-to').focus();
        return;
      }
      /* Persist a newly-typed email address back to the record immediately */
      if (recordId && to && to !== _oicClean(data.oicEmail) &&
          window.api && window.api.attendanceSave) {
        data.oicEmail = to;
        window.api.attendanceSave({
          id: recordId,
          data: Object.assign({}, data),
          status: recordStatus || 'draft'
        }).catch(function(err) { console.error('[email-modal] Save oicEmail failed:', err); });
      }
      _openUrl(to, subject, body)
        .then(function(result) {
          if (!recordId) return;
          if (result && (result.cancelled || result.skipped || result.ok === false || result.composeSignature === false)) return;
          return _saveOfficerEmailLog(recordId, data, recordStatus, _currentTemplateKey(), to)
            .then(function(saveResult) {
              if (saveResult && saveResult.ok && typeof refreshList === 'function') refreshList();
            })
            .catch(function(err) {
              console.error('[email-modal] Auto-save officer email log failed:', err);
              showToast('Outlook opened, but email log history could not be saved', 'warning', 5000);
            });
        })
        .catch(function() { /* error toast already shown by _invokeOutlookEmail */ });
      /* IMPORTANT: do NOT auto-wipe the typed subject/body after handing the
         message to Outlook. Outlook can reject or silently drop the deeplink
         (browser pop-up blockers, mid-flight sign-in, network glitch) and the
         user would lose everything they typed. The user can press the
         "Clear" button below when they are sure the email has been sent. */
    });

    /* Explicit Clear — user-initiated reset of subject + body to the current
       template defaults. We deliberately keep the "To" field untouched so the
       officer address is preserved for follow-up sends. */
    document.getElementById('email-oic-clear').addEventListener('click', function() {
      var subjEl = document.getElementById('email-oic-subject');
      var bodyEl = document.getElementById('email-oic-body');
      if (!subjEl || !bodyEl) return;
      var doClear = function() {
        var fresh = _currentTemplateContent();
        subjEl.value = fresh.subject || '';
        bodyEl.value = fresh.body || '';
        _updateMissingWarn();
        if (typeof showToast === 'function') showToast('Cleared back to the template defaults', 'info');
      };
      var hasContent = (subjEl.value && subjEl.value.trim()) || (bodyEl.value && bodyEl.value.trim());
      if (!hasContent) { doClear(); return; }
      if (typeof showConfirm === 'function') {
        showConfirm('Clear the subject and message? You can pick the same template again to bring back the defaults.', 'Clear email')
          .then(function(ok) { if (ok) doClear(); });
      } else if (typeof confirm === 'function' ? confirm('Clear the subject and message?') : true) {
        doClear();
      }
    });

    /* Copy */
    document.getElementById('email-oic-copy').addEventListener('click', function() {
      var body = document.getElementById('email-oic-body').value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(body).then(function() {
          showToast('Email copied to clipboard', 'success');
        }).catch(function() { _fallbackCopy(body); });
      } else {
        _fallbackCopy(body);
      }
    });

    /* Save as Template */
    document.getElementById('email-oic-save-tpl')?.addEventListener('click', function() {
      _saveAsTemplate('email-oic-modal');
    });

    /* Mark Sent */
    document.getElementById('email-oic-mark-sent').addEventListener('click', function() {
      var recipient = document.getElementById('email-oic-to').value.trim();
      _markEmailSent(recordId, data, recordStatus, _currentTemplateKey(), recipient);
    });

    /* To-field changes refresh the missing warning */
    var _toFieldEl = document.getElementById('email-oic-to');
    if (_toFieldEl) _toFieldEl.addEventListener('input', _updateMissingWarn);

    /* Initial check */
    _updateMissingWarn();
  }

  /* ── Clipboard fallback ──────────────────────────────── */

  function _fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Email copied to clipboard', 'success');
    } catch (_) {
      showToast('Copy failed — please select the text manually', 'error');
    }
  }

  _renderModal();
}

/* ── Close ───────────────────────────────────────────────── */

function closeEmailModal() {
  var modal = document.getElementById('email-oic-modal');
  if (!modal) return;
  if (modal._escHandler) document.removeEventListener('keydown', modal._escHandler);
  modal.remove();
}

/* ── Mark Sent ───────────────────────────────────────────── */

function _saveOfficerEmailLog(recordId, existingData, recordStatus, templateId, recipientEmail) {
  if (!recordId || !window.api || typeof window.api.attendanceSave !== 'function') {
    return Promise.resolve({ skipped: true });
  }
  var updated = Object.assign({}, existingData, {
    officerEmailStatus:           'sent',
    lastOfficerEmailSentDate:     new Date().toISOString(),
    lastOfficerEmailTemplateUsed: templateId || 'first_attendance',
    lastOfficerEmailRecipient:    recipientEmail || '',
    oicEmail:                     recipientEmail || existingData.oicEmail || ''
  });

  var status = recordStatus || 'draft';

  return window.api.attendanceSave({ id: recordId, data: updated, status: status })
    .then(function(result) {
      if (result && result.error) {
        throw new Error(result.message || 'Unknown error');
      }
      return { ok: true, updated: updated };
    });
}

function _markEmailSent(recordId, existingData, recordStatus, templateId, recipientEmail) {
  _saveOfficerEmailLog(recordId, existingData, recordStatus, templateId, recipientEmail)
    .then(function(result) {
      if (result && result.skipped) {
        showToast('Could not save sent status for this view', 'warning');
        return;
      }
      showToast('Marked as sent', 'success');
      closeEmailModal();
      if (typeof refreshList === 'function') refreshList();
    })
    .catch(function(err) {
      console.error('[EmailModal] markEmailSent failed:', err);
      showToast('Failed to save sent status — please try again', 'error');
    });
}

/* ═══════════════════════════════════════════════════════
   SAVE AS TEMPLATE — inline from any email compose modal
   Replaces known field values with {{placeholders}} so templates are reusable.
   ═══════════════════════════════════════════════════════ */

function _escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _valuesToPlaceholders(text, map) {
  if (!text || !map) return text;
  var entries = [];
  for (var key in map) {
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      var val = map[key];
      if (val != null && String(val).trim().length >= 2) entries.push({ key: key, value: String(val).trim() });
    }
  }
  entries.sort(function(a, b) { return b.value.length - a.value.length; });
  var out = text;
  for (var i = 0; i < entries.length; i++) {
    var escaped = _escapeRegex(entries[i].value);
    var re = new RegExp(escaped, 'gi');
    out = out.replace(re, '{{' + entries[i].key + '}}');
  }
  return out;
}

function _saveAsTemplate(modalId) {
  var modal = document.getElementById(modalId);
  if (!modal) return;
  var existing = modal.querySelector('.save-tpl-inline');
  if (existing) { existing.style.display = existing.style.display === 'none' ? '' : 'none'; return; }

  var subjectEl = modal.querySelector('#email-oic-subject, #quick-email-subject');
  var bodyEl    = modal.querySelector('#email-oic-body, #quick-email-body');
  if (!subjectEl || !bodyEl) return;

  var wrap = document.createElement('div');
  wrap.className = 'save-tpl-inline';
  wrap.style.cssText = 'margin:0.6rem 0 0.3rem;padding:0.6rem 0.8rem;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;display:flex;align-items:center;gap:0.5rem;';
  wrap.innerHTML =
    '<input type="text" id="save-tpl-name" placeholder="Template name e.g. Disclosure request" ' +
      'style="flex:1;padding:0.35rem 0.5rem;border:1px solid #cbd5e1;border-radius:6px;font-size:0.85rem;">' +
    '<button type="button" id="save-tpl-confirm" class="btn btn-primary" style="white-space:nowrap;">Save</button>' +
    '<button type="button" id="save-tpl-cancel" class="btn btn-secondary" style="white-space:nowrap;">Cancel</button>';

  var actionsBar = modal.querySelector('.email-oic-actions, .quick-email-actions');
  if (actionsBar) actionsBar.parentNode.insertBefore(wrap, actionsBar);
  else modal.querySelector('.email-oic-box, .quick-email-box').appendChild(wrap);

  wrap.querySelector('#save-tpl-cancel').addEventListener('click', function() { wrap.style.display = 'none'; });
  wrap.querySelector('#save-tpl-confirm').addEventListener('click', function() {
    var name = wrap.querySelector('#save-tpl-name').value.trim();
    if (!name) { showToast('Please enter a template name', 'error'); return; }
    var getMap = modal.getPlaceholderMap;
    var map = typeof getMap === 'function' ? getMap() : {};
    var subjectRaw = subjectEl.value || '';
    var bodyRaw = bodyEl.value || '';
    var subjectTpl = _valuesToPlaceholders(subjectRaw, map);
    var bodyTpl = _valuesToPlaceholders(bodyRaw, map);
    var tpls = typeof window._getCustomEmailTemplates === 'function'
      ? (window._getCustomEmailTemplates() || []).slice()
      : [];
    var nowIso = new Date().toISOString();
    var reqFields = typeof window.extractQuickEmailPlaceholderKeys === 'function'
      ? window.extractQuickEmailPlaceholderKeys(subjectTpl, bodyTpl)
      : [];
    var newId = (function() {
      try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'cn-etpl-' + crypto.randomUUID();
      } catch (_) {}
      return 'cn-etpl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
    })();
    tpls.push({
      id: newId,
      name: name,
      subject: subjectTpl,
      body: bodyTpl,
      scope: 'officer',
      requiredFields: reqFields,
      category: '',
      createdAt: nowIso,
      updatedAt: nowIso
    });
    if (typeof window._saveCustomEmailTemplates === 'function') {
      window._saveCustomEmailTemplates(tpls);
    }
    showToast('Template saved — available in all officer email modals', 'success');
    wrap.style.display = 'none';

    var customSelect = modal.querySelector('#email-oic-custom-template, #quick-email-custom-template');
    if (customSelect) {
      var newIdx = tpls.length - 1;
      var opt = document.createElement('option');
      opt.value = 'custom:' + newIdx;
      opt.textContent = name;
      customSelect.appendChild(opt);
    }
  });
  wrap.querySelector('#save-tpl-name').focus();
}

/* ═══════════════════════════════════════════════════════
   QUICK EMAIL MODAL — Template-first single-screen UX
   The user picks the email they want to send; the form below
   adapts to show ONLY the fields that template needs.
   ═══════════════════════════════════════════════════════ */

/* Field definitions: label + input type + placeholder.
   Single source of truth for both common and optional fields. */
var QUICK_EMAIL_FIELD_DEFS = {
  officerEmail:       { label: 'Officer email',      type: 'email',    placeholder: 'officer@police.uk' },
  oicName:            { label: 'Officer name',       type: 'text',     placeholder: 'e.g. Smith (no rank needed)' },
  clientName:         { label: 'Client name',        type: 'text',     placeholder: 'e.g. John Doe' },
  station:            { label: 'Police station',     type: 'text',     placeholder: 'e.g. Holborn' },
  offenceType:        { label: 'Offence',            type: 'text',     placeholder: 'e.g. ABH' },
  attendanceType:     { label: 'Type of attendance', type: 'select',   options: [
                          { value: '',          label: '—' },
                          { value: 'custody',   label: 'Custody' },
                          { value: 'voluntary', label: 'Voluntary' },
                          { value: 'telephone', label: 'Telephone advice' }
                        ] },
  date:               { label: 'Date',               type: 'date' },
  time:               { label: 'Time',               type: 'time' },
  bailDate:           { label: 'Bail return date',   type: 'date' },
  bailTime:           { label: 'Bail return time',   type: 'time' },
  bailConditions:     { label: 'Bail conditions',    type: 'textarea', placeholder: 'e.g. No contact with complainant' },
  ourFileNumber:      { label: 'File number',        type: 'text',     placeholder: 'Internal file ref' },
  ufn:                { label: 'UFN',                type: 'text',     placeholder: 'Unique file number' }
};

var QUICK_EMAIL_CATEGORIES = ['Bail', 'Representation', 'Disclosure', 'Follow-up', 'Voluntary attendance', 'Other'];

function openQuickEmailModal() {
  var stale = document.getElementById('quick-email-modal');
  if (stale) stale.remove();

  var settings = window._appSettingsCache || {};
  var feeEarnerName = _oicClean(settings.feeEarnerNameDefault) || '';
  var firmName      = _oicClean(settings.firmName) || '';
  var feeEarnerEmail = _oicClean(settings.feeEarnerEmail || settings.solicitorEmail) || '';
  var feeEarnerPhone = _oicClean(settings.feeEarnerPhone || settings.solicitorPhone) || '';

  var COMMON_FIELDS  = (typeof window.QUICK_EMAIL_COMMON_FIELDS  === 'object' && window.QUICK_EMAIL_COMMON_FIELDS)  ? window.QUICK_EMAIL_COMMON_FIELDS.slice()  : ['officerEmail','oicName','clientName','station','offenceType','attendanceType','date','time'];
  var OPTIONAL_FIELDS = (typeof window.QUICK_EMAIL_OPTIONAL_FIELDS === 'object' && window.QUICK_EMAIL_OPTIONAL_FIELDS) ? window.QUICK_EMAIL_OPTIONAL_FIELDS.slice() : ['bailDate','bailTime','bailConditions','ourFileNumber','ufn'];

  /* ── State ──────────────────────────────────────────── */
  var _catalog        = (typeof window.getQuickEmailCatalog === 'function') ? window.getQuickEmailCatalog() : { system: [], user: [], all: [] };
  var _selectedId     = '';
  var _activeTemplate = null;
  var _fields         = {};      /* canonical key → string value */
  var _manualSubject  = null;    /* string when user has hand-edited; null otherwise */
  var _manualBody     = null;
  var _draftSaveTimer = null;
  /* ── Helpers ──────────────────────────────────────── */

  function _escAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _todayIsoDate() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function _isoToUk(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || '');
  }

  function _hhmmTo12h(hhmm) {
    var raw = String(hhmm || '').trim();
    if (!raw) return '';
    var m = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return raw;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(mi)) return raw;
    h = ((h % 24) + 24) % 24;
    var isAM = h < 12;
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    var minPart = mi === 0 ? '' : ':' + (mi < 10 ? '0' : '') + mi;
    return h12 + minPart + ' ' + (isAM ? 'a.m.' : 'p.m.');
  }

  /* Rendering map: combines current form values + user profile + today's date.
     Keys here match those used in the template files. */
  function _buildRenderMap() {
    var attendanceRaw = _fields.attendanceType || '';
    var attendanceLabel = (function(v) {
      if (v === 'telephone') return 'telephone advice';
      if (v === 'voluntary') return 'voluntary attendee';
      if (v === 'custody')   return 'custody attendee';
      return '';
    })(attendanceRaw);
    return {
      officerEmail:      _fields.officerEmail || '',
      oicName:           _fields.oicName || '',
      clientName:        _fields.clientName || '',
      station:           _fields.station || '',
      offenceType:       _fields.offenceType || '',
      attendanceType:    attendanceLabel,
      date:              _isoToUk(_fields.date || ''),
      time:              _hhmmTo12h(_fields.time || ''),
      time24:            (_fields.time || '').slice(0, 5),
      bailDate:          _isoToUk(_fields.bailDate || ''),
      bailTime:          _hhmmTo12h(_fields.bailTime || ''),
      bailConditions:    _fields.bailConditions || '',
      ourFileNumber:     _fields.ourFileNumber || '',
      ufn:               _fields.ufn || '',
      feeEarnerName:     feeEarnerName,
      firmName:          firmName,
      feeEarnerEmail:    feeEarnerEmail,
      feeEarnerPhone:    feeEarnerPhone,
      todayDate:         _isoToUk(_todayIsoDate())
    };
  }

  /* ── Field visibility ────────────────────────────── */

  function _fieldsToShow() {
    /* Common 7 always shown. Optional fields appear only when the
       chosen template references them. */
    var shown = COMMON_FIELDS.slice();
    if (_activeTemplate && typeof window.getFieldsUsedByTemplate === 'function') {
      var used = window.getFieldsUsedByTemplate(_activeTemplate);
      used.forEach(function(k) {
        if (OPTIONAL_FIELDS.indexOf(k) !== -1 && shown.indexOf(k) === -1) {
          shown.push(k);
        }
      });
    }
    return shown;
  }

  function _requiredFields() {
    if (!_activeTemplate || typeof window.getRequiredFieldsForTemplate !== 'function') return [];
    return window.getRequiredFieldsForTemplate(_activeTemplate)
      .filter(function(k) { return COMMON_FIELDS.indexOf(k) !== -1 || OPTIONAL_FIELDS.indexOf(k) !== -1; });
  }

  /* ── Persistence ─────────────────────────────────── */

  function _persistDraft() {
    if (_draftSaveTimer) clearTimeout(_draftSaveTimer);
    _draftSaveTimer = setTimeout(function() {
      if (!window.api || !window.api.setSettings) return;
      var payload = JSON.stringify({
        templateId: _selectedId,
        fields:     _fields,
        savedAt:    new Date().toISOString()
      });
      window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, { lastQuickEmailDraftJson: payload });
      window.api.setSettings({ lastQuickEmailDraftJson: payload }).catch(function(e) {
        console.warn('[quick-email] draft save failed', e);
      });
    }, 600);
  }

  function _hydrateDraft() {
    var raw = (window._appSettingsCache || {}).lastQuickEmailDraftJson;
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.fields && typeof parsed.fields === 'object') _fields = parsed.fields;
        if (parsed.templateId) _selectedId = parsed.templateId;
      }
    } catch (_) {}
  }

  /* ── Rendering preview ───────────────────────────── */

  function _renderPreview() {
    var subjEl = document.getElementById('quick-email-subject');
    var bodyEl = document.getElementById('quick-email-body');
    if (!subjEl || !bodyEl) return;

    if (_manualSubject !== null) subjEl.value = _manualSubject;
    if (_manualBody    !== null) bodyEl.value = _manualBody;

    if (_manualSubject === null && _manualBody === null && _activeTemplate &&
        typeof window.renderQuickEmailFromTemplates === 'function') {
      var rendered = window.renderQuickEmailFromTemplates(
        _activeTemplate.subjectTemplate || '',
        _activeTemplate.bodyTemplate    || '',
        _buildRenderMap()
      );
      subjEl.value = rendered.subject;
      bodyEl.value = rendered.body;
    } else if (_manualSubject === null && _manualBody === null && !_activeTemplate) {
      subjEl.value = '';
      bodyEl.value = '';
    } else if (_activeTemplate && typeof window.renderQuickEmailFromTemplates === 'function') {
      // Manual-edit mode: re-render only the side the user has NOT touched.
      var r = window.renderQuickEmailFromTemplates(
        _activeTemplate.subjectTemplate || '',
        _activeTemplate.bodyTemplate    || '',
        _buildRenderMap()
      );
      if (_manualSubject === null) subjEl.value = r.subject;
      if (_manualBody    === null) bodyEl.value = r.body;
    }

    _renderMissingStrip();
  }

  function _renderMissingStrip() {
    var stripEl = document.getElementById('quick-email-missing-strip');
    if (!stripEl) return;
    var req = _requiredFields();
    var missing = req.filter(function(k) {
      var v = _fields[k];
      return v == null || String(v).trim() === '';
    });
    if (!missing.length) {
      stripEl.style.display = 'none';
      stripEl.textContent = '';
      return;
    }
    var labels = missing.map(function(k) {
      var def = QUICK_EMAIL_FIELD_DEFS[k];
      return def ? def.label.toLowerCase() : k;
    });
    var msg;
    if (labels.length === 1) msg = 'Add the ' + labels[0] + ' to finish this email.';
    else if (labels.length === 2) msg = 'Add the ' + labels[0] + ' and ' + labels[1] + ' to finish this email.';
    else msg = 'Still need: ' + labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1] + '.';
    stripEl.textContent = msg;
    stripEl.style.display = '';
  }

  /* ── Form HTML ───────────────────────────────────── */

  function _fieldHtml(key) {
    var def = QUICK_EMAIL_FIELD_DEFS[key];
    if (!def) return '';
    var req  = _requiredFields().indexOf(key) !== -1;
    var val  = _fields[key] || '';
    var star = req ? ' <span class="qe-req" aria-hidden="true">*</span>' : '';
    var ph   = def.placeholder ? ' placeholder="' + _escAttr(def.placeholder) + '"' : '';
    var inputId = 'qe-field-' + key;
    var inputHtml = '';
    if (def.type === 'select') {
      inputHtml = '<select id="' + inputId + '" data-qe-field="' + key + '" class="qe-input">' +
        def.options.map(function(o) {
          var sel = String(val) === String(o.value) ? ' selected' : '';
          return '<option value="' + _escAttr(o.value) + '"' + sel + '>' + _escAttr(o.label) + '</option>';
        }).join('') +
        '</select>';
    } else if (def.type === 'textarea') {
      inputHtml = '<textarea id="' + inputId + '" data-qe-field="' + key + '" class="qe-input qe-textarea" rows="2"' + ph + '>' + _escAttr(val) + '</textarea>';
    } else {
      var wpDisable = (def.type === 'date' || def.type === 'time' || def.type === 'datetime-local') ? ' data-wp-disable="1"' : '';
      inputHtml = '<input type="' + def.type + '" id="' + inputId + '" data-qe-field="' + key + '"' + wpDisable + ' class="qe-input" value="' + _escAttr(val) + '"' + ph + '>';
    }
    return '<div class="qe-field qe-field-' + key + (req ? ' qe-field-required' : '') + '">' +
             '<label class="qe-label" for="' + inputId + '">' + _escAttr(def.label) + star + '</label>' +
             inputHtml +
           '</div>';
  }

  function _renderForm() {
    var formEl = document.getElementById('quick-email-form');
    if (!formEl) return;
    var keys = _fieldsToShow();
    formEl.innerHTML = keys.map(_fieldHtml).join('');
    /* Bind change/input on the freshly-rendered inputs */
    formEl.querySelectorAll('[data-qe-field]').forEach(function(el) {
      var key = el.getAttribute('data-qe-field');
      var ev  = (el.tagName === 'SELECT') ? 'change' : 'input';
      el.addEventListener(ev, function() {
        _fields[key] = el.value;
        if (key === 'oicName' || key === 'clientName' || key === 'station' ||
            key === 'date'    || key === 'time'       || key === 'attendanceType') {
          // Reset manual-mode when context changes — user expects refreshed preview.
          // (For other free-text optional fields we DO respect manual edits.)
        }
        _renderPreview();
        _persistDraft();
        /* Clear the inline error strip the moment the user starts fixing
           the problem so we don't keep nagging them. */
        var stripEl = document.getElementById('quick-email-error-strip');
        if (stripEl && stripEl.style.display !== 'none') {
          stripEl.style.display = 'none';
          stripEl.innerHTML = '';
        }
      });
    });
  }

  /* ── Picker / description ────────────────────────── */

  function _renderPicker() {
    var pickerEl = document.getElementById('quick-email-picker');
    var descEl   = document.getElementById('quick-email-description');
    var editLink = document.getElementById('quick-email-edit-link');
    var deleteBtn = document.getElementById('quick-email-delete-btn');
    if (!pickerEl) return;

    var groups = {};
    _catalog.system.forEach(function(t) {
      var c = t.category || 'Other';
      (groups[c] = groups[c] || []).push(t);
    });

    var systemHtml = Object.keys(groups).map(function(cat) {
      return '<optgroup label="' + _escAttr(cat) + '">' +
        groups[cat].map(function(t) {
          var sel = (_selectedId === t.id) ? ' selected' : '';
          return '<option value="' + _escAttr(t.id) + '"' + sel + '>' + _escAttr(t.name) + '</option>';
        }).join('') +
      '</optgroup>';
    }).join('');

    var userHtml = _catalog.user.length
      ? '<optgroup label="Your saved templates">' +
          _catalog.user.map(function(t) {
            var sel = (_selectedId === t.id) ? ' selected' : '';
            return '<option value="' + _escAttr(t.id) + '"' + sel + '>' + _escAttr(t.name) + '</option>';
          }).join('') +
        '</optgroup>'
      : '';

    pickerEl.innerHTML = '<option value="">— Pick a template —</option>' + systemHtml + userHtml;

    if (descEl) {
      descEl.textContent = _activeTemplate ? (_activeTemplate.description || '') : 'Pick the email you want to send. The form below adapts to what\'s needed.';
    }
    /* Edit and Delete are now allowed on every template (built-in or
       user-saved). Built-in changes are stored as overrides so the
       user can always restore the defaults. */
    if (editLink) {
      editLink.style.display = _activeTemplate ? '' : 'none';
    }
    if (deleteBtn) {
      deleteBtn.style.display = _activeTemplate ? '' : 'none';
      deleteBtn.textContent = (_activeTemplate && _activeTemplate.isSystemTemplate)
        ? 'Hide template'
        : 'Delete template';
      deleteBtn.title = (_activeTemplate && _activeTemplate.isSystemTemplate)
        ? 'Hide this built-in template (you can restore defaults at any time)'
        : 'Remove this saved template';
    }
    var restoreLink = document.getElementById('quick-email-restore-defaults');
    if (restoreLink) {
      var hasCustomizations = (typeof window.hasSystemEmailCustomizations === 'function')
        ? window.hasSystemEmailCustomizations()
        : false;
      restoreLink.style.display = hasCustomizations ? '' : 'none';
    }
  }

  /* ── Template selection ──────────────────────────── */

  function _selectTemplate(id) {
    _selectedId = id || '';
    _activeTemplate = _selectedId
      ? (typeof window.getQuickEmailTemplateById === 'function' ? window.getQuickEmailTemplateById(_selectedId) : null)
      : null;
    /* New template = fresh preview, drop manual edits. */
    _manualSubject = null;
    _manualBody    = null;
    _renderPicker();
    _renderForm();
    _renderPreview();
    _persistDraft();
  }

  /* ── Save as new template (one-input) ────────────── */

  function _openSavePanel() {
    var existing = document.getElementById('qe-save-panel');
    if (existing) { existing.remove(); return; }

    var actionsBar = document.querySelector('#quick-email-modal .qe-actions');
    if (!actionsBar) return;

    var subj = (document.getElementById('quick-email-subject') || {}).value || '';
    var body = (document.getElementById('quick-email-body') || {}).value    || '';
    if (!subj.trim() && !body.trim()) {
      showToast('Type a message first, then save it as a template', 'warning');
      return;
    }

    var panel = document.createElement('div');
    panel.id = 'qe-save-panel';
    panel.className = 'qe-save-panel';
    panel.innerHTML =
      '<div class="qe-save-row">' +
        '<label class="qe-label" for="qe-save-name">Name this template</label>' +
        '<input type="text" id="qe-save-name" class="qe-input" placeholder="e.g. Disclosure request" autocomplete="off">' +
      '</div>' +
      '<div class="qe-save-row">' +
        '<label class="qe-label" for="qe-save-cat">Category</label>' +
        '<select id="qe-save-cat" class="qe-input">' +
          QUICK_EMAIL_CATEGORIES.map(function(c) {
            return '<option value="' + _escAttr(c) + '">' + _escAttr(c) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div class="qe-save-actions">' +
        '<button type="button" class="btn btn-primary" id="qe-save-confirm">Save template</button>' +
        '<button type="button" class="btn btn-secondary" id="qe-save-cancel">Cancel</button>' +
      '</div>';
    actionsBar.parentNode.insertBefore(panel, actionsBar);
    var nameEl = document.getElementById('qe-save-name');
    if (nameEl) nameEl.focus();

    document.getElementById('qe-save-cancel').addEventListener('click', function() { panel.remove(); });
    document.getElementById('qe-save-confirm').addEventListener('click', function() {
      var name = (document.getElementById('qe-save-name').value || '').trim();
      if (!name) { showToast('Please give the template a name', 'error'); return; }
      var category = document.getElementById('qe-save-cat').value || 'Other';

      // Convert literal values back into placeholders so the template is reusable.
      var map = _buildRenderMap();
      var subjTpl = (typeof _valuesToPlaceholders === 'function') ? _valuesToPlaceholders(subj, map) : subj;
      var bodyTpl = (typeof _valuesToPlaceholders === 'function') ? _valuesToPlaceholders(body, map) : body;

      var existingTpls = (typeof window._getCustomEmailTemplates === 'function')
        ? (window._getCustomEmailTemplates() || []).slice()
        : [];
      var nowIso = new Date().toISOString();
      var newId = (function() {
        try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'cn-etpl-' + crypto.randomUUID(); } catch (_) {}
        return 'cn-etpl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
      })();
      var reqFields = (typeof window.extractQuickEmailPlaceholderKeys === 'function')
        ? window.extractQuickEmailPlaceholderKeys(subjTpl, bodyTpl)
        : [];
      existingTpls.push({
        id:             newId,
        name:           name,
        category:       category,
        description:    '',
        subject:        subjTpl,
        body:           bodyTpl,
        scope:          'officer',
        requiredFields: reqFields,
        createdAt:      nowIso,
        updatedAt:      nowIso
      });
      if (typeof window._saveCustomEmailTemplates === 'function') {
        window._saveCustomEmailTemplates(existingTpls);
      }
      showToast('Template saved', 'success');
      panel.remove();

      // Refresh catalog + picker, then select the new template.
      if (typeof window.getQuickEmailCatalog === 'function') {
        _catalog = window.getQuickEmailCatalog();
      }
      _selectTemplate(newId);
    });
  }

  /* ── Edit user template ──────────────────────────── */

  function _openEditPanel() {
    if (!_activeTemplate) return;
    var existing = document.getElementById('qe-edit-panel');
    if (existing) { existing.remove(); return; }

    var actionsBar = document.querySelector('#quick-email-modal .qe-actions');
    if (!actionsBar) return;

    var friendlySubject = (typeof window.tokensToFriendlyLabels === 'function')
      ? window.tokensToFriendlyLabels(_activeTemplate.subjectTemplate || '')
      : (_activeTemplate.subjectTemplate || '');
    var friendlyBody = (typeof window.tokensToFriendlyLabels === 'function')
      ? window.tokensToFriendlyLabels(_activeTemplate.bodyTemplate || '')
      : (_activeTemplate.bodyTemplate || '');

    var isSystem = !!_activeTemplate.isSystemTemplate;
    var isCustomizedSystem = isSystem && !!_activeTemplate.isCustomized;
    var deleteLabel = isSystem ? 'Hide template' : 'Delete template';
    var titleText = isSystem
      ? (isCustomizedSystem ? 'Edit built-in template (customized)' : 'Edit built-in template')
      : 'Edit template';
    var helpText = isSystem
      ? 'This is a built-in template. Your changes are saved as overrides and can be reverted with "Restore default" at any time.'
      : 'Words in <code>[BRACKETS]</code> get replaced with the matter details when you use the template.';

    var panel = document.createElement('div');
    panel.id = 'qe-edit-panel';
    panel.className = 'qe-save-panel qe-edit-panel';
    panel.innerHTML =
      '<h4 class="qe-section-title">' + _escAttr(titleText) + '</h4>' +
      '<p class="qe-help">' + helpText + '</p>' +
      '<div class="qe-save-row"><label class="qe-label" for="qe-edit-name">Name</label>' +
        '<input type="text" id="qe-edit-name" class="qe-input" value="' + _escAttr(_activeTemplate.name || '') + '"></div>' +
      '<div class="qe-save-row"><label class="qe-label" for="qe-edit-cat">Category</label>' +
        '<select id="qe-edit-cat" class="qe-input">' +
          QUICK_EMAIL_CATEGORIES.map(function(c) {
            var sel = (_activeTemplate.category === c) ? ' selected' : '';
            return '<option value="' + _escAttr(c) + '"' + sel + '>' + _escAttr(c) + '</option>';
          }).join('') +
        '</select></div>' +
      '<div class="qe-save-row"><label class="qe-label" for="qe-edit-subject">Subject</label>' +
        '<input type="text" id="qe-edit-subject" class="qe-input" value="' + _escAttr(friendlySubject) + '"></div>' +
      '<div class="qe-save-row"><label class="qe-label" for="qe-edit-body">Message</label>' +
        '<textarea id="qe-edit-body" class="qe-input qe-textarea" rows="10">' + _escAttr(friendlyBody) + '</textarea></div>' +
      '<div class="qe-save-actions">' +
        '<button type="button" class="btn btn-primary" id="qe-edit-save">Save changes</button>' +
        (isCustomizedSystem ? '<button type="button" class="btn btn-secondary" id="qe-edit-restore">Restore default</button>' : '') +
        '<button type="button" class="btn btn-danger qe-edit-delete" id="qe-edit-delete">' + _escAttr(deleteLabel) + '</button>' +
        '<button type="button" class="btn btn-secondary" id="qe-edit-cancel">Cancel</button>' +
      '</div>';
    actionsBar.parentNode.insertBefore(panel, actionsBar);

    document.getElementById('qe-edit-cancel').addEventListener('click', function() { panel.remove(); });

    document.getElementById('qe-edit-save').addEventListener('click', function() {
      var name = (document.getElementById('qe-edit-name').value || '').trim();
      if (!name) { showToast('Template needs a name', 'error'); return; }
      var category = document.getElementById('qe-edit-cat').value || 'Other';
      var rawSubj  = document.getElementById('qe-edit-subject').value || '';
      var rawBody  = document.getElementById('qe-edit-body').value    || '';
      var subjTpl  = (typeof window.friendlyLabelsToTokens === 'function') ? window.friendlyLabelsToTokens(rawSubj) : rawSubj;
      var bodyTpl  = (typeof window.friendlyLabelsToTokens === 'function') ? window.friendlyLabelsToTokens(rawBody) : rawBody;
      var reqFields = (typeof window.extractQuickEmailPlaceholderKeys === 'function')
        ? window.extractQuickEmailPlaceholderKeys(subjTpl, bodyTpl)
        : [];

      if (isSystem) {
        var overrides = (typeof window._getSystemEmailOverrides === 'function')
          ? Object.assign({}, window._getSystemEmailOverrides() || {})
          : {};
        overrides[_activeTemplate.id] = {
          name:            name,
          category:        category,
          description:     _activeTemplate.description || '',
          subjectTemplate: subjTpl,
          bodyTemplate:    bodyTpl,
          requiredFields:  reqFields,
          updatedAt:       new Date().toISOString()
        };
        if (typeof window._saveSystemEmailOverrides === 'function') {
          window._saveSystemEmailOverrides(overrides);
        }
      } else {
        var allTpls = (typeof window._getCustomEmailTemplates === 'function')
          ? (window._getCustomEmailTemplates() || []).slice()
          : [];
        var idx = -1;
        for (var i = 0; i < allTpls.length; i++) {
          if (allTpls[i].id === _activeTemplate.id) { idx = i; break; }
        }
        if (idx === -1) { showToast('Template not found', 'error'); return; }
        allTpls[idx] = Object.assign({}, allTpls[idx], {
          name:           name,
          category:       category,
          subject:        subjTpl,
          body:           bodyTpl,
          requiredFields: reqFields,
          updatedAt:      new Date().toISOString()
        });
        if (typeof window._saveCustomEmailTemplates === 'function') {
          window._saveCustomEmailTemplates(allTpls);
        }
      }
      showToast('Template updated', 'success');
      panel.remove();

      if (typeof window.getQuickEmailCatalog === 'function') _catalog = window.getQuickEmailCatalog();
      _selectTemplate(_activeTemplate.id);
    });

    document.getElementById('qe-edit-delete').addEventListener('click', function() {
      _confirmDeleteTemplate(function() { _deleteActiveTemplate(panel); });
    });

    var restoreBtn = document.getElementById('qe-edit-restore');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', function() {
        if (typeof window._getSystemEmailOverrides !== 'function') return;
        var overrides = Object.assign({}, window._getSystemEmailOverrides() || {});
        if (overrides[_activeTemplate.id]) {
          delete overrides[_activeTemplate.id];
          if (typeof window._saveSystemEmailOverrides === 'function') {
            window._saveSystemEmailOverrides(overrides);
          }
        }
        showToast('Default restored', 'success');
        panel.remove();
        if (typeof window.getQuickEmailCatalog === 'function') _catalog = window.getQuickEmailCatalog();
        _selectTemplate(_activeTemplate.id);
      });
    }
  }

  function _confirmDeleteTemplate(onConfirm) {
    if (!_activeTemplate) return;
    var label = _activeTemplate.name || 'this template';
    var isSystem = !!_activeTemplate.isSystemTemplate;
    var msg = isSystem
      ? 'Hide the built-in template "' + label + '"? You can restore it later via "Restore defaults".'
      : 'Delete the template "' + label + '"? This cannot be undone.';
    var title = isSystem ? 'Hide template' : 'Delete template';
    if (typeof showConfirm === 'function') {
      showConfirm(msg, title).then(function(ok) {
        if (ok) onConfirm();
      });
    } else if (confirm(msg)) {
      onConfirm();
    }
  }

  function _deleteActiveTemplate(panel) {
    var isSystem = !!_activeTemplate.isSystemTemplate;
    if (isSystem) {
      var deletedIds = (typeof window._getDeletedSystemEmailIds === 'function')
        ? (window._getDeletedSystemEmailIds() || []).slice()
        : [];
      if (deletedIds.indexOf(_activeTemplate.id) === -1) deletedIds.push(_activeTemplate.id);
      if (typeof window._saveDeletedSystemEmailIds === 'function') {
        window._saveDeletedSystemEmailIds(deletedIds);
      }
      showToast('Built-in template hidden (use "Restore defaults" to bring it back)', 'success');
    } else {
      var allTpls = (typeof window._getCustomEmailTemplates === 'function')
        ? (window._getCustomEmailTemplates() || []).slice()
        : [];
      var filtered = allTpls.filter(function(t) { return t.id !== _activeTemplate.id; });
      if (typeof window._saveCustomEmailTemplates === 'function') {
        window._saveCustomEmailTemplates(filtered);
      }
      showToast('Template deleted', 'success');
    }
    if (panel) panel.remove();
    else {
      var ep = document.getElementById('qe-edit-panel');
      if (ep) ep.remove();
    }
    var savePanel = document.getElementById('qe-save-panel');
    if (savePanel) savePanel.remove();
    if (typeof window.getQuickEmailCatalog === 'function') _catalog = window.getQuickEmailCatalog();
    _selectTemplate('');
  }

  function _restoreAllSystemDefaults() {
    var hasCustomizations = (typeof window.hasSystemEmailCustomizations === 'function')
      ? window.hasSystemEmailCustomizations()
      : false;
    if (!hasCustomizations) {
      showToast('No customizations to restore', 'info');
      return;
    }
    var msg = 'Restore the built-in templates to their original wording, and bring back any you have hidden? Your saved (user) templates are not affected.';
    var doRestore = function() {
      if (typeof window._resetSystemEmailCustomizations === 'function') {
        window._resetSystemEmailCustomizations();
      }
      showToast('Built-in templates restored', 'success');
      if (typeof window.getQuickEmailCatalog === 'function') _catalog = window.getQuickEmailCatalog();
      var ep = document.getElementById('qe-edit-panel');
      if (ep) ep.remove();
      _selectTemplate(_activeTemplate ? _activeTemplate.id : '');
    };
    if (typeof showConfirm === 'function') {
      showConfirm(msg, 'Restore built-in templates').then(function(ok) { if (ok) doRestore(); });
    } else if (confirm(msg)) {
      doRestore();
    }
  }

  /* ── Send / Copy ─────────────────────────────────── */

  function _resetFormAfterSend() {
    _selectedId = '';
    _activeTemplate = null;
    _fields = { date: _todayIsoDate() };
    _manualSubject = null;
    _manualBody    = null;
    if (_draftSaveTimer) {
      clearTimeout(_draftSaveTimer);
      _draftSaveTimer = null;
    }
    var sp = document.getElementById('qe-save-panel');
    if (sp) sp.remove();
    var ep = document.getElementById('qe-edit-panel');
    if (ep) ep.remove();
    if (window.api && window.api.setSettings) {
      window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, { lastQuickEmailDraftJson: '' });
      window.api.setSettings({ lastQuickEmailDraftJson: '' }).catch(function(e) {
        console.warn('[quick-email] could not clear draft', e);
      });
    }
    _renderPicker();
    _renderForm();
    _renderPreview();
  }

  /* Compact inline error strip inside the modal — used for validation
     failures that should block the send (invalid officer email, missing
     core fields). Cleared on the next send attempt. */
  function _showInlineError(html) {
    var stripEl = document.getElementById('quick-email-error-strip');
    if (!stripEl) return;
    stripEl.innerHTML = html;
    stripEl.style.display = '';
  }
  function _clearInlineError() {
    var stripEl = document.getElementById('quick-email-error-strip');
    if (!stripEl) return;
    stripEl.innerHTML = '';
    stripEl.style.display = 'none';
  }

  /* Light-touch RFC-5322-ish email sanity check — same shape used by the
     rest of the app (officerEmail / firm contact email validation). */
  function _looksLikeEmail(s) {
    if (s == null) return false;
    var v = String(s).trim();
    if (!v) return false;
    return /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(v);
  }

  function _isQuickEmailDebugEnabled() {
    try {
      if (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('quickEmailOutlookDebug') === '1') return true;
    } catch (_) {}
    try {
      if (typeof process !== 'undefined' && process && process.env && process.env.NODE_ENV === 'development') return true;
    } catch (_) {}
    return false;
  }

  function _buildDebugComposeUrl(route, to, subject, body) {
    var params = new URLSearchParams();
    params.set('to', to || '');
    params.set('cc', '');
    params.set('bcc', '');
    params.set('subject', subject || '');
    params.set('body', body || '');
    var q = params.toString();
    if (route === 'personal') return 'https://outlook.live.com/mail/0/deeplink/compose?' + q;
    if (route === 'work_alt') return 'https://outlook.office.com/owa/?path=/mail/action/compose&' + q;
    return 'https://outlook.office.com/mail/deeplink/compose?' + q;
  }

  function _buildDraftFromCurrentState() {
    var toInput = document.getElementById('qe-field-officerEmail');
    var to = toInput ? String(toInput.value || '').trim() : String(_fields.officerEmail || '').trim();
    _fields.officerEmail = to;
    var subject = ((document.getElementById('quick-email-subject') || {}).value || '').trim();
    var body = ((document.getElementById('quick-email-body') || {}).value || '');

    /* Hard validation gate (B+C of the v1.6.4 spec). Outlook compose silently
       redirects to the inbox if the URL is malformed or the to-address is
       missing — better to refuse to open than to confuse the user. */
    var problems = [];
    if (!to) {
      problems.push({ field: 'officerEmail', msg: 'officer email is required' });
    } else if (!_looksLikeEmail(to)) {
      problems.push({ field: 'officerEmail', msg: 'officer email does not look like a valid address' });
    }
    var hardRequired = ['clientName', 'station', 'date', 'time'];
    hardRequired.forEach(function(k) {
      var el = document.getElementById('qe-field-' + k);
      var v = el ? el.value : _fields[k];
      _fields[k] = v;
      if (v == null || String(v).trim() === '') {
        problems.push({ field: k, msg: (QUICK_EMAIL_FIELD_DEFS[k] && QUICK_EMAIL_FIELD_DEFS[k].label || k).toLowerCase() + ' is required' });
      }
    });

    /* Spec: "If subject/body are empty at click time, generate them before
       opening Outlook." If we have an active template and either side is
       blank, render now so something useful reaches Outlook. */
    if (_activeTemplate && typeof window.renderQuickEmailFromTemplates === 'function' &&
        (!subject || !body || !body.trim())) {
      var rendered = window.renderQuickEmailFromTemplates(
        _activeTemplate.subjectTemplate || '',
        _activeTemplate.bodyTemplate    || '',
        _buildRenderMap()
      );
      if (!subject) {
        subject = (rendered.subject || '').trim();
        var subjEl = document.getElementById('quick-email-subject'); if (subjEl) subjEl.value = subject;
      }
      if (!body || !body.trim()) {
        body = rendered.body || '';
        var bodyEl = document.getElementById('quick-email-body'); if (bodyEl) bodyEl.value = body;
      }
    }
    if (!subject) subject = 'Message from CustodyNote';
    if (!body || !body.trim()) {
      body = 'Hello,\n\nPlease see the details below.\n\nKind regards,\n' +
             ((window._appSettingsCache || {}).feeEarnerNameDefault || '');
      var bodyEl2 = document.getElementById('quick-email-body'); if (bodyEl2) bodyEl2.value = body;
    }

    if (!subject) problems.push({ field: 'subject', msg: 'subject is required' });
    if (!String(body || '').trim()) problems.push({ field: 'body', msg: 'body is required' });

    return {
      to: to,
      subject: subject,
      body: body,
      problems: problems
    };
  }

  var _sendClickCount = 0;

  /* ── Preferred route persistence + UI toggles ───────── */

  function _getPreferredRoute() {
    var s = window._appSettingsCache || {};
    return String(s.lastWorkingOutlookRoute || '');
  }
  function _getPreferredAccountType() {
    var s = window._appSettingsCache || {};
    var raw = String(s.lastWorkingOutlookAccountType || '').toLowerCase();
    if (raw === 'work' || raw === 'personal' || raw === 'mailto') return raw;
    return '';
  }
  function _persistPreferredRoute(route, accountType) {
    if (!window.api || typeof window.api.setSettings !== 'function') return;
    var update = {
      lastWorkingOutlookRoute: route || '',
      lastWorkingOutlookAccountType: accountType || ''
    };
    window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, update);
    window.api.setSettings(update).then(function() {
      /* Keep the Settings pill (if mounted) in sync without reloading the page. */
      if (typeof window._refreshOutlookRouteStatus === 'function') {
        window._refreshOutlookRouteStatus(window._appSettingsCache);
      }
    }).catch(function(err) {
      console.warn('[quick-email] could not persist preferred route', err);
    });
  }
  function _showRoutesPanel(open) {
    var panel = document.getElementById('quick-email-routes-panel');
    var toggle = document.getElementById('qe-routes-toggle');
    if (!panel || !toggle) return;
    panel.style.display = open ? '' : 'none';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? 'Hide routes' : 'More routes';
  }
  function _toggleRoutesPanel() {
    var panel = document.getElementById('quick-email-routes-panel');
    if (!panel) return;
    _showRoutesPanel(panel.style.display === 'none');
  }
  function _showFollowupPrompt(routeUsed, accountTypeUsed) {
    var el = document.getElementById('quick-email-followup');
    if (!el) return;
    var routeLabel = routeUsed === 'work_alt' ? 'M365 alternate (owa/action/compose)'
      : routeUsed === 'personal' ? 'Outlook.com personal'
      : (accountTypeUsed === 'mailto' ? 'system mailto' : 'M365 work compose');
    el.innerHTML =
      '<div class="qe-followup-row">' +
        '<span class="qe-followup-text">' +
          'Outlook should now be open. <strong>Did it land on the compose window?</strong> ' +
          '<span class="qe-followup-meta">(route used: ' + routeLabel + ')</span>' +
        '</span>' +
        '<span class="qe-followup-actions">' +
          '<button type="button" class="btn btn-secondary qe-followup-yes">Yes, looks good</button>' +
          '<button type="button" class="btn btn-ghost qe-followup-no">No, try another route</button>' +
        '</span>' +
      '</div>';
    el.style.display = '';
    el.querySelector('.qe-followup-yes').addEventListener('click', function() {
      _persistPreferredRoute(routeUsed || '', accountTypeUsed || '');
      el.style.display = 'none';
      el.innerHTML = '';
      if (typeof showToast === 'function') showToast('Saved — Quick Email will use this route by default.', 'success');
    });
    el.querySelector('.qe-followup-no').addEventListener('click', function() {
      el.style.display = 'none';
      el.innerHTML = '';
      _showRoutesPanel(true);
      if (typeof showToast === 'function') showToast('Try one of the alternate routes above.', 'info', 4000);
    });
  }

  function _sendViaOutlook(ev, routeOverride, accountTypeOverride) {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    _clearInlineError();
    _sendClickCount += 1;

    var draft = _buildDraftFromCurrentState();
    var to = draft.to;
    var subject = draft.subject;
    var body = draft.body;
    var problems = draft.problems;
    if (problems.length) {
      var first = problems[0];
      var firstEl = document.getElementById('qe-field-' + first.field);
      if (firstEl) firstEl.focus();
      var lines = problems.map(function(p) { return '<li>' + p.msg.replace(/[<>&]/g, function(c){return c==='<'?'&lt;':c==='>'?'&gt;':'&amp;';}) + '</li>'; }).join('');
      _showInlineError(
        '<strong>Outlook was not opened.</strong> Please fix the following before sending:' +
        '<ul style="margin:0.4rem 0 0 1.1rem;padding:0;">' + lines + '</ul>'
      );
      _renderMissingStrip();
      if (typeof showToast === 'function') showToast('Outlook was not opened — add the missing details shown in the modal', 'warning', 5000);
      return Promise.resolve(); // do NOT open Outlook
    }

    if (_isQuickEmailDebugEnabled() && typeof console !== 'undefined' && console.groupCollapsed) {
      var debugUrl = _buildDebugComposeUrl(routeOverride || 'work_primary', to, subject, body);
      console.groupCollapsed('Quick Email Outlook Debug');
      console.log('officerEmail:', to);
      console.log('subject:', subject);
      console.log('body:', body);
      console.log('composeUrl:', debugUrl);
      console.log('urlLength:', debugUrl.length);
      console.log('hasComposePath:', debugUrl.indexOf('/deeplink/compose') !== -1 || debugUrl.indexOf('/mail/action/compose') !== -1);
      console.log('hasTo:', debugUrl.indexOf('to=') !== -1);
      console.log('hasSubject:', debugUrl.indexOf('subject=') !== -1);
      console.log('hasBody:', debugUrl.indexOf('body=') !== -1);
      console.log('sendClickCount:', _sendClickCount);
      console.log('eventDefaultPrevented:', !!(ev && ev.defaultPrevented));
      console.log('openMethod:', 'window.invokeOutlookWebCompose -> emailAPI.open');
      console.groupEnd();
    }

    return _invokeOutlookEmail({
      to:      to,
      cc:      '',
      bcc:     '',
      subject: subject,
      body:    _truncateBodyForOutlook(body),
      route: routeOverride || '',
      accountType: accountTypeOverride || undefined,
      forceAccountType: accountTypeOverride || undefined,
    }).then(function(result) {
      if (result && (result.cancelled || result.skipped || result.ok === false)) return;
      var routeUsedFinal = routeOverride || (result && result.route) || '';
      var accountTypeUsedFinal = accountTypeOverride || (result && result.accountType) || '';
      if (result && result.composeSignature === false) {
        _showInlineError(
          '<strong>Outlook opened but not in compose mode.</strong> ' +
          'Open <em>More routes</em> below and try the alternate or personal compose route.'
        );
        _showRoutesPanel(true);
        if (typeof showToast === 'function') {
          showToast('Outlook opened in home/inbox. Try alternate compose under "More routes".', 'warning', 6000);
        }
        return;
      }
      /* IMPORTANT: do NOT auto-clear the form here. Outlook can fail silently
         (pop-up blocker, the user is mid sign-in, etc.) and the user would lose
         everything they typed. The user is in charge of clearing the form via
         the explicit "Clear" button when they are happy the email was sent. */
      showToast('Opening Outlook compose window. If it does not appear, try again or use Copy.', 'success', 4000);
      _showFollowupPrompt(routeUsedFinal, accountTypeUsedFinal);
    }).catch(function() {
      /* Error toast is already shown by _invokeOutlookEmail; swallow here so
         the click handler's promise is fully handled. The form is intentionally
         NOT cleared on failure so the user does not lose their typed content. */
    });
  }

  /* User-initiated reset for the Quick Email modal. Wipes the form, the
     template choice, the preview, and the persisted draft, with confirmation
     when there is content to lose. */
  function _clearForm() {
    var hasContent =
      Object.keys(_fields || {}).some(function(k) {
        var v = _fields[k];
        return v != null && String(v).trim() !== '' && k !== 'date';
      }) ||
      ((document.getElementById('quick-email-subject') || {}).value || '').trim() ||
      ((document.getElementById('quick-email-body')    || {}).value || '').trim();
    var doClear = function() {
      _resetFormAfterSend();
      if (typeof showToast === 'function') showToast('Quick Email cleared', 'info');
    };
    if (!hasContent) { doClear(); return; }
    if (typeof showConfirm === 'function') {
      showConfirm('Clear the form, message and template choice? This cannot be undone.', 'Clear Quick Email')
        .then(function(ok) { if (ok) doClear(); });
    } else if (typeof confirm === 'function' ? confirm('Clear the form, message and template choice?') : true) {
      doClear();
    }
  }

  function _copy(ev) {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    var draft = _buildDraftFromCurrentState();
    var body = draft.body || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(body).then(function() {
        showToast('Email copied to clipboard', 'success');
      }).catch(function() { _fallbackCopyQuick(body); });
    } else {
      _fallbackCopyQuick(body);
    }
  }

  function _fallbackCopyQuick(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Email copied to clipboard', 'success');
    } catch (_) {
      showToast('Copy failed — please select the text manually', 'error');
    }
  }

  /* ── Modal HTML ──────────────────────────────────── */

  function _renderModal() {
    if (!_fields.date) _fields.date = _todayIsoDate();
    var debugTools = _isQuickEmailDebugEnabled()
      ? '<div class="qe-actions-debug">' +
          '<button type="button" id="qe-copy-debug-url" class="btn btn-ghost" title="Copy the exact Outlook compose URL for troubleshooting">Copy Outlook debug URL</button>' +
        '</div>'
      : '';
    var html =
      '<div id="quick-email-modal" class="email-oic-overlay qe-overlay" role="dialog" aria-modal="true" aria-label="Quick Email to Officer">' +
        '<div class="email-oic-box qe-box">' +
          '<div class="email-oic-header">' +
            '<h3 class="email-oic-title">Quick Email to Officer</h3>' +
            '<button type="button" class="email-oic-close qe-close" aria-label="Close">&times;</button>' +
          '</div>' +
          '<div class="qe-body">' +
            '<div class="qe-picker-row">' +
              '<label class="qe-label" for="quick-email-picker">Pick the email you want to send</label>' +
              '<select id="quick-email-picker" class="qe-input"></select>' +
              '<div class="qe-picker-actions" id="quick-email-picker-actions">' +
                '<a href="#" id="quick-email-edit-link" class="qe-edit-link" style="display:none;">Edit this template</a>' +
                '<button type="button" id="quick-email-delete-btn" class="qe-delete-link" style="display:none;" title="Remove this saved template">Delete template</button>' +
                '<button type="button" id="quick-email-restore-defaults" class="qe-delete-link" style="display:none;" title="Restore the built-in templates and unhide any you have removed">Restore defaults</button>' +
              '</div>' +
            '</div>' +
            '<p id="quick-email-description" class="qe-description"></p>' +

            '<div id="quick-email-form" class="qe-form"></div>' +

            '<div id="quick-email-missing-strip" class="qe-missing-strip" style="display:none;" role="status"></div>' +
            '<div id="quick-email-error-strip"   class="qe-error-strip"   style="display:none;" role="alert"></div>' +

            '<div class="qe-preview">' +
              '<label class="qe-label" for="quick-email-subject">Subject</label>' +
              '<input type="text" id="quick-email-subject" class="qe-input qe-subject">' +
              '<label class="qe-label" for="quick-email-body">Message</label>' +
              '<textarea id="quick-email-body" class="qe-input qe-message" rows="10"></textarea>' +
              '<p class="qe-help">You can edit the email before sending.</p>' +
            '</div>' +
          '</div>' +

            '<div id="quick-email-followup" class="qe-followup" style="display:none;" role="status" aria-live="polite"></div>' +
            '<div id="quick-email-routes-panel" class="qe-routes-panel" style="display:none;">' +
              '<div class="qe-routes-title">If Outlook landed on the inbox or home, try a different compose route:</div>' +
              '<div class="qe-routes-actions">' +
                '<button type="button" id="qe-send-alt" class="btn btn-secondary" title="Try Outlook compose alternate route (M365 OWA action/compose)">Try alternate compose</button>' +
                '<button type="button" id="qe-send-personal" class="btn btn-secondary" title="Try Outlook.com personal compose route">Try personal compose</button>' +
                debugTools +
              '</div>' +
            '</div>' +

          '<div class="email-oic-actions qe-actions">' +
            '<div class="qe-actions-left">' +
              '<button type="button" id="qe-send"   class="btn btn-primary">Send via Outlook Web</button>' +
              '<button type="button" id="qe-copy"   class="btn btn-secondary">Copy</button>' +
              '<button type="button" id="qe-save"   class="btn btn-secondary">Save as new template</button>' +
            '</div>' +
            '<div class="qe-actions-right">' +
              '<button type="button" id="qe-routes-toggle" class="qe-link-btn" title="Show or hide alternate Outlook compose routes" aria-expanded="false">More routes</button>' +
              '<button type="button" id="qe-clear"  class="btn btn-ghost"   title="Reset the form, template choice and message">Clear</button>' +
              '<button type="button" id="qe-cancel" class="btn btn-ghost">Cancel</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  function _bindEvents() {
    var modal = document.getElementById('quick-email-modal');
    if (!modal) return;

    function _close() {
      if (modal._escHandler) document.removeEventListener('keydown', modal._escHandler);
      modal.remove();
    }
    function _onKey(e) { if (e.key === 'Escape') _close(); }
    document.addEventListener('keydown', _onKey);
    modal._escHandler = _onKey;

    modal.querySelector('.qe-close').addEventListener('click', _close);
    document.getElementById('qe-cancel').addEventListener('click', _close);
    modal.addEventListener('click', function(e) { if (e.target === modal) _close(); });

    document.getElementById('quick-email-picker').addEventListener('change', function(e) {
      _selectTemplate(e.target.value || '');
    });
    document.getElementById('quick-email-edit-link').addEventListener('click', function(e) {
      e.preventDefault();
      _openEditPanel();
    });
    document.getElementById('quick-email-delete-btn').addEventListener('click', function() {
      _confirmDeleteTemplate(function() { _deleteActiveTemplate(null); });
    });
    var restoreBtn = document.getElementById('quick-email-restore-defaults');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', _restoreAllSystemDefaults);
    }

    var subjEl = document.getElementById('quick-email-subject');
    var bodyEl = document.getElementById('quick-email-body');
    if (subjEl) subjEl.addEventListener('input', function() { _manualSubject = subjEl.value; });
    if (bodyEl) bodyEl.addEventListener('input', function() { _manualBody    = bodyEl.value; });

    document.getElementById('qe-send').addEventListener('click', function(e) { _sendViaOutlook(e, _getPreferredRoute(), _getPreferredAccountType()); });
    document.getElementById('qe-send-alt').addEventListener('click', function(e) { _sendViaOutlook(e, 'work_alt', 'work'); });
    document.getElementById('qe-send-personal').addEventListener('click', function(e) { _sendViaOutlook(e, 'personal', 'personal'); });
    var routesToggle = document.getElementById('qe-routes-toggle');
    if (routesToggle) {
      routesToggle.addEventListener('click', function(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        _toggleRoutesPanel();
      });
    }
    document.getElementById('qe-copy').addEventListener('click', _copy);
    document.getElementById('qe-save').addEventListener('click', _openSavePanel);
    var copyDebugBtn = document.getElementById('qe-copy-debug-url');
    if (copyDebugBtn) {
      copyDebugBtn.addEventListener('click', function(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        var draft = _buildDraftFromCurrentState();
        var url = _buildDebugComposeUrl('work_primary', draft.to, draft.subject, _truncateBodyForOutlook(draft.body));
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function() {
            showToast('Copied Outlook compose debug URL', 'success');
          }).catch(function() { _fallbackCopyQuick(url); });
        } else {
          _fallbackCopyQuick(url);
        }
      });
    }
    var clearBtn = document.getElementById('qe-clear');
    if (clearBtn) clearBtn.addEventListener('click', _clearForm);
  }

  /* ── Boot ────────────────────────────────────────── */

  _hydrateDraft();
  if (_selectedId && typeof window.getQuickEmailTemplateById === 'function') {
    _activeTemplate = window.getQuickEmailTemplateById(_selectedId) || null;
    if (!_activeTemplate) _selectedId = '';
  }

  _renderModal();
  _bindEvents();
  _renderPicker();
  _renderForm();
  _renderPreview();
}

