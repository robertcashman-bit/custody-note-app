const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isBridgePayload,
  buildBridgeFromAnywhereBackup,
  buildBridgeFromDesktopRows,
  normaliseToBridgePayload,
  validateBridgePayload,
  mapBridgeAttendanceToDesktop,
  safeJsonParse,
  BRIDGE_FORMAT,
  MAX_BRIDGE_ATTENDANCES,
} = require('../main/anywhereBridge');

describe('anywhereBridge', () => {
  it('builds bridge from Anywhere backup', () => {
    const bridge = buildBridgeFromAnywhereBackup({
      app: 'custodynote-anywhere',
      attendances: [
        {
          id: 'abc',
          attendanceMode: 'custody',
          status: 'draft',
          data: { forename: 'Jo', surname: 'Bloggs' },
        },
      ],
    });
    assert.equal(bridge.format, BRIDGE_FORMAT);
    assert.equal(bridge.version, 1);
    assert.equal(isBridgePayload(bridge), true);
    assert.equal(bridge.attendances[0].anywhereId, 'abc');
  });

  it('maps to desktop draft shape', () => {
    const mapped = mapBridgeAttendanceToDesktop({
      anywhereId: 'x1',
      attendanceMode: 'telephone',
      status: 'completed',
      data: { forename: 'A' },
    });
    assert.equal(mapped.status, 'draft');
    assert.equal(mapped.data._formType, 'telephone');
    assert.equal(mapped.data._importedFromAnywhereId, 'x1');
    assert.equal(mapped.anywhereId, 'x1');
  });

  it('maps voluntary mode onto attendanceMode', () => {
    const mapped = mapBridgeAttendanceToDesktop({
      anywhereId: 'v1',
      attendanceMode: 'voluntary',
      status: 'draft',
      data: {},
    });
    assert.equal(mapped.data.attendanceMode, 'voluntary');
    assert.equal(mapped.data._formType, 'attendance');
  });

  it('rejects unrelated JSON', () => {
    assert.equal(isBridgePayload({ format: 'other', version: 1, attendances: [] }), false);
  });

  it('normalises raw attendances arrays', () => {
    const bridge = normaliseToBridgePayload([{ id: 'z', data: { forename: 'Z' } }]);
    assert.equal(isBridgePayload(bridge), true);
    assert.equal(bridge.attendances[0].anywhereId, 'z');
  });

  it('validateBridgePayload rejects empty and oversized lists', () => {
    assert.equal(validateBridgePayload({ format: BRIDGE_FORMAT, version: 1, attendances: [] }).ok, false);
    const tooMany = {
      format: BRIDGE_FORMAT,
      version: 1,
      attendances: Array.from({ length: MAX_BRIDGE_ATTENDANCES + 1 }, (_, i) => ({
        anywhereId: String(i),
        data: {},
      })),
    };
    assert.equal(validateBridgePayload(tooMany).ok, false);
    assert.equal(
      validateBridgePayload({
        format: BRIDGE_FORMAT,
        version: 1,
        attendances: [{ anywhereId: '1', data: {} }],
      }).ok,
      true
    );
  });

  it('safeJsonParse rejects huge or invalid JSON', () => {
    assert.equal(safeJsonParse('{').ok, false);
    assert.equal(safeJsonParse('{"a":1}').ok, true);
    assert.equal(safeJsonParse(null).ok, false);
  });

  it('buildBridgeFromDesktopRows round-trips for Anywhere', () => {
    const bridge = buildBridgeFromDesktopRows([
      {
        id: 9,
        sync_id: 'sid-9',
        status: 'finalised',
        updated_at: '2026-08-01T00:00:00.000Z',
        data: JSON.stringify({
          forename: 'Pat',
          surname: 'Lee',
          attendanceMode: 'voluntary',
          _importedFromAnywhereId: 'aw-9',
        }),
      },
    ]);
    assert.equal(isBridgePayload(bridge), true);
    assert.equal(bridge.sourceApp, 'custody-note-desktop');
    assert.equal(bridge.attendances[0].anywhereId, 'aw-9');
    assert.equal(bridge.attendances[0].attendanceMode, 'voluntary');
    assert.equal(bridge.attendances[0].status, 'completed');
    const mappedBack = mapBridgeAttendanceToDesktop(bridge.attendances[0]);
    assert.equal(mappedBack.status, 'draft');
    assert.equal(mappedBack.data.forename, 'Pat');
  });

  it('rejects oversized record data on map', () => {
    const huge = { note: 'x'.repeat(2 * 1024 * 1024 + 10) };
    assert.throws(
      () =>
        mapBridgeAttendanceToDesktop({
          anywhereId: 'big',
          attendanceMode: 'custody',
          status: 'draft',
          data: huge,
        }),
      /too large/i
    );
  });

  it('normalises Anywhere backup using updated_at and anywhereId fields', () => {
    const bridge = normaliseToBridgePayload({
      app: 'custodynote-anywhere',
      attendances: [
        {
          anywhereId: 'legacy-id',
          updated_at: '2026-01-02T03:04:05.000Z',
          data: { forename: 'Sam' },
        },
      ],
    });
    assert.equal(bridge.attendances[0].anywhereId, 'legacy-id');
    assert.equal(bridge.attendances[0].updatedAt, '2026-01-02T03:04:05.000Z');
  });

  it('export prefers sync_id when no prior Anywhere id', () => {
    const bridge = buildBridgeFromDesktopRows([
      { id: 3, sync_id: 'sync-abc', status: 'draft', data: { forename: 'X' } },
    ]);
    assert.equal(bridge.attendances[0].anywhereId, 'sync-abc');
  });
});
