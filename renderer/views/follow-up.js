/* Follow-up attendance — same client, further visit (renderer orchestration). */

function showFollowUpReasonChooser() {
  return new Promise(function (resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'attendance-picker-overlay';
    var reasons = (typeof FOLLOW_UP_REASON_CODES === 'object' && FOLLOW_UP_REASON_CODES)
      ? FOLLOW_UP_REASON_CODES
      : {
        bail_return: 'Bail return',
        rui_return: 'RUI return',
        identification: 'Identification procedure',
        other: 'Other further attendance',
      };
    var buttons = Object.keys(reasons).map(function (code) {
      return '<button type="button" class="btn btn-secondary follow-up-reason-btn" data-reason="' + esc(code) + '" style="width:100%;margin-bottom:0.5rem;text-align:left;">'
        + esc(reasons[code]) + '</button>';
    }).join('');
    overlay.innerHTML =
      '<div class="sections-index-content" style="max-width:420px;width:92%;">' +
        '<h3 style="margin-top:0;">Follow-up attendance</h3>' +
        '<p class="attendance-picker-hint">Why is the client returning? A new draft will copy client and matter details from this record.</p>' +
        buttons +
        '<button type="button" class="btn btn-secondary" id="follow-up-cancel" style="width:100%;margin-top:0.25rem;">Cancel</button>' +
      '</div>';
    document.body.appendChild(overlay);

    function cleanup(val) {
      try { overlay.remove(); } catch (_) {}
      resolve(val);
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) cleanup(null);
    });
    overlay.querySelector('#follow-up-cancel')?.addEventListener('click', function () { cleanup(null); });
    overlay.querySelectorAll('.follow-up-reason-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        cleanup(btn.getAttribute('data-reason'));
      });
    });
  });
}

function parseAttendanceSaveId(result) {
  if (result == null) return null;
  if (typeof result === 'number') return result;
  if (typeof result === 'string') return parseInt(result, 10);
  if (result && typeof result === 'object') {
    if (result.error) return null;
    if (result.id != null) {
      return typeof result.id === 'number' ? result.id : parseInt(result.id, 10);
    }
  }
  return null;
}

function flushSourceIfOpenOnForm(sourceId) {
  if (String(typeof currentAttendanceId !== 'undefined' ? currentAttendanceId : '') !== String(sourceId)) {
    return Promise.resolve();
  }
  if (typeof window.flushOpenRecordAutosaveBeforeExternalRead === 'function') {
    return window.flushOpenRecordAutosaveBeforeExternalRead();
  }
  return Promise.resolve();
}

function writeFollowUpBackLink(sourceId, newId) {
  return flushSourceIfOpenOnForm(sourceId).then(function () {
    return window.api.attendanceGet(sourceId);
  }).then(function (freshRow) {
    if (!freshRow) return;
    var plan = typeof planFollowUpBackLinkSave === 'function'
      ? planFollowUpBackLinkSave(freshRow, newId)
      : null;
    if (!plan || !plan.write) {
      console.log('[FOLLOW-UP] back-link skipped for source id=' + sourceId);
      return;
    }
    if (String(typeof currentAttendanceId !== 'undefined' ? currentAttendanceId : '') === String(sourceId)
      && typeof formData !== 'undefined'
      && typeof syncFollowUpIdsOntoOpenFormData === 'function') {
      syncFollowUpIdsOntoOpenFormData(formData, plan.data);
    }
    return window.api.attendanceSave({
      id: sourceId,
      data: plan.data,
      status: plan.status,
    }).then(function (res) {
      if (res && typeof res === 'object' && res.error) {
        console.warn('[FOLLOW-UP] source link save rejected id=' + sourceId, res.error);
        return;
      }
      console.log('[FOLLOW-UP] linked source id=' + sourceId + ' -> new id=' + newId);
    });
  }).catch(function (err) {
    console.warn('[FOLLOW-UP] source link save failed id=' + sourceId, err && err.message);
  });
}

function followUpAttendance(sourceId) {
  if (!window.api || !window.api.attendanceGet || !window.api.attendanceSave) return;
  if (typeof followUpAttendanceData !== 'function') {
    showToast('Follow-up attendance is not available. Please refresh the app.', 'error');
    return;
  }
  showFollowUpReasonChooser().then(function (reasonCode) {
    if (!reasonCode) return;
    flushSourceIfOpenOnForm(sourceId).then(function () {
      return window.api.attendanceGet(sourceId);
    }).then(function (row) {
      if (!row || !row.data) {
        showToast('Could not load record for follow-up', 'error');
        return;
      }
      var src = safeJson(row.data);
      if (src._formType === 'telephone') {
        showToast('Follow-up is for station attendance notes. Open the custody record instead.', 'info', 6000);
        return;
      }
      var newData = followUpAttendanceData(src, sourceId, reasonCode);
      console.log('[FOLLOW-UP] creating draft from attendance id=' + sourceId + ' reason=' + reasonCode);
      return window.api.attendanceSave({ id: null, data: newData, status: 'draft' }).then(function (saveResult) {
        if (saveResult && typeof saveResult === 'object' && saveResult.error) {
          showToast((saveResult.message || saveResult.error) ? String(saveResult.message || saveResult.error) : 'Could not save follow-up', 'error');
          return;
        }
        var newId = parseAttendanceSaveId(saveResult);
        if (newId == null || isNaN(newId)) {
          showToast('Could not create follow-up record', 'error');
          return;
        }
        return writeFollowUpBackLink(sourceId, newId).then(function () {
          try {
            if (typeof window._recordCache !== 'undefined' && window._recordCache) {
              window._recordCache.delete(newId);
              window._recordCache.delete(sourceId);
            }
          } catch (_) {}

          hideFurtherVisitLookupPrompt();
          if (reasonCode === 'identification') {
            openFollowUpAttendanceRecord(newId, 'videoIdParadeStandalone');
          } else {
            openFollowUpAttendanceRecord(newId, null);
          }
          showToast('Follow-up draft created — complete this visit\'s details.', 'success');
          if (typeof window.refreshList === 'function') window.refreshList();
        });
      });
    }).catch(function () {
      showToast('Failed to load record for follow-up', 'error');
    });
  });
}

function openFollowUpAttendanceRecord(id, standaloneSectionId) {
  if (standaloneSectionId) window._pendingOpenStandaloneSectionId = standaloneSectionId;
  if (typeof openAttendance === 'function') {
    openAttendance(id, standaloneSectionId ? { standaloneSectionId: standaloneSectionId } : undefined);
    return;
  }
  currentAttendanceId = id;
  if (standaloneSectionId && typeof currentStandaloneSectionId !== 'undefined') {
    currentStandaloneSectionId = standaloneSectionId;
  }
  window.api.attendanceGet(id).then(function (row) {
    currentRecordStatus = row ? row.status : null;
    currentRecordArchived = !!(row && row.archived_at);
    formData = row && row.data ? safeJson(row.data) : {};
    currentSectionIdx = 0;
    renderForm(formData);
    if (typeof navigateTo === 'function') navigateTo('new'); else showView('new');
  }).catch(function () {
    showToast('Failed to open follow-up record', 'error');
  });
}

var _followUpSearchRowsCache = null;
var _followUpSearchDebounce = null;

function loadAttendanceRowsForFollowUp() {
  if (_followUpSearchRowsCache) return Promise.resolve(_followUpSearchRowsCache);
  var listFn = window.api && (window.api.attendanceListFull || window.api.attendanceList);
  if (!listFn) return Promise.resolve([]);
  return listFn().then(function (rows) {
    _followUpSearchRowsCache = rows || [];
    return _followUpSearchRowsCache;
  });
}

function renderFollowUpSearchList(listEl, hits, onPick) {
  if (!listEl) return;
  if (!hits.length) {
    listEl.innerHTML = '<li class="home-recent-empty">No matching station attendances. Try another spelling, UFN, or DOB.</li>';
    return;
  }
  listEl.innerHTML = hits.map(function (hit) {
    var r = hit.row;
    var d = hit.data;
    var primary = typeof formatFollowUpPickerPrimary === 'function'
      ? formatFollowUpPickerPrimary(d)
      : ((d.surname || '') + ', ' + (d.forename || '')).replace(/^,\s*|,\s*$/g, '');
    var meta = typeof formatFollowUpPickerMeta === 'function'
      ? formatFollowUpPickerMeta(d, r)
      : '';
    return '<li class="attendance-picker-item" data-id="' + esc(String(r.id)) + '">'
      + '<span class="picker-item-name">' + esc(primary) + '</span>'
      + '<span class="picker-item-meta">' + esc(meta) + '</span></li>';
  }).join('');
  listEl.querySelectorAll('.attendance-picker-item').forEach(function (li) {
    li.addEventListener('click', function () {
      var id = parseInt(li.getAttribute('data-id'), 10);
      if (!isNaN(id) && onPick) onPick(id);
    });
  });
}

function openFollowUpPickFromMatches(matches) {
  if (!matches || !matches.length) return;
  var overlay = document.createElement('div');
  overlay.className = 'attendance-picker-overlay';
  overlay.innerHTML =
    '<div class="sections-index-content attendance-picker-content" style="max-width:480px;">' +
      '<h3 style="margin-top:0;">Choose attendance</h3>' +
      '<p class="attendance-picker-hint">Select which previous visit to copy case details from.</p>' +
      '<ul class="attendance-picker-list" data-role="list"></ul>' +
      '<button type="button" class="btn btn-secondary attendance-picker-cancel" style="margin-top:0.75rem;width:100%;">Cancel</button>' +
    '</div>';
  document.body.appendChild(overlay);
  var listEl = overlay.querySelector('[data-role="list"]');
  function close() { try { overlay.remove(); } catch (_) {} }
  renderFollowUpSearchList(listEl, matches, function (id) {
    close();
    followUpAttendance(id);
  });
  overlay.querySelector('.attendance-picker-cancel').addEventListener('click', close);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
}

function openFollowUpSearchPicker(opts) {
  opts = opts || {};
  if (!window.api) {
    showToast('Follow-up search is not available', 'error');
    return;
  }
  if (typeof filterAttendanceRowsForFollowUpSearch !== 'function') {
    showToast('Follow-up attendance is not available. Please refresh the app.', 'error');
    return;
  }
  var minLen = (typeof FOLLOW_UP_SEARCH_MIN_LEN === 'number') ? FOLLOW_UP_SEARCH_MIN_LEN : 2;
  var overlay = document.createElement('div');
  overlay.className = 'attendance-picker-overlay';
  overlay.setAttribute('aria-label', 'Find client for follow-up');
  overlay.innerHTML =
    '<div class="sections-index-content attendance-picker-content" style="max-width:480px;">' +
      '<h3 style="margin-top:0;">Bail return / follow-up</h3>' +
      '<p class="attendance-picker-hint">Search past <strong>station</strong> attendances by client name, date of birth, or UFN (at least ' + minLen + ' characters). Pick a record, then choose why they are returning.</p>' +
      '<input type="search" class="follow-up-search-input" id="follow-up-search-input" placeholder="e.g. Smith, 1990-01-15, or 010125/001" autocomplete="off" />' +
      '<ul class="attendance-picker-list" data-role="list"></ul>' +
      '<p class="attendance-picker-hint" data-role="empty-hint">Type to search. If this is a brand-new client, use <strong>Custody Attendance</strong> on Home instead.</p>' +
      '<button type="button" class="btn btn-secondary attendance-picker-cancel" style="margin-top:0.75rem;width:100%;">Cancel</button>' +
    '</div>';
  document.body.appendChild(overlay);

  var listEl = overlay.querySelector('[data-role="list"]');
  var inputEl = overlay.querySelector('#follow-up-search-input');
  var emptyHint = overlay.querySelector('[data-role="empty-hint"]');
  listEl.innerHTML = '<li class="home-recent-empty">Loading records\u2026</li>';

  function close() {
    try { overlay.remove(); } catch (_) {}
  }

  function pick(id) {
    close();
    if (typeof followUpAttendance === 'function') followUpAttendance(id);
    else if (opts.onSelect) opts.onSelect(id);
  }

  overlay.querySelector('.attendance-picker-cancel').addEventListener('click', close);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

  function runSearch(q) {
    loadAttendanceRowsForFollowUp().then(function (rows) {
      var hits = filterAttendanceRowsForFollowUpSearch(rows, q, safeJson);
      if (!q || q.length < minLen) {
        listEl.innerHTML = '<li class="home-recent-empty">Enter at least ' + minLen + ' characters to search.</li>';
        if (emptyHint) emptyHint.style.display = '';
        return;
      }
      if (emptyHint) emptyHint.style.display = hits.length ? 'none' : '';
      renderFollowUpSearchList(listEl, hits, pick);
    }).catch(function () {
      listEl.innerHTML = '<li class="home-recent-empty">Could not load attendances.</li>';
    });
  }

  inputEl.addEventListener('input', function () {
    clearTimeout(_followUpSearchDebounce);
    var val = inputEl.value;
    _followUpSearchDebounce = setTimeout(function () { runSearch(val); }, 250);
  });
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  loadAttendanceRowsForFollowUp().then(function () {
    listEl.innerHTML = '<li class="home-recent-empty">Enter at least ' + minLen + ' characters to search.</li>';
    inputEl.focus();
    if (opts.initialQuery && String(opts.initialQuery).length >= minLen) {
      inputEl.value = opts.initialQuery;
      runSearch(opts.initialQuery);
    }
  });
}

var _furtherVisitPromptEl = null;

function hideFurtherVisitLookupPrompt() {
  if (_furtherVisitPromptEl && _furtherVisitPromptEl.parentNode) {
    try { _furtherVisitPromptEl.remove(); } catch (_) {}
  }
  _furtherVisitPromptEl = null;
}

function showFurtherVisitLookupPrompt(matches) {
  hideFurtherVisitLookupPrompt();
  if (!matches || !matches.length) return;
  var anchor = document.querySelector('.name-row-group');
  if (!anchor || !anchor.parentNode) return;

  var box = document.createElement('div');
  box.className = 'follow-up-lookup-prompt';
  box.setAttribute('role', 'note');
  var msg = document.createElement('p');
  msg.textContent = 'Is this a further visit on an existing case? Copy case details from their last attendance.';
  box.appendChild(msg);

  var actions = document.createElement('div');
  actions.className = 'follow-up-lookup-prompt-actions';

  function startFromId(id) {
    hideFurtherVisitLookupPrompt();
    followUpAttendance(id);
  }

  if (matches.length === 1) {
    var btnOne = document.createElement('button');
    btnOne.type = 'button';
    btnOne.className = 'btn btn-small';
    btnOne.textContent = 'Start follow-up from last attendance';
    btnOne.addEventListener('click', function () { startFromId(matches[0].row.id); });
    actions.appendChild(btnOne);
  } else {
    var btnChoose = document.createElement('button');
    btnChoose.type = 'button';
    btnChoose.className = 'btn btn-small';
    btnChoose.textContent = 'Choose which attendance to copy from (' + matches.length + ')';
    btnChoose.addEventListener('click', function () {
      hideFurtherVisitLookupPrompt();
      openFollowUpPickFromMatches(matches);
    });
    actions.appendChild(btnChoose);
  }

  var dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'btn btn-secondary btn-small';
  dismiss.textContent = 'Not now';
  dismiss.addEventListener('click', hideFurtherVisitLookupPrompt);
  actions.appendChild(dismiss);

  box.appendChild(actions);
  anchor.parentNode.insertBefore(box, anchor.nextSibling);
  _furtherVisitPromptEl = box;
}

function maybeOfferFurtherVisitFromClientLookup(clientData) {
  if (!clientData || typeof filterStationAttendancesForClientIdentity !== 'function') return;
  if (formData && formData._formType === 'telephone') return;
  var excludeId = (typeof currentAttendanceId !== 'undefined') ? currentAttendanceId : null;
  loadAttendanceRowsForFollowUp().then(function (rows) {
    var matches = filterStationAttendancesForClientIdentity(rows, clientData, safeJson, excludeId);
    if (matches.length < 1) return;
    showFurtherVisitLookupPrompt(matches);
  }).catch(function () { /* ignore */ });
}

window.followUpAttendance = followUpAttendance;
window.openFollowUpSearchPicker = openFollowUpSearchPicker;
window.maybeOfferFurtherVisitFromClientLookup = maybeOfferFurtherVisitFromClientLookup;
window.hideFurtherVisitLookupPrompt = hideFurtherVisitLookupPrompt;

if (window.api && window.api.onRecordsUpdatedFromSync) {
  window.api.onRecordsUpdatedFromSync(function () {
    _followUpSearchRowsCache = null;
  });
}
