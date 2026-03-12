/* ═══════════════════════════════════════════════════════
   LIST VIEW  (extracted from app.js)
   Uses server-side attendanceSearch for search / sort / pagination.
   Depends on: listPage, LIST_PER_PAGE, formData, currentAttendanceId, currentSectionIdx,
               safeJson, esc, showToast, showConfirm, renderForm, showView,
               prefillDefaults (app.js globals)
   ═══════════════════════════════════════════════════════ */

var listStatusFilter = 'all';
var listSortMode = 'newest';

/* Map UI sort mode to attendanceSearch params */
function _listSortParams() {
  switch (listSortMode) {
    case 'oldest':  return { sortField: 'updated_at',    sortDir: 'ASC' };
    case 'name':    return { sortField: 'client_name',   sortDir: 'ASC' };
    case 'station': return { sortField: 'station_name',  sortDir: 'ASC' };
    case 'date':    return { sortField: 'attendance_date', sortDir: 'DESC' };
    default:        return { sortField: 'updated_at',    sortDir: 'DESC' };
  }
}

function refreshList() {
  var ul = document.getElementById('attendance-list');
  if (!ul || !window.api) return;

  var q = ((document.getElementById('list-search') || {}).value || '').trim();
  var sort = _listSortParams();

  var searchParams = {
    query: q || '',
    status: listStatusFilter === 'archived' ? '' : (listStatusFilter === 'all' ? '' : listStatusFilter),
    archived: listStatusFilter === 'archived',
    page: listPage,
    pageSize: LIST_PER_PAGE,
    sortField: sort.sortField,
    sortDir: sort.sortDir,
  };

  window.api.attendanceSearch(searchParams).then(function(result) {
    var rows = (result && result.rows) || [];
    var total = (result && result.total) || 0;

    ul.innerHTML = '';
    if (!rows.length) {
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
      var archiveBtn = r.archived_at
        ? '<button type="button" class="btn-list-action unarchive-btn" title="Restore from archive" data-id="' + r.id + '">Unarchive</button>'
        : '<button type="button" class="btn-list-action archive-btn" title="Archive this record" data-id="' + r.id + '">Archive</button>';

      /* Officer Email Templates add-on — Email OIC button + Sent badge */
      var emailOicBtn  = '';
      var oicSentBadge = '';
      if (window._emailTemplatesAddonEnabled) {
        emailOicBtn = '<button type="button" class="btn-list-action email-oic-btn" title="Email Officer in Charge" data-id="' + r.id + '">Email OIC</button>';
        if (d.officerEmailStatus === 'sent') {
          oicSentBadge = ' <span class="badge badge-oic-sent" title="OIC email sent on ' + esc(d.lastOfficerEmailSentDate ? new Date(d.lastOfficerEmailSentDate).toLocaleDateString('en-GB') : '') + '">&#9993; Sent</span>';
        }
      }

      var li = document.createElement('li');
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
            '<button type="button" class="btn-list-action delete-btn" title="Delete this record" data-id="' + r.id + '">Delete</button>' +
            emailOicBtn +
          '</div>' +
        '</div>';

      li.querySelector('.list-item-text').addEventListener('click', function() { openAttendance(r.id); });
      li.querySelector('.amend-btn').addEventListener('click', function(e) { e.stopPropagation(); amendAttendance(r.id, r.status, title); });
      li.querySelector('.dup-btn').addEventListener('click', function(e) { e.stopPropagation(); duplicateAttendance(r.id); });
      li.querySelector('.delete-btn').addEventListener('click', function(e) { e.stopPropagation(); deleteAttendance(r.id, title); });
      if (r.archived_at && li.querySelector('.unarchive-btn')) {
        li.querySelector('.unarchive-btn').addEventListener('click', function(e) { e.stopPropagation(); unarchiveAttendance(r.id); });
      } else if (!r.archived_at && li.querySelector('.archive-btn')) {
        li.querySelector('.archive-btn').addEventListener('click', function(e) { e.stopPropagation(); archiveAttendance(r.id, title); });
      }
      if (window._emailTemplatesAddonEnabled && li.querySelector('.email-oic-btn')) {
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
  window.api.attendanceArchive(id).then(function() {
    showToast('Record archived', 'info');
    refreshList();
  }).catch(function() {
    showToast('Failed to archive record', 'error');
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
  showConfirm('Delete "' + title + '"?\n\nFinalised records are archived (not permanently removed) to maintain the audit trail. Draft records are permanently deleted.', 'Confirm Delete').then(function(ok) {
    if (!ok) return;
    window.api.attendanceDelete({ id: id, reason: 'User deleted from list' }).then(function(result) {
      if (result && result.soft) showToast('Record archived (finalised \u2014 kept in audit trail)', 'info');
      else showToast('Draft deleted', 'info');
      refreshList();
    });
  });
}

function duplicateAttendance(id) {
  window.api.attendanceGet(id).then(function(row) {
    if (!row || !row.data) return;
    var src = safeJson(row.data);
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
      'multipleJourneys','waitingTimeStart','waitingTimeEnd','waitingTimeNotes',
      'dsccRef','sourceOfReferral','fileReference','travelOriginPostcode','schemeId',
      'instructionDateTime','weekendBankHoliday','otherLocation','dutySolicitor','clientStatus','telephoneAdviceGiven','arrivalNotes'];
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
  });
}
