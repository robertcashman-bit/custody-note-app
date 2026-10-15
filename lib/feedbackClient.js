'use strict';

/**
 * Help & feedback: build, sign, send and queue in-app feedback.
 * Posts to custodynote.com/api/feedback. When offline the item is queued in
 * <userData>/feedback-queue.json and retried later. No note content is sent:
 * only the user's message, app version, OS, tier and the last sync.log lines
 * (which hold queue metadata only).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://custodynote.com';
const TYPES = ['problem', 'support', 'idea'];
const MAX_QUEUE = 20;
const LOG_LINES = 50;
const REQUEST_TIMEOUT_MS = 20000;

function validate(input) {
  const type = String((input && input.type) || '');
  const message = String((input && input.message) || '').trim();
  const email = String((input && input.email) || '').trim();
  if (!TYPES.includes(type)) return { ok: false, error: 'Choose what kind of feedback this is.' };
  if (message.length < 10) return { ok: false, error: 'Please write at least 10 characters.' };
  if (message.length > 5000) return { ok: false, error: 'Please keep it under 5,000 characters.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
  return { ok: true, value: { type, message, email: email || null } };
}

/** Last N lines of sync.log, with anything email-shaped removed. */
function readSyncLogTail(userDataDir, lines = LOG_LINES) {
  try {
    const file = path.join(userDataDir, 'logs', 'sync.log');
    if (!fs.existsSync(file)) return '';
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - 256 * 1024);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8').split('\n').filter(Boolean).slice(-lines).join('\n')
      .replace(/[^\s@"]+@[^\s@"]+\.[^\s@"]+/g, '[email]');
  } catch (_) {
    return '';
  }
}

function buildPayload(value, ctx) {
  return {
    type: value.type,
    message: value.message,
    email: value.email,
    appVersion: ctx.appVersion || null,
    os: ctx.os || null,
    tier: ctx.tier || null,
    diagnostics: ctx.includeLog === false ? '' : (ctx.diagnostics || ''),
    source: 'app',
  };
}

function sign(installToken, installId, timestamp, body) {
  return crypto.createHmac('sha256', installToken).update(installId + '.' + timestamp + '.' + body).digest('hex');
}

function createFeedbackClient(opts) {
  const userDataDir = opts.userDataDir;
  const fetchImpl = opts.fetch || globalThis.fetch;
  const base = opts.apiBase || API_BASE;
  const now = opts.now || (() => Date.now());
  const queueFile = path.join(userDataDir, 'feedback-queue.json');
  const idFile = path.join(userDataDir, 'feedback-install.json');

  function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
  }
  function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);
  }
  function readQueue() { const q = readJson(queueFile, []); return Array.isArray(q) ? q : []; }
  function writeQueue(q) { writeJson(queueFile, q.slice(-MAX_QUEUE)); }

  async function timedFetch(url, init) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try { return await fetchImpl(url, { ...init, signal: ac.signal }); } finally { clearTimeout(t); }
  }

  async function getInstall() {
    let rec = readJson(idFile, null);
    if (!rec || !rec.installId) {
      rec = { installId: crypto.randomBytes(16).toString('hex'), installToken: null };
      writeJson(idFile, rec);
    }
    if (!rec.installToken) {
      const res = await timedFetch(base + '/api/feedback/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installId: rec.installId }),
      });
      if (!res.ok) { const e = new Error('register_failed'); e.status = res.status; throw e; }
      const d = await res.json();
      if (!d || !d.installToken) throw new Error('register_failed');
      rec.installToken = d.installToken;
      writeJson(idFile, rec);
    }
    return rec;
  }

  /** One attempt. Returns {ok} | {ok:false, retry, error}. */
  async function post(payload) {
    let install;
    try { install = await getInstall(); } catch (e) {
      return { ok: false, retry: !(e && e.status >= 400 && e.status < 500 && e.status !== 429), error: 'offline' };
    }
    const body = JSON.stringify(payload);
    const ts = String(now());
    let res;
    try {
      res = await timedFetch(base + '/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CN-Install': install.installId,
          'X-CN-Timestamp': ts,
          'X-CN-Signature': sign(install.installToken, install.installId, ts, body),
        },
        body,
      });
    } catch (_) {
      return { ok: false, retry: true, error: 'offline' };
    }
    if (res.ok) return { ok: true };
    let msg = '';
    try { msg = ((await res.json()) || {}).error || ''; } catch (_) {}
    if (res.status === 401) {
      // Token may be stale: re-register on the next try.
      writeJson(idFile, { installId: install.installId, installToken: null });
      return { ok: false, retry: true, error: msg || 'unverified' };
    }
    const retry = res.status === 429 || res.status >= 500;
    return { ok: false, retry, error: msg || ('HTTP ' + res.status), status: res.status };
  }

  /** Submit now; if it can't reach the server, queue it and say so. */
  async function submit(input, ctx) {
    const v = validate(input);
    if (!v.ok) return { ok: false, queued: false, error: v.error };
    const payload = buildPayload(v.value, ctx || {});
    const r = await post(payload);
    if (r.ok) return { ok: true, queued: false };
    if (r.retry) {
      const q = readQueue();
      q.push({ payload, queuedAt: new Date(now()).toISOString(), attempts: 1 });
      writeQueue(q);
      return { ok: true, queued: true, error: r.error };
    }
    return { ok: false, queued: false, error: r.error };
  }

  /** Retry queued items; drops ones the server refuses outright. */
  async function flushQueue() {
    const q = readQueue();
    if (!q.length) return { sent: 0, remaining: 0 };
    const keep = [];
    let sent = 0;
    for (let i = 0; i < q.length; i++) {
      const item = q[i];
      const r = await post(item.payload);
      if (r.ok) { sent++; continue; }
      if (r.retry && (item.attempts || 0) < 50) {
        keep.push({ ...item, attempts: (item.attempts || 0) + 1 });
        if (r.error === 'offline') { keep.push(...q.slice(i + 1)); break; }
      }
    }
    writeQueue(keep);
    return { sent, remaining: keep.length };
  }

  return { submit, flushQueue, readQueue };
}

module.exports = { TYPES, validate, readSyncLogTail, buildPayload, sign, createFeedbackClient };
