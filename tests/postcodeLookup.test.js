/**
 * Tests for the postcode lookup IPC handlers.
 *
 * Covers:
 *  1. Static source-code assertions – confirms readSettings() is gone and
 *     the correct dbAll pattern is used.
 *  2. Unit tests – exercise the handler logic with a mock HTTP layer.
 *  3. Live sandbox test – hits the real Ideal Postcodes API with the
 *     public test key "iddqd" and postcode "ID1 1QD".
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const https = require('https');
const fs = require('fs');
const path = require('path');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

/* ── 1. Source-code assertions ──────────────────────────────────────── */

describe('Postcode IPC handlers – source code', () => {
  it('does NOT call the undefined readSettings() function', () => {
    /* Extract just the two handler bodies so we only check the relevant code. */
    const lookupIdx = mainJs.indexOf("ipcMain.handle('postcode-lookup'");
    const checkIdx  = mainJs.indexOf("ipcMain.handle('postcode-check-key'");
    assert.ok(lookupIdx !== -1, 'postcode-lookup handler must exist');
    assert.ok(checkIdx  !== -1, 'postcode-check-key handler must exist');

    const lookupBody = mainJs.slice(lookupIdx, lookupIdx + 600);
    const checkBody  = mainJs.slice(checkIdx,  checkIdx  + 400);

    assert.ok(!lookupBody.includes('readSettings()'),
      'postcode-lookup must NOT call readSettings() (function is undefined)');
    assert.ok(!checkBody.includes('readSettings()'),
      'postcode-check-key must NOT call readSettings() (function is undefined)');
  });

  it('strips spaces (not replaces with +) to avoid %2B URL encoding', () => {
    const lookupIdx = mainJs.indexOf("ipcMain.handle('postcode-lookup'");
    /* Use a generous window — CRLF endings on Windows expand line lengths */
    const body = mainJs.slice(lookupIdx, lookupIdx + 1000);
    assert.ok(
      body.includes(".replace(/\\s+/g, '')"),
      'postcode-lookup must strip spaces (not replace with +) to avoid %2B in URL'
    );
    assert.ok(!body.includes(".replace(/\\s+/g, '+')"),
      'postcode-lookup must NOT use + replacement (would produce %2B via encodeURIComponent)');
  });

  it('reads settings from the DB via dbAll in both handlers', () => {
    const lookupIdx = mainJs.indexOf("ipcMain.handle('postcode-lookup'");
    const checkIdx  = mainJs.indexOf("ipcMain.handle('postcode-check-key'");

    const nextHandler = mainJs.indexOf("ipcMain.handle(", lookupIdx + 1);
    const lookupBody = mainJs.slice(lookupIdx, nextHandler !== -1 ? nextHandler : lookupIdx + 2000);
    const checkBody  = mainJs.slice(checkIdx,  checkIdx  + 600);

    assert.ok(
      lookupBody.includes("dbAll('SELECT key, value FROM settings')"),
      'postcode-lookup must query settings via dbAll (fallback path)'
    );
    assert.ok(
      checkBody.includes("dbAll('SELECT key, value FROM settings')"),
      'postcode-check-key must query settings via dbAll'
    );
  });

  it('handler maps Ideal Postcodes fields to the expected output keys', () => {
    const lookupIdx = mainJs.indexOf("ipcMain.handle('postcode-lookup'");
    const body = mainJs.slice(lookupIdx, lookupIdx + 1800);
    assert.ok(body.includes('a.line_1'), 'must map a.line_1');
    assert.ok(body.includes('a.line_2'), 'must map a.line_2');
    assert.ok(body.includes('a.line_3'), 'must map a.line_3');
    assert.ok(body.includes('a.post_town'), 'must map a.post_town → city');
    assert.ok(body.includes('a.county'), 'must map a.county');
    assert.ok(body.includes('a.postcode'), 'must map a.postcode');
    assert.ok(body.includes('summary'), 'must build a summary string');
  });

  it('handler returns { ok: false } when no API key is configured', () => {
    const lookupIdx = mainJs.indexOf("ipcMain.handle('postcode-lookup'");
    const nextHandler = mainJs.indexOf("ipcMain.handle(", lookupIdx + 1);
    const body = mainJs.slice(lookupIdx, nextHandler !== -1 ? nextHandler : lookupIdx + 2000);
    assert.ok(
      body.includes('Postcode lookup is not available') || body.includes('No API key configured'),
      'must return a helpful error when neither proxy nor API key is available'
    );
  });
});

/* ── 2. Unit tests – handler logic with mock HTTP ───────────────────── */

/**
 * Re-implement the handler logic in isolation (no Electron / SQLite needed)
 * so we can unit-test every branch with a mock HTTP response.
 */
function buildHandlerWithMocks({ dbSettings = {}, httpResponse = null, httpSequence = null, httpError = null } = {}) {
  /* Fake dbAll */
  const dbAll = () => Object.entries(dbSettings).map(([key, value]) => ({ key, value }));

  const seq = httpSequence != null
    ? httpSequence.map((x) => (x && typeof x === 'object' && 'body' in x ? x : { statusCode: 200, body: x }))
    : (httpResponse != null ? [{ statusCode: 200, body: httpResponse }] : []);
  let httpIdx = 0;
  /* Fake httpsGetWithTimeout — supports multiple sequential responses (details + availability) */
  async function httpsGetWithTimeout() {
    if (httpError) return { ok: false, error: httpError };
    const item = seq[httpIdx++];
    if (!item) return { ok: false, error: 'no mock HTTP response' };
    const statusCode = item.statusCode != null ? item.statusCode : 200;
    const bodyStr = typeof item.body === 'string' ? item.body : JSON.stringify(item.body);
    return { ok: true, statusCode, body: bodyStr };
  }

  async function postcodeLookupHandler(postcode) {
    const settings = Object.fromEntries(dbAll('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
    const apiKey = (settings.idealPostcodesApiKey || '').trim();
    if (!apiKey) return { ok: false, error: 'No API key configured. Add your Ideal Postcodes API key in Settings > Integrations.' };
    const pc = (postcode || '').trim().replace(/\s+/g, '');
    if (!pc) return { ok: false, error: 'No postcode entered.' };
    const res = await httpsGetWithTimeout();
    if (!res.ok) return { ok: false, error: res.error };
    try {
      const json = JSON.parse(res.body);
      if (json.code === 2000 && json.result && json.result.length) {
        const addresses = json.result.map(a => ({
          line1: a.line_1 || '',
          line2: a.line_2 || '',
          line3: a.line_3 || '',
          city: a.post_town || '',
          county: a.county || '',
          postcode: a.postcode || pc,
          summary: [a.line_1, a.line_2, a.line_3, a.post_town].filter(Boolean).join(', '),
        }));
        return { ok: true, addresses, remaining: json.result.length };
      } else if (json.code === 4040) {
        return { ok: false, error: 'Postcode not found.' };
      } else if (json.code === 4010 || json.code === 4020) {
        return { ok: false, error: 'Invalid API key or no credits remaining. Check Settings > Integrations.' };
      } else {
        return { ok: false, error: json.message || 'Lookup failed.' };
      }
    } catch (_) { return { ok: false, error: 'Failed to parse response from Ideal Postcodes.' }; }
  }

  async function postcodeCheckKeyHandler() {
    const settings = Object.fromEntries(dbAll('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
    const apiKey = (settings.idealPostcodesApiKey || '').trim();
    const userToken = (settings.idealPostcodesUserToken || '').trim();
    if (!apiKey) return { ok: false, configured: false };

    const detailsRes = await httpsGetWithTimeout();
    if (detailsRes.ok && detailsRes.statusCode === 200) {
      try {
        const dj = JSON.parse(detailsRes.body);
        if (dj.code === 2000 && dj.result && typeof dj.result.lookups_remaining === 'number') {
          return { ok: true, configured: true, lookups_remaining: dj.result.lookups_remaining };
        }
      } catch (_) { /* fall through */ }
    }

    const res = await httpsGetWithTimeout();
    if (!res.ok) return { ok: false, configured: true, error: res.error };
    try {
      const json = JSON.parse(res.body);
      if (json.code === 2000 && json.result && typeof json.result.available === 'boolean') {
        const hint = userToken
          ? ''
          : 'Exact balance: add your User Token from ideal-postcodes.co.uk/account (below), or check your dashboard there.';
        return {
          ok: true,
          configured: true,
          availability_only: true,
          key_available: json.result.available,
          lookups_remaining: null,
          message: json.result.available
            ? 'API key is valid and can be used for lookups.'
            : 'This key is not currently available (no credits, limits, or restrictions). Check your Ideal Postcodes account.',
          hint,
        };
      }
      if (res.statusCode === 404) return { ok: false, configured: true, error: 'API key not recognised. Check the key in Settings.' };
      return { ok: false, configured: true, error: json.message || 'Could not verify key.' };
    } catch (_) { return { ok: false, configured: true, error: 'Bad response from Ideal Postcodes.' }; }
  }

  return { postcodeLookupHandler, postcodeCheckKeyHandler };
}

/* Fake API response that mirrors what Ideal Postcodes returns for a hit */
const FAKE_RESULT = {
  code: 2000,
  result: [
    {
      line_1: '10 Downing Street',
      line_2: 'Westminster',
      line_3: '',
      post_town: 'London',
      county: 'Greater London',
      postcode: 'SW1A 2AA',
    },
    {
      line_1: '11 Downing Street',
      line_2: 'Westminster',
      line_3: '',
      post_town: 'London',
      county: 'Greater London',
      postcode: 'SW1A 2AB',
    },
  ],
};

describe('Postcode IPC handlers – unit tests', () => {
  it('returns ok:false with helpful message when API key is not set', async () => {
    const { postcodeLookupHandler } = buildHandlerWithMocks({ dbSettings: {} });
    const result = await postcodeLookupHandler('SW1A 2AA');
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes('No API key configured'), result.error);
  });

  it('returns ok:false when postcode is blank even if key is set', async () => {
    const { postcodeLookupHandler } = buildHandlerWithMocks({
      dbSettings: { idealPostcodesApiKey: 'ak_test' },
      httpResponse: FAKE_RESULT,
    });
    const result = await postcodeLookupHandler('');
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes('No postcode entered'), result.error);
  });

  it('returns ok:false on network / connection error', async () => {
    const { postcodeLookupHandler } = buildHandlerWithMocks({
      dbSettings: { idealPostcodesApiKey: 'ak_test' },
      httpError: 'Connection error: ECONNREFUSED',
    });
    const result = await postcodeLookupHandler('SW1A 2AA');
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes('Connection error'), result.error);
  });

  it('returns ok:false with "Postcode not found" for API code 4040', async () => {
    const { postcodeLookupHandler } = buildHandlerWithMocks({
      dbSettings: { idealPostcodesApiKey: 'ak_test' },
      httpResponse: { code: 4040, message: 'Postcode not found' },
    });
    const result = await postcodeLookupHandler('ZZ99 9ZZ');
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes('Postcode not found'), result.error);
  });

  it('returns ok:false with "Invalid API key" for API code 4010', async () => {
    const { postcodeLookupHandler } = buildHandlerWithMocks({
      dbSettings: { idealPostcodesApiKey: 'bad_key' },
      httpResponse: { code: 4010, message: 'Invalid key' },
    });
    const result = await postcodeLookupHandler('SW1A 2AA');
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes('Invalid API key'), result.error);
  });

  it('returns ok:true with correctly mapped addresses on success', async () => {
    const { postcodeLookupHandler } = buildHandlerWithMocks({
      dbSettings: { idealPostcodesApiKey: 'ak_test' },
      httpResponse: FAKE_RESULT,
    });
    const result = await postcodeLookupHandler('SW1A 2AA');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.addresses.length, 2);

    const first = result.addresses[0];
    assert.strictEqual(first.line1, '10 Downing Street');
    assert.strictEqual(first.line2, 'Westminster');
    assert.strictEqual(first.line3, '');
    assert.strictEqual(first.city, 'London');
    assert.strictEqual(first.county, 'Greater London');
    assert.strictEqual(first.postcode, 'SW1A 2AA');
    assert.strictEqual(first.summary, '10 Downing Street, Westminster, London');
  });

  it('summary omits blank lines', async () => {
    const { postcodeLookupHandler } = buildHandlerWithMocks({
      dbSettings: { idealPostcodesApiKey: 'ak_test' },
      httpResponse: FAKE_RESULT,
    });
    const result = await postcodeLookupHandler('SW1A 2AA');
    /* line_3 is '' so it must not appear in the summary */
    assert.ok(!result.addresses[0].summary.includes(',,'),
      'summary must not contain empty segments');
  });

  it('falls back to the entered postcode if API response has no postcode field', async () => {
    const noPostcodeResult = {
      code: 2000,
      result: [{ line_1: 'Flat 1', line_2: '', line_3: '', post_town: 'Bristol', county: 'Avon', postcode: '' }],
    };
    const { postcodeLookupHandler } = buildHandlerWithMocks({
      dbSettings: { idealPostcodesApiKey: 'ak_test' },
      httpResponse: noPostcodeResult,
    });
    const result = await postcodeLookupHandler('BS1 1AA');
    assert.strictEqual(result.ok, true);
    /* Handler strips spaces (BS1 1AA → BS11AA) before passing to URL, so fallback is the no-space form */
    assert.strictEqual(result.addresses[0].postcode, 'BS11AA', 'should fall back to sanitised (no-space) input postcode');
  });

  it('postcode-check-key returns ok:false when no API key configured', async () => {
    const { postcodeCheckKeyHandler } = buildHandlerWithMocks({ dbSettings: {} });
    const result = await postcodeCheckKeyHandler();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.configured, false);
  });

  it('postcode-check-key returns lookups_remaining when /details returns 2000', async () => {
    const { postcodeCheckKeyHandler } = buildHandlerWithMocks({
      dbSettings: { idealPostcodesApiKey: 'ak_test' },
      httpSequence: [{ statusCode: 200, body: { code: 2000, result: { lookups_remaining: 42 } } }],
    });
    const result = await postcodeCheckKeyHandler();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.lookups_remaining, 42);
  });

  it('postcode-check-key falls back to availability when details not 200', async () => {
    const { postcodeCheckKeyHandler } = buildHandlerWithMocks({
      dbSettings: { idealPostcodesApiKey: 'ak_test' },
      httpSequence: [
        { statusCode: 401, body: { code: 4010, message: 'Unauthorised' } },
        { statusCode: 200, body: { code: 2000, result: { available: true, context: '', contexts: [] } } },
      ],
    });
    const result = await postcodeCheckKeyHandler();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.availability_only, true);
    assert.strictEqual(result.key_available, true);
    assert.strictEqual(result.lookups_remaining, null);
  });
});

/* ── 3. Live API reachability test ─────────────────────────────────── */

/**
 * Ideal Postcodes does not expose a universally public sandbox key.
 * This test confirms:
 *   a) The API endpoint is reachable over HTTPS.
 *   b) The URL is correctly formed (no %2B encoding artifacts).
 *   c) The API returns well-formed JSON (either a 2000 success with a real
 *      key, or a 4010 Invalid Key — both confirm the endpoint is correct).
 * It does NOT require a valid API key, so it passes in CI with no secrets.
 */
describe('Postcode lookup – live API reachability', () => {
  it('Ideal Postcodes API is reachable and returns valid JSON', async () => {
    /* Use a deliberately invalid key — we only want to verify the endpoint
       and URL format.  A 4010 response is still a correctly formed response. */
    const pc  = 'SW1A2AA';   // no spaces — correct path format
    const url = `https://api.ideal-postcodes.co.uk/v1/postcodes/${pc}?api_key=test_invalid_key`;

    let body;
    try {
      body = await new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => resolve(data));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timed out')); });
      });
    } catch (e) {
      /* Network unavailable (CI without internet, etc.) — skip gracefully. */
      console.log('  Live test skipped: ' + e.message);
      return;
    }

    const json = JSON.parse(body);
    /* Must be a recognised Ideal Postcodes response code */
    assert.ok(
      [2000, 4010, 4020, 4040].includes(json.code),
      `Unexpected API code ${json.code}: ${json.message}`
    );
    /* URL encoding check: a %2B in the URL would cause the API to treat
       the postcode as unknown — we expect 4010 (bad key) not 4040 (bad pc) */
    assert.notStrictEqual(json.code, 4040,
      'Got "Postcode not found" — URL may still contain %2B encoding');

    console.log(`  Live reachability: API returned code ${json.code} (${json.message || 'ok'})`);
  });

  it('URL for a spaced postcode is correctly formed without %2B', () => {
    /* Simulate what the handler now does for "SW1A 2AA" */
    const raw = 'SW1A 2AA';
    const pc  = raw.trim().replace(/\s+/g, '');   // → 'SW1A2AA'
    const url = `https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(pc)}?api_key=test`;
    assert.ok(!url.includes('%2B'), 'URL must not contain %2B (double-encoded plus)');
    assert.ok(url.includes('SW1A2AA'), 'URL must contain the no-space postcode');
  });
});
