/**
 * Opt-in AI fill for The Law / Elements of offence.
 * Checkbox → confirm → main OpenAI IPC → review modal → insert into lawElements.
 */
(function () {
  'use strict';

  var _running = false;

  function toast(msg, type, ms) {
    if (typeof showToast === 'function') showToast(msg, type || 'info', ms);
  }

  function getOpenFormData() {
    try {
      if (typeof window.getFormData === 'function') return window.getFormData() || {};
      if (typeof getFormData === 'function') return getFormData() || {};
    } catch (_) {}
    return (typeof formData === 'object' && formData) || {};
  }

  function showReviewModal(draft, meta) {
    var modal = document.getElementById('ai-law-draft-modal');
    var text = document.getElementById('ai-law-draft-text');
    var metaEl = document.getElementById('ai-law-draft-meta');
    if (!modal || !text) return;
    text.value = draft || '';
    if (metaEl) metaEl.textContent = meta || '';
    modal.style.display = '';
  }

  function hideReviewModal() {
    var modal = document.getElementById('ai-law-draft-modal');
    if (modal) modal.style.display = 'none';
  }

  function setField(key, value) {
    try {
      if (typeof formData === 'object' && formData) formData[key] = value;
    } catch (_) {}
    if (typeof window.setFieldValue === 'function') {
      window.setFieldValue(key, value);
      return;
    }
    if (typeof setFieldValue === 'function') {
      setFieldValue(key, value);
      return;
    }
    var el = document.querySelector('[data-field="' + key + '"]');
    if (el) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function getField(key) {
    try {
      if (typeof window.getFieldValue === 'function') return String(window.getFieldValue(key) || '');
      if (typeof getFieldValue === 'function') return String(getFieldValue(key) || '');
    } catch (_) {}
    try {
      if (typeof formData === 'object' && formData && formData[key] != null) return String(formData[key]);
    } catch (_) {}
    var el = document.querySelector('[data-field="' + key + '"]');
    return el ? String(el.value || '') : '';
  }

  function uncheckAiBoxes() {
    document.querySelectorAll('[data-field="aiFillLawElements"]').forEach(function (cb) {
      if (cb && cb.type === 'checkbox') cb.checked = false;
    });
    try {
      if (typeof formData === 'object' && formData) formData.aiFillLawElements = '';
    } catch (_) {}
  }

  function insertIntoLawElements() {
    var text = document.getElementById('ai-law-draft-text');
    var draft = text ? String(text.value || '').trim() : '';
    if (!draft) {
      toast('Nothing to insert', 'warning');
      return;
    }
    var existing = getField('lawElements').trim();
    if (existing && typeof showConfirm === 'function') {
      showConfirm(
        'Replace the current Law / Elements of offence text with this AI draft?',
        'Insert AI draft',
      ).then(function (ok) {
        if (ok) {
          setField('lawElements', draft);
          toast('Inserted into Law / Elements of offence — review before saving', 'success', 5000);
          hideReviewModal();
          uncheckAiBoxes();
        }
      });
      return;
    }
    setField('lawElements', draft);
    toast('Inserted into Law / Elements of offence — review before saving', 'success', 5000);
    hideReviewModal();
    uncheckAiBoxes();
  }

  function runFill() {
    if (_running) {
      toast('AI request already in progress', 'warning');
      return;
    }
    if (!window.api || typeof window.api.aiFillLawElements !== 'function') {
      toast('AI fill is not available in this build', 'error');
      uncheckAiBoxes();
      return;
    }
    var data = getOpenFormData();
    _running = true;
    toast('Requesting AI draft\u2026', 'info', 4000);
    window.api
      .aiFillLawElements({
        confirmed: true,
        formData: data,
        attendanceId: typeof currentAttendanceId !== 'undefined' ? currentAttendanceId : null,
      })
      .then(function (res) {
        _running = false;
        if (!res || !res.ok) {
          toast((res && res.error) || 'AI fill failed', 'error', 7000);
          uncheckAiBoxes();
          return;
        }
        showReviewModal(res.draft, res.message || 'AI draft — review before inserting');
      })
      .catch(function (e) {
        _running = false;
        toast('AI fill failed: ' + (e && e.message ? e.message : e), 'error');
        uncheckAiBoxes();
      });
  }

  function onCheckboxChange(cb) {
    if (!cb.checked) return;
    var msg =
      'Send offence name(s) and statute(s) only to OpenAI to draft actus reus, mens rea, defences and sentencing guidelines?\n\n' +
      'Client details and privileged notes are not sent. You must review the draft before it is inserted.';
    if (typeof showConfirm === 'function') {
      showConfirm(msg, 'AI fill — Law / Elements').then(function (ok) {
        if (ok) runFill();
        else uncheckAiBoxes();
      });
      return;
    }
    runFill();
  }

  function observeForm() {
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('input[data-field="aiFillLawElements"]')) {
        onCheckboxChange(t);
      }
    });
  }

  function wireModal() {
    var copyBtn = document.getElementById('ai-law-draft-copy');
    var insertBtn = document.getElementById('ai-law-draft-insert');
    var closeBtn = document.getElementById('ai-law-draft-close');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var text = document.getElementById('ai-law-draft-text');
        var v = text ? text.value : '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(v).then(function () {
            toast('Draft copied', 'success');
          });
        } else toast(v, 'info', 10000);
      });
    }
    if (insertBtn) insertBtn.addEventListener('click', insertIntoLawElements);
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        hideReviewModal();
        uncheckAiBoxes();
      });
    }
  }

  window.AiLawElements = { runFill: runFill };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      observeForm();
      wireModal();
    });
  } else {
    observeForm();
    wireModal();
  }
})();
