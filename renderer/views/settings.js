/* ═══════════════════════════════════════════════════════
   SETTINGS VIEW  (extracted from app.js)
   Depends on: firms, firmsPage, FIRMS_PER_PAGE, LAA, esc, showToast, showConfirm (globals)
   ═══════════════════════════════════════════════════════ */

function loadSettings() {
  if (!window.api) return;
  // Refresh licence panel (trial upgrade box, key status, days remaining)
  if (typeof loadLicenceSettingsUI === 'function') loadLicenceSettingsUI();
  // Trigger System Status card diagnostics (licence, backup, update panels)
  document.dispatchEvent(new CustomEvent('view-settings-shown'));
  window.api.getSettings().then(function(s) {
    s = s || {};
    window._appSettingsCache = s;
    document.getElementById('setting-email').value = s.email || '';
    document.getElementById('setting-dscc-pin').value = s.dsccPin || '';
    document.getElementById('setting-backup-folder').value = s.backupFolder || '';
    var obf = document.getElementById('setting-offsite-backup-folder');
    if (obf) obf.value = s.offsiteBackupFolder || '';
    if (typeof refreshOffsiteBackupChooser === 'function') refreshOffsiteBackupChooser(s);
    var cloudUrlEl = document.getElementById('setting-cloud-backup-url');
    if (cloudUrlEl) cloudUrlEl.value = s.cloudBackupUrl || '';
    var cloudTokenEl = document.getElementById('setting-cloud-backup-token');
    if (cloudTokenEl) cloudTokenEl.value = s.cloudBackupToken || '';
    var forumUrlEl = document.getElementById('suggestions-forum-url');
    if (forumUrlEl) forumUrlEl.value = s.suggestionsForumUrl || '';
    var dm = document.getElementById('setting-dark-mode');
    if (dm) dm.checked = s.darkMode === 'true';
    var fs = document.getElementById('setting-font-size');
    if (fs && s.fontSize) { fs.value = s.fontSize; }
    var fv = document.getElementById('font-size-val');
    if (fv && s.fontSize) { fv.textContent = s.fontSize + 'px'; }
    var sup = document.getElementById('setting-show-supervisor-review');
    if (sup) sup.checked = s.showSupervisorReview === 'true';

    var fen = document.getElementById('setting-fee-earner-name');
    if (fen) fen.value = s.feeEarnerNameDefault || '';

    var ai = document.getElementById('setting-auto-import-enabled');
    if (ai) ai.checked = s.autoImportEnabled === 'true';
    var aif = document.getElementById('setting-auto-import-folder');
    if (aif) aif.value = s.autoImportFolder || '';

    /* Officer Email Templates add-on */
    var oetToggle = document.getElementById('setting-officer-email-templates');
    if (oetToggle) oetToggle.checked = s.officerEmailTemplatesEnabled === 'true';
    window._emailTemplatesAddonEnabled = s.officerEmailTemplatesEnabled === 'true';
    _updateAddonStatusLabel();

    // Cloud backup status – trigger fresh check when Settings opens
    var cloudBackupApplyStatus = function(status) {
      var checking = document.getElementById('cloud-backup-checking');
      var notSub = document.getElementById('cloud-backup-not-subscribed');
      var isSub = document.getElementById('cloud-backup-subscribed');
      var lastEl = document.getElementById('cloud-backup-last-success');
      var reasonEl = document.getElementById('cloud-backup-unavailable-reason');
      if (checking) checking.style.display = 'none';
      if (status && status.enabled) {
        if (notSub) notSub.style.display = 'none';
        if (isSub) isSub.style.display = '';
        if (lastEl && status.lastSuccess) {
          lastEl.textContent = 'Last successful upload: ' + new Date(status.lastSuccess).toLocaleString('en-GB');
        }
      } else {
        if (notSub) notSub.style.display = '';
        if (isSub) isSub.style.display = 'none';
        // Show why backup is unavailable — trial vs no subscription
        if (reasonEl) {
          if (status && status.isTrial) {
            reasonEl.innerHTML = 'You are on a <strong>trial licence</strong>. Cloud backup is included with paid subscriptions only. <a href="https://custodynote.com/buy" target="_blank" rel="noopener" style="color:#1e40af;">Subscribe at custodynote.com/buy</a> to enable it.';
          } else if (status && status.lastError) {
            reasonEl.textContent = 'Cloud backup verification failed: ' + status.lastError + '. Check your internet connection and try again.';
          } else {
            reasonEl.innerHTML = 'Cloud backup is included with paid subscriptions. <a href="https://custodynote.com/buy" target="_blank" rel="noopener" style="color:#1e40af;">Subscribe at custodynote.com/buy</a> then enter your licence key in Settings \u203a Licence.';
          }
        }
      }
      var errEl = document.getElementById('cloud-backup-error');
      var supportEl = document.getElementById('cloud-backup-error-support');
      if (errEl) {
        if (status && status.lastError && !status.isTrial) {
          errEl.textContent = status.lastError;
          errEl.style.display = '';
          if (supportEl) supportEl.style.display = '';
        } else {
          errEl.style.display = 'none';
          if (supportEl) supportEl.style.display = 'none';
        }
      }
    };
    if (window.api.cloudBackupCheckEntitlement) {
      window.api.cloudBackupCheckEntitlement().then(function() {
        return window.api.cloudBackupStatus ? window.api.cloudBackupStatus() : null;
      }).then(cloudBackupApplyStatus).catch(function() {
        if (window.api.cloudBackupStatus) {
          window.api.cloudBackupStatus().then(cloudBackupApplyStatus);
        }
      });
    } else if (window.api.cloudBackupStatus) {
      window.api.cloudBackupStatus().then(cloudBackupApplyStatus);
    }

  });
  if (window.api.getDbPath) {
    window.api.getDbPath().then(function(p) {
      var el = document.getElementById('settings-db-path');
      if (el) el.textContent = p || 'Unknown';
    });
  }
  var bfEl = document.getElementById('settings-backup-path-display');
  if (bfEl) {
    window.api.getSettings().then(function(s) {
      bfEl.textContent = s.backupFolder || 'Desktop (default)';
    });
  }
  var obfEl = document.getElementById('settings-offsite-backup-path-display');
  if (obfEl) {
    window.api.getSettings().then(function(s) {
      obfEl.textContent = (s.offsiteBackupFolder && s.offsiteBackupFolder.trim()) ? s.offsiteBackupFolder : 'None';
    });
  }
  var connEl = document.getElementById('settings-connectivity');
  if (connEl) {
    connEl.textContent = navigator.onLine ? 'Online' : 'Offline (app works fully without internet)';
  }
  if (window.api.isDbEncrypted) {
    var safeStorageCheck = window.api.isSafeStorageAvailable ? window.api.isSafeStorageAvailable() : Promise.resolve(true);
    Promise.all([window.api.isDbEncrypted(), safeStorageCheck]).then(function(results) {
      var enc = results[0], osProt = results[1];
      var el = document.getElementById('encryption-status');
      if (!el) return;
      if (enc && osProt) {
        el.textContent = 'Database is encrypted (AES-256-GCM) — key protected by Windows Credential Store';
        el.style.color = 'green';
      } else if (enc && !osProt) {
        el.textContent = 'Database is encrypted (AES-256-GCM) — key stored in plaintext fallback (OS protection unavailable). Setting a recovery password is strongly recommended.';
        el.style.color = '#c55';
      } else {
        el.textContent = 'Database is not yet encrypted (will encrypt on next save)';
        el.style.color = '';
      }
    });
  }
  if (window.api.hasRecoveryPassword) {
    window.api.hasRecoveryPassword().then(function(has) {
      var el = document.getElementById('recovery-status');
      if (el) el.textContent = has ? 'Recovery password is SET' : 'No recovery password set — you should set one now';
      if (el) el.style.color = has ? 'green' : '#c00';
    });
  }
  loadFirmsList();
}

function saveSettings() {
  window.api.setSettings({
    email: (document.getElementById('setting-email') || {value:''}).value.trim() || '',
    dsccPin: (document.getElementById('setting-dscc-pin') || {value:''}).value.trim() || '',
    backupFolder: (document.getElementById('setting-backup-folder') || {value:''}).value.trim() || '',
    offsiteBackupFolder: (document.getElementById('setting-offsite-backup-folder') || {value:''}).value.trim() || '',
    cloudBackupUrl: (document.getElementById('setting-cloud-backup-url') || {value:''}).value.trim() || '',
    cloudBackupToken: (document.getElementById('setting-cloud-backup-token') || {value:''}).value.trim() || '',
    feeEarnerNameDefault: (document.getElementById('setting-fee-earner-name') || {value:''}).value.trim() || '',
    suggestionsForumUrl: (document.getElementById('suggestions-forum-url') || {value:''}).value.trim() || '',
    darkMode: document.getElementById('setting-dark-mode')?.checked ? 'true' : 'false',
    fontSize: (document.getElementById('setting-font-size') || {value:'16'}).value || '16',
    showSupervisorReview: document.getElementById('setting-show-supervisor-review')?.checked ? 'true' : 'false',
    autoImportEnabled: document.getElementById('setting-auto-import-enabled')?.checked ? 'true' : 'false',
    autoImportFolder: (document.getElementById('setting-auto-import-folder') || {value:''}).value.trim() || '',
    officerEmailTemplatesEnabled: document.getElementById('setting-officer-email-templates')?.checked ? 'true' : 'false',
  }).then(function() {
    /* Sync global flag so list refreshes immediately reflect the toggle */
    window._emailTemplatesAddonEnabled = document.getElementById('setting-officer-email-templates')?.checked || false;
    _updateAddonStatusLabel();
    showToast('Settings saved', 'success');
  }).catch(function(err) {
    console.error('[Settings] Failed to save settings:', err);
    showToast('Failed to save settings — please try again', 'error');
  });
}

function loadFirmsList() {
  if (!window.api) return;
  window.api.firmsList().then(function(f) {
    firms = f;
    renderFirmsPage();
  });
}

function renderFirmsPage() {
  var container = document.getElementById('firms-list-container');
  var paginationEl = document.getElementById('firms-pagination');
  var pageInfoEl = document.getElementById('firms-page-info');
  var prevBtn = document.getElementById('firms-page-prev');
  var nextBtn = document.getElementById('firms-page-next');
  if (!container) return;
  var totalPages = Math.max(1, Math.ceil(firms.length / FIRMS_PER_PAGE));
  firmsPage = Math.min(Math.max(1, firmsPage), totalPages);
  var start = (firmsPage - 1) * FIRMS_PER_PAGE;
  var pageFirms = firms.slice(start, start + FIRMS_PER_PAGE);
  container.innerHTML = '';
  if (!firms.length) {
    var row = document.createElement('tr');
    row.innerHTML = '<td colspan="5" class="firms-empty">No firms added yet.</td>';
    container.appendChild(row);
  } else {
    pageFirms.forEach(function(firm) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="firm-name-cell">' + esc(firm.name) + '</td>' +
        '<td>' + esc(firm.contact_name || '') + '</td>' +
        '<td>' + esc(firm.contact_email || '') + '</td>' +
        '<td>' + esc(firm.contact_phone || '') + '</td>' +
        '<td class="firms-actions-col">' +
          '<button type="button" class="btn-star ' + (firm.is_default ? 'default' : '') + '" data-id="' + firm.id + '" title="Set as default">\u2605</button>' +
          '<button type="button" class="btn-small firm-del" data-id="' + firm.id + '">Remove</button>' +
        '</td>';
      tr.querySelector('.firm-del').addEventListener('click', function() {
        showConfirm('Remove ' + firm.name + '?').then(function(ok) { if (ok) window.api.firmDelete(firm.id).then(loadFirmsList); });
      });
      tr.querySelector('.btn-star').addEventListener('click', function() {
        window.api.firmSetDefault(firm.id).then(loadFirmsList);
      });
      container.appendChild(tr);
    });
  }
  if (paginationEl) paginationEl.style.display = firms.length > FIRMS_PER_PAGE ? 'flex' : 'none';
  if (pageInfoEl) pageInfoEl.textContent = totalPages > 1 ? 'Page ' + firmsPage + ' of ' + totalPages : '';
  if (prevBtn) prevBtn.disabled = firmsPage <= 1;
  if (nextBtn) nextBtn.disabled = firmsPage >= totalPages;
}

function _updateAddonStatusLabel() {
  var lbl = document.getElementById('officer-email-templates-status');
  if (!lbl) return;
  var enabled = window._emailTemplatesAddonEnabled;
  lbl.textContent = enabled ? 'Enabled' : 'Disabled';
  lbl.className   = 'addon-status ' + (enabled ? 'addon-status-on' : 'addon-status-off');
}

function addFirm() {
  var name = (document.getElementById('new-firm-name') || {}).value || '';
  name = name.trim();
  var contact = ((document.getElementById('new-firm-contact') || {}).value || '').trim();
  var phone = ((document.getElementById('new-firm-phone') || {}).value || '').trim();
  var email = ((document.getElementById('new-firm-email') || {}).value || '').trim();
  if (!name) { showToast('Enter a firm name', 'error'); return; }
  window.api.firmSave({ name: name, contact_name: contact, contact_phone: phone, contact_email: email }).then(function() {
    document.getElementById('new-firm-name').value = '';
    document.getElementById('new-firm-contact').value = '';
    document.getElementById('new-firm-phone').value = '';
    document.getElementById('new-firm-email').value = '';
    loadFirmsList();
    window.api.firmsList().then(function(f) { firms = f; });
    showToast('Firm saved', 'success');
  }).catch(function(err) {
    showToast('Failed to save firm: ' + (err && err.message ? err.message : 'Unknown error'), 'error', 5000);
  });
}
