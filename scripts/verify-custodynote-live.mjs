#!/usr/bin/env node
/**
 * Verify https://custodynote.com/ first-screen markers after a production deploy.
 * Exit 0 only when the new display is live (or left the stale pre-PR2/3 build).
 *
 * Usage: node scripts/verify-custodynote-live.mjs [--html /tmp/live.html] [--write-proof /tmp/live-proof]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    );
    req.on('error', reject);
  });
}

async function main() {
  const htmlPath = argValue('--html');
  const proofDir = argValue('--write-proof');
  const url = argValue('--url') || 'https://custodynote.com/';
  let html;
  if (htmlPath && fs.existsSync(htmlPath)) {
    html = fs.readFileSync(htmlPath, 'utf8');
  } else {
    html = await fetchText(`${url}${url.includes('?') ? '&' : '?'}cb=${Date.now()}`);
    if (htmlPath) fs.writeFileSync(htmlPath, html);
  }

  const checks = {
    'Download free': html.includes('Download free'),
    'View Features': html.includes('View Features'),
    'no Free note generator': !html.includes('Free note generator'),
    'Download for Windows present': html.includes('Download for Windows'),
    'max-w-lg present': html.includes('max-w-lg'),
    'Companies House present': html.includes('Companies House') || html.includes('09900871'),
    'hero-main-ui present': html.includes('hero-main-ui'),
  };

  for (const [k, v] of Object.entries(checks)) {
    console.log(`${k}: ${v}`);
  }
  console.log(`bytes: ${html.length}`);

  if (proofDir) {
    fs.mkdirSync(proofDir, { recursive: true });
    const lines = Object.entries(checks).map(([k, v]) => `${k}: ${v}`);
    const anchorRe = /<a[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = anchorRe.exec(html))) {
      const t = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (
        t &&
        ['download', 'feature', 'generator', 'example'].some((k) => t.toLowerCase().includes(k))
      ) {
        lines.push(`A: ${t.slice(0, 100)}`);
      }
    }
    fs.writeFileSync(path.join(proofDir, 'markers.txt'), `${lines.join('\n')}\n`);
  }

  // Pass when CTA pair matches and we left the stale pre-PR2/3 build
  // (enlarged hero drops max-w-lg, or PR #2 Companies House is present).
  const leftStale = !checks['max-w-lg present'] || checks['Companies House present'];
  const ok =
    checks['Download free'] &&
    checks['View Features'] &&
    checks['no Free note generator'] &&
    leftStale;

  if (!ok) {
    console.error('LIVE verification FAILED — production still looks like the stale homepage.');
    process.exit(1);
  }
  console.log('LIVE verification OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
