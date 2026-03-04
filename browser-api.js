/*  browser-api.js
    ────────────────────────────────────────────────────────────
    Drop-in replacement for Electron's preload.js + main.js.
    Provides the same window.api.* surface using sql.js (WASM)
    running entirely in the browser, with IndexedDB persistence.
    If window.api already exists (Electron preload), this file
    is a no-op so both environments can share the same codebase.
    ──────────────────────────────────────────────────────────── */
(async function () {
  'use strict';

  /* Skip if running inside Electron (preload already set window.api) */
  if (window.api) return;

  /* ─── IndexedDB helpers ─── */
  const IDB_NAME = 'ps-attendance-db';
  const IDB_STORE = 'kv';

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const idb = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(key, value) {
    const idb = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ─── Load sql.js WASM (dynamically so Electron app never blocks on this when offline) ─── */
  if (typeof initSqlJs === 'undefined') {
    await new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://sql.js.org/dist/sql-wasm.js';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Failed to load sql.js')); };
      document.head.appendChild(s);
    });
  }
  const SQL = await initSqlJs({
    locateFile: function (file) { return 'https://sql.js.org/dist/' + file; }
  });

  /* ─── Restore or create database ─── */
  let db;
  const savedBuf = await idbGet('sqlite-db');
  if (savedBuf) {
    db = new SQL.Database(new Uint8Array(savedBuf));
  } else {
    db = new SQL.Database();
  }

  /* ─── Persist helper (called after every write) ─── */
  function persist() {
    const data = db.export();
    idbPut('sqlite-db', data.buffer).catch(function (e) {
      console.error('IndexedDB persist failed:', e);
    });
  }

  /* ─── DB utility wrappers (mirror main.js) ─── */
  function dbGet(sql, params) {
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  }

  function dbAll(sql, params) {
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function dbRun(sql, params) {
    db.run(sql, params);
    persist();
  }

  /* ─── Schema creation (identical to main.js initDb) ─── */
  db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);');

  db.run([
    'CREATE TABLE IF NOT EXISTS attendances (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    "  created_at TEXT DEFAULT (datetime('now')),",
    "  updated_at TEXT DEFAULT (datetime('now')),",
    '  data TEXT NOT NULL,',
    "  status TEXT DEFAULT 'draft'",
    ');'
  ].join('\n'));

  db.run([
    'CREATE TABLE IF NOT EXISTS police_stations (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  name TEXT NOT NULL,',
    '  code TEXT NOT NULL,',
    "  scheme TEXT DEFAULT '',",
    "  region TEXT DEFAULT '',",
    '  UNIQUE(name, code)',
    ');'
  ].join('\n'));

  try { db.run("ALTER TABLE police_stations ADD COLUMN scheme TEXT DEFAULT ''"); } catch (_) {}
  try { db.run("ALTER TABLE police_stations ADD COLUMN region TEXT DEFAULT ''"); } catch (_) {}

  db.run([
    'CREATE TABLE IF NOT EXISTS firms (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  name TEXT NOT NULL,',
    "  laa_account TEXT DEFAULT '',",
    "  contact_name TEXT DEFAULT '',",
    "  contact_email TEXT DEFAULT '',",
    "  contact_phone TEXT DEFAULT '',",
    "  address TEXT DEFAULT '',",
    '  is_default INTEGER DEFAULT 0,',
    '  UNIQUE(name)',
    ');'
  ].join('\n'));
  try { db.run("ALTER TABLE firms ADD COLUMN contact_name TEXT DEFAULT ''"); } catch (_) {}

  db.run('CREATE INDEX IF NOT EXISTS idx_attendances_updated ON attendances(updated_at);');

  /* ─── Load police stations from JSON if table is empty ─── */
  var stationCount = dbGet('SELECT COUNT(*) as c FROM police_stations');
  if (!stationCount || stationCount.c === 0) {
    try {
      var resp = await fetch('data/police-stations-laa.json');
      var stationsJson = await resp.json();
      for (var i = 0; i < stationsJson.length; i++) {
        var s = stationsJson[i];
        try {
          db.run(
            'INSERT OR IGNORE INTO police_stations (name, code, scheme, region) VALUES (?, ?, ?, ?)',
            [s.name || '', s.code || '', s.scheme || '', s.region || '']
          );
        } catch (_) {}
      }
      persist();
    } catch (e) {
      console.warn('Could not load stations JSON:', e);
    }
  }

  /* ─── Cached reference data ─── */
  var _refDataCache = null;

  /* ─── File download helper (replaces fs.writeFileSync) ─── */
  function downloadFile(content, filename, mimeType) {
    var blob = new Blob([content], { type: mimeType || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  /* ═══════════════════════════════════════════════════════
     window.api — same surface as preload.js
     ═══════════════════════════════════════════════════════ */
  window.api = {

    /* ── Settings ── */
    getSettings: function () {
      var rows = dbAll('SELECT key, value FROM settings');
      var obj = {};
      for (var i = 0; i < rows.length; i++) obj[rows[i].key] = rows[i].value;
      return Promise.resolve(obj);
    },

    setSettings: function (settings) {
      var keys = Object.keys(settings);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = settings[k] == null ? '' : String(settings[k]);
        dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, v]);
      }
      return Promise.resolve(true);
    },

    /* ── Attendances ── */
    attendanceList: function () {
      return Promise.resolve(
        dbAll('SELECT id, created_at, updated_at, data, status FROM attendances ORDER BY updated_at DESC')
      );
    },

    attendanceGet: function (id) {
      return Promise.resolve(
        dbGet('SELECT id, data, status FROM attendances WHERE id = ?', [id]) || null
      );
    },

    attendanceSave: function (payload) {
      var id = payload.id;
      var data = payload.data;
      var status = payload.status || 'draft';
      var now = new Date().toISOString();
      var dataStr = JSON.stringify(data);
      if (id) {
        dbRun('UPDATE attendances SET data = ?, status = ?, updated_at = ? WHERE id = ?', [dataStr, status, now, id]);
        return Promise.resolve(id);
      }
      dbRun('INSERT INTO attendances (data, status, updated_at) VALUES (?, ?, ?)', [dataStr, status, now]);
      var r = dbGet('SELECT last_insert_rowid() as id');
      return Promise.resolve(r ? r.id : null);
    },

    attendanceDelete: function (id) {
      dbRun('DELETE FROM attendances WHERE id = ?', [id]);
      return Promise.resolve(true);
    },

    /* ── Stations ── */
    stationsList: function () {
      return Promise.resolve(
        dbAll('SELECT id, name, code, scheme, region FROM police_stations ORDER BY region, name')
      );
    },

    stationsReplace: function (stations) {
      db.run('DELETE FROM police_stations');
      for (var i = 0; i < stations.length; i++) {
        var s = stations[i];
        db.run('INSERT INTO police_stations (name, code, scheme, region) VALUES (?, ?, ?, ?)',
          [s.name || '', s.code || '', s.scheme || '', s.region || '']);
      }
      persist();
      return Promise.resolve(true);
    },

    /* ── Firms ── */
    firmsList: function () {
      return Promise.resolve(
        dbAll('SELECT id, name, laa_account, contact_name, contact_email, contact_phone, address, is_default FROM firms ORDER BY is_default DESC, name')
      );
    },

    firmSave: function (firm) {
      if (firm.id) {
        dbRun('UPDATE firms SET name=?, laa_account=?, contact_name=?, contact_email=?, contact_phone=?, address=?, is_default=? WHERE id=?',
          [firm.name, firm.laa_account || '', firm.contact_name || '', firm.contact_email || '', firm.contact_phone || '', firm.address || '', firm.is_default ? 1 : 0, firm.id]);
        return Promise.resolve(firm.id);
      }
      dbRun('INSERT OR REPLACE INTO firms (name, laa_account, contact_name, contact_email, contact_phone, address, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [firm.name, firm.laa_account || '', firm.contact_name || '', firm.contact_email || '', firm.contact_phone || '', firm.address || '', firm.is_default ? 1 : 0]);
      var r = dbGet('SELECT last_insert_rowid() as id');
      return Promise.resolve(r ? r.id : null);
    },

    firmDelete: function (id) {
      dbRun('DELETE FROM firms WHERE id = ?', [id]);
      return Promise.resolve(true);
    },

    firmSetDefault: function (id) {
      db.run('UPDATE firms SET is_default = 0');
      dbRun('UPDATE firms SET is_default = 1 WHERE id = ?', [id]);
      return Promise.resolve(true);
    },

    /* ── UFN Generation ── */
    generateUfn: function (dateStr) {
      var d = dateStr ? new Date(dateStr) : new Date();
      var dd = String(d.getDate()).padStart(2, '0');
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var yy = String(d.getFullYear()).slice(-2);
      var datePrefix = dd + mm + yy;
      var count = dbGet(
        "SELECT COUNT(*) as c FROM attendances WHERE data LIKE ?",
        ['%"ufn":"' + datePrefix + '/%']
      );
      var seq = ((count && count.c) || 0) + 1;
      return Promise.resolve(datePrefix + '/' + String(seq).padStart(3, '0'));
    },

    /* ── Reference Data ── */
    loadReferenceData: async function () {
      if (_refDataCache) return _refDataCache;
      try {
        var resp = await fetch('data/laa-reference-data.json');
        _refDataCache = await resp.json();
        return _refDataCache;
      } catch (e) {
        console.warn('Could not load reference data:', e);
        return null;
      }
    },

    /* ── CSV Export (download as file) ── */
    saveCsv: function (payload) {
      var filename = payload.filename || 'attendances-export.csv';
      downloadFile(payload.csv, filename, 'text/csv;charset=utf-8;');
      return Promise.resolve(filename);
    },

    /* ── Backup (download SQLite binary) ── */
    backupNow: function () {
      var data = db.export();
      var name = 'attendance-backup-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.db';
      downloadFile(data, name, 'application/x-sqlite3');
      return Promise.resolve(name);
    },

    /* ── Desktop path (not applicable in browser) ── */
    getDesktopPath: function () {
      return Promise.resolve('Downloads');
    },

    /* ── Choose folder (not available in browser — no-op) ── */
    chooseFolder: function () {
      alert('In the web version, backups are downloaded to your Downloads folder.\nUse the "Backup now" button to download a copy of your database.');
      return Promise.resolve(null);
    },

    /* ── Open external link ── */
    openExternal: function (url) {
      if (typeof url !== 'string') return Promise.resolve();
      var u = url.trim();
      if (u.startsWith('https://') || u.startsWith('mailto:')) {
        window.open(u, '_blank', 'noopener');
      }
      return Promise.resolve();
    },

    /* ── PDF export (open in new tab for printing) ── */
    printToPdf: function (options) {
      var html = options.html;
      var filename = options.filename || 'attendance.pdf';
      var win = window.open('', '_blank');
      if (!win) {
        alert('Please allow pop-ups for this site to export PDFs.');
        return Promise.reject(new Error('Popup blocked'));
      }
      win.document.write(html);
      win.document.close();
      win.onload = function () {
        setTimeout(function () {
          win.print();
        }, 300);
      };
      /* Also trigger print after a fallback delay */
      setTimeout(function () {
        try { win.print(); } catch (_) {}
      }, 1000);
      return Promise.resolve('Opened for printing as: ' + filename);
    },
  };

  console.log('[browser-api] Initialised — sql.js in-browser with IndexedDB persistence');
})();
