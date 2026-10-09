/**
 * Plain-language confirmation / failure copy for "Send Bill to QuickFile".
 *
 * Every send must end in something the user can see and read later:
 *  - success: a dialog with the QuickFile invoice number, total and attachments
 *    (stays until closed, unlike a 6-second toast that was easy to miss);
 *  - failure: a dialog with the reason, and whether QuickFile may still have
 *    made the invoice (timeout after the create request went out).
 * Pure functions only (no DOM) so they can be unit-tested in Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.QuickfileInvoiceResult = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function fmtGBP(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return '';
    return '\u00A3' + n.toFixed(2);
  }

  function invoiceLabel(result) {
    var r = result || {};
    var num = String(r.invoiceNumber || '').trim().replace(/^#+/, '');
    if (num) return '#' + num;
    var id = String(r.invoiceId || '').trim();
    return id ? 'ID ' + id : '';
  }

  /**
   * @param {object} result  quickfile-create-invoice IPC result with ok:true
   * @param {{ firmName?: string }} [opts]
   * @returns {{ level: 'success'|'warning', title: string, summary: string,
   *   rows: Array<{label: string, value: string}>, attachmentFailures: Array<{name: string, error: string}>,
   *   invoiceUrl: string }}
   */
  function buildInvoiceSentConfirmation(result, opts) {
    var r = result || {};
    var o = opts || {};
    var label = invoiceLabel(r);
    var attach = Array.isArray(r.attachResults) ? r.attachResults : [];
    var okCount = attach.filter(function (a) { return a && a.ok; }).length;
    var failures = attach.filter(function (a) { return a && !a.ok; }).map(function (a) {
      return { name: String(a.name || 'attachment'), error: String(a.error || 'Unknown error') };
    });
    if (!attach.length && r.attachmentError) {
      failures.push({ name: 'attendance note', error: String(r.attachmentError) });
    }

    var title = r.reused
      ? 'Already in QuickFile: invoice ' + label + ' linked'
      : 'Sent to QuickFile: invoice ' + label;
    var level = failures.length ? 'warning' : 'success';

    var rows = [{ label: 'QuickFile invoice', value: label || '(number not returned)' }];
    if (o.firmName) rows.push({ label: 'Firm', value: String(o.firmName) });
    var total = fmtGBP(r.total);
    if (total) rows.push({ label: 'Total (inc. VAT)', value: total });
    var attachText;
    if (!attach.length && !failures.length) attachText = 'None sent';
    else if (!failures.length) attachText = okCount + ' uploaded';
    else attachText = okCount + ' uploaded, ' + failures.length + ' failed';
    rows.push({ label: 'Attachments', value: attachText });

    var summary = title;
    if (r.reused) summary += '. No duplicate was created.';
    if (failures.length) {
      summary += '. ' + failures.length + ' attachment' + (failures.length === 1 ? '' : 's')
        + ' failed to upload \u2014 add ' + (failures.length === 1 ? 'it' : 'them') + ' in QuickFile.';
    }

    return {
      level: level,
      title: title,
      summary: summary,
      rows: rows,
      attachmentFailures: failures,
      invoiceUrl: String(r.invoiceUrl || ''),
    };
  }

  /**
   * @param {{ error?: string, code?: string, mayHaveBeenCreated?: boolean }} result
   * @returns {{ title: string, reason: string, advice: string }}
   */
  function buildInvoiceFailureMessage(result) {
    var r = result || {};
    var reason = String(r.error || '').trim() || 'Unknown error';
    var code = String(r.code || '');
    if (code === 'ALREADY_INVOICED') {
      return {
        title: 'This record already has an invoice',
        reason: reason,
        advice: 'Nothing new was sent. Click Continue to Review & complete to move on.',
      };
    }
    if (code === 'QF_UNCONFIRMED' || r.mayHaveBeenCreated) {
      return {
        title: "QuickFile didn't confirm the invoice",
        reason: reason,
        advice: 'The invoice may or may not have been created. Connect to your own Wi-Fi or a phone hotspot, '
          + 'then press Send Bill to QuickFile again. The app checks QuickFile first and links the existing '
          + 'invoice rather than creating a duplicate.',
      };
    }
    if (code === 'QF_TIMEOUT' || code === 'QF_NETWORK') {
      return {
        title: 'Not sent to QuickFile',
        reason: reason,
        advice: 'Nothing was created in QuickFile. Connect to your own Wi-Fi or a phone hotspot, then press Send Bill to QuickFile again.',
      };
    }
    var looksLikeConnection = /not configured|auth|credential|401|403|HTTP 5\d\d|parse error|empty response/i.test(reason);
    return {
      title: 'Not sent to QuickFile',
      reason: reason,
      advice: looksLikeConnection
        ? 'Check Settings \u2192 QuickFile and click "Test QuickFile connection", then press Send Bill to QuickFile again.'
        : 'Nothing was created in QuickFile. Fix the problem above, then press Send Bill to QuickFile again.',
    };
  }

  return {
    fmtGBP: fmtGBP,
    invoiceLabel: invoiceLabel,
    buildInvoiceSentConfirmation: buildInvoiceSentConfirmation,
    buildInvoiceFailureMessage: buildInvoiceFailureMessage,
  };
});
