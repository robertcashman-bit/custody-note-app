'use strict';

const { MAGIC } = require('./dbCrypto');

/**
 * Non-destructive assessment of an on-disk encrypted CNDB file.
 * @param {Buffer|null} buf
 * @returns {{ ok: boolean, magicOk: boolean, bytes: number, reason: string }}
 */
function assessEncryptedDbFile(buf) {
  if (!buf || !Buffer.isBuffer(buf)) {
    return { ok: false, magicOk: false, bytes: 0, reason: 'missing_buffer' };
  }
  const bytes = buf.length;
  if (bytes < 32) {
    return { ok: false, magicOk: false, bytes, reason: 'suspiciously_small' };
  }
  const magicOk = buf.slice(0, 4).toString() === MAGIC;
  if (!magicOk) {
    return { ok: false, magicOk: false, bytes, reason: 'bad_magic' };
  }
  return { ok: true, magicOk: true, bytes, reason: 'ok' };
}

module.exports = { assessEncryptedDbFile };
