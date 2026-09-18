'use strict';

/**
 * Safe note/field display helpers for the renderer.
 * Prefer textContent. When a caller must build HTML, escape first.
 * Never pass raw attendance note bodies to innerHTML.
 */

const { escapeHtml } = require('./escapeHtml');

/**
 * Set an element's text from untrusted note/field content (XSS-safe).
 * @param {Element|null|undefined} el
 * @param {unknown} value
 */
function setSafeText(el, value) {
  if (!el) return;
  el.textContent = value == null ? '' : String(value);
}

/**
 * Build a single HTML text node string from untrusted input.
 * @param {unknown} value
 * @returns {string}
 */
function safeNoteHtml(value) {
  return escapeHtml(value);
}

/**
 * True if a string looks like it may contain HTML markup (defensive check
 * before accidental innerHTML assignment of note bodies).
 * @param {unknown} value
 * @returns {boolean}
 */
function looksLikeHtmlMarkup(value) {
  if (typeof value !== 'string') return false;
  return /<[a-zA-Z!?/]/.test(value);
}

/**
 * Sanitize a note body for safe HTML insertion: always escape.
 * If the source already contains tags they are shown as text, not executed.
 * @param {unknown} body
 * @returns {string}
 */
function sanitizeNoteBodyForDisplay(body) {
  return escapeHtml(body == null ? '' : body);
}

module.exports = {
  setSafeText,
  safeNoteHtml,
  looksLikeHtmlMarkup,
  sanitizeNoteBodyForDisplay,
};
