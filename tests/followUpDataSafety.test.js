const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  appendFollowUpIdToSourceData,
  planFollowUpBackLinkSave,
  canWriteFollowUpBackLink,
} = require('../renderer/lib/follow-up-attendance');

describe('follow-up back-link data safety', () => {
  it('appendFollowUpIdToSourceData clones and preserves unrelated fields', () => {
    const src = {
      surname: 'Smith',
      clientInstructions: 'No comment',
      outcomeDecision: 'Bail without charge',
      _followUpAttendanceIds: [1],
    };
    const out = appendFollowUpIdToSourceData(src, 2);
    assert.strictEqual(out.clientInstructions, 'No comment');
    assert.deepStrictEqual(out._followUpAttendanceIds, [1, 2]);
    src.clientInstructions = 'CHANGED';
    assert.strictEqual(out.clientInstructions, 'No comment');
  });

  it('planFollowUpBackLinkSave uses fresh row only and keeps status', () => {
    const fresh = {
      status: 'finalised',
      data: {
        surname: 'Doe',
        outcomeDecision: 'Charged',
        notesToOffice: 'Important',
        _followUpAttendanceIds: [],
      },
    };
    const staleSnapshot = { outcomeDecision: 'Bail without charge' };
    const plan = planFollowUpBackLinkSave(fresh, 99);
    assert.strictEqual(plan.write, true);
    assert.strictEqual(plan.status, 'finalised');
    assert.strictEqual(plan.data.notesToOffice, 'Important');
    assert.strictEqual(plan.data.outcomeDecision, 'Charged');
    assert.notStrictEqual(plan.data.outcomeDecision, staleSnapshot.outcomeDecision);
    assert.deepStrictEqual(plan.data._followUpAttendanceIds, [99]);
  });

  it('skips back-link write for unsupported statuses', () => {
    assert.strictEqual(canWriteFollowUpBackLink('draft'), true);
    assert.strictEqual(canWriteFollowUpBackLink('finalised'), true);
    assert.strictEqual(canWriteFollowUpBackLink('completed'), true);
    assert.strictEqual(canWriteFollowUpBackLink('archived'), false);
    const plan = planFollowUpBackLinkSave({ status: 'archived', data: {} }, 1);
    assert.strictEqual(plan.write, false);
  });
});

describe('follow-up Bugbot fixes (source)', () => {
  const root = path.join(__dirname, '..');
  const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const listJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'list.js'), 'utf8');
  const followUpJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'follow-up.js'), 'utf8');

  it('exposes flush before external read for open record', () => {
    assert.match(appJs, /window\.flushOpenRecordAutosaveBeforeExternalRead/);
    assert.match(followUpJs, /flushSourceIfOpenOnForm/);
    assert.match(followUpJs, /planFollowUpBackLinkSave/);
    assert.match(followUpJs, /writeFollowUpBackLink/);
  });

  it('list.js does not override app.js openAttendance', () => {
    assert.doesNotMatch(listJs, /function openAttendance\s*\(/);
  });

  it('guards follow-up links bar against stale async renders', () => {
    assert.match(appJs, /_followUpLinksBarRequest/);
    assert.match(appJs, /recordIdAtStart !== currentAttendanceId/);
  });

  it('openAttendance honours standalone section options in app.js', () => {
    assert.match(appJs, /openOpts\.standaloneSectionId/);
    assert.match(followUpJs, /videoIdParadeStandalone/);
  });
});
