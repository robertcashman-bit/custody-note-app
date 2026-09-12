/**
 * Build POST body for /api/licence/email-key.
 *
 * When activated: send licence key and purchase/account email from licence.dat
 * (renderer practice email must not replace the activated key).
 * When not activated: prefer account email from licence.dat, else typed email.
 */

function normalizeEmail(value) {
  if (value == null) return '';
  const s = String(value).trim().toLowerCase();
  return s || '';
}

function buildLicenceEmailKeyPayload(licenceData, rendererParams) {
  const payload = {};
  const data = licenceData || {};
  const params = rendererParams || {};

  if (data.key && String(data.key).trim()) {
    payload.key = String(data.key).trim();
    const accountEmail = normalizeEmail(data.email);
    if (accountEmail) payload.email = accountEmail;
    return payload;
  }

  const accountEmail = normalizeEmail(data.email);
  if (accountEmail) {
    payload.email = accountEmail;
    return payload;
  }

  const typedEmail = normalizeEmail(params.email);
  if (typedEmail) {
    payload.email = typedEmail;
    return payload;
  }

  return payload;
}

function buildTypedEmailRetryPayload(typedEmail) {
  const email = normalizeEmail(typedEmail);
  if (!email) return null;
  return { email };
}

/** True when the API (or transport) did not successfully send. */
function isLicenceEmailKeyFailure(resp) {
  if (!resp || typeof resp !== 'object') return true;
  if (resp.sent === true && resp.ok !== false) return false;
  return true;
}

/**
 * After an activated-key attempt fails, retry once with the email the user typed
 * (forgot / grace forms). Returns null when retry should not run.
 */
function shouldRetryEmailKeyWithTypedEmail(primaryPayload, primaryResult, typedEmail) {
  if (!primaryPayload || !primaryPayload.key) return false;
  if (!isLicenceEmailKeyFailure(primaryResult)) return false;
  return !!normalizeEmail(typedEmail);
}

/**
 * Map raw API/transport response into the IPC shape used by the renderer.
 * Never invents success unless the API explicitly reports sent:true.
 */
function mapLicenceEmailKeyResponse(resp, fallbackCorrelationId) {
  const correlationId =
    (resp && resp.correlationId) || fallbackCorrelationId || null;

  if (!resp || typeof resp !== 'object') {
    return {
      ok: false,
      sent: false,
      error: 'Failed to send email',
      correlationId,
    };
  }

  // Explicit send success only — missing/undefined sent must not become a fake success
  // (evening retries previously looked "OK" while Resend never ran).
  if (resp.sent === true && resp.ok !== false) {
    return {
      ok: true,
      sent: true,
      message: resp.message || "If an account exists, we've sent your key.",
      correlationId,
    };
  }

  return {
    ok: false,
    sent: false,
    error: resp.error || resp.message || 'Email was not sent',
    correlationId,
  };
}

/**
 * Orchestrate primary request + optional typed-email retry.
 * `postFn(payload)` must return a parsed API body (or throw).
 * Does not log licence keys.
 */
async function requestLicenceEmailKeyWithRetry({
  licenceData,
  rendererParams,
  postFn,
  correlationId,
}) {
  const params = rendererParams || {};
  const primary = buildLicenceEmailKeyPayload(licenceData, params);
  if (!primary.key && !primary.email) {
    return {
      ok: false,
      sent: false,
      error: 'No licence key or account email on this device',
      correlationId: correlationId || null,
    };
  }

  const cid = correlationId || 'cn-' + Date.now().toString(36);
  let resp;
  try {
    resp = await postFn(primary);
  } catch (e) {
    resp = {
      ok: false,
      sent: false,
      error: e && e.message ? e.message : 'Failed to send email',
      correlationId: cid,
    };
  }

  let result = mapLicenceEmailKeyResponse(resp, cid);
  result.lookup = primary.key ? 'licence_key' : 'email';

  if (shouldRetryEmailKeyWithTypedEmail(primary, result, params.email)) {
    const retryPayload = buildTypedEmailRetryPayload(params.email);
    if (retryPayload) {
      let retryResp;
      try {
        retryResp = await postFn(retryPayload);
      } catch (e) {
        retryResp = {
          ok: false,
          sent: false,
          error: e && e.message ? e.message : 'Failed to send email',
          correlationId: cid,
        };
      }
      result = mapLicenceEmailKeyResponse(retryResp, cid);
      result.lookup = 'typed_email_retry';
      result.retried = true;
    }
  }

  return result;
}

/** User-facing failure text including correlation id when present. */
function formatLicenceEmailKeyError(result) {
  if (!result) return 'Failed to send email';
  const base = result.error || result.message || 'Failed to send email';
  if (result.correlationId) return base + ' (Ref: ' + result.correlationId + ')';
  return base;
}

module.exports = {
  buildLicenceEmailKeyPayload,
  buildTypedEmailRetryPayload,
  normalizeEmail,
  isLicenceEmailKeyFailure,
  shouldRetryEmailKeyWithTypedEmail,
  mapLicenceEmailKeyResponse,
  requestLicenceEmailKeyWithRetry,
  formatLicenceEmailKeyError,
};
