/**
 * Build POST body for /api/licence/email-key.
 *
 * When activated: send licence key and purchase/account email from licence.dat
 * (renderer practice email must not replace the activated key).
 * When not activated: prefer account email from licence.dat, else typed email.
 */

/** Privacy / anti-enumeration success copy used by the website API. */
const GENERIC_ANTI_ENUM_RE =
  /if an account exists|if that email exists/i;

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

function isGenericAntiEnumMessage(message) {
  if (message == null || message === '') return true;
  return GENERIC_ANTI_ENUM_RE.test(String(message));
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
 *
 * @param {object} resp
 * @param {string|null} fallbackCorrelationId
 * @param {{ presentedKey?: boolean }} [options]
 *   When presentedKey is true (activated device posted licence.dat key):
 *   - sent:false (website honesty for unmatched keys) → failure with Ref
 *   - sent:true with only generic anti-enum copy and no server correlationId
 *     is not enough evidence of a real send (defence-in-depth). Email-only
 *     forgot flows omit presentedKey so anti-enum success still works.
 */
function mapLicenceEmailKeyResponse(resp, fallbackCorrelationId, options) {
  const presentedKey = !!(options && options.presentedKey);
  const serverCorrelationId =
    resp && resp.correlationId != null && String(resp.correlationId).trim()
      ? String(resp.correlationId).trim()
      : null;
  const correlationId = serverCorrelationId || fallbackCorrelationId || null;

  if (!resp || typeof resp !== 'object') {
    return {
      ok: false,
      sent: false,
      error: 'Failed to send email',
      correlationId,
    };
  }

  // Website honesty (post email-key unmatched-key fix): presented key that did
  // not resolve must return sent:false — never toast success for that case.
  if (resp.sent === false || resp.ok === false) {
    return {
      ok: false,
      sent: false,
      error: resp.error || resp.message || 'Email was not sent',
      correlationId,
    };
  }

  // Explicit send success only — missing/undefined sent must not become a fake success
  // (evening retries previously looked "OK" while Resend never ran).
  if (resp.sent === true && resp.ok !== false) {
    // Activated path: generic anti-enum copy alone without a server correlationId
    // is not proof a key email was delivered. Do not break email-only anti-enum
    // (presentedKey false) which may legitimately return the same copy.
    if (
      presentedKey &&
      isGenericAntiEnumMessage(resp.message) &&
      !serverCorrelationId
    ) {
      return {
        ok: false,
        sent: false,
        error: resp.error || 'Email was not sent',
        correlationId,
      };
    }
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

/** Attach Ref via formatLicenceEmailKeyError on failure results (idempotent). */
function withFormattedLicenceEmailKeyError(result) {
  if (!result || result.sent === true) return result;
  const formatted = formatLicenceEmailKeyError(result);
  if (formatted && formatted !== result.error) {
    result.error = formatted;
  }
  return result;
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
    return withFormattedLicenceEmailKeyError({
      ok: false,
      sent: false,
      error: 'No licence key or account email on this device',
      correlationId: correlationId || null,
    });
  }

  const cid = correlationId || 'cn-' + Date.now().toString(36);
  const presentedKey = !!primary.key;
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

  let result = mapLicenceEmailKeyResponse(resp, cid, { presentedKey });
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
      // Typed-email retry is a forgot-email path — do not apply presentedKey harden.
      result = mapLicenceEmailKeyResponse(retryResp, cid, { presentedKey: false });
      result.lookup = 'typed_email_retry';
      result.retried = true;
    }
  }

  return withFormattedLicenceEmailKeyError(result);
}

/** User-facing failure text including correlation id when present. */
function formatLicenceEmailKeyError(result) {
  if (!result) return 'Failed to send email';
  const base = result.error || result.message || 'Failed to send email';
  // Avoid double-appending Ref if caller already formatted.
  if (/\(Ref:\s*[^)]+\)\s*$/.test(String(base))) return String(base);
  if (result.correlationId) return base + ' (Ref: ' + result.correlationId + ')';
  return base;
}

module.exports = {
  buildLicenceEmailKeyPayload,
  buildTypedEmailRetryPayload,
  normalizeEmail,
  isLicenceEmailKeyFailure,
  isGenericAntiEnumMessage,
  shouldRetryEmailKeyWithTypedEmail,
  mapLicenceEmailKeyResponse,
  requestLicenceEmailKeyWithRetry,
  formatLicenceEmailKeyError,
  withFormattedLicenceEmailKeyError,
};
