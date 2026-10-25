'use strict';

/**
 * AES-GCM encrypt/decrypt using a server-issued per-account wrap key (32-byte hex).
 * The wrap key is never derived from the licence key string.
 */

const crypto = require('crypto');

const MAGIC = Buffer.from('CNQFCR1');

function keyFromHex(wrapKeyHex) {
  const hex = String(wrapKeyHex || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

function encryptWithWrapKey(wrapKeyHex, payloadObj) {
  const key = keyFromHex(wrapKeyHex);
  if (!key) throw new Error('Invalid wrap key');
  const iv = crypto.randomBytes(12);
  const plain = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, enc]).toString('base64');
}

function decryptWithWrapKey(wrapKeyHex, blob) {
  const key = keyFromHex(wrapKeyHex);
  if (!key || !blob) return null;
  const raw = Buffer.from(String(blob), 'base64');
  if (raw.length < MAGIC.length + 28) return null;
  if (!raw.slice(0, MAGIC.length).equals(MAGIC)) return null;
  const body = raw.slice(MAGIC.length);
  const iv = body.slice(0, 12);
  const tag = body.slice(12, 28);
  const enc = body.slice(28);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const parsed = JSON.parse(dec.toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  MAGIC,
  encryptWithWrapKey,
  decryptWithWrapKey,
  keyFromHex,
};
