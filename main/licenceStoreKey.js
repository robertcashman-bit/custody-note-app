/**
 * Licence store encryption key management.
 * Uses Electron safeStorage (OS keychain) for key persistence.
 * Key never stored in renderer, config, or logs.
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const SERVICE = 'CustodyNote';
const ACCOUNT = 'db_key';
const FALLBACK_FILENAME = 'licence-store.key';

function getKeyPath(app) {
  return path.join(app.getPath('userData'), FALLBACK_FILENAME);
}

function getLicenceStoreKey(app, safeStorage) {
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    const keyPath = getKeyPath(app);
    if (fs.existsSync(keyPath)) {
      try {
        const enc = fs.readFileSync(keyPath);
        const dec = safeStorage.decryptString(enc);
        const buf = Buffer.from(dec, 'hex');
        if (buf.length === 32) return buf;
      } catch (e) {
        console.warn('[LicenceStore] Cannot decrypt key:', e.message);
      }
    }
    const key = crypto.randomBytes(32);
    try {
      const enc = safeStorage.encryptString(key.toString('hex'));
      fs.writeFileSync(keyPath, enc);
    } catch (e) {
      console.error('[LicenceStore] Failed to persist key:', e.message);
    }
    return key;
  }
  const fallbackPath = getKeyPath(app);
  if (fs.existsSync(fallbackPath)) {
    try {
      const hex = fs.readFileSync(fallbackPath, 'utf8').trim();
      const buf = Buffer.from(hex, 'hex');
      if (buf.length === 32) return buf;
    } catch (_) {}
  }
  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(fallbackPath, key.toString('hex'), 'utf8');
  } catch (e) {
    console.error('[LicenceStore] Failed to write fallback key:', e.message);
  }
  return key;
}

module.exports = { getLicenceStoreKey };
