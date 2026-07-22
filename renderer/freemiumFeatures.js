/**
 * Freemium UI: Pro AI drafts, firm workspace settings, Anywhere bridge import.
 * Single-path IPC via window.api — no privileged work in renderer.
 */
(function () {
  'use strict';

  var _proAiAllowed = false;
  var _lastDraftKind = 'attendance';

  function toast(msg, type, ms) {
    if (typeof showToast === 'function') showToast(msg, type || 'info', ms);
  }

  function refreshProAiGateFromLicence(st) {
    var aiMsg = document.getElementById('pro-ai-gate-message');
    var btnAtt = document.getElementById('btn-pro-ai-request-draft');
    var btnInt = document.getElementById('btn-pro-ai-request-interview');
    var headerBtn = document.getElementById('header-pro-ai-draft');
    _proAiAllowed = !!(
      st &&
      st.tier === 'pro' &&
      (st.status === 'active' || st.status === 'expiring_soon' || st.status === 'grace_expired')
    );
    if (aiMsg) {
      aiMsg.textContent = _proAiAllowed
        ? 'You are on Pro. Request a local draft from an open record — nothing leaves this device unless you later enable cloud AI.'
        : 'AI summary drafts are a Pro feature. Upgrade at custodynote.com/pricing.';
    }
    [btnAtt, btnInt].forEach(function (btn) {
      if (!btn) return;
      btn.disabled = !_proAiAllowed;
      btn.title = _proAiAllowed ? '' : 'Pro required';
    });
    if (headerBtn) {
      var formOpen = !!(
        document.getElementById('view-form') &&
        document.getElementById('view-form').classList.contains('active')
      );
      headerBtn.style.display = _proAiAllowed && formOpen ? '' : 'none';
    }
  }

  function getOpenFormData() {
    try {
      if (typeof window.getFormData === 'function') return window.getFormData() || {};
      if (typeof getFormData === 'function') return getFormData() || {};
    } catch (_) {}
    return (typeof formData === 'object' && formData) || {};
  }

  function showDraftModal(draft, meta, kind) {
    _lastDraftKind = kind === 'interview' ? 'interview' : 'attendance';
    var modal = document.getElementById('pro-ai-draft-modal');
    var text = document.getElementById('pro-ai-draft-text');
    var metaEl = document.getElementById('pro-ai-draft-meta');
    if (!modal || !text) return;
    text.value = draft || '';
    if (metaEl) metaEl.textContent = meta || '';
    modal.style.display = '';
  }

  function hideDraftModal() {
    var modal = document.getElementById('pro-ai-draft-modal');
    if (modal) modal.style.display = 'none';
  }

  function requestDraft(kind) {
    if (!window.api || typeof window.api.proAiDraftSummary !== 'function') {
      toast('Pro AI is not available in this build', 'error');
      return;
    }
    if (!_proAiAllowed) {
      toast('Pro AI drafts require an active Pro licence', 'warning');
      return;
    }
    var data = getOpenFormData();
    if (!data || !Object.keys(data).length) {
      toast('Open an attendance record first, then request a draft', 'warning', 5000);
      return;
    }
    var confirmed = true;
    if (typeof showConfirm === 'function') {
      showConfirm(
        'Generate a local Pro AI draft from the open record?\n\nNothing is sent to an AI provider. The draft stays on this device for you to review and edit.',
        'Pro AI draft',
      ).then(function (ok) {
        if (ok) runDraft(kind, data);
      });
      return;
    }
    if (confirmed) runDraft(kind, data);
  }

  function runDraft(kind, data) {
    window.api
      .proAiDraftSummary({
        confirmed: true,
        kind: kind,
        formData: data,
        attendanceId: typeof currentAttendanceId !== 'undefined' ? currentAttendanceId : null,
        useCloud: false,
      })
      .then(function (res) {
        if (!res || !res.ok) {
          toast((res && res.error) || 'Could not build draft', 'error', 6000);
          return;
        }
        showDraftModal(
          res.draft,
          (res.message || 'Local draft') + (res.mode ? ' · mode=' + res.mode : ''),
          kind,
        );
      })
      .catch(function (e) {
        toast('Draft failed: ' + (e && e.message ? e.message : e), 'error');
      });
  }

  function insertDraftIntoNotes() {
    var text = document.getElementById('pro-ai-draft-text');
    var draft = text ? String(text.value || '') : '';
    if (!draft.trim()) {
      toast('Nothing to insert', 'warning');
      return;
    }
    var targetKey = _lastDraftKind === 'interview' ? 'interviewNotes' : 'outcomeNotes';
    try {
      if (typeof formData === 'object' && formData) {
        var existing = formData[targetKey] ? String(formData[targetKey]).trim() : '';
        formData[targetKey] = existing ? existing + '\n\n' + draft : draft;
      }
      if (typeof window.setFieldValue === 'function') {
        var current = '';
        try {
          if (typeof window.getFieldValue === 'function') current = String(window.getFieldValue(targetKey) || '').trim();
        } catch (_) {}
        window.setFieldValue(targetKey, current ? current + '\n\n' + draft : draft);
      } else if (typeof setFieldValue === 'function') {
        var current2 = '';
        try {
          if (typeof getFieldValue === 'function') current2 = String(getFieldValue(targetKey) || '').trim();
        } catch (_) {}
        setFieldValue(targetKey, current2 ? current2 + '\n\n' + draft : draft);
      } else {
        var el = document.getElementById(targetKey) || document.querySelector('[data-field="' + targetKey + '"]');
        if (el) {
          el.value = (el.value ? String(el.value).trim() + '\n\n' : '') + draft;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      toast('Draft inserted into ' + targetKey + ' — review before saving', 'success', 5000);
      hideDraftModal();
    } catch (e) {
      toast('Could not insert draft — copy it manually', 'warning');
    }
  }

  function renderFirmWorkspace(ws) {
    if (!ws) return;
    var nameEl = document.getElementById('firm-ws-name');
    var brandEl = document.getElementById('firm-ws-branding');
    var shareEl = document.getElementById('firm-ws-share-templates');
    var countEl = document.getElementById('firm-ws-seat-count');
    var listEl = document.getElementById('firm-ws-seats-list');
    var tplList = document.getElementById('firm-ws-tpl-list');
    if (nameEl) nameEl.value = ws.firmName || '';
    if (brandEl) brandEl.value = ws.brandingFooter || '';
    if (shareEl) shareEl.checked = ws.shareTemplatesAcrossSeats !== false;
    if (countEl) countEl.textContent = '(' + (ws.seats || []).length + ' / ' + (ws.seatLimit || 5) + ')';
    if (listEl) {
      listEl.innerHTML = '';
      (ws.seats || []).forEach(function (s) {
        var li = document.createElement('li');
        li.style.marginBottom = '0.35rem';
        li.textContent = s.email + ' (' + s.role + ') ';
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn btn-secondary btn-small';
        rm.textContent = 'Remove';
        rm.addEventListener('click', function () {
          window.api.firmWorkspaceRemoveSeat({ email: s.email }).then(function (res) {
            if (res && res.ok) renderFirmWorkspace(res.workspace);
            else toast((res && res.error) || 'Could not remove seat', 'error');
          });
        });
        li.appendChild(rm);
        listEl.appendChild(li);
      });
    }
    if (tplList) {
      tplList.innerHTML = '';
      (ws.sharedTemplates || []).forEach(function (t) {
        var li = document.createElement('li');
        li.style.marginBottom = '0.35rem';
        li.textContent = t.name + ' ';
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn btn-secondary btn-small';
        rm.textContent = 'Remove';
        rm.addEventListener('click', function () {
          window.api.firmWorkspaceRemoveTemplate({ id: t.id }).then(function (res) {
            if (res && res.ok) renderFirmWorkspace(res.workspace);
            else toast((res && res.error) || 'Could not remove template', 'error');
          });
        });
        li.appendChild(rm);
        tplList.appendChild(li);
      });
    }
  }

  function loadFirmWorkspace() {
    if (!window.api || typeof window.api.firmWorkspaceGet !== 'function') return;
    window.api.firmWorkspaceGet().then(function (res) {
      if (res && res.ok) renderFirmWorkspace(res.workspace);
    });
  }

  function wireUi() {
    var btnAtt = document.getElementById('btn-pro-ai-request-draft');
    var btnInt = document.getElementById('btn-pro-ai-request-interview');
    var headerBtn = document.getElementById('header-pro-ai-draft');
    if (btnAtt) btnAtt.addEventListener('click', function () { requestDraft('attendance'); });
    if (btnInt) btnInt.addEventListener('click', function () { requestDraft('interview'); });
    if (headerBtn) {
      headerBtn.addEventListener('click', function () {
        var data = getOpenFormData();
        var kind = data && (data.interviewNotes || data.interviewStartTime) ? 'interview' : 'attendance';
        requestDraft(kind);
      });
    }
    var copyBtn = document.getElementById('pro-ai-draft-copy');
    var insertBtn = document.getElementById('pro-ai-draft-insert');
    var closeBtn = document.getElementById('pro-ai-draft-close');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var text = document.getElementById('pro-ai-draft-text');
        var v = text ? text.value : '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(v).then(function () {
            toast('Draft copied', 'success');
          });
        } else toast(v, 'info', 10000);
      });
    }
    if (insertBtn) insertBtn.addEventListener('click', insertDraftIntoNotes);
    if (closeBtn) closeBtn.addEventListener('click', hideDraftModal);

    var saveFirm = document.getElementById('btn-firm-ws-save');
    if (saveFirm) {
      saveFirm.addEventListener('click', function () {
        window.api
          .firmWorkspaceSave({
            firmName: (document.getElementById('firm-ws-name') || {}).value,
            brandingFooter: (document.getElementById('firm-ws-branding') || {}).value,
            shareTemplatesAcrossSeats: !!(document.getElementById('firm-ws-share-templates') || {}).checked,
          })
          .then(function (res) {
            var msg = document.getElementById('firm-ws-save-msg');
            if (res && res.ok) {
              renderFirmWorkspace(res.workspace);
              if (msg) {
                msg.style.display = '';
                msg.textContent = 'Firm details saved on this device.';
              }
              toast('Firm workspace saved', 'success');
            } else toast('Could not save firm workspace', 'error');
          });
      });
    }
    var addSeat = document.getElementById('btn-firm-ws-add-seat');
    if (addSeat) {
      addSeat.addEventListener('click', function () {
        var email = (document.getElementById('firm-ws-seat-email') || {}).value;
        var role = (document.getElementById('firm-ws-seat-role') || {}).value;
        window.api.firmWorkspaceAddSeat({ email: email, role: role }).then(function (res) {
          if (res && res.ok) {
            renderFirmWorkspace(res.workspace);
            var inp = document.getElementById('firm-ws-seat-email');
            if (inp) inp.value = '';
          } else toast((res && res.error) || 'Could not add seat', 'error');
        });
      });
    }
    var addTpl = document.getElementById('btn-firm-ws-add-tpl');
    if (addTpl) {
      addTpl.addEventListener('click', function () {
        window.api
          .firmWorkspaceAddTemplate({
            name: (document.getElementById('firm-ws-tpl-name') || {}).value,
            body: (document.getElementById('firm-ws-tpl-body') || {}).value,
          })
          .then(function (res) {
            if (res && res.ok) {
              renderFirmWorkspace(res.workspace);
              var n = document.getElementById('firm-ws-tpl-name');
              var b = document.getElementById('firm-ws-tpl-body');
              if (n) n.value = '';
              if (b) b.value = '';
            } else toast((res && res.error) || 'Could not add template', 'error');
          });
      });
    }

    var anywhereBtn = document.getElementById('btn-anywhere-bridge-import');
    if (anywhereBtn) {
      anywhereBtn.addEventListener('click', function () {
        var status = document.getElementById('anywhere-bridge-status');
        if (status) status.textContent = 'Opening file picker\u2026';
        window.api.anywhereBridgeChooseAndImport().then(function (res) {
          if (res && res.cancelled) {
            if (status) status.textContent = '';
            return;
          }
          if (!res || !res.ok) {
            if (status) status.textContent = (res && res.error) || 'Import failed';
            toast((res && res.error) || 'Anywhere import failed', 'error', 6000);
            return;
          }
          var msg =
            'Imported ' +
            (res.imported || 0) +
            ' of ' +
            (res.total || 0) +
            ' Anywhere record(s) as drafts.';
          if (status) status.textContent = msg;
          toast(msg, 'success', 6000);
          try {
            if (typeof loadList === 'function') loadList();
          } catch (_) {}
        });
      });
    }

    if (window.api && typeof window.api.proAiStatus === 'function') {
      window.api.proAiStatus().then(function (gate) {
        if (gate && gate.allowed) {
          refreshProAiGateFromLicence({ tier: 'pro', status: 'active' });
        } else {
          refreshProAiGateFromLicence({ tier: 'free', status: 'active' });
        }
      });
    }
    loadFirmWorkspace();
  }

  window.FreemiumFeatures = {
    refreshProAiGateFromLicence: refreshProAiGateFromLicence,
    requestDraft: requestDraft,
    loadFirmWorkspace: loadFirmWorkspace,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireUi);
  } else {
    wireUi();
  }
})();
