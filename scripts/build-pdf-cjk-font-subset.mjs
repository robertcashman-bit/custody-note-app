#!/usr/bin/env node
/**
 * Rebuild resources/fonts/NotoSansSC-Subset.woff2 from Noto Sans SC (OFL).
 * Requires: pip install fonttools brotli (pyftsubset on PATH).
 *
 * Run: node scripts/build-pdf-cjk-font-subset.mjs
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'resources', 'fonts');
const outFile = path.join(outDir, 'NotoSansSC-Subset.woff2');
const licenseFile = path.join(outDir, 'OFL.txt');
const otfUrl = 'https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf';
const licenseUrl = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE';

const UNICODES =
  'U+0020-007E,U+00A0-00FF,U+0100-017F,U+2000-206F,U+3000-303F,U+4E00-62FF';

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status == null ? 1 : r.status);
}

fs.mkdirSync(outDir, { recursive: true });

const tmpOtf = path.join(outDir, '.NotoSansSC-Regular.otf.download');
if (!fs.existsSync(tmpOtf)) {
  console.log('[pdf-cjk-font] Downloading', otfUrl);
  run('curl', ['-fsSL', '-o', tmpOtf, otfUrl]);
}

if (!fs.existsSync(licenseFile)) {
  console.log('[pdf-cjk-font] Downloading OFL');
  run('curl', ['-fsSL', '-o', licenseFile, licenseUrl]);
}

const pyft = process.env.PYFTSUBSET || 'pyftsubset';
console.log('[pdf-cjk-font] Subsetting with', pyft);
run(pyft, [
  tmpOtf,
  `--unicodes=${UNICODES}`,
  '--layout-features=*',
  '--glyph-names',
  '--symbol-cmap',
  '--legacy-cmap',
  '--notdef-glyph',
  '--notdef-outline',
  '--recommended-glyphs',
  '--flavor=woff2',
  `--output-file=${outFile}`,
]);

const bytes = fs.statSync(outFile).size;
console.log('[pdf-cjk-font] Wrote', path.relative(root, outFile), `(${bytes} bytes)`);
