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
  return window.invokeOutlookWebCompose(payload).then(function() {
    showToast('Opening Outlook Web…', 'success');
  }).catch(function(err) {
    console.error('[email-modal]', err);
    showToast(err && err.message ? err.message : 'Could not open email', 'error');
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
        }).catch(function() {});
      }
      _openUrl(to, subject, body);
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

function _markEmailSent(recordId, existingData, recordStatus, templateId, recipientEmail) {
  var updated = Object.assign({}, existingData, {
    officerEmailStatus:           'sent',
    lastOfficerEmailSentDate:     new Date().toISOString(),
    lastOfficerEmailTemplateUsed: templateId || 'first_attendance',
    lastOfficerEmailRecipient:    recipientEmail || '',
    oicEmail:                     recipientEmail || existingData.oicEmail || ''
  });

  var status = recordStatus || 'draft';

  window.api.attendanceSave({ id: recordId, data: updated, status: status })
    .then(function(result) {
      if (result && result.error) {
        showToast('Could not save sent status: ' + (result.message || 'Unknown error'), 'error');
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
    tpls.push({ name: name, subject: subjectTpl, body: bodyTpl, scope: 'officer' });
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
   QUICK EMAIL MODAL — Email an officer without a record
   ═══════════════════════════════════════════════════════ */

function openQuickEmailModal() {
  var stale = document.getElementById('quick-email-modal');
  if (stale) stale.remove();

  var settings = window._appSettingsCache || {};
  var feeEarnerName = _oicClean(settings.feeEarnerNameDefault) || '';
  var currentCustomTpl = '';

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

  function _getCustomTemplatesForQuick() {
    var list = typeof window._getCustomEmailTemplates === 'function'
      ? (window._getCustomEmailTemplates() || [])
      : [];
    return list.map(function(tpl, idx) {
      return { id: 'custom:' + idx, template: tpl };
    }).filter(function(entry) {
      var scope = entry.template && entry.template.scope ? entry.template.scope : 'all';
      return scope === 'all' || scope === 'officer';
    });
  }

  function _attendanceTypeLabelFromValue(val) {
    var v = String(val || '').trim();
    if (v === 'telephone') return 'telephone advice';
    if (v === 'voluntary') return 'voluntary attendance';
    if (v === 'custody') return 'attendance';
    return '';
  }

  function _getPlaceholderMap() {
    var modal = document.getElementById('quick-email-modal');
    if (!modal) return {};
    var dateEl = modal.querySelector('#quick-email-date');
    var dateVal = dateEl && dateEl.value ? dateEl.value : '';
    var dateFormatted = '';
    if (dateVal) {
      var m = dateVal.match(/^(\d{4})-(\d{2})-(\d{2})/);
      dateFormatted = m ? m[3] + '/' + m[2] + '/' + m[1] : dateVal;
    } else {
      dateFormatted = new Date().toLocaleDateString('en-GB');
    }
    var timeEl = modal.querySelector('#quick-email-time');
    var timeVal = (timeEl && timeEl.value ? timeEl.value : '').slice(0, 5);
    var attendanceVal = (modal.querySelector('#quick-email-attendance-type') || {}).value || '';
    return {
      clientName: (modal.querySelector('#quick-email-client-name') || {}).value || '',
      oicName: (modal.querySelector('#quick-email-officer-name') || {}).value || '',
      station: (modal.querySelector('#quick-email-station') || {}).value || '',
      offenceType: (modal.querySelector('#quick-email-offence') || {}).value || '',
      feeEarnerName: feeEarnerName,
      date: dateFormatted,
      time: timeVal,
      contactName: '',
      firmName: '',
      outcome: '',
      nextStep: '',
      followUp: '',
      attendanceType: _attendanceTypeLabelFromValue(attendanceVal),
      ourFileNumber: '',
      ufn: ''
    };
  }

  function _applyPlaceholders(text) {
    var map = _getPlaceholderMap();
    return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function(_, key) {
      return map[key] != null ? String(map[key]) : '';
    });
  }

  /* ── Quick-email missing-field detection ─────────────── */

  function _computeQuickMissing() {
    var missing = [];
    var modal = document.getElementById('quick-email-modal');
    if (!modal) return missing;
    var toEl = modal.querySelector('#quick-email-to');
    if (!toEl || !String(toEl.value || '').trim()) {
      missing.push({ key: 'to', label: 'Officer email address' });
    }
    if (_activeRawTemplate) {
      var map = _getPlaceholderMap();
      var rawText = (_activeRawTemplate.subject || '') + '\n' + (_activeRawTemplate.body || '');
      var re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
      var seen = {};
      var m;
      var qLabels = {
        clientName: 'Client name', oicName: 'Officer name', station: 'Police station',
        offenceType: 'Offence', date: 'Date', feeEarnerName: 'Fee earner'
      };
      while ((m = re.exec(rawText)) !== null) {
        var key = m[1];
        if (seen[key]) continue;
        seen[key] = true;
        var val = map[key];
        if (val == null || String(val).trim() === '') {
          missing.push({ key: key, label: qLabels[key] || key });
        }
      }
    }
    return missing;
  }

  function _escAttrQ(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _updateQuickMissingWarn() {
    var warnEl = document.getElementById('quick-email-missing-warn');
    if (!warnEl) return;
    var missing = _computeQuickMissing();
    if (!missing.length) { warnEl.style.display = 'none'; return; }
    warnEl.innerHTML = '&#9888;&nbsp;<strong>Missing:</strong> ' +
      missing.map(function(f) {
        return '<span class="email-oic-missing-tag">' + _escAttrQ(f.label) + '</span>';
      }).join('');
    warnEl.style.display = '';
  }

  var _QUICK_BUILTIN_TEMPLATES = [
    {
      id: 'builtin:disclosure',
      name: 'Disclosure Request',
      subject: '{{clientName}} - {{station}} - Disclosure Request',
      body: 'Dear DC {{oicName}},\n\nI am writing in relation to {{clientName}}, who was detained at {{station}} on {{date}}.\n\nPlease could you provide disclosure in this matter.\n\nKind regards,\n{{feeEarnerName}}'
    },
    {
      id: 'builtin:bail',
      name: 'Bail Confirmation',
      subject: '{{clientName}} - {{station}} - Bail Enquiry',
      body: 'Dear DC {{oicName}},\n\nI am writing in relation to {{clientName}}, who was detained at {{station}} on {{date}}.\n\nWe understand they were released on police bail. Please confirm the bail return date, time, and any conditions.\n\nKind regards,\n{{feeEarnerName}}'
    }
  ];

  var _activeRawTemplate = null;
  var _subjectUserEdited = false;
  var _bodyUserEdited = false;

  /** Re-apply placeholder substitution from the raw template.
   *  Skips subject/body if: the user is actively focused there, OR they have manually edited it. */
  function _forceTemplateSync(modal) {
    if (!modal || !_activeRawTemplate) return;
    modal._activeRawTemplate = _activeRawTemplate;
    var subjectEl = modal.querySelector('#quick-email-subject');
    var bodyEl = modal.querySelector('#quick-email-body');
    if (!subjectEl || !bodyEl) return;
    try {
      if (!_subjectUserEdited && document.activeElement !== subjectEl) {
        subjectEl.value = _applyPlaceholders(_activeRawTemplate.subject || '');
      }
      if (!_bodyUserEdited && document.activeElement !== bodyEl) {
        bodyEl.value = _applyPlaceholders(_activeRawTemplate.body || '');
      }
    } catch (e) {
      console.error('[QuickEmail] template sync failed:', e);
    }
  }

  function _getCustomTemplateByIdQuick(templateId) {
    if (!templateId || String(templateId).indexOf('custom:') !== 0) return null;
    var idx = parseInt(String(templateId).slice(7), 10);
    if (!Number.isFinite(idx) || idx < 0) return null;
    var list = typeof window._getCustomEmailTemplates === 'function'
      ? (window._getCustomEmailTemplates() || [])
      : [];
    var tpl = list[idx];
    if (!tpl) return null;
    var scope = tpl.scope || 'all';
    return (scope === 'all' || scope === 'officer') ? tpl : null;
  }

  function _getBuiltinTemplateById(templateId) {
    if (!templateId || String(templateId).indexOf('builtin:') !== 0) return null;
    for (var i = 0; i < _QUICK_BUILTIN_TEMPLATES.length; i++) {
      if (_QUICK_BUILTIN_TEMPLATES[i].id === templateId) return _QUICK_BUILTIN_TEMPLATES[i];
    }
    return null;
  }

  function _autoConvertLegacyTemplate(tpl, templateId) {
    if (!tpl || (!tpl.body && !tpl.subject)) return tpl;
    var hasPH = /\{\{\s*[a-zA-Z_]+\s*\}\}/.test(tpl.subject || '') ||
                /\{\{\s*[a-zA-Z_]+\s*\}\}/.test(tpl.body || '');
    if (hasPH) return tpl;

    var detected = {};
    var subj = String(tpl.subject || '');
    var parts = subj.split(/\s+-\s+/);
    if (parts.length >= 2) {
      var last = parts[parts.length - 1].trim();
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(last)) {
        detected.date = last;
        parts.pop();
      }
      if (parts.length >= 2) {
        detected.clientName = parts[0].trim();
        detected.station = parts.slice(1).join(' - ').trim();
      } else if (parts.length === 1) {
        detected.clientName = parts[0].trim();
      }
    }

    var ranks = 'DC|DS|PC|DI|DCI|Sgt|Det\\.?\\s*Sgt|Inspector|Sergeant|Constable|Officer';
    var bodyRe = new RegExp('Dear\\s+(?:' + ranks + ')\\s+([A-Z][a-zA-Z\\x27\\-]+(?:\\s+[A-Z][a-zA-Z\\x27\\-]+)*)');
    var bm = String(tpl.body || '').match(bodyRe);
    if (bm) detected.oicName = bm[1].trim();

    var entries = [];
    for (var key in detected) {
      var val = detected[key];
      if (val && val.length >= 2) entries.push({ key: key, value: val });
    }
    if (entries.length === 0) return tpl;

    entries.sort(function(a, b) { return b.value.length - a.value.length; });
    var newSubject = tpl.subject || '';
    var newBody = tpl.body || '';
    for (var i = 0; i < entries.length; i++) {
      var escaped = entries[i].value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp(escaped, 'gi');
      var ph = '{{' + entries[i].key + '}}';
      newSubject = newSubject.replace(re, ph);
      newBody = newBody.replace(re, ph);
    }
    if (newSubject === (tpl.subject || '') && newBody === (tpl.body || '')) return tpl;

    var converted = { name: tpl.name, subject: newSubject, body: newBody, scope: tpl.scope };

    if (String(templateId).indexOf('custom:') === 0) {
      var idx = parseInt(String(templateId).slice(7), 10);
      try {
        var list = typeof window._getCustomEmailTemplates === 'function'
          ? (window._getCustomEmailTemplates() || []).slice()
          : [];
        if (list[idx]) {
          list[idx].subject = newSubject;
          list[idx].body = newBody;
          if (typeof window._saveCustomEmailTemplates === 'function') {
            window._saveCustomEmailTemplates(list);
          }
        }
      } catch (_) {}
    }
    return converted;
  }

  function _applyCustomTemplate(templateId) {
    var tpl = _getBuiltinTemplateById(templateId) || _getCustomTemplateByIdQuick(templateId);
    if (!tpl) return;
    if (String(templateId).indexOf('custom:') === 0) {
      tpl = _autoConvertLegacyTemplate(tpl, templateId);
    }
    _activeRawTemplate = tpl;
    _subjectUserEdited = false;
    _bodyUserEdited = false;
    var modal = document.getElementById('quick-email-modal');
    if (modal) modal._activeRawTemplate = tpl;
    _forceTemplateSync(modal);
  }

  function _refreshTemplateFields() {
    _forceTemplateSync(document.getElementById('quick-email-modal'));
  }

  function _autoSubject() {
    var modal = document.getElementById('quick-email-modal');
    if (!modal) return '';
    var clientName = (modal.querySelector('#quick-email-client-name') || {}).value || '';
    var station = (modal.querySelector('#quick-email-station') || {}).value || '';
    var map = _getPlaceholderMap();
    var datePart = map.date || new Date().toLocaleDateString('en-GB');
    var parts = [clientName, station, datePart].filter(Boolean);
    return parts.join(' - ');
  }

  function _renderQuickModal() {
    var stale2 = document.getElementById('quick-email-modal');
    if (stale2) stale2.remove();

    var customTemplates = _getCustomTemplatesForQuick();

    var builtinOptionsHtml = _QUICK_BUILTIN_TEMPLATES.map(function(tpl) {
      return '<option value="' + _escAttr(tpl.id) + '">' + _escAttr(tpl.name) + '</option>';
    }).join('');

    var customOptionsHtml = customTemplates.map(function(entry) {
      var tpl = entry.template || {};
      return '<option value="' + _escAttr(entry.id) + '">' +
        _escAttr(tpl.name || 'Custom template') + '</option>';
    }).join('');

    var customTemplateHtml =
      '<label class="email-oic-label" for="quick-email-custom-template">Template</label>' +
      '<select id="quick-email-custom-template" class="email-oic-input">' +
        '<option value="">— None (compose freely) —</option>' +
        '<optgroup label="Built-in">' + builtinOptionsHtml + '</optgroup>' +
        (customTemplates.length
          ? '<optgroup label="Saved templates">' + customOptionsHtml + '</optgroup>'
          : '') +
      '</select>';

    var html =
      '<div id="quick-email-modal" class="email-oic-overlay" role="dialog" aria-modal="true" aria-label="Quick Email">' +
        '<div class="email-oic-box quick-email-box">' +
          '<div class="email-oic-header">' +
            '<h3 class="email-oic-title">&#9993; Quick Email to Officer</h3>' +
            '<button type="button" class="email-oic-close" aria-label="Close modal">&times;</button>' +
          '</div>' +
          '<div class="email-oic-fields">' +
            '<label class="email-oic-label" for="quick-email-to">Officer email <span style="color:#ef4444;">*</span></label>' +
            '<input type="email" id="quick-email-to" class="email-oic-input" placeholder="officer@police.uk">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">' +
              '<div>' +
                '<label class="email-oic-label" for="quick-email-officer-name">Officer name</label>' +
                '<input type="text" id="quick-email-officer-name" class="email-oic-input" placeholder="e.g. DC Smith">' +
              '</div>' +
              '<div>' +
                '<label class="email-oic-label" for="quick-email-client-name">Client name</label>' +
                '<input type="text" id="quick-email-client-name" class="email-oic-input" placeholder="e.g. John Doe">' +
              '</div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">' +
              '<div>' +
                '<label class="email-oic-label" for="quick-email-station">Police station</label>' +
                '<input type="text" id="quick-email-station" class="email-oic-input" placeholder="e.g. Holborn">' +
              '</div>' +
              '<div>' +
                '<label class="email-oic-label" for="quick-email-offence">Offence / case</label>' +
                '<input type="text" id="quick-email-offence" class="email-oic-input" placeholder="e.g. ABH">' +
              '</div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;">' +
              '<div>' +
                '<label class="email-oic-label" for="quick-email-attendance-type">Type of attendance</label>' +
                '<select id="quick-email-attendance-type" class="email-oic-input">' +
                  '<option value="">—</option>' +
                  '<option value="custody">Custody</option>' +
                  '<option value="voluntary">Voluntary</option>' +
                  '<option value="telephone">Telephone advice</option>' +
                '</select>' +
              '</div>' +
              '<div>' +
                '<label class="email-oic-label" for="quick-email-date">Date</label>' +
                '<input type="date" id="quick-email-date" class="email-oic-input">' +
              '</div>' +
              '<div>' +
                '<label class="email-oic-label" for="quick-email-time">Time</label>' +
                '<input type="time" id="quick-email-time" class="email-oic-input">' +
              '</div>' +
            '</div>' +
            '<hr style="border:none;border-top:1px solid #e2e8f0;margin:0.5rem 0;">' +
            customTemplateHtml +
            '<label class="email-oic-label" for="quick-email-subject">Subject</label>' +
            '<input type="text" id="quick-email-subject" class="email-oic-input" value="" placeholder="Auto-filled from fields above">' +
            '<label class="email-oic-label" for="quick-email-body">Message</label>' +
            '<textarea id="quick-email-body" class="email-oic-textarea" rows="10" placeholder="Type your message here..."></textarea>' +
          '</div>' +
          '<div id="quick-email-missing-warn" class="email-oic-missing-warn" style="display:none"></div>' +
          '<div class="email-oic-actions quick-email-actions">' +
            '<button type="button" id="quick-email-open-app" class="btn btn-primary">Open in Outlook Web</button>' +
            '<button type="button" id="quick-email-copy" class="btn btn-secondary">Copy Email</button>' +
            '<button type="button" id="quick-email-save-tpl" class="btn btn-secondary">Save as Template</button>' +
            '<button type="button" id="quick-email-cancel" class="btn btn-secondary">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
    _bindQuickEvents();
  }

  function _bindQuickEvents() {
    var modal = document.getElementById('quick-email-modal');
    if (!modal) return;

    modal.getPlaceholderMap = _getPlaceholderMap;

    var dateInput = modal.querySelector('#quick-email-date');
    if (dateInput && !dateInput.value) {
      var today = new Date();
      dateInput.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    }

    function _close() {
      var m = document.getElementById('quick-email-modal');
      if (!m) return;
      if (m._escHandler) document.removeEventListener('keydown', m._escHandler);
      m.remove();
    }

    function _onKey(e) {
      if (e.key === 'Escape') _close();
    }
    document.addEventListener('keydown', _onKey);
    modal._escHandler = _onKey;

    modal.querySelector('.email-oic-close').addEventListener('click', _close);
    modal.querySelector('#quick-email-cancel').addEventListener('click', _close);
    modal.addEventListener('click', function(e) { if (e.target === modal) _close(); });

    var templateFields = [
      'quick-email-officer-name', 'quick-email-client-name',
      'quick-email-station', 'quick-email-offence',
      'quick-email-attendance-type', 'quick-email-date', 'quick-email-time'
    ];
    function onQuickTemplateContextChange() {
      if (_activeRawTemplate) _forceTemplateSync(modal);
      _updateQuickMissingWarn();
    }
    templateFields.forEach(function(fieldId) {
      var el = modal.querySelector('#' + fieldId);
      if (el) {
        el.addEventListener('input', onQuickTemplateContextChange);
        el.addEventListener('change', onQuickTemplateContextChange);
        if (['quick-email-client-name', 'quick-email-station', 'quick-email-date'].indexOf(fieldId) !== -1) {
          el.addEventListener('blur', function() {
            var subjectEl = document.getElementById('quick-email-subject');
            if (subjectEl && !subjectEl.dataset.userEdited && !_activeRawTemplate) {
              subjectEl.value = _autoSubject();
            }
          });
        }
      }
    });

    var subjectField = document.getElementById('quick-email-subject');
    if (subjectField) {
      subjectField.addEventListener('input', function() {
        subjectField.dataset.userEdited = '1';
        _subjectUserEdited = true;
      });
    }

    var bodyField = document.getElementById('quick-email-body');
    if (bodyField) {
      bodyField.addEventListener('input', function() {
        _bodyUserEdited = true;
      });
    }

    var customSelect = modal.querySelector('#quick-email-custom-template');
    if (customSelect) {
      customSelect.addEventListener('change', function(e) {
        currentCustomTpl = e.target.value || '';
        if (currentCustomTpl) {
          _applyCustomTemplate(currentCustomTpl);
        } else {
          _activeRawTemplate = null;
          _subjectUserEdited = false;
          _bodyUserEdited = false;
          modal._activeRawTemplate = null;
          var subjectEl = document.getElementById('quick-email-subject');
          if (subjectEl) {
            delete subjectEl.dataset.userEdited;
            subjectEl.value = _autoSubject();
          }
          var bodyEl = document.getElementById('quick-email-body');
          if (bodyEl) bodyEl.value = '';
        }
        _updateQuickMissingWarn();
      });
    }

    /* To-field and initial missing-warn */
    var _qToEl = modal.querySelector('#quick-email-to');
    if (_qToEl) _qToEl.addEventListener('input', _updateQuickMissingWarn);
    _updateQuickMissingWarn();
    setTimeout(function() {
      _forceTemplateSync(modal);
    }, 50);

    modal.querySelector('#quick-email-open-app').addEventListener('click', function() {
      var to = ((modal.querySelector('#quick-email-to') || {}).value || '').trim();
      if (!to) { showToast('Please enter an officer email address', 'error'); return; }
      var subject = ((modal.querySelector('#quick-email-subject') || {}).value || '').trim() || _autoSubject();
      var body = (modal.querySelector('#quick-email-body') || {}).value || '';
      _openUrl(to, subject, body);
    });

    modal.querySelector('#quick-email-copy').addEventListener('click', function() {
      var body = (modal.querySelector('#quick-email-body') || {}).value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(body).then(function() {
          showToast('Email copied to clipboard', 'success');
        }).catch(function() { _qFallbackCopy(body); });
      } else {
        _qFallbackCopy(body);
      }
    });

    modal.querySelector('#quick-email-save-tpl').addEventListener('click', function() {
      _saveAsTemplate('quick-email-modal');
    });
  }

  function _qFallbackCopy(text) {
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

  _renderQuickModal();
}
