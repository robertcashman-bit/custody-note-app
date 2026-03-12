/* ═══════════════════════════════════════════════════════
   EMAIL MODAL — Officer Email Templates Add-On
   Depends on: buildEmailBody, buildEmailSubject, buildMailtoHref (email-templates.js)
               showToast, refreshList, esc (app.js globals)
               window._appSettingsCache, window.api
   ═══════════════════════════════════════════════════════ */

var _EMAIL_TEMPLATES = [
  { id: 'first_attendance', label: 'First Attendance Disclosure Request' },
  { id: 'follow_up',        label: 'Follow-Up / Outcome Request' },
  { id: 'no_reply',         label: 'No Reply Follow-Up' }
];

function openEmailModal(recordId, recordData, recordStatus) {
  /* Remove any stale modal */
  var stale = document.getElementById('email-oic-modal');
  if (stale) stale.remove();

  var data         = recordData || {};
  var settings     = window._appSettingsCache || {};
  var feeEarnerName = _oicClean(data.feeEarnerName) || _oicClean(settings.feeEarnerNameDefault) || '';
  var currentTpl   = 'first_attendance';

  /* ── Render helpers ──────────────────────────────────── */

  function _escAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function _renderModal() {
    var stale2 = document.getElementById('email-oic-modal');
    if (stale2) stale2.remove();

    var oicEmail = _oicClean(data.oicEmail);
    var subject  = buildEmailSubject(currentTpl, data);
    var body     = buildEmailBody(currentTpl, data, feeEarnerName);

    var tabsHtml = _EMAIL_TEMPLATES.map(function(t) {
      return '<button type="button" class="email-oic-tab' +
        (t.id === currentTpl ? ' active' : '') +
        '" data-tpl="' + t.id + '">' + _escAttr(t.label) + '</button>';
    }).join('');

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
          '<div class="email-oic-tabs" role="group" aria-label="Email template">' +
            tabsHtml +
          '</div>' +
          '<div class="email-oic-fields">' +
            noEmailNote +
            '<label class="email-oic-label" for="email-oic-to">To</label>' +
            '<input type="email" id="email-oic-to" class="email-oic-input" value="' + _escAttr(oicEmail) +
              '" placeholder="Enter officer email address">' +
            '<label class="email-oic-label" for="email-oic-subject">Subject</label>' +
            '<input type="text" id="email-oic-subject" class="email-oic-input" value="' + _escAttr(subject) + '">' +
            '<label class="email-oic-label" for="email-oic-body">Message</label>' +
            '<textarea id="email-oic-body" class="email-oic-textarea" rows="14">' + _escAttr(body) + '</textarea>' +
          '</div>' +
          '<div class="email-oic-actions">' +
            '<button type="button" id="email-oic-open-app"   class="btn btn-primary">Open Email App</button>' +
            '<button type="button" id="email-oic-copy"       class="btn btn-secondary">Copy Email</button>' +
            '<button type="button" id="email-oic-mark-sent"  class="btn btn-secondary">Mark Sent</button>' +
            '<button type="button" id="email-oic-cancel"     class="btn btn-secondary">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
    _bindEvents();
  }

  /* ── Event wiring ────────────────────────────────────── */

  function _bindEvents() {
    var modal = document.getElementById('email-oic-modal');
    if (!modal) return;

    /* Close on X button, Cancel, or backdrop click */
    modal.querySelector('.email-oic-close').addEventListener('click', closeEmailModal);
    document.getElementById('email-oic-cancel').addEventListener('click', closeEmailModal);
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closeEmailModal();
    });

    /* Escape key */
    function _onKeyDown(e) {
      if (e.key === 'Escape') { closeEmailModal(); document.removeEventListener('keydown', _onKeyDown); }
    }
    document.addEventListener('keydown', _onKeyDown);

    /* Template tab switching — update subject + body, preserve To field */
    modal.querySelectorAll('.email-oic-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        currentTpl = btn.getAttribute('data-tpl');
        modal.querySelectorAll('.email-oic-tab').forEach(function(b) {
          b.classList.toggle('active', b.getAttribute('data-tpl') === currentTpl);
        });
        document.getElementById('email-oic-subject').value = buildEmailSubject(currentTpl, data);
        document.getElementById('email-oic-body').value    = buildEmailBody(currentTpl, data, feeEarnerName);
      });
    });

    /* Open Email App via mailto */
    document.getElementById('email-oic-open-app').addEventListener('click', function() {
      var to      = document.getElementById('email-oic-to').value.trim();
      var subject = document.getElementById('email-oic-subject').value.trim();
      var body    = document.getElementById('email-oic-body').value;
      var href    = buildMailtoHref(to, subject, body);
      if (window.api && window.api.openExternal) {
        window.api.openExternal(href);
      } else {
        window.open(href, '_blank');
      }
    });

    /* Copy email body to clipboard */
    document.getElementById('email-oic-copy').addEventListener('click', function() {
      var body = document.getElementById('email-oic-body').value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(body).then(function() {
          showToast('Email copied to clipboard', 'success');
        }).catch(function() {
          _fallbackCopy(body);
        });
      } else {
        _fallbackCopy(body);
      }
    });

    /* Mark Sent — persists tracking fields and shows badge on list row */
    document.getElementById('email-oic-mark-sent').addEventListener('click', function() {
      var recipient = document.getElementById('email-oic-to').value.trim();
      _markEmailSent(recordId, data, recordStatus, currentTpl, recipient);
    });
  }

  /* ── Clipboard fallback (execCommand) ─────────────────── */

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

/* ── Close modal ─────────────────────────────────────────── */

function closeEmailModal() {
  var modal = document.getElementById('email-oic-modal');
  if (modal) modal.remove();
}

/* ── Mark Sent — writes follow-up tracking to record data blob ── */

function _markEmailSent(recordId, existingData, recordStatus, templateId, recipientEmail) {
  var updated = Object.assign({}, existingData, {
    officerEmailStatus:           'sent',
    lastOfficerEmailSentDate:     new Date().toISOString(),
    lastOfficerEmailTemplateUsed: templateId || 'first_attendance',
    lastOfficerEmailRecipient:    recipientEmail || ''
  });

  /* Preserve existing status — finalised records must be re-saved as finalised */
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
