'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  validateOfficerEmailDraft,
  canTransitionStatus,
  isLikelyEmailAddress,
  isLikelyProfessionalEmail,
} = require('../lib/officerEmailDrafts');

describe('officerEmailDrafts — validation', () => {
  it('create requires custodyNoteId', () => {
    const v = validateOfficerEmailDraft({ templateType: 'chase_disclosure' }, { mode: 'create' });
    assert.strictEqual(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes('custodyNoteId')));
  });

  it('create passes minimal payload', () => {
    const v = validateOfficerEmailDraft(
      { custodyNoteId: '12', templateType: 'chase_disclosure', toEmail: 'a@x.police.uk' },
      { mode: 'create' }
    );
    assert.strictEqual(v.ok, true);
  });

  it('rejects unknown template', () => {
    const v = validateOfficerEmailDraft({ custodyNoteId: '1', templateType: 'nope' }, { mode: 'create' });
    assert.strictEqual(v.ok, false);
  });

  it('canTransitionStatus matches policy', () => {
    assert.strictEqual(canTransitionStatus('draft', 'opened_in_outlook'), true);
    assert.strictEqual(canTransitionStatus('draft', 'sent_manually'), false);
    assert.strictEqual(canTransitionStatus('opened_in_outlook', 'sent_manually'), true);
  });

  it('isLikelyEmailAddress basic check', () => {
    assert.strictEqual(isLikelyEmailAddress('a@b.co'), true);
    assert.strictEqual(isLikelyEmailAddress('not-an-email'), false);
  });

  it('isLikelyProfessionalEmail allowlists gov/police', () => {
    assert.strictEqual(isLikelyProfessionalEmail('o@met.police.uk'), true);
    assert.strictEqual(isLikelyProfessionalEmail('x@example.com'), false);
  });
});
