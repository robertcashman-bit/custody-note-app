const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildLocalSummaryDraft, requestProAiDraft } = require('../main/proAiSummary');

describe('proAiSummary', () => {
  it('builds a local attendance draft without network', () => {
    const draft = buildLocalSummaryDraft(
      { forename: 'Sam', surname: 'Lee', policeStationName: 'Central' },
      'attendance',
    );
    assert.match(draft, /Attendance summary draft/);
    assert.match(draft, /Sam Lee/);
    assert.match(draft, /Central/);
    assert.match(draft, /not sent to any provider/);
  });

  it('denies free tier', async () => {
    const res = await requestProAiDraft({
      formData: { forename: 'A' },
      kind: 'attendance',
      licenceStatus: { tier: 'free', status: 'active' },
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'PRO_AI_NOT_ENTITLED');
  });

  it('returns local draft for Pro without cloud', async () => {
    const res = await requestProAiDraft({
      formData: { forename: 'A', surname: 'B', interviewNotes: 'nc' },
      kind: 'interview',
      licenceStatus: { tier: 'pro', status: 'active' },
      useCloud: false,
    });
    assert.equal(res.ok, true);
    assert.equal(res.mode, 'local');
    assert.match(res.draft, /Interview summary draft/);
  });

  it('falls back to local when cloud requested but no fetcher', async () => {
    const res = await requestProAiDraft({
      formData: { forename: 'A' },
      kind: 'attendance',
      licenceStatus: { tier: 'pro', status: 'active' },
      useCloud: true,
      cloudFetcher: null,
    });
    assert.equal(res.ok, true);
    assert.equal(res.mode, 'local');
    assert.equal(res.cloudSkipped, true);
  });
});
