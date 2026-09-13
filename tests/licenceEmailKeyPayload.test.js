const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLicenceEmailKeyPayload,
  buildTypedEmailRetryPayload,
  isLicenceEmailKeyFailure,
  isGenericAntiEnumMessage,
  shouldRetryEmailKeyWithTypedEmail,
  mapLicenceEmailKeyResponse,
  requestLicenceEmailKeyWithRetry,
  formatLicenceEmailKeyError,
} = require('../main/licenceEmailKeyPayload');

describe('buildLicenceEmailKeyPayload', () => {
  it('sends activated key and purchase/account email together', () => {
    const payload = buildLicenceEmailKeyPayload(
      { key: 'CN-AAAA-BBBB-CCCC-DDDD', email: 'account@purchase.com' },
      { email: 'practice@firm.com' },
    );
    assert.equal(payload.key, 'CN-AAAA-BBBB-CCCC-DDDD');
    assert.equal(payload.email, 'account@purchase.com');
  });

  it('sends activated key alone when licence.dat has no account email', () => {
    const payload = buildLicenceEmailKeyPayload(
      { key: 'CN-AAAA-BBBB-CCCC-DDDD' },
      { email: 'practice@firm.com' },
    );
    assert.equal(payload.key, 'CN-AAAA-BBBB-CCCC-DDDD');
    assert.equal(payload.email, undefined);
  });

  it('does not let renderer practice email override activated key', () => {
    const payload = buildLicenceEmailKeyPayload(
      { key: 'CN-AAAA-BBBB-CCCC-DDDD', email: 'account@purchase.com' },
      { email: 'practice@firm.com' },
    );
    assert.notEqual(payload.email, 'practice@firm.com');
  });

  it('falls back to account email from licence.dat when no key', () => {
    const payload = buildLicenceEmailKeyPayload(
      { email: 'account@purchase.com' },
      { email: 'practice@firm.com' },
    );
    assert.equal(payload.email, 'account@purchase.com');
    assert.equal(payload.key, undefined);
  });

  it('uses renderer email only when licence file has neither key nor account email', () => {
    const payload = buildLicenceEmailKeyPayload({}, { email: 'Practice@Firm.com' });
    assert.equal(payload.email, 'practice@firm.com');
  });
});

describe('typed-email retry helpers', () => {
  it('buildTypedEmailRetryPayload normalises email', () => {
    assert.deepEqual(buildTypedEmailRetryPayload('  Me@Firm.com '), { email: 'me@firm.com' });
    assert.equal(buildTypedEmailRetryPayload(''), null);
  });

  it('treats sent:false and missing sent as failures', () => {
    assert.equal(isLicenceEmailKeyFailure({ ok: true, sent: false, error: 'Resend failed' }), true);
    assert.equal(isLicenceEmailKeyFailure({ ok: false, sent: false, error: 'nope' }), true);
    assert.equal(isLicenceEmailKeyFailure({ ok: true, message: 'anti-enum' }), true);
    assert.equal(isLicenceEmailKeyFailure({ ok: true, sent: true }), false);
  });

  it('retries with typed email only after activated-key failure', () => {
    assert.equal(
      shouldRetryEmailKeyWithTypedEmail(
        { key: 'CN-AAAA-BBBB-CCCC-DDDD', email: 'account@purchase.com' },
        { ok: false, sent: false, error: 'Email was not sent' },
        'typed@firm.com',
      ),
      true,
    );
    assert.equal(
      shouldRetryEmailKeyWithTypedEmail(
        { key: 'CN-AAAA-BBBB-CCCC-DDDD' },
        { ok: true, sent: true },
        'typed@firm.com',
      ),
      false,
    );
    assert.equal(
      shouldRetryEmailKeyWithTypedEmail(
        { email: 'account@purchase.com' },
        { ok: false, sent: false },
        'typed@firm.com',
      ),
      false,
    );
    assert.equal(
      shouldRetryEmailKeyWithTypedEmail(
        { key: 'CN-AAAA-BBBB-CCCC-DDDD' },
        { ok: false, sent: false },
        '',
      ),
      false,
    );
  });
});

describe('mapLicenceEmailKeyResponse', () => {
  it('does not invent success when sent is false', () => {
    const mapped = mapLicenceEmailKeyResponse(
      { ok: true, sent: false, error: 'delivery failed', correlationId: 'cid-1' },
      'fallback',
    );
    assert.equal(mapped.ok, false);
    assert.equal(mapped.sent, false);
    assert.equal(mapped.error, 'delivery failed');
    assert.equal(mapped.correlationId, 'cid-1');
  });

  it('does not invent success when sent is missing (evening fake-success class)', () => {
    const mapped = mapLicenceEmailKeyResponse(
      { ok: true, message: 'If an account exists…', correlationId: 'cid-missing' },
      'fallback',
    );
    assert.equal(mapped.ok, false);
    assert.equal(mapped.sent, false);
    assert.equal(mapped.correlationId, 'cid-missing');
  });

  it('passes through success only when sent is explicitly true', () => {
    const mapped = mapLicenceEmailKeyResponse(
      { ok: true, sent: true, message: 'sent', correlationId: 'cid-2' },
      'fallback',
    );
    assert.equal(mapped.ok, true);
    assert.equal(mapped.sent, true);
    assert.equal(mapped.message, 'sent');
    assert.equal(mapped.correlationId, 'cid-2');
  });

  it('website honesty: unmatched presented key with sent:false is failure (Ref available)', () => {
    const mapped = mapLicenceEmailKeyResponse(
      {
        ok: true,
        sent: false,
        error: 'No matching licence key',
        message: "If an account exists for that email, we've sent the licence key.",
        correlationId: 'email-unmatched-key',
      },
      'fallback',
      { presentedKey: true },
    );
    assert.equal(mapped.ok, false);
    assert.equal(mapped.sent, false);
    assert.equal(mapped.error, 'No matching licence key');
    assert.equal(mapped.correlationId, 'email-unmatched-key');
    assert.match(formatLicenceEmailKeyError(mapped), /Ref: email-unmatched-key/);
  });

  it('activated harden: generic anti-enum sent:true without server correlationId is not success', () => {
    const mapped = mapLicenceEmailKeyResponse(
      {
        ok: true,
        sent: true,
        message: "If an account exists for that email, we've sent the licence key.",
      },
      'cn-client-fallback',
      { presentedKey: true },
    );
    assert.equal(mapped.ok, false);
    assert.equal(mapped.sent, false);
    assert.equal(mapped.correlationId, 'cn-client-fallback');
  });

  it('activated path still accepts real send with server correlationId', () => {
    const mapped = mapLicenceEmailKeyResponse(
      {
        ok: true,
        sent: true,
        message: "If an account exists for that email, we've sent the licence key.",
        correlationId: 'email-real-send',
      },
      'fallback',
      { presentedKey: true },
    );
    assert.equal(mapped.ok, true);
    assert.equal(mapped.sent, true);
    assert.equal(mapped.correlationId, 'email-real-send');
  });

  it('email-only forgot path keeps anti-enum success without presentedKey harden', () => {
    const mapped = mapLicenceEmailKeyResponse(
      {
        ok: true,
        sent: true,
        message: "If an account exists for that email, we've sent the licence key.",
        correlationId: 'email-anti-enum',
      },
      'fallback',
      { presentedKey: false },
    );
    assert.equal(mapped.ok, true);
    assert.equal(mapped.sent, true);
  });
});

describe('evening retry failure modes', () => {
  it('treats ok:true without sent as failure so typed-email retry can run', () => {
    assert.equal(
      isLicenceEmailKeyFailure({ ok: true, message: 'If an account exists…' }),
      true,
    );
    assert.equal(
      shouldRetryEmailKeyWithTypedEmail(
        { key: 'CN-ADMIN-AAAA-BBBB-CCCC' },
        { ok: false, sent: false, error: 'Email was not sent' },
        'owner@example.com',
      ),
      true,
    );
  });

  it('surfaces correlationId on rate-limit style failure', () => {
    assert.equal(
      formatLicenceEmailKeyError({
        error: 'Too many requests. Please wait a minute and try again.',
        correlationId: 'cn-rate-test',
      }),
      'Too many requests. Please wait a minute and try again. (Ref: cn-rate-test)',
    );
  });
});

describe('requestLicenceEmailKeyWithRetry', () => {
  it('posts key+account email then retries typed email on sent:false', async () => {
    const posts = [];
    const result = await requestLicenceEmailKeyWithRetry({
      licenceData: { key: 'CN-AAAA-BBBB-CCCC-DDDD', email: 'account@purchase.com' },
      rendererParams: { email: 'typed@firm.com' },
      correlationId: 'cn-test',
      postFn: async (payload) => {
        posts.push(payload);
        if (payload.key) {
          return { ok: true, sent: false, error: 'Resend failed', correlationId: 'cid-key' };
        }
        return { ok: true, sent: true, message: 'Sent via email lookup', correlationId: 'cid-retry' };
      },
    });
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0], { key: 'CN-AAAA-BBBB-CCCC-DDDD', email: 'account@purchase.com' });
    assert.deepEqual(posts[1], { email: 'typed@firm.com' });
    assert.equal(result.ok, true);
    assert.equal(result.sent, true);
    assert.equal(result.retried, true);
    assert.equal(result.lookup, 'typed_email_retry');
    assert.equal(result.correlationId, 'cid-retry');
  });

  it('does not retry when activated-key request succeeds', async () => {
    const posts = [];
    const result = await requestLicenceEmailKeyWithRetry({
      licenceData: { key: 'CN-AAAA-BBBB-CCCC-DDDD', email: 'account@purchase.com' },
      rendererParams: { email: 'typed@firm.com' },
      correlationId: 'cn-test',
      postFn: async (payload) => {
        posts.push(payload);
        return { ok: true, sent: true, message: 'ok', correlationId: 'cid-ok' };
      },
    });
    assert.equal(posts.length, 1);
    assert.equal(result.ok, true);
    assert.equal(result.retried, undefined);
  });

  it('returns honest failure with correlationId when retry also fails', async () => {
    const result = await requestLicenceEmailKeyWithRetry({
      licenceData: { key: 'CN-AAAA-BBBB-CCCC-DDDD' },
      rendererParams: { email: 'typed@firm.com' },
      correlationId: 'cn-test',
      postFn: async () => ({
        ok: true,
        sent: false,
        error: 'Email was not sent',
        correlationId: 'cid-fail',
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.sent, false);
    assert.match(result.error, /Email was not sent/);
    assert.match(result.error, /Ref: cid-fail/);
    assert.equal(result.correlationId, 'cid-fail');
    assert.equal(result.retried, true);
  });

  it('unmatched presented key (website sent:false) fails with Ref; no success toast shape', async () => {
    const posts = [];
    const result = await requestLicenceEmailKeyWithRetry({
      licenceData: { key: 'CN-DEAD-BEEF-FAKE-KEY1', email: 'stale@purchase.com' },
      rendererParams: {},
      correlationId: 'cn-activated',
      postFn: async (payload) => {
        posts.push(payload);
        // Website honesty contract after unmatched-key fix.
        return {
          ok: true,
          sent: false,
          error: 'No matching licence key',
          correlationId: 'email-unmatched',
        };
      },
    });
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0], {
      key: 'CN-DEAD-BEEF-FAKE-KEY1',
      email: 'stale@purchase.com',
    });
    assert.equal(result.ok, false);
    assert.equal(result.sent, false);
    assert.equal(result.lookup, 'licence_key');
    assert.match(result.error, /Ref: email-unmatched/);
  });

  it('never treats anti-enum copy as success when primary key gets sent:false', async () => {
    const result = await requestLicenceEmailKeyWithRetry({
      licenceData: { key: 'cn-dead-beef-fake-key1' },
      rendererParams: {},
      correlationId: 'cn-anti',
      postFn: async () => ({
        ok: true,
        sent: false,
        message: "If an account exists for that email, we've sent the licence key.",
        correlationId: 'email-anti-unmatched',
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.sent, false);
    assert.notEqual(result.ok && result.sent, true);
    assert.match(result.error, /Ref: email-anti-unmatched/);
  });

  it('normalises activated key to uppercase before POST (preserves hyphens)', async () => {
    const posts = [];
    await requestLicenceEmailKeyWithRetry({
      licenceData: { key: '  cn-admin-aaaa-bbbb-cccc  ', email: 'a@b.com' },
      rendererParams: {},
      correlationId: 'cn-norm',
      postFn: async (payload) => {
        posts.push(payload);
        return { ok: true, sent: true, message: 'ok', correlationId: 'cid-n' };
      },
    });
    assert.equal(posts[0].key, 'CN-ADMIN-AAAA-BBBB-CCCC');
  });

  it('posts key alone when licence.dat has key but empty email', async () => {
    const posts = [];
    const result = await requestLicenceEmailKeyWithRetry({
      licenceData: { key: 'CN-ONLY-KEY1-KEY2-KEY3', email: '' },
      rendererParams: { email: 'typed@firm.com' },
      correlationId: 'cn-key-only',
      postFn: async (payload) => {
        posts.push(payload);
        return { ok: true, sent: true, message: 'ok', correlationId: 'cid-key-only' };
      },
    });
    assert.deepEqual(posts[0], { key: 'CN-ONLY-KEY1-KEY2-KEY3' });
    assert.equal(result.ok, true);
    assert.equal(result.sent, true);
  });

  it('email-only anti-enum success still works when no activated key', async () => {
    const result = await requestLicenceEmailKeyWithRetry({
      licenceData: {},
      rendererParams: { email: 'unknown@example.com' },
      correlationId: 'cn-forgot',
      postFn: async (payload) => {
        assert.deepEqual(payload, { email: 'unknown@example.com' });
        return {
          ok: true,
          sent: true,
          message: "If an account exists for that email, we've sent the licence key.",
          correlationId: 'email-anti-enum',
        };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.sent, true);
    assert.equal(result.lookup, 'email');
  });
});

describe('formatLicenceEmailKeyError', () => {
  it('includes correlationId ref', () => {
    assert.equal(
      formatLicenceEmailKeyError({ error: 'Email was not sent', correlationId: 'cid-9' }),
      'Email was not sent (Ref: cid-9)',
    );
  });

  it('does not double-append Ref', () => {
    assert.equal(
      formatLicenceEmailKeyError({
        error: 'Email was not sent (Ref: cid-9)',
        correlationId: 'cid-9',
      }),
      'Email was not sent (Ref: cid-9)',
    );
  });
});

describe('isGenericAntiEnumMessage', () => {
  it('recognises website anti-enum copy', () => {
    assert.equal(
      isGenericAntiEnumMessage("If an account exists for that email, we've sent the licence key."),
      true,
    );
    assert.equal(
      isGenericAntiEnumMessage('If that email exists in our system, your licence code has been sent.'),
      true,
    );
    assert.equal(isGenericAntiEnumMessage('Licence key emailed'), false);
  });
});
