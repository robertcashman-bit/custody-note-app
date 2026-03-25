/**
 * Unit tests for Outlook Web compose — URL building and main-process open (mocked shell).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buildOutlookWebComposeUrl } = require('../lib/outlookWebComposeUrl');
const { openOutlookWebEmail } = require('../main/openOutlookWebEmail');

describe('buildOutlookWebComposeUrl', () => {
  it('builds OWA deeplink with correct base path', () => {
    const u = buildOutlookWebComposeUrl({
      to: 'a@b.com',
      cc: 'c@d.com',
      bcc: '',
      subject: 'Hello & welcome',
      body: 'Line1\nLine2',
    });
    assert.ok(u.startsWith('https://outlook.office.com/mail/deeplink/compose?'));
    assert.ok(u.includes('to=' + encodeURIComponent('a@b.com')));
    assert.ok(u.includes('subject=' + encodeURIComponent('Hello & welcome')));
    assert.ok(u.includes('body=' + encodeURIComponent('Line1\nLine2')));
    assert.ok(!u.toLowerCase().includes('mailto'));
  });

  it('encodes special characters in all fields', () => {
    const u = buildOutlookWebComposeUrl({
      to: 'x@y.co.uk',
      cc: 'a b@c.com',
      bcc: 'd@e.com',
      subject: '?&=#',
      body: '%',
    });
    assert.strictEqual(
      u,
      'https://outlook.office.com/mail/deeplink/compose' +
        '?to=' + encodeURIComponent('x@y.co.uk') +
        '&cc=' + encodeURIComponent('a b@c.com') +
        '&bcc=' + encodeURIComponent('d@e.com') +
        '&subject=' + encodeURIComponent('?&=#') +
        '&body=' + encodeURIComponent('%')
    );
  });
});

describe('openOutlookWebEmail', () => {
  it('calls shell.openExternal exactly once with OWA URL (non-Windows)', () => {
    const calls = [];
    const prevPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      openOutlookWebEmail(
        { to: 't@test.com', cc: '', bcc: '', subject: 'S', body: 'B' },
        {
          shell: {
            openExternal: (u) => {
              calls.push(u);
              return Promise.resolve();
            },
          },
        }
      );
      assert.strictEqual(calls.length, 1);
      assert.ok(calls[0].startsWith('https://outlook.office.com/mail/deeplink/compose'));
      assert.ok(!calls[0].toLowerCase().includes('mailto'));
    } finally {
      Object.defineProperty(process, 'platform', { value: prevPlatform, configurable: true });
    }
  });

  it('on Windows prefixes microsoft-edge: for the same https URL', () => {
    const calls = [];
    const prevPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      openOutlookWebEmail(
        { to: 'a@b.com', cc: '', bcc: '', subject: '', body: '' },
        {
          shell: {
            openExternal: (u) => {
              calls.push(u);
              return Promise.resolve();
            },
          },
        }
      );
      assert.strictEqual(calls.length, 1);
      assert.ok(
        calls[0].startsWith('microsoft-edge:https://outlook.office.com/mail/deeplink/compose'),
        'expected Edge scheme on Windows: ' + calls[0].slice(0, 80)
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: prevPlatform, configurable: true });
    }
  });
});

describe('buildOutlookWebComposeUrl — edge cases', () => {
  it('handles empty/undefined fields without crashing', () => {
    const u = buildOutlookWebComposeUrl({});
    assert.ok(u.startsWith('https://outlook.office.com/mail/deeplink/compose?'));
    assert.ok(u.includes('to=&'));
    assert.ok(u.includes('subject=&'));
  });

  it('handles null/undefined values gracefully', () => {
    const u = buildOutlookWebComposeUrl({ to: null, cc: undefined, bcc: null, subject: undefined, body: null });
    assert.ok(u.startsWith('https://outlook.office.com/mail/deeplink/compose?'));
    assert.ok(!u.toLowerCase().includes('mailto'));
  });

  it('preserves line breaks in body via encoding', () => {
    const body = 'Line 1\nLine 2\r\nLine 3';
    const u = buildOutlookWebComposeUrl({ to: 'a@b.com', body });
    assert.ok(u.includes(encodeURIComponent(body)));
  });

  it('handles very long body (4000+ chars)', () => {
    const body = 'x'.repeat(5000);
    const u = buildOutlookWebComposeUrl({ to: 'a@b.com', body });
    assert.ok(u.includes(encodeURIComponent(body)));
    assert.ok(u.length > 5000);
  });

  it('encodes unicode and emoji in subject and body', () => {
    const u = buildOutlookWebComposeUrl({
      to: 'a@b.com',
      subject: 'Café résumé — «test»',
      body: 'Hello 🔒 world £100',
    });
    assert.ok(u.includes(encodeURIComponent('Café résumé — «test»')));
    assert.ok(u.includes(encodeURIComponent('Hello 🔒 world £100')));
  });

  it('handles multiple recipients in to field (semicolon-separated)', () => {
    const u = buildOutlookWebComposeUrl({
      to: 'a@b.com;c@d.com;e@f.com',
      cc: 'g@h.com;i@j.com',
      bcc: 'k@l.com',
      subject: 'Multi',
      body: 'Test',
    });
    assert.ok(u.includes(encodeURIComponent('a@b.com;c@d.com;e@f.com')));
    assert.ok(u.includes(encodeURIComponent('g@h.com;i@j.com')));
  });

  it('never produces a mailto: URL regardless of input', () => {
    const inputs = [
      { to: 'mailto:trick@evil.com', subject: 'mailto:', body: 'mailto:test' },
      { to: '', subject: '', body: '' },
      { to: 'x@y.com' },
    ];
    for (const opts of inputs) {
      const u = buildOutlookWebComposeUrl(opts);
      assert.ok(u.startsWith('https://outlook.office.com/mail/deeplink/compose'),
        'must always start with OWA base URL');
    }
  });
});

describe('invokeOutlookWebCompose (renderer guard)', () => {
  it('second call while first is in-flight is ignored (single IPC)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'outlook-email-invoke.js'), 'utf8');
    const ctx = { window: {}, console };
    vm.runInNewContext(src, ctx);
    const invoke = ctx.window.invokeOutlookWebCompose;
    assert.strictEqual(typeof invoke, 'function');
    let openCount = 0;
    ctx.window.emailAPI = {
      open: () => {
        openCount++;
        return new Promise(function (resolve) {
          setTimeout(resolve, 50);
        });
      },
    };
    const p1 = invoke({ to: 'a@b.com', subject: '', body: '' });
    const p2 = invoke({ to: 'c@d.com', subject: '', body: '' });
    await Promise.all([p1, p2]);
    assert.strictEqual(openCount, 1, 'only one emailAPI.open while first compose is pending');
  });
});
