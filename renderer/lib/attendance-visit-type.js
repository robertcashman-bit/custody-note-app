/* attendance-visit-type.js — in-place attendance / visit type without dropping data keys */
(function (global) {
  'use strict';

  var VISIT_FIRST = 'first';
  var VISIT_BAIL_RETURN = 'bail_return';
  var VISIT_FURTHER = 'further';
  var VISIT_RE_INTERVIEW = 're_interview';
  var VISIT_IDENTIFICATION = 'identification';
  var VISIT_RUI_RETURN = 'rui_return';
  var VISIT_CHARGE_ONLY = 'charge_only';

  var WORK_TYPE_FURTHER = 'Further Police Station Attendance';
  var WORK_TYPE_FIRST = 'First Police Station Attendance';
  var WORK_TYPE_VOLUNTARY = 'Voluntary Police Station Attendance';

  /** Maps _followUpReason storage codes to visit-type codes (Further Police Station Attendance). */
  var REASON_CODE_BY_VISIT_TYPE = {
    further: 'other',
    re_interview: 're_interview',
    identification: 'identification',
    rui_return: 'rui_return',
    charge_only: 'charge_only',
  };

  var VISIT_TYPE_BY_REASON_CODE = {
    bail_return: VISIT_BAIL_RETURN,
    other: VISIT_FURTHER,
    re_interview: VISIT_RE_INTERVIEW,
    identification: VISIT_IDENTIFICATION,
    rui_return: VISIT_RUI_RETURN,
    charge_only: VISIT_CHARGE_ONLY,
  };

  /** Labels for follow-up chooser (excludes first attendance). */
  var FOLLOW_UP_REASON_LABELS = {
    bail_return: 'Bail return',
    rui_return: 'RUI return',
    identification: 'ID procedure (identification parade / VIPER)',
    re_interview: 'Re-interview',
    charge_only: 'Charge only (no interview)',
    other: 'Further attendance / further interview',
  };

  /**
   * Dropdown order: first attendance, then follow-up visit types the model supports.
   * @type {Array<{ code: string, label: string }>}
   */
  var VISIT_TYPE_OPTIONS = [
    { code: VISIT_FIRST, label: 'First attendance' },
    { code: VISIT_BAIL_RETURN, label: 'Bail return' },
    { code: VISIT_FURTHER, label: 'Further attendance / further interview' },
    { code: VISIT_RE_INTERVIEW, label: 'Re-interview' },
    { code: VISIT_CHARGE_ONLY, label: 'Charge only (no interview)' },
    { code: VISIT_IDENTIFICATION, label: 'ID procedure (identification parade / VIPER)' },
    { code: VISIT_RUI_RETURN, label: 'RUI return' },
  ];

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

  function resolveVisitTypeFromFollowUpReason(reason) {
    if (!reason) return null;
    if (VISIT_TYPE_BY_REASON_CODE[reason]) return VISIT_TYPE_BY_REASON_CODE[reason];
    return null;
  }

  function resolveVisitType(data) {
    if (!data || typeof data !== 'object') return VISIT_FIRST;
    if (data._formType === 'telephone') return null;
    if (data._followUpReason === 'bail_return') return VISIT_BAIL_RETURN;
    var wt = String(data.workType || '').trim();
    if (wt === WORK_TYPE_FURTHER) {
      var fromReason = resolveVisitTypeFromFollowUpReason(data._followUpReason);
      return fromReason || VISIT_FURTHER;
    }
    return VISIT_FIRST;
  }

  function visitTypeLabel(code) {
    for (var i = 0; i < VISIT_TYPE_OPTIONS.length; i++) {
      if (VISIT_TYPE_OPTIONS[i].code === code) return VISIT_TYPE_OPTIONS[i].label;
    }
    if (code === VISIT_BAIL_RETURN) return 'Bail return';
    if (code === VISIT_FURTHER) return 'Further attendance / further interview';
    return 'First attendance';
  }

  function listAttendanceVisitTypeOptions() {
    return VISIT_TYPE_OPTIONS.map(function (opt) {
      return { code: opt.code, label: opt.label };
    });
  }

  function followUpReasonCodesForChooser() {
    var out = {};
    Object.keys(FOLLOW_UP_REASON_LABELS).forEach(function (k) {
      out[k] = FOLLOW_UP_REASON_LABELS[k];
    });
    return out;
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

  function applyFurtherFollowUpProfile(data, reasonCode, opts) {
    captureVisitTypeRevertIfNeeded(data);
    data.attendanceMode = 'custody';
    data._formType = data._formType || 'attendance';
    data.workType = WORK_TYPE_FURTHER;
    data.caseStatus = 'Existing case';
    data.clientType = 'Existing';
    data._followUpReason = reasonCode || 'other';
    ensureFollowUpInstanceId(data);
    if (opts && opts.sourceAttendanceId != null && opts.sourceAttendanceId !== '') {
      data._followUpFromAttendanceId = opts.sourceAttendanceId;
    }
  }

  function applyFurtherAttendanceProfile(data, opts) {
    applyFurtherFollowUpProfile(data, 'other', opts);
  }

  function applyVisitTypeProfile(data, targetType, opts) {
    if (targetType === VISIT_FIRST) {
      applyFirstAttendanceProfile(data);
    } else if (targetType === VISIT_BAIL_RETURN) {
      applyBailReturnProfile(data, opts);
    } else if (targetType === VISIT_FURTHER) {
      applyFurtherFollowUpProfile(data, 'other', opts);
    } else if (REASON_CODE_BY_VISIT_TYPE[targetType]) {
      applyFurtherFollowUpProfile(data, REASON_CODE_BY_VISIT_TYPE[targetType], opts);
    } else {
      return false;
    }
    return true;
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
    if (!applyVisitTypeProfile(data, targetType, opts)) {
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
      return resolveVisitType(data);
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
    re_interview: VISIT_RE_INTERVIEW,
    identification: VISIT_IDENTIFICATION,
    rui_return: VISIT_RUI_RETURN,
    charge_only: VISIT_CHARGE_ONLY,
  };
  global.ATTENDANCE_VISIT_TYPE_OPTIONS = VISIT_TYPE_OPTIONS;
  global.TELEPHONE_VISIT_TYPE_BLOCK_MESSAGE = TELEPHONE_BLOCK_MESSAGE;
  global.resolveAttendanceVisitType = resolveVisitType;
  global.visitTypeLabelForCode = visitTypeLabel;
  global.listAttendanceVisitTypeOptions = listAttendanceVisitTypeOptions;
  global.followUpReasonCodesForChooser = followUpReasonCodesForChooser;
  global.applyAttendanceVisitType = applyVisitType;
  global.syncVisitTypeFromWorkType = syncVisitTypeFromWorkType;
  global.captureVisitTypeRevertIfNeeded = captureVisitTypeRevertIfNeeded;
  global.countAttendanceDataKeys = countDataKeys;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ATTENDANCE_VISIT_TYPES: global.ATTENDANCE_VISIT_TYPES,
      ATTENDANCE_VISIT_TYPE_OPTIONS: VISIT_TYPE_OPTIONS,
      TELEPHONE_VISIT_TYPE_BLOCK_MESSAGE: TELEPHONE_BLOCK_MESSAGE,
      resolveAttendanceVisitType: resolveVisitType,
      visitTypeLabelForCode: visitTypeLabel,
      listAttendanceVisitTypeOptions: listAttendanceVisitTypeOptions,
      followUpReasonCodesForChooser: followUpReasonCodesForChooser,
      applyAttendanceVisitType: applyVisitType,
      syncVisitTypeFromWorkType: syncVisitTypeFromWorkType,
      captureVisitTypeRevertIfNeeded: captureVisitTypeRevertIfNeeded,
      countAttendanceDataKeys: countDataKeys,
      WORK_TYPE_FURTHER: WORK_TYPE_FURTHER,
      WORK_TYPE_FIRST: WORK_TYPE_FIRST,
      WORK_TYPE_VOLUNTARY: WORK_TYPE_VOLUNTARY,
      REASON_CODE_BY_VISIT_TYPE: REASON_CODE_BY_VISIT_TYPE,
    };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : globalThis));
