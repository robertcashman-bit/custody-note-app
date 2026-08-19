#!/usr/bin/env node
/**
 * Align custodynote.com marketing/legal copy with beta commercial reality.
 * Run against a clone of robertcashman-bit/custody-note-website:
 *   WEBSITE_ROOT=../custody-note-website node scripts/fix-website-marketing-copy.mjs
 *
 * Does not implement payments. Copy-only honesty pass.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WEBSITE_ROOT =
  (process.env.WEBSITE_ROOT && process.env.WEBSITE_ROOT.trim()) ||
  join(APP_ROOT, '..', 'custody-note-website');

if (!existsSync(WEBSITE_ROOT)) {
  console.error('[fix-website-marketing-copy] WEBSITE_ROOT not found:', WEBSITE_ROOT);
  process.exit(1);
}

const BETA_LINE = 'Free during beta. No credit card. Paid Pro planned after beta.';
const BETA_LINE_PRICE =
  'Free during beta. No credit card. Paid Pro planned after beta (around £9.99/month).';

const COMPANY_BLOCK_MD = [
  '**Publisher:** DEFENCELEGALSERVICES LIMITED (Companies House company number 09900871), trading as Police Station Agent (familiar trading style: Defence Legal Services Ltd).',
  '',
  '**Registered office:** Greenacre London Road, West Kingsdown, Sevenoaks, England, TN15 6ER.',
  '',
  '**Incorporated:** 3 December 2015. Private limited company registered in England and Wales. SIC 69102 Solicitors.',
  '',
  '**Director:** Robert David Cashman.',
  '',
  '**Companies House:** [find-and-update.company-information.service.gov.uk/company/09900871](https://find-and-update.company-information.service.gov.uk/company/09900871)',
].join('\n');

const COMPANY_BLOCK_PLAIN = [
  'DEFENCELEGALSERVICES LIMITED (Companies House company number 09900871), trading as Police Station Agent (familiar trading style: Defence Legal Services Ltd).',
  'Registered office: Greenacre London Road, West Kingsdown, Sevenoaks, England, TN15 6ER.',
  'Incorporated 3 December 2015. Private limited company registered in England and Wales. SIC 69102 Solicitors.',
  'Director: Robert David Cashman.',
  'Companies House: https://find-and-update.company-information.service.gov.uk/company/09900871',
].join(' ');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'out',
  'coverage',
  '.vercel',
  'public/screenshots',
]);

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.mdx',
  '.json',
  '.html',
  '.txt',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else {
      const dot = name.lastIndexOf('.');
      const ext = dot >= 0 ? name.slice(dot) : '';
      if (TEXT_EXT.has(ext)) out.push(p);
    }
  }
  return out;
}

/** Ordered replacements: [find, replace, {optional?: true, label?: string}] */
const REPLACEMENTS = [
  // Download page title / meta
  [
    'Download Custody Note for Windows and Mac — Free Trial',
    'Download Custody Note for Windows and Mac — Free during beta',
  ],
  [
    'Core features free forever — no credit card required.',
    'Free during beta. No credit card. Paid Pro planned after beta.',
  ],
  [
    'Already tried it?',
    'Firm or team interest?',
  ],
  // Download subscribe CTA may be split across JSX children
  [
    'Subscribe for £9.99/month →',
    'Contact us about firm interest →',
  ],
  [
    'Subscribe for £{"9.99"}/month →',
    'Contact us about firm interest →',
    { optional: true },
  ],
  [
    '["Subscribe for £","9.99","/month →"]',
    '"Contact us about firm interest →"',
    { optional: true },
  ],
  [
    'Subscribe for £',
    'Contact us about firm interest — planned Pro ~£',
    { optional: true },
  ],
  // Example workflow notes heading variants
  [
    'What practitioners say',
    'Example workflow notes',
    { optional: true },
  ],
  [
    'Trusted by practitioners',
    'Example workflow notes',
    { optional: true },
  ],

  // Footer / nav "Free Forever"
  ['>Free Forever<', '>Download free<'],
  ['"Free Forever"', '"Download free"'],
  ["'Free Forever'", "'Download free'"],
  ['children: "Free Forever"', 'children: "Download free"'],
  ['children:"Free Forever"', 'children:"Download free"'],

  // CTA analytics attribute (keep href behaviour; stop implying trial checkout)
  ['data-cta="start-free-trial"', 'data-cta="download-free"'],
  ["data-cta='start-free-trial'", "data-cta='download-free'"],
  ['"start-free-trial"', '"download-free"'],

  // About — Companies House
  [
    'Company registration details available on request via Contact',
    COMPANY_BLOCK_PLAIN,
  ],
  [
    'Company registration details available on request via',
    COMPANY_BLOCK_PLAIN + ' See also',
    { optional: true },
  ],

  // Pricing — do not claim Pro is purchasable / AI shipping now
  ['Shipping now', 'Planned after beta'],
  [
    'Available now for Pro: opt-in local attendance and interview summary drafts.',
    'Planned after beta for Pro: opt-in local attendance and interview summary drafts (not purchasable yet — payments are not wired).',
  ],
  [
    'Available now for Pro',
    'Planned after beta for Pro',
  ],
  [
    'these extras are live or landing in the current desktop builds',
    'these extras are planned for Pro after beta (payments are not wired yet)',
  ],
  // Match code reality: authorities + local firm workspace ship in beta; cloud backup/sync/AI are Pro-planned
  [
    'Opt-in Pro AI local summary drafts',
    'Opt-in Pro AI local summary drafts (planned after beta — not shipping yet)',
  ],
  [
    'Firm tracking & monthly reports',
    'Multi-site firm tracking & monthly reports (planned after beta; local firm workspace is included in beta)',
  ],
  [
    'Authority document generation',
    'Authority document generation (included in beta on desktop)',
  ],
  [
    'Encrypted & Backed Up',
    'Encrypted locally',
    { optional: true },
  ],

  // Security / guides next-steps (several phrasings)
  ['Pricing — Pro £9.99/month', 'Pricing — Pro planned after beta (~£9.99/month)'],
  ['Pricing — Pro £{"9.99"}/month', 'Pricing — Pro planned after beta (~£9.99/month)', { optional: true }],
  ['Pro £9.99/month', 'Pro planned after beta (~£9.99/month)', { optional: true }],
  ['/pricing">Pro £9.99', '/pricing">Pro planned after beta (~£9.99', { optional: true }],

  // product-tips.json on the website
  [
    'Core notes, PDF and local backup stay free. Pro (£9.99/mo) adds managed cloud backup.',
    'Free during beta. No credit card. Paid Pro planned after beta. Core notes, PDF and local backup stay free while we test; managed cloud backup is planned for Pro.',
    { optional: true },
  ],
  [
    'In beta — free while we test. Core notes, PDF and local backup stay free. Pro (~£9.99/mo) is planned after beta.',
    'Free during beta. No credit card. Paid Pro planned after beta. Core notes, PDF and local backup stay free while we test; managed cloud backup is planned for Pro.',
    { optional: true },
  ],
  [
    'Share Custody Note with another rep — Free during beta, no credit card.',
    'Share Custody Note with another rep — Free during beta. No credit card. Paid Pro planned after beta.',
    { optional: true },
  ],
  [
    'AES-256 local encryption. Optional encrypted cloud backup to AWS London. Sync across your devices (Windows; Mac where enabled) when enabled.',
    'AES-256 local encryption and local backup on Free during beta. Managed cloud backup and cross-device sync are planned for Pro after beta.',
  ],
  [
    'Optional encrypted cloud backup (AWS London)',
    'Managed cloud backup (AWS London) — planned for Pro after beta',
  ],
  [
    'Sync across devices (Windows and Mac, where licensed)',
    'Sync across devices (Windows and Mac) — planned for Pro after beta',
  ],
  [
    'Track instructing firms, generate monthly reports, and produce authority documents from your records.',
    'Firm tracking, monthly reports and authority documents are planned for Pro after beta — Free during beta covers core attendance notes.',
  ],

  // Quote cards → not testimonials
  [
    'Examples below are illustrative workflow scenarios — not verified reviews or outcome guarantees.',
    'Example workflow notes below are fictional scenarios written by us for illustration — they are not customer testimonials, reviews, or outcome guarantees.',
  ],
  ['Illustrative scenario', 'Example workflow note'],
  ['Illustrative workflow scenarios', 'Example workflow notes'],

  // Privacy — future-proof, not live card billing
  [
    'manage trials, subscriptions, billing and renewals',
    'manage beta access, licence keys, and — when payments are wired after beta — subscriptions, billing and renewals',
  ],
  [
    'Card payments are handled by our payment provider; we do not store full card numbers.',
    'When paid plans open after beta, card payments will be handled by our payment provider; we do not store full card numbers. Payments are not live during beta.',
  ],
  [
    'Payment processing — our payment provider handles card transactions under its own controls and privacy notice.',
    'Payment processing (after beta) — when paid plans open, our payment provider will handle card transactions under its own controls and privacy notice. No card billing is live during beta.',
  ],
  [
    'Pro AI summary drafts (desktop, Pro only).',
    'Pro AI summary drafts (planned after beta for Pro; not a live purchasable add-on during beta).',
  ],
  [
    'Licensing and transaction data — information needed to issue, validate and renew licence keys and subscriptions, including order references and the plan you hold.',
    'Licensing and transaction data — information needed to issue and validate licence keys and (when paid plans open after beta) renewals, including order references and the plan you hold.',
  ],

  // Terms last-updated + commercial clauses (common phrasings)
  ['Last updated: 31 May 2026', 'Last updated: 19 August 2026'],
  ['Last updated:\n31 May 2026', 'Last updated:\n19 August 2026', { optional: true }],
  ['"31 May 2026"', '"19 August 2026"'],
  ["'31 May 2026'", "'19 August 2026'"],

  [
    'Advanced features are available on a paid Pro subscription as described on the Pricing page.',
    'Paid Pro is planned after beta (around £9.99/month) as described on the Pricing page. Payments, auto-renew and live checkout are not wired during beta.',
  ],
  [
    '"Subscription" — a paid plan giving access to the Software for a billing period.',
    '"Subscription" — a paid plan (planned after beta) giving access to Pro features for a billing period once payments are wired. During beta, access is free and no card is required.',
  ],
  [
    'Subject to payment where required, we grant you a',
    'During beta, we grant access without payment. After beta, subject to payment where required for Pro, we grant you a',
  ],
  [
    'Custody Note is sold as a direct Subscription. Refund and cancellation rights depend on how you purchased and on applicable consumer or commercial law.',
    'During beta, Custody Note is provided free of charge and no subscription is sold through this Site. When paid Pro opens after beta, refund and cancellation rights will depend on how you purchased and on applicable consumer or commercial law.',
  ],
  [
    'Subscriptions renew for further periods unless cancelled before renewal, where that applies to your plan.',
    'When paid subscriptions open after beta, they may renew for further periods unless cancelled before renewal, where that applies to your plan. There is no live auto-renew during beta.',
  ],
  [
    'Non-payment may result in suspension or termination of licence entitlements.',
    'After beta, non-payment of a paid plan may result in suspension or termination of Pro entitlements (core Free/beta access may continue as described on the Pricing page).',
    { optional: true },
  ],
  [
    'We may suspend or terminate access for material breach of these Terms or for non-payment, giving notice where reasonable.',
    'We may suspend or terminate access for material breach of these Terms or, after beta, for non-payment of a paid plan, giving notice where reasonable.',
  ],

  // Meta descriptions still saying Pro £9.99 as live
  [
    'Free during beta; Pro £9.99/month.',
    'Free during beta. Paid Pro planned after beta (~£9.99/month).',
  ],
  [
    'Free during beta; Pro £9.99/month',
    'Free during beta. Paid Pro planned after beta (~£9.99/month)',
  ],

  // product-tips.json (hosted on website)
  [
    'Core notes, PDF and local backup stay free. Pro (£9.99/mo) adds managed cloud backup.',
    BETA_LINE_PRICE + ' Core notes, PDF and local backup stay free during beta; managed cloud backup is planned for Pro.',
    { optional: true },
  ],
  [
    'In beta — free while we test. Core notes, PDF and local backup stay free. Pro (~£9.99/mo) is planned after beta.',
    BETA_LINE_PRICE + ' Core notes, PDF and local backup stay free during beta; managed cloud backup is planned for Pro.',
    { optional: true },
  ],
];

// Fix accidental template in REPLACEMENTS (JSX-looking entries that are invalid)
for (let i = 0; i < REPLACEMENTS.length; i++) {
  const r = REPLACEMENTS[i][1];
  if (typeof r !== 'string') {
    REPLACEMENTS.splice(i, 1);
    i--;
  }
}

function applyReplacements(text) {
  let next = text;
  const hits = [];
  for (const [find, replace, opts = {}] of REPLACEMENTS) {
    if (!find || typeof replace !== 'string') continue;
    if (!next.includes(find)) {
      if (!opts.optional) hits.push({ find, count: 0, optional: false });
      continue;
    }
    const parts = next.split(find);
    const count = parts.length - 1;
    next = parts.join(replace);
    hits.push({ find, count, optional: !!opts.optional });
  }
  return { text: next, hits };
}

const files = walk(WEBSITE_ROOT);
let changedFiles = 0;
const missingRequired = new Map();
const applied = [];

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const { text: after, hits } = applyReplacements(before);
  for (const h of hits) {
    if (h.count === 0 && !h.optional) {
      const key = h.find;
      if (!missingRequired.has(key)) missingRequired.set(key, 0);
    }
    if (h.count > 0) applied.push({ file: relative(WEBSITE_ROOT, file), find: h.find, count: h.count });
  }
  if (after !== before) {
    writeFileSync(file, after);
    changedFiles++;
    console.log('[fix] wrote', relative(WEBSITE_ROOT, file));
  }
}

// Inject company block into about / terms / privacy if still missing company number
function ensureCompanyNumber(fileHints, insertAfterNeedle) {
  for (const file of files) {
    const rel = relative(WEBSITE_ROOT, file).replace(/\\/g, '/');
    if (!fileHints.some((h) => rel.toLowerCase().includes(h))) continue;
    let text = readFileSync(file, 'utf8');
    if (text.includes('09900871')) continue;
    if (insertAfterNeedle && text.includes(insertAfterNeedle)) {
      text = text.replace(
        insertAfterNeedle,
        insertAfterNeedle + '\n\n' + COMPANY_BLOCK_MD + '\n'
      );
      writeFileSync(file, text);
      changedFiles++;
      console.log('[fix] injected Companies House block into', rel);
    }
  }
}

ensureCompanyNumber(['about'], 'Police Station Agent');
ensureCompanyNumber(['terms'], 'Police Station Agent');
ensureCompanyNumber(['privacy'], 'Police Station Agent');
ensureCompanyNumber(['footer', 'site-footer', 'legal'], 'Defence Legal Services Ltd');

// Critical leftovers — must not remain after a successful honesty pass
const FORBIDDEN_LEFTOVERS = [
  'Download Custody Note for Windows and Mac — Free Trial',
  'Core features free forever — no credit card required.',
  'Subscribe for £9.99/month →',
  'Company registration details available on request via Contact',
  'Shipping now',
  'Available now for Pro',
  'data-cta="start-free-trial"',
  'Pricing — Pro £9.99/month',
];

const allText = files.map((f) => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return '';
  }
}).join('\n');

const leftovers = [];
for (const s of FORBIDDEN_LEFTOVERS) {
  if (allText.includes(s)) leftovers.push(s);
}

if (!allText.includes('09900871')) {
  console.error('[fix-website-marketing-copy] Companies House number 09900871 not found after edits');
  process.exit(4);
}

console.log('\n[fix-website-marketing-copy] changed files:', changedFiles);
console.log('[fix-website-marketing-copy] applied hit rows:', applied.length);
if (leftovers.length) {
  console.error(
    '[fix-website-marketing-copy] leftover commercial strings still present (fix incomplete):\n - ' +
      leftovers.join('\n - ')
  );
  process.exit(2);
}

if (changedFiles === 0) {
  console.log('[fix-website-marketing-copy] no further file changes — already aligned');
} else {
  console.log('[fix-website-marketing-copy] OK —', BETA_LINE);
}

// Emit a short applied-hits report for CI artifacts / PR review
try {
  const reportPath = join(WEBSITE_ROOT, '.copy-fix-report.json');
  writeFileSync(
    reportPath,
    JSON.stringify({ changedFiles, applied, betaLine: BETA_LINE }, null, 2) + '\n'
  );
  console.log('[fix-website-marketing-copy] wrote', reportPath);
} catch (e) {
  console.warn('[fix-website-marketing-copy] could not write report:', e.message);
}
