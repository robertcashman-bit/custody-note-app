#!/usr/bin/env node
/**
 * Fails (exit 1) when changelog.json contains personal data or internal
 * security/architecture detail. Run before syncing the website or publishing.
 * See lib/publicReleaseNotes.js for the rules.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { findPublicNotesViolations } = require('../lib/publicReleaseNotes.js');
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || join(APP_ROOT, 'changelog.json');
const data = JSON.parse(readFileSync(file, 'utf8'));
const violations = findPublicNotesViolations(data.releases || []);
if (violations.length) {
  console.error(`[public-notes] ${violations.length} changelog line(s) are not suitable for public release notes:`);
  for (const v of violations.slice(0, 50)) {
    console.error(`  v${v.version} #${v.index}: ${v.reasons.join(', ')} :: ${v.text}`);
  }
  console.error('[public-notes] Rewrite as short customer-level lines (see lib/publicReleaseNotes.js).');
  process.exit(1);
}
console.log(`[public-notes] OK — ${(data.releases || []).length} releases are customer-level.`);
