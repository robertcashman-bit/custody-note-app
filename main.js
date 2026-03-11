const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

/* Portable trial: when userData folder exists next to the exe, use it so trial packages work. */
if (app.isPackaged) {
  const exeDir = path.dirname(process.execPath);
  const portableUserData = path.join(exeDir, 'userData');
  if (fs.existsSync(portableUserData)) {
    app.setPath('userData', portableUserData);
  }
}
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const initSqlJs = require('sql.js');
const { parseCasenotePdfTextToRecordData } = require('./importers/casenote-pdf-import');
const { createSyncWorker } = require('./main/syncWorker');
const { createBackupScheduler } = require('./main/backupScheduler');

let mainWindow;
let db;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

/* ═══════════════════════════════════════════════
   DATABASE ENCRYPTION (AES-256-GCM + dual key)
   ═══════════════════════════════════════════════ */
const MAGIC = 'CNDB';
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha512';
let _masterKey = null;
let _recoveryPasswordHash = null;
let _needsFallbackMigration = false;

function getKeyFilePath() {
  return path.join(app.getPath('userData'), 'encryption.key');
}

function getRecoveryFilePath() {
  return path.join(app.getPath('userData'), 'recovery.dat');
}

// Fallback key file used when Electron safeStorage is unavailable on this system.
// The database is still AES-256-GCM encrypted; only the key-file itself lacks
// OS-level protection in this mode. Users are advised to set a recovery password.
function getFallbackKeyPath() {
  return path.join(app.getPath('userData'), 'master.fallback');
}

function getOrCreateMasterKey() {
  if (_masterKey) return _masterKey;
  const keyPath = getKeyFilePath();
  const fallbackPath = getFallbackKeyPath();

  if (safeStorage.isEncryptionAvailable()) {
    // Primary path: OS-protected safeStorage
    if (fs.existsSync(keyPath)) {
      try {
        _masterKey = safeStorage.decryptString(fs.readFileSync(keyPath));
        return _masterKey;
      } catch (err) {
        console.warn('[Encryption] Cannot decrypt safeStorage key (new machine?):', err.message);
        // Fall through to fallback below
      }
    }
    _masterKey = crypto.randomBytes(32).toString('hex');
    saveMasterKeyToSafeStorage(_masterKey);
    return _masterKey;
  }

  // safeStorage not available — use obfuscated fallback file so the key persists across restarts.
  // The key is encrypted with a machine-derived key (not truly secure against a determined local
  // attacker, but prevents casual exposure). Users should set a recovery password ASAP.
  console.warn('[Encryption] safeStorage unavailable; using obfuscated fallback. Set a recovery password in Settings.');
  if (fs.existsSync(fallbackPath)) {
    try {
      const raw = fs.readFileSync(fallbackPath);
      const k = _decryptFallbackKey(raw);
      if (k && k.length === 64) {
        _masterKey = k;
        _needsFallbackMigration = true;
        return _masterKey;
      }
      // Legacy plaintext fallback (pre-obfuscation upgrade)
      const plaintext = raw.toString('utf8').trim();
      if (plaintext && plaintext.length === 64 && /^[0-9a-f]+$/.test(plaintext)) {
        _masterKey = plaintext;
        _needsFallbackMigration = true;
        _writeFallbackKeyEncrypted(fallbackPath, _masterKey);
        return _masterKey;
      }
    } catch (err) {
      console.warn('[Encryption] Cannot read fallback key:', err.message);
    }
  }
  _masterKey = crypto.randomBytes(32).toString('hex');
  _writeFallbackKeyEncrypted(fallbackPath, _masterKey);
  return _masterKey;
}

function _getMachineObfuscationKey() {
  const os = require('os');
  const raw = 'cn-fallback:' + [os.hostname(), os.platform(), os.arch(), (os.cpus()[0] || {}).model || '', os.totalmem()].join('|');
  return crypto.createHash('sha256').update(raw).digest();
}

function _writeFallbackKeyEncrypted(filePath, hexKey) {
  try {
    const mk = _getMachineObfuscationKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', mk, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(hexKey, 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();
    fs.writeFileSync(filePath, Buffer.concat([iv, tag, enc]));
  } catch (err) {
    console.error('[Encryption] Cannot write obfuscated fallback key:', err.message);
  }
}

function _decryptFallbackKey(buf) {
  if (!buf || buf.length < 28) return null;
  try {
    const mk = _getMachineObfuscationKey();
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const enc = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', mk, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (_) {
    return null;
  }
}

function saveMasterKeyToSafeStorage(hexKey) {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = safeStorage.encryptString(hexKey);
      fs.writeFileSync(getKeyFilePath(), encrypted);
      deleteFallbackKeyIfExists();
    } catch (err) {
      console.error('[Encryption] Failed to save key to safeStorage:', err.message);
    }
  }
  if (!safeStorage.isEncryptionAvailable()) {
    _writeFallbackKeyEncrypted(getFallbackKeyPath(), hexKey);
  }
}

function deleteFallbackKeyIfExists() {
  const fb = getFallbackKeyPath();
  if (fs.existsSync(fb)) {
    try { fs.unlinkSync(fb); console.info('[Encryption] Removed legacy plaintext fallback key.'); } catch (_) {}
  }
}

function deriveKeyFromPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
}

async function setRecoveryPassword(password) {
  const masterKeyHex = getOrCreateMasterKey();
  if (!masterKeyHex) throw new Error('Master key not available');
  const salt = crypto.randomBytes(32);
  const derived = deriveKeyFromPassword(password, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(masterKeyHex, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  const data = Buffer.concat([salt, iv, tag, enc]);
  fs.writeFileSync(getRecoveryFilePath(), data);
  _recoveryPasswordHash = crypto.createHash('sha256').update(password).digest('hex');
  deleteFallbackKeyIfExists();
  _needsFallbackMigration = false;
  const cloudBackupOk = await uploadKeyEscrow();
  return { cloudBackupOk };
}

function hasRecoveryPassword() {
  return fs.existsSync(getRecoveryFilePath());
}

function tryRecoverMasterKey(password) {
  const recPath = getRecoveryFilePath();
  if (!fs.existsSync(recPath)) return null;
  const data = fs.readFileSync(recPath);
  const salt = data.slice(0, 32);
  const iv = data.slice(32, 44);
  const tag = data.slice(44, 60);
  const enc = data.slice(60);
  const derived = deriveKeyFromPassword(password, salt);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', derived, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch (_) {
    return null;
  }
}

/* ─── Cloud key escrow ─── */
function encryptMasterKeyForEscrow(masterKeyHex, licenceKey) {
  const salt = crypto.createHash('sha256').update('cn-escrow-salt:' + licenceKey.trim().toUpperCase()).digest();
  const derived = crypto.pbkdf2Sync(licenceKey.trim().toUpperCase(), salt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(masterKeyHex, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptMasterKeyFromEscrow(blob, licenceKey) {
  const raw = Buffer.from(blob, 'base64');
  if (raw.length < 28) return null;
  const iv = raw.slice(0, 12);
  const tag = raw.slice(12, 28);
  const enc = raw.slice(28);
  const salt = crypto.createHash('sha256').update('cn-escrow-salt:' + licenceKey.trim().toUpperCase()).digest();
  const derived = crypto.pbkdf2Sync(licenceKey.trim().toUpperCase(), salt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', derived, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch (_) {
    return null;
  }
}

async function uploadKeyEscrow() {
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) return false;
  const data = readLicenceData();
  if (!data || !data.key || !_masterKey) return false;
  try {
    const blob = encryptMasterKeyForEscrow(_masterKey, data.key);
    const resp = await httpPost(`${apiUrl}/api/recovery`, {
      key: data.key,
      machineId: getMachineId(),
      blob,
    });
    if (resp && resp.ok) {
      console.info('[Recovery] Key escrow uploaded to cloud.');
      return true;
    }
  } catch (e) {
    console.warn('[Recovery] Failed to upload key escrow:', e && e.message ? e.message : e);
  }
  return false;
}

function encryptBuffer(buf) {
  const masterKeyHex = getOrCreateMasterKey();
  if (!masterKeyHex) {
    console.warn('[Encryption] No master key, writing unencrypted');
    return buf;
  }
  const key = Buffer.from(masterKeyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  const magic = Buffer.from(MAGIC);
  return Buffer.concat([magic, iv, tag, encrypted]);
}

function decryptBuffer(buf) {
  if (!buf || buf.length < 4) return buf;
  const magic = buf.slice(0, 4).toString();
  if (magic !== MAGIC) return buf;
  const iv = buf.slice(4, 16);
  const tag = buf.slice(16, 32);
  const data = buf.slice(32);
  let masterKeyHex = getOrCreateMasterKey();
  if (!masterKeyHex) {
    return null;
  }
  const key = Buffer.from(masterKeyHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

async function decryptBufferWithRecovery(buf) {
  if (!buf || buf.length < 4) return buf;
  const magic = buf.slice(0, 4).toString();
  if (magic !== MAGIC) return buf;
  const iv = buf.slice(4, 16);
  const tag = buf.slice(16, 32);
  const data = buf.slice(32);
  let masterKeyHex = getOrCreateMasterKey();
  if (!masterKeyHex && hasRecoveryPassword()) {
    masterKeyHex = await promptForRecoveryPassword();
    if (masterKeyHex) {
      _masterKey = masterKeyHex;
      saveMasterKeyToSafeStorage(masterKeyHex);
    }
  }
  if (!masterKeyHex) {
    throw new Error('Cannot decrypt database: no key available. If you have a recovery password, ensure the recovery.dat file is present.');
  }
  const key = Buffer.from(masterKeyHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

async function promptForRecoveryPassword() {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const inputResult = await showPasswordInputDialog();
    if (!inputResult) return null;
    const recovered = tryRecoverMasterKey(inputResult);
    if (recovered) return recovered;
    if (attempt < MAX_ATTEMPTS) {
      await dialog.showMessageBox(mainWindow || null, {
        type: 'warning',
        title: 'Incorrect Password',
        message: 'The recovery password is incorrect.\nAttempt ' + attempt + ' of ' + MAX_ATTEMPTS + '.',
        buttons: ['Try Again'],
      });
    }
  }
  dialog.showErrorBox('Recovery Failed', 'Too many incorrect attempts. The database cannot be unlocked.\nThe app will start with a fresh database.');
  return null;
}

function showPasswordInputDialog() {
  return new Promise((resolve) => {
    let resolved = false;

    function done(value) {
      if (resolved) return;
      resolved = true;
      ipcMain.removeAllListeners('recovery-pw-submit');
      ipcMain.removeAllListeners('recovery-pw-cancel');
      if (win && !win.isDestroyed()) win.destroy();
      resolve(value || null);
    }

    const win = new BrowserWindow({
      width: 420, height: 220, resizable: false,
      minimizable: false, maximizable: false,
      modal: true, parent: mainWindow || null,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'password-preload.js'),
      },
      title: 'Recovery Password',
      autoHideMenuBar: true,
    });

    ipcMain.once('recovery-pw-submit', (_, pw) => done(pw));
    ipcMain.once('recovery-pw-cancel', () => done(null));

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>body{font-family:Segoe UI,sans-serif;padding:20px;margin:0;background:#f5f5f5;}
    label{display:block;margin-bottom:6px;font-weight:600;}
    .pw-row{display:flex;align-items:center;gap:8px;}
    input{flex:1;padding:8px;font-size:14px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;}
    .btns{margin-top:16px;text-align:right;}
    button{padding:8px 20px;font-size:14px;border:none;border-radius:4px;cursor:pointer;margin-left:8px;}
    .ok{background:#2563eb;color:#fff;} .cancel{background:#e5e5e5;}
    .toggle-pw{padding:8px 12px;font-size:13px;background:#e5e5e5;}</style></head>
    <body><label>Enter recovery password:</label>
    <div class="pw-row">
      <input type="password" id="pw" autofocus>
      <button type="button" id="toggle-pw" class="toggle-pw" aria-label="Show password">Show</button>
    </div>
    <div class="btns">
      <button class="cancel" onclick="window.pwdApi.cancel()">Cancel</button>
      <button class="ok" onclick="doSubmit()">Unlock</button>
    </div>
    <script>
    function doSubmit(){var v=document.getElementById('pw').value;if(v)window.pwdApi.submit(v);}
    document.getElementById('pw').addEventListener('keydown',function(e){
      if(e.key==='Enter')doSubmit();
      if(e.key==='Escape')window.pwdApi.cancel();
    });
    var inp=document.getElementById('pw'),tbtn=document.getElementById('toggle-pw');
    tbtn.addEventListener('click',function(){
      var isPw=inp.type==='password';
      inp.type=isPw?'text':'password';
      tbtn.textContent=isPw?'Hide':'Show';
      tbtn.setAttribute('aria-label',isPw?'Hide password':'Show password');
    });
    </script></body></html>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.on('closed', () => done(null));
  });
}

function getDbPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'attendances.db');
}

let _saveDbInProgress = false;

function saveDb() {
  if (!db) return;
  if (_saveDbInProgress) return; /* Prevent concurrent saves – avoids ENOENT race on rename */
  _saveDbInProgress = true;
  try {
    const data = db.export();
    const encrypted = encryptBuffer(Buffer.from(data));
    const dbPath = getDbPath();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = dbPath + '.tmp';
    fs.writeFileSync(tmpPath, encrypted);
    if (fs.existsSync(tmpPath)) {
      fs.renameSync(tmpPath, dbPath);
    }
  } catch (err) {
    console.error('[saveDb] Failed to save database:', err.message);
  } finally {
    _saveDbInProgress = false;
  }
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

let _dbDirty = false;
let _dbSaveTimer = null;
const DB_SAVE_DEBOUNCE_MS = 500;

function markDbDirtyForSave() {
  _dbDirty = true;
  if (!_dbSaveTimer) {
    _dbSaveTimer = setTimeout(() => {
      _dbSaveTimer = null;
      if (_dbDirty) { _dbDirty = false; saveDb(); }
    }, DB_SAVE_DEBOUNCE_MS);
  }
}

function flushDb() {
  if (_dbSaveTimer) { clearTimeout(_dbSaveTimer); _dbSaveTimer = null; }
  if (_dbDirty) { _dbDirty = false; saveDb(); }
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  markDbDirtyForSave();
}

function parseSqliteDateTimeToMs(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6])
  ).getTime();
}

function createDbSafetyCopy(tag = 'repair') {
  try {
    const src = getDbPath();
    if (!src || !fs.existsSync(src)) return null;
    const baseDir = path.dirname(src);
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const dest = path.join(baseDir, `attendances.db.${tag}.${stamp}.bak`);
    fs.copyFileSync(src, dest);
    return dest;
  } catch (e) {
    console.warn('[DB] Safety copy failed:', e && e.message ? e.message : e);
    return null;
  }
}

function extractIndexedAttendanceFields(parsed) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const clientName = [p.surname || '', p.forename || ''].filter(Boolean).join(', ');
  const stationName = p.policeStationName || '';
  const dsccRef = p.dsccRef || '';
  const attendanceDate = p.date || (p.instructionDateTime ? String(p.instructionDateTime).slice(0, 10) : '') || '';
  return { clientName, stationName, dsccRef, attendanceDate };
}

function backfillAttendanceIndexColumns({ limit = 10000 } = {}) {
  if (!db) return 0;
  try {
    const rows = dbAll(
      `SELECT id, data, client_name, station_name, dscc_ref, attendance_date
       FROM attendances
       WHERE deleted_at IS NULL
         AND (COALESCE(client_name,'')='' OR COALESCE(station_name,'')='' OR COALESCE(dscc_ref,'')='' OR COALESCE(attendance_date,'')='')
       LIMIT ?`,
      [limit]
    );

    let updated = 0;
    rows.forEach((r) => {
      if (!r || !r.id || !r.data) return;
      let parsed;
      try { parsed = JSON.parse(r.data); } catch (_) { return; }
      const f = extractIndexedAttendanceFields(parsed);
      const nextClient = (r.client_name != null && String(r.client_name).trim()) ? r.client_name : f.clientName;
      const nextStation = (r.station_name != null && String(r.station_name).trim()) ? r.station_name : f.stationName;
      const nextDscc = (r.dscc_ref != null && String(r.dscc_ref).trim()) ? r.dscc_ref : f.dsccRef;
      const nextDate = (r.attendance_date != null && String(r.attendance_date).trim()) ? r.attendance_date : f.attendanceDate;

      if (nextClient === (r.client_name || '') && nextStation === (r.station_name || '') && nextDscc === (r.dscc_ref || '') && nextDate === (r.attendance_date || '')) return;
      db.run(
        'UPDATE attendances SET client_name=?, station_name=?, dscc_ref=?, attendance_date=? WHERE id=?',
        [nextClient || '', nextStation || '', nextDscc || '', nextDate || '', r.id]
      );
      updated++;
    });

    if (updated) saveDb();
    return updated;
  } catch (e) {
    console.warn('[DB] Backfill index columns failed:', e && e.message ? e.message : e);
    return 0;
  }
}

function normalizeKeyPart(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

function buildDraftDedupeKey(row, parsed) {
  const dscc = normalizeKeyPart(row.dscc_ref || parsed.dsccRef).toUpperCase();
  const date = normalizeKeyPart(
    row.attendance_date ||
    parsed.date ||
    (parsed.instructionDateTime ? String(parsed.instructionDateTime).slice(0, 10) : '')
  );
  const station = normalizeKeyPart(row.station_name || parsed.policeStationName).toLowerCase();
  const client = normalizeKeyPart(
    row.client_name || [parsed.surname || '', parsed.forename || ''].filter(Boolean).join(', ')
  ).toLowerCase();
  const custody = normalizeKeyPart(parsed.custodyNumber).toLowerCase();

  if (dscc) return `dscc:${dscc}|date:${date}|station:${station}`;

  const hasClientTriplet = !!(client && date && station);
  const hasCustodyTriplet = !!(custody && date && station);
  if (hasClientTriplet) return `client:${client}|date:${date}|station:${station}`;
  if (hasCustodyTriplet) return `custody:${custody}|date:${date}|station:${station}`;

  return null;
}

/** Build case key from parsed data only (for incoming save). */
function buildCaseKeyFromParsed(parsed) {
  const row = {
    client_name: [parsed.surname || '', parsed.forename || ''].filter(Boolean).join(', '),
    station_name: parsed.policeStationName || '',
    dscc_ref: parsed.dsccRef || '',
    attendance_date: parsed.date || (parsed.instructionDateTime ? String(parsed.instructionDateTime).slice(0, 10) : ''),
  };
  return buildDraftDedupeKey(row, parsed);
}

/** If an existing draft matches this case key, return its id (most recently updated). Used to avoid creating a second copy. */
function findExistingDraftIdByCaseKey(parsed) {
  if (!db) return null;
  const key = buildCaseKeyFromParsed(parsed);
  if (!key) return null;
  try {
    const dscc = normalizeKeyPart(parsed.dsccRef).toUpperCase();
    const date = normalizeKeyPart(parsed.date || (parsed.instructionDateTime ? String(parsed.instructionDateTime).slice(0, 10) : ''));
    const station = normalizeKeyPart(parsed.policeStationName).toLowerCase();
    const client = normalizeKeyPart([parsed.surname || '', parsed.forename || ''].filter(Boolean).join(', ')).toLowerCase();

    let rows;
    if (dscc) {
      rows = dbAll(
        "SELECT id, data, client_name, station_name, dscc_ref, attendance_date FROM attendances WHERE status='draft' AND deleted_at IS NULL AND dscc_ref=? ORDER BY updated_at DESC LIMIT 5",
        [dscc]
      );
    } else if (client && date && station) {
      rows = dbAll(
        "SELECT id, data, client_name, station_name, dscc_ref, attendance_date FROM attendances WHERE status='draft' AND deleted_at IS NULL AND client_name=? AND attendance_date=? ORDER BY updated_at DESC LIMIT 5",
        [client, date]
      );
    } else {
      rows = dbAll(
        "SELECT id, data, client_name, station_name, dscc_ref, attendance_date FROM attendances WHERE status='draft' AND deleted_at IS NULL ORDER BY updated_at DESC"
      );
    }
    for (const r of rows) {
      if (!r || !r.data) continue;
      let p = {};
      try { p = JSON.parse(r.data); } catch (_) { continue; }
      if (buildDraftDedupeKey(r, p) === key) return r.id;
    }
  } catch (e) {
    console.warn('[DB] findExistingDraftIdByCaseKey failed:', e && e.message ? e.message : e);
  }
  return null;
}

function dedupeDraftsByCaseKeys() {
  if (!db) return 0;
  try {
    const rows = dbAll(
      "SELECT id, data, updated_at, client_name, station_name, dscc_ref, attendance_date FROM attendances WHERE status='draft' AND deleted_at IS NULL"
    );
    if (!rows || rows.length < 2) return 0;

    const groups = new Map();
    rows.forEach((r) => {
      if (!r || !r.id || !r.data) return;
      let parsed = {};
      try { parsed = JSON.parse(r.data); } catch (_) { parsed = {}; }
      const key = buildDraftDedupeKey(r, parsed);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });

    let removed = 0;
    for (const [, group] of groups.entries()) {
      if (!group || group.length < 2) continue;
      group.sort((a, b) => {
        const ta = parseSqliteDateTimeToMs(a.updated_at) || 0;
        const tb = parseSqliteDateTimeToMs(b.updated_at) || 0;
        if (ta !== tb) return tb - ta;
        return (b.id || 0) - (a.id || 0);
      });
      const keep = group[0];
      group.slice(1).forEach((r) => {
        if (r.id === keep.id) return;
        db.run('DELETE FROM attendances WHERE id=?', [r.id]);
        removed++;
      });
    }

    if (removed) {
      saveDb();
      console.log('[DB] Removed', removed, 'draft duplicates (case-key dedupe)');
    }
    return removed;
  } catch (e) {
    console.warn('[DB] Case-key draft dedupe failed:', e && e.message ? e.message : e);
    return 0;
  }
}

function cleanupAccidentalDuplicateDrafts({ windowMs = 2 * 60 * 1000 } = {}) {
  if (!db) return 0;
  try {
    const groups = dbAll(
      "SELECT data, COUNT(*) as c FROM attendances WHERE status='draft' AND deleted_at IS NULL GROUP BY data HAVING c > 1"
    );

    let removed = 0;
    groups.forEach((g) => {
      if (!g || !g.data) return;

      const rows = dbAll(
        "SELECT id, created_at, updated_at FROM attendances WHERE status='draft' AND deleted_at IS NULL AND data=? ORDER BY created_at ASC, id ASC",
        [g.data]
      );
      if (!rows || rows.length < 2) return;

      const first = parseSqliteDateTimeToMs(rows[0].created_at);
      const last = parseSqliteDateTimeToMs(rows[rows.length - 1].created_at);
      if (!first || !last) return;

      // Only treat as accidental duplicates if they were created in a short burst.
      if ((last - first) > windowMs) return;

      const keep = dbGet(
        "SELECT id FROM attendances WHERE status='draft' AND deleted_at IS NULL AND data=? ORDER BY updated_at DESC, id DESC LIMIT 1",
        [g.data]
      );
      const keepId = keep && keep.id;
      if (!keepId) return;

      rows.forEach((r) => {
        if (r.id === keepId) return;
        db.run('DELETE FROM attendances WHERE id=?', [r.id]);
        removed++;
      });
    });

    if (removed) {
      saveDb();
      console.log('[DB] Removed', removed, 'accidental duplicate drafts');
    }
    return removed;
  } catch (e) {
    console.warn('[DB] Duplicate draft cleanup failed:', e && e.message ? e.message : e);
    return 0;
  }
}

function getBackupFolder() {
  try {
    const row = dbGet("SELECT value FROM settings WHERE key = 'backupFolder'");
    if (row && row.value) return row.value;
  } catch (_) {}
  return app.getPath('desktop');
}

function getOffsiteBackupFolder() {
  try {
    const row = dbGet("SELECT value FROM settings WHERE key = 'offsiteBackupFolder'");
    if (row && row.value && String(row.value).trim()) return String(row.value).trim();
  } catch (_) {}
  return null;
}

function copyToOffsiteBackup(localFilePath) {
  const offsiteDir = getOffsiteBackupFolder();
  if (!offsiteDir || !fs.existsSync(offsiteDir)) return;
  try {
    const name = path.basename(localFilePath);
    const dest = path.join(offsiteDir, name);
    fs.copyFileSync(localFilePath, dest);
    console.log('[Backup] Copied to off-site:', name);
  } catch (err) {
    console.error('[Backup] Off-site copy failed:', err.message);
  }
}

/** If cloud backup URL is set in settings, upload the given buffer (non-blocking). */
function uploadToCloudIfConfigured(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return;
  try {
    const rowUrl = dbGet("SELECT value FROM settings WHERE key = 'cloudBackupUrl'");
    const rowToken = dbGet("SELECT value FROM settings WHERE key = 'cloudBackupToken'");
    const url = rowUrl && rowUrl.value ? String(rowUrl.value).trim() : '';
    const token = rowToken && rowToken.value ? String(rowToken.value).trim() : '';
    if (!url) return;
    uploadBackupToCloud(url, buffer, token).then(() => {
      console.log('[Backup] Cloud upload succeeded');
    }).catch(err => {
      console.error('[Backup] Cloud upload failed:', err && err.message ? err.message : err);
    });
  } catch (e) {}
}

async function initDb() {
  const SQL = await initSqlJs();
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    const rawBuf = fs.readFileSync(dbPath);
    const buf = await decryptBufferWithRecovery(rawBuf);
    if (!buf) {
      dialog.showErrorBox('Database Error', 'Could not decrypt the database. The app will start with a fresh database.');
      db = new SQL.Database();
    } else {
      db = new SQL.Database(buf);
    }
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`);

  db.run(`
    CREATE TABLE IF NOT EXISTS attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      data TEXT NOT NULL,
      status TEXT DEFAULT 'draft'
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS police_stations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      scheme TEXT DEFAULT '',
      region TEXT DEFAULT '',
      UNIQUE(name, code)
    );
  `);

  try { db.run("ALTER TABLE police_stations ADD COLUMN scheme TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE police_stations ADD COLUMN region TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE firms ADD COLUMN contact_name TEXT DEFAULT ''"); } catch (_) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS firms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      laa_account TEXT DEFAULT '',
      contact_name TEXT DEFAULT '',
      contact_email TEXT DEFAULT '',
      contact_phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      source_of_referral TEXT DEFAULT '',
      is_default INTEGER DEFAULT 0,
      UNIQUE(name)
    );
  `);
  try { db.run("ALTER TABLE firms ADD COLUMN source_of_referral TEXT DEFAULT ''"); } catch (_) {}

  db.run(`CREATE INDEX IF NOT EXISTS idx_attendances_updated ON attendances(updated_at);`);

  /* ─── Audit log ─── */
  db.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER,
    action TEXT,
    previous_snapshot TEXT,
    changed_fields TEXT,
    timestamp TEXT DEFAULT (datetime('now')),
    user_note TEXT
  );`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_attendance ON audit_log(attendance_id);`);

  /* ─── Sync queue (offline-first, per-record, one bad never blocks) ─── */
  db.run(`CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    operation TEXT DEFAULT 'upsert',
    payload TEXT,
    created_at INTEGER NOT NULL,
    retry_count INTEGER DEFAULT 0,
    last_attempt INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    error TEXT
  );`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sync_queue_record ON sync_queue(record_id);`);

  /* ─── Sync attempt audit (for reliability and traceability) ─── */
  db.run(`CREATE TABLE IF NOT EXISTS sync_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    correlation_id TEXT,
    direction TEXT NOT NULL,
    record_count INTEGER DEFAULT 0,
    success INTEGER NOT NULL,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sync_attempts_created ON sync_attempts(created_at);`);

  /* ─── Soft-delete & indexed search columns (idempotent) ─── */
  try { db.run("ALTER TABLE attendances ADD COLUMN deleted_at TEXT DEFAULT NULL"); } catch (_) {}
  try { db.run("ALTER TABLE attendances ADD COLUMN deletion_reason TEXT DEFAULT NULL"); } catch (_) {}
  try { db.run("ALTER TABLE attendances ADD COLUMN client_name TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE attendances ADD COLUMN station_name TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE attendances ADD COLUMN dscc_ref TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE attendances ADD COLUMN attendance_date TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE attendances ADD COLUMN supervisor_approved_at TEXT DEFAULT NULL"); } catch (_) {}
  try { db.run("ALTER TABLE attendances ADD COLUMN supervisor_note TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE attendances ADD COLUMN archived_at TEXT DEFAULT NULL"); } catch (_) {}

  /* ─── Cross-device sync columns ─── */
  try { db.run("ALTER TABLE attendances ADD COLUMN sync_id TEXT DEFAULT NULL"); } catch (_) {}
  try { db.run("ALTER TABLE attendances ADD COLUMN sync_dirty INTEGER DEFAULT 1"); } catch (_) {}
  try { db.run("ALTER TABLE attendances ADD COLUMN sync_version INTEGER DEFAULT 1"); } catch (_) {}
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_att_sync_id ON attendances(sync_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_att_sync_dirty ON attendances(sync_dirty);`);
  backfillSyncIds();
  migrateSyncDirtyToQueue();

  db.run(`CREATE INDEX IF NOT EXISTS idx_att_client ON attendances(client_name);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_att_date ON attendances(attendance_date);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_att_dscc ON attendances(dscc_ref);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_att_status ON attendances(status);`);

  const existing = dbGet("SELECT 1 FROM settings WHERE key = 'backupFolder'");
  if (!existing) {
    db.run("INSERT INTO settings (key, value) VALUES (?, ?)", ['backupFolder', app.getPath('desktop')]);
  }

  loadStationsFromFile();
  saveDb();
  return db;
}

function loadStationsFromFile() {
  const stationsPath = path.join(__dirname, 'data', 'police-stations-laa.json');
  if (!fs.existsSync(stationsPath)) return;
  let stations;
  try {
    stations = JSON.parse(fs.readFileSync(stationsPath, 'utf8'));
  } catch (e) {
    console.error('[loadStationsFromFile] Failed to parse police-stations-laa.json:', e && e.message);
    return;
  }
  if (!Array.isArray(stations)) return;
  try { db.run('BEGIN TRANSACTION'); } catch (_) {}
  for (const s of stations) {
    try {
      const existing = dbGet('SELECT id FROM police_stations WHERE name = ? AND code = ?', [s.name || '', s.code || '']);
      if (existing) {
        db.run('UPDATE police_stations SET scheme = ?, region = ? WHERE id = ?',
          [s.scheme || '', s.region || '', existing.id]);
      } else {
        db.run('INSERT OR IGNORE INTO police_stations (name, code, scheme, region) VALUES (?, ?, ?, ?)',
          [s.name || '', s.code || '', s.scheme || '', s.region || '']);
      }
    } catch (_) {}
  }
  try { db.run('COMMIT'); } catch (_) {}
}

/* ─── SMART BACKUP SYSTEM ─── */
let dbDirtySinceQuickBackup = false;
let dbDirtySinceHourlyBackup = false;
const MAX_HOURLY_BACKUPS = 48;

let _backupScheduler = null;

function getBackupScheduler() {
  if (_backupScheduler) return _backupScheduler;
  _backupScheduler = createBackupScheduler({
    runBackup: (kind, reason) => {
      console.log('[Backup] Scheduler triggered:', kind, reason);
      if (kind === 'hourly') {
        return _runHourlyBackupAsync();
      }
      return _runQuickBackupAsync();
    },
    onStatusChange: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backup-status-changed', status);
      }
    },
  });
  return _backupScheduler;
}

function _runQuickBackupAsync() {
  if (!db) return { skipped: true, reason: 'db-missing' };
  if (!isBackupFolderReady()) return { skipped: true, reason: 'backup-folder-missing' };
  const dest = path.join(getBackupFolder(), 'attendance-latest.db');
  const start = Date.now();
  try {
    const data = db.export();
    const encrypted = encryptBuffer(Buffer.from(data));
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, encrypted);
    fs.renameSync(tmp, dest);
    console.log('[Backup] Quick backup saved (encrypted), took', Date.now() - start, 'ms,', encrypted.length, 'bytes');
    copyToOffsiteBackup(dest);
    uploadToCloudIfConfigured(encrypted);
    uploadToS3IfConfigured(encrypted, 'attendance-latest.db');
    uploadToManagedCloudIfEnabled(encrypted, 'attendance-latest.db');
    return { durationMs: Date.now() - start, bytes: encrypted.length };
  } catch (err) {
    console.error('[Backup] Quick backup failed:', err.message);
    throw err;
  }
}

function _runHourlyBackupAsync() {
  if (!db) return { skipped: true, reason: 'db-missing' };
  if (!isBackupFolderReady()) return { skipped: true, reason: 'backup-folder-missing' };
  const backupDir = getBackupFolder();
  const name = `attendance-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.db`;
  const dest = path.join(backupDir, name);
  const start = Date.now();
  try {
    const data = db.export();
    const encrypted = encryptBuffer(Buffer.from(data));
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, encrypted);
    fs.renameSync(tmp, dest);
    console.log('[Backup] Hourly archive saved (encrypted):', name, 'took', Date.now() - start, 'ms');
    pruneOldBackups(backupDir);
    copyToOffsiteBackup(dest);
    uploadToCloudIfConfigured(encrypted);
    uploadToS3IfConfigured(encrypted, name);
    uploadToManagedCloudIfEnabled(encrypted, name);
    const offsiteDir = getOffsiteBackupFolder();
    if (offsiteDir && fs.existsSync(offsiteDir)) pruneOldBackups(offsiteDir);
    return { durationMs: Date.now() - start, bytes: encrypted.length };
  } catch (err) {
    console.error('[Backup] Hourly backup failed:', err.message);
    throw err;
  }
}

function markDbDirty() {
  dbDirtySinceQuickBackup = true;
  dbDirtySinceHourlyBackup = true;
  const bs = _backupScheduler;
  if (bs) bs.markDirty('db-change');
  scheduleSyncSoon();
}

function isBackupFolderReady() {
  try {
    const dir = getBackupFolder();
    return dir && fs.existsSync(dir);
  } catch (_) { return false; }
}

function runQuickBackup() {
  if (!db || !dbDirtySinceQuickBackup) return;
  const result = _runQuickBackupAsync();
  if (result && !result.skipped) dbDirtySinceQuickBackup = false;
}

function runHourlyBackup() {
  if (!db || !dbDirtySinceHourlyBackup) return;
  const result = _runHourlyBackupAsync();
  if (result && !result.skipped) dbDirtySinceHourlyBackup = false;
}

function pruneOldBackups(backupDir) {
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('attendance-backup-') && f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (files.length > MAX_HOURLY_BACKUPS) {
      files.slice(MAX_HOURLY_BACKUPS).forEach(f => {
        try { fs.unlinkSync(path.join(backupDir, f.name)); } catch (_) {}
      });
      console.log('[Backup] Pruned', files.length - MAX_HOURLY_BACKUPS, 'old archives');
    }
  } catch (_) {}
}

/** POST encrypted backup buffer to a cloud URL. Returns Promise<void> or rejects with error message. */
function uploadBackupToCloud(urlStr, buffer, token) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      reject(new Error('Invalid cloud backup URL'));
      return;
    }
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': buffer.length,
      },
    };
    if (token && String(token).trim()) {
      options.headers['Authorization'] = 'Bearer ' + String(token).trim();
    }
    const req = mod.request(options, (res) => {
      const status = res.statusCode || 0;
      if (status >= 200 && status < 300) {
        resolve();
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        reject(new Error('Cloud backup failed: HTTP ' + status + (body ? ' — ' + body.slice(0, 100) : '')));
      });
    });
    req.on('error', (err) => reject(new Error('Cloud backup failed: ' + (err.message || err))));
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Cloud backup failed: timeout'));
    });
    req.write(buffer);
    req.end();
  });
}

const S3_PREFIX = 'custody-note/';
let _lastS3SuccessTime = null;
let _lastS3Error = null;

/** Cloud backup uses only licence-key + /api/backup/credentials (managed cloud). No stored AWS keys. */
function getS3Config() {
  return null;
}

/** If AWS S3 backup is enabled in settings, upload the buffer to S3 (non-blocking). key = e.g. attendance-latest.db or attendance-backup-2026-02-26-14-30.db */
function uploadToS3IfConfigured(buffer, key) {
  if (!buffer || !Buffer.isBuffer(buffer) || !key) return;
  const config = getS3Config();
  if (!config) return;
  const { region, bucket, accessKeyId, secretAccessKey } = config;
  const s3Key = S3_PREFIX + key;
  import('@aws-sdk/client-s3').then(({ S3Client, PutObjectCommand }) => {
    const client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    return client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: buffer,
      ContentType: 'application/octet-stream',
    }));
  }).then(() => {
    _lastS3SuccessTime = Date.now();
    _lastS3Error = null;
    console.log('[Backup] S3 upload succeeded:', s3Key);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('s3-backup-status');
  }).catch(err => {
    _lastS3Error = err && err.message ? err.message : String(err);
    console.error('[Backup] S3 upload failed:', _lastS3Error);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('s3-backup-status');
  });
}

/* ═══════════════════════════════════════════════
   MANAGED CLOUD BACKUP (subscription-based)
   Uses temp credentials from the licence server.
   ═══════════════════════════════════════════════ */
let _managedCloudCreds = null;
let _managedCloudCredsExpiry = 0;
let _lastManagedCloudSuccess = null;
let _lastManagedCloudError = null;
let _cloudBackupEnabled = false;

const ALLOWED_API_HOSTS = ['custodynote.com', 'www.custodynote.com', 'localhost', '127.0.0.1'];

function isAllowedApiUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:' && !(u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return false;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return ALLOWED_API_HOSTS.some(h => h.replace(/^www\./, '') === host || u.hostname === h);
  } catch (_) { return false; }
}

function getManagedCloudApiUrl() {
  const envBase = process.env.LICENCE_SERVER_BASE_URL;
  if (envBase && typeof envBase === 'string' && isAllowedApiUrl(envBase)) {
    return envBase.replace(/\/$/, '');
  }
  try {
    const cfgPath = path.join(app.getPath('userData'), 'licence-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.apiUrl && isAllowedApiUrl(cfg.apiUrl)) return cfg.apiUrl;
    }
  } catch (_) {}
  return 'https://custodynote.com';
}

async function fetchManagedCloudCredentials() {
  const now = Date.now();
  if (_managedCloudCreds && _managedCloudCredsExpiry > now + 60000) {
    return _managedCloudCreds;
  }
  const data = readLicenceData();
  if (!data || !data.key) return null;
  const apiUrl = getManagedCloudApiUrl();
  try {
    const resp = await httpPost(`${apiUrl}/api/backup/credentials`, { key: data.key });
    if (resp.error) {
      _lastManagedCloudError = resp.error;
      return null;
    }
    if (resp.credentials) {
      _managedCloudCreds = resp.credentials;
      _managedCloudCredsExpiry = new Date(resp.credentials.expiration).getTime();
      return _managedCloudCreds;
    }
  } catch (e) {
    _lastManagedCloudError = e && e.message ? e.message : String(e);
  }
  return null;
}

async function checkCloudBackupEntitlement() {
  const data = readLicenceData();
  const isTrial = !!(data && data.isTrial);
  if (!data || !data.key) {
    _cloudBackupEnabled = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloud-backup-status-changed', { enabled: false, isTrial: false });
    }
    return;
  }
  if (isTrial) {
    // Trial keys never have cloud backup; skip network call
    _cloudBackupEnabled = false;
    console.info('[CloudBackup] Skipping entitlement check — trial licence active. Cloud backup not included.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloud-backup-status-changed', { enabled: false, isTrial: true });
    }
    return;
  }
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) {
    _cloudBackupEnabled = false;
    console.warn('[CloudBackup] No API URL configured');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloud-backup-status-changed', { enabled: false, isTrial: false });
    }
    return;
  }
  try {
    const resp = await httpPost(`${apiUrl}/api/licence/validate`, {
      key: data.key,
      machineId: getMachineId(),
      appVersion: app.getVersion() || '0.0.0',
    });
    _cloudBackupEnabled = !!(resp && resp.cloudBackup);
    console.info('[CloudBackup] Entitlement result: cloudBackup=' + _cloudBackupEnabled + ' valid=' + !!(resp && resp.valid));
    if (resp && resp.expiresAt) data.expiresAt = resp.expiresAt;
    data.cachedCloudBackup = _cloudBackupEnabled;
    data.cachedCloudBackupAt = new Date().toISOString();
    if (resp && resp.valid !== undefined) {
      data.lastValidated = new Date().toISOString();
    }
    writeLicenceData(data);
  } catch (err) {
    const cachedAge = data.cachedCloudBackupAt ? (Date.now() - new Date(data.cachedCloudBackupAt).getTime()) : Infinity;
    const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    if (data.cachedCloudBackup && cachedAge < MAX_CACHE_AGE_MS) {
      _cloudBackupEnabled = true;
      console.warn('[CloudBackup] Entitlement check failed (network issue) — using cached entitlement (age: ' + Math.round(cachedAge / 3600000) + 'h):', err && err.message ? err.message : err);
    } else {
      _cloudBackupEnabled = false;
      console.error('[CloudBackup] Entitlement check failed and no valid cache:', err && err.message ? err.message : err);
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('cloud-backup-status-changed', { enabled: _cloudBackupEnabled, isTrial: false });
  }
}

/** Map AWS/SDK errors to user-friendly codes; return { message, code, correlationId }. */
function mapBackupError(err) {
  const correlationId = 'cn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const msg = err && err.message ? String(err.message) : String(err);
  if (!msg) return { message: 'Backup failed: unknown error', code: 'UNKNOWN', correlationId };
  if (/credentials|Credential|Unauthorized|AccessDenied|403|Forbidden/i.test(msg)) {
    return { message: 'Backup failed: permission denied. Check your licence and try again.', code: 'PERMISSION_DENIED', correlationId };
  }
  if (/bucket|Bucket|NoSuchBucket|InvalidBucket|404/i.test(msg)) {
    return { message: 'Backup failed: configuration missing (bucket). Contact support.', code: 'CONFIG_MISSING', correlationId };
  }
  if (/network|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout/i.test(msg)) {
    return { message: 'Backup failed: network issue. Check your connection and try again.', code: 'NETWORK_ERROR', correlationId };
  }
  if (/ObjectLock|object lock/i.test(msg)) {
    return { message: 'Backup failed: storage configuration issue. Contact support.', code: 'CONFIG_ERROR', correlationId };
  }
  return { message: 'Backup failed: ' + msg.slice(0, 80), code: 'ERROR', correlationId };
}

const MANAGED_BACKUP_MAX_RETRIES = 3;
const MANAGED_BACKUP_INITIAL_DELAY_MS = 1000;

function uploadToManagedCloudIfEnabled(buffer, key) {
  if (!buffer || !Buffer.isBuffer(buffer) || !key) return;
  if (!_cloudBackupEnabled) return;

  function doUpload(creds, attempt) {
    return import('@aws-sdk/client-s3').then(({ S3Client, PutObjectCommand }) => {
      const client = new S3Client({
        region: creds.region,
        credentials: {
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          sessionToken: creds.sessionToken,
        },
      });
      const s3Key = `${creds.prefix}/${key}`;
      // Do NOT use ObjectLockMode/ObjectLockRetainUntilDate unless bucket has Object Lock enabled
      return client.send(new PutObjectCommand({
        Bucket: creds.bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: 'application/octet-stream',
      }));
    });
  }

  function retryWithBackoff(creds, attempt) {
    return doUpload(creds, attempt).catch(err => {
      const mapped = mapBackupError(err);
      console.error('[Backup] Managed cloud upload attempt', attempt, mapped.code, mapped.correlationId, err && err.message);
      if (attempt < MANAGED_BACKUP_MAX_RETRIES) {
        const delay = MANAGED_BACKUP_INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
        return new Promise((resolve) => setTimeout(resolve, delay)).then(() => retryWithBackoff(creds, attempt + 1));
      }
      _lastManagedCloudError = mapped.message + ' (Ref: ' + mapped.correlationId + ')';
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('cloud-backup-status-changed', {
          enabled: _cloudBackupEnabled,
          lastError: _lastManagedCloudError,
          correlationId: mapped.correlationId,
        });
      }
      throw err;
    });
  }

  fetchManagedCloudCredentials().then(creds => {
    if (!creds) {
      _lastManagedCloudError = 'Backup failed: configuration missing. Check your licence.';
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('cloud-backup-status-changed', { enabled: false, lastError: _lastManagedCloudError });
      }
      return;
    }
    return retryWithBackoff(creds, 1);
  }).then(() => {
    _lastManagedCloudSuccess = Date.now();
    _lastManagedCloudError = null;
    console.log('[Backup] Managed cloud upload succeeded:', key);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cloud-backup-status-changed', { enabled: true, lastSuccess: _lastManagedCloudSuccess });
  }).catch(() => {});
}

/* ═══════════════════════════════════════════════
   CROSS-DEVICE SYNC ENGINE
   Pushes local changes to and pulls remote changes
   from a central DynamoDB store via the website API.
   ═══════════════════════════════════════════════ */
const SYNC_ATTEMPTS_KEEP = 100;

function generateCorrelationId() {
  const hex = crypto.randomBytes(8).toString('hex');
  return 'sync-' + hex;
}

function logSyncAttempt(correlationId, direction, recordCount, success, errorMessage) {
  if (!db) return;
  try {
    dbRun(
      'INSERT INTO sync_attempts (correlation_id, direction, record_count, success, error_message) VALUES (?,?,?,?,?)',
      [correlationId || null, direction, recordCount || 0, success ? 1 : 0, errorMessage || null]
    );
    const row = dbGet('SELECT COUNT(*) as c FROM sync_attempts');
    if (row && row.c > SYNC_ATTEMPTS_KEEP) {
      dbRun('DELETE FROM sync_attempts WHERE id IN (SELECT id FROM sync_attempts ORDER BY id ASC LIMIT ?)', [row.c - SYNC_ATTEMPTS_KEEP]);
    }
  } catch (e) {
    console.warn('[Sync] Failed to write sync_attempts:', e && e.message ? e.message : e);
  }
}

function generateSyncId() {
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function backfillSyncIds() {
  if (!db) return;
  try {
    const rows = dbAll("SELECT id FROM attendances WHERE sync_id IS NULL OR sync_id = ''");
    if (rows.length === 0) return;
    try { db.run('BEGIN TRANSACTION'); } catch (_) {}
    for (const row of rows) {
      dbRun('UPDATE attendances SET sync_id=?, sync_dirty=1 WHERE id=?', [generateSyncId(), row.id]);
    }
    try { db.run('COMMIT'); } catch (_) {}
    console.log('[Sync] Backfilled sync_id for', rows.length, 'records');
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (_) {}
    console.warn('[Sync] Backfill sync_id failed:', e && e.message ? e.message : e);
  }
}

/** Migrate sync_dirty records into sync_queue for offline-first processing. */
function migrateSyncDirtyToQueue() {
  if (!db) return;
  try {
    const hasTable = dbGet("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_queue'");
    if (!hasTable) return;
    const rows = dbAll('SELECT id FROM attendances WHERE sync_dirty=1');
    if (!rows || rows.length === 0) return;
    const now = Date.now();
    try { db.run('BEGIN TRANSACTION'); } catch (_) {}
    for (const row of rows) {
      const qid = 'sq-' + crypto.randomBytes(12).toString('hex');
      const rid = String(row.id);
      dbRun('DELETE FROM sync_queue WHERE record_id=?', [rid]);
      dbRun(
        'INSERT OR IGNORE INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status) VALUES (?,?,?,?,?,0,?,?)',
        [qid, rid, 'upsert', '{}', now, now, 'pending']
      );
    }
    try { db.run('COMMIT'); } catch (_) {}
    console.log('[Sync] Migrated', rows.length, 'dirty records to sync_queue');
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (_) {}
    console.warn('[Sync] migrateSyncDirtyToQueue failed:', e && e.message ? e.message : e);
  }
}

function getSyncApiUrl() {
  const base = getManagedCloudApiUrl();
  return base || null;
}

function getLastSyncTimestamp() {
  if (!db) return '1970-01-01T00:00:00.000Z';
  const row = dbGet("SELECT value FROM settings WHERE key = 'lastSyncPullAt'");
  return (row && row.value) || '1970-01-01T00:00:00.000Z';
}

function setLastSyncTimestamp(ts) {
  if (!db) return;
  dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastSyncPullAt', ?)", [ts]);
}

async function syncPull(opts) {
  const apiUrl = getSyncApiUrl();
  if (!apiUrl) return { pulled: 0 };

  const data = readLicenceData();
  if (!data || !data.key) return { pulled: 0 };

  const since = getLastSyncTimestamp();
  const syncOpts = { timeout: 30000 };
  if (opts && opts.correlationId) syncOpts.headers = { 'X-Correlation-Id': opts.correlationId };
  const resp = await httpPost(`${apiUrl}/api/sync/pull`, {
    key: data.key,
    machineId: getMachineId(),
    since,
  }, syncOpts);

  if (!resp || !resp.ok) {
    throw new Error(resp && resp.error ? resp.error : 'Pull failed');
  }

  const remoteRecords = resp.records || [];
  let merged = 0;

  for (const remote of remoteRecords) {
    const local = dbGet('SELECT id, sync_version, updated_at, sync_dirty FROM attendances WHERE sync_id=?', [remote.syncId]);

    if (!local) {
      dbRun(
        `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, deleted_at, deletion_reason,
         client_name, station_name, dscc_ref, attendance_date,
         supervisor_approved_at, supervisor_note, archived_at, sync_dirty, sync_version)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
        [remote.syncId, remote.data, remote.status, remote.createdAt, remote.updatedAt,
         remote.deletedAt || null, remote.deletionReason || null,
         remote.clientName || '', remote.stationName || '', remote.dsccRef || '', remote.attendanceDate || '',
         remote.supervisorApprovedAt || null, remote.supervisorNote || '', remote.archivedAt || null,
         remote.version || 1]
      );
      merged++;
      continue;
    }

    // Conflict resolution: remote wins if its version is higher or (same version but updated later).
    // If local has unsaved changes (sync_dirty=1) and remote is newer, remote still wins
    // but local changes are logged in audit_log.
    const localVersion = local.sync_version || 1;
    const remoteVersion = remote.version || 1;
    const remoteNewer = remoteVersion > localVersion ||
      (remoteVersion === localVersion && remote.updatedAt > (local.updated_at || ''));

    if (remoteNewer) {
      if (local.sync_dirty === 1) {
        const existing = dbGet('SELECT data FROM attendances WHERE id=?', [local.id]);
        db.run(
          'INSERT INTO audit_log (attendance_id, action, previous_snapshot, timestamp, user_note) VALUES (?,?,?,?,?)',
          [local.id, 'sync_overwritten', existing ? existing.data : null, new Date().toISOString(), 'Local changes overwritten by newer remote version']
        );
      }
      dbRun(
        `UPDATE attendances SET data=?, status=?, updated_at=?, deleted_at=?, deletion_reason=?,
         client_name=?, station_name=?, dscc_ref=?, attendance_date=?,
         supervisor_approved_at=?, supervisor_note=?, archived_at=?, sync_dirty=0, sync_version=?
         WHERE id=?`,
        [remote.data, remote.status, remote.updatedAt,
         remote.deletedAt || null, remote.deletionReason || null,
         remote.clientName || '', remote.stationName || '', remote.dsccRef || '', remote.attendanceDate || '',
         remote.supervisorApprovedAt || null, remote.supervisorNote || '', remote.archivedAt || null,
         remoteVersion, local.id]
      );
      merged++;
    }
  }

  if (resp.serverTime) {
    setLastSyncTimestamp(resp.serverTime);
  }

  if (merged > 0) {
    saveDb();
  }
  return { pulled: merged };
}

let _syncWorker = null;

function getSyncWorker() {
  if (!_syncWorker && db) {
    _syncWorker = createSyncWorker({
      db,
      dbRun,
      dbGet: (sql, params) => dbGet(sql, params ?? []),
      dbAll: (sql, params) => dbAll(sql, params ?? []),
      flushDb,
      getSyncApiUrl,
      readLicenceData,
      getMachineId,
      httpPost: (url, body, opts) => httpPost(url, body, { ...opts, timeout: opts && opts.timeout || 8000 }),
      httpGetWithTimeout,
      syncPull: () => syncPull({ correlationId: generateCorrelationId() }),
      onStatusChange: () => {},
      sendToRenderer: (channel, data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data); },
    });
  }
  return _syncWorker;
}

function enqueueSyncForRecord(recordId, operation = 'upsert') {
  const w = getSyncWorker();
  if (w) w.enqueue(String(recordId), operation, {});
}

function startSyncTimer() {
  const w = getSyncWorker();
  if (w) w.start();
}

function stopSyncTimer() {
  if (_syncWorker) _syncWorker.stop();
}

/**
 * Schedule sync soon — called after any record mutation.
 * Offline-first: sync runs in background; UI never waits.
 */
function scheduleSyncSoon() {
  const w = getSyncWorker();
  if (w) w.scheduleSoon();
}

function createWindow() {
  const iconPath = path.join(__dirname, 'custody-note.ico');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f172a',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: 'Custody Note',
  });
  const isCaptureMode = process.env.CAPTURE_SCREENSHOTS === '1';
  mainWindow.once('ready-to-show', () => {
    if (!isCaptureMode) {
      mainWindow.show();
      mainWindow.maximize();
    }
    setTimeout(() => {
      if (db) {
        try {
          db.run('BEGIN TRANSACTION');
          backfillAttendanceIndexColumns({ limit: 10000 });
          db.run('COMMIT');
          saveDb();
        } catch (e) {
          try { db.run('ROLLBACK'); } catch (_) {}
          console.warn('[DB] Deferred backfill failed:', e && e.message ? e.message : e);
        }
      }
    }, 5000);
  });
  mainWindow.loadFile('index.html');
  const ses = mainWindow.webContents.session;
  ses.clearCache().catch(() => {});
  ses.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }).catch(() => {});
  mainWindow.on('closed', () => { mainWindow = null; });

  if (isCaptureMode) {
    const outputDir = process.env.CAPTURE_OUTPUT_DIR || path.join(__dirname, '..', 'custody note - website production', 'public', 'screenshots');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    mainWindow.webContents.once('did-finish-load', async () => {
      const views = [
        { name: 'home', file: 'home.png' },
        { name: 'quickcapture', file: 'quickcapture.png' },
        { name: 'new', file: 'form.png' },
        { name: 'list', file: 'records.png' },
        { name: 'reports', file: 'reports.png' },
      ];
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      try {
        await delay(3500);
        await mainWindow.webContents.executeJavaScript(`
          (function(){
            var s = document.getElementById('splash');
            if (s && s.parentNode) { s.classList.add('fade-out'); setTimeout(function(){ s.remove(); }, 300); }
          })();
        `);
        await delay(500);
        for (const { name, file } of views) {
          await mainWindow.webContents.executeJavaScript(
            `if (typeof showView === 'function') showView('${name}');`
          );
          await delay(900);
          const buf = await mainWindow.webContents.capturePage();
          const outPath = path.join(outputDir, file);
          fs.writeFileSync(outPath, buf.toPNG());
          console.log('[Capture] Saved', file);
        }
        console.log('[Capture] Done. Screenshots in', outputDir);
      } catch (err) {
        console.error('[Capture] Error:', err);
      } finally {
        app.quit();
      }
    });
  }

  if (process.env.ELECTRON_RUN_AS_TEST === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      /* Collect console output from renderer */
      mainWindow.webContents.on('console-message', (_, level, message) => {
        const tag = ['V','I','W','E'][level] || '?';
        console.log(`[renderer][${tag}] ${message}`);
      });

      setTimeout(async () => {
        try {
          const result = await mainWindow.webContents.executeJavaScript(`
            (async function stressTest() {
              var results = [];
              var errors = [];

              function log(msg) { results.push(msg); console.log('[TEST] ' + msg); }
              function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

              /* 1. Basic checks — home view is now the landing view */
              if (document.getElementById('splash')) { errors.push('Splash still present'); }
              if (!document.querySelector('.app-header')) { errors.push('No .app-header found'); }
              var homeView = document.getElementById('view-home');
              if (!homeView || !homeView.classList.contains('active')) { errors.push('Home view not active at start'); }
              log('1. Splash gone, header present, home view active');

              /* 1b. Home action cards exist */
              var homeCards = ['home-card-attendance','home-card-voluntary','home-card-telephone','home-card-quick'];
              var cardMissing = homeCards.filter(function(id) { return !document.getElementById(id); });
              if (cardMissing.length) errors.push('Home missing cards: ' + cardMissing.join(', '));
              log('1b. Home action cards present');

              /* 1c. Gear menu button exists */
              var gearBtn = document.getElementById('gear-menu-btn');
              if (!gearBtn) errors.push('gear-menu-btn not found');
              else log('1c. Gear menu button present');

              /* 1d. Home greeting and datetime */
              var greetEl = document.getElementById('home-greeting');
              if (!greetEl || !greetEl.textContent) errors.push('Home greeting missing or empty');
              else log('1d. Home greeting: ' + greetEl.textContent);
              var dtEl = document.getElementById('home-datetime');
              if (!dtEl || !dtEl.textContent) errors.push('Home datetime missing or empty');
              else log('1e. Home datetime: ' + dtEl.textContent);

              /* 1f. Footer: internet status text and backup status */
              var netText = document.getElementById('net-status-text');
              var backupText = document.getElementById('backup-status-text');
              if (!netText) errors.push('Footer: net-status-text missing');
              else if (netText.textContent.indexOf('Internet') < 0) errors.push('Footer: net status text unexpected: ' + netText.textContent);
              if (!backupText) errors.push('Footer: backup-status-text missing');
              else if (backupText.textContent.indexOf('Auto backup') < 0) errors.push('Footer: backup text unexpected: ' + backupText.textContent);
              log('1f. Footer status text OK');

              /* 2. Test New Attendance from home card */
              var cardAtt = document.getElementById('home-card-attendance');
              if (!cardAtt) { errors.push('home-card-attendance not found'); }
              else {
                cardAtt.click();
                await sleep(800);
                var formView = document.getElementById('view-form');
                if (!formView || !formView.classList.contains('active')) {
                  errors.push('Home Attendance card: view-form not active');
                } else {
                  log('2. Home Attendance card works - form view active');
                  var ctxBar = document.getElementById('form-context-bar');
                  var ctxRight = ctxBar ? ctxBar.querySelector('.context-right') : null;
                  if (ctxRight && ctxRight.textContent.length > 10) {
                    log('2b. Context bar posh date: ' + ctxRight.textContent);
                  } else {
                    errors.push('Context bar: posh date not found');
                  }
                  var dtBars = document.querySelectorAll('.section-datetime');
                  if (dtBars.length > 0) errors.push('Section datetime bars still present: ' + dtBars.length);
                  else log('2c. Section datetime bars removed OK');
                  var colorDots = document.querySelectorAll('.prog-dot.complete, .prog-dot.partial');
                  if (colorDots.length > 0) errors.push('Coloured progress dots still present: ' + colorDots.length);
                  else log('2d. Progress dots: no green/orange colours');
                  var laaBtn = document.getElementById('laa-forms-btn');
                  if (!laaBtn) errors.push('LAA Forms button not in form header');
                  else log('2e. LAA Forms button present in header');
                }
              }

              /* 3. Save & exit returns to home */
              var saveExit0 = document.getElementById('form-save-exit');
              if (saveExit0) {
                saveExit0.click();
                await sleep(1000);
                if (document.getElementById('view-home')?.classList.contains('active')) {
                  log('3. Save & exit returns to home');
                } else {
                  errors.push('Save & exit did not return to home');
                }
              }

              /* 4. Gear menu: open and navigate to Records (list) */
              if (gearBtn) {
                gearBtn.click();
                await sleep(200);
                var gearDd = document.getElementById('gear-dropdown');
                if (gearDd && !gearDd.classList.contains('hidden')) {
                  log('4a. Gear dropdown opened');
                  var recordsItem = gearDd.querySelector('[data-action="records"]');
                  if (recordsItem) {
                    recordsItem.click();
                    await sleep(500);
                    if (document.getElementById('view-list')?.classList.contains('active')) {
                      log('4b. Gear > Records navigates to list');
                    } else {
                      errors.push('Gear Records: list view not active');
                    }
                  }
                } else {
                  errors.push('Gear dropdown did not open');
                }
              }

              /* 5. List back-home button */
              var listBackHome = document.getElementById('list-back-home');
              if (listBackHome) {
                listBackHome.click();
                await sleep(300);
                if (document.getElementById('view-home')?.classList.contains('active')) {
                  log('5. List back-home works');
                } else {
                  errors.push('List back-home did not return to home');
                }
              }

              /* 6. Quick Capture from home card */
              var cardQc = document.getElementById('home-card-quick');
              if (cardQc) {
                cardQc.click();
                await sleep(500);
                var qcView = document.getElementById('view-quickcapture');
                if (!qcView || !qcView.classList.contains('active')) {
                  errors.push('Quick Capture: view-quickcapture not active');
                } else {
                  log('6. Quick Capture card works');
                }
              }

              /* 7. QC Cancel returns to home */
              var qcCancel = document.getElementById('qc-cancel');
              if (qcCancel) {
                qcCancel.click();
                await sleep(300);
                if (document.getElementById('view-home')?.classList.contains('active')) {
                  log('7. QC Cancel works - back to home');
                } else {
                  errors.push('QC Cancel did not return to home');
                }
              }

              /* 8. Gear > Firms */
              if (gearBtn) {
                gearBtn.click();
                await sleep(200);
                var gearDd2 = document.getElementById('gear-dropdown');
                var firmsItem = gearDd2 ? gearDd2.querySelector('[data-action="firms"]') : null;
                if (firmsItem) {
                  firmsItem.click();
                  await sleep(500);
                  if (document.getElementById('view-firms')?.classList.contains('active')) {
                    log('8. Gear > Firms works');
                  } else {
                    errors.push('Gear Firms: view-firms not active');
                  }
                }
              }

              /* 9. Firms back button goes to home */
              var firmsBack = document.getElementById('firms-back-btn');
              if (firmsBack) {
                firmsBack.click();
                await sleep(300);
                if (document.getElementById('view-home')?.classList.contains('active')) {
                  log('9. Firms back button works - goes to home');
                } else {
                  errors.push('Firms back: view-home not active');
                }
              }

              /* 10. Gear > Reports */
              if (gearBtn) {
                gearBtn.click();
                await sleep(200);
                var gearDd3 = document.getElementById('gear-dropdown');
                var reportsItem = gearDd3 ? gearDd3.querySelector('[data-action="reports"]') : null;
                if (reportsItem) {
                  reportsItem.click();
                  await sleep(500);
                  if (document.getElementById('view-reports')?.classList.contains('active')) {
                    log('10. Gear > Reports works');
                  } else {
                    errors.push('Gear Reports: view-reports not active');
                  }
                }
              }

              /* 11. Reports back goes to home */
              var reportsBack = document.getElementById('reports-back-btn');
              if (reportsBack) {
                reportsBack.click();
                await sleep(300);
                if (document.getElementById('view-home')?.classList.contains('active')) {
                  log('11. Reports back button works - goes to home');
                } else {
                  errors.push('Reports back: view-home not active');
                }
              }

              /* 12. Gear > Settings */
              if (gearBtn) {
                gearBtn.click();
                await sleep(200);
                var gearDd4 = document.getElementById('gear-dropdown');
                var settingsItem = gearDd4 ? gearDd4.querySelector('[data-action="settings"]') : null;
                if (settingsItem) {
                  settingsItem.click();
                  await sleep(500);
                  if (document.getElementById('view-settings')?.classList.contains('active')) {
                    log('12. Gear > Settings works');
                    /* 12b. Support links: ensure details open, click support-faq-link and useful-link-btn */
                    var detailsEl = document.getElementById('support-faq-details');
                    if (detailsEl && !detailsEl.open) { detailsEl.setAttribute('open', ''); await sleep(100); }
                    var supportFaqLinks = document.querySelectorAll('.support-faq-link');
                    if (supportFaqLinks.length >= 4) {
                      supportFaqLinks[0].click();
                      await sleep(150);
                      log('12b. support-faq-link clicked (Open forum)');
                    } else {
                      errors.push('support-faq-link buttons not found or wrong count: ' + supportFaqLinks.length);
                    }
                    var usefulLinks = document.querySelectorAll('.useful-link-btn');
                    var supportLink = Array.from(usefulLinks).find(function(a){ return (a.dataset.extUrl || a.href || '').indexOf('support') >= 0; });
                    if (supportLink) {
                      supportLink.click();
                      await sleep(150);
                      log('12c. useful-link-btn Support clicked');
                    }
                  } else {
                    errors.push('Gear Settings: view-settings not active');
                  }
                }
              }

              /* 13. Settings back goes to home */
              var settingsBack = document.getElementById('settings-back-btn');
              if (settingsBack) {
                settingsBack.click();
                await sleep(300);
                if (document.getElementById('view-home')?.classList.contains('active')) {
                  log('13. Settings back button works - goes to home');
                } else {
                  errors.push('Settings back: view-home not active');
                }
              }

              /* 14. Dark mode toggle */
              var dmToggle = document.getElementById('dark-mode-toggle');
              if (dmToggle) {
                dmToggle.click();
                await sleep(200);
                var isDark = document.documentElement.classList.contains('dark');
                log('14. Dark mode toggle works (dark=' + isDark + ')');
                dmToggle.click();
                await sleep(200);
              }

              /* 15. Quick Capture: fill form, save, verify return to home */
              var cardQc2 = document.getElementById('home-card-quick');
              if (cardQc2) {
                cardQc2.click();
                await sleep(500);

                var qcNewFields = ['qc-referral-name','qc-referral-phone','qc-referral-email','qc-oic-name','qc-custody-number','qc-client-status','qc-weekend-bh','qc-notes','qc-firm-select-btn','qc-firm-add-btn','qc-firm-wrap'];
                var qcMissing = qcNewFields.filter(function(id) { return !document.getElementById(id); });
                if (qcMissing.length) errors.push('QC missing fields: ' + qcMissing.join(', '));

                var stWrap = document.getElementById('qc-station-search-wrap');
                if (!stWrap) { errors.push('QC station-search-wrap not found'); }
                else if (!stWrap.classList.contains('station-search-wrap')) { errors.push('QC station wrap missing .station-search-wrap class'); }

                var fn = document.getElementById('qc-forename');
                var sn = document.getElementById('qc-surname');
                var off = document.getElementById('qc-offence');
                if (fn) fn.value = 'Test';
                if (sn) sn.value = 'User';
                if (off) off.value = 'Theft';
                var refName = document.getElementById('qc-referral-name');
                var refPhone = document.getElementById('qc-referral-phone');
                var oic = document.getElementById('qc-oic-name');
                var custody = document.getElementById('qc-custody-number');
                var notes = document.getElementById('qc-notes');
                if (refName) refName.value = 'Jane Smith';
                if (refPhone) refPhone.value = '07700 900123';
                if (oic) oic.value = 'DC Jones';
                if (custody) custody.value = 'CU/99999';
                if (notes) notes.value = 'Test notes from stress test';

                var qcSave = document.getElementById('qc-save');
                if (qcSave) {
                  qcSave.click();
                  await sleep(1000);
                  if (document.getElementById('view-home')?.classList.contains('active')) {
                    log('15. QC save draft works (all new fields present and filled)');
                  } else {
                    errors.push('QC save: did not return to home');
                  }
                }
              }

              /* 16. Go to list via View All, test filter buttons */
              var viewAllBtn = document.getElementById('home-view-all');
              if (viewAllBtn) {
                viewAllBtn.click();
                await sleep(500);
                if (document.getElementById('view-list')?.classList.contains('active')) {
                  log('16a. View All navigates to list');
                } else {
                  errors.push('View All did not navigate to list');
                }
              }
              var filterDraft = document.querySelector('.filter-btn[data-filter="draft"]');
              if (filterDraft) {
                filterDraft.click();
                await sleep(300);
                if (filterDraft.classList.contains('active')) {
                  log('16b. Filter button works');
                } else {
                  errors.push('Filter button not active after click');
                }
              }
              var filterAll = document.querySelector('.filter-btn[data-filter="all"]');
              if (filterAll) filterAll.click();
              await sleep(300);

              /* 17. New Attendance from home card: open and fill minimal data */
              var listBack = document.getElementById('list-back-home');
              if (listBack) { listBack.click(); await sleep(300); }
              var cardAtt2 = document.getElementById('home-card-attendance');
              if (cardAtt2) {
                cardAtt2.click();
                await sleep(800);
                var formSurname = document.querySelector('[data-field="surname"]');
                var formForename = document.querySelector('[data-field="forename"]');
                var formDate = document.querySelector('[data-field="date"]');
                var instrDt = document.querySelector('[data-field="instructionDateTime"]');
                if (formSurname) { formSurname.value = 'StressTest'; formSurname.dispatchEvent(new Event('input', { bubbles: true })); }
                if (formForename) { formForename.value = 'Bot'; formForename.dispatchEvent(new Event('input', { bubbles: true })); }
                if (formDate) { formDate.value = new Date().toISOString().slice(0, 10); formDate.dispatchEvent(new Event('input', { bubbles: true })); }
                if (instrDt) { instrDt.value = new Date().toISOString().slice(0, 16); instrDt.dispatchEvent(new Event('input', { bubbles: true })); }
                log('17. New Attendance opened, minimal data filled');
              }

              /* 18. Section navigation */
              var formNext = document.getElementById('form-next');
              var form = document.getElementById('attendance-form');
              if (formNext && form) {
                for (var n = 0; n < 4; n++) {
                  formNext.click();
                  await sleep(400);
                }
                var titleEl = document.getElementById('form-page-title');
                var title = titleEl ? titleEl.textContent : '';
                if (title.indexOf('Disclosure') >= 0) {
                  log('18. Section navigation works - reached Disclosure');
                } else {
                  errors.push('Section nav: expected Disclosure, got: ' + title);
                }
              }

              /* 19. Save & exit returns to home */
              var saveExit = document.getElementById('form-save-exit');
              if (saveExit) {
                saveExit.click();
                await sleep(1000);
                if (document.getElementById('view-home')?.classList.contains('active')) {
                  log('19. New Attendance save & exit works');
                } else {
                  errors.push('New Attendance: did not return to home after save');
                }
              } else {
                errors.push('form-save-exit button not found');
              }

              /* 20. Telephone Advice Call from home card */
              var cardTel = document.getElementById('home-card-telephone');
              if (cardTel) {
                cardTel.click();
                await sleep(800);
                if (document.getElementById('view-form')?.classList.contains('active')) {
                  log('20. Telephone Advice Call opens form view');
                  var telSections = document.querySelectorAll('.form-section');
                  if (telSections.length === 4) {
                    log('20b. Telephone form has 4 sections (INVB)');
                  } else {
                    errors.push('Telephone form: expected 4 sections, got ' + telSections.length);
                  }
                  var dsccField = document.querySelector('[data-field="dsccRef"]');
                  if (dsccField) {
                    log('20c. DSCC field present in telephone form');
                  } else {
                    errors.push('Telephone form: DSCC field missing');
                  }
                  var telAdviceField = document.querySelector('[data-field="telephoneAdviceSummary"]');
                  if (telAdviceField) {
                    log('20d. Telephone advice summary field present');
                  } else {
                    errors.push('Telephone form: telephoneAdviceSummary field missing');
                  }
                  var firstTitle = document.getElementById('form-page-title');
                  if (firstTitle && firstTitle.textContent.includes('Call Details')) {
                    log('20e. First section title correct: ' + firstTitle.textContent);
                  } else {
                    errors.push('Telephone form: first section title unexpected: ' + (firstTitle ? firstTitle.textContent : 'missing'));
                  }
                  var progDots = document.querySelectorAll('.prog-dot');
                  if (progDots.length === 4) {
                    log('20f. Progress bar shows 4 dots');
                  } else {
                    errors.push('Telephone form: expected 4 progress dots, got ' + progDots.length);
                  }
                } else {
                  errors.push('Telephone Advice: form view not active');
                }
              }

              /* 21. Navigate back, test LAA forms via gear menu */
              var saveExit2 = document.getElementById('form-save-exit');
              if (saveExit2) { saveExit2.click(); await sleep(800); }
              if (gearBtn) {
                gearBtn.click();
                await sleep(200);
                var gearDd5 = document.getElementById('gear-dropdown');
                var laaItem = gearDd5 ? gearDd5.querySelector('[data-action="laa-forms"]') : null;
                if (laaItem) {
                  laaItem.click();
                  await sleep(500);
                  var laaNavPopup = document.getElementById('laa-nav-popup');
                  if (laaNavPopup) {
                    log('21. LAA Forms popup opened via gear menu');
                    var crm1Li = laaNavPopup.querySelector('[data-form="crm1"]');
                    if (crm1Li) {
                      log('21b. CRM1 option present in LAA popup');
                    }
                    var declLi = laaNavPopup.querySelector('[data-form="declaration"]');
                    if (declLi) {
                      log('21c. Applicant Declaration option present in LAA popup');
                    }
                    var closeLaaNav = document.getElementById('laa-nav-popup-close');
                    if (closeLaaNav) { closeLaaNav.click(); await sleep(300); }
                  } else {
                    errors.push('LAA Forms popup not found');
                  }
                }
              }

              /* 22. Test LAA Forms popup from within attendance form */
              var cardAtt3 = document.getElementById('home-card-attendance');
              if (cardAtt3) {
                cardAtt3.click();
                await sleep(800);
                var laaFormsBtn = document.getElementById('laa-forms-btn');
                if (laaFormsBtn) {
                  laaFormsBtn.click();
                  await sleep(500);
                  var laaPopup = document.getElementById('laa-forms-popup');
                  if (laaPopup) {
                    log('22. LAA Forms popup opened from attendance form');
                    var crm2Btn = laaPopup.querySelector('[data-form="crm2"]');
                    if (crm2Btn) {
                      log('22b. CRM2 option present in form LAA popup');
                    }
                    var declBtn2 = laaPopup.querySelector('[data-form="declaration"]');
                    if (declBtn2) {
                      log('22c. Applicant Declaration option present in form LAA popup');
                    }
                    var closeLaaPopup = document.getElementById('laa-popup-close');
                    if (closeLaaPopup) { closeLaaPopup.click(); await sleep(300); }
                  } else {
                    errors.push('LAA Forms popup not found');
                  }
                }
                var saveExit3 = document.getElementById('form-save-exit');
                if (saveExit3) { saveExit3.click(); await sleep(800); }
              }

              /* 23. Verify official PDF API is available */
              if (window.api && typeof window.api.laaGenerateOfficialPdf === 'function') {
                log('23a. laaGenerateOfficialPdf API available');
              } else {
                errors.push('laaGenerateOfficialPdf API not available');
              }
              if (window.api && typeof window.api.laaOpenOfficialTemplate === 'function') {
                log('23b. laaOpenOfficialTemplate API available');
              } else {
                errors.push('laaOpenOfficialTemplate API not available');
              }

              /* 24. Splash screen CSS check (animations defined) */
              var sheets = document.styleSheets;
              var hasSplashDraw = false;
              try {
                for (var si = 0; si < sheets.length; si++) {
                  try {
                    var rules = sheets[si].cssRules;
                    for (var ri = 0; ri < rules.length; ri++) {
                      if (rules[ri].name === 'splash-draw') hasSplashDraw = true;
                    }
                  } catch(e) {}
                }
              } catch(e) {}
              if (hasSplashDraw) log('24. Splash animation keyframes present');
              else errors.push('Splash animation keyframes (splash-draw) not found');

              /* 25. Official LAA PDF APIs present */
              if (window.api && typeof window.api.laaGenerateOfficialPdf === 'function' && typeof window.api.laaOpenOfficialTemplate === 'function') {
                log('25. Official LAA PDF APIs available (laaGenerateOfficialPdf, laaOpenOfficialTemplate)');
              } else {
                errors.push('Official LAA PDF APIs not available');
              }
              if (window.api && typeof window.api.printPdfFile === 'function') {
                log('25b. printPdfFile API available');
              } else {
                errors.push('printPdfFile API not available');
              }

              /* 26. Global search bar exists */
              var globalSearch = document.getElementById('global-search');
              if (!globalSearch) errors.push('Global search bar missing');
              else log('26. Global search bar present');

              /* Summary */
              log('--- RESULTS ---');
              log('Passed: ' + results.length + ' checks');
              if (errors.length) {
                log('ERRORS (' + errors.length + '):');
                errors.forEach(function(e) { log('  FAIL: ' + e); });
              } else {
                log('ALL TESTS PASSED');
              }
              return { passed: errors.length === 0, results: results, errors: errors };
            })()
          `);

          console.log('\\n=== STRESS TEST RESULTS ===');
          if (result.errors && result.errors.length) {
            result.errors.forEach(e => console.log('  FAIL:', e));
            console.log('FAILED:', result.errors.length, 'error(s)');
          } else {
            console.log('ALL TESTS PASSED');
          }
          mainWindow.close();
          app.exit(result.passed ? 0 : 1);
        } catch (err) {
          console.error('Test execution error:', err);
          mainWindow.close();
          app.exit(1);
        }
      }, 8000);
    });
  }
}

/* ─── Bank holiday auto-update ─── */
async function fetchAndCacheBankHolidays() {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: 'www.gov.uk', path: '/bank-holidays.json', method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': `CustodyNote/${app.getVersion()}` } },
      (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            const events = (json['england-and-wales'] || {}).events || [];
            const dates = events.map(e => e.date).filter(Boolean);
            if (dates.length > 0 && db) {
              db.run("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)",
                ['bankHolidays', JSON.stringify(dates)]);
              saveDb();
              console.log('[BankHolidays] Cached', dates.length, 'dates');
            }
            resolve(dates);
          } catch (e) { console.warn('[BankHolidays] Parse error:', e.message); resolve(null); }
        });
      }
    );
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.on('error', e => { console.warn('[BankHolidays] Fetch failed:', e.message); resolve(null); });
    req.end();
  });
}

ipcMain.handle('get-app-version', () => {
  try {
    const version = app.getVersion();
    let lastUpdated = '';
    try { lastUpdated = require('./package.json').lastUpdated || ''; } catch (_) {}
    if (!lastUpdated) {
      const pkgPath = path.join(__dirname, 'package.json');
      const stat = fs.statSync(pkgPath);
      lastUpdated = new Date(stat.mtimeMs).toISOString().slice(0, 10);
    }
    return { version: version || '0.0.0', lastUpdated };
  } catch (_) { return { version: '0.0.0', lastUpdated: '' }; }
});

ipcMain.handle('app-update-install', () => {
  autoUpdater.quitAndInstall(true, true);
});

ipcMain.handle('get-bank-holidays', () => {
  try {
    const row = dbGet("SELECT value FROM settings WHERE key='bankHolidays'");
    return row ? JSON.parse(row.value) : null;
  } catch (_) { return null; }
});

/* ═══════════════════════════════════════════════
   LICENCE / SUBSCRIPTION SYSTEM
   ═══════════════════════════════════════════════ */
const LICENCE_FILE = 'licence.dat';
const LICENCE_GRACE_DAYS = 7;
const LICENCE_REVALIDATE_HOURS = 24;
const TRIAL_DAYS = 30;

function getLicencePath() {
  return path.join(app.getPath('userData'), LICENCE_FILE);
}

function getMachineId() {
  const os = require('os');
  const raw = [os.hostname(), os.platform(), os.arch(), (os.cpus()[0] || {}).model || '', os.totalmem()].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function readLicenceData() {
  const lpath = getLicencePath();
  if (!fs.existsSync(lpath)) return null;
  try {
    const raw = fs.readFileSync(lpath);
    if (safeStorage.isEncryptionAvailable()) {
      const json = safeStorage.decryptString(raw);
      return JSON.parse(json);
    }
    return JSON.parse(raw.toString('utf8'));
  } catch (e) {
    console.warn('[Licence] Failed to read licence data:', e.message);
    return null;
  }
}

function writeLicenceData(data) {
  const lpath = getLicencePath();
  const json = JSON.stringify(data);
  try {
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(lpath, safeStorage.encryptString(json));
    } else {
      fs.writeFileSync(lpath, json, 'utf8');
    }
  } catch (e) {
    console.error('[Licence] Failed to write licence data:', e.message);
  }
}

function deleteLicenceData() {
  const lpath = getLicencePath();
  try { if (fs.existsSync(lpath)) fs.unlinkSync(lpath); } catch (_) {}
}

const MAX_LICENCE_KEY_LENGTH = 64;

function validateLicenceKeyFormat(key) {
  if (!key || typeof key !== 'string') return false;
  const k = key.trim();
  if (k.length > MAX_LICENCE_KEY_LENGTH) return false;
  const upper = k.toUpperCase();
  return /^[A-Z0-9]{4,8}(-[A-Z0-9]{4,8}){2,7}$/.test(upper) || k.length >= 16;
}

function getLicenceValidationUrl() {
  try {
    const cfgPath = path.join(app.getPath('userData'), 'licence-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.validationUrl && isAllowedApiUrl(cfg.validationUrl)) return cfg.validationUrl;
    }
  } catch (_) {}
  // Default: use same base as cloud backup so app and website interface out of the box
  const base = getManagedCloudApiUrl();
  return base ? base + '/api/licence/validate' : null;
}

function httpGetWithTimeout(url, timeoutMs) {
  const ceiling = (timeoutMs || 8000) + 2000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };
    const hardTimer = setTimeout(() => {
      if (req) req.destroy();
      const err = new Error('Hard timeout');
      err.code = 'ETIMEDOUT';
      done(reject, err);
    }, ceiling);
    let req;
    try {
      const parsed = new URL(url);
      if (!isAllowedApiUrl(url)) { clearTimeout(hardTimer); return done(reject, new Error('URL not allowed')); }
      const mod = parsed.protocol === 'https:' ? https : http;
      req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        timeout: timeoutMs || 8000,
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => { clearTimeout(hardTimer); done(resolve, { statusCode: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data }); });
      });
      req.on('error', (e) => { clearTimeout(hardTimer); const err = e instanceof Error ? e : new Error(String(e)); if (e && e.code) err.code = e.code; done(reject, err); });
      req.on('timeout', () => { req.destroy(); clearTimeout(hardTimer); const err = new Error('Timeout'); err.code = 'ETIMEDOUT'; done(reject, err); });
      req.end();
    } catch (e) {
      clearTimeout(hardTimer);
      done(reject, e);
    }
  });
}

function httpPost(url, body, opts) {
  const timeoutMs = (opts && opts.timeout) || 15000;
  const maxRedirects = (opts && opts._redirectCount) || 0;
  const extraHeaders = (opts && opts.headers) || {};
  const ceiling = timeoutMs + 2000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; clearTimeout(hardTimer); fn(val); } };
    const hardTimer = setTimeout(() => {
      if (req) req.destroy();
      const err = new Error('Hard timeout');
      err.code = 'ETIMEDOUT';
      done(reject, err);
    }, ceiling);
    let parsed, req;
    try {
      parsed = new URL(url);
      if (!isAllowedApiUrl(url)) return done(reject, new Error('API URL not allowed'));
    } catch (e) {
      return done(reject, new Error('Invalid URL'));
    }
    const mod = parsed.protocol === 'https:' ? https : http;
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...extraHeaders };
    req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers,
      timeout: timeoutMs,
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (maxRedirects >= 3) return done(reject, new Error('Too many redirects'));
        res.resume();
        done(resolve, httpPost(res.headers.location, body, { timeout: timeoutMs, _redirectCount: maxRedirects + 1, headers: extraHeaders }));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          let errMsg = 'Server error ' + res.statusCode;
          try { const j = JSON.parse(data); if (j.error) errMsg = j.error; } catch (_) {}
          const err = new Error(errMsg);
          err.statusCode = res.statusCode;
          return done(reject, err);
        }
        try { done(resolve, JSON.parse(data)); } catch (_) { done(reject, new Error('Invalid response from server')); }
      });
    });
    req.on('error', (e) => {
      const err = e instanceof Error ? e : new Error(String(e));
      if (e && e.code) err.code = e.code;
      done(reject, err);
    });
    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Timeout');
      err.code = 'ETIMEDOUT';
      done(reject, err);
    });
    req.write(payload);
    req.end();
  });
}

async function validateLicenceOnline(key, machineId) {
  const url = getLicenceValidationUrl();
  if (!url) return { valid: true, offline: true };
  try {
    const resp = await httpPost(url, { key, machineId, appVersion: app.getVersion() || '0.0.0' });
    return {
      valid: !!resp.valid,
      expiresAt: resp.expiresAt || null,
      email: resp.email || '',
      message: resp.message || '',
      isTrial: !!resp.isTrial,
      offline: false,
      serverStatus: resp.status || null,
    };
  } catch (e) {
    return { valid: null, offline: true, message: 'Could not reach validation server: ' + e.message, serverStatus: null };
  }
}

function computeLicenceStatus(data) {
  if (!data || !data.key) return { status: 'none', message: 'No licence activated' };
  if (data.status === 'revoked' || data.status === 'invalid') {
    return { status: 'revoked', message: 'Licence has been revoked. Please enter a new licence key or contact support.', key: data.key, email: data.email };
  }
  const now = Date.now();
  if (data.expiresAt) {
    const expiryMs = new Date(data.expiresAt).getTime();
    const daysRemaining = Math.ceil((expiryMs - now) / (24 * 60 * 60 * 1000));
    if (expiryMs < now) {
      return { status: 'expired', message: 'Your subscription expired on ' + new Date(data.expiresAt).toLocaleDateString('en-GB') + '. Please renew to continue using Custody Note.', key: data.key, email: data.email, daysRemaining: 0, isTrial: !!data.isTrial, trialDays: TRIAL_DAYS };
    }
    if (daysRemaining <= 7) {
      return { status: 'expiring_soon', message: 'Your ' + (data.isTrial ? 'trial' : 'subscription') + ' expires in ' + daysRemaining + ' day' + (daysRemaining !== 1 ? 's' : '') + '. Please renew to avoid interruption.', key: data.key, email: data.email || '', expiresAt: data.expiresAt, activatedAt: data.activatedAt, lastValidated: data.lastValidated, daysRemaining: daysRemaining, isTrial: !!data.isTrial, trialDays: TRIAL_DAYS };
    }
  }
  if (data.lastValidated) {
    const sinceLast = now - new Date(data.lastValidated).getTime();
    const graceMs = LICENCE_GRACE_DAYS * 24 * 60 * 60 * 1000;
    if (sinceLast > graceMs) {
      return { status: 'grace_expired', message: 'Licence could not be verified for ' + LICENCE_GRACE_DAYS + ' days. Please connect to the internet.', key: data.key, email: data.email };
    }
  }
  const result = { status: 'active', key: data.key, email: data.email || '', expiresAt: data.expiresAt || null, activatedAt: data.activatedAt, lastValidated: data.lastValidated, isTrial: !!data.isTrial, trialDays: data.isTrial ? TRIAL_DAYS : undefined };
  if (data.expiresAt) {
    result.daysRemaining = Math.ceil((new Date(data.expiresAt).getTime() - now) / (24 * 60 * 60 * 1000));
  }
  return result;
}

ipcMain.handle('licence:status', () => {
  const enforced = !!getLicenceValidationUrl();
  let data = readLicenceData();
  if (!data || !data.key) {
    const now = new Date();
    const expires = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    data = {
      key: 'TRIAL-' + getMachineId().slice(0, 16).toUpperCase(),
      email: '',
      activatedAt: now.toISOString(),
      lastValidated: now.toISOString(),
      expiresAt: expires.toISOString(),
      machineId: getMachineId(),
      status: 'active',
      isTrial: true,
    };
    writeLicenceData(data);
  }
  const result = computeLicenceStatus(data);
  result.enforced = enforced;
  return result;
});

ipcMain.handle('licence:activate', async (_, { key, email }) => {
  if (!validateLicenceKeyFormat(key)) return { success: false, message: 'Invalid licence key format' };
  const machineId = getMachineId();
  const result = await validateLicenceOnline(key.trim(), machineId);
  if (result.valid === false) return { success: false, message: result.message || 'Licence key is not valid' };
  const now = new Date().toISOString();
  const data = {
    key: key.trim(),
    email: result.email || email || '',
    activatedAt: now,
    lastValidated: now,
    expiresAt: result.expiresAt || null,
    machineId,
    status: 'active',
    isTrial: result.isTrial === true,
  };
  writeLicenceData(data);
  checkCloudBackupEntitlement().catch(() => {});
  return { success: true, status: computeLicenceStatus(data) };
});

ipcMain.handle('licence:validate', async () => {
  const data = readLicenceData();
  if (!data || !data.key) return { valid: false, status: { status: 'none' } };
  const machineId = getMachineId();
  const result = await validateLicenceOnline(data.key, machineId);
  if (result.valid === true) {
    data.lastValidated = new Date().toISOString();
    if (result.expiresAt) data.expiresAt = result.expiresAt;
    if (result.email) data.email = result.email;
    if (result.isTrial !== undefined) data.isTrial = !!result.isTrial;
    if (result.serverStatus) data.status = result.serverStatus;
    writeLicenceData(data);
  } else if (result.valid === false) {
    const serverStatus = result.serverStatus || 'revoked';
    if (serverStatus === 'expired') data.expiresAt = result.expiresAt || data.expiresAt;
    data.status = serverStatus;
    writeLicenceData(data);
    return { valid: false, status: { status: serverStatus, message: result.message || 'Licence is not valid' } };
  }
  return { valid: result.valid !== false, status: computeLicenceStatus(data) };
});

ipcMain.handle('licence:deactivate', () => {
  deleteLicenceData();
  return { success: true };
});

ipcMain.handle('licence:email-key', async () => {
  const data = readLicenceData();
  if (!data || !data.key) return { ok: false, error: 'No licence key' };
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) return { ok: false, error: 'Cannot reach licence server' };
  try {
    const resp = await httpPost(`${apiUrl}/api/licence/email-key`, { key: data.key });
    if (resp.error) return { ok: false, error: resp.error };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Failed to send email' };
  }
});

ipcMain.handle('licence:deactivate-machine', async () => {
  const data = readLicenceData();
  if (!data || !data.key) return { ok: false, error: 'No licence key' };
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) return { ok: false, error: 'Cannot reach licence server' };
  const machineId = getMachineId();
  try {
    const resp = await httpPost(`${apiUrl}/api/licence/deactivate-machine`, { key: data.key, machineId });
    if (resp.error) return { ok: false, error: resp.error };
    deleteLicenceData();
    return { ok: true, message: resp.message };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Failed to deactivate' };
  }
});

/* ═══════════════════════════════════════════════
   Global error boundaries — restart sync timer if it dies silently.
   ROOT CAUSE: Unhandled rejections in async flows could kill the sync
   interval without any visible error. These handlers log the error
   and restart the sync worker to maintain reliability.
   ═══════════════════════════════════════════════ */
process.on('unhandledRejection', (reason) => {
  console.error('[Global] Unhandled rejection:', reason);
  try { startSyncTimer(); } catch (_) {}
});
process.on('uncaughtException', (err) => {
  console.error('[Global] Uncaught exception:', err);
  try { startSyncTimer(); } catch (_) {}
});

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.policestationagent.custodynote');
  }
  Menu.setApplicationMenu(null);

  function getCliArgValue(name) {
    const idx = process.argv.indexOf(name);
    if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
    const prefix = name + '=';
    const found = process.argv.find(a => typeof a === 'string' && a.startsWith(prefix));
    return found ? found.slice(prefix.length) : null;
  }

  const cliImportPath = getCliArgValue('--import-record');
  const cliListRecords = process.argv.includes('--list-records');
  const cliDumpIdRaw = getCliArgValue('--dump-record');
  const cliDumpId = cliDumpIdRaw ? (parseInt(cliDumpIdRaw, 10) || null) : null;

  // Normal app mode: create the window. CLI modes: no UI. Trial init: no window.
  const trialInitOnly = process.env.TRIAL_INIT_ONLY === '1';
  if (!trialInitOnly && !cliImportPath && !cliListRecords && !cliDumpId) {
    createWindow();
  }

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[Encryption] safeStorage not available on this system. Database will not be encrypted automatically. Set a recovery password in Settings for protection.');
  }

  /* ─── Silent auto-update from GitHub Releases ─── */
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };

    autoUpdater.on('update-available', (info) => {
      console.log('[AutoUpdate] Update available:', info.version);
      if (mainWindow) mainWindow.webContents.send('app-update-status', { status: 'downloading', version: info.version });
    });
    autoUpdater.on('update-downloaded', (info) => {
      console.log('[AutoUpdate] Update downloaded:', info.version, '— will install on next restart');
      if (mainWindow) mainWindow.webContents.send('app-update-status', { status: 'ready', version: info.version });
    });
    autoUpdater.on('update-not-available', () => {
      console.log('[AutoUpdate] No update available');
      if (mainWindow) mainWindow.webContents.send('app-update-status', { status: 'up-to-date' });
    });
    autoUpdater.on('error', (err) => {
      console.warn('[AutoUpdate] Error:', err?.message || err);
      if (mainWindow) mainWindow.webContents.send('app-update-status', { status: 'error', message: err?.message || 'Update check failed' });
    });

    ipcMain.handle('app-check-updates', async () => {
      try {
        const result = await autoUpdater.checkForUpdates();
        if (result?.updateInfo && result.updateInfo.version !== app.getVersion()) {
          return { status: 'available', version: result.updateInfo.version };
        }
        return { status: 'up-to-date' };
      } catch (e) {
        return { status: 'error', message: e?.message || 'Update check failed' };
      }
    });

    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  } else {
    ipcMain.handle('app-check-updates', async () => ({ status: 'dev', message: 'Updates only apply to the installed app' }));
  }

  await initDb();

  /* ─── Licence store (admin DB) init ─── */
  try {
    const licenceStoreKey = require('./main/licenceStoreKey').getLicenceStoreKey(app, safeStorage);
    await require('./main/licenceStore').initStore(app.getPath('userData'), licenceStoreKey);
    require('./main/licenceIpc').registerLicenceIpc(app);
  } catch (e) {
    console.warn('[LicenceStore] Init failed:', e.message);
  }

  if (trialInitOnly) {
    app.quit();
    return;
  }

  // Auto-import watcher: periodically scan configured folder for new PDF/JSON files.
  let _autoImportTimer = null;
  let _autoImportBusy = false;
  function getSettingValue(key) {
    try {
      const row = dbGet("SELECT value FROM settings WHERE key = ?", [key]);
      return row && row.value != null ? String(row.value) : '';
    } catch (_) { return ''; }
  }
  function setSettingValue(key, val) {
    try { dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, val == null ? '' : String(val)]); } catch (_) {}
  }
  function startAutoImportIfEnabled() {
    if (_autoImportTimer) { clearInterval(_autoImportTimer); _autoImportTimer = null; }
    const enabled = getSettingValue('autoImportEnabled') === 'true';
    const folder = getSettingValue('autoImportFolder');
    if (!enabled || !folder || !fs.existsSync(folder)) return;

    const intervalMs = 15000;
    _autoImportTimer = setInterval(async () => {
      if (_autoImportBusy) return;
      _autoImportBusy = true;
      try {
        const lastMs = parseInt(getSettingValue('autoImportLastMtimeMs') || '0', 10) || 0;
        const entries = fs.readdirSync(folder)
          .filter((name) => /\.(pdf|json)$/i.test(name))
          .map((name) => {
            const full = path.join(folder, name);
            let st;
            try { st = fs.statSync(full); } catch (_) { return null; }
            return { name, full, mtimeMs: st.mtimeMs || 0, size: st.size || 0 };
          })
          .filter(Boolean)
          .sort((a, b) => b.mtimeMs - a.mtimeMs);

        for (const f of entries) {
          if (!f || !f.full) continue;
          if (f.mtimeMs <= lastMs) break;
          // Skip files still being written (tiny or very recent).
          if (f.size < 50) continue;
          const ageMs = Date.now() - f.mtimeMs;
          if (ageMs < 1500) continue;

          try {
            const data = await loadRecordDataFromFile(f.full);
            if (data && typeof data === 'object') {
              delete data.id; delete data.created_at; delete data.updated_at;
            }
            const savedId = insertImportedDraftAttendance(data);
            setSettingValue('autoImportLastMtimeMs', String(f.mtimeMs));
            setSettingValue('autoImportLastFile', f.name);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('auto-import:imported', { file: f.name, path: f.full, id: savedId });
            }
            break; // import newest only per tick to avoid UI spam
          } catch (e) {
            // Don't advance the cursor on failure, so it can retry later.
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('auto-import:error', { file: f.name, path: f.full, error: e && e.message ? e.message : String(e) });
            }
            break;
          }
        }
      } catch (_) {
        // ignore timer errors
      } finally {
        _autoImportBusy = false;
      }
    }, intervalMs);
  }

  // CLI: list records (for debugging / admin)
  if (cliListRecords) {
    try {
      const rows = dbAll(
        "SELECT id, updated_at, client_name, station_name, dscc_ref, attendance_date, status FROM attendances WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50"
      );
      console.log(JSON.stringify({ total: rows.length, rows }, null, 2));
      app.exit(0);
      return;
    } catch (e) {
      console.error('Failed to list records:', e && e.message ? e.message : e);
      app.exit(1);
      return;
    }
  }

  // CLI: dump a record's full JSON blob
  if (cliDumpId) {
    try {
      const row = dbGet('SELECT id, status, data, updated_at, created_at FROM attendances WHERE id=?', [cliDumpId]);
      if (!row) {
        console.error('Record not found:', cliDumpId);
        app.exit(1);
        return;
      }
      let parsed = null;
      try { parsed = JSON.parse(row.data); } catch (_) { parsed = row.data; }
      console.log(JSON.stringify({ id: row.id, status: row.status, created_at: row.created_at, updated_at: row.updated_at, data: parsed }, null, 2));
      app.exit(0);
      return;
    } catch (e) {
      console.error('Failed to dump record:', e && e.message ? e.message : e);
      app.exit(1);
      return;
    }
  }

  // CLI: import a record from a PDF/JSON file and save as a draft.
  if (cliImportPath) {
    try {
      const data = await loadRecordDataFromFile(cliImportPath);
      // Ensure we don't accidentally carry over DB identity fields from JSON exports
      if (data && typeof data === 'object') {
        delete data.id;
        delete data.created_at;
        delete data.updated_at;
      }
      const savedId = insertImportedDraftAttendance(data);
      console.log(JSON.stringify({ ok: true, id: savedId }, null, 2));
      app.exit(0);
      return;
    } catch (e) {
      console.error('Import failed:', e && e.message ? e.message : e);
      app.exit(1);
      return;
    }
  }

  cleanupAccidentalDuplicateDrafts();
  dedupeDraftsByCaseKeys();
  getBackupScheduler();
  // Check cloud backup on startup; retry a few times in case network isn't ready
  checkCloudBackupEntitlement().catch(() => {});
  setTimeout(() => checkCloudBackupEntitlement().catch(() => {}), 5000);
  setTimeout(() => checkCloudBackupEntitlement().catch(() => {}), 15000);
  setInterval(() => { checkCloudBackupEntitlement().catch(() => {}); }, 60 * 60 * 1000);
  // Start cross-device sync after short delay to allow network to settle
  setTimeout(() => startSyncTimer(), 8000);
  setInterval(() => {
    cleanupAccidentalDuplicateDrafts();
    dedupeDraftsByCaseKeys();
  }, 5 * 60 * 1000);
  fetchAndCacheBankHolidays().catch(() => {});

  // Start auto-import watcher (normal UI mode).
  startAutoImportIfEnabled();
  // Re-check auto-import config periodically in case user changes settings.
  setInterval(startAutoImportIfEnabled, 30000);
});

app.on('window-all-closed', () => {
  stopSyncTimer();
  if (db) { flushDb(); db.close(); }
  app.quit();
});

ipcMain.handle('get-settings', () => {
  const rows = dbAll('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
});

ipcMain.handle('set-settings', (_, settings) => {
  for (const [key, value] of Object.entries(settings)) {
    dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value == null ? '' : String(value)]);
  }
  markDbDirty();
  return true;
});

ipcMain.handle('attendance-list', () => {
  /* Lightweight index-only rows for the list view — no data blob. */
  return dbAll(
    'SELECT id, created_at, updated_at, client_name, station_name, dscc_ref, attendance_date, status, supervisor_approved_at FROM attendances WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC'
  );
});

ipcMain.handle('attendance-list-full', () => {
  /* Full rows including data blob — used by CSV export and reports. */
  return dbAll(
    'SELECT id, created_at, updated_at, client_name, station_name, dscc_ref, attendance_date, status, data FROM attendances WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC'
  );
});

ipcMain.handle('attendance-home-stats', () => {
  const rows = dbAll(
    'SELECT id, created_at, updated_at, client_name, attendance_date, status, data FROM attendances WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC'
  );
  return rows.map(r => {
    let clientSig, feeEarnerSig, firmId, caseOutcomeStatus, totalTimeClaimed, totalHoursWorked, forename, surname;
    if (r.data) {
      try {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        clientSig = d.clientSig || '';
        feeEarnerSig = d.feeEarnerSig || '';
        firmId = d.firmId || '';
        caseOutcomeStatus = d.caseOutcomeStatus || '';
        totalTimeClaimed = d.totalTimeClaimed || '';
        totalHoursWorked = d.totalHoursWorked || '';
        forename = d.forename || '';
        surname = d.surname || '';
      } catch (_) {}
    }
    return {
      id: r.id, created_at: r.created_at, updated_at: r.updated_at,
      client_name: r.client_name, attendance_date: r.attendance_date, status: r.status,
      data: { clientSig, feeEarnerSig, firmId, caseOutcomeStatus, totalTimeClaimed, totalHoursWorked, forename, surname }
    };
  });
});

ipcMain.handle('attendance-search', (_, params) => {
  const { query, status, page, pageSize, sortField, sortDir, archived } = params || {};
  const p = Math.max(1, page || 1);
  const ps = Math.max(1, pageSize || 50);
  const offset = (p - 1) * ps;
  const orderCol = ['updated_at', 'attendance_date', 'client_name', 'station_name'].includes(sortField)
    ? sortField : 'updated_at';
  const orderDir = sortDir === 'ASC' ? 'ASC' : 'DESC';

  let where = 'WHERE deleted_at IS NULL';
  const params2 = [];

  if (archived === true) {
    where += ' AND archived_at IS NOT NULL';
  } else {
    where += ' AND archived_at IS NULL';
  }
  if (query && query.trim()) {
    const like = '%' + query.trim() + '%';
    where += ' AND (client_name LIKE ? OR dscc_ref LIKE ? OR attendance_date LIKE ? OR station_name LIKE ?)';
    params2.push(like, like, like, like);
  }
  if (status && status !== 'all') {
    where += ' AND status = ?';
    params2.push(status);
  }

  const countRow = dbGet(`SELECT COUNT(*) as total FROM attendances ${where}`, params2);
  const total = (countRow && countRow.total) || 0;
  const rows = dbAll(
    `SELECT id, created_at, updated_at, client_name, station_name, dscc_ref, attendance_date, status, supervisor_approved_at, archived_at, data
     FROM attendances ${where} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`,
    [...params2, ps, offset]
  );
  return { rows, total, page: p, pageSize: ps };
});

ipcMain.handle('attendance-check-duplicate', (_, { dsccRef, clientName, attendanceDate, stationName, excludeId }) => {
  const results = [];
  if (dsccRef && dsccRef.trim()) {
    const rows = dbAll(
      "SELECT id, client_name, attendance_date, station_name FROM attendances WHERE dscc_ref=? AND status='finalised' AND deleted_at IS NULL AND id!=?",
      [dsccRef.trim(), excludeId || 0]
    );
    rows.forEach(r => results.push({ ...r, matchReason: 'Same DSCC reference' }));
  }
  if (!results.length && clientName && attendanceDate && stationName) {
    const rows = dbAll(
      "SELECT id, client_name, attendance_date, station_name FROM attendances WHERE client_name=? AND attendance_date=? AND station_name=? AND status='finalised' AND deleted_at IS NULL AND id!=?",
      [clientName, attendanceDate, stationName, excludeId || 0]
    );
    rows.forEach(r => results.push({ ...r, matchReason: 'Same client, date and station' }));
  }
  return results;
});

ipcMain.handle('attendance-get', (_, id) => {
  return dbGet('SELECT id, data, status, supervisor_approved_at, supervisor_note, archived_at FROM attendances WHERE id = ?', [id]) || null;
});

ipcMain.handle('attendance-save', (_, { id, data, status, unlock }) => {
  const now = new Date().toISOString();
  const st = status || 'draft';

  /* Unlock: change status back to draft without overwriting data */
  if (id && unlock && !data) {
    const existing = dbGet('SELECT status, sync_version FROM attendances WHERE id = ?', [id]);
    if (existing) {
      const nextVer = (existing.sync_version || 1) + 1;
      dbRun('UPDATE attendances SET status=?, updated_at=?, sync_dirty=1, sync_version=? WHERE id=?', ['draft', now, nextVer, id]);
      db.run('INSERT INTO audit_log (attendance_id, action, timestamp) VALUES (?,?,?)', [id, 'unlocked_for_amendment', now]);
      markDbDirty();
      enqueueSyncForRecord(id);
    }
    return id;
  }

  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  let parsed;
  try {
    parsed = typeof data === 'object' ? data : JSON.parse(dataStr);
  } catch (e) {
    console.error('[attendance-save] Invalid JSON data payload:', e && e.message);
    throw new Error('Invalid attendance data — could not parse record');
  }

  /* Keep file reference in sync with file number (ours) – same value for both */
  if (parsed.ourFileNumber != null && parsed.ourFileNumber !== '') {
    parsed.fileReference = String(parsed.ourFileNumber);
  }
  const dataToSave = JSON.stringify(parsed);

  /* Extract indexed fields from parsed data */
  const clientName = [parsed.surname || '', parsed.forename || ''].filter(Boolean).join(', ');
  const stationName = parsed.policeStationName || '';
  const dsccRef = parsed.dsccRef || '';
  const attendanceDate = parsed.date || '';

  if (id) {
    const existing = dbGet('SELECT status, data, sync_version FROM attendances WHERE id = ?', [id]);

    /* Block edits to finalised records unless explicitly re-finalising */
    if (existing && existing.status === 'finalised' && st !== 'finalised') {
      return { error: 'locked', message: 'This record is finalised and cannot be modified.' };
    }

    /* Compute diff for audit log */
    let previousSnapshot = null;
    let changedFields = null;
    if (existing) {
      previousSnapshot = existing.data;
      try {
        const prev = JSON.parse(existing.data);
        const changed = Object.keys(parsed).filter(
          k => JSON.stringify(parsed[k]) !== JSON.stringify(prev[k])
        );
        changedFields = JSON.stringify(changed);
      } catch (_) {}
    }

    const nextVer = (existing && existing.sync_version || 1) + 1;
    dbRun(
      'UPDATE attendances SET data=?, status=?, updated_at=?, client_name=?, station_name=?, dscc_ref=?, attendance_date=?, sync_dirty=1, sync_version=? WHERE id=?',
      [dataToSave, st, now, clientName, stationName, dsccRef, attendanceDate, nextVer, id]
    );
    const action = st === 'finalised' ? 'finalised' : 'updated';
    db.run(
      'INSERT INTO audit_log (attendance_id, action, previous_snapshot, changed_fields, timestamp) VALUES (?,?,?,?,?)',
      [id, action, previousSnapshot, changedFields, now]
    );
    markDbDirty();
    enqueueSyncForRecord(id, st === 'finalised' ? 'finalise' : 'upsert');
    return id;
  }

  // One copy per case: if a draft already exists for this case (same DSCC or client+date+station), update it instead of creating a new row.
  if (st === 'draft') {
    const existingId = findExistingDraftIdByCaseKey(parsed);
    if (existingId) {
      const ev = dbGet('SELECT sync_version FROM attendances WHERE id=?', [existingId]);
      const nv = (ev && ev.sync_version || 1) + 1;
      dbRun(
        'UPDATE attendances SET data=?, status=?, updated_at=?, client_name=?, station_name=?, dscc_ref=?, attendance_date=?, sync_dirty=1, sync_version=? WHERE id=?',
        [dataToSave, st, now, clientName, stationName, dsccRef, attendanceDate, nv, existingId]
      );
      db.run(
        'INSERT INTO audit_log (attendance_id, action, timestamp) VALUES (?,?,?)',
        [existingId, 'updated', now]
      );
      markDbDirty();
      enqueueSyncForRecord(existingId);
      return existingId;
    }
    // Guard against burst duplicate inserts (double-click / repeated handler firing):
    // if we just created the exact same draft in the last 30s, reuse it.
    try {
      const recentDup = dbGet(
        "SELECT id, sync_version FROM attendances WHERE status='draft' AND deleted_at IS NULL AND data=? AND created_at >= datetime('now', '-30 seconds') ORDER BY id DESC LIMIT 1",
        [dataToSave]
      );
      if (recentDup && recentDup.id) {
        const nv = (recentDup.sync_version || 1) + 1;
        dbRun(
          'UPDATE attendances SET data=?, status=?, updated_at=?, client_name=?, station_name=?, dscc_ref=?, attendance_date=?, sync_dirty=1, sync_version=? WHERE id=?',
          [dataToSave, st, now, clientName, stationName, dsccRef, attendanceDate, nv, recentDup.id]
        );
        markDbDirty();
        enqueueSyncForRecord(recentDup.id);
        return recentDup.id;
      }
    } catch (e) {
      console.warn('[DB] Recent-duplicate guard failed:', e && e.message ? e.message : e);
    }
  }

  /* Assign sequential file number (ours) for new attendances only when user has not typed one */
  const userFileNum = (parsed.ourFileNumber != null && String(parsed.ourFileNumber).trim() !== '') ? String(parsed.ourFileNumber).trim() : null;
  if (userFileNum == null) {
    const nextRow = dbGet("SELECT value FROM settings WHERE key = 'nextFileNumberOurs'");
    const nextFileNum = (nextRow && nextRow.value !== undefined && nextRow.value !== '' ? (parseInt(nextRow.value, 10) || 1) : 1);
    parsed.ourFileNumber = String(nextFileNum);
    parsed.fileReference = parsed.ourFileNumber;
    dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('nextFileNumberOurs', ?)", [String(nextFileNum + 1)]);
  } else {
    parsed.ourFileNumber = userFileNum;
    parsed.fileReference = parsed.ourFileNumber;
  }
  const insertDataStr = JSON.stringify(parsed);
  const newSyncId = generateSyncId();

  dbRun(
    'INSERT INTO attendances (data, status, updated_at, client_name, station_name, dscc_ref, attendance_date, sync_id, sync_dirty, sync_version) VALUES (?,?,?,?,?,?,?,?,1,1)',
    [insertDataStr, st, now, clientName, stationName, dsccRef, attendanceDate, newSyncId]
  );
  markDbDirty();
  // sql.js + our dbRun/saveDb flow can occasionally yield 0 for last_insert_rowid().
  // Using MAX/ORDER BY is safe here (single-user local DB) and avoids "no id returned" in the UI.
  const r = dbGet('SELECT id FROM attendances ORDER BY id DESC LIMIT 1');
  const newId = r ? r.id : null;
  if (newId) {
    db.run(
      'INSERT INTO audit_log (attendance_id, action, timestamp) VALUES (?,?,?)',
      [newId, 'created', now]
    );
    enqueueSyncForRecord(newId);
  }
  return newId;
});

ipcMain.handle('attendance-archive', (_, id) => {
  if (!id) return false;
  const now = new Date().toISOString();
  const ev = dbGet('SELECT sync_version FROM attendances WHERE id=?', [id]);
  const nv = (ev && ev.sync_version || 1) + 1;
  dbRun('UPDATE attendances SET archived_at=?, updated_at=?, sync_dirty=1, sync_version=? WHERE id=?', [now, now, nv, id]);
  db.run('INSERT INTO audit_log (attendance_id, action, timestamp) VALUES (?,?,?)', [id, 'archived', now]);
  markDbDirty();
  enqueueSyncForRecord(id);
  return true;
});

ipcMain.handle('attendance-unarchive', (_, id) => {
  if (!id) return false;
  const now = new Date().toISOString();
  const ev = dbGet('SELECT sync_version FROM attendances WHERE id=?', [id]);
  const nv = (ev && ev.sync_version || 1) + 1;
  dbRun('UPDATE attendances SET archived_at=NULL, updated_at=?, sync_dirty=1, sync_version=? WHERE id=?', [now, nv, id]);
  markDbDirty();
  enqueueSyncForRecord(id);
  return true;
});

ipcMain.handle('attendance-delete', (_, { id, reason } = {}) => {
  if (!id) return false;
  const existing = dbGet('SELECT status, sync_version FROM attendances WHERE id = ?', [id]);
  if (existing && existing.status === 'finalised') {
    const now = new Date().toISOString();
    const nv = (existing.sync_version || 1) + 1;
    dbRun('UPDATE attendances SET deleted_at=?, deletion_reason=?, sync_dirty=1, sync_version=? WHERE id=?', [now, reason || '', nv, id]);
    db.run(
      'INSERT INTO audit_log (attendance_id, action, user_note, timestamp) VALUES (?,?,?,?)',
      [id, 'soft_deleted', reason || '', now]
    );
    markDbDirty();
    enqueueSyncForRecord(id);
    return { soft: true };
  }
  dbRun('DELETE FROM attendances WHERE id = ?', [id]);
  markDbDirty();
  return { hard: true };
});

ipcMain.handle('audit-log-get', (_, attendanceId) => {
  return dbAll(
    'SELECT id, action, changed_fields, timestamp, user_note FROM audit_log WHERE attendance_id=? ORDER BY timestamp DESC',
    [attendanceId]
  );
});

ipcMain.handle('supervisor-approve', (_, { id, note }) => {
  const now = new Date().toISOString();
  dbRun('UPDATE attendances SET supervisor_approved_at=?, supervisor_note=? WHERE id=?', [now, note || '', id]);
  db.run(
    'INSERT INTO audit_log (attendance_id, action, user_note, timestamp) VALUES (?,?,?,?)',
    [id, 'supervisor_approved', note || '', now]
  );
  markDbDirty();
  return true;
});

ipcMain.handle('stations-list', () => {
  return dbAll('SELECT id, name, code, scheme, region FROM police_stations ORDER BY region, name');
});

ipcMain.handle('stations-replace', (_, stations) => {
  if (!Array.isArray(stations)) throw new Error('stations must be an array');
  try {
    db.run('BEGIN');
    db.run('DELETE FROM police_stations');
    for (const s of stations) {
      db.run('INSERT INTO police_stations (name, code, scheme, region) VALUES (?, ?, ?, ?)',
        [s.name || '', s.code || '', s.scheme || '', s.region || '']);
    }
    db.run('COMMIT');
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (_) {}
    console.error('[stations-replace] Transaction failed, rolled back:', e && e.message);
    throw e;
  }
  saveDb();
  return true;
});

ipcMain.handle('firms-list', () => {
  return dbAll('SELECT id, name, laa_account, contact_name, contact_email, contact_phone, address, source_of_referral, is_default FROM firms ORDER BY is_default DESC, name');
});

ipcMain.handle('firm-save', (_, firm) => {
  const srcRef = firm.source_of_referral || '';
  if (firm.id) {
    dbRun('UPDATE firms SET name=?, laa_account=?, contact_name=?, contact_email=?, contact_phone=?, address=?, source_of_referral=?, is_default=? WHERE id=?',
      [firm.name, firm.laa_account || '', firm.contact_name || '', firm.contact_email || '', firm.contact_phone || '', firm.address || '', srcRef, firm.is_default ? 1 : 0, firm.id]);
    markDbDirty();
    return firm.id;
  }
  dbRun('INSERT INTO firms (name, laa_account, contact_name, contact_email, contact_phone, address, source_of_referral, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [firm.name, firm.laa_account || '', firm.contact_name || '', firm.contact_email || '', firm.contact_phone || '', firm.address || '', srcRef, firm.is_default ? 1 : 0]);
  markDbDirty();
  const r = dbGet('SELECT last_insert_rowid() as id');
  return r ? r.id : null;
});

ipcMain.handle('firm-delete', (_, id) => {
  dbRun('DELETE FROM firms WHERE id = ?', [id]);
  markDbDirty();
  return true;
});

ipcMain.handle('firm-set-default', (_, id) => {
  db.run('UPDATE firms SET is_default = 0');
  dbRun('UPDATE firms SET is_default = 1 WHERE id = ?', [id]);
  markDbDirty();
  return true;
});

ipcMain.handle('generate-ufn', (_, dateStr) => {
  const d = dateStr ? new Date(dateStr) : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const datePrefix = dd + mm + yy;
  const todayStart = `${d.getFullYear()}-${mm}-${dd}`;
  const count = dbGet(
    "SELECT COUNT(*) as c FROM attendances WHERE data LIKE ?",
    [`%"ufn":"${datePrefix}/%`]
  );
  const seq = ((count && count.c) || 0) + 1;
  return `${datePrefix}/${String(seq).padStart(3, '0')}`;
});

ipcMain.handle('load-reference-data', () => {
  const refPath = path.join(__dirname, 'data', 'laa-reference-data.json');
  if (fs.existsSync(refPath)) {
    try {
      return JSON.parse(fs.readFileSync(refPath, 'utf8'));
    } catch (e) {
      console.error('[load-reference-data] Failed to parse laa-reference-data.json:', e && e.message);
      return null;
    }
  }
  return null;
});

ipcMain.handle('backup-now', () => {
  try {
    const backupDir = getBackupFolder();
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const name = `attendance-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.db`;
    const dest = path.join(backupDir, name);
    const data = db.export();
    const encData = encryptBuffer(Buffer.from(data));
    fs.writeFileSync(dest, encData);
    const latestDest = path.join(backupDir, 'attendance-latest.db');
    fs.writeFileSync(latestDest, encData);
    dbDirtySinceQuickBackup = false;
    dbDirtySinceHourlyBackup = false;
    pruneOldBackups(backupDir);
    copyToOffsiteBackup(dest);
    copyToOffsiteBackup(latestDest);
    uploadToCloudIfConfigured(encData);
    uploadToS3IfConfigured(encData, 'attendance-latest.db');
    uploadToS3IfConfigured(encData, path.basename(dest));
    uploadToManagedCloudIfEnabled(encData, 'attendance-latest.db');
    uploadToManagedCloudIfEnabled(encData, path.basename(dest));
    const offsiteDir = getOffsiteBackupFolder();
    if (offsiteDir && fs.existsSync(offsiteDir)) pruneOldBackups(offsiteDir);
    const bs = _backupScheduler;
    if (bs) bs.recordCompleted('quick', 'manual', { bytes: encData.length }, true);
    return dest;
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error('[backup-now] Backup failed:', msg);
    throw new Error('Backup failed: ' + msg);
  }
});

ipcMain.handle('backup-status', () => {
  const bs = _backupScheduler;
  if (!bs) return { state: 'not-initialised' };
  return bs.getStatus();
});

ipcMain.on('editor-activity', () => {
  const bs = _backupScheduler;
  if (bs) bs.noteUserActivity('editor');
});

ipcMain.handle('db-repair', () => {
  if (!db) return { ok: false, error: 'Database not initialised' };
  const backupPath = createDbSafetyCopy('repair');
  const backfilled = backfillAttendanceIndexColumns();
  const removedBurst = cleanupAccidentalDuplicateDrafts();
  const removedByKey = dedupeDraftsByCaseKeys();
  return {
    ok: true,
    backupPath,
    backfilled,
    removedBurst,
    removedByKey,
  };
});

ipcMain.handle('save-csv', (_, { csv, filename }) => {
  const desktop = app.getPath('desktop');
  const safeName = path.basename(filename || 'attendances-export.csv').replace(/[<>:"/\\|?*]/g, '_');
  const filePath = path.join(desktop, safeName);
  fs.writeFileSync(filePath, csv, 'utf8');
  return filePath;
});

ipcMain.handle('get-desktop-path', () => app.getPath('desktop'));

ipcMain.handle('get-s3-backup-status', () => {
  const config = getS3Config();
  return {
    configured: !!config,
    lastSuccess: _lastS3SuccessTime,
    lastError: _lastS3Error || null,
  };
});

ipcMain.handle('test-s3-backup', async () => {
  const config = getS3Config();
  if (!config) return { ok: false, error: 'AWS S3 not configured' };
  try {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: S3_PREFIX + '.connection-test',
      Body: Buffer.from('ok'),
      ContentType: 'text/plain',
    }));
    _lastS3SuccessTime = Date.now();
    _lastS3Error = null;
    return { ok: true };
  } catch (err) {
    _lastS3Error = err && err.message ? err.message : String(err);
    return { ok: false, error: _lastS3Error };
  }
});

/* ─── Managed cloud backup IPC handlers ─── */

ipcMain.handle('cloud-backup-status', () => {
  const licData = readLicenceData();
  return {
    enabled: _cloudBackupEnabled,
    lastSuccess: _lastManagedCloudSuccess,
    lastError: _lastManagedCloudError,
    isTrial: !!(licData && licData.isTrial),
  };
});

ipcMain.handle('cloud-backup-check-entitlement', async () => {
  await checkCloudBackupEntitlement();
  return { enabled: _cloudBackupEnabled };
});

ipcMain.handle('cloud-backup-subscribe', async () => {
  const apiUrl = getManagedCloudApiUrl();
  const data = readLicenceData();
  const email = data && data.email ? data.email : '';
  const url = `${apiUrl}/buy?plan=cloud${email ? '&email=' + encodeURIComponent(email) : ''}`;
  shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('cloud-backup-list', async () => {
  const data = readLicenceData();
  if (!data || !data.key) return { backups: [], error: 'No licence key' };
  const apiUrl = getManagedCloudApiUrl();
  try {
    const resp = await httpPost(`${apiUrl}/api/backup/list`, { key: data.key });
    return resp;
  } catch (e) {
    return { backups: [], error: e && e.message ? e.message : 'Failed to list backups' };
  }
});

ipcMain.handle('cloud-backup-restore', async (_, { backupKey }) => {
  const data = readLicenceData();
  if (!data || !data.key) return { ok: false, error: 'No licence key' };
  if (typeof backupKey !== 'string' || !backupKey.trim()) return { ok: false, error: 'Invalid backup key' };
  const sanitizedKey = backupKey.replace(/[^a-zA-Z0-9._\-]/g, '');
  if (sanitizedKey !== backupKey || sanitizedKey.includes('..')) return { ok: false, error: 'Invalid backup key' };
  try {
    const creds = await fetchManagedCloudCredentials();
    if (!creds) return { ok: false, error: 'Could not obtain cloud credentials' };
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: creds.region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });
    const s3Key = `${creds.prefix}/${sanitizedKey}`;
    const resp = await client.send(new GetObjectCommand({ Bucket: creds.bucket, Key: s3Key }));
    const chunks = [];
    for await (const chunk of resp.Body) { chunks.push(chunk); }
    const encryptedBuffer = Buffer.concat(chunks);

    // Save safety copy first
    createDbSafetyCopy('pre-cloud-restore');

    // Decrypt and load
    const decrypted = await decryptBufferWithRecovery(encryptedBuffer);
    if (!decrypted) return { ok: false, error: 'Could not decrypt the backup. Check your recovery password.' };

    const SQL = await initSqlJs();
    const newDb = new SQL.Database(decrypted);
    db = newDb;
    // Ensure sync columns exist in restored DB and mark all records for re-sync
    try { db.run("ALTER TABLE attendances ADD COLUMN sync_id TEXT DEFAULT NULL"); } catch (_) {}
    try { db.run("ALTER TABLE attendances ADD COLUMN sync_dirty INTEGER DEFAULT 1"); } catch (_) {}
    try { db.run("ALTER TABLE attendances ADD COLUMN sync_version INTEGER DEFAULT 1"); } catch (_) {}
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_att_sync_id ON attendances(sync_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_att_sync_dirty ON attendances(sync_dirty)");
    db.run(`CREATE TABLE IF NOT EXISTS sync_queue (id TEXT PRIMARY KEY, record_id TEXT, operation TEXT, payload TEXT, created_at INTEGER, retry_count INTEGER, last_attempt INTEGER, status TEXT, error TEXT)`);
    backfillSyncIds();
    dbRun("UPDATE attendances SET sync_dirty=1");
    dbRun("DELETE FROM settings WHERE key='lastSyncPullAt'");
    saveDb();
    console.log('[Restore] Database restored from cloud backup:', backupKey);
    return { ok: true };
  } catch (e) {
    console.error('[Restore] Cloud restore failed:', e && e.message ? e.message : e);
    return { ok: false, error: e && e.message ? e.message : 'Restore failed' };
  }
});

/* ─── Cross-device sync IPC handlers ─── */
ipcMain.handle('sync-now', async () => {
  try {
    const w = getSyncWorker();
    if (w) await w.runCycle();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Sync failed' };
  }
});

ipcMain.handle('sync-status', () => {
  const lastSync = getLastSyncTimestamp();
  const dirtyCount = dbGet('SELECT COUNT(*) as c FROM attendances WHERE sync_dirty=1');
  const queuePending = dbGet("SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('pending','syncing')");
  const queueFailed = dbGet("SELECT COUNT(*) as c FROM sync_queue WHERE status='failed'");
  const queueBlocked = dbGet("SELECT COUNT(*) as c FROM sync_queue WHERE status='blocked'");
  const totalCount = dbGet('SELECT COUNT(*) as c FROM attendances WHERE deleted_at IS NULL');
  const apiUrl = getSyncApiUrl();
  const diag = getSyncWorker() ? getSyncWorker().getDiagnostics() : {};
  let lastAttempts = [];
  try {
    const rows = dbAll('SELECT correlation_id, direction, record_count, success, error_message, created_at FROM sync_attempts ORDER BY id DESC LIMIT 10');
    lastAttempts = (rows || []).map(r => ({
      correlationId: r.correlation_id,
      direction: r.direction,
      recordCount: r.record_count,
      success: !!r.success,
      errorMessage: r.error_message,
      createdAt: r.created_at,
    }));
  } catch (_) {}
  const pendingCount = (queuePending ? queuePending.c : 0) || 0;
  const failedCount = (queueFailed ? queueFailed.c : 0) || 0;
  const blockedCount = (queueBlocked ? queueBlocked.c : 0) || 0;
  const pending = pendingCount + failedCount + blockedCount;
  return {
    enabled: !!apiUrl,
    inProgress: diag.inProgress || false,
    lastSync: lastSync !== '1970-01-01T00:00:00.000Z' ? lastSync : diag.lastSyncAt || null,
    pendingChanges: pending,
    failedCount,
    blockedCount,
    totalRecords: totalCount ? totalCount.c : 0,
    lastAttempts,
    connectivity: diag.connectivity,
    lastError: diag.lastError,
  };
});

ipcMain.handle('sync-schedule-on-reconnect', () => {
  scheduleSyncSoon();
  return {};
});

ipcMain.handle('sync-get-diagnostics', () => {
  const w = getSyncWorker();
  return w ? w.getDiagnostics() : {};
});

ipcMain.handle('sync-force-retry', () => {
  const w = getSyncWorker();
  if (!w) return { recovered: 0 };
  const recovered = w.forceRetryAll();
  if (recovered > 0) w.scheduleSoon();
  return { recovered };
});

ipcMain.handle('prepare-trial', async () => {
  const scriptPath = path.join(__dirname, 'scripts', 'prepare-trial.js');
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: 'Run "npm run prepare-trial" from the project folder.' };
  }
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const proc = spawn('node', [scriptPath], { cwd: __dirname, stdio: 'inherit', shell: true });
    proc.on('close', (code) => resolve({ ok: code === 0, error: code !== 0 ? 'Script failed' : null }));
    proc.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
});

ipcMain.handle('get-db-path', () => getDbPath());

ipcMain.handle('set-recovery-password', async (_, password) => {
  try {
    const result = await setRecoveryPassword(password);
    saveDb();
    return { success: true, cloudBackupOk: result.cloudBackupOk };
  } catch (err) {
    return { success: false, error: err.message, cloudBackupOk: false };
  }
});

ipcMain.handle('has-recovery-password', () => hasRecoveryPassword());

ipcMain.handle('recover-key-from-cloud', async () => {
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) return { ok: false, error: 'Cannot reach server' };
  const data = readLicenceData();
  if (!data || !data.key) return { ok: false, error: 'No licence key activated' };
  try {
    const resp = await httpPost(`${apiUrl}/api/recovery`, {
      key: data.key,
      machineId: getMachineId(),
    });
    if (!resp || !resp.ok) return { ok: false, error: resp && resp.error ? resp.error : 'Failed' };
    if (!resp.blob) return { ok: false, error: 'No cloud recovery data found. Set a recovery password on a device that has your data.' };
    const masterKeyHex = decryptMasterKeyFromEscrow(resp.blob, data.key);
    if (!masterKeyHex || masterKeyHex.length !== 64) {
      return { ok: false, error: 'Could not decrypt recovery data. The licence key may not match.' };
    }
    _masterKey = masterKeyHex;
    saveMasterKeyToSafeStorage(masterKeyHex);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Recovery failed' };
  }
});

ipcMain.handle('is-db-encrypted', () => {
  try {
    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) return false;
    const buf = fs.readFileSync(dbPath);
    return buf.length >= 4 && buf.slice(0, 4).toString() === MAGIC;
  } catch (_) { return false; }
});

ipcMain.handle('is-safe-storage-available', () => safeStorage.isEncryptionAvailable());

ipcMain.handle('choose-folder', async (_, opts) => {
  const title = opts && opts.forOffsite ? 'Choose off-site backup folder (e.g. OneDrive, Dropbox)' : 'Choose backup folder';
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title,
  });
  return canceled ? null : (filePaths[0] || null);
});

ipcMain.handle('detect-cloud-folders', () => {
  const home = app.getPath('home');
  const candidates = [
    { name: 'OneDrive', sub: 'OneDrive' },
    { name: 'Dropbox', sub: 'Dropbox' },
    { name: 'Google Drive', sub: 'Google Drive' },
    { name: 'iCloud Drive', sub: 'iCloudDrive' },
  ];
  const found = [];
  for (const c of candidates) {
    const full = path.join(home, c.sub);
    try { if (fs.existsSync(full) && fs.statSync(full).isDirectory()) found.push({ name: c.name, path: full }); } catch (_) {}
  }
  try {
    const entries = fs.readdirSync(home, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('OneDrive - ') && !found.some(f => f.path === path.join(home, e.name))) {
        found.push({ name: 'OneDrive (' + e.name.slice(11) + ')', path: path.join(home, e.name) });
      }
    }
  } catch (_) {}
  return found;
});

ipcMain.handle('pick-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Attach photo',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
  });
  if (canceled || !filePaths.length) return null;
  const filePath = filePaths[0];
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
  const mime = mimeMap[ext] || 'image/jpeg';
  const buf = fs.readFileSync(filePath);
  if (buf.length > 5 * 1024 * 1024) return { error: 'File too large (max 5MB)' };
  return { dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64'), name: path.basename(filePath) };
});

ipcMain.handle('pick-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Attach file',
    filters: [
      { name: 'All supported files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'heic', 'heif'] },
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Word / Excel', extensions: ['doc', 'docx', 'xls', 'xlsx'] },
      { name: 'Text / CSV', extensions: ['txt', 'csv'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths.length) return null;
  const filePath = filePaths[0];
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeMap = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif',
    pdf: 'application/pdf',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain', csv: 'text/csv',
  };
  const mime = mimeMap[ext] || 'application/octet-stream';
  const buf = fs.readFileSync(filePath);
  if (buf.length > 15 * 1024 * 1024) return { error: 'File too large (max 15MB)' };
  return { dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64'), name: path.basename(filePath), mime };
});

/* ─── Import record from PDF or JSON (Settings / Admin) ─── */
const IMPORT_MARKER = 'CUSTODY_NOTE_IMPORT:';
async function loadRecordDataFromFile(filePath) {
  if (!filePath || typeof filePath !== 'string') throw new Error('No file path provided');
  const p = filePath.trim();
  if (!p) throw new Error('No file path provided');
  if (!fs.existsSync(p)) throw new Error('File not found: ' + p);
  const ext = path.extname(p).toLowerCase();

  if (ext === '.json') {
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') throw new Error('No record data in JSON');
    return data;
  }

  if (ext === '.pdf') {
    let pdfParse;
    try {
      pdfParse = require('pdf-parse');
    } catch (_) {
      throw new Error('PDF import requires the pdf-parse package. Run: npm install pdf-parse');
    }
    const buffer = fs.readFileSync(p);
    const result = await pdfParse(buffer);
    const text = result && result.text ? result.text : '';

    // Preferred path: PDF exported from this app (hidden base64 JSON marker)
    const idx = text.indexOf(IMPORT_MARKER);
    if (idx !== -1) {
      const base64 = text.slice(idx + IMPORT_MARKER.length).replace(/\s/g, '');
      const decoded = Buffer.from(base64, 'base64').toString('utf8');
      const data = JSON.parse(decoded);
      if (!data || typeof data !== 'object') throw new Error('No record data in PDF');
      return data;
    }

    // Fallback path: Custody Note-generated custody note PDF (labelled fields)
    const parsed = parseCasenotePdfTextToRecordData(text);
    if (parsed) return parsed;

    throw new Error('No Custody Note import data in this PDF. Use a PDF exported from Custody Note.');
  }

  throw new Error('Unsupported file type. Use a .pdf or .json file.');
}

function insertImportedDraftAttendance(data) {
  if (!db) throw new Error('Database not initialised');
  if (!data || typeof data !== 'object') throw new Error('No record data in file');

  // Keep file reference in sync with file number (ours) – same value for both
  if (data.ourFileNumber != null && data.ourFileNumber !== '') {
    data.fileReference = String(data.ourFileNumber);
  }

  const now = new Date().toISOString();
  const clientName = [data.surname || '', data.forename || ''].filter(Boolean).join(', ');
  const stationName = data.policeStationName || '';
  const dsccRef = data.dsccRef || '';
  const attendanceDate = data.date || (data.instructionDateTime ? String(data.instructionDateTime).slice(0, 10) : '') || '';

  const dataStr = JSON.stringify(data);

  // Prefer updating an existing draft for the same case to avoid duplicates.
  let existingId = null;
  if (data.ourFileNumber != null && String(data.ourFileNumber).trim()) {
    try {
      const ofn = String(data.ourFileNumber).trim();
      const row = dbGet(
        "SELECT id FROM attendances WHERE status='draft' AND deleted_at IS NULL AND data LIKE ? ORDER BY updated_at DESC LIMIT 1",
        [`%"ourFileNumber":"${ofn}"%`]
      );
      if (row && row.id) existingId = row.id;
    } catch (_) {}
  }
  if (!existingId) existingId = findExistingDraftIdByCaseKey(data);
  if (existingId) {
    dbRun(
      'UPDATE attendances SET data=?, status=?, updated_at=?, client_name=?, station_name=?, dscc_ref=?, attendance_date=? WHERE id=?',
      [dataStr, 'draft', now, clientName, stationName, dsccRef, attendanceDate, existingId]
    );
    markDbDirty();
    return existingId;
  }

  dbRun(
    'INSERT INTO attendances (data, status, updated_at, client_name, station_name, dscc_ref, attendance_date) VALUES (?,?,?,?,?,?,?)',
    [dataStr, 'draft', now, clientName, stationName, dsccRef, attendanceDate]
  );
  markDbDirty();
  const r = dbGet('SELECT id FROM attendances ORDER BY id DESC LIMIT 1');
  return r ? r.id : null;
}

ipcMain.handle('import-record-from-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Load record from PDF or JSON',
    filters: [
      { name: 'PDF or JSON', extensions: ['pdf', 'json'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'All', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths.length) return { error: 'cancelled' };
  const filePath = filePaths[0];

  try {
    const data = await loadRecordDataFromFile(filePath);
    return { data };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (err instanceof SyntaxError) return { error: 'Invalid JSON in file.' };
    return { error: msg };
  }
});

// Import record from an explicit file path (used by paste-path and drag-drop import).
ipcMain.handle('import-record-from-path', async (_, filePath) => {
  try {
    const data = await loadRecordDataFromFile(filePath);
    return { data };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (err instanceof SyntaxError) return { error: 'Invalid JSON in file.' };
    return { error: msg };
  }
});

/* ─── Photo file storage (encrypted, separate files) ─── */
function getPhotosDir(attendanceId) {
  const dir = path.join(app.getPath('userData'), 'photos', String(attendanceId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle('photo-save', (_, { attendanceId, photoId, dataUrl, name, mimeType }) => {
  try {
    const dir = getPhotosDir(attendanceId);
    const filePath = path.join(dir, photoId + '.enc');
    const buf = Buffer.from(dataUrl, 'utf8');
    fs.writeFileSync(filePath, encryptBuffer(buf));
    return { photoId, name, mimeType };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('photo-load', (_, { attendanceId, photoId }) => {
  try {
    const filePath = path.join(app.getPath('userData'), 'photos', String(attendanceId), photoId + '.enc');
    if (!fs.existsSync(filePath)) return null;
    const enc = fs.readFileSync(filePath);
    const dec = decryptBuffer(enc);
    return dec ? dec.toString('utf8') : null;
  } catch (err) {
    console.error('[Photo] Load failed:', err.message);
    return null;
  }
});

ipcMain.handle('photo-delete', (_, { attendanceId, photoId }) => {
  try {
    const filePath = path.join(app.getPath('userData'), 'photos', String(attendanceId), photoId + '.enc');
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    return false;
  }
});

ipcMain.handle('open-external', (_, url) => {
  if (typeof url !== 'string') return;
  const u = url.trim();
  if (u.startsWith('https://') || u.startsWith('mailto:')) {
    shell.openExternal(u);
  }
});

ipcMain.handle('open-path', async (_, filePath) => {
  try {
    if (typeof filePath !== 'string') return false;
    const p = filePath.trim();
    if (!p) return false;
    await shell.openPath(p);
    return true;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('print-to-pdf', async (_, { html, filename }) => {
  const desktop = app.getPath('desktop');
  const safeName = path.basename(filename || `attendance-${Date.now()}.pdf`).replace(/[<>:"/\\|?*]/g, '_');
  const filePath = path.join(desktop, safeName);
  const win = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => win.webContents.on('did-finish-load', resolve));
  const buf = await win.webContents.printToPDF({
    pageSize: 'A4',
    margins: { marginType: 'default' },
    printBackground: true,
    preferCSSPageSize: false,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `
      <div style="width:100%; padding:0 12px; font-family:Segoe UI, Arial, sans-serif; font-size:8px; color:#475569; border-top:1px solid #e2e8f0; padding-top:6px; display:flex; justify-content:space-between; align-items:center;">
        <div>Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
        <div>Created with Custody Note</div>
        <div>Generated <span class="date"></span></div>
      </div>
    `,
  });
  win.close();
  fs.writeFileSync(filePath, buf);
  return filePath;
});

/* ─── Print an existing PDF file ─── */
ipcMain.handle('print-pdf-file', async (_, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return { error: 'File not found' };
  const win = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(filePath);
  await new Promise((resolve) => win.webContents.on('did-finish-load', resolve));
  await new Promise((resolve) => setTimeout(resolve, 500));
  win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
    if (!success && reason !== 'cancelled') console.error('Print failed:', reason);
    win.close();
  });
  return { ok: true };
});

/* ─── LAA Official PDF prefill ─── */
const { PDFDocument } = require('pdf-lib');

const LAA_FORM_FILES = {
  crm1: 'crm1-v16-feb-2025.pdf',
  crm2: 'crm2-v15-oct-2025.pdf',
  crm3: 'crm3-v17-feb-2025.pdf',
  declaration: 'applicant-declaration-v7-feb-2025.pdf',
};

function getLaaFormDir() {
  const packed = path.join(process.resourcesPath, 'app', 'data', 'laa-official-forms');
  if (fs.existsSync(packed)) return packed;
  return path.join(__dirname, 'data', 'laa-official-forms');
}

function fmtDateDMY(val) {
  if (!val) return '';
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(val);
}

function safeSet(form, fieldName, value) {
  if (!value) return;
  try { form.getTextField(fieldName).setText(String(value)); } catch (_) {}
}

function safeCheck(form, fieldName, condition) {
  if (!condition) return;
  try { form.getCheckBox(fieldName).check(); } catch (_) {}
}

async function embedSignature(pdfDoc, form, fieldName, dataUri) {
  if (!dataUri || typeof dataUri !== 'string' || !dataUri.startsWith('data:image')) return;
  try {
    const field = form.getField(fieldName);
    const widgets = field.acroField.getWidgets();
    if (!widgets.length) return;
    const rect = widgets[0].getRectangle();
    const pageRef = widgets[0].P();
    const pages = pdfDoc.getPages();
    let page = pages[pages.length - 1];
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].ref === pageRef) { page = pages[i]; break; }
    }
    const base64 = dataUri.split(',')[1];
    if (!base64) return;
    const imgBytes = Buffer.from(base64, 'base64');
    const image = dataUri.includes('image/jpeg') || dataUri.includes('image/jpg')
      ? await pdfDoc.embedJpg(imgBytes)
      : await pdfDoc.embedPng(imgBytes);
    const scale = Math.min(rect.width / image.width, rect.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, {
      x: rect.x,
      y: rect.y + (rect.height - h) / 2,
      width: w,
      height: h,
    });
    form.removeField(field);
  } catch (e) {
    console.error('[Signature embed]', fieldName, e.message);
  }
}

function fillCRM1(form, d) {
  safeSet(form, 'Surname', d.surname);
  safeSet(form, 'First_name', d.forename);
  const dob = fmtDateDMY(d.dob);
  if (dob) {
    const parts = dob.split('/');
    safeSet(form, 'Date_of_birth', parts[0] || '');
    safeSet(form, 'Date_of_birth1', parts[1] || '');
    safeSet(form, 'Date_of_birth2', parts[2] || '');
  }
  safeSet(form, 'National_insurance_number', d.niNumber ? d.niNumber.substring(0, 2) : '');
  safeSet(form, 'National_insurance_number1', d.niNumber ? d.niNumber.substring(2) : '');
  safeSet(form, 'Current_address', [d.address1, d.address2, d.address3].filter(Boolean).join(', '));
  safeSet(form, 'FillText1', d.city);
  safeSet(form, 'County', d.county);
  safeSet(form, 'Postcode', d.postCode);
  safeSet(form, 'FillText644', d.ufn);

  const ms = d.maritalStatus || '';
  safeCheck(form, 'Married', ms === 'Married' || ms === 'Civil Partner' || ms === 'Married/Civil Partner');
  safeCheck(form, 'CheckBox87', ms === 'Single');
  safeCheck(form, 'Separated', ms === 'Separated');
  safeCheck(form, 'Divorced', ms === 'Divorced' || ms === 'Divorced/dissolved CP');
  safeCheck(form, 'CheckBox89', ms === 'Cohabiting');
  safeCheck(form, 'CheckBox11', ms === 'Widowed');

  const g = d.gender || '';
  safeCheck(form, 'CheckBox12', g === 'Male');
  safeCheck(form, 'CheckBox14', g === 'Female');
  safeCheck(form, 'CheckBox1', g === 'Prefer not to say');

  const under18 = d.juvenileVulnerable === 'Juvenile';
  safeCheck(form, 'Client under 18 checkbox', under18);
  safeCheck(form, 'Client not under 18 checkbox', !under18);

  const onBenefit = d.passportedBenefit === 'Yes' || d.benefits === 'Yes';
  safeCheck(form, 'CheckBox9', onBenefit);
  safeCheck(form, 'CheckBox10', !onBenefit);

  safeSet(form, 'The_client1', d.grossIncome);
  safeSet(form, 'FillText15', d.dependants);
  safeSet(form, 'Partner_if_living_with_t_', d.partnerName);
}

function fillCRM2(form, d) {
  safeCheck(form, 'CheckBox13', d.previousAdvice !== 'Yes');
  safeCheck(form, 'CheckBox14', d.previousAdvice === 'Yes');
  safeSet(form, 'FillText6', fmtDateDMY(d.previousAdviceDate));
  safeSet(form, 'FillText2', d.previousFirmName);
  safeSet(form, 'FillText5', fmtDateDMY(d.laaSignatureDate) || fmtDateDMY(d.date));

  safeCheck(form, 'CheckBox1', true);

  const wt = d.workType || '';
  safeCheck(form, 'CheckBox2', wt.indexOf('Criminal') >= 0 || wt.indexOf('Attendance') >= 0 || wt.indexOf('Telephone') < 0);
  safeCheck(form, 'CheckBox4', wt.indexOf('CCRC') >= 0);
  safeCheck(form, 'CheckBox5', wt.indexOf('Appeals') >= 0 || wt.indexOf('Review') >= 0);
  safeCheck(form, 'CheckBox3', wt.indexOf('Prison') >= 0);

  safeCheck(form, 'CheckBox6', d.travelledToClient === 'Yes');
  safeCheck(form, 'CheckBox7', d.childOrPatient === 'Yes' || d.juvenileVulnerable === 'Juvenile');
  safeCheck(form, 'CheckBox8', d.previousAdvice === 'Yes');
  safeCheck(form, 'CheckBox9', d.telephoneAdviceGiven === 'Yes');
  safeCheck(form, 'CheckBox10', d.claimedOutwardTravelBeforeSignature === 'Yes');

  const justified = [];
  if (d.travelledToClient === 'Yes') justified.push('Travelled out of office to visit client.');
  if (d.childOrPatient === 'Yes' || d.juvenileVulnerable === 'Juvenile') justified.push('Application accepted from child/patient.');
  if (d.previousAdvice === 'Yes') justified.push('Advice provided within 6 months on same matter.');
  if (d.telephoneAdviceGiven === 'Yes') justified.push('Telephone advice before signature.');
  if (d.crm2JustificationNotes) justified.push(d.crm2JustificationNotes);
  safeSet(form, 'FillText1', justified.join(' '));

  safeCheck(form, 'CheckBox11', d.repOrderApplied === 'Yes');
  safeCheck(form, 'CheckBox12', d.repOrderApplied !== 'Yes');
}

function fillCRM3(form, d) {
  const isDefending = d.outcomeDecision ? (d.outcomeDecision.indexOf('Charged') >= 0 || d.outcomeDecision.indexOf('Bail') >= 0) : true;
  safeCheck(form, 'defending_the', isDefending);
  safeCheck(form, 'CheckBox4', !isDefending);
  safeCheck(form, 'involved_in_another_way', false);

  const instrDate = fmtDateDMY(d.date);
  if (instrDate) {
    const parts = instrDate.split('/');
    safeSet(form, 'Date_first_instructed_by', parts[0] || '');
    safeSet(form, 'Date_first_instructed_by1', parts[1] || '');
    safeSet(form, 'Date_first_instructed_by2', parts[2] || '');
  }

  const reason = d.advocacyReason || '';
  safeCheck(form, 'Disciplinary_proceedings', reason.indexOf('Disciplinary') >= 0);
  safeCheck(form, 'CheckBox10', reason.indexOf('Parole') >= 0);
  safeCheck(form, 'CheckBox1', reason.indexOf('Category A') >= 0);
  safeCheck(form, 'Mental_Health_Review_Trib', reason.indexOf('Minimum Term') >= 0);
  safeCheck(form, 'CheckBox13', reason.indexOf('Armed Forces') >= 0);

  safeCheck(form, 'CheckBox3', reason.indexOf('bail') >= 0 || reason.indexOf('Bail') >= 0 || (d.outcomeDecision && d.outcomeDecision.indexOf('Charged') >= 0));
  safeCheck(form, 'CheckBox5', reason.indexOf('Warrant') >= 0 || reason.indexOf('detention') >= 0 || reason.indexOf('Detention') >= 0);

  safeSet(form, 'Name_of_court', d.courtName || d.policeStationName || '');

  const nextHearing = fmtDateDMY(d.courtDate || d.bailDate);
  if (nextHearing) {
    const parts = nextHearing.split('/');
    safeSet(form, 'Date_of_next_hearing', parts[0] || '');
    safeSet(form, 'Date_of_next_hearing1', parts[1] || '');
    safeSet(form, 'Date_of_next_hearing2', parts[2] || '');
  }

  const actionStarted = fmtDateDMY(d.date);
  if (actionStarted) {
    const parts = actionStarted.split('/');
    safeSet(form, 'Date_court_action_started', parts[0] || '');
    safeSet(form, 'Date_court_action_started1', parts[1] || '');
    safeSet(form, 'Date_court_action_started2', parts[2] || '');
  }

  safeCheck(form, 'Yes1', true);
  safeCheck(form, 'CheckBox2', d.counselInstructed === 'Yes');
  safeCheck(form, 'CheckBox7', d.counselInstructed !== 'Yes');

  safeSet(form, 'FillText10', d.offenceSummary || d.offence1Details);
  safeSet(form, 'FillText17', reason || (d.outcomeDecision && d.outcomeDecision.indexOf('Charged') >= 0 ? 'Bail application / remand hearing following charge at police station.' : ''));
}

async function fillDeclaration(pdfDoc, form, d, settings) {
  const s = settings || {};
  // Text4 = USN — left blank; the firm fills this in
  safeSet(form, 'Text5', [d.forename, d.surname].filter(Boolean).join(' '));
  safeSet(form, 'Text6', d.niNumber);
  safeSet(form, 'Text7', fmtDateDMY(d.dob));
  safeSet(form, 'Dated', fmtDateDMY(d.laaSignatureDate) || fmtDateDMY(d.date));
  safeSet(form, 'Full name in block capitals', [d.forename, d.surname].filter(Boolean).join(' ').toUpperCase());
  safeCheck(form, 'a firm which holds a contract issued by the LAA', true);
  safeSet(form, 'Full name in block capitals_3', d.feeEarnerName || d.laaFeeEarnerFullName || s.feeEarnerName || '');
  safeSet(form, 's LAA Account Number', s.firmLaaAccount || d.firmLaaAccount || '');

  await embedSignature(pdfDoc, form, 'Signature1', d.clientSig);
  await embedSignature(pdfDoc, form, 'Signature3', d.feeEarnerSig);
}

ipcMain.handle('laa-generate-official-pdf', async (_, { formType, data }) => {
  try {
    const filename = LAA_FORM_FILES[formType];
    if (!filename) return { error: 'Unknown form type: ' + formType };
    const templatePath = path.join(getLaaFormDir(), filename);
    if (!fs.existsSync(templatePath)) return { error: 'Template not found: ' + filename };

    const templateBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const d = data || {};

    const rows = dbAll ? dbAll('SELECT key, value FROM settings') : [];
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    settings.firmName = settings.firmName || '';
    settings.firmLaaAccount = settings.firmLaaAccount || '';
    settings.feeEarnerName = settings.feeEarnerName || '';

    switch (formType) {
      case 'crm1': fillCRM1(form, d); break;
      case 'crm2': fillCRM2(form, d); break;
      case 'crm3': fillCRM3(form, d); break;
      case 'declaration': await fillDeclaration(pdfDoc, form, d, settings); break;
    }

    const pdfBytes = await pdfDoc.save();
    const desktop = app.getPath('desktop');
    const clientName = [d.forename, d.surname].filter(Boolean).join('_') || 'form';
    const dateStr = (d.date || '').replace(/-/g, '') || String(Date.now());
    const safeName = `${formType.toUpperCase()}-${clientName}-${dateStr}.pdf`.replace(/[<>:"/\\|?*]/g, '_');
    const outPath = path.join(desktop, safeName);
    fs.writeFileSync(outPath, pdfBytes);
    return { path: outPath };
  } catch (err) {
    console.error('[LAA PDF]', err);
    return { error: err.message || String(err) };
  }
});

ipcMain.handle('laa-open-official-template', async (_, formType) => {
  try {
    const filename = LAA_FORM_FILES[formType];
    if (!filename) return { error: 'Unknown form type: ' + formType };
    const templatePath = path.join(getLaaFormDir(), filename);
    if (!fs.existsSync(templatePath)) return { error: 'Template not found: ' + filename };
    await shell.openPath(templatePath);
    return { path: templatePath };
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

/* ─── QuickFile API helpers ─── */
function getQuickFileAuth() {
  const rows = dbAll('SELECT key, value FROM settings');
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const accountNumber = (settings.quickfileAccountNumber || '').trim();
  const apiKey = (settings.quickfileApiKey || '').trim();
  const applicationId = (settings.quickfileAppId || '').trim();
  if (!accountNumber || !apiKey || !applicationId) {
    throw new Error('QuickFile not configured. Add Account number, API key and Application ID in Settings.');
  }
  const submissionNumber = 'cn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  const hashInput = accountNumber + apiKey + submissionNumber;
  const md5Value = crypto.createHash('md5').update(hashInput, 'utf8').digest('hex').toLowerCase();
  return { accountNumber, submissionNumber, md5Value, applicationId };
}

function quickFileRequest(urlPath, bodyContent) {
  const auth = getQuickFileAuth();
  const postData = JSON.stringify({
    payload: {
      Header: {
        MessageType: 'Request',
        SubmissionNumber: auth.submissionNumber,
        Authentication: {
          AccNumber: auth.accountNumber,
          MD5Value: auth.md5Value,
          ApplicationID: auth.applicationId,
        },
      },
      Body: bodyContent,
    },
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.quickfile.co.uk',
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData, 'utf8'),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            
            if (json?.Errors) {
              const errs = json.Errors.Error || json.Errors;
              return reject(new Error(Array.isArray(errs) ? errs.join('; ') : String(errs)));
            }
            const rootKey = Object.keys(json).find(k => typeof json[k] === 'object' && json[k]?.Header);
            const msg = rootKey ? json[rootKey] : (json?.payload?.Message || json?.Message || json);
            const header = msg?.Header;
            const status = header?.Status;
            if (status === 'Error') {
              const errMsg = header?.StatusMessage || header?.ErrorMessage || msg?.Body?.ErrorMessage || 'Unknown QuickFile error';
              return reject(new Error(String(errMsg)));
            }
            resolve(msg?.Body || {});
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(postData, 'utf8');
    req.end();
  });
}

/* ─── QuickFile API: fetch recent invoices and suggest next number ─── */
ipcMain.handle('quickfile-fetch-invoices', async () => {
  const body = await quickFileRequest('/1_2/invoice/search', {
    SearchParameters: {
      ReturnCount: 50,
      Offset: 0,
      OrderResultsBy: 'InvoiceNumber',
      OrderDirection: 'DESC',
      InvoiceType: 'INVOICE',
    },
  });
  const rawList = body.InvoiceDetails || body.Invoices || body.Invoice || body.Record || body.Records || (Array.isArray(body) ? body : []);
  const invList = Array.isArray(rawList) ? rawList : (rawList && typeof rawList === 'object' ? [rawList] : []);
  const invoices = invList.map((inv) => ({
    invoiceNumber: inv.InvoiceNumber != null ? String(inv.InvoiceNumber) : '',
    issueDate: inv.IssueDate || inv.CreatedDate || '',
  })).filter((inv) => inv.invoiceNumber);

  // Sort numerically (API sorts lexicographically which is unreliable for padded numbers)
  invoices.sort((a, b) => {
    const na = parseInt(a.invoiceNumber.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.invoiceNumber.replace(/\D/g, ''), 10) || 0;
    return nb - na;
  });

  let suggestedNext = '';
  if (invoices.length > 0) {
    const last = invoices[0].invoiceNumber;
    // Match purely numeric (with optional leading zeros) or numeric suffix
    const pureNum = /^(0*)(\d+)$/.exec(last);
    if (pureNum) {
      const prefix = pureNum[1]; // leading zeros
      const n = parseInt(pureNum[2], 10) + 1;
      const padded = prefix + String(n).padStart(pureNum[2].length, '0');
      // preserve original width if incrementing didn't add a digit, else let it grow naturally
      suggestedNext = n.toString().length > pureNum[2].length ? prefix.slice(0, -1) + n : padded;
    } else {
      const suffix = /(\d+)$/.exec(last);
      if (suffix) {
        const n = parseInt(suffix[1], 10) + 1;
        // preserve zero-padding width
        const padded = String(n).padStart(suffix[1].length, '0');
        suggestedNext = last.slice(0, suffix.index) + (n.toString().length > suffix[1].length ? String(n) : padded);
      } else {
        suggestedNext = last;
      }
    }
  }
  return { invoices, suggestedNext };
});

/* ─── QuickFile API: fetch clients (firms) with contact details ─── */
ipcMain.handle('quickfile-fetch-clients', async () => {
  const body = await quickFileRequest('/1_2/client/search', {
    SearchParameters: {
      ReturnCount: 200,
      Offset: 0,
      OrderResultsBy: 'CompanyName',
      OrderDirection: 'ASC',
    },
  });
  const clientList = body.Record || body.Records || body.ClientDetails || body.Clients || [];
  const records = Array.isArray(clientList) ? clientList : [clientList].filter(Boolean);
  const clients = records.map(c => {
    const pc = c.PrimaryContact || {};
    return {
      clientId: c.ClientID || c.ClientId || '',
      companyName: c.CompanyName || c.Name || '',
      contactName: [pc.FirstName || '', pc.Surname || ''].filter(Boolean).join(' '),
      email: pc.Email || '',
      telephone: pc.Telephone || '',
    };
  }).filter(c => c.companyName);
  return { clients };
});
