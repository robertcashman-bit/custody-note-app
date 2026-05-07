/* ═══════════════════════════════════════════════════════
   LIST VIEW  (extracted from app.js)
   Uses server-side attendanceSearch for search / sort / pagination.
   Depends on: listPage, LIST_PER_PAGE, formData, currentAttendanceId, currentSectionIdx,
               safeJson, esc, showToast, showConfirm, renderForm, showView,
               prefillDefaults (app.js globals)
   ═══════════════════════════════════════════════════════ */

var listStatusFilter = 'all';
var listSortMode = 'newest';
var listTypeFilter = 'all';

/* Map UI sort mode to attendanceSearch params */
function _listSortParams() {
  switch (listSortMode) {
    case 'oldest':    return { sortField: 'updated_at',    sortDir: 'ASC' };
    case 'name':      return { sortField: 'client_name',   sortDir: 'ASC' };
    case 'station':   return { sortField: 'station_name',  sortDir: 'ASC' };
    case 'date':      return { sortField: 'attendance_date', sortDir: 'DESC' };
    case 'date-asc':  return { sortField: 'attendance_date', sortDir: 'ASC' };
    default:          return { sortField: 'updated_at',    sortDir: 'DESC' };
  }
}

function refreshList() {
  var ul = document.getElementById('attendance-list');
  if (!ul || !window.api) return;

  var q = ((document.getElementById('list-search') || {}).value || '').trim();
  var sort = _listSortParams();

  var isDeletedView = listStatusFilter === 'deleted';
  var searchParams = {
    query: q || '',
    status: (listStatusFilter === 'archived' || isDeletedView) ? '' : (listStatusFilter === 'all' ? '' : listStatusFilter),
    archived: listStatusFilter === 'archived',
    deleted: isDeletedView,
    workType: listTypeFilter === 'all' ? '' : listTypeFilter,
    page: listPage,
    pageSize: LIST_PER_PAGE,
    sortField: sort.sortField,
    sortDir: sort.sortDir,
  };
  window.api.attendanceSearch(searchParams).then(function(result) {
    var rows = (result && result.rows) || [];
    var total = (result && result.total) || 0;
    if (result && result.page) listPage = result.page;

    ul.innerHTML = '';
    if (!rows.length) {
      if (total > 0 && listPage > 1) {
        listPage = 1;
        refreshList();
        return;
      }
      ul.innerHTML = '<li class="empty-state"><p>No attendances found. Click \u201cNew Attendance\u201d to start.</p></li>';
      renderListPagination(0);
      return;
    }

    rows.forEach(function(r) {
      var d = safeJson(r.data);
      var nameFromJson = [d.surname, d.forename].filter(Boolean).join(', ');
      var title = (r.client_name && String(r.client_name).trim()) || nameFromJson || 'Draft (no name)';

      var rawDate = r.attendance_date || d.date || (r.updated_at ? String(r.updated_at).slice(0, 10) : '');
      var dateLabel = '';
      if (rawDate) {
        var dm = String(rawDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (dm) { dateLabel = dm[3] + '/' + dm[2] + '/' + dm[1]; }
        else { dateLabel = rawDate; }
      }

      var stationLabel = r.station_name || d.policeStationName || '';
      var dsccLabel = r.dscc_ref || d.dsccRef || '';
      var metaParts = [];
      if (dateLabel)    metaParts.push(dateLabel);
      if (stationLabel) metaParts.push(stationLabel);
      if (dsccLabel)    metaParts.push(dsccLabel);
      var meta = metaParts.join(' \u00B7 ');

      var hasInvoice = !!(d.quickfile_invoice_id || d.quickfileInvoiceNumber || d.quickfileInvoiceUrl);
      var st = r.status || 'draft';
      var statusTitle = hasInvoice
        ? 'Invoiced: a QuickFile invoice is linked to this record. The note stays finalised for the legal record.'
        : (st === 'finalised'
          ? 'Finalised: the attendance note is locked. Use Edit to re-open for amendment if you need changes.'
          : (st === 'completed'
            ? 'Completed: marked complete in your workflow (e.g. after billing steps).'
            : 'Draft: editable. Save and finalise when the attendance is complete.'));

      var approved = r.supervisor_approved_at
        ? ' <span class="badge supervisor-approved" title="Supervisor approved">&#10003; Approved</span>' : '';
      var archivedBadge = r.archived_at
        ? ' <span class="badge archived" title="Archived">Archived</span>' : '';
      var deletedBadge = r.deleted_at
        ? ' <span class="badge deleted" title="Deleted">Deleted</span>' : '';
      var archiveBtn = r.archived_at
        ? '<button type="button" class="btn-list-action unarchive-btn" title="Restore from archive — record returns to the main Records list" data-id="' + esc(String(r.id)) + '">Unarchive</button>'
        : '<button type="button" class="btn-list-action archive-btn" title="Hide from main list — use Archived filter to find later" data-id="' + esc(String(r.id)) + '">Archive</button>';

      var li = document.createElement('li');
      if (isDeletedView) {
        li.innerHTML =
          '<div class="list-item-text">' +
            '<span class="title">' + esc(title) + '</span>' +
            '<div class="meta">' + esc(meta) + (r.deletion_reason ? ' \u00B7 ' + esc(r.deletion_reason) : '') + '</div>' +
          '</div>' +
          '<div class="list-item-actions">' +
            '<div class="list-item-badges">' +
              '<span class="badge deleted">Deleted</span>' +
            '</div>' +
            '<div class="list-item-btns" role="group" aria-label="Record actions">' +
              '<button type="button" class="btn-list-action restore-btn" title="Restore this record" data-id="' + esc(String(r.id)) + '">Restore</button>' +
            '</div>' +
          '</div>';
      } else {
        li.innerHTML =
          '<div class="list-item-text">' +
            '<span class="title">' + esc(title) + '</span>' +
            '<div class="meta">' + esc(meta) + '</div>' +
          '</div>' +
          '<div class="list-item-actions">' +
            '<div class="list-item-badges">' +
              '<span class="badge ' + esc(st) + '" title="' + esc(statusTitle) + '">' + esc(st) + '</span>' +
              approved +
              archivedBadge +
            '</div>' +
            '<div class="list-item-btns" role="group" aria-label="Record actions">' +
              archiveBtn +
              '<button type="button" class="btn-list-action amend-btn" title="Open record to edit (amend)" data-id="' + esc(String(r.id)) + '">Edit</button>' +
              '<button type="button" class="btn-list-action dup-btn" title="Duplicate for another client (same session)" data-id="' + esc(String(r.id)) + '">Duplicate</button>' +
              '<button type="button" class="btn-list-action pdf-btn" title="Export PDF to Desktop" data-id="' + esc(String(r.id)) + '">PDF</button>' +
              '<button type="button" class="btn-list-action delete-btn" title="Delete this record" data-id="' + esc(String(r.id)) + '">Delete</button>' +
            '</div>' +
          '</div>';
      }

      if (isDeletedView) {
        var restoreBtn = li.querySelector('.restore-btn');
        if (restoreBtn) {
          restoreBtn.addEventListener('click', function(e) { e.stopPropagation(); restoreDeletedAttendance(r.id, title); });
        }
      } else {
        li.querySelector('.list-item-text').addEventListener('click', function() { openAttendance(r.id); });
        li.querySelector('.amend-btn').addEventListener('click', function(e) { e.stopPropagation(); amendAttendance(r.id, r.status, title); });
        li.querySelector('.dup-btn').addEventListener('click', function(e) { e.stopPropagation(); duplicateAttendance(r.id); });
        li.querySelector('.pdf-btn').addEventListener('click', function(e) {
          e.stopPropagation();
          if (typeof window.exportPdfById === 'function') {
            window.exportPdfById(r.id);
          } else {
            openAttendance(r.id);
          }
        });
        li.querySelector('.delete-btn').addEventListener('click', function(e) { e.stopPropagation(); deleteAttendance(r.id, title); });
        if (r.archived_at && li.querySelector('.unarchive-btn')) {
          li.querySelector('.unarchive-btn').addEventListener('click', function(e) { e.stopPropagation(); unarchiveAttendance(r.id); });
        } else if (!r.archived_at && li.querySelector('.archive-btn')) {
          li.querySelector('.archive-btn').addEventListener('click', function(e) { e.stopPropagation(); archiveAttendance(r.id, title); });
        }
      }
      ul.appendChild(li);
    });

    renderListPagination(total);
  }).catch(function(err) {
    console.error('[List] attendanceSearch failed:', err);
    ul.innerHTML = '<li class="empty-state"><p>Failed to load records. Please restart the app.</p></li>';
    renderListPagination(0);
  });
}

function renderListPagination(total) {
  var pag = document.getElementById('list-pagination');
  if (!pag) return;
  var totalPages = Math.ceil(total / LIST_PER_PAGE);
  if (totalPages <= 1) { pag.style.display = 'none'; return; }
  pag.style.display = '';
  document.getElementById('list-page-info').textContent = 'Page ' + listPage + ' of ' + totalPages + ' (' + total + ' records)';
  document.getElementById('list-page-prev').disabled = listPage <= 1;
  document.getElementById('list-page-next').disabled = listPage >= totalPages;
}

function archiveAttendance(id, title) {
  var label = title || 'this record';
  showConfirm(
    'Archive "' + label + '"?\n\nThe record will be hidden from the main Records list. Open the Archived filter to find it again, or use Unarchive to restore it to the main list.',
    'Archive record'
  ).then(function (ok) {
    if (!ok) return;
    /* Delay the actual archive call by 5 seconds to allow undo */
    var undone = false;
    var toast = document.createElement('div');
    toast.className = 'cn-toast cn-toast-visible cn-toast-info cn-undo-toast';
    toast.innerHTML = 'Archiving in 5s&hellip; <button class="cn-undo-btn" type="button">Undo</button>';
    document.body.appendChild(toast);
    toast.querySelector('.cn-undo-btn').addEventListener('click', function () {
      undone = true;
      toast.remove();
      showToast('Archive cancelled', 'success');
    });
    var timer = setTimeout(function () {
      toast.remove();
      if (undone) return;
      window.api.attendanceArchive(id).then(function () {
        refreshList();
      }).catch(function () {
        showToast('Failed to archive record', 'error');
      });
    }, 5000);
    void timer;
  });
}

function unarchiveAttendance(id) {
  window.api.attendanceUnarchive(id).then(function() {
    showToast('Record restored from archive', 'info');
    refreshList();
  }).catch(function() {
    showToast('Failed to unarchive record', 'error');
  });
}

function deleteAttendance(id, title) {
  showConfirm('Delete "' + title + '"?\n\nThis soft-deletes the record: it leaves the main list and appears under the Deleted filter. You can restore it from there while it remains in your database.', 'Confirm delete').then(function(ok) {
    if (!ok) return;
    window.api.attendanceDelete({ id: id, reason: 'User deleted from list' }).then(function(result) {
      if (result && result.soft) showToast('Record moved to Deleted list', 'info');
      else showToast('Record deleted', 'info');
      refreshList();
    }).catch(function() {
      showToast('Failed to delete record', 'error');
    });
  });
}

function restoreDeletedAttendance(id, title) {
  if (!window.api || !window.api.attendanceUndelete) {
    showToast('Restore not available in this version', 'error');
    return;
  }
  window.api.attendanceUndelete(id).then(function(ok) {
    if (ok) {
      showToast('"' + title + '" restored', 'success');
      refreshList();
    } else {
      showToast('Failed to restore record', 'error');
    }
  }).catch(function() {
    showToast('Failed to restore record', 'error');
  });
}

function duplicateAttendance(id) {
  if (!window.api || !window.api.attendanceGet || !window.api.attendanceSave) return;
  if (typeof duplicateAttendanceData !== 'function') {
    showToast('Duplicate is not available. Please refresh the app.', 'error');
    return;
  }
  window.api.attendanceGet(id).then(function(row) {
    if (!row || !row.data) { showToast('Could not load record to duplicate', 'error'); return; }
    var src = safeJson(row.data);
    if (src._formType === 'telephone') {
      showToast('Duplicate is for station attendance notes. Use New attendance for telephone advice.', 'info', 6000);
      return;
    }
    var newData = duplicateAttendanceData(src, id);
    window.api.attendanceSave({ id: null, data: newData, status: 'draft' }).then(function(result) {
      if (result && typeof result === 'object' && result.error) {
        showToast((result.message || result.error) ? String(result.message || result.error) : 'Could not save duplicate', 'error');
        return;
      }
      if (result == null) {
        showToast('Could not create duplicate record', 'error');
        return;
      }
      var numericId = typeof result === 'number' ? result : parseInt(result, 10);
      if (isNaN(numericId)) {
        showToast('Could not create duplicate record', 'error');
        return;
      }
      /* Photos are NOT copied to the new draft (per duplicate policy):
         the cloned `data` already has `photos` cleared, and the encrypted
         files belong to the original client. New client starts with an
         empty photo set. */
      try {
        if (typeof window._recordCache !== 'undefined' && window._recordCache && window._recordCache.delete) {
          window._recordCache.delete(numericId);
        }
      } catch (e) { /* ignore */ }
      openAttendance(numericId);
      showToast('Attendance duplicated – please complete client details.', 'success');
      try { if (typeof refreshList === 'function') refreshList(); } catch (e2) { /* ignore */ }
    }).catch(function() {
      showToast('Failed to duplicate record', 'error');
    });
  }).catch(function() {
    showToast('Failed to load record to duplicate', 'error');
  });
}

function openAttendance(id) {
  currentAttendanceId = id;
  window.api.attendanceGet(id).then(function(row) {
    currentRecordStatus = row ? row.status : null;
    currentRecordArchived = !!(row && row.archived_at);
    formData = row && row.data ? safeJson(row.data) : {};
    currentSectionIdx = 0;
    renderForm(formData);
    if (typeof navigateTo === 'function') navigateTo('new'); else showView('new');
    if (typeof window.syncFormDuplicateButtonVisibility === 'function') window.syncFormDuplicateButtonVisibility();
  }).catch(function() {
    showToast('Failed to open record', 'error');
  });
}
