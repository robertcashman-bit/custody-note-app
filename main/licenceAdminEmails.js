/**
 * Resolve which emails receive product-owner admin licence treatment.
 *
 * Packaged installs rarely have process.env set, so a small built-in list of
 * product-owner emails remains as the fail-open fallback for admin licences.
 * CUSTODY_ADMIN_EMAILS (comma-separated) replaces the built-in list when set.
 * licence-config.json may also supply adminEmails.
 *
 * Admin licences are intentionally non-revocable in the desktop client and
 * always re-checked online on startup.
 */
'use strict';

const crypto = require('crypto');

// Built-in entries are stored as SHA-256 hashes of the normalised email so no
// personal email address appears in this public repo or the shipped app.
const BUILTIN_ADMIN_EMAILS = Object.freeze([
  'sha256:5752a0dad8850b5b6683fead3cd189b7f7a876677b22b5e31a391d1215bd94fb',
  'sha256:cae47797906933444ef91301ac6b6eefed3ef8a683db06b421cdddcbbbcee053',
]);

function emailHash(email) {
  return 'sha256:' + crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
}

function normalizeEmailList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const email = String(raw || '').trim();
    const norm = email.startsWith('sha256:') ? email : email.toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function parseAdminEmailsEnv(envValue) {
  if (envValue == null || envValue === '') return [];
  return normalizeEmailList(String(envValue).split(','));
}

/**
 * @param {{ envValue?: string|null, configEmails?: string[]|null, includeBuiltin?: boolean }} [opts]
 * @returns {string[]}
 */
function resolveAdminEmails(opts) {
  const options = opts || {};
  const fromEnv = parseAdminEmailsEnv(options.envValue);
  if (fromEnv.length) return fromEnv;
  const fromConfig = normalizeEmailList(options.configEmails);
  if (fromConfig.length) return fromConfig;
  if (options.includeBuiltin === false) return [];
  return normalizeEmailList(BUILTIN_ADMIN_EMAILS);
}

function isAdminEmail(email, adminEmails) {
  if (!email) return false;
  const list = Array.isArray(adminEmails) ? adminEmails : [];
  const e = String(email).trim().toLowerCase();
  if (!e) return false;
  return list.includes(e) || list.includes(emailHash(e));
}

function isSyntheticLocalLicenceKey(key) {
  const k = String(key || '').toUpperCase();
  return k.startsWith('FREE-') || k.startsWith('TRIAL-');
}

module.exports = {
  BUILTIN_ADMIN_EMAILS,
  emailHash,
  normalizeEmailList,
  parseAdminEmailsEnv,
  resolveAdminEmails,
  isAdminEmail,
  isSyntheticLocalLicenceKey,
};
