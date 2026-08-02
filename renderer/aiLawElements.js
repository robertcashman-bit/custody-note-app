/**
 * Opt-in AI: Law / Elements fill + free-form Ask AI session.
 * Law fill: checkbox → confirm → IPC → review modal → Insert only into lawElements.
 * Ask AI: checkbox → multi-turn modal → Copy / Append only on explicit click.
 */
(function () {
  'use strict';

  var _fillRunning = false;
  var _askRunning = false;
  var _askSessionConfirmed = false;
  var _askThread = []; /* { role, content } */

  function toast(msg, type, ms) {
    if (typeof showToast === 'function') showToast(msg, type || 'info', ms);
  }

  function confirmAsync(message, title) {
    if (typeof showConfirm === 'function') {
      return showConfirm(message, title || 'Confirm');
    }
    return Promise.resolve(window.confirm(String(message || '')));
  }

  function getOpenFormData() {
    try {
      if (typeof window.getFormData === 'function') return window.getFormData() || {};
      if (typeof getFormData === 'function') return getFormData() || {};
    } catch (_) {}
    return (typeof formData === 'object' && formData) || {};
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

  function copyText(v) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(v).then(function () {
        toast('Copied', 'success');
      });
    }
    toast(v, 'info', 10000);
    return Promise.resolve();
  }

  /* ── Law / Elements fill ── */

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

  function uncheckFillBoxes() {
    document.querySelectorAll('[data-field="aiFillLawElements"]').forEach(function (cb) {
      if (cb && cb.type === 'checkbox') cb.checked = false;
    });
    try {
      if (typeof formData === 'object' && formData) formData.aiFillLawElements = '';
    } catch (_) {}
  }

  function markFilledViaAi() {
    var ts = new Date().toISOString();
    try {
      if (typeof formData === 'object' && formData) formData.lawElementsFilledViaAi = ts;
    } catch (_) {}
    document.querySelectorAll('[data-ai-law-status]').forEach(function (el) {
      el.textContent =
        'Last inserted via AI — review before relying on it. Tick again only if you want a new draft (Insert required).';
      el.style.display = '';
    });
  }

  function applyLawElementsDraft(draft) {
    setField('lawElements', draft);
    markFilledViaAi();
    toast('Inserted into Law / Elements of offence — review before saving', 'success', 5000);
    hideReviewModal();
    uncheckFillBoxes();
  }

  /* Only write path into lawElements for AI fill — do not call from runFill. */
  function insertIntoLawElements() {
    var text = document.getElementById('ai-law-draft-text');
    var draft = text ? String(text.value || '').trim() : '';
    if (!draft) {
      toast('Nothing to insert', 'warning');
      return;
    }
    var existing = getField('lawElements').trim();
    if (existing) {
      confirmAsync(
        'Replace the current Law / Elements of offence text with this AI draft?',
        'Insert AI draft',
      ).then(function (ok) {
        if (ok) applyLawElementsDraft(draft);
      });
      return;
    }
    applyLawElementsDraft(draft);
  }

  function runFill() {
    if (_fillRunning) {
      toast('AI request already in progress', 'warning');
      return;
    }
    if (!window.api || typeof window.api.aiFillLawElements !== 'function') {
      toast('AI fill is not available in this build', 'error');
      uncheckFillBoxes();
      return;
    }
    var data = getOpenFormData();
    _fillRunning = true;
    toast('Requesting AI draft\u2026', 'info', 4000);
    window.api
      .aiFillLawElements({
        confirmed: true,
        formData: data,
        attendanceId: typeof currentAttendanceId !== 'undefined' ? currentAttendanceId : null,
      })
      .then(function (res) {
        _fillRunning = false;
        if (!res || !res.ok) {
          toast((res && res.error) || 'AI fill failed', 'error', 7000);
          uncheckFillBoxes();
          return;
        }
        /* Review modal only — never write lawElements here. */
        showReviewModal(res.draft, res.message || 'AI draft — review before inserting');
      })
      .catch(function (e) {
        _fillRunning = false;
        toast('AI fill failed: ' + (e && e.message ? e.message : e), 'error');
        uncheckFillBoxes();
      });
  }

  function onFillCheckboxChange(cb) {
    if (!cb.checked) return;
    var existing = getField('lawElements').trim();
    var msg =
      'Send offence name(s) and statute(s) only to OpenAI to draft actus reus, mens rea, defences and sentencing guidelines?\n\n' +
      'Client details and privileged notes are not sent. The draft opens for review only — nothing is inserted into Law / Elements until you press Insert.';
    if (existing) {
      msg +=
        '\n\nThis field already has saved text. Generating a draft will not change it until you choose Insert (you will be asked to replace).';
    }
    confirmAsync(msg, 'AI fill — Law / Elements').then(function (ok) {
      if (ok) runFill();
      else uncheckFillBoxes();
    });
  }

  /* ── Ask AI (multi-turn) ── */

  function uncheckAskBoxes() {
    document.querySelectorAll('[data-field="aiAskQuestion"]').forEach(function (cb) {
      if (cb && cb.type === 'checkbox') cb.checked = false;
    });
    try {
      if (typeof formData === 'object' && formData) formData.aiAskQuestion = '';
    } catch (_) {}
  }

  function renderAskThread() {
    var el = document.getElementById('ai-ask-thread');
    if (!el) return;
    if (!_askThread.length) {
      el.innerHTML =
        '<p class="settings-hint" style="margin:0;">Ask any question. Follow-ups stay in this session until you close.</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < _askThread.length; i++) {
      var t = _askThread[i];
      var label = t.role === 'assistant' ? 'AI' : 'You';
      var body = String(t.content || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      html +=
        '<div style="margin:0 0 0.75rem;padding:0.5rem 0.65rem;border-radius:6px;background:' +
        (t.role === 'assistant' ? 'rgba(15,23,42,0.04)' : 'rgba(37,99,235,0.06)') +
        ';">' +
        '<div style="font-size:0.75rem;font-weight:600;margin-bottom:0.25rem;">' +
        label +
        '</div>' +
        '<div style="white-space:pre-wrap;font-size:0.88rem;line-height:1.4;">' +
        body +
        '</div></div>';
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  function clearAskSession() {
    _askThread = [];
    _askSessionConfirmed = false;
    var q = document.getElementById('ai-ask-input');
    if (q) q.value = '';
    var include = document.getElementById('ai-ask-include-offences');
    if (include) include.checked = false;
    renderAskThread();
  }

  function showAskModal() {
    var modal = document.getElementById('ai-ask-modal');
    if (!modal) return;
    renderAskThread();
    modal.style.display = '';
    var q = document.getElementById('ai-ask-input');
    if (q) setTimeout(function () { q.focus(); }, 50);
  }

  function hideAskModal() {
    var modal = document.getElementById('ai-ask-modal');
    if (modal) modal.style.display = 'none';
  }

  function closeAskSession() {
    hideAskModal();
    clearAskSession();
    uncheckAskBoxes();
  }

  function lastAssistantAnswer() {
    for (var i = _askThread.length - 1; i >= 0; i--) {
      if (_askThread[i].role === 'assistant') return String(_askThread[i].content || '');
    }
    return '';
  }

  function threadAsText() {
    return _askThread
      .map(function (t) {
        return (t.role === 'assistant' ? 'AI' : 'You') + ':\n' + t.content;
      })
      .join('\n\n');
  }

  function appendLastToLawElements() {
    var answer = lastAssistantAnswer().trim();
    if (!answer) {
      toast('No AI answer to append yet', 'warning');
      return;
    }
    var existing = getField('lawElements').trim();
    var next = existing ? existing + '\n\n' + answer : answer;
    confirmAsync(
      existing
        ? 'Append the last AI answer to Law / Elements of offence?'
        : 'Insert the last AI answer into Law / Elements of offence?',
      'Append AI answer',
    ).then(function (ok) {
      if (!ok) return;
      setField('lawElements', next);
      markFilledViaAi();
      toast('Appended to Law / Elements — review before saving', 'success', 5000);
    });
  }

  function sendAskQuestion() {
    if (_askRunning) {
      toast('AI request already in progress', 'warning');
      return;
    }
    if (!window.api || typeof window.api.aiAskQuestion !== 'function') {
      toast('Ask AI is not available in this build', 'error');
      return;
    }
    var input = document.getElementById('ai-ask-input');
    var question = input ? String(input.value || '').trim() : '';
    if (!question) {
      toast('Enter a question first', 'warning');
      return;
    }

    function doSend() {
      var includeEl = document.getElementById('ai-ask-include-offences');
      var includeOffences = !!(includeEl && includeEl.checked);
      var history = _askThread.slice();
      _askRunning = true;
      toast('Sending to AI\u2026', 'info', 3000);
      var sendBtn = document.getElementById('ai-ask-send');
      if (sendBtn) sendBtn.disabled = true;
      window.api
        .aiAskQuestion({
          confirmed: true,
          question: question,
          history: history,
          includeOffences: includeOffences,
          formData: includeOffences ? getOpenFormData() : {},
          attendanceId: typeof currentAttendanceId !== 'undefined' ? currentAttendanceId : null,
        })
        .then(function (res) {
          _askRunning = false;
          if (sendBtn) sendBtn.disabled = false;
          if (!res || !res.ok) {
            toast((res && res.error) || 'Ask AI failed', 'error', 7000);
            return;
          }
          _askThread.push({ role: 'user', content: question });
          _askThread.push({ role: 'assistant', content: res.answer || '' });
          if (input) input.value = '';
          renderAskThread();
        })
        .catch(function (e) {
          _askRunning = false;
          if (sendBtn) sendBtn.disabled = false;
          toast('Ask AI failed: ' + (e && e.message ? e.message : e), 'error');
        });
    }

    if (!_askSessionConfirmed) {
      confirmAsync(
        'Send what you type (and prior questions/answers in this session) to OpenAI?\n\n' +
          'You control what is sent. Do not paste client names or privileged instructions unless you intend to.\n\n' +
          'Nothing is written into the attendance note until you Copy or Append.',
        'Ask AI',
      ).then(function (ok) {
        if (!ok) return;
        _askSessionConfirmed = true;
        doSend();
      });
      return;
    }
    doSend();
  }

  function onAskCheckboxChange(cb) {
    if (!cb.checked) {
      closeAskSession();
      return;
    }
    showAskModal();
  }

  function observeForm() {
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.matches) return;
      if (t.matches('input[data-field="aiFillLawElements"]')) {
        onFillCheckboxChange(t);
      } else if (t.matches('input[data-field="aiAskQuestion"]')) {
        onAskCheckboxChange(t);
      }
    });
  }

  function wireModals() {
    var copyBtn = document.getElementById('ai-law-draft-copy');
    var insertBtn = document.getElementById('ai-law-draft-insert');
    var closeBtn = document.getElementById('ai-law-draft-close');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var text = document.getElementById('ai-law-draft-text');
        copyText(text ? text.value : '');
      });
    }
    if (insertBtn) insertBtn.addEventListener('click', insertIntoLawElements);
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        hideReviewModal();
        uncheckFillBoxes();
      });
    }

    var askSend = document.getElementById('ai-ask-send');
    var askClose = document.getElementById('ai-ask-close');
    var askClear = document.getElementById('ai-ask-clear');
    var askCopyLast = document.getElementById('ai-ask-copy-last');
    var askCopyThread = document.getElementById('ai-ask-copy-thread');
    var askAppend = document.getElementById('ai-ask-append-law');
    var askInput = document.getElementById('ai-ask-input');
    if (askSend) askSend.addEventListener('click', sendAskQuestion);
    if (askClose) askClose.addEventListener('click', closeAskSession);
    if (askClear) {
      askClear.addEventListener('click', function () {
        clearAskSession();
        toast('Thread cleared', 'info');
      });
    }
    if (askCopyLast) {
      askCopyLast.addEventListener('click', function () {
        var a = lastAssistantAnswer();
        if (!a) toast('No AI answer yet', 'warning');
        else copyText(a);
      });
    }
    if (askCopyThread) {
      askCopyThread.addEventListener('click', function () {
        var t = threadAsText();
        if (!t) toast('Thread is empty', 'warning');
        else copyText(t);
      });
    }
    if (askAppend) askAppend.addEventListener('click', appendLastToLawElements);
    if (askInput) {
      askInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          sendAskQuestion();
        }
      });
    }
  }

  window.AiLawElements = {
    runFill: runFill,
    insertIntoLawElements: insertIntoLawElements,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      observeForm();
      wireModals();
    });
  } else {
    observeForm();
    wireModals();
  }
})();
