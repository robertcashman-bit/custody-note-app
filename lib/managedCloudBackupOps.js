'use strict';

const { mapBackupError } = require('./backupErrorMap');

const MANAGED_BACKUP_MAX_RETRIES = 3;
const MANAGED_BACKUP_INITIAL_DELAY_MS = 1000;

/**
 * Upload one backup object with exponential backoff.
 * @param {{ creds: object, key: string, buffer: Buffer, createClient: Function, sleep?: Function }} opts
 */
async function uploadManagedCloudBackupWithRetry(opts) {
  const creds = opts.creds;
  const buffer = opts.buffer;
  const key = opts.key;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  if (!creds || !buffer || !key) {
    return { ok: false, error: 'Backup failed: missing upload parameters.', code: 'INVALID' };
  }
  const createClient = opts.createClient;
  if (typeof createClient !== 'function') {
    return { ok: false, error: 'Backup failed: storage client unavailable.', code: 'CONFIG' };
  }

  async function doUpload(attempt) {
    const client = createClient(creds);
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3Key = `${creds.prefix}/${key}`;
    await client.send(
      new PutObjectCommand({
        Bucket: creds.bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: 'application/octet-stream',
      })
    );
    return { ok: true, s3Key };
  }

  let lastMapped = null;
  for (let attempt = 1; attempt <= MANAGED_BACKUP_MAX_RETRIES; attempt++) {
    try {
      const result = await doUpload(attempt);
      return { ...result, correlationId: null };
    } catch (err) {
      lastMapped = mapBackupError(err);
      if (attempt < MANAGED_BACKUP_MAX_RETRIES && lastMapped.code === 'NETWORK_ERROR') {
        await sleep(MANAGED_BACKUP_INITIAL_DELAY_MS * Math.pow(2, attempt - 1));
        continue;
      }
      return {
        ok: false,
        error: lastMapped.message + ' (Ref: ' + lastMapped.correlationId + ')',
        code: lastMapped.code,
        correlationId: lastMapped.correlationId,
      };
    }
  }
  return {
    ok: false,
    error: (lastMapped && lastMapped.message) || 'Backup failed',
    code: (lastMapped && lastMapped.code) || 'ERROR',
    correlationId: lastMapped && lastMapped.correlationId,
  };
}

async function downloadManagedCloudBackupObject(opts) {
  const { creds, backupKey, createClient } = opts;
  if (!creds || !backupKey) return { ok: false, error: 'Invalid backup key' };
  const client = createClient(creds);
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3Key = `${creds.prefix}/${backupKey}`;
  const resp = await client.send(new GetObjectCommand({ Bucket: creds.bucket, Key: s3Key }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return { ok: true, buffer: Buffer.concat(chunks), s3Key };
}

async function listManagedCloudBackupKeys(opts) {
  const { creds, createClient } = opts;
  const client = createClient(creds);
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const resp = await client.send(
    new ListObjectsV2Command({ Bucket: creds.bucket, Prefix: creds.prefix + '/' })
  );
  const contents = resp.Contents || [];
  return contents.map((o) => ({
    key: String(o.Key || '').replace(new RegExp('^' + creds.prefix + '/'), ''),
    lastModified: o.LastModified,
    size: o.Size,
  }));
}

module.exports = {
  uploadManagedCloudBackupWithRetry,
  downloadManagedCloudBackupObject,
  listManagedCloudBackupKeys,
  MANAGED_BACKUP_MAX_RETRIES,
};
