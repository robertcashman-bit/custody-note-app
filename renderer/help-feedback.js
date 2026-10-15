/* Help & feedback dialog. Sending goes through main (window.api.feedbackSubmit). */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function resultMessage(res) {
    if (res && res.ok && !res.queued) return { tone: 'ok', text: 'Thanks, your feedback has been sent.' };
    if (res && res.ok && res.queued) {
      return { tone: 'ok', text: "You're offline or the server couldn't be reached, so it's saved on this computer and will send automatically when you're back online." };
    }
    return { tone: 'error', text: "Couldn't send: " + ((res && res.error) || 'unknown error') + '. Nothing was lost; please try again.' };
  }

  function setStatus(text, tone) {
    var el = $('help-feedback-status');
    if (!el) return;
    el.textContent = text || '';
    el.setAttribute('data-tone', tone || '');
  }

  function open() {
    var m = $('help-feedback-modal');
    if (!m) return;
    setStatus('', '');
    m.style.display = 'flex';
    var first = m.querySelector('input[name="help-feedback-type"]:checked') || m.querySelector('input[name="help-feedback-type"]');
    if (first) first.focus();
  }

  function close() {
    var m = $('help-feedback-modal');
    if (m) m.style.display = 'none';
    var b = $('help-feedback-btn');
    if (b) b.focus();
  }

  function send() {
    var btn = $('help-feedback-send');
    var typeEl = document.querySelector('input[name="help-feedback-type"]:checked');
    var input = {
      type: typeEl ? typeEl.value : '',
      message: ($('help-feedback-message') || {}).value || '',
      email: ($('help-feedback-email') || {}).value || '',
      includeLog: !!(($('help-feedback-include-log') || {}).checked),
    };
    if (!window.api || typeof window.api.feedbackSubmit !== 'function') {
      setStatus('Feedback is unavailable in this window.', 'error');
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    setStatus('', '');
    Promise.resolve(window.api.feedbackSubmit(input)).then(function (res) {
      var r = resultMessage(res);
      setStatus(r.text, r.tone);
      if (res && res.ok) {
        var msg = $('help-feedback-message');
        if (msg) msg.value = '';
      }
    }).catch(function (e) {
      setStatus("Couldn't send: " + (e && e.message ? e.message : e) + '. Please try again.', 'error');
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Send feedback'; }
    });
  }

  if (typeof document !== 'undefined') {
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#help-feedback-btn')) { open(); return; }
    if (t.closest('#help-feedback-close')) { close(); return; }
    if (t.closest('#help-feedback-send')) { send(); return; }
    if (t.id === 'help-feedback-modal') close();
  });
  document.addEventListener('keydown', function (e) {
    var m = $('help-feedback-modal');
    if (e.key === 'Escape' && m && m.style.display !== 'none') close();
  });
  }

  if (typeof window !== 'undefined') window.HelpFeedback = { open: open, close: close, resultMessage: resultMessage };
  if (typeof module !== 'undefined' && module.exports) module.exports = { resultMessage: resultMessage };
})();
