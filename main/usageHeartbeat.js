'use strict';

/**
 * Privacy-safe daily usage heartbeat helpers.
 * Payload is limited to hashed machineId, platform, appVersion, licence tier, and install channel.
 * Never includes case content, client names, UFNs, notes, emails, or licence keys.
 */

const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** While the app stays open (tray), re-check whether a heartbeat is due. */
const HEARTBEAT_RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const HEARTBEAT_STARTUP_DELAY_MS = 3000;
const HEARTBEAT_STATE_FILE = 'cn-usage-heartbeat.json';
const TRIAL_STARTED_STATE_FILE = 'cn-trial-started-sent.json';
const HEARTBEAT_POST_TIMEOUT_MS = 8000;
const HEARTBEAT_RETRY_DELAYS_MS = Object.freeze([5000, 30_000, 120_000]);
/** Keep at most this many unsent calendar days in the local queue. */
const HEARTBEAT_PENDING_MAX_DAYS = 14;
const USAGE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_PLATFORMS = Object.freeze(['win32', 'darwin', 'linux', 'unknown']);
const ALLOWED_PAYLOAD_KEYS = Object.freeze([
  'machineId',
  'platform',
  'appVersion',
  'tier',
  'installSource',
  'usageDate',
]);
const ALLOWED_INSTALL_SOURCES = Object.freeze(['store', 'direct', 'dmg', 'mas', 'unknown']);

const { isWindowsStoreBuild } = require('../lib/isWindowsStoreBuild');
const ALLOWED_TIERS = Object.freeze(['free', 'pro', 'trial', 'none']);
const MACHINE_ID_HEX_RE = /^[a-f0-9]{32}$/;
const CLOUD_BACKUP_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {object|null|undefined} licenceData
 * @returns {boolean}
 */
function cachedCloudBackupEntitled(licenceData) {
  if (!licenceData || licenceData.cachedCloudBackup !== true) return false;
  const atRaw = licenceData.cachedCloudBackupAt;
  if (atRaw == null || atRaw === '') return false;
  const cachedAt = Date.parse(String(atRaw));
  if (!Number.isFinite(cachedAt)) return false;
  return Date.now() - cachedAt < CLOUD_BACKUP_CACHE_MAX_AGE_MS;
}

/**
 * UTC calendar day for server-side hb:day:* deduplication (YYYY-MM-DD).
 * @param {number} [nowMs]
 * @returns {string}
 */
function formatUsageDateUtc(nowMs) {
  const now = nowMs != null ? Number(nowMs) : Date.now();
  if (!Number.isFinite(now)) return formatUsageDateUtc(Date.now());
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * @param {string|number|null|undefined} lastHeartbeatAt ISO string or epoch ms
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function shouldSendHeartbeat(lastHeartbeatAt, nowMs) {
  const now = nowMs != null ? Number(nowMs) : Date.now();
  if (!Number.isFinite(now)) return true;
  if (lastHeartbeatAt == null || lastHeartbeatAt === '') return true;
  const last =
    typeof lastHeartbeatAt === 'number'
      ? lastHeartbeatAt
      : Date.parse(String(lastHeartbeatAt));
  if (!Number.isFinite(last)) return true;
  return now - last >= HEARTBEAT_INTERVAL_MS;
}

/**
 * @param {string} usageDate YYYY-MM-DD
 * @param {string[]} ackedUsageDates
 * @returns {boolean}
 */
function isUsageDateAcked(usageDate, ackedUsageDates) {
  const day = String(usageDate || '').trim();
  if (!USAGE_DATE_RE.test(day)) return false;
  const acked = Array.isArray(ackedUsageDates) ? ackedUsageDates : [];
  return acked.includes(day);
}

/**
 * @param {object|null|undefined} raw parsed cn-usage-heartbeat.json (any version)
 * @returns {{ version: number, lastHeartbeatAt: string|null, ackedUsageDates: string[], pending: Record<string, object> }}
 */
function normalizeHeartbeatState(raw) {
  const base = {
    version: 2,
    lastHeartbeatAt: null,
    ackedUsageDates: [],
    pending: {},
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  if (raw.lastHeartbeatAt != null && raw.lastHeartbeatAt !== '') {
    base.lastHeartbeatAt = String(raw.lastHeartbeatAt);
    const ackDay = formatUsageDateUtc(Date.parse(base.lastHeartbeatAt));
    if (USAGE_DATE_RE.test(ackDay) && !base.ackedUsageDates.includes(ackDay)) {
      base.ackedUsageDates.push(ackDay);
    }
  }
  if (Array.isArray(raw.ackedUsageDates)) {
    for (const d of raw.ackedUsageDates) {
      const day = String(d || '').trim();
      if (USAGE_DATE_RE.test(day) && !base.ackedUsageDates.includes(day)) {
        base.ackedUsageDates.push(day);
      }
    }
  }
  if (raw.pending && typeof raw.pending === 'object' && !Array.isArray(raw.pending)) {
    for (const [day, payload] of Object.entries(raw.pending)) {
      if (!USAGE_DATE_RE.test(day)) continue;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        base.pending[day] = payload;
      }
    }
  }
  base.ackedUsageDates.sort();
  return base;
}

/**
 * @param {string} filePath
 * @param {{ readFileSync: Function }} fsModule
 * @returns {ReturnType<typeof normalizeHeartbeatState>}
 */
function readHeartbeatState(filePath, fsModule) {
  try {
    const raw = fsModule.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return normalizeHeartbeatState(data);
  } catch (_) {
    return normalizeHeartbeatState(null);
  }
}

/**
 * @param {string} filePath
 * @param {{ writeFileSync: Function }} fsModule
 * @param {ReturnType<typeof normalizeHeartbeatState>} state
 */
function writeHeartbeatState(filePath, fsModule, state) {
  const normalized = normalizeHeartbeatState(state);
  const out = {
    version: 2,
    lastHeartbeatAt: normalized.lastHeartbeatAt,
    ackedUsageDates: normalized.ackedUsageDates,
    pending: normalized.pending,
  };
  fsModule.writeFileSync(filePath, JSON.stringify(out, null, 0), 'utf8');
}

/**
 * Record a successful server ack for one usage day.
 * @param {ReturnType<typeof normalizeHeartbeatState>} state
 * @param {string} usageDate
 * @param {number} [nowMs]
 * @returns {ReturnType<typeof normalizeHeartbeatState>}
 */
function markUsageDateAcked(state, usageDate, nowMs) {
  const next = normalizeHeartbeatState(state);
  const day = String(usageDate || '').trim();
  if (!USAGE_DATE_RE.test(day)) return next;
  if (!next.ackedUsageDates.includes(day)) {
    next.ackedUsageDates.push(day);
    next.ackedUsageDates.sort();
  }
  if (next.pending[day]) delete next.pending[day];
  const stamp =
    nowMs != null && Number.isFinite(Number(nowMs))
      ? new Date(Number(nowMs)).toISOString()
      : new Date().toISOString();
  next.lastHeartbeatAt = stamp;
  return next;
}

/**
 * Queue or refresh a payload for a calendar day (deduped by usageDate).
 * @param {ReturnType<typeof normalizeHeartbeatState>} state
 * @param {string} usageDate
 * @param {object} payload
 * @returns {ReturnType<typeof normalizeHeartbeatState>}
 */
function enqueueHeartbeatPayload(state, usageDate, payload) {
  const next = normalizeHeartbeatState(state);
  const day = String(usageDate || '').trim();
  if (!USAGE_DATE_RE.test(day)) return next;
  if (isUsageDateAcked(day, next.ackedUsageDates)) return next;
  if (payload && typeof payload === 'object') {
    next.pending[day] = { ...payload, usageDate: day };
  }
  const pendingDays = Object.keys(next.pending).filter((d) => USAGE_DATE_RE.test(d)).sort();
  while (pendingDays.length > HEARTBEAT_PENDING_MAX_DAYS) {
    const drop = pendingDays.shift();
    if (drop) delete next.pending[drop];
  }
  return next;
}

/**
 * Sorted list of usage dates that still need a POST (oldest first).
 * @param {ReturnType<typeof normalizeHeartbeatState>} state
 * @param {string} [todayUsageDate]
 * @returns {string[]}
 */
function listPendingUsageDates(state, todayUsageDate) {
  const next = normalizeHeartbeatState(state);
  const days = new Set(Object.keys(next.pending).filter((d) => USAGE_DATE_RE.test(d)));
  const today = todayUsageDate || formatUsageDateUtc();
  if (USAGE_DATE_RE.test(today) && !isUsageDateAcked(today, next.ackedUsageDates)) {
    days.add(today);
  }
  return [...days].sort();
}

/**
 * Whether any heartbeat work remains (unsent days in queue or today not acked).
 * @param {ReturnType<typeof normalizeHeartbeatState>} state
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function heartbeatWorkRemaining(state, nowMs) {
  const next = normalizeHeartbeatState(state);
  const today = formatUsageDateUtc(nowMs);
  if (!isUsageDateAcked(today, next.ackedUsageDates)) return true;
  return Object.keys(next.pending).some((d) => USAGE_DATE_RE.test(d));
}

/**
 * How the packaged app was installed (anonymous channel label for stats).
 *
 * @param {{
 *   platform?: string,
 *   windowsStore?: boolean,
 *   mas?: boolean,
 *   execPath?: string,
 *   isPackaged?: boolean,
 *   isMsixStore?: boolean,
 *   distributionChannel?: string,
 * }} [opts]
 * @returns {'store'|'direct'|'dmg'|'mas'|'unknown'}
 */
function resolveInstallSource(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const platform = o.platform != null ? o.platform : process.platform;

  if (platform === 'win32') {
    if (
      o.isMsixStore === true ||
      isWindowsStoreBuild({
        platform,
        windowsStore: o.windowsStore,
        distributionChannel: o.distributionChannel,
        execPath: o.execPath,
        isPackaged: o.isPackaged,
      })
    ) {
      return 'store';
    }
    return 'direct';
  }

  if (platform === 'darwin') {
    const mas =
      o.mas != null ? !!o.mas : !!(typeof process !== 'undefined' && process.mas);
    if (mas) return 'mas';
    return 'dmg';
  }

  return 'unknown';
}

/**
 * @param {string} raw
 * @returns {'store'|'direct'|'dmg'|'mas'|'unknown'}
 */
function coerceInstallSource(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return ALLOWED_INSTALL_SOURCES.includes(s) ? s : 'unknown';
}

/**
 * @param {string} raw
 * @returns {'win32'|'darwin'|'linux'|'unknown'}
 */
function coercePlatform(raw) {
  const p = String(raw || '').trim().toLowerCase();
  if (ALLOWED_PLATFORMS.includes(p)) return p;
  if (p === 'windows' || p === 'win') return 'win32';
  if (p === 'mac' || p === 'macos' || p === 'osx') return 'darwin';
  return 'unknown';
}

/**
 * @param {{ machineId: string, platform: string, appVersion: string, tier: string, installSource?: string, usageDate?: string }} fields
 * @param {object} [installEnv] passed to resolveInstallSource when installSource is omitted
 * @param {number} [nowMs] for default usageDate
 * @returns {{ machineId: string, platform: string, appVersion: string, tier: string, installSource: string, usageDate: string }}
 */
function buildHeartbeatPayload(fields, installEnv, nowMs) {
  const src = fields && typeof fields === 'object' ? fields : {};
  const tierRaw = String(src.tier || 'none');
  const tier = ALLOWED_TIERS.includes(tierRaw) ? tierRaw : 'none';
  const installSource =
    src.installSource != null && src.installSource !== ''
      ? coerceInstallSource(src.installSource)
      : resolveInstallSource(installEnv);
  const usageDateRaw = src.usageDate != null ? String(src.usageDate).trim() : formatUsageDateUtc(nowMs);
  const usageDate = USAGE_DATE_RE.test(usageDateRaw) ? usageDateRaw : formatUsageDateUtc(nowMs);
  const platform = coercePlatform(src.platform || (installEnv && installEnv.platform));
  return {
    machineId: String(src.machineId || ''),
    platform,
    appVersion: String(src.appVersion || ''),
    tier,
    installSource,
    usageDate,
  };
}

/**
 * Map licence status + stored fields to analytics tier (free / pro / trial / none).
 * Admin and entitled cloud-backup users count as pro for stats.
 *
 * @param {object|null|undefined} status from computeLicenceStatus
 * @param {object|null|undefined} licenceData from licence.dat
 * @returns {'free'|'pro'|'trial'|'none'}
 */
function resolveAnalyticsTier(status, licenceData) {
  const data = licenceData && typeof licenceData === 'object' ? licenceData : null;
  const st = status && typeof status === 'object' ? status : null;
  if (st && (st.isAdmin || st.tier === 'pro')) return 'pro';
  if (cachedCloudBackupEntitled(data)) return 'pro';
  if (st && ALLOWED_TIERS.includes(st.tier)) return st.tier;
  if (data && data.key) {
    const key = String(data.key).toUpperCase();
    if (key.startsWith('FREE-') || key.startsWith('CNF-')) return 'free';
    if (key.startsWith('TRIAL-') || data.isTrial) return 'trial';
    if (!key.startsWith('ACCOUNT-')) return 'pro';
  }
  return 'none';
}

/**
 * @param {object} payload
 * @returns {boolean}
 */
function payloadIsPrivacySafe(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).sort();
  const allowed = [...ALLOWED_PAYLOAD_KEYS].sort();
  if (keys.length !== allowed.length) return false;
  for (let i = 0; i < allowed.length; i++) {
    if (keys[i] !== allowed[i]) return false;
  }
  if (!MACHINE_ID_HEX_RE.test(String(payload.machineId || ''))) return false;
  if (!ALLOWED_TIERS.includes(String(payload.tier || ''))) return false;
  if (!ALLOWED_INSTALL_SOURCES.includes(String(payload.installSource || ''))) return false;
  if (!USAGE_DATE_RE.test(String(payload.usageDate || ''))) return false;
  if (!ALLOWED_PLATFORMS.includes(String(payload.platform || ''))) return false;
  if (!String(payload.appVersion || '').trim()) return false;
  const blob = JSON.stringify(payload).toLowerCase();
  // Refuse obvious PII / case fields if they ever leak into values.
  if (
    /@/.test(blob) ||
    /\bufn\b/.test(blob) ||
    /\bcustody\s*number\b/.test(blob) ||
    /\bclient\b/.test(blob) ||
    /\blicen[cs]e[-_]?key\b/.test(blob)
  ) {
    return false;
  }
  return true;
}

/**
 * @param {string} filePath
 * @param {{ readFileSync: Function }} fsModule
 * @returns {string|null}
 */
function readLastHeartbeatAt(filePath, fsModule) {
  return readHeartbeatState(filePath, fsModule).lastHeartbeatAt;
}

/**
 * @param {string} filePath
 * @param {{ writeFileSync: Function }} fsModule
 * @param {string|number} at
 */
function writeLastHeartbeatAt(filePath, fsModule, at) {
  const stamp = typeof at === 'number' ? new Date(at).toISOString() : String(at);
  const state = readHeartbeatState(filePath, fsModule);
  state.lastHeartbeatAt = stamp;
  const day = formatUsageDateUtc(Date.parse(stamp));
  if (USAGE_DATE_RE.test(day)) {
    state.ackedUsageDates = state.ackedUsageDates || [];
    if (!state.ackedUsageDates.includes(day)) {
      state.ackedUsageDates.push(day);
      state.ackedUsageDates.sort();
    }
    if (state.pending && state.pending[day]) delete state.pending[day];
  }
  writeHeartbeatState(filePath, fsModule, state);
}

/**
 * Send queued heartbeats oldest-day-first; stops on first failure so the queue retries later.
 *
 * @param {{
 *   postFn: (url: string, body: object, opts: object) => Promise<unknown>,
 *   url: string,
 *   statePath: string,
 *   fsModule: { readFileSync: Function, writeFileSync: Function },
 *   buildPayloadForDay: (usageDate: string) => object|null,
 *   timeoutMs?: number,
 *   retryDelaysMs?: number[],
 *   nowMs?: number,
 * }} options
 * @returns {Promise<{ sentDays: string[], state: object }>}
 */
async function flushHeartbeatQueue(options) {
  const opts = options || {};
  const fsModule = opts.fsModule;
  const statePath = opts.statePath;
  if (!fsModule || !statePath) return { sentDays: [], state: normalizeHeartbeatState(null) };

  let state = readHeartbeatState(statePath, fsModule);
  const today = formatUsageDateUtc(opts.nowMs);
  const build = opts.buildPayloadForDay;
  if (typeof build === 'function') {
    const todayPayload = build(today);
    if (todayPayload && payloadIsPrivacySafe(todayPayload)) {
      state = enqueueHeartbeatPayload(state, today, todayPayload);
      writeHeartbeatState(statePath, fsModule, state);
    }
  }

  const days = listPendingUsageDates(state, today);
  const sentDays = [];
  for (const day of days) {
    let payload = state.pending[day];
    if (!payload || !payloadIsPrivacySafe(payload)) {
      if (typeof build === 'function') {
        payload = build(day);
      }
    }
    if (!payload || !payloadIsPrivacySafe(payload)) continue;
    payload = buildHeartbeatPayload({ ...payload, usageDate: day }, null, Date.parse(day + 'T12:00:00.000Z'));

    const ok = await postStatsWithRetry({
      postFn: opts.postFn,
      url: opts.url,
      body: payload,
      timeoutMs: opts.timeoutMs,
      retryDelaysMs: opts.retryDelaysMs,
    });
    if (!ok) break;
    state = markUsageDateAcked(state, day, opts.nowMs);
    writeHeartbeatState(statePath, fsModule, state);
    sentDays.push(day);
  }
  return { sentDays, state };
}

/**
 * @param {string} filePath
 * @param {{ readFileSync: Function }} fsModule
 * @returns {string|null}
 */
function readTrialStartedSentAt(filePath, fsModule) {
  try {
    const raw = fsModule.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || data.sentAt == null || data.sentAt === '') return null;
    return data.sentAt;
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} filePath
 * @param {{ writeFileSync: Function }} fsModule
 * @param {string|number} at
 */
function writeTrialStartedSentAt(filePath, fsModule, at) {
  const stamp = typeof at === 'number' ? new Date(at).toISOString() : String(at);
  fsModule.writeFileSync(
    filePath,
    JSON.stringify({ sentAt: stamp }, null, 0),
    'utf8'
  );
}

/**
 * Whether a one-shot trial-started ping should still be attempted.
 * Retries on every launch while trialStartedPending is set (cleared only after 2xx).
 *
 * @param {object|null|undefined} licenceData
 * @param {string|null|undefined} sentAt from readTrialStartedSentAt
 * @returns {boolean}
 */
function shouldAttemptTrialStartedPing(licenceData, sentAt) {
  if (sentAt) return false;
  if (!licenceData || !licenceData.key) return false;
  return licenceData.trialStartedPending === true;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST JSON with exponential-style backoff. Invokes onSuccess only after a fulfilled postFn (2xx).
 *
 * @param {{
 *   postFn: (url: string, body: object, opts: object) => Promise<unknown>,
 *   url: string,
 *   body: object,
 *   timeoutMs?: number,
 *   retryDelaysMs?: number[],
 *   onSuccess?: () => void,
 * }} options
 * @returns {Promise<boolean>} true if sent successfully
 */
async function postStatsWithRetry(options) {
  const opts = options || {};
  const postFn = opts.postFn;
  const url = opts.url;
  const body = opts.body;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : HEARTBEAT_POST_TIMEOUT_MS;
  const delays = Array.isArray(opts.retryDelaysMs) ? opts.retryDelaysMs : [...HEARTBEAT_RETRY_DELAYS_MS];
  if (typeof postFn !== 'function' || !url) return false;

  const attempts = delays.length + 1;
  for (let i = 0; i < attempts; i++) {
    try {
      await postFn(url, body, { timeout: timeoutMs });
      if (typeof opts.onSuccess === 'function') opts.onSuccess();
      return true;
    } catch (_) {
      if (i >= attempts - 1) return false;
      const wait = delays[i];
      if (wait > 0) await sleepMs(wait);
    }
  }
  return false;
}

/**
 * Run callback after the renderer has loaded (handles did-finish-load races).
 *
 * @param {import('electron').WebContents|null|undefined} webContents
 * @param {number} delayMs
 * @param {() => void} run
 */
function deferAfterWebContentsLoad(webContents, delayMs, run) {
  if (!webContents || webContents.isDestroyed()) return;
  const fire = () => {
    setTimeout(() => {
      try {
        run();
      } catch (_) {}
    }, delayMs);
  };
  try {
    if (!webContents.isLoading()) {
      fire();
      return;
    }
  } catch (_) {}
  webContents.once('did-finish-load', fire);
}

module.exports = {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_RECHECK_INTERVAL_MS,
  HEARTBEAT_STARTUP_DELAY_MS,
  HEARTBEAT_STATE_FILE,
  HEARTBEAT_PENDING_MAX_DAYS,
  TRIAL_STARTED_STATE_FILE,
  HEARTBEAT_POST_TIMEOUT_MS,
  HEARTBEAT_RETRY_DELAYS_MS,
  ALLOWED_PAYLOAD_KEYS,
  ALLOWED_INSTALL_SOURCES,
  ALLOWED_PLATFORMS,
  ALLOWED_TIERS,
  MACHINE_ID_HEX_RE,
  USAGE_DATE_RE,
  formatUsageDateUtc,
  shouldSendHeartbeat,
  isUsageDateAcked,
  normalizeHeartbeatState,
  readHeartbeatState,
  writeHeartbeatState,
  markUsageDateAcked,
  enqueueHeartbeatPayload,
  listPendingUsageDates,
  heartbeatWorkRemaining,
  flushHeartbeatQueue,
  buildHeartbeatPayload,
  coercePlatform,
  resolveInstallSource,
  coerceInstallSource,
  resolveAnalyticsTier,
  payloadIsPrivacySafe,
  readLastHeartbeatAt,
  writeLastHeartbeatAt,
  readTrialStartedSentAt,
  writeTrialStartedSentAt,
  shouldAttemptTrialStartedPing,
  postStatsWithRetry,
  deferAfterWebContentsLoad,
  sleepMs,
};
