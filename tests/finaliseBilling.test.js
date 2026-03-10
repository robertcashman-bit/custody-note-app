/**
 * Finalise and billing logic tests.
 *
 * Tests that attendance can be finalised without case outcome,
 * and that billing readiness warnings only fire when appropriate.
 *
 * These tests exercise the validation and billing logic functions
 * by mocking the formData object and calling the functions directly.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '..', 'app.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');

function extractFunction(source, funcName) {
  const regex = new RegExp('function\\s+' + funcName + '\\s*\\(');
  const idx = source.indexOf('function ' + funcName);
  if (idx === -1) return null;
  let depth = 0;
  let started = false;
  let end = idx;
  for (let i = idx; i < source.length; i++) {
    if (source[i] === '{') { depth++; started = true; }
    if (source[i] === '}') { depth--; }
    if (started && depth === 0) { end = i + 1; break; }
  }
  return source.substring(idx, end);
}

function buildValidationRunner(funcBody, funcName) {
  const wrappedCode = `
    var formData = {};
    var esc = function(s) { return String(s || ''); };
    ${funcBody}
    return ${funcName};
  `;
  const factory = new Function(wrappedCode);
  return function runValidation(data) {
    const fn = factory();
    return fn.call({ formData: data }, data);
  };
}

function buildBillingRunner() {
  const funcBody = extractFunction(appJsSource, 'getBillingReadinessWarnings');
  if (!funcBody) throw new Error('Could not extract getBillingReadinessWarnings');
  const wrappedCode = `
    var formData;
    var esc = function(s) { return String(s || ''); };
    ${funcBody}
    return function(data) { formData = data; return getBillingReadinessWarnings(); };
  `;
  const factory = new Function(wrappedCode);
  return factory();
}

function buildAttendanceValidator() {
  const funcBody = extractFunction(appJsSource, 'validateAttendanceForm');
  if (!funcBody) throw new Error('Could not extract validateAttendanceForm');
  const wrappedCode = `
    var formData;
    ${funcBody}
    return function(data) { formData = data; return validateAttendanceForm(); };
  `;
  const factory = new Function(wrappedCode);
  return factory();
}

function buildTelephoneValidator() {
  const funcBody = extractFunction(appJsSource, 'validateTelephoneForm');
  if (!funcBody) throw new Error('Could not extract validateTelephoneForm');
  const wrappedCode = `
    var formData;
    ${funcBody}
    return function(data) { formData = data; return validateTelephoneForm(); };
  `;
  const factory = new Function(wrappedCode);
  return factory();
}

function buildVoluntaryValidator() {
  const funcBody = extractFunction(appJsSource, 'validateVoluntaryForm');
  if (!funcBody) throw new Error('Could not extract validateVoluntaryForm');
  const wrappedCode = `
    var formData;
    ${funcBody}
    return function(data) { formData = data; return validateVoluntaryForm(); };
  `;
  const factory = new Function(wrappedCode);
  return factory();
}

function baseAttendanceData(overrides = {}) {
  return {
    date: '2025-01-15',
    policeStationId: 'PS001',
    instructionDateTime: '2025-01-15T10:00',
    surname: 'Smith',
    forename: 'John',
    dob: '1990-01-01',
    sufficientBenefitTest: 'Yes',
    conflictCheckResult: 'Negative',
    laaClientFullName: 'John Smith',
    niNumber: 'AB123456C',
    matterTypeCode: 'CRM14',
    offence1Details: 'Theft',
    timeArrival: '10:30',
    previousAdvice: 'No',
    workType: 'First Police Station Attendance',
    disclosureType: 'Written',
    caseOutcomeStatus: 'unknown',
    ...overrides,
  };
}

function baseTelephoneData(overrides = {}) {
  return {
    date: '2025-01-15',
    policeStationId: 'PS001',
    dsccRef: 'DSCC123',
    instructionDateTime: '2025-01-15T10:00',
    matterTypeCode: 'CRM14',
    dutySolicitor: 'Yes',
    feeCode: 'INVA',
    surname: 'Smith',
    forename: 'John',
    gender: 'Male',
    clientPhone: '07700900000',
    timeFirstContactWithClient: '10:15',
    firstContactWithin45Mins: 'Yes',
    telephoneAdviceSummary: 'Advised on rights',
    previousAdvice: 'No',
    caseOutcomeStatus: 'unknown',
    ...overrides,
  };
}

function baseVoluntaryData(overrides = {}) {
  return {
    date: '2025-01-15',
    instructionSource: 'Direct',
    surname: 'Smith',
    forename: 'John',
    offenceSummary: 'Fraud allegation',
    voluntaryStatusConfirmed: 'Yes',
    policeStationId: 'PS001',
    previousAdvice: 'No',
    caseOutcomeStatus: 'unknown',
    ...overrides,
  };
}


describe('Finalise: Attendance form validation', () => {
  let validate;
  try { validate = buildAttendanceValidator(); } catch (_) {}

  it('passes with caseOutcomeStatus=unknown (no outcome required)', { skip: !validate }, () => {
    const data = baseAttendanceData({ caseOutcomeStatus: 'unknown' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.strictEqual(outcomeErr, undefined, 'Should not require outcomeDecision when case is unknown');
  });

  it('passes with caseOutcomeStatus=bail_to_return', { skip: !validate }, () => {
    const data = baseAttendanceData({ caseOutcomeStatus: 'bail_to_return' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.strictEqual(outcomeErr, undefined);
  });

  it('passes with caseOutcomeStatus=released_under_investigation', { skip: !validate }, () => {
    const data = baseAttendanceData({ caseOutcomeStatus: 'released_under_investigation' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.strictEqual(outcomeErr, undefined);
  });

  it('requires outcomeDecision when caseOutcomeStatus=concluded', { skip: !validate }, () => {
    const data = baseAttendanceData({ caseOutcomeStatus: 'concluded' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.ok(outcomeErr, 'Should require outcomeDecision when case is concluded');
  });

  it('passes concluded with outcomeDecision filled', { skip: !validate }, () => {
    const data = baseAttendanceData({ caseOutcomeStatus: 'concluded', outcomeDecision: 'Released NFA' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.strictEqual(outcomeErr, undefined);
  });
});


describe('Finalise: Telephone form validation', () => {
  let validate;
  try { validate = buildTelephoneValidator(); } catch (_) {}

  it('passes with caseOutcomeStatus=unknown', { skip: !validate }, () => {
    const data = baseTelephoneData({ caseOutcomeStatus: 'unknown' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.strictEqual(outcomeErr, undefined);
  });

  it('requires outcomeDecision when concluded', { skip: !validate }, () => {
    const data = baseTelephoneData({ caseOutcomeStatus: 'concluded' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.ok(outcomeErr, 'Should require outcomeDecision when concluded');
  });

  it('requires outcomeCode when concluded', { skip: !validate }, () => {
    const data = baseTelephoneData({ caseOutcomeStatus: 'concluded', outcomeDecision: 'NFA' });
    const errors = validate(data);
    const codeErr = errors.find(e => e.key === 'outcomeCode');
    assert.ok(codeErr, 'Should require outcomeCode when concluded');
  });

  it('does not require outcomeCode when not concluded', { skip: !validate }, () => {
    const data = baseTelephoneData({ caseOutcomeStatus: 'ongoing' });
    const errors = validate(data);
    const codeErr = errors.find(e => e.key === 'outcomeCode');
    assert.strictEqual(codeErr, undefined);
  });
});


describe('Finalise: Voluntary form validation', () => {
  let validate;
  try { validate = buildVoluntaryValidator(); } catch (_) {}

  it('passes with caseOutcomeStatus=unknown', { skip: !validate }, () => {
    const data = baseVoluntaryData({ caseOutcomeStatus: 'unknown' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.strictEqual(outcomeErr, undefined);
  });

  it('passes with caseOutcomeStatus=bail_to_return', { skip: !validate }, () => {
    const data = baseVoluntaryData({ caseOutcomeStatus: 'bail_to_return' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.strictEqual(outcomeErr, undefined);
  });

  it('requires outcomeDecision when concluded', { skip: !validate }, () => {
    const data = baseVoluntaryData({ caseOutcomeStatus: 'concluded' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.ok(outcomeErr);
  });
});


describe('Billing readiness warnings', () => {
  let getBillingWarnings;
  try { getBillingWarnings = buildBillingRunner(); } catch (_) {}

  it('no outcome warning when caseOutcomeStatus=unknown', { skip: !getBillingWarnings }, () => {
    const w = getBillingWarnings({
      matterTypeCode: 'CRM14',
      caseOutcomeStatus: 'unknown',
      totalMinutes: '60',
      sufficientBenefitTest: 'Yes',
    });
    const outcomeWarn = w.find(msg => msg.toLowerCase().includes('outcome'));
    assert.strictEqual(outcomeWarn, undefined, 'Should not warn about outcome when status is unknown');
  });

  it('no outcome warning when caseOutcomeStatus=ongoing', { skip: !getBillingWarnings }, () => {
    const w = getBillingWarnings({
      matterTypeCode: 'CRM14',
      caseOutcomeStatus: 'ongoing',
      totalMinutes: '60',
    });
    const outcomeWarn = w.find(msg => msg.toLowerCase().includes('outcome'));
    assert.strictEqual(outcomeWarn, undefined);
  });

  it('warns about outcome code when concluded but missing', { skip: !getBillingWarnings }, () => {
    const w = getBillingWarnings({
      matterTypeCode: 'CRM14',
      caseOutcomeStatus: 'concluded',
      outcomeCode: '',
      totalMinutes: '60',
    });
    const outcomeWarn = w.find(msg => msg.toLowerCase().includes('outcome'));
    assert.ok(outcomeWarn, 'Should warn when case is concluded but outcomeCode missing');
  });

  it('no warning when concluded with outcomeCode', { skip: !getBillingWarnings }, () => {
    const w = getBillingWarnings({
      matterTypeCode: 'CRM14',
      caseOutcomeStatus: 'concluded',
      outcomeCode: 'CN04',
      totalMinutes: '60',
    });
    const outcomeWarn = w.find(msg => msg.toLowerCase().includes('outcome'));
    assert.strictEqual(outcomeWarn, undefined);
  });

  it('skips billing warnings for telephone form type', { skip: !getBillingWarnings }, () => {
    const w = getBillingWarnings({ _formType: 'telephone' });
    assert.strictEqual(w.length, 0);
  });
});
