/* ═══════════════════════════════════════════════════════
   EMAIL MODAL — Officer Email Templates Add-On
   Depends on: buildEmailBody, buildEmailSubject, buildMailtoHref,
               buildEmailClientUrl, getEmailClientLabel, EMAIL_CLIENTS
               (email-templates.js)
               showToast, refreshList, esc (app.js globals)
               window._appSettingsCache, window.api
   ═══════════════════════════════════════════════════════ */

var _EMAIL_TEMPLATES = [
  { id: 'first_attendance', label: 'First Attendance Disclosure Request' },
  { id: 'follow_up',        label: 'Follow-Up / Outcome Request' },
  { id: 'no_reply',         label: 'No Reply Follow-Up' }
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
  var pickerVisible = false;

  /* ── Helpers ─────────────────────────────────────────── */

  function _escAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _currentClient() {
    var cached = _oicClean((window._appSettingsCache || {}).preferredEmailClient);
    if (cached) return cached;
    if (window.api && window.api.getSettings && !_currentClient._pending) {
      _currentClient._pending = true;
      window.api.getSettings().then(function(s) {
        _currentClient._pending = false;
        if (s) {
          window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, s);
          var fresh = _oicClean(s.preferredEmailClient);
          if (fresh) {
            var btn = document.getElementById('email-oic-open-app') || document.getElementById('quick-email-open-app');
            if (btn) btn.textContent = _openBtnLabel();
          }
        }
      }).catch(function() { _currentClient._pending = false; });
    }
    return 'default';
  }

  function _openBtnLabel() {
    var c = _currentClient();
    var label = getEmailClientLabel(c);
    return c === 'default' ? 'Open Email App \u25be' : 'Open in ' + label + ' \u25be';
  }

  function _openUrl(to, subject, body) {
    var url = buildEmailClientUrl(_currentClient(), to, subject, body);
    if (window.api && window.api.openExternal) {
      window.api.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  function _attendanceTypeLabel() {
    if (data._formType === 'telephone') return 'telephone advice';
    if (data.attendanceMode === 'voluntary') return 'voluntary attendance';
    return 'attendance';
  }

  function _fmtDateForPlaceholder(dateStr) {
    return _oicFmtDate(_oicClean(dateStr || data.date || data.instructionDateTime));
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
    var clientName = [_oicClean(data.forename), _oicClean(data.surname)].filter(Boolean).join(' ');
    return {
      clientName: clientName,
      contactName: _oicClean(data.firmContactName),
      firmName: _oicClean(data.firmName),
      station: _oicClean(data.policeStationName),
      date: _fmtDateForPlaceholder(),
      outcome: _oicClean(data.outcomeDecision),
      nextStep: [_oicClean(data.nextLocationName), _oicFmtDate(_oicClean(data.nextDate))].filter(Boolean).join(' - '),
      followUp: _oicClean(data.followUpRequired),
      attendanceType: _attendanceTypeLabel(),
      feeEarnerName: feeEarnerName,
      ourFileNumber: _oicClean(data.ourFileNumber || data.fileReference),
      ufn: _oicClean(data.ufn),
      oicName: _oicClean(data.oicName),
      offenceType: _oicClean(data.offenceSummary)
    };
  }

  function _applyOfficerPlaceholders(text) {
    var map = _getOfficerPlaceholderMap();
    return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function(_, key) {
      return map[key] != null ? String(map[key]) : '';
    });
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
          /* Inline client picker — hidden by default */
          '<div id="email-client-picker" class="email-client-picker" style="display:none;">' +
            '<p class="email-client-picker-label">Choose your email app:</p>' +
            '<div class="email-client-picker-grid">' +
              EMAIL_CLIENTS.map(function(c) {
                return '<button type="button" class="email-client-btn' +
                  (_currentClient() === c.id ? ' active' : '') +
                  '" data-client="' + c.id + '">' + _escAttr(c.label) + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div class="email-oic-actions">' +
            '<button type="button" id="email-oic-open-app" class="btn btn-primary">' + _escAttr(_openBtnLabel()) + '</button>' +
            '<button type="button" id="email-oic-change-client" class="btn-link-subtle" title="Change email app">Change app</button>' +
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
    });

    /* Open Email App — uses current preference */
    document.getElementById('email-oic-open-app').addEventListener('click', function() {
      var to      = document.getElementById('email-oic-to').value.trim();
      var subject = document.getElementById('email-oic-subject').value.trim();
      var body    = document.getElementById('email-oic-body').value;
      if (!to) {
        showToast('Please enter an officer email address first', 'warning');
        document.getElementById('email-oic-to').focus();
        return;
      }
      if (_currentClient() === 'default' && !((window._appSettingsCache || {}).preferredEmailClient)) {
        _togglePicker(true);
      } else {
        _openUrl(to, subject, body);
      }
    });

    /* Change app — always shows picker */
    document.getElementById('email-oic-change-client').addEventListener('click', function() {
      _togglePicker(!pickerVisible);
    });

    /* Client picker buttons */
    modal.querySelectorAll('.email-client-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var clientId = btn.getAttribute('data-client');
        _saveClientPreference(clientId, function() {
          /* Update active state */
          modal.querySelectorAll('.email-client-btn').forEach(function(b) {
            b.classList.toggle('active', b.getAttribute('data-client') === clientId);
          });
          /* Update Open button label */
          document.getElementById('email-oic-open-app').textContent = _openBtnLabel();
          /* Open the email */
          var to      = document.getElementById('email-oic-to').value.trim();
          var subject = document.getElementById('email-oic-subject').value.trim();
          var body    = document.getElementById('email-oic-body').value;
          _openUrl(to, subject, body);
          _togglePicker(false);
        });
      });
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
  }

  /* ── Picker toggle ───────────────────────────────────── */

  function _togglePicker(show) {
    pickerVisible = show;
    var picker = document.getElementById('email-client-picker');
    if (picker) picker.style.display = show ? '' : 'none';
  }

  /* ── Save client preference ──────────────────────────── */

  function _saveClientPreference(clientId, cb) {
    window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, { preferredEmailClient: clientId });
    /* Also update the Settings dropdown if it exists */
    var sel = document.getElementById('setting-preferred-email-client');
    if (sel) sel.value = clientId;
    window.api.setSettings({ preferredEmailClient: clientId }).then(function() {
      if (typeof cb === 'function') cb();
    }).catch(function() {
      showToast('Could not save email app preference', 'error');
      if (typeof cb === 'function') cb();
    });
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
    lastOfficerEmailRecipient:    recipientEmail || ''
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
    var tpls = [];
    try { tpls = JSON.parse(localStorage.getItem('cn-custom-email-templates') || '[]'); } catch (_) {}
    tpls.push({ name: name, subject: subjectTpl, body: bodyTpl, scope: 'officer' });
    try { localStorage.setItem('cn-custom-email-templates', JSON.stringify(tpls)); } catch (_) {}
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
  var pickerVisible = false;

  function _escAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _currentClient() {
    var cached = _oicClean((window._appSettingsCache || {}).preferredEmailClient);
    return cached || 'default';
  }

  function _openBtnLabel() {
    var c = _currentClient();
    var label = getEmailClientLabel(c);
    return c === 'default' ? 'Open Email App \u25be' : 'Open in ' + label + ' \u25be';
  }

  function _openUrl(to, subject, body) {
    var url = buildEmailClientUrl(_currentClient(), to, subject, body);
    if (window.api && window.api.openExternal) {
      window.api.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
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
  var _bodyManuallyEdited = false;
  var _subjectManuallyEdited = false;

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

  function _applyCustomTemplate(templateId) {
    var tpl = _getBuiltinTemplateById(templateId) || _getCustomTemplateByIdQuick(templateId);
    if (!tpl) return;
    _activeRawTemplate = tpl;
    _bodyManuallyEdited = false;
    _subjectManuallyEdited = false;
    _refreshTemplateFields();
  }

  function _refreshTemplateFields() {
    if (!_activeRawTemplate) return;
    var subjectEl = document.getElementById('quick-email-subject');
    var bodyEl = document.getElementById('quick-email-body');
    if (subjectEl && !_subjectManuallyEdited) {
      subjectEl.value = _applyPlaceholders(_activeRawTemplate.subject || '');
      subjectEl.dataset.userEdited = '1';
    }
    if (bodyEl && !_bodyManuallyEdited) {
      bodyEl.value = _applyPlaceholders(_activeRawTemplate.body || '');
    }
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
          '<div id="email-client-picker-quick" class="email-client-picker" style="display:none;">' +
            '<p class="email-client-picker-label">Choose your email app:</p>' +
            '<div class="email-client-picker-grid">' +
              EMAIL_CLIENTS.map(function(c) {
                return '<button type="button" class="email-client-btn' +
                  (_currentClient() === c.id ? ' active' : '') +
                  '" data-client="' + c.id + '">' + _escAttr(c.label) + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div class="email-oic-actions quick-email-actions">' +
            '<button type="button" id="quick-email-open-app" class="btn btn-primary">' + _escAttr(_openBtnLabel()) + '</button>' +
            '<button type="button" id="quick-email-change-client" class="btn-link-subtle" title="Change email app">Change app</button>' +
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
    templateFields.forEach(function(fieldId) {
      var el = modal.querySelector('#' + fieldId);
      if (el) {
        var evName = (el.tagName === 'SELECT') ? 'change' : 'input';
        el.addEventListener(evName, function() {
          if (_activeRawTemplate) {
            _refreshTemplateFields();
          }
        });
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
        _subjectManuallyEdited = true;
      });
    }

    var bodyField = document.getElementById('quick-email-body');
    if (bodyField) {
      bodyField.addEventListener('input', function() {
        _bodyManuallyEdited = true;
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
          _bodyManuallyEdited = false;
          _subjectManuallyEdited = false;
          var subjectEl = document.getElementById('quick-email-subject');
          if (subjectEl) {
            delete subjectEl.dataset.userEdited;
            subjectEl.value = _autoSubject();
          }
          var bodyEl = document.getElementById('quick-email-body');
          if (bodyEl) bodyEl.value = '';
        }
      });
    }

    modal.querySelector('#quick-email-open-app').addEventListener('click', function() {
      var to = ((modal.querySelector('#quick-email-to') || {}).value || '').trim();
      if (!to) { showToast('Please enter an officer email address', 'error'); return; }
      var subject = ((modal.querySelector('#quick-email-subject') || {}).value || '').trim() || _autoSubject();
      var body = (modal.querySelector('#quick-email-body') || {}).value || '';
      if (_currentClient() === 'default' && !((window._appSettingsCache || {}).preferredEmailClient)) {
        _toggleQuickPicker(true);
      } else {
        _openUrl(to, subject, body);
      }
    });

    modal.querySelector('#quick-email-change-client').addEventListener('click', function() {
      _toggleQuickPicker(!pickerVisible);
    });

    modal.querySelectorAll('.email-client-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var clientId = btn.getAttribute('data-client');
        window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, { preferredEmailClient: clientId });
        var sel = document.getElementById('setting-preferred-email-client');
        if (sel) sel.value = clientId;
        window.api.setSettings({ preferredEmailClient: clientId }).catch(function() {
          showToast('Could not save email app preference', 'error');
        });
        modal.querySelectorAll('.email-client-btn').forEach(function(b) {
          b.classList.toggle('active', b.getAttribute('data-client') === clientId);
        });
        var openBtn = document.getElementById('quick-email-open-app');
        if (openBtn) openBtn.textContent = _openBtnLabel();
        var to = ((modal.querySelector('#quick-email-to') || {}).value || '').trim();
        if (!to) { showToast('Please enter an officer email address', 'error'); _toggleQuickPicker(false); return; }
        var subject = ((modal.querySelector('#quick-email-subject') || {}).value || '').trim() || _autoSubject();
        var body = (modal.querySelector('#quick-email-body') || {}).value || '';
        _openUrl(to, subject, body);
        _toggleQuickPicker(false);
      });
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

  function _toggleQuickPicker(show) {
    pickerVisible = show;
    var picker = document.getElementById('email-client-picker-quick');
    if (picker) picker.style.display = show ? '' : 'none';
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
