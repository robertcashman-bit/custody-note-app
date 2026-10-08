'use strict';

/**
 * Save & Sync button states.
 * "Saved & synced" is claimed only when the disk save, the verified backup,
 * and the cloud push (and pull, when this computer can sync) all succeeded.
 * Dual-export for the renderer and for unit tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.SaveSyncButton = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global, function () {
  var STATES = {
    IDLE: 'idle',
    UNSAVED: 'unsaved',
    SAVING: 'saving',
    SYNCED: 'synced',
    PENDING: 'pending',
    LOCAL_ONLY: 'local_only',
    FAILED: 'failed',
  };

  function pad2(n) {
    var s = String(n);
    return s.length < 2 ? '0' + s : s;
  }

  function formatHm(at, timeLabel) {
    if (timeLabel) return String(timeLabel);
    var d = at ? new Date(at) : new Date();
    if (!at || isNaN(d.getTime())) d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function reasonText(input) {
    var raw = (input && (input.error || input.backupError || input.syncError)) || '';
    raw = String(raw || '').trim();
    if (raw) return raw.slice(0, 180);
    if (input && input.noteDurable === false) return 'The note did not finish writing to disk.';
    if (input && input.backupOk === false) return 'The local backup did not finish.';
    return 'Save did not finish.';
  }

  /**
   * @param {{
   *   phase?: string,
   *   dirty?: boolean,
   *   noteDurable?: boolean,
   *   backupOk?: boolean,
   *   centralConfirmed?: boolean,
   *   pullOk?: boolean|null,
   *   pendingCount?: number,
   *   offline?: boolean,
   *   localOnly?: boolean,
   *   canSync?: boolean,
   *   error?: string|null,
   *   backupError?: string|null,
   *   syncError?: string|null,
   *   at?: string|null,
   *   timeLabel?: string|null,
   * }} input
   */
  function deriveSaveSyncButton(input) {
    var src = input || {};
    if (src.phase === 'saving') {
      return {
        state: STATES.SAVING,
        tone: 'saving',
        label: 'Saving\u2026',
        hint: '',
        title: 'Saving to this computer, writing the backup, then syncing if this computer can. You can keep typing.',
        ariaLabel: 'Saving. You can keep typing.',
      };
    }
    if (src.dirty) {
      return {
        state: STATES.UNSAVED,
        tone: 'unsaved',
        label: 'Unsaved changes',
        hint: '',
        title: 'Edits are on screen. Save & Sync writes them to this computer, backs them up, then syncs if you are signed in.',
        ariaLabel: 'Unsaved changes. Save and sync.',
      };
    }
    var reported = src.noteDurable != null || src.backupOk != null || src.centralConfirmed != null || src.phase === 'result';
    if (!reported || src.phase === 'idle') {
      return {
        state: STATES.IDLE,
        tone: 'idle',
        label: 'Save & Sync',
        hint: '',
        title: 'Save this note to this computer, write a local backup, then sync if you are signed in. Ctrl+S or Cmd+S.',
        ariaLabel: 'Save and sync',
      };
    }
    if (src.noteDurable === false || src.backupOk === false) {
      var why = reasonText(src);
      return {
        state: STATES.FAILED,
        tone: 'failed',
        label: "Couldn't save",
        hint: why,
        title: "Couldn't save. " + why,
        ariaLabel: "Couldn't save. " + why,
      };
    }
    var localOnly = src.localOnly === true || src.canSync === false;
    if (localOnly) {
      return {
        state: STATES.LOCAL_ONLY,
        tone: 'local',
        label: 'Saved on this computer',
        hint: 'Sign in to sync',
        title: 'Saved on this computer. Sign in with email to sync your computers. Nothing was deleted.',
        ariaLabel: 'Saved on this computer. Sign in to sync.',
      };
    }
    var pending = Number(src.pendingCount) || 0;
    var fullySynced = src.noteDurable === true
      && src.backupOk === true
      && src.centralConfirmed === true
      && src.pullOk === true
      && pending === 0
      && !src.offline;
    if (fullySynced) {
      var hm = formatHm(src.at, src.timeLabel);
      return {
        state: STATES.SYNCED,
        tone: 'synced',
        label: '\u2713 Saved & synced ' + hm,
        hint: '',
        title: 'Saved on this computer, backup written, and the cloud push and pull succeeded at ' + hm + '.',
        ariaLabel: 'Saved and synced at ' + hm,
      };
    }
    var pendingWhy = src.offline
      ? 'This computer is offline. The note stays here and will sync later.'
      : 'Sync is queued. The note stays on this computer and will sync later.';
    if (src.syncError) pendingWhy = pendingWhy + ' ' + String(src.syncError).slice(0, 140);
    else if (src.pullOk === false) pendingWhy = pendingWhy + ' The cloud pull did not finish.';
    return {
      state: STATES.PENDING,
      tone: 'pending',
      label: 'Saved on this computer, sync pending',
      hint: '',
      title: pendingWhy,
      ariaLabel: 'Saved on this computer, sync pending.',
    };
  }

  return {
    STATES: STATES,
    formatHm: formatHm,
    deriveSaveSyncButton: deriveSaveSyncButton,
  };
});
