/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   EMAIL MODAL â€” Officer Email Templates Add-On
   Depends on: buildEmailBody, buildEmailSubject (email-templates.js)
   v1.6.20: copy-and-paste only - no Outlook launch surfaces. The Quick
   Email modal exposes Copy Body / Copy Subject / Save as Template /
   Mark Sent / Clear / Cancel; the user pastes into Outlook themselves.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

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

function openEmailModal(recordId, recordData, recordStatus) {
  var stale = document.getElementById('email-oic-modal');
  if (stale) stale.remove();

  var data          = recordData || {};
  var settings      = window._appSettingsCache || {};
  var feeEarnerName = _oicClean(data.feeEarnerName) || _oicClean(settings.feeEarnerNameDefault) || '';
  var lastTplUsed   = _oicClean(data.lastOfficerEmailTemplateUsed);
  var currentTpl    = _EMAIL_TEMPLATES.some(function(t) { return t.id === lastTplUsed; }) ? lastTplUsed : 'first_attendance';
  var currentCustomTpl = '';

  /* â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function _escAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

  /* â”€â”€ Missing-field detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

  /* â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
            '<button type="button" id="email-oic-copy"      class="btn btn-primary">Copy Email Body</button>' +
            '<button type="button" id="email-oic-copy-subject" class="btn btn-secondary">Copy Subject</button>' +
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

  /* â”€â”€ Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

    /* v1.6.20: Quick Email is copy-and-paste only — Open in Outlook /
       Outlook Web were removed because the launch path was unreliable
       (Outlook PWA hijack, Edge sign-in prompts, Default-browser
       interception). The user copies the body / subject and pastes into
       whatever Outlook surface they prefer. */

    /* Copy Subject — extra surface so users can paste directly into the
       Outlook subject line without re-typing. */
    document.getElementById('email-oic-copy-subject').addEventListener('click', function() {
      var subject = document.getElementById('email-oic-subject').value;
      if (!String(subject || '').trim()) {
        if (typeof showToast === 'function') showToast('Subject is empty.', 'warning');
        return;
      }
      var fn = typeof window.custodyCopyEmailText === 'function' ? window.custodyCopyEmailText : null;
      if (fn) {
        Promise.resolve(fn(subject, typeof window !== 'undefined' ? window : globalThis))
          .then(function (ok) {
            if (ok && typeof showToast === 'function') {
              showToast('Subject copied. Paste it into the Outlook subject line.', 'success');
            } else if (!ok) {
              _fallbackCopy(subject);
            }
          })
          .catch(function () { _fallbackCopy(subject); });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(subject).then(function() {
          showToast('Subject copied to clipboard', 'success');
        }).catch(function() { _fallbackCopy(subject); });
      } else {
        _fallbackCopy(subject);
      }
    });

    /* Explicit Clear â€” user-initiated reset of subject + body to the current
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

    /* Copy — same custodyCopyEmailText helper as Officer Emails (Clipboard API + textarea fallback). */
    document.getElementById('email-oic-copy').addEventListener('click', function() {
      var body = document.getElementById('email-oic-body').value;
      if (!String(body || '').trim()) {
        if (typeof showToast === 'function') showToast('Message is empty.', 'warning');
        return;
      }
      var fn = typeof window.custodyCopyEmailText === 'function' ? window.custodyCopyEmailText : null;
      if (fn) {
        Promise.resolve(fn(body, typeof window !== 'undefined' ? window : globalThis))
          .then(function (ok) {
            if (ok && typeof showToast === 'function') {
              showToast('Email body copied. You can now paste it into Outlook.', 'success');
            } else if (!ok) {
              _fallbackCopy(body);
            }
          })
          .catch(function () { _fallbackCopy(body); });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
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

  /* â”€â”€ Clipboard fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
      showToast('Copy failed â€” please select the text manually', 'error');
    }
  }

  _renderModal();
}

/* â”€â”€ Close â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function closeEmailModal() {
  var modal = document.getElementById('email-oic-modal');
  if (!modal) return;
  if (modal._escHandler) document.removeEventListener('keydown', modal._escHandler);
  modal.remove();
}

/* â”€â”€ Mark Sent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
      showToast('Failed to save sent status â€” please try again', 'error');
    });
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   SAVE AS TEMPLATE â€” inline from any email compose modal
   Replaces known field values with {{placeholders}} so templates are reusable.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

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

  var subjectEl = modal.querySelector('#email-oic-subject');
  var bodyEl    = modal.querySelector('#email-oic-body');
  if (!subjectEl || !bodyEl) return;

  var wrap = document.createElement('div');
  wrap.className = 'save-tpl-inline';
  wrap.style.cssText = 'margin:0.6rem 0 0.3rem;padding:0.6rem 0.8rem;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;display:flex;align-items:center;gap:0.5rem;';
  wrap.innerHTML =
    '<input type="text" id="save-tpl-name" placeholder="Template name e.g. Disclosure request" ' +
      'style="flex:1;padding:0.35rem 0.5rem;border:1px solid #cbd5e1;border-radius:6px;font-size:0.85rem;">' +
    '<button type="button" id="save-tpl-confirm" class="btn btn-primary" style="white-space:nowrap;">Save</button>' +
    '<button type="button" id="save-tpl-cancel" class="btn btn-secondary" style="white-space:nowrap;">Cancel</button>';

  var actionsBar = modal.querySelector('.email-oic-actions');
  if (actionsBar) actionsBar.parentNode.insertBefore(wrap, actionsBar);
  else modal.querySelector('.email-oic-box').appendChild(wrap);

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
    /* requiredFields stays empty here \u2014 it is recomputed on demand by the
       Email OIC modal's _computeMissing() helper from the saved template body. */
    var reqFields = [];
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
    showToast('Template saved â€” available in all officer email modals', 'success');
    wrap.style.display = 'none';

    var customSelect = modal.querySelector('#email-oic-custom-template');
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

/**
 * "Quick email to officer" — Records toolbar / shortcuts without opening a saved attendance first.
 * Opens the same Email OIC modal with empty record context; user enters To + edits template, then Outlook Web.
 */
function openQuickEmailModal() {
  openEmailModal(null, {}, null);
}

window.openQuickEmailModal = openQuickEmailModal;
