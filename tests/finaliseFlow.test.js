const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '..', 'app.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');

describe('Finalise flow — code structure verification', () => {

  it('saveForm stops autosave and sets currentRecordStatus before IPC when finalising', () => {
    const saveFormBody = extractFunctionBody(appJsSource, 'saveForm');
    assert.ok(saveFormBody, 'saveForm function must exist');

    const finaliseBlock = saveFormBody.substring(
      saveFormBody.indexOf("if (status === 'finalised')"),
      saveFormBody.indexOf('window.api.attendanceSave')
    );
    assert.ok(finaliseBlock.includes('stopAutoSave()'),
      'saveForm must call stopAutoSave before IPC when finalising');
    assert.ok(finaliseBlock.includes("currentRecordStatus = 'finalised'"),
      'saveForm must set currentRecordStatus before IPC when finalising');
    assert.ok(finaliseBlock.includes('clearTimeout(_quietSaveDebounceTimer)'),
      'saveForm must clear debounce timer when finalising');
    assert.ok(finaliseBlock.includes('_draftSaveQueued = false'),
      'saveForm must clear queued draft save when finalising');
  });

  it('saveForm resets currentRecordStatus on finalise failure', () => {
    const saveFormBody = extractFunctionBody(appJsSource, 'saveForm');
    const catchBlock = saveFormBody.substring(saveFormBody.indexOf('.catch('));
    assert.ok(catchBlock.includes("currentRecordStatus = 'draft'"),
      'saveForm catch handler must reset status to draft on failure');
  });

  it('quietSave skips when currentRecordStatus is finalised', () => {
    const quietSaveBody = extractFunctionBody(appJsSource, 'quietSave');
    assert.ok(quietSaveBody, 'quietSave function must exist');
    assert.ok(quietSaveBody.includes("currentRecordStatus === 'finalised'"),
      'quietSave must check if record is already finalised');
  });

  it('validateBeforeFinalise stops autosave before validation', () => {
    const vbfBody = extractFunctionBody(appJsSource, 'validateBeforeFinalise');
    assert.ok(vbfBody, 'validateBeforeFinalise function must exist');
    assert.ok(vbfBody.includes('stopAutoSave()'),
      'validateBeforeFinalise must stop autosave');
    assert.ok(vbfBody.includes('clearTimeout(_quietSaveDebounceTimer)'),
      'validateBeforeFinalise must clear debounce timer');
  });

  it('validation-finalise-anyway stops autosave before calling saveForm', () => {
    const idx = appJsSource.indexOf("'validation-finalise-anyway'");
    assert.ok(idx !== -1, 'validation-finalise-anyway handler must exist');
    const block = appJsSource.substring(idx, idx + 800);
    assert.ok(block.includes('stopAutoSave()'),
      'validation-finalise-anyway must stop autosave before finalising');
    assert.ok(block.includes('clearTimeout(_quietSaveDebounceTimer)'),
      'validation-finalise-anyway must clear debounce timer');
  });

  it('doFinalise waits for in-flight draft save before proceeding', () => {
    const vbfBody = extractFunctionBody(appJsSource, 'validateBeforeFinalise');
    const doFinaliseBody = extractNestedFunction(vbfBody, 'doFinalise');
    assert.ok(doFinaliseBody, 'doFinalise function must exist inside validateBeforeFinalise');
    assert.ok(doFinaliseBody.includes('_draftSaveInFlight'),
      'doFinalise must check _draftSaveInFlight');
    assert.ok(doFinaliseBody.includes('setInterval'),
      'doFinalise must wait via setInterval when draft save is in flight');
  });

  it('validation requires outcomeDecision only when case is concluded', () => {
    const vafBody = extractFunctionBody(appJsSource, 'validateAttendanceForm');
    assert.ok(vafBody, 'validateAttendanceForm must exist');
    assert.ok(vafBody.includes("caseConcluded"),
      'validateAttendanceForm must use caseConcluded');
    assert.ok(vafBody.includes("=== 'concluded'"),
      'caseConcluded must check for concluded status');
    const caseConcCheck = vafBody.indexOf("if (caseConcluded)");
    assert.ok(caseConcCheck !== -1, 'caseConcluded check must exist');
    const afterCaseConcCheck = vafBody.substring(caseConcCheck);
    assert.ok(afterCaseConcCheck.includes("outcomeDecision"),
      'outcomeDecision requirement must be gated by caseConcluded check');
    assert.ok(!vafBody.substring(0, caseConcCheck).includes("key: 'outcomeDecision'"),
      'outcomeDecision must not be in the unconditional required list');
  });

  it('scheduleQuietSave reports editor activity to main process', () => {
    const sqsBody = extractFunctionBody(appJsSource, 'scheduleQuietSave');
    assert.ok(sqsBody, 'scheduleQuietSave function must exist');
    assert.ok(sqsBody.includes('reportEditorActivity'),
      'scheduleQuietSave must report editor activity to main process');
  });
});

describe('Stale draft overwrite protection', () => {
  it('attendance-save in main.js blocks draft writes to finalised records', () => {
    const mainJsSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const saveHandler = mainJsSource.substring(
      mainJsSource.indexOf("ipcMain.handle('attendance-save'"),
      mainJsSource.indexOf("ipcMain.handle('attendance-save'") + 3000
    );
    assert.ok(saveHandler.includes("existing.status === 'finalised' && st !== 'finalised'"),
      'attendance-save must block draft writes to finalised records');
    assert.ok(saveHandler.includes("error: 'locked'"),
      'attendance-save must return locked error for blocked writes');
  });
});

describe('Sync pull finalise guard', () => {
  it('syncPull refuses to overwrite locally-finalised records with remote draft', () => {
    const mainJsSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const pullFn = mainJsSource.substring(
      mainJsSource.indexOf('async function syncPull'),
      mainJsSource.indexOf('async function syncPull') + 3000
    );
    assert.ok(pullFn.includes("localStatus === 'finalised'"),
      'syncPull must check if local record is finalised');
    assert.ok(pullFn.includes("remote.status !== 'finalised'"),
      'syncPull must check if remote record is not finalised');
    assert.ok(pullFn.includes('continue'),
      'syncPull must skip overwrite when local is finalised and remote is not');
  });
});

describe('Finalise retry and verification', () => {
  it('saveForm retries finalise up to 3 times on failure', () => {
    const saveFormBody = extractFunctionBody(appJsSource, 'saveForm');
    assert.ok(saveFormBody.includes('attemptNum < 3'),
      'saveForm must retry finalise up to 3 times');
    assert.ok(saveFormBody.includes('doSaveIPC'),
      'saveForm must use doSaveIPC for retry logic');
  });

  it('saveForm verifies DB status after finalise IPC succeeds', () => {
    const saveFormBody = extractFunctionBody(appJsSource, 'saveForm');
    assert.ok(saveFormBody.includes('attendanceGet(verifyId)'),
      'saveForm must verify DB status after finalise');
    assert.ok(saveFormBody.includes('[FINALISE] VERIFIED'),
      'saveForm must log verification result');
  });

  it('saveForm uses attendanceForceStatus as last resort fallback', () => {
    const saveFormBody = extractFunctionBody(appJsSource, 'saveForm');
    assert.ok(saveFormBody.includes('attendanceForceStatus'),
      'saveForm must have attendanceForceStatus fallback');
    assert.ok(saveFormBody.includes('FORCE-STATUS succeeded'),
      'saveForm must log force-status success');
  });

  it('quietSave skips when _finalising is true', () => {
    const quietSaveBody = extractFunctionBody(appJsSource, 'quietSave');
    assert.ok(quietSaveBody.includes('_finalising'),
      'quietSave must check _finalising flag');
  });

  it('quietSave does not re-queue when finalising or finalised', () => {
    const quietSaveBody = extractFunctionBody(appJsSource, 'quietSave');
    assert.ok(quietSaveBody.includes("!_finalising && currentRecordStatus !== 'finalised'"),
      'quietSave finally block must check _finalising and currentRecordStatus before re-queuing');
  });

  it('preload exposes attendanceForceStatus', () => {
    const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    assert.ok(preloadSource.includes('attendanceForceStatus'),
      'preload must expose attendanceForceStatus');
  });

  it('main.js has attendance-force-status IPC handler', () => {
    const mainJsSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.ok(mainJsSource.includes("ipcMain.handle('attendance-force-status'"),
      'main.js must have attendance-force-status handler');
    const handler = mainJsSource.substring(
      mainJsSource.indexOf("ipcMain.handle('attendance-force-status'"),
      mainJsSource.indexOf("ipcMain.handle('attendance-force-status'") + 1000
    );
    assert.ok(handler.includes("force_finalised"),
      'handler must log force_finalised action in audit log');
  });
});

describe('Backup scheduler integration in main.js', () => {
  it('main.js uses backupScheduler instead of 2-minute setInterval', () => {
    const mainJsSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.ok(!mainJsSource.includes("setInterval(runQuickBackup, 2 * 60 * 1000)"),
      'must NOT have 2-minute setInterval for quick backup');
    assert.ok(!mainJsSource.includes("setInterval(runHourlyBackup, 60 * 60 * 1000)"),
      'must NOT have hourly setInterval for hourly backup');
    assert.ok(mainJsSource.includes("createBackupScheduler"),
      'main.js must use createBackupScheduler');
    assert.ok(mainJsSource.includes("getBackupScheduler()"),
      'main.js must initialise the backup scheduler');
  });

  it('markDbDirty notifies the backup scheduler', () => {
    const mainJsSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const markDbDirtyBody = extractFunctionBody(mainJsSource, 'markDbDirty');
    assert.ok(markDbDirtyBody, 'markDbDirty must exist');
    assert.ok(markDbDirtyBody.includes('bs.markDirty') || markDbDirtyBody.includes('_backupScheduler'),
      'markDbDirty must notify the backup scheduler');
  });

  it('editor-activity IPC handler notifies backup scheduler', () => {
    const mainJsSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.ok(mainJsSource.includes("ipcMain.on('editor-activity'"),
      'main.js must have editor-activity IPC handler');
  });

  it('backup-status IPC handler returns scheduler status', () => {
    const mainJsSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.ok(mainJsSource.includes("ipcMain.handle('backup-status'"),
      'main.js must have backup-status IPC handler');
  });
});

describe('Preload bridge', () => {
  it('exposes backup-status and editor-activity IPC methods', () => {
    const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    assert.ok(preloadSource.includes('backupStatus'),
      'preload must expose backupStatus');
    assert.ok(preloadSource.includes('reportEditorActivity'),
      'preload must expose reportEditorActivity');
    assert.ok(preloadSource.includes('onBackupStatusChanged'),
      'preload must expose onBackupStatusChanged');
  });
});

function extractFunctionBody(source, funcName) {
  const patterns = [
    'function ' + funcName + '(',
    'function ' + funcName + ' (',
  ];
  let idx = -1;
  for (const p of patterns) {
    idx = source.indexOf(p);
    if (idx !== -1) break;
  }
  if (idx === -1) return null;
  let depth = 0;
  let started = false;
  for (let i = idx; i < source.length; i++) {
    if (source[i] === '{') { depth++; started = true; }
    if (source[i] === '}') { depth--; }
    if (started && depth === 0) return source.substring(idx, i + 1);
  }
  return null;
}

function extractNestedFunction(parentBody, funcName) {
  if (!parentBody) return null;
  return extractFunctionBody(parentBody, funcName);
}
