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
    return _oicClean((window._appSettingsCache || {}).preferredEmailClient) || 'default';
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

    modal.querySelector('.email-oic-close').addEventListener('click', closeEmailModal);
    document.getElementById('email-oic-cancel').addEventListener('click', closeEmailModal);
    modal.addEventListener('click', function(e) { if (e.target === modal) closeEmailModal(); });

    function _onKeyDown(e) {
      if (e.key === 'Escape') { closeEmailModal(); document.removeEventListener('keydown', _onKeyDown); }
    }
    document.addEventListener('keydown', _onKeyDown);

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
      if (_currentClient() === 'default' && !((window._appSettingsCache || {}).preferredEmailClient)) {
        /* No preference set yet — show picker first */
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
  if (modal) modal.remove();
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
