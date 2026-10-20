/* Shared officer recipient rows + duty solicitor checkbox for standalone and custody-note panel. */
(function (global) {
  'use strict';

  var DUTY_SESSION_KEY = 'cn-officer-email-duty-solicitor';
  /** Persisted in SQLite settings (see window.api.setSettings). */
  var OUTLOOK_SIG_SETTINGS_KEY = 'officerEmailOutlookSignatureIncludesName';

  function readDutySolicitorPreference() {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DUTY_SESSION_KEY) === '1') return true;
    } catch (_) {}
    return false;
  }

  function writeDutySolicitorPreference(checked) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(DUTY_SESSION_KEY, checked ? '1' : '0');
      }
    } catch (_) {}
  }

  function readOutlookSigPreference() {
    try {
      var s = (typeof window !== 'undefined' && window._appSettingsCache) ? window._appSettingsCache : {};
      var v = s[OUTLOOK_SIG_SETTINGS_KEY];
      if (v === true || v === 1 || v === '1' || v === 'true') return true;
    } catch (_) {}
    return false;
  }

  function writeOutlookSigPreference(checked) {
    var val = checked ? 'true' : 'false';
    try {
      if (typeof window !== 'undefined') {
        window._appSettingsCache = window._appSettingsCache || {};
        window._appSettingsCache[OUTLOOK_SIG_SETTINGS_KEY] = val;
      }
    } catch (_) {}
    try {
      if (typeof window !== 'undefined' && window.api && typeof window.api.setSettings === 'function') {
        window.api.setSettings({ officerEmailOutlookSignatureIncludesName: val }).catch(function () {});
      }
    } catch (_) {}
  }

  function bindOutlookSigCheckbox(checkbox, onInput) {
    if (!checkbox) return;
    checkbox.checked = readOutlookSigPreference();
    checkbox.addEventListener('change', function () {
      writeOutlookSigPreference(!!checkbox.checked);
      if (typeof onInput === 'function') onInput();
    });
  }

  function createRow(prefix, index, onChange) {
    var row = document.createElement('div');
    row.className = 'officer-email-recipient-row';
    row.dataset.index = String(index);
    row.innerHTML =
      '<label class="officer-email-field"><span>Recipient email</span>' +
      '<input type="text" class="officer-email-recipient-to" inputmode="email" autocomplete="off" spellcheck="false" /></label>' +
      '<label class="officer-email-field"><span>Recipient name</span>' +
      '<input type="text" class="officer-email-recipient-name" autocomplete="off" /></label>' +
      '<button type="button" class="btn btn-secondary btn-small officer-email-recipient-remove" title="Remove officer">Remove</button>';
    var toInput = row.querySelector('.officer-email-recipient-to');
    var nameInput = row.querySelector('.officer-email-recipient-name');
    var removeBtn = row.querySelector('.officer-email-recipient-remove');
    if (toInput) toInput.id = prefix + '-to-' + index;
    if (nameInput) nameInput.id = prefix + '-recipient-' + index;
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        if (typeof onChange.onRemoveRow === 'function') onChange.onRemoveRow(row);
      });
    }
    [toInput, nameInput].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', function () {
        if (typeof onChange.onInput === 'function') onChange.onInput();
      });
    });
    return row;
  }

  function syncRemoveButtons(container) {
    var rows = container.querySelectorAll('.officer-email-recipient-row');
    rows.forEach(function (row, idx) {
      var btn = row.querySelector('.officer-email-recipient-remove');
      if (!btn) return;
      btn.classList.toggle('hidden', rows.length <= 1);
      btn.disabled = rows.length <= 1;
    });
  }

  /**
   * @param {HTMLElement} container
   * @param {{ prefix: string, onInput?: function, dutyCheckbox?: HTMLInputElement }} options
   */
  function initRecipientBlock(container, options) {
    var opts = options || {};
    var prefix = opts.prefix || 'oer';
    var handlers = { onInput: opts.onInput, onRemoveRow: null };

    handlers.onRemoveRow = function (row) {
      if (!container || !row) return;
      var rows = container.querySelectorAll('.officer-email-recipient-row');
      if (rows.length <= 1) return;
      row.remove();
      syncRemoveButtons(container);
      if (typeof handlers.onInput === 'function') handlers.onInput();
    };

    container.innerHTML = '';
    container.appendChild(createRow(prefix, 0, handlers));
    syncRemoveButtons(container);

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-secondary btn-small officer-email-add-recipient';
    addBtn.textContent = 'Add another officer';
    addBtn.addEventListener('click', function () {
      var count = container.querySelectorAll('.officer-email-recipient-row').length;
      container.appendChild(createRow(prefix, count, handlers));
      syncRemoveButtons(container);
      var lastTo = container.querySelector('.officer-email-recipient-row:last-child .officer-email-recipient-to');
      if (lastTo && typeof lastTo.focus === 'function') lastTo.focus();
    });
    container.appendChild(addBtn);

    if (opts.dutyCheckbox) {
      opts.dutyCheckbox.checked = readDutySolicitorPreference();
      opts.dutyCheckbox.addEventListener('change', function () {
        writeDutySolicitorPreference(!!opts.dutyCheckbox.checked);
        if (typeof handlers.onInput === 'function') handlers.onInput();
      });
    }

    return {
      setValues: function (toEmail, recipientName) {
        var emails = String(toEmail || '').split(/[;,]/).map(function (s) { return s.trim(); }).filter(Boolean);
        var names = String(recipientName || '').split(/[;,]/).map(function (s) { return s.trim(); }).filter(Boolean);
        if (!emails.length) emails = [''];
        while (names.length < emails.length) names.push('');
        container.querySelectorAll('.officer-email-recipient-row').forEach(function (r) { r.remove(); });
        var addBtnEl = container.querySelector('.officer-email-add-recipient');
        for (var i = 0; i < emails.length; i++) {
          var row = createRow(prefix, i, handlers);
          var toEl = row.querySelector('.officer-email-recipient-to');
          var nameEl = row.querySelector('.officer-email-recipient-name');
          if (toEl) toEl.value = emails[i];
          if (nameEl) nameEl.value = names[i] || '';
          if (addBtnEl) container.insertBefore(row, addBtnEl);
          else container.appendChild(row);
        }
        syncRemoveButtons(container);
      },
      getValues: function () {
        var emails = [];
        var names = [];
        container.querySelectorAll('.officer-email-recipient-row').forEach(function (row) {
          var toEl = row.querySelector('.officer-email-recipient-to');
          var nameEl = row.querySelector('.officer-email-recipient-name');
          var em = toEl ? String(toEl.value || '').trim() : '';
          var nm = nameEl ? String(nameEl.value || '').trim() : '';
          if (!em && !nm) return;
          emails.push(em);
          names.push(nm);
        });
        return {
          toEmail: emails.join('; '),
          recipientName: names.join('; '),
        };
      },
      focusFirstEmail: function () {
        var first = container.querySelector('.officer-email-recipient-to');
        if (first && typeof first.focus === 'function') first.focus();
      },
    };
  }

  global.OfficerEmailRecipientRows = {
    DUTY_SESSION_KEY: DUTY_SESSION_KEY,
    OUTLOOK_SIG_SETTINGS_KEY: OUTLOOK_SIG_SETTINGS_KEY,
    readDutySolicitorPreference: readDutySolicitorPreference,
    writeDutySolicitorPreference: writeDutySolicitorPreference,
    readOutlookSigPreference: readOutlookSigPreference,
    writeOutlookSigPreference: writeOutlookSigPreference,
    bindOutlookSigCheckbox: bindOutlookSigCheckbox,
    initRecipientBlock: initRecipientBlock,
  };
})(typeof window !== 'undefined' ? window : globalThis);
