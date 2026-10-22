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

function followUpAttendance(sourceId) {
  if (!window.api || !window.api.attendanceGet || !window.api.attendanceSave) return;
  if (typeof followUpAttendanceData !== 'function') {
    showToast('Follow-up attendance is not available. Please refresh the app.', 'error');
    return;
  }
  showFollowUpReasonChooser().then(function (reasonCode) {
    if (!reasonCode) return;
    window.api.attendanceGet(sourceId).then(function (row) {
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
      window.api.attendanceSave({ id: null, data: newData, status: 'draft' }).then(function (saveResult) {
        if (saveResult && typeof saveResult === 'object' && saveResult.error) {
          showToast((saveResult.message || saveResult.error) ? String(saveResult.message || saveResult.error) : 'Could not save follow-up', 'error');
          return;
        }
        var newId = parseAttendanceSaveId(saveResult);
        if (newId == null || isNaN(newId)) {
          showToast('Could not create follow-up record', 'error');
          return;
        }
        var updatedSource = typeof appendFollowUpIdToSourceData === 'function'
          ? appendFollowUpIdToSourceData(src, newId)
          : (function () {
            var s = JSON.parse(JSON.stringify(src));
            s._followUpAttendanceIds = s._followUpAttendanceIds || [];
            if (s._followUpAttendanceIds.indexOf(newId) === -1) s._followUpAttendanceIds.push(newId);
            return s;
          })();
        window.api.attendanceSave({
          id: sourceId,
          data: updatedSource,
          status: row.status || 'draft',
        }).then(function () {
          console.log('[FOLLOW-UP] linked source id=' + sourceId + ' -> new id=' + newId);
        }).catch(function (err) {
          console.warn('[FOLLOW-UP] source link save failed id=' + sourceId, err && err.message);
        });

        try {
          if (typeof window._recordCache !== 'undefined' && window._recordCache) {
            window._recordCache.delete(newId);
            window._recordCache.delete(sourceId);
          }
        } catch (_) {}

        if (reasonCode === 'identification') {
          openFollowUpAttendanceRecord(newId, 'videoIdParadeStandalone');
        } else {
          openFollowUpAttendanceRecord(newId, null);
        }
        showToast('Follow-up draft created — complete this visit\'s details.', 'success');
        if (typeof window.refreshList === 'function') window.refreshList();
      }).catch(function () {
        showToast('Failed to create follow-up record', 'error');
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

window.followUpAttendance = followUpAttendance;
