'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createStatsNetPost } = require('../main/statsNetPost');

describe('createStatsNetPost', () => {
  const isAllowedApiUrl = (url) => String(url).includes('custodynote.com');

  it('POSTs JSON via net.fetch and accepts 204 empty body', async () => {
    let captured = null;
    const post = createStatsNetPost({
      isAllowedApiUrl,
      net: {
        fetch: async (url, init) => {
          captured = { url, init };
          return { status: 204, text: async () => '' };
        },
      },
    });
    const body = {
      machineId: 'd'.repeat(32),
      platform: 'win32',
      appVersion: '1.9.107',
      tier: 'free',
    };
    const result = await post('https://custodynote.com/api/stats/heartbeat', body, { timeout: 5000 });
    assert.deepEqual(result, {});
    assert.equal(captured.url, 'https://custodynote.com/api/stats/heartbeat');
    assert.equal(captured.init.method, 'POST');
    assert.equal(captured.init.body, JSON.stringify(body));
  });

  it('rejects disallowed hosts', async () => {
    const post = createStatsNetPost({
      isAllowedApiUrl: () => false,
      net: { fetch: async () => ({ status: 200, text: async () => '{}' }) },
    });
    await assert.rejects(
      () => post('https://evil.example/api/stats/heartbeat', {}, { timeout: 1000 }),
      /not allowed/i
    );
  });

  it('rejects HTTP 4xx/5xx', async () => {
    const post = createStatsNetPost({
      isAllowedApiUrl,
      net: {
        fetch: async () => ({ status: 503, text: async () => '{"error":"down"}' }),
      },
    });
    await assert.rejects(
      () => post('https://custodynote.com/api/stats/trial-started', {}, { timeout: 1000 }),
      (err) => err && err.statusCode === 503
    );
  });
});
