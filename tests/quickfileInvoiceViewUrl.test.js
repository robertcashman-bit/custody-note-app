'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const viewUrl = require('../lib/quickfileInvoiceViewUrl');

describe('quickfileInvoiceViewUrl', () => {
  it('prefers ViewHref from Invoice_Search row', () => {
    const href = 'https://example.quickfile.co.uk/sales/preview?invoiceID=99';
    assert.strictEqual(
      viewUrl.pickViewHrefFromRecord({ ViewHref: href, InvoiceID: 99 }),
      href
    );
  });

  it('resolveInvoiceViewUrlFromSources uses search row before DirectPreviewUri', () => {
    const searchHref = 'https://firm.quickfile.co.uk/?d=abc';
    const preview = 'https://firm.quickfile.co.uk/direct/preview.pdf';
    assert.strictEqual(
      viewUrl.resolveInvoiceViewUrlFromSources({
        searchRow: { ViewHref: searchHref },
        getBody: { DirectPreviewUri: preview },
      }),
      searchHref
    );
  });

  it('falls back to DirectPreviewUri when search row has no ViewHref', () => {
    const preview = 'https://firm.quickfile.co.uk/direct/preview.pdf';
    assert.strictEqual(
      viewUrl.resolveInvoiceViewUrlFromSources({
        getBody: { Invoice: { DirectPreviewUri: preview } },
      }),
      preview
    );
  });

  it('does not synthesize app.quickfile.co.uk view URLs', () => {
    assert.strictEqual(
      viewUrl.resolveInvoiceViewUrlFromSources({ invoiceId: '12345' }),
      ''
    );
  });
});
