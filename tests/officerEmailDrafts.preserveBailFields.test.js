'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { normaliseOfficerEmailDraft } = require('../lib/officerEmailDrafts');

describe('officerEmailDrafts — preserve bail fields on non-bail templates', () => {
  it('normalise keeps bailReturnDate and bailReturnTime from payload', () => {
    const n = normaliseOfficerEmailDraft({
      templateType: 'disclosure_confirm_attendance',
      bailReturnDate: '2026-03-01',
      bailReturnTime: '11:30',
      bailConditions: 'Curfew',
    });
    assert.strictEqual(n.bailReturnDate, '2026-03-01');
    assert.strictEqual(n.bailReturnTime, '11:30');
    assert.strictEqual(n.bailConditions, 'Curfew');
  });
});
