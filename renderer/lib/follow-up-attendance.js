/* follow-up-attendance.js — new draft for the same client on a further visit (bail return, VIPER, etc.)
 *
 * Opposite of duplicate-attendance (same client, new visit) vs duplicate (same session, new client).
 * Reuses duplicate-attendance CLEAR groups where the prior visit’s content must not carry over.
 */
(function (global) {
  'use strict';

  function loadDuplicateClear() {
    if (typeof duplicateAttendanceClearPolicy !== 'undefined' && duplicateAttendanceClearPolicy.CLEAR) {
      return duplicateAttendanceClearPolicy;
    }
    try {
      // eslint-disable-next-line global-require
      var mod = require('./duplicate-attendance');
      if (mod && mod.CLEAR) return mod;
    } catch (_) {}
    return null;
  }

  function clearFields(d, fields) {
    if (!d || typeof d !== 'object' || !fields) return;
    for (var i = 0; i < fields.length; i++) delete d[fields[i]];
  }

  function clearByPattern(d, regex) {
    if (!d || typeof d !== 'object') return;
    Object.keys(d).forEach(function (k) {
      if (regex.test(k)) delete d[k];
    });
  }

  /** Same personal/means keys as newMatterFromAttendance in app.js */
  var CLIENT_PERSONAL_KEYS = [
    'title', 'forename', 'middleName', 'surname', 'dob', 'gender', 'addressNfa',
    'address1', 'address2', 'address3', 'city', 'county', 'postCode',
    'clientPhone', 'clientEmail', 'clientEmailConsent', 'nationality', 'nationalityOther',
    'accommodationStatus', 'accommodationDetails', 'maritalStatus', 'employmentStatus',
    'niNumber', 'niNumberUnknown', 'arcNumber', 'benefits', 'benefitType', 'benefitOther',
    'benefitNotes', 'passportedBenefit', 'grossIncome', 'partnerIncome', 'partnerName',
    'dependants', 'capitalClient', 'capitalPartner', 'capitalTotal', 'incomeNotes',
    'clientInvolvedAnotherWay', 'clientInvolvedDetails', 'counselInstructed', 'advocacyReason',
    'ethnicOriginCode', 'disabilityCode', 'riskAssessment', 'juvenileVulnerable',
    'appropriateAdultName', 'appropriateAdultRelation', 'appropriateAdultPhone',
    'appropriateAdultEmail', 'appropriateAdultOrganisation', 'appropriateAdultAddress',
    'interpreterName', 'interpreterLanguage', 'languageIssues',
  ];

  var SESSION_KEEP_KEYS = [
    'firmId', 'firmName', 'firmLaaAccount', 'firmContactName', 'firmContactPhone',
    'firmContactEmail', 'feeEarnerName',
    'ufn', 'maatId', 'ourFileNumber', 'fileReference', 'dsccRef',
    'policeStationId', 'policeStationName', 'schemeId', 'otherLocation',
    'oicName', 'oicEmail', 'oicPhone',
    'custodyNumber',
    'matterTypeCode', 'offenceSummary',
    'offence1Details', 'offence1Date', 'offence1ModeOfTrial', 'offence1Statute',
    'offence2Details', 'offence2Date', 'offence2ModeOfTrial', 'offence2Statute',
    'offence3Details', 'offence3Date', 'offence3ModeOfTrial', 'offence3Statute',
    'offence4Details', 'offence4Date', 'offence4ModeOfTrial', 'offence4Statute',
    'otherOffencesNotes',
    'attendanceMode', '_formType', 'dutySolicitor', 'weekendBankHoliday', 'sourceOfReferral',
  ];

  var FOLLOW_UP_CLEAR_EXTRA = [
    'interviews', 'noCommentReasons',
    'commsLog', 'attendingContacts',
    'sufficientBenefitTest', 'sufficientBenefitNotes', 'arrivalNotes',
    'billingDisplayInvoiceNumber',
    '_duplicatedFromAttendanceId', '_duplicateInstanceId', '_duplicateFreshClient',
  ];

  var FOLLOW_UP_CLEAR_PATTERNS = [
    /^vidCap/i,
    /^vidParade/i,
  ];

  function loadFollowUpReasonCodes() {
    if (typeof followUpReasonCodesForChooser === 'function') {
      return followUpReasonCodesForChooser();
    }
    try {
      // eslint-disable-next-line global-require
      var visitMod = require('./attendance-visit-type');
      if (visitMod && typeof visitMod.followUpReasonCodesForChooser === 'function') {
        return visitMod.followUpReasonCodesForChooser();
      }
    } catch (_) {}
    return {
      bail_return: 'Bail return',
      rui_return: 'RUI return',
      identification: 'ID procedure (identification parade / VIPER)',
      re_interview: 'Re-interview',
      other: 'Further attendance / further interview',
    };
  }

  var REASON_CODES = loadFollowUpReasonCodes();

  function copyKeys(target, source, keys) {
    keys.forEach(function (k) {
      if (source[k] !== undefined && source[k] !== '') target[k] = source[k];
    });
  }

  function applyVisitClears(d) {
    var dupMod = loadDuplicateClear();
    if (!dupMod || !dupMod.CLEAR) return;
    var skipGroups = { identity: true, caseRefs: true, supervisor: true, conflictAndMeans: true };
    Object.keys(dupMod.CLEAR).forEach(function (group) {
      if (skipGroups[group]) return;
      clearFields(d, dupMod.CLEAR[group]);
    });
    (dupMod.CLEAR_PATTERNS || []).forEach(function (re) {
      clearByPattern(d, re);
    });
    clearFields(d, FOLLOW_UP_CLEAR_EXTRA);
    FOLLOW_UP_CLEAR_PATTERNS.forEach(function (re) {
      clearByPattern(d, re);
    });
  }

  function resolvePoliceStationFromSource(src) {
    var name = (src.bailReturnStationName && String(src.bailReturnStationName).trim())
      ? String(src.bailReturnStationName).trim()
      : (src.policeStationName || '');
    var code = (src.bailReturnStationCode && String(src.bailReturnStationCode).trim())
      ? String(src.bailReturnStationCode).trim()
      : (src.schemeId || '');
    var stationId = src.policeStationId;
    if (src.bailReturnStationName && src.policeStationName
      && String(src.bailReturnStationName).trim() !== String(src.policeStationName).trim()) {
      stationId = undefined;
    }
    return { policeStationName: name, schemeId: code, policeStationId: stationId };
  }

  function resolveFollowUpDate(src) {
    if (src.bailDate && String(src.bailDate).trim()) return String(src.bailDate).trim();
    return '';
  }

  /**
   * @param {object} originalAttendance — parsed data JSON
   * @param {number|string} sourceAttendanceId
   * @param {string} reasonCode — bail_return | rui_return | identification | re_interview | other
   * @returns {object}
   */
  function followUpAttendanceData(originalAttendance, sourceAttendanceId, reasonCode) {
    var src = originalAttendance || {};
    var d = {};
    copyKeys(d, src, CLIENT_PERSONAL_KEYS);
    copyKeys(d, src, SESSION_KEEP_KEYS);

    d._formType = src._formType || 'attendance';
    if (!d.attendanceMode) d.attendanceMode = src.attendanceMode || 'custody';

    applyVisitClears(d);

    /* Re-apply keys cleared by visit reset but required on the follow-up draft. */
    copyKeys(d, src, SESSION_KEEP_KEYS);
    copyKeys(d, src, CLIENT_PERSONAL_KEYS);

    var station = resolvePoliceStationFromSource(src);
    if (station.policeStationName) d.policeStationName = station.policeStationName;
    if (station.schemeId) d.schemeId = station.schemeId;
    if (station.policeStationId != null && station.policeStationId !== '') {
      d.policeStationId = station.policeStationId;
    } else if (station.policeStationName && src.bailReturnStationName) {
      delete d.policeStationId;
    }

    var followDate = resolveFollowUpDate(src);
    if (followDate) d.date = followDate;

    d.workType = 'Further Police Station Attendance';
    d.caseStatus = 'Existing case';
    d.clientType = 'Existing';

    d._followUpInstanceId =
      String(Date.now()) + '-' + Math.random().toString(36).slice(2, 11);
    if (sourceAttendanceId != null && sourceAttendanceId !== '') {
      d._followUpFromAttendanceId = sourceAttendanceId;
    }
    if (reasonCode && REASON_CODES[reasonCode]) {
      d._followUpReason = reasonCode;
    }

    return d;
  }

  function appendFollowUpIdToSourceData(sourceData, newAttendanceId) {
    var src = sourceData && typeof sourceData === 'object'
      ? JSON.parse(JSON.stringify(sourceData))
      : {};
    var list = Array.isArray(src._followUpAttendanceIds)
      ? src._followUpAttendanceIds.slice()
      : [];
    var idNum = typeof newAttendanceId === 'number' ? newAttendanceId : parseInt(newAttendanceId, 10);
    if (idNum != null && !isNaN(idNum) && list.indexOf(idNum) === -1) list.push(idNum);
    src._followUpAttendanceIds = list;
    return src;
  }

  /** Whether a back-link write to the source row is allowed (status unchanged). */
  function canWriteFollowUpBackLink(sourceStatus) {
    return sourceStatus === 'draft' || sourceStatus === 'finalised' || sourceStatus === 'completed';
  }

  /**
   * Build payload for source save from fresh disk data + one new follow-up id only.
   * @returns {{ write: boolean, status: string, data: object }}
   */
  function planFollowUpBackLinkSave(freshSourceRow, newAttendanceId) {
    if (!freshSourceRow || freshSourceRow.data == null) {
      return { write: false, status: '', data: {} };
    }
    var status = freshSourceRow.status || 'draft';
    if (!canWriteFollowUpBackLink(status)) {
      return { write: false, status: status, data: {} };
    }
    var freshData = typeof freshSourceRow.data === 'object'
      ? JSON.parse(JSON.stringify(freshSourceRow.data))
      : JSON.parse(String(freshSourceRow.data || '{}'));
    var data = appendFollowUpIdToSourceData(freshData, newAttendanceId);
    return { write: true, status: status, data: data };
  }

  function syncFollowUpIdsOntoOpenFormData(formDataObj, linkedData) {
    if (!formDataObj || !linkedData || !Array.isArray(linkedData._followUpAttendanceIds)) return;
    formDataObj._followUpAttendanceIds = linkedData._followUpAttendanceIds.slice();
  }

  global.followUpAttendanceData = followUpAttendanceData;
  global.appendFollowUpIdToSourceData = appendFollowUpIdToSourceData;
  global.canWriteFollowUpBackLink = canWriteFollowUpBackLink;
  global.planFollowUpBackLinkSave = planFollowUpBackLinkSave;
  global.syncFollowUpIdsOntoOpenFormData = syncFollowUpIdsOntoOpenFormData;
  global.FOLLOW_UP_REASON_CODES = REASON_CODES;
  global.FOLLOW_UP_CLIENT_PERSONAL_KEYS = CLIENT_PERSONAL_KEYS;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      followUpAttendanceData: followUpAttendanceData,
      appendFollowUpIdToSourceData: appendFollowUpIdToSourceData,
      canWriteFollowUpBackLink: canWriteFollowUpBackLink,
      planFollowUpBackLinkSave: planFollowUpBackLinkSave,
      syncFollowUpIdsOntoOpenFormData: syncFollowUpIdsOntoOpenFormData,
      FOLLOW_UP_REASON_CODES: REASON_CODES,
      FOLLOW_UP_CLIENT_PERSONAL_KEYS: CLIENT_PERSONAL_KEYS,
    };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : globalThis));
