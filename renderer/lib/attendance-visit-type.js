/* attendance-visit-type.js — in-place visit type (first / bail return / further) without dropping data keys */
(function (global) {
  'use strict';

  var VISIT_FIRST = 'first';
  var VISIT_BAIL_RETURN = 'bail_return';
  var VISIT_FURTHER = 'further';

  var WORK_TYPE_FURTHER = 'Further Police Station Attendance';
  var WORK_TYPE_FIRST = 'First Police Station Attendance';
  var WORK_TYPE_VOLUNTARY = 'Voluntary Police Station Attendance';

  var MANAGED_KEYS = [
    'attendanceMode',
    'workType',
    'caseStatus',
    'clientType',
    '_followUpReason',
    '_followUpFromAttendanceId',
  ];

  var TELEPHONE_BLOCK_MESSAGE =
    'Visit type cannot be changed on a telephone advice record. If the client is attending the station, use Convert to attendance (Spec 9.74) from the outcome section.';

  function cloneManagedSlice(data) {
    var snap = {};
    MANAGED_KEYS.forEach(function (k) {
      if (data && Object.prototype.hasOwnProperty.call(data, k)) snap[k] = data[k];
    });
    return snap;
  }

  function captureVisitTypeRevertIfNeeded(data) {
    if (!data || typeof data !== 'object') return;
    if (data._visitTypeRevertSnapshot) return;
    data._visitTypeRevertSnapshot = cloneManagedSlice(data);
  }

  function appendVisitTypeChangeNote(data, fromType, toType) {
    if (!data || typeof data !== 'object') return;
    var entry = {
      from: fromType || '',
      to: toType || '',
      at: new Date().toISOString(),
    };
    if (!Array.isArray(data._visitTypeChangeLog)) data._visitTypeChangeLog = [];
    data._visitTypeChangeLog.push(entry);
  }

  function resolveVisitType(data) {
    if (!data || typeof data !== 'object') return VISIT_FIRST;
    if (data._formType === 'telephone') return null;
    if (data._followUpReason === 'bail_return') return VISIT_BAIL_RETURN;
    var wt = String(data.workType || '').trim();
    if (wt === WORK_TYPE_FURTHER) return VISIT_FURTHER;
    return VISIT_FIRST;
  }

  function visitTypeLabel(code) {
    if (code === VISIT_BAIL_RETURN) return 'Bail return';
    if (code === VISIT_FURTHER) return 'Further attendance';
    return 'First attendance';
  }

  function ensureFollowUpInstanceId(data) {
    if (!data._followUpInstanceId) {
      data._followUpInstanceId =
        String(Date.now()) + '-' + Math.random().toString(36).slice(2, 11);
    }
  }

  function applyFirstAttendanceProfile(data) {
    if (data._visitTypeRevertSnapshot) {
      var snap = data._visitTypeRevertSnapshot;
      MANAGED_KEYS.forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(snap, k)) data[k] = snap[k];
        else delete data[k];
      });
      delete data._visitTypeRevertSnapshot;
      return;
    }
    if (data.attendanceMode === 'voluntary') {
      data.workType = WORK_TYPE_VOLUNTARY;
    } else {
      data.workType = WORK_TYPE_FIRST;
    }
    delete data._followUpReason;
    delete data._followUpFromAttendanceId;
  }

  function applyBailReturnProfile(data, opts) {
    captureVisitTypeRevertIfNeeded(data);
    data.attendanceMode = 'custody';
    data._formType = data._formType || 'attendance';
    data.workType = WORK_TYPE_FURTHER;
    data.caseStatus = 'Existing case';
    data.clientType = 'Existing';
    data._followUpReason = 'bail_return';
    ensureFollowUpInstanceId(data);
    if (opts && opts.sourceAttendanceId != null && opts.sourceAttendanceId !== '') {
      data._followUpFromAttendanceId = opts.sourceAttendanceId;
    }
  }

  function applyFurtherAttendanceProfile(data, opts) {
    captureVisitTypeRevertIfNeeded(data);
    data.attendanceMode = 'custody';
    data._formType = data._formType || 'attendance';
    data.workType = WORK_TYPE_FURTHER;
    data.caseStatus = 'Existing case';
    data.clientType = 'Existing';
    if (data._followUpReason === 'bail_return') delete data._followUpReason;
    if (!data._followUpReason) data._followUpReason = 'other';
    ensureFollowUpInstanceId(data);
    if (opts && opts.sourceAttendanceId != null && opts.sourceAttendanceId !== '') {
      data._followUpFromAttendanceId = opts.sourceAttendanceId;
    }
  }

  /**
   * Mutates data in place; never removes unrelated keys.
   * @returns {{ changed: boolean, blocked?: boolean, message?: string, from?: string, to?: string, needsCustodyForm?: boolean }}
   */
  function applyVisitType(data, targetType, opts) {
    opts = opts || {};
    if (!data || typeof data !== 'object') {
      return { changed: false, blocked: true, message: 'No record data.' };
    }
    if (data._formType === 'telephone') {
      return { changed: false, blocked: true, message: TELEPHONE_BLOCK_MESSAGE };
    }
    var fromType = resolveVisitType(data);
    if (fromType === targetType) {
      return { changed: false, from: fromType, to: targetType };
    }
    if (targetType === VISIT_FIRST) {
      applyFirstAttendanceProfile(data);
    } else if (targetType === VISIT_BAIL_RETURN) {
      applyBailReturnProfile(data, opts);
    } else if (targetType === VISIT_FURTHER) {
      applyFurtherAttendanceProfile(data, opts);
    } else {
      return { changed: false, blocked: true, message: 'Unknown visit type.' };
    }
    appendVisitTypeChangeNote(data, fromType, targetType);
    var needsCustodyForm = targetType !== VISIT_FIRST && data.attendanceMode === 'custody';
    if (fromType === VISIT_FIRST && targetType !== VISIT_FIRST) needsCustodyForm = true;
    return {
      changed: true,
      from: fromType,
      to: targetType,
      needsCustodyForm: needsCustodyForm || data.attendanceMode === 'custody',
      needsVoluntaryForm: targetType === VISIT_FIRST && data.attendanceMode === 'voluntary',
    };
  }

  /**
   * Keep visit-type bar and Work Type dropdown aligned when workType changes in section 1.
   * @returns {string|null} resolved visit type after sync
   */
  function syncVisitTypeFromWorkType(data) {
    if (!data || data._formType === 'telephone') return null;
    var wt = String(data.workType || '').trim();
    if (wt === WORK_TYPE_FURTHER) {
      if (data._followUpReason === 'bail_return') return VISIT_BAIL_RETURN;
      if (!data._followUpReason) data._followUpReason = 'other';
      if (data.caseStatus !== 'Existing case') data.caseStatus = 'Existing case';
      if (data.clientType !== 'Existing') data.clientType = 'Existing';
      return VISIT_FURTHER;
    }
    if (wt === WORK_TYPE_FIRST || wt === WORK_TYPE_VOLUNTARY) {
      if (data._followUpReason || data._followUpFromAttendanceId) {
        applyFirstAttendanceProfile(data);
      }
      return VISIT_FIRST;
    }
    return resolveVisitType(data);
  }

  function countDataKeys(data) {
    return data && typeof data === 'object' ? Object.keys(data).length : 0;
  }

  global.ATTENDANCE_VISIT_TYPES = {
    first: VISIT_FIRST,
    bail_return: VISIT_BAIL_RETURN,
    further: VISIT_FURTHER,
  };
  global.TELEPHONE_VISIT_TYPE_BLOCK_MESSAGE = TELEPHONE_BLOCK_MESSAGE;
  global.resolveAttendanceVisitType = resolveVisitType;
  global.visitTypeLabelForCode = visitTypeLabel;
  global.applyAttendanceVisitType = applyVisitType;
  global.syncVisitTypeFromWorkType = syncVisitTypeFromWorkType;
  global.captureVisitTypeRevertIfNeeded = captureVisitTypeRevertIfNeeded;
  global.countAttendanceDataKeys = countDataKeys;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ATTENDANCE_VISIT_TYPES: global.ATTENDANCE_VISIT_TYPES,
      TELEPHONE_VISIT_TYPE_BLOCK_MESSAGE: TELEPHONE_BLOCK_MESSAGE,
      resolveAttendanceVisitType: resolveVisitType,
      visitTypeLabelForCode: visitTypeLabel,
      applyAttendanceVisitType: applyVisitType,
      syncVisitTypeFromWorkType: syncVisitTypeFromWorkType,
      captureVisitTypeRevertIfNeeded: captureVisitTypeRevertIfNeeded,
      countAttendanceDataKeys: countDataKeys,
      WORK_TYPE_FURTHER: WORK_TYPE_FURTHER,
      WORK_TYPE_FIRST: WORK_TYPE_FIRST,
      WORK_TYPE_VOLUNTARY: WORK_TYPE_VOLUNTARY,
    };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : globalThis));
