/**
 * Strengthen custodynote.com product display:
 * 1. Replace empty records-list (and related empty) screenshots with filled SAMPLE shots
 * 2. Reduce CTA shout: floating button only after scroll; drop redundant nav "Download" text link;
 *    make top promo banner text-only (nav + hero remain the primary CTAs)
 *
 * Run against a clone of robertcashman-bit/custody-note-website:
 *   WEBSITE_ROOT=../custody-note-website node scripts/strengthen-website-product-display.mjs
 */
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WEBSITE_ROOT =
  (process.env.WEBSITE_ROOT && process.env.WEBSITE_ROOT.trim()) ||
  join(APP_ROOT, '..', 'custody-note-website');
const ASSETS = join(APP_ROOT, 'website-product-shots', 'screenshots');

if (!existsSync(WEBSITE_ROOT)) {
  console.error('[strengthen-website] WEBSITE_ROOT not found:', WEBSITE_ROOT);
  process.exit(1);
}
if (!existsSync(ASSETS)) {
  console.error('[strengthen-website] marketing assets missing:', ASSETS);
  process.exit(1);
}

const changed = [];

function write(rel, content) {
  const full = join(WEBSITE_ROOT, rel);
  mkdirSync(dirname(full), { recursive: true });
  const prev = existsSync(full) ? readFileSync(full, 'utf8') : null;
  if (prev === content) return false;
  writeFileSync(full, content, 'utf8');
  changed.push(rel);
  return true;
}

function copyAsset(fromRel, toRel) {
  const src = join(ASSETS, fromRel);
  if (!existsSync(src)) {
    console.warn('[strengthen-website] skip missing asset', fromRel);
    return false;
  }
  const dest = join(WEBSITE_ROOT, 'public', 'screenshots', toRel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  changed.push('public/screenshots/' + toRel);
  return true;
}

/* ─── 1. Screenshots ─────────────────────────────────────────── */
copyAsset('records-list.webp', 'records-list.webp');
copyAsset('app/records-list.webp', 'app/records-list.webp');
copyAsset('records-list.png', 'records-list.png');
copyAsset('app/records-list.png', 'app/records-list.png');
/* Homepage "Inside the app" also shows empty billing-docs — only replace if we have a filled one with real list rows */
const billingWebp = join(ASSETS, 'billing-docs.webp');
if (existsSync(billingWebp) && statSync(billingWebp).size > 20000) {
  copyAsset('billing-docs.webp', 'billing-docs.webp');
}

/* ─── 2. Floating CTA — only after scroll ────────────────────── */
const floatingPath = 'components/FloatingTrialCta.tsx';
const floatingFull = join(WEBSITE_ROOT, floatingPath);
if (existsSync(floatingFull)) {
  const nextFloating = `"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CTA } from "@/lib/cta-analytics";

const HIDE_ON = new Set(["/download", "/app"]);
const SHOW_AFTER_PX = 480;

/**
 * Desktop floating download CTA — appears only after the user scrolls,
 * so it does not compete with banner / nav / hero CTAs on first paint.
 * Mobile uses StickyDownloadCta instead.
 */
export default function FloatingTrialCta() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => {
      setVisible(window.scrollY > SHOW_AFTER_PX);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!pathname || HIDE_ON.has(pathname) || !visible) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[58] hidden lg:block">
      <Link
        href="/download"
        data-cta={CTA.START_TRIAL}
        data-event="demo_request"
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition-colors hover:bg-blue-500"
      >
        <span aria-hidden className="text-base">
          ↓
        </span>
        Download Custody Note
      </Link>
    </div>
  );
}
`;
  write(floatingPath, nextFloating);
} else {
  console.warn('[strengthen-website] missing', floatingPath);
}

/* ─── 3. Header — drop redundant text "Download" link ────────── */
const headerPath = 'components/Header.tsx';
const headerFull = join(WEBSITE_ROOT, headerPath);
if (existsSync(headerFull)) {
  let header = readFileSync(headerFull, 'utf8');
  /* Remove the standalone Download text link that sits beside Download free */
  const withoutDup = header.replace(
    /\s*<Link\s+href="\/download"\s+data-cta=\{CTA\.DOWNLOAD\}[\s\S]*?>\s*Download\s*<\/Link>/,
    ''
  );
  if (withoutDup !== header) {
    write(headerPath, withoutDup);
  } else {
    console.warn('[strengthen-website] Header Download text link pattern not found — leave as-is');
  }
}

/* Also clean mobile menu if it duplicates Download + Download free */
const mobilePath = 'components/HeaderMobileMenu.tsx';
const mobileFull = join(WEBSITE_ROOT, mobilePath);
if (existsSync(mobileFull)) {
  let mobile = readFileSync(mobileFull, 'utf8');
  const cleaned = mobile.replace(
    /\s*<Link\s+href="\/download"\s+data-cta=\{CTA\.DOWNLOAD\}[\s\S]*?>\s*Download\s*<\/Link>/,
    ''
  );
  if (cleaned !== mobile) write(mobilePath, cleaned);
}

/* ─── 4. Global promo banner — text only (CTA lives in nav/hero) ─ */
const bannerPath = 'components/GlobalPromoBanner.tsx';
const bannerFull = join(WEBSITE_ROOT, bannerPath);
if (existsSync(bannerFull)) {
  const nextBanner = `import { FREE_FOREVER_TAGLINE } from "@/lib/product-copy";

/**
 * Site-wide announcement strip — messaging only.
 * Primary download CTAs stay in the header and page heroes to avoid CTA shout.
 */
export default function GlobalPromoBanner() {
  return (
    <div className="relative z-[55] w-full border-b border-blue-500/25 bg-gradient-to-r from-blue-950 via-brand-900 to-blue-950 px-3 py-2 text-center text-xs text-blue-100/95 sm:px-4 sm:py-2.5 sm:text-sm">
      <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-2 sm:gap-x-3">
        <span className="font-medium max-w-[36rem] sm:max-w-none">
          Structured police station attendance notes — {FREE_FOREVER_TAGLINE.toLowerCase()}
        </span>
      </span>
    </div>
  );
}
`;
  write(bannerPath, nextBanner);
}

/* ─── 5. Soften homepage Inside-the-app caption if still empty-ish ─ */
const pagePath = 'app/page.tsx';
const pageFull = join(WEBSITE_ROOT, pagePath);
if (existsSync(pageFull)) {
  let page = readFileSync(pageFull, 'utf8');
  let next = page;
  next = next.replace(
    'alt="Custody Note records list with search, filters for All, Drafts, Finalised, Archived, and quick actions"',
    'alt="Custody Note records list with SAMPLE demonstration attendances, search, and status filters"'
  );
  next = next.replace(
    'caption="All records at a glance"',
    'caption="Sample records list — demonstration data only"'
  );
  if (next !== page) write(pagePath, next);
}

/* Solicitor / SEO landing pages pull from InlineScreenshot catalog — update caption if present */
function walkTsx(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkTsx(p, out);
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const libScreenshots = join(WEBSITE_ROOT, 'lib', 'screenshots.ts');
if (existsSync(libScreenshots)) {
  let sc = readFileSync(libScreenshots, 'utf8');
  let next = sc;
  /* Prefer captions that admit sample/demo data */
  next = next.replace(
    /recordsList:\s*\{[\s\S]*?caption:\s*"[^"]*"/,
    (block) =>
      block.replace(
        /caption:\s*"[^"]*"/,
        'caption: "Sample attendances (demonstration data) — search and filter across records"'
      )
  );
  if (next !== sc) write('lib/screenshots.ts', next);
}

const solicitorPage = join(
  WEBSITE_ROOT,
  'app',
  'criminal-defence-solicitor-software',
  'page.tsx'
);
if (existsSync(solicitorPage)) {
  let p = readFileSync(solicitorPage, 'utf8');
  const next = p.replace(
    'caption="All Records — search across every attendance by client, UFN, station, custody number or date."',
    'caption="All Records with SAMPLE demonstration attendances — search by client, UFN, station, custody number or date."'
  );
  if (next !== p) write('app/criminal-defence-solicitor-software/page.tsx', next);
}

console.log('[strengthen-website] changed files (' + changed.length + '):');
for (const f of changed) console.log(' -', f);
if (!changed.length) {
  console.log('[strengthen-website] no file changes (already applied?)');
}
process.exit(0);
