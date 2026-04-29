// scripts/bundle-sqljs.mjs
// ---------------------------------------------------------------------------
// Copies sql.js wasm + js shim from node_modules into ./vendor so the PWA can
// load them from the same origin instead of https://sql.js.org.
//
// Why: loading the SQLite engine that processes confidential client data from
// a third-party CDN is a one-flag-flip data-exfil risk. Bundling it locally:
//   - removes the CDN as an attacker reach,
//   - lets us drop sql.js.org from the browser CSP entirely,
//   - means the PWA still works offline,
//   - lets us pin the integrity hash on the script tag.
//
// Run automatically by `npm run prebuild` and by Vercel via the `build`
// command in vercel.json.
//
// Idempotent. Prints a SHA-384 SRI hash for the script tag.
import { createHash } from 'node:crypto';
import { mkdirSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const src  = join(root, 'node_modules', 'sql.js', 'dist');
const dst  = join(root, 'vendor', 'sqljs');

const FILES = ['sql-wasm.js', 'sql-wasm.wasm'];

if (!existsSync(src)) {
  console.error('[bundle-sqljs] sql.js not installed; run `npm install` first.');
  process.exit(1);
}

mkdirSync(dst, { recursive: true });
for (const f of FILES) {
  const from = join(src, f);
  const to   = join(dst, f);
  if (!existsSync(from)) {
    console.error('[bundle-sqljs] missing ' + from);
    process.exit(1);
  }
  copyFileSync(from, to);
}

const wasmJs = readFileSync(join(dst, 'sql-wasm.js'));
const sri = 'sha384-' + createHash('sha384').update(wasmJs).digest('base64');
console.log('[bundle-sqljs] ok — vendor/sqljs/sql-wasm.js integrity ' + sri);
console.log('[bundle-sqljs] paste this into browser-api.js _SQLJS_SRI');
