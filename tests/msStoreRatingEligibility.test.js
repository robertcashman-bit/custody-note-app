const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateMsStoreRatingEligibility,
  snoozeUntilIso,
  MIN_DAYS_SINCE_FIRST_LAUNCH,
  MIN_SAVED_ATTENDANCE_NOTES,
  SNOOZE_DAYS,
  MAX_PROMPTS,
  MS_STORE_REVIEW_URL,
} = require('../lib/msStoreRatingEligibility');
const { isWindowsStoreBuild } = require('../lib/isWindowsStoreBuild');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-24T12:00:00.000Z');
const FIRST_LAUNCH = new Date(NOW - MIN_DAYS_SINCE_FIRST_LAUNCH * DAY - DAY).toISOString();

function baseInput(overrides) {
  return Object.assign({
    isWindowsStoreBuild: true,
    platform: 'win32',
    firstLaunchAtIso: FIRST_LAUNCH,
    savedAttendanceCount: MIN_SAVED_ATTENDANCE_NOTES,
    neverAsk: '',
    promptCount: '0',
    snoozeUntilIso: '',
    nowMs: NOW,
    moment: {
      calmUiMoment: true,
      onRecordsList: true,
      onActiveNoteForm: false,
      saveInProgress: false,
      syncInProgress: false,
      startupSyncSettling: false,
    },
  }, overrides || {});
}

describe('isWindowsStoreBuild', () => {
  it('is false on macOS', () => {
    assert.equal(isWindowsStoreBuild({ platform: 'darwin', windowsStore: true }), false);
  });

  it('is true when process.windowsStore is true', () => {
    assert.equal(isWindowsStoreBuild({ platform: 'win32', windowsStore: true }), true);
  });

  it('is false for typical NSIS install path', () => {
    assert.equal(
      isWindowsStoreBuild({
        platform: 'win32',
        windowsStore: false,
        execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Custody Note\\Custody Note.exe',
      }),
      false
    );
  });

  it('is true for WindowsApps install path', () => {
    assert.equal(
      isWindowsStoreBuild({
        platform: 'win32',
        execPath: 'C:\\Program Files\\WindowsApps\\Publisher.CustodyNote_1.0.0.0_x64__abc\\Custody Note.exe',
      }),
      true
    );
  });

  it('is true when distribution channel env marks msix', () => {
    assert.equal(
      isWindowsStoreBuild({ platform: 'win32', distributionChannel: 'msix' }),
      true
    );
  });

  it('is true when distribution channel marks appx (CUSTODYNOTE_CHANNEL)', () => {
    assert.equal(
      isWindowsStoreBuild({ platform: 'win32', distributionChannel: 'appx' }),
      true
    );
  });
});

describe('evaluateMsStoreRatingEligibility', () => {
  it('eligible on store build when thresholds and calm moment met', () => {
    const r = evaluateMsStoreRatingEligibility(baseInput());
    assert.equal(r.eligible, true);
    assert.equal(r.reason, 'ok');
  });

  it('rejects non-store builds', () => {
    const r = evaluateMsStoreRatingEligibility(baseInput({ isWindowsStoreBuild: false }));
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'not_store_build');
  });

  it('rejects before minimum days since first launch', () => {
    const r = evaluateMsStoreRatingEligibility(baseInput({
      firstLaunchAtIso: new Date(NOW - 2 * DAY).toISOString(),
    }));
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'too_soon_since_first_launch');
  });

  it('rejects when not enough saved attendance notes', () => {
    const r = evaluateMsStoreRatingEligibility(baseInput({
      savedAttendanceCount: MIN_SAVED_ATTENDANCE_NOTES - 1,
    }));
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'not_enough_saved_notes');
  });

  it('respects never-again setting', () => {
    const r = evaluateMsStoreRatingEligibility(baseInput({ neverAsk: 'true' }));
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'never_ask');
  });

  it('respects snooze until date', () => {
    const r = evaluateMsStoreRatingEligibility(baseInput({
      snoozeUntilIso: new Date(NOW + 5 * DAY).toISOString(),
    }));
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'snoozed');
  });

  it('allows after snooze expires', () => {
    const r = evaluateMsStoreRatingEligibility(baseInput({
      snoozeUntilIso: new Date(NOW - DAY).toISOString(),
    }));
    assert.equal(r.eligible, true);
  });

  it('stops after max prompts', () => {
    const r = evaluateMsStoreRatingEligibility(baseInput({ promptCount: String(MAX_PROMPTS) }));
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'max_prompts');
  });

  it('blocks during save or sync or active note', () => {
    assert.equal(
      evaluateMsStoreRatingEligibility(baseInput({
        moment: Object.assign({}, baseInput().moment, { saveInProgress: true }),
      })).reason,
      'save_in_progress'
    );
    assert.equal(
      evaluateMsStoreRatingEligibility(baseInput({
        moment: Object.assign({}, baseInput().moment, { syncInProgress: true }),
      })).reason,
      'sync_in_progress'
    );
    assert.equal(
      evaluateMsStoreRatingEligibility(baseInput({
        moment: Object.assign({}, baseInput().moment, { onActiveNoteForm: true }),
      })).reason,
      'active_note'
    );
  });

  it('snooze helper uses 30 days', () => {
    const iso = snoozeUntilIso(NOW);
    const delta = Date.parse(iso) - NOW;
    assert.equal(Math.round(delta / DAY), SNOOZE_DAYS);
  });

  it('review URL uses Microsoft Store product id', () => {
    assert.match(MS_STORE_REVIEW_URL, /9NFSRVT3T45V/);
    assert.match(MS_STORE_REVIEW_URL, /^ms-windows-store:\/\//);
  });
});
