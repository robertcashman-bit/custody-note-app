'use strict';

/**
 * Public release-notes guard.
 *
 * changelog.json is PUBLIC: it is committed to this public repo, synced to
 * custodynote.com/changelog (data/releases.json), used for release blog posts
 * and may be used as the GitHub release body. Entries must be short,
 * customer-level lines. Do NOT include:
 *   - personal data (customer / staff email addresses or names)
 *   - internal security or architecture detail (IPC channels, rate limits,
 *     trusted frames, password/recovery/key-escrow mechanics, sync IDs,
 *     backup internals, filesystem paths, audit tooling, allow-lists,
 *     server/API/AWS behaviour, env var names, file or function names)
 * Keep that detail in PR descriptions / private engineering notes instead.
 *
 * Good: "Security improvements to administrative authentication and local file handling"
 * Good: "Improved encrypted cross-device sync and recovery reliability"
 */

const ALLOWED_EMAIL_DOMAINS = ['custodynote.com', 'defencelegalservices.co.uk', 'example.com'];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

const DENY = [
  [/\bIPC\b/i, 'IPC channel detail'],
  [/file:\/\//i, 'file:// / trusted frame detail'],
  [/trusted frame|calling frame/i, 'trusted frame detail'],
  [/escrow/i, 'key escrow detail'],
  [/PBKDF2|argon2|scrypt/i, 'key-derivation detail'],
  [/master key|encryption\.key|safeStorage/i, 'key management detail'],
  [/\bsync_?ids?\b|syncId|outbox|tombstone|envelope/i, 'sync implementation detail'],
  [/\bBearer\b|\bJWT\b|auth headers?/i, 'auth mechanism detail'],
  [/\bCSP\b|script-src|unsafe-inline|contextIsolation|nodeIntegration|preload/i, 'Electron hardening detail'],
  [/allow-?list|whitelist/i, 'allow-list implementation detail'],
  [/rate[- ]?limit|\b429\b|Retry-After|attempts per minute/i, 'rate-limit detail'],
  [/path[- ]traversal|realpath|symlink/i, 'filesystem handling detail'],
  [/\bAWS\b|\bS3\b|eu-west|Upstash|\bKV\b|Vercel|Supabase|Redis/i, 'infrastructure detail'],
  [/\/api\/[a-z]/i, 'API route detail'],
  [/npm audit|security:audit|secret scann|semgrep|gitleaks/i, 'security tooling detail'],
  [/\b[A-Z][A-Z0-9]+_[A-Z0-9_]{3,}\b/, 'env var / constant name'],
  [/\b[\w-]+\.(?:js|mjs|ts|db|md)\b|\b(?:lib|scripts|docs|tests|main)\//, 'file or path name'],
  [/\bPRs? #\d+/i, 'internal PR reference'],
  [/forensic|incident response|investigation\.md/i, 'internal incident detail'],
];

function findViolationsInText(text) {
  const out = [];
  const s = String(text || '');
  let m;
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(s)) !== null) {
    const domain = m[1].toLowerCase();
    if (!ALLOWED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) {
      out.push('personal / third-party email address');
    }
  }
  for (const [re, label] of DENY) {
    if (re.test(s)) out.push(label);
  }
  return out;
}

/**
 * @param {{ version: string, changes: string[] }[]} releases
 * @returns {{ version: string, index: number, reasons: string[], text: string }[]}
 */
function findPublicNotesViolations(releases) {
  const violations = [];
  for (const rel of Array.isArray(releases) ? releases : []) {
    const changes = Array.isArray(rel && rel.changes) ? rel.changes : [];
    changes.forEach((text, index) => {
      const reasons = findViolationsInText(text);
      if (reasons.length) {
        violations.push({ version: rel.version, index, reasons, text: String(text).slice(0, 120) });
      }
    });
  }
  return violations;
}

/** Customer-level markdown body for a GitHub release. */
function buildPublicReleaseBody(release) {
  const changes = (release && Array.isArray(release.changes) ? release.changes : []).filter(
    (c) => findViolationsInText(c).length === 0,
  );
  const lines = changes.map((c) => '- ' + c);
  lines.push('', 'Full changelog: https://custodynote.com/changelog');
  return lines.join('\n');
}

module.exports = {
  ALLOWED_EMAIL_DOMAINS,
  findViolationsInText,
  findPublicNotesViolations,
  buildPublicReleaseBody,
};
