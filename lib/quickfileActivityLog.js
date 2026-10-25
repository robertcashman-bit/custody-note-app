'use strict';

/**
 * QuickFile import / connection diagnostics under <userData>/logs/quickfile.log
 * Counts and error classes only — never client names, account numbers, or keys.
 */

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;
const MAX_CLASS_CHARS = 120;

function sanitizeClass(value) {
  return String(value || 'unknown')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\d{4,}/g, '#')
    .slice(0, MAX_CLASS_CHARS);
}

function createQuickFileActivityLog(opts) {
  const dir = (opts && opts.dir) || path.join(process.cwd(), 'logs');
  const filePath = path.join(dir, 'quickfile.log');

  function rotateIfNeeded() {
    try {
      if (!fs.existsSync(filePath)) return;
      const st = fs.statSync(filePath);
      if (st.size < MAX_BYTES) return;
      const rotated = filePath + '.1';
      try { if (fs.existsSync(rotated)) fs.unlinkSync(rotated); } catch (_) {}
      fs.renameSync(filePath, rotated);
    } catch (_) {}
  }

  function write(event, data) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      rotateIfNeeded();
      const line = JSON.stringify({
        at: new Date().toISOString(),
        event: String(event || 'event'),
        data: data && typeof data === 'object' ? data : {},
      }) + '\n';
      fs.appendFileSync(filePath, line, 'utf8');
    } catch (_) {}
  }

  return { write, filePath };
}

module.exports = { createQuickFileActivityLog, sanitizeClass };
