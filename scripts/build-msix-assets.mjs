#!/usr/bin/env node
/**
 * Generate Microsoft Store / AppX visual assets from custody-note-icon.png.
 * electron-builder looks in build/appx/ for these filenames.
 *
 * Run: npm run build:msix:assets
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'custody-note-icon.png');
const outDir = path.join(root, 'build', 'appx');

if (!fs.existsSync(src)) {
  console.error('Missing custody-note-icon.png');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const jobs = [
  { name: 'StoreLogo.png', w: 50, h: 50 },
  { name: 'Square44x44Logo.png', w: 44, h: 44 },
  { name: 'Square150x150Logo.png', w: 150, h: 150 },
  { name: 'Square310x310Logo.png', w: 310, h: 310 },
  { name: 'Wide310x150Logo.png', w: 310, h: 150 },
  { name: 'SplashScreen.png', w: 620, h: 300 },
];

const bg = { r: 15, g: 23, b: 42, alpha: 1 };

for (const job of jobs) {
  const dest = path.join(outDir, job.name);
  /* Contain icon on brand-dark canvas so wide/splash assets are not stretched. */
  const iconSize = Math.round(Math.min(job.w, job.h) * (job.w / job.h > 1.5 ? 0.72 : 0.88));
  const icon = await sharp(src)
    .resize(iconSize, iconSize, { fit: 'contain', background: bg })
    .png()
    .toBuffer();
  await sharp({
    create: { width: job.w, height: job.h, channels: 4, background: bg },
  })
    .composite([{ input: icon, gravity: 'centre' }])
    .png()
    .toFile(dest);
  console.log('Wrote', path.relative(root, dest));
}

console.log('AppX/MSIX assets ready in build/appx/');
