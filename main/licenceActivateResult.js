'use strict';

/**
 * Map online licence validate failure into the IPC activate failure shape.
 * Always prefer the server message (e.g. "No valid credentials provided")
 * so Settings / overlay Activate never hide the real reason.
 */
function mapLicenceActivateFailure(validateResult) {
  if (!validateResult || validateResult.valid !== false) return null;
  const raw = validateResult.message != null ? String(validateResult.message).trim() : '';
  return {
    success: false,
    message: raw || 'Licence key is not valid',
  };
}

module.exports = {
  mapLicenceActivateFailure,
};
