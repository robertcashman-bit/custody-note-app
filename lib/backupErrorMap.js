'use strict';

/** Map AWS/SDK errors to user-friendly codes; return { message, code, correlationId }. */
function mapBackupError(err) {
  const correlationId = 'cn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const msg = err && err.message ? String(err.message) : String(err);
  if (!msg) return { message: 'Backup failed: unknown error', code: 'UNKNOWN', correlationId };
  if (/credentials|Credential|Unauthorized|AccessDenied|403|Forbidden/i.test(msg)) {
    return {
      message: 'Backup failed: permission denied. Check your licence and try again.',
      code: 'PERMISSION_DENIED',
      correlationId,
    };
  }
  if (/quota|QuotaExceeded|StorageQuota|507|insufficient storage/i.test(msg)) {
    return {
      message: 'Backup failed: cloud storage quota exceeded. Contact support or free space.',
      code: 'QUOTA_EXCEEDED',
      correlationId,
    };
  }
  if (/bucket|Bucket|NoSuchBucket|InvalidBucket|404/i.test(msg)) {
    return {
      message: 'Backup failed: configuration missing (bucket). Contact support.',
      code: 'CONFIG_MISSING',
      correlationId,
    };
  }
  if (/network|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout|503|502|500/i.test(msg)) {
    return {
      message: 'Backup failed: network or server issue. Check your connection and try again.',
      code: 'NETWORK_ERROR',
      correlationId,
    };
  }
  if (/ObjectLock|object lock/i.test(msg)) {
    return {
      message: 'Backup failed: storage configuration issue. Contact support.',
      code: 'CONFIG_ERROR',
      correlationId,
    };
  }
  return { message: 'Backup failed: ' + msg.slice(0, 80), code: 'ERROR', correlationId };
}

module.exports = { mapBackupError };
