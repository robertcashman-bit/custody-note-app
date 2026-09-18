'use strict';

const crypto = require('crypto');

const MAGIC = 'CNSYNC';
const MAGIC_LEN = Buffer.byteLength(MAGIC);

function encryptSyncEnvelope(masterKeyHex, payloadObj) {
  const key = Buffer.from(masterKeyHex, 'hex');
  if (key.length !== 32) throw new Error('Invalid master key');
  const iv = crypto.randomBytes(12);
  const plain = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from(MAGIC), iv, tag, enc]).toString('base64');
}

/**
 * Decrypt a sync envelope.
 *
 * Hostile-cloud default: plaintext JSON blobs are REJECTED (return null).
 * A compromised cloud store must not inject note bodies that skip AES-GCM.
 *
 * Legacy plaintext is only accepted when opts.allowLegacyPlaintext === true
 * (local migration / explicit tests). Production pull paths never set this.
 *
 * @param {string} masterKeyHex
 * @param {string|Buffer} blob
 * @param {{ allowLegacyPlaintext?: boolean }} [opts]
 * @returns {object|null}
 */
function decryptSyncEnvelope(masterKeyHex, blob, opts) {
  if (!blob) return null;
  const allowLegacy = !!(opts && opts.allowLegacyPlaintext === true);
  if (typeof blob === 'string') {
    const trimmed = blob.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      if (!allowLegacy) return null;
      try {
        return JSON.parse(blob);
      } catch {
        return null;
      }
    }
  }
  const raw = Buffer.from(String(blob), 'base64');
  if (raw.length < MAGIC_LEN + 12 + 16 || raw.slice(0, MAGIC_LEN).toString() !== MAGIC) {
    return null;
  }
  const iv = raw.slice(MAGIC_LEN, MAGIC_LEN + 12);
  const tag = raw.slice(MAGIC_LEN + 12, MAGIC_LEN + 12 + 16);
  const data = raw.slice(MAGIC_LEN + 12 + 16);
  const key = Buffer.from(masterKeyHex, 'hex');
  if (key.length !== 32) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = { encryptSyncEnvelope, decryptSyncEnvelope, MAGIC };
