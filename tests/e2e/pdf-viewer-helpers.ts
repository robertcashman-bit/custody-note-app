/**
 * Shared PDF viewer e2e helpers (dev Electron + packaged Windows).
 */
import { type ElectronApplication, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import sharp from 'sharp';

export const CHROMIUM_PDF_EXTENSION_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';

/** High-contrast synthetic HTML → PDF (black heading on white). No real client data. */
export const SYNTHETIC_ATTENDANCE_PDF_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Synthetic</title>' +
  '<style>body{background:#ffffff;color:#000000;margin:24mm;font-family:Arial,sans-serif;}' +
  'h1{font-size:42pt;font-weight:900;color:#000000;line-height:1.1;margin:0 0 24px;}' +
  'p{font-size:14pt;color:#111111;}</style></head><body>' +
  '<h1>SYNTHETIC ATTENDANCE NOTE</h1>' +
  '<p>Client: Synthetic Testclient — DSCC SYN-0001 — station demo only.</p>' +
  '</body></html>';

export function defaultArtifactDir(): string {
  return process.env.CN_E2E_ARTIFACT_DIR || path.join(os.tmpdir(), 'cn-e2e-artifacts');
}

export function artifactPath(name: string): string {
  const dir = defaultArtifactDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

export async function waitForPdfViewerShellWindow(app: ElectronApplication, timeoutMs = 45000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      if (w.url().includes('pdf-viewer-shell.html')) return w;
    }
    try {
      const w = await app.waitForEvent('window', { timeout: 2000 });
      if (w.url().includes('pdf-viewer-shell.html')) return w;
    } catch {
      /* keep polling */
    }
  }
  throw new Error('PDF viewer shell window did not appear');
}

type FrameWaitResult = {
  ok: boolean;
  error?: string;
  hasExt?: boolean;
  hasPdfFrame?: boolean;
  frameUrls?: string[];
  pngBase64?: string;
};

export async function waitForBrowserViewPdfFrames(viewerShell: Page, _timeoutMs = 20_000): Promise<FrameWaitResult> {
  return viewerShell.evaluate(async () => {
    const api = (window as unknown as {
      pdfViewerApi?: { e2eInspectPane: () => Promise<FrameWaitResult> };
    }).pdfViewerApi;
    if (!api || typeof api.e2eInspectPane !== 'function') {
      return { ok: false, error: 'pdfViewerApi.e2eInspectPane not available' };
    }
    return api.e2eInspectPane();
  });
}

export type PixelAnalysis = {
  distinctGreys: number;
  nearWhiteRatio: number;
  nearBlackRatio: number;
  width: number;
  height: number;
};

export async function analyzePngPixels(pngBuffer: Buffer): Promise<PixelAnalysis> {
  const { data, info } = await sharp(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const greys = new Set<number>();
  let nearWhite = 0;
  let nearBlack = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const grey = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    greys.add(grey);
    if (r >= 240 && g >= 240 && b >= 240) nearWhite++;
    if (r <= 30 && g <= 30 && b <= 30) nearBlack++;
  }
  return {
    distinctGreys: greys.size,
    nearWhiteRatio: nearWhite / pixels,
    nearBlackRatio: nearBlack / pixels,
    width: info.width,
    height: info.height,
  };
}

export async function assertBrowserViewPdfRendered(
  viewerShell: Page,
  electronApp: ElectronApplication,
  opts: { timeoutMs?: number; saveAs?: string; shellScreenshotAs?: string } = {}
) {
  const frames = await waitForBrowserViewPdfFrames(viewerShell, opts.timeoutMs ?? 20_000);
  if (!frames.ok || !frames.pngBase64) {
    throw new Error(frames.error || 'PDF pane capture failed');
  }
  const png = Buffer.from(frames.pngBase64, 'base64');
  if (opts.saveAs) {
    fs.writeFileSync(opts.saveAs, png);
  }
  const stats = await analyzePngPixels(png);
  if (stats.distinctGreys < 20) {
    throw new Error(
      `PDF pane looks blank/flat (distinct greys ${stats.distinctGreys}, frames ${JSON.stringify(frames.frameUrls || [])})`
    );
  }
  if (stats.nearWhiteRatio < 0.05) {
    throw new Error(`Expected white background pixels (got ${(stats.nearWhiteRatio * 100).toFixed(2)}%)`);
  }
  if (stats.nearBlackRatio < 0.002) {
    throw new Error(`Expected black heading pixels (got ${(stats.nearBlackRatio * 100).toFixed(4)}%)`);
  }
  if (opts.shellScreenshotAs) {
    for (const w of electronApp.windows()) {
      if (w.url().includes('pdf-viewer-shell.html')) {
        await w.screenshot({ path: opts.shellScreenshotAs });
        break;
      }
    }
  }
  return { png, stats, frameUrls: frames.frameUrls };
}

export function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** Parse base64 PDF attachment from multipart .eml produced by Custody Note. */
export function extractPdfAttachmentSha256FromEml(emlContent: string): string | null {
  const norm = emlContent.replace(/\r\n/g, '\n');
  const pdfHeaderIdx = norm.search(/Content-Type:\s*application\/pdf/i);
  if (pdfHeaderIdx < 0) return null;
  const afterPdf = norm.slice(pdfHeaderIdx);
  if (!/Content-Transfer-Encoding:\s*base64/i.test(afterPdf)) return null;
  const bodyStart = afterPdf.indexOf('\n\n');
  if (bodyStart < 0) return null;
  let rest = afterPdf.slice(bodyStart + 2);
  const endBoundary = rest.search(/\n--[^\n]+--?\s*(\n|$)/);
  const chunk = endBoundary >= 0 ? rest.slice(0, endBoundary) : rest;
  const b64 = chunk.replace(/\s+/g, '');
  if (!b64) return null;
  return crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
}
