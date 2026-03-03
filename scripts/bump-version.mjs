/**
 * Auto-bumps the patch version and sets lastUpdated in package.json.
 * Runs automatically before `npm run build` via the prebuild script.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const parts = (pkg.version || '0.0.0').split('.').map(Number);
parts[2] = (parts[2] || 0) + 1;
pkg.version = parts.join('.');

const today = new Date();
pkg.lastUpdated = today.toISOString().slice(0, 10);

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`Version bumped to ${pkg.version} (${pkg.lastUpdated})`);
