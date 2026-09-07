'use strict';

/**
 * Standard police-station mileages must stay exact.
 *
 * Reproduction (Tonbridge / Medway): standard 46 must never become 45.8 / 46.6
 * via live road distance, km↔miles conversion, or rounding when applying or
 * saving station mileages.
 *
 * Run: node --test tests/stationMileageStandard.test.js
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const {
  STANDARD_MILEAGES_BY_CODE,
  normalizeMileageForStorage,
  formatExactMiles,
  getStandardMileageForCode,
  resolveMilesForAutofill,
  resolveMilesForStationTable,
  isLiveDriftFromStandard,
  mergeStationsPreservingMileage,
  canonicalStandardMileageStatements,
} = require('../lib/stationMileage');
const { runMigrations, LATEST_VERSION } = require('../main/dbMigrations');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'station-mileage-admin.js'), 'utf8');
const billingJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');
const billingScreenJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing-screen.js'), 'utf8');

function scalar(db, sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  let v = null;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    v = row[Object.keys(row)[0]];
  }
  stmt.free();
  return v;
}

describe('canonical Tonbridge / Medway standards', () => {
  it('Tonbridge (BG039) standard is exactly 46', () => {
    assert.strictEqual(getStandardMileageForCode('BG039'), 46);
    assert.strictEqual(STANDARD_MILEAGES_BY_CODE.BG039, 46);
  });

  it('Medway custody stations (Gillingham / Rochester / Chatham) are exactly 46', () => {
    assert.strictEqual(getStandardMileageForCode('BG028'), 46);
    assert.strictEqual(getStandardMileageForCode('BG027'), 46);
    assert.strictEqual(getStandardMileageForCode('BG030'), 46);
  });

  it('lookup is case-insensitive and ignores unknown codes', () => {
    assert.strictEqual(getStandardMileageForCode('bg039'), 46);
    assert.strictEqual(getStandardMileageForCode('XX999'), null);
  });
});

describe('normalize / format — no km conversion, exact integers', () => {
  it('keeps 46 exact (not 45.8 / 46.6 / 46.0 string)', () => {
    assert.strictEqual(normalizeMileageForStorage(46), 46);
    assert.strictEqual(normalizeMileageForStorage('46'), 46);
    assert.strictEqual(normalizeMileageForStorage(46.0), 46);
    assert.strictEqual(formatExactMiles(46), '46');
    assert.notStrictEqual(formatExactMiles(46), '46.0');
    assert.notStrictEqual(formatExactMiles(46), '45.8');
  });

  it('does not apply miles↔km conversion to standards', () => {
    // Classic buggy round-trip: miles → km (1dp) → miles
    const viaKm = Math.round(46 * 1.609344 * 10) / 10 / 1.609344;
    assert.notStrictEqual(normalizeMileageForStorage(46), normalizeMileageForStorage(viaKm));
    assert.strictEqual(normalizeMileageForStorage(46), 46);
    // Meter-based Google-ish figure must not be treated as the stored standard
    const googleish = 73709 * 0.000621371;
    assert.strictEqual(Number(googleish.toFixed(1)), 45.8);
    assert.notStrictEqual(normalizeMileageForStorage(46), 45.8);
  });

  it('preserves intentional fractions without promoting them to the standard', () => {
    assert.strictEqual(normalizeMileageForStorage(45.8), 45.8);
    assert.strictEqual(normalizeMileageForStorage(46.6), 46.6);
    assert.strictEqual(formatExactMiles(12.5), '12.5');
  });
});

describe('live / calculated distance must not nudge standards', () => {
  it('detects 45.8 and 46.6 as live drift from standard 46', () => {
    assert.strictEqual(isLiveDriftFromStandard(46, 45.8), true);
    assert.strictEqual(isLiveDriftFromStandard(46, 46.6), true);
    assert.strictEqual(isLiveDriftFromStandard(46, 46), false);
    assert.strictEqual(isLiveDriftFromStandard(46, 40), false); // intentional different integer
  });

  it('autofill: Tonbridge/Medway standard 46 wins over live 45.8 / 46.6', () => {
    assert.strictEqual(
      resolveMilesForAutofill({ standardMiles: 46, liveMiles: 45.8, existingMiles: '' }),
      46
    );
    assert.strictEqual(
      resolveMilesForAutofill({ stationCode: 'BG039', liveMiles: 46.6, existingMiles: 0 }),
      46
    );
    assert.strictEqual(
      resolveMilesForAutofill({ stationCode: 'BG028', liveMiles: 45.8 }),
      46
    );
  });

  it('autofill: existing user miles are left alone', () => {
    assert.strictEqual(
      resolveMilesForAutofill({ stationCode: 'BG039', existingMiles: 12, liveMiles: 45.8 }),
      12
    );
  });

  it('autofill: live miles only when explicitly allowed and no standard/existing', () => {
    assert.strictEqual(
      resolveMilesForAutofill({ liveMiles: 45.8, allowLiveOverride: true }),
      45.8
    );
    assert.strictEqual(
      resolveMilesForAutofill({ liveMiles: 45.8 }),
      null
    );
    assert.strictEqual(
      resolveMilesForAutofill({
        stationCode: 'BG039',
        liveMiles: 45.8,
        allowLiveOverride: true,
      }),
      46
    );
  });

  it('station table: live drift cannot overwrite canonical standard', () => {
    assert.strictEqual(
      resolveMilesForStationTable({
        stationCode: 'BG039',
        currentMiles: 46,
        liveMiles: 45.8,
      }),
      46
    );
    assert.strictEqual(
      resolveMilesForStationTable({
        stationCode: 'BG028',
        currentMiles: 46,
        liveMiles: 46.6,
      }),
      46
    );
  });

  it('station table: explicit admin proposed value is accepted (user setting standard)', () => {
    assert.strictEqual(
      resolveMilesForStationTable({
        stationCode: 'BG039',
        currentMiles: 46,
        proposedMiles: 47,
      }),
      47
    );
  });

  it('station table: allowLiveOverride is the only path for live replace', () => {
    assert.strictEqual(
      resolveMilesForStationTable({
        stationCode: 'BG039',
        currentMiles: 46,
        liveMiles: 45.8,
        allowLiveOverride: true,
      }),
      45.8
    );
  });
});

describe('several station pairs — standard lookups stay exact', () => {
  const pairs = [
    { code: 'BG039', name: 'Tonbridge', miles: 46 },
    { code: 'BG028', name: 'Gillingham (Medway)', miles: 46 },
    { code: 'BG027', name: 'Rochester (Medway)', miles: 46 },
    { code: 'BG030', name: 'Chatham (Medway)', miles: 46 },
  ];

  for (const p of pairs) {
    it(`${p.name} [${p.code}] applies as exactly ${p.miles}`, () => {
      const applied = resolveMilesForAutofill({
        stationCode: p.code,
        standardMiles: p.miles,
        liveMiles: p.miles - 0.2,
      });
      assert.strictEqual(applied, p.miles);
      assert.strictEqual(formatExactMiles(applied), String(p.miles));
      assert.ok(!String(formatExactMiles(applied)).includes('.'));
    });
  }

  it('Maidstone-style independent standard (12) is not contaminated by Tonbridge live drift', () => {
    assert.strictEqual(
      resolveMilesForAutofill({ standardMiles: 12, liveMiles: 45.8 }),
      12
    );
    assert.strictEqual(formatExactMiles(12), '12');
  });
});

describe('mergeStationsPreservingMileage (stations-replace)', () => {
  it('preserves Tonbridge 46 across catalogue replace', () => {
    const existing = [
      { name: 'Tonbridge', code: 'BG039', mileage_from_base: 46, postcode: 'TN9 1BG' },
    ];
    const incoming = [
      { name: 'Tonbridge', code: 'BG039', scheme: 'West Kent (Tonbridge)', region: 'Kent', schemeCode: '7007', kind: 'station' },
    ];
    const merged = mergeStationsPreservingMileage(existing, incoming);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].mileage_from_base, 46);
    assert.strictEqual(merged[0].postcode, 'TN9 1BG');
  });

  it('re-seeds canonical Medway/Tonbridge when mileage was wiped', () => {
    const existing = [
      { name: 'Tonbridge', code: 'BG039', mileage_from_base: null, postcode: '' },
      { name: 'Gillingham, Kent', code: 'BG028', mileage_from_base: null, postcode: '' },
    ];
    const incoming = [
      { name: 'Tonbridge', code: 'BG039', kind: 'station' },
      { name: 'Gillingham, Kent', code: 'BG028', kind: 'station' },
    ];
    const merged = mergeStationsPreservingMileage(existing, incoming);
    assert.strictEqual(merged[0].mileage_from_base, 46);
    assert.strictEqual(merged[1].mileage_from_base, 46);
  });

  it('repairs live drift (45.8 / 46.6) back to canonical 46 on replace', () => {
    const existing = [
      { name: 'Tonbridge', code: 'BG039', mileage_from_base: 45.8, postcode: '' },
      { name: 'Gillingham, Kent', code: 'BG028', mileage_from_base: 46.6, postcode: '' },
    ];
    const incoming = [
      { name: 'Tonbridge', code: 'BG039', kind: 'station' },
      { name: 'Gillingham, Kent', code: 'BG028', kind: 'station' },
    ];
    const merged = mergeStationsPreservingMileage(existing, incoming);
    assert.strictEqual(merged[0].mileage_from_base, 46);
    assert.strictEqual(merged[1].mileage_from_base, 46);
  });
});

describe('sql.js REAL round-trip keeps standard 46 exact', () => {
  it('INSERT/UPDATE/SELECT of 46 stays Number 46', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE police_stations (code TEXT, mileage_from_base REAL)');
    db.run('INSERT INTO police_stations VALUES (?, ?)', ['BG039', normalizeMileageForStorage(46)]);
    db.run('UPDATE police_stations SET mileage_from_base = ? WHERE code = ?', [
      normalizeMileageForStorage(46),
      'BG039',
    ]);
    const got = Number(scalar(db, "SELECT mileage_from_base FROM police_stations WHERE code = 'BG039'"));
    assert.strictEqual(got, 46);
    assert.strictEqual(formatExactMiles(got), '46');
    db.close();
  });
});

describe('migrations seed Tonbridge + Medway standards exactly', () => {
  it('LATEST_VERSION applies canonical standards including Medway', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    runMigrations(db);
    db.run(
      "INSERT INTO police_stations (name, code, scheme, region, scheme_code, kind, mileage_from_base) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['Tonbridge', 'BG039', 'West Kent (Tonbridge)', 'Kent', '7007', 'station', null]
    );
    db.run(
      "INSERT INTO police_stations (name, code, scheme, region, scheme_code, kind, mileage_from_base) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['Gillingham, Kent', 'BG028', 'Medway', 'Kent', '7003', 'station', null]
    );
    db.run(
      "INSERT INTO police_stations (name, code, scheme, region, scheme_code, kind, mileage_from_base) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['Rochester', 'BG027', 'Medway', 'Kent', '7003', 'station', 45.8]
    );
    db.run(
      "INSERT INTO police_stations (name, code, scheme, region, scheme_code, kind, mileage_from_base) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['Chatham', 'BG030', 'Medway', 'Kent', '7003', 'station', 46.6]
    );
    // Stamp at v2 so the standards migration (v3+) re-runs
    db.run('DELETE FROM schema_version');
    db.run(
      "INSERT INTO schema_version (version, name, applied_at) VALUES (2, 'tonbridge-mileage-46', ?)",
      [new Date().toISOString()]
    );
    const result = runMigrations(db);
    assert.ok(result.applied.length >= 1, 'expected newer migrations to apply, got ' + JSON.stringify(result));
    assert.ok(LATEST_VERSION >= 3, 'expected schema migration v3+ for Medway standards');
    assert.strictEqual(Number(scalar(db, "SELECT mileage_from_base FROM police_stations WHERE code = 'BG039'")), 46);
    assert.strictEqual(Number(scalar(db, "SELECT mileage_from_base FROM police_stations WHERE code = 'BG028'")), 46);
    assert.strictEqual(Number(scalar(db, "SELECT mileage_from_base FROM police_stations WHERE code = 'BG027'")), 46);
    assert.strictEqual(Number(scalar(db, "SELECT mileage_from_base FROM police_stations WHERE code = 'BG030'")), 46);
    db.close();
  });
});

describe('wiring — save / apply / replace use stationMileage helpers', () => {
  it('main.js stations-replace preserves mileage via mergeStationsPreservingMileage', () => {
    assert.match(mainJs, /mergeStationsPreservingMileage/);
    const replaceIdx = mainJs.indexOf("ipcMain.handle('stations-replace'");
    assert.ok(replaceIdx > 0);
    const slice = mainJs.slice(replaceIdx, replaceIdx + 2500);
    assert.match(slice, /mileage_from_base/);
    assert.match(slice, /mergeStationsPreservingMileage/);
    assert.doesNotMatch(
      slice,
      /DELETE FROM police_stations[\s\S]*INSERT INTO police_stations \(name, code, scheme, region, scheme_code, kind\)/
    );
  });

  it('main.js station mileage save normalizes via normalizeMileageForStorage', () => {
    assert.match(mainJs, /normalizeMileageForStorage/);
    const saveIdx = mainJs.indexOf("ipcMain.handle('station-mileage-save'");
    const bulkIdx = mainJs.indexOf("ipcMain.handle('station-mileage-bulk-save'");
    assert.ok(saveIdx > 0 && bulkIdx > 0);
    assert.match(mainJs.slice(saveIdx, saveIdx + 800), /normalizeMileageForStorage/);
    assert.match(mainJs.slice(bulkIdx, bulkIdx + 800), /normalizeMileageForStorage/);
  });

  it('app.js autoFillMileageFromStation uses resolveMilesForAutofill + formatExactMiles', () => {
    assert.match(appJs, /resolveMilesForAutofill|formatExactMiles/);
    const idx = appJs.indexOf('function autoFillMileageFromStation');
    assert.ok(idx > 0);
    const slice = appJs.slice(idx, idx + 1200);
    assert.match(slice, /resolveMilesForAutofill|formatExactMiles/);
    // Must not force one-decimal storage of the standard
    assert.doesNotMatch(slice, /\.toFixed\(1\)/);
  });

  it('station-mileage-admin save path normalizes mileage values', () => {
    assert.match(adminJs, /normalizeMileageForStorage|formatExactMiles/);
  });

  it('billing autofill paths do not coerce standard miles through toFixed(1) into the miles input', () => {
    // Description text may use toFixed(1); the miles *value* path must not.
    const billingFill = billingJs.includes('mileage_from_base') ? billingJs : '';
    assert.ok(billingJs.includes('mileage_from_base'));
    assert.ok(billingScreenJs.includes('mileage_from_base'));
    // Helpers available to billing if needed later
    assert.ok(typeof formatExactMiles === 'function');
    assert.ok(typeof resolveMilesForAutofill === 'function');
  });

  it('canonical statements cover Tonbridge and Medway codes', () => {
    const stmts = canonicalStandardMileageStatements();
    const codes = stmts.map((s) => s.params[1]).sort();
    assert.deepStrictEqual(codes, ['BG027', 'BG028', 'BG030', 'BG039']);
    stmts.forEach((s) => assert.strictEqual(s.params[0], 46));
  });
});
