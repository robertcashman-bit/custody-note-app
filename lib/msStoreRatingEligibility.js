'use strict';

const MS_STORE_PRODUCT_ID = '9NFSRVT3T45V';
const MS_STORE_REVIEW_URL = 'ms-windows-store://review/?ProductId=' + MS_STORE_PRODUCT_ID;

const MIN_DAYS_SINCE_FIRST_LAUNCH = 7;
const MIN_SAVED_ATTENDANCE_NOTES = 5;
const SNOOZE_DAYS = 30;
const MAX_PROMPTS = 2;

const MS = 24 * 60 * 60 * 1000;

function parseCount(raw) {
  const n = parseInt(String(raw == null ? '' : raw).trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseIsoMs(iso) {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? t : null;
}

function truthySetting(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Pure eligibility for the Microsoft Store rating prompt.
 * @param {object} input
 * @returns {{ eligible: boolean, reason: string }}
 */
function evaluateMsStoreRatingEligibility(input) {
  const p = input || {};
  const nowMs = Number.isFinite(p.nowMs) ? p.nowMs : Date.now();

  if (!p.isWindowsStoreBuild) {
    return { eligible: false, reason: 'not_store_build' };
  }
  if (p.platform && p.platform !== 'win32') {
    return { eligible: false, reason: 'not_windows' };
  }
  if (truthySetting(p.neverAsk)) {
    return { eligible: false, reason: 'never_ask' };
  }

  const promptCount = parseCount(p.promptCount);
  if (promptCount >= MAX_PROMPTS) {
    return { eligible: false, reason: 'max_prompts' };
  }

  const snoozeUntilMs = parseIsoMs(p.snoozeUntilIso);
  if (snoozeUntilMs != null && nowMs < snoozeUntilMs) {
    return { eligible: false, reason: 'snoozed' };
  }

  const firstLaunchMs = parseIsoMs(p.firstLaunchAtIso);
  if (firstLaunchMs == null) {
    return { eligible: false, reason: 'no_first_launch' };
  }
  const daysSinceFirst = (nowMs - firstLaunchMs) / MS;
  if (daysSinceFirst < MIN_DAYS_SINCE_FIRST_LAUNCH) {
    return { eligible: false, reason: 'too_soon_since_first_launch' };
  }

  const savedCount = parseCount(p.savedAttendanceCount);
  if (savedCount < MIN_SAVED_ATTENDANCE_NOTES) {
    return { eligible: false, reason: 'not_enough_saved_notes' };
  }

  const moment = p.moment || {};
  if (!moment.calmUiMoment) {
    return { eligible: false, reason: 'bad_moment' };
  }
  if (moment.saveInProgress) {
    return { eligible: false, reason: 'save_in_progress' };
  }
  if (moment.syncInProgress) {
    return { eligible: false, reason: 'sync_in_progress' };
  }
  if (moment.onActiveNoteForm) {
    return { eligible: false, reason: 'active_note' };
  }
  if (!moment.onRecordsList) {
    return { eligible: false, reason: 'not_on_list' };
  }
  if (moment.startupSyncSettling) {
    return { eligible: false, reason: 'startup_sync' };
  }

  return { eligible: true, reason: 'ok' };
}

function snoozeUntilIso(nowMs) {
  const base = Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(base + SNOOZE_DAYS * MS).toISOString();
}

module.exports = {
  MS_STORE_PRODUCT_ID,
  MS_STORE_REVIEW_URL,
  MIN_DAYS_SINCE_FIRST_LAUNCH,
  MIN_SAVED_ATTENDANCE_NOTES,
  SNOOZE_DAYS,
  MAX_PROMPTS,
  evaluateMsStoreRatingEligibility,
  snoozeUntilIso,
};
