'use strict';

/**
 * Coerce checkbox-group field values (pipe string, array, or scalar) for PDF text rows.
 * Dual-export: Node tests + renderer <script> (window.PdfCheckboxFieldText).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.PdfCheckboxFieldText = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function formatCheckboxGroupForPdf(value, separator) {
    var sep = separator != null ? String(separator) : ', ';
    if (value == null || value === '') return '';
    if (Array.isArray(value)) {
      return value
        .map(function (item) { return item == null ? '' : String(item).trim(); })
        .filter(Boolean)
        .join(sep);
    }
    if (typeof value === 'object') {
      try {
        return formatCheckboxGroupForPdf(Object.values(value), sep);
      } catch (_) {
        return '';
      }
    }
    return String(value).replace(/\|/g, sep);
  }

  return {
    formatCheckboxGroupForPdf: formatCheckboxGroupForPdf,
  };
});
