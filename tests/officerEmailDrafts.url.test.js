'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildOutlookComposeUrl } = require('../lib/officerEmailDrafts');

describe('officerEmailDrafts — Outlook Web compose URL', () => {
  it('uses outlook.office.com deeplink compose', () => {
    const u = buildOutlookComposeUrl({
      toEmail: 'a@b.police.uk',
      subject: 'Hello',
      body: 'Line1\nLine2',
    });
    assert.ok(u.startsWith('https://outlook.office.com/mail/deeplink/compose'), u);
    assert.ok(u.includes('to='), u);
    assert.ok(u.includes('subject='), u);
    assert.ok(u.includes('body='), u);
  });

  it('encodes newlines in body as CRLF in query', () => {
    const u = buildOutlookComposeUrl({ toEmail: 'x@y.gov.uk', subject: 'S', body: 'a\nb' });
    assert.ok(u.includes('a%0D%0Ab') || u.includes('a%0d%0ab'), u);
  });
});
