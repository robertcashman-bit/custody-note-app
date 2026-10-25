'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  visitTypeShowsQuickOutcome,
  mapQuickVisitOutcomeToDecision,
  resolveQuickVisitOutcomeFromDecision,
  listQuickVisitOutcomeOptions,
  listQuickVisitOutcomeOptionGroups,
  OUT_OF_COURT_DISPOSAL_DECISIONS,
} = require('../renderer/lib/attendance-visit-outcome');
const { ATTENDANCE_VISIT_TYPES } = require('../renderer/lib/attendance-visit-type');

describe('attendance-visit-outcome (bar ↔ outcomeDecision)', () => {
  it('shows quick outcome for follow-up visit types only', () => {
    assert.strictEqual(visitTypeShowsQuickOutcome(ATTENDANCE_VISIT_TYPES.first), false);
    assert.strictEqual(visitTypeShowsQuickOutcome(ATTENDANCE_VISIT_TYPES.bail_return), true);
    assert.strictEqual(visitTypeShowsQuickOutcome(ATTENDANCE_VISIT_TYPES.charge_only), true);
    assert.strictEqual(visitTypeShowsQuickOutcome(ATTENDANCE_VISIT_TYPES.identification), false);
  });

  it('maps primary quick outcomes to canonical outcomeDecision values', () => {
    assert.strictEqual(mapQuickVisitOutcomeToDecision('charged'), 'Charged without Bail');
    assert.strictEqual(mapQuickVisitOutcomeToDecision('nfa'), 'Released NFA');
    assert.strictEqual(mapQuickVisitOutcomeToDecision('re_bailed'), 'Bail without charge');
    assert.strictEqual(mapQuickVisitOutcomeToDecision('rui'), 'Released Under Investigation');
    assert.strictEqual(mapQuickVisitOutcomeToDecision('further_interview_needed'), 'Ongoing / Unknown');
  });

  it('maps each out-of-court disposal to its own outcomeDecision string', () => {
    assert.strictEqual(mapQuickVisitOutcomeToDecision('ooc_simple_caution'), 'Simple Caution');
    assert.strictEqual(mapQuickVisitOutcomeToDecision('ooc_conditional_caution'), 'Conditional Caution');
    assert.strictEqual(mapQuickVisitOutcomeToDecision('ooc_youth_caution'), 'Youth caution / Youth conditional caution');
    assert.strictEqual(mapQuickVisitOutcomeToDecision('ooc_community_resolution'), 'Community Resolution');
    assert.strictEqual(mapQuickVisitOutcomeToDecision('ooc_penalty_notice'), 'Penalty Notice (PND)');
    assert.strictEqual(mapQuickVisitOutcomeToDecision('ooc_cannabis_khat'), 'Cannabis / khat warning');
  });

  it('resolves quick code from stored outcomeDecision for bar sync', () => {
    assert.strictEqual(resolveQuickVisitOutcomeFromDecision('Charged with Bail'), 'charged');
    assert.strictEqual(resolveQuickVisitOutcomeFromDecision('Community Resolution'), 'ooc_community_resolution');
    assert.strictEqual(resolveQuickVisitOutcomeFromDecision('Cannabis / khat warning'), 'ooc_cannabis_khat');
    assert.strictEqual(resolveQuickVisitOutcomeFromDecision('Handed back to DSCC'), '');
  });

  it('groups out-of-court disposals under Out-of-court disposal', () => {
    const groups = listQuickVisitOutcomeOptionGroups();
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[1].label, 'Out-of-court disposal');
    assert.strictEqual(groups[1].options.length, OUT_OF_COURT_DISPOSAL_DECISIONS.length);
    assert.strictEqual(listQuickVisitOutcomeOptions().length, 5 + OUT_OF_COURT_DISPOSAL_DECISIONS.length);
  });

  it('custody section 8 includes every out-of-court disposal decision string', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    OUT_OF_COURT_DISPOSAL_DECISIONS.forEach(function (decision) {
      assert.ok(appJs.includes("'" + decision + "'"), 'missing custody outcome: ' + decision);
    });
  });
});
