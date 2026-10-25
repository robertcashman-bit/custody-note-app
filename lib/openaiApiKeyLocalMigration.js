'use strict';

const LOCAL_FALLBACK_BASENAME = 'openai-api-key.local';
const SEALED_BASENAME = 'openai-api-key.dat';

/**
 * Choose plaintext to migrate into the sealed store (DB column preferred over legacy file).
 * @returns {{ key: string, source: 'db'|'local-file'|'none' }}
 */
function pickPlaintextOpenAiKeyForMigration(dbPlaintext, localFilePlaintext) {
  const db = String(dbPlaintext || '').trim();
  const local = String(localFilePlaintext || '').trim();
  if (db) return { key: db, source: 'db' };
  if (local) return { key: local, source: 'local-file' };
  return { key: '', source: 'none' };
}

/**
 * Side effects safe only after persistOpenAiApiKeySecure returned true.
 */
function planPostSealCleanup({ sealedOk, hadDbPlaintext, hadLocalFile }) {
  return {
    clearDbPlaintext: !!(sealedOk && hadDbPlaintext),
    deleteLocalFile: !!(sealedOk && hadLocalFile),
  };
}

/** One server pull before showing "missing key" when local cache is empty or sealed-but-unreadable. */
function shouldForceServerPullBeforeAi({ localKey, sealedUnreadable }) {
  return !String(localKey || '').trim() || !!sealedUnreadable;
}

/** Only seal leftover plaintext when the sealed store does not already hold a working key. */
function shouldSealPlaintextKey({ sealedKey, plaintextKey }) {
  if (!String(plaintextKey || '').trim()) return false;
  return !String(sealedKey || '').trim();
}

module.exports = {
  shouldSealPlaintextKey,
  LOCAL_FALLBACK_BASENAME,
  SEALED_BASENAME,
  pickPlaintextOpenAiKeyForMigration,
  planPostSealCleanup,
  shouldForceServerPullBeforeAi,
};
