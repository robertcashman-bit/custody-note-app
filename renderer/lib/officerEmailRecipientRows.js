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

  function parseList(str) {
    return String(str || '').split(/[;,]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function countRecipients(toEmail, recipientName) {
    var emails = parseList(toEmail);
    var names = parseList(recipientName);
    return Math.max(emails.length, names.length, emails.length ? emails.length : 0);
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
      '<button type="button" class="officer-email-link-btn officer-email-recipient-remove" title="Remove officer">Remove</button>';
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
    var multi = container.classList.contains('officer-email-recipients-multi');
    rows.forEach(function (row) {
      var btn = row.querySelector('.officer-email-recipient-remove');
      if (!btn) return;
      var hide = !multi || rows.length <= 1;
      btn.classList.toggle('hidden', hide);
      btn.disabled = hide;
    });
  }

  /**
   * @param {HTMLElement} container
   * @param {{ prefix: string, onInput?: function, dutyCheckbox?: HTMLInputElement, multiOfficerCheckbox?: HTMLInputElement }} options
   */
  function initRecipientBlock(container, options) {
    var opts = options || {};
    var prefix = opts.prefix || 'oer';
    var multiCb = opts.multiOfficerCheckbox || null;
    var multiToggleEl = multiCb ? (multiCb.closest('label') || multiCb) : null;
    var handlers = { onInput: opts.onInput, onRemoveRow: null };
    var primaryHost;
    var extraRowsHost;
    var addBtn;

    function rows() {
      return container ? container.querySelectorAll('.officer-email-recipient-row') : [];
    }

    function appendRow(focusEmail) {
      var count = rows().length;
      var row = createRow(prefix, count, handlers);
      extraRowsHost.appendChild(row);
      syncRemoveButtons(container);
      if (focusEmail) {
        var to = row.querySelector('.officer-email-recipient-to');
        if (to && typeof to.focus === 'function') to.focus();
      }
      return row;
    }

    function trimToSingleRow() {
      var list = rows();
      for (var i = list.length - 1; i >= 1; i--) {
        list[i].remove();
      }
      syncRemoveButtons(container);
    }

    function applyMultiMode(enabled, optsApply) {
      var optionsApply = optsApply || {};
      if (multiCb) multiCb.checked = !!enabled;
      container.classList.toggle('officer-email-recipients-multi', !!enabled);
      if (addBtn) addBtn.classList.toggle('hidden', !enabled);
      if (!enabled) {
        trimToSingleRow();
      } else if (rows().length < 2) {
        appendRow(!!optionsApply.focusNew);
      }
      syncRemoveButtons(container);
    }

    handlers.onRemoveRow = function (row) {
      if (!container || !row || !primaryHost || !extraRowsHost) return;
      if (!container.classList.contains('officer-email-recipients-multi')) return;
      var list = rows();
      if (list.length <= 1) return;
      row.remove();
      syncRemoveButtons(container);
      if (typeof handlers.onInput === 'function') handlers.onInput();
    };

    container.innerHTML = '';
    primaryHost = document.createElement('div');
    primaryHost.className = 'officer-email-recipient-primary';
    extraRowsHost = document.createElement('div');
    extraRowsHost.className = 'officer-email-recipients-extra';
    container.appendChild(primaryHost);
    primaryHost.appendChild(createRow(prefix, 0, handlers));
    if (multiToggleEl) container.appendChild(multiToggleEl);
    container.appendChild(extraRowsHost);

    addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'officer-email-link-btn officer-email-add-recipient hidden';
    addBtn.textContent = '+ Add another officer';
    addBtn.addEventListener('click', function () {
      if (!container.classList.contains('officer-email-recipients-multi')) return;
      appendRow(true);
      if (typeof handlers.onInput === 'function') handlers.onInput();
    });
    container.appendChild(addBtn);

    applyMultiMode(false);

    if (multiCb) {
      multiCb.addEventListener('change', function () {
        applyMultiMode(!!multiCb.checked, { focusNew: true });
        if (typeof handlers.onInput === 'function') handlers.onInput();
      });
    }

    if (opts.dutyCheckbox) {
      opts.dutyCheckbox.checked = readDutySolicitorPreference();
      opts.dutyCheckbox.addEventListener('change', function () {
        writeDutySolicitorPreference(!!opts.dutyCheckbox.checked);
        if (typeof handlers.onInput === 'function') handlers.onInput();
      });
    }

    return {
      setValues: function (toEmail, recipientName) {
        var emails = parseList(toEmail);
        var names = parseList(recipientName);
        if (!emails.length && !names.length) {
          applyMultiMode(false);
          primaryHost.innerHTML = '';
          extraRowsHost.innerHTML = '';
          primaryHost.appendChild(createRow(prefix, 0, handlers));
          syncRemoveButtons(container);
          return;
        }
        if (!emails.length) emails = [''];
        while (names.length < emails.length) names.push('');
        var multi = emails.length > 1 || names.length > 1;
        applyMultiMode(multi);
        primaryHost.innerHTML = '';
        extraRowsHost.innerHTML = '';
        for (var i = 0; i < emails.length; i++) {
          var row = createRow(prefix, i, handlers);
          var toEl = row.querySelector('.officer-email-recipient-to');
          var nameEl = row.querySelector('.officer-email-recipient-name');
          if (toEl) toEl.value = emails[i] || '';
          if (nameEl) nameEl.value = names[i] || '';
          if (i === 0) primaryHost.appendChild(row);
          else extraRowsHost.appendChild(row);
        }
        if (multi && emails.length < 2) {
          appendRow(false);
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
      setMultiOfficerEnabled: function (enabled) {
        applyMultiMode(!!enabled);
      },
      isMultiOfficerEnabled: function () {
        return container.classList.contains('officer-email-recipients-multi');
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
    parseRecipientList: parseList,
    countStoredRecipients: countRecipients,
    initRecipientBlock: initRecipientBlock,
  };
})(typeof window !== 'undefined' ? window : globalThis);
