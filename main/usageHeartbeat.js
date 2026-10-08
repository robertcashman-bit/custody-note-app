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
const ALLOWED_PAYLOAD_KEYS = Object.freeze([
  'machineId',
  'platform',
  'appVersion',
  'tier',
  'installSource',
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
 * @param {{ machineId: string, platform: string, appVersion: string, tier: string, installSource?: string }} fields
 * @param {object} [installEnv] passed to resolveInstallSource when installSource is omitted
 * @returns {{ machineId: string, platform: string, appVersion: string, tier: string, installSource: string }}
 */
function buildHeartbeatPayload(fields, installEnv) {
  const src = fields && typeof fields === 'object' ? fields : {};
  const tierRaw = String(src.tier || 'none');
  const tier = ALLOWED_TIERS.includes(tierRaw) ? tierRaw : 'none';
  const installSource =
    src.installSource != null && src.installSource !== ''
      ? coerceInstallSource(src.installSource)
      : resolveInstallSource(installEnv);
  return {
    machineId: String(src.machineId || ''),
    platform: String(src.platform || ''),
    appVersion: String(src.appVersion || ''),
    tier,
    installSource,
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
  try {
    const raw = fsModule.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || data.lastHeartbeatAt == null || data.lastHeartbeatAt === '') return null;
    return data.lastHeartbeatAt;
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} filePath
 * @param {{ writeFileSync: Function }} fsModule
 * @param {string|number} at
 */
function writeLastHeartbeatAt(filePath, fsModule, at) {
  const stamp = typeof at === 'number' ? new Date(at).toISOString() : String(at);
  fsModule.writeFileSync(
    filePath,
    JSON.stringify({ lastHeartbeatAt: stamp }, null, 0),
    'utf8'
  );
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
  TRIAL_STARTED_STATE_FILE,
  HEARTBEAT_POST_TIMEOUT_MS,
  HEARTBEAT_RETRY_DELAYS_MS,
  ALLOWED_PAYLOAD_KEYS,
  ALLOWED_INSTALL_SOURCES,
  ALLOWED_TIERS,
  MACHINE_ID_HEX_RE,
  shouldSendHeartbeat,
  buildHeartbeatPayload,
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
