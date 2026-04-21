/* duplicate-attendance.js — build a new draft payload from an existing attendance (same session, new client). */
(function (global) {
  'use strict';

  function clearKey(obj, key) {
    if (!obj || typeof obj !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(obj, key)) delete obj[key];
  }

  function emptyStringKeys(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!obj || typeof obj !== 'object') return;
      if (Object.prototype.hasOwnProperty.call(obj, k)) obj[k] = '';
    }
  }

  /** Signature canvas payload keys (see form sigKey definitions in app.js). */
  var SIGNATURE_DATA_KEYS = [
    'clientSig',
    'repInstructionsSig',
    'clientInstructionsSig',
    'repConfirmationSig',
    'supervisorSig',
    'laaPartnerSig',
    'feeEarnerSig',
    'crm14PartnerSig',
  ];

  var BILLING_AND_LINK_KEYS = [
    'quickfile_invoice_id',
    'quickfileInvoiceNumber',
    'quickfile_invoice_number',
    'quickfileInvoiceUrl',
    'invoiceNumberRef',
    'invoiceNotes',
    'officerEmailStatus',
    'lastOfficerEmailSentDate',
  ];

  /**
   * @param {object} originalAttendance — parsed `data` JSON from attendance row
   * @param {number} [sourceAttendanceId] — optional id for traceability
   * @returns {object} deep-cloned data ready for attendanceSave as a new draft
   */
  function duplicateAttendanceData(originalAttendance, sourceAttendanceId) {
    var d = JSON.parse(JSON.stringify(originalAttendance || {}));

    /* Unique payload per duplicate (defeats 30s stableStringify burst guard in main.js). */
    d._duplicateInstanceId =
      String(Date.now()) + '-' + Math.random().toString(36).slice(2, 11);
    if (sourceAttendanceId != null && sourceAttendanceId !== '') {
      d._duplicatedFromAttendanceId = sourceAttendanceId;
    }

    /* Strip conversion / provenance keys from the clone (fresh record). */
    [
      '_convertedToAttendance',
      '_convertedFromTelephone',
      '_convertedToCustodyAt',
      '_convertedFromVoluntary',
      '_sourceUfn',
      '_sourceVoluntaryId',
    ].forEach(function (k) {
      clearKey(d, k);
    });

    var clientAndIdKeys = [
      'title',
      'forename',
      'middleName',
      'surname',
      'laaClientFullName',
      'laaPartnerFullName',
      'dob',
      'custodyNumber',
      'address1',
      'address2',
      'address3',
      'city',
      'county',
      'postCode',
      'clientPhone',
      'clientEmail',
      'clientEmailConsent',
      'niNumber',
      'arcNumber',
      'ufn',
      'maatId',
      'ourFileNumber',
      'fileReference',
      'dsccRef',
      'retainerClientName',
      'retainerDob',
      'retainerAddress',
      'retainerUfnMaat',
      'appointedSolicitorRef',
      'appropriateAdultName',
      'appropriateAdultRelation',
      'appropriateAdultPhone',
      'appropriateAdultEmail',
      'appropriateAdultOrganisation',
      'appropriateAdultAddress',
      'interpreterName',
      'interpreterLanguage',
      'languageIssues',
      'juvenileVulnerable',
      'supervisorName',
      'supervisorComments',
      'supervisorDate',
      'supervisorTime',
    ];
    emptyStringKeys(d, clientAndIdKeys);

    SIGNATURE_DATA_KEYS.forEach(function (k) {
      clearKey(d, k);
    });
    BILLING_AND_LINK_KEYS.forEach(function (k) {
      clearKey(d, k);
    });
    clearKey(d, 'feeEarnerCertification');

    /* CRM14 block is client-specific */
    Object.keys(d).forEach(function (k) {
      if (/^crm14/i.test(k)) delete d[k];
    });

    /* Further visit metadata (parity with previous Duplicate behaviour). */
    if (d._formType === 'telephone') {
      /* Orchestrator should block telephone duplication; leave workType unchanged. */
    } else if (d.attendanceMode === 'voluntary') {
      d.workType = 'Further Voluntary Attendance';
      d.attendanceMode = 'voluntary';
    } else {
      d.workType = 'Further Police Station Attendance';
    }
    d.caseStatus = 'Existing case';
    d.clientType = 'Existing';

    return d;
  }

  global.duplicateAttendanceData = duplicateAttendanceData;
})(typeof window !== 'undefined' ? window : global);
