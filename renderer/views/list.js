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
  var emailAddonEntitled = window._addons && window._addons.emailAddon && window._emailTemplatesAddonEnabled;

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

      var approved = r.supervisor_approved_at
        ? ' <span class="badge supervisor-approved" title="Supervisor approved">&#10003; Approved</span>' : '';
      var archivedBadge = r.archived_at
        ? ' <span class="badge archived" title="Archived">Archived</span>' : '';
      var deletedBadge = r.deleted_at
        ? ' <span class="badge deleted" title="Deleted">Deleted</span>' : '';
      var archiveBtn = r.archived_at
        ? '<button type="button" class="btn-list-action unarchive-btn" title="Restore from archive" data-id="' + r.id + '">Unarchive</button>'
        : '<button type="button" class="btn-list-action archive-btn" title="Archive this record" data-id="' + r.id + '">Archive</button>';

      /* Officer Email Templates add-on — Email OIC button + Sent badge (gated on licence entitlement + user setting) */
      var emailOicBtn  = '';
      var oicSentBadge = '';
      if (emailAddonEntitled) {
        emailOicBtn = '<button type="button" class="btn-list-action email-oic-btn" title="Email Officer in Charge" data-id="' + r.id + '">Email OIC</button>';
        if (d.officerEmailStatus === 'sent') {
          oicSentBadge = ' <span class="badge badge-oic-sent" title="OIC email sent on ' + esc(d.lastOfficerEmailSentDate ? new Date(d.lastOfficerEmailSentDate).toLocaleDateString('en-GB') : '') + '">&#9993; Sent</span>';
        }
      }

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
              '<button type="button" class="btn-list-action restore-btn" title="Restore this record" data-id="' + r.id + '">Restore</button>' +
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
              '<span class="badge ' + esc(r.status || 'draft') + '">' + esc(r.status || 'draft') + '</span>' +
              approved +
              archivedBadge +
              oicSentBadge +
            '</div>' +
            '<div class="list-item-btns" role="group" aria-label="Record actions">' +
              archiveBtn +
              '<button type="button" class="btn-list-action amend-btn" title="Open record to edit (amend)" data-id="' + r.id + '">Edit</button>' +
              '<button type="button" class="btn-list-action dup-btn" title="Duplicate for further visit" data-id="' + r.id + '">Duplicate</button>' +
              '<button type="button" class="btn-list-action pdf-btn" title="Export PDF to Desktop" data-id="' + r.id + '">PDF</button>' +
              '<button type="button" class="btn-list-action delete-btn" title="Delete this record" data-id="' + r.id + '">Delete</button>' +
              emailOicBtn +
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
      if (emailAddonEntitled && li.querySelector('.email-oic-btn')) {
        li.querySelector('.email-oic-btn').addEventListener('click', (function(rowData, rowStatus) {
          return function(e) {
            e.stopPropagation();
            openEmailModal(r.id, rowData, rowStatus);
          };
        })(d, r.status));
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
  /* Delay the actual archive call by 5 seconds to allow undo */
  var undone = false;
  var toast = document.createElement('div');
  toast.className = 'cn-toast cn-toast-visible cn-toast-info cn-undo-toast';
  toast.innerHTML = 'Record archived. <button class="cn-undo-btn" type="button">Undo</button>';
  document.body.appendChild(toast);
  toast.querySelector('.cn-undo-btn').addEventListener('click', function() {
    undone = true;
    toast.remove();
    showToast('Archive undone', 'success');
  });
  var timer = setTimeout(function() {
    toast.remove();
    if (undone) return;
    window.api.attendanceArchive(id).then(function() {
      refreshList();
    }).catch(function() {
      showToast('Failed to archive record', 'error');
    });
  }, 5000);
  void timer;
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
  showConfirm('Delete "' + title + '"?\n\nThe record will be moved to the Deleted list. You can restore it from there.', 'Confirm Delete').then(function(ok) {
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
  window.api.attendanceGet(id).then(function(row) {
    if (!row || !row.data) { showToast('Could not load record to duplicate', 'error'); return; }
    var src = safeJson(row.data);
    /* Time-sensitive fields intentionally excluded: instructionDateTime, waitingTimeStart,
       waitingTimeEnd, waitingTimeNotes, arrivalNotes — must be re-entered for the new visit */
    var copyKeys = ['title','surname','forename','middleName','gender','dob','custodyNumber','clientPhone','clientEmail',
      'clientEmailConsent','address1','address2','address3','postCode','accommodationStatus',
      'accommodationDetails','maritalStatus','employmentStatus','niNumber','arcNumber',
      'benefits','benefitType','benefitOther','benefitNotes','passportedBenefit','grossIncome','partnerIncome','partnerName','incomeNotes',
      'nationality','nationalityOther','ethnicOriginCode','disabilityCode','riskAssessment',
      'groundsForArrest','groundsForDetention','dateOfArrest','custodyRecordRead','custodyRecordIssues',
      'medication','psychiatricIssues','psychiatricNotes','literate','drugsTest','medicalExaminationOutcome',
      'juvenileVulnerable','appropriateAdultName','appropriateAdultRelation','appropriateAdultPhone','appropriateAdultEmail','appropriateAdultOrganisation','appropriateAdultAddress',
      'oicName','oicEmail','oicPhone','oicUnit',
      'firmContactName','firmContactPhone','firmContactEmail','offenceSummary',
      'nameOfComplainant','witnessIntimidation','coSuspectDetails','coSuspectConflict','coSuspectConflictNotes','cctvViewed','exhibitsInspected','exhibitsNotes','writtenEvidenceDetails','pncDisclosed','pncNotes','s18Searches','samplesDisclosed','paceSearches','forensicSamples','cautionAvailable','clothingShoesSeized',
      'offence1Details','offence1Date','offence1ModeOfTrial','offence1Statute',
      'offence2Details','offence2Date','offence2ModeOfTrial','offence2Statute',
      'offence3Details','offence3Date','offence3ModeOfTrial','offence3Statute',
      'offence4Details','offence4Date','offence4ModeOfTrial','offence4Statute','otherOffencesNotes',
      'matterTypeCode','policeStationId','policeStationName','firmId','firmLaaAccount','firmName',
      'multipleJourneys',
      'dsccRef','sourceOfReferral','fileReference','travelOriginPostcode','schemeId',
      'weekendBankHoliday','otherLocation','dutySolicitor','clientStatus','telephoneAdviceGiven'];
    formData = {};
    copyKeys.forEach(function(k) { if (src[k]) formData[k] = src[k]; });
    formData.workType = 'Further Police Station Attendance';
    formData.caseStatus = 'Existing case';
    formData.clientType = 'Existing';
    currentAttendanceId = null;
    currentSectionIdx = 0;
    prefillDefaults();
    setTimeout(function() {
      copyKeys.forEach(function(k) { if (src[k]) formData[k] = src[k]; });
      formData.workType = 'Further Police Station Attendance';
      formData.caseStatus = 'Existing case';
      formData.clientType = 'Existing';
      renderForm(formData);
      showView('new');
    }, 200);
  }).catch(function() {
    showToast('Failed to duplicate record', 'error');
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
    showView('new');
  }).catch(function() {
    showToast('Failed to open record', 'error');
  });
}
