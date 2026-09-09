'use strict';

/**
 * User-facing copy for Save now / persist-and-backup results.
 * No case content — paths and success/failure only.
 */

function buildSaveNowUserMessage(result = {}) {
  const folder = result.effectiveBackupFolder || result.backupFolder || null;
  const backupPath = result.backupPath || null;
  const offsite = result.offsiteBackupFolder || null;

  if (result.noteDurable && result.backupOk) {
    let msg = 'Saved to this computer';
    if (backupPath || folder) {
      msg += '. Backup written to ' + (backupPath || folder);
    }
    if (offsite) msg += ' (off-site also: ' + offsite + ')';
    return { level: 'success', message: msg };
  }

  if (result.noteDurable && !result.backupOk) {
    return {
      level: 'warning',
      message:
        'Note saved to this computer, but backup failed' +
        (result.error ? ': ' + result.error : '') +
        (folder ? '. Intended folder: ' + folder : '') +
        '. Open Settings → Backup.',
    };
  }

  return {
    level: 'error',
    message:
      'Could not save note to disk' +
      (result.error ? ': ' + result.error : '') +
      '. Keep this record open and try Save now again.',
  };
}

module.exports = {
  buildSaveNowUserMessage,
};
