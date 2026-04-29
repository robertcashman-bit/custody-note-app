/**
 * Unit tests for Outlook Web compose — URL building and main-process open (mocked shell).
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  buildOutlookWebComposeUrl,
  buildOutlookWebComposeUrlWithMeta,
  inferOutlookAccountType,
} = require('../lib/outlookWebComposeUrl');
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

describe('openOutlookWebEmail (legacy work-account behaviour, accountType="work")', () => {
  it('calls shell.openExternal exactly once with OWA URL (non-Windows, work account)', () => {
    const calls = [];
    const prevPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      openOutlookWebEmail(
        { to: 't@test.com', cc: '', bcc: '', subject: 'S', body: 'B' },
        {
          shell: { openExternal: (u) => { calls.push(u); return Promise.resolve(); } },
          accountType: 'work',
          skipConfirm: true,
        }
      );
      assert.strictEqual(calls.length, 1);
      assert.ok(calls[0].startsWith('https://outlook.office.com/mail/deeplink/compose'));
      assert.ok(!calls[0].toLowerCase().includes('mailto'));
    } finally {
      Object.defineProperty(process, 'platform', { value: prevPlatform, configurable: true });
    }
  });

  it('on Windows launches the plain HTTPS work compose URL (no microsoft-edge wrapper)', () => {
    const calls = [];
    const prevPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      openOutlookWebEmail(
        { to: 'a@b.com', cc: '', bcc: '', subject: '', body: '' },
        {
          shell: { openExternal: (u) => { calls.push(u); return Promise.resolve(); } },
          accountType: 'work',
          skipConfirm: true,
        }
      );
      assert.strictEqual(calls.length, 1);
      assert.ok(
        calls[0].startsWith('https://outlook.office.com/mail/deeplink/compose'),
        'expected plain HTTPS compose URL on Windows: ' + calls[0].slice(0, 100)
      );
      assert.ok(!calls[0].startsWith('microsoft-edge:'), 'must not use microsoft-edge: wrapper');
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

describe('openOutlookWebEmail confirmation gate (H02 hardening)', () => {
  const { _resetOutlookWebAckForTests } = require('../main/openOutlookWebEmail');
  // Each test must start with a clean per-session ack flag, otherwise a
  // "remember my choice" tick in one case would carry into the next.
  beforeEach(() => { _resetOutlookWebAckForTests(); });

  it('cancels when the user cancels the dialog', async () => {
    const calls = [];
    const result = await openOutlookWebEmail(
      { to: 't@test.com', subject: 'S', body: 'sensitive body text' },
      {
        shell: { openExternal: (u) => { calls.push(u); return Promise.resolve(); } },
        dialog: { showMessageBox: async () => ({ response: 2, checkboxChecked: false }) },
      }
    );
    assert.strictEqual(calls.length, 0, 'shell.openExternal must not be called when user cancels');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.cancelled, true);
  });

  it('opens with the FULL body when the user picks the default action (response 0)', async () => {
    /* Regression test for the "typed info not transferring to Outlook" bug:
       the dialog default must NEVER strip the body. Pressing Enter or
       clicking the highlighted button must send everything the user typed. */
    const calls = [];
    const result = await openOutlookWebEmail(
      { to: 't@test.com', subject: 'S', body: 'sensitive body text' },
      {
        shell: { openExternal: (u) => { calls.push(u); return Promise.resolve(); } },
        dialog: { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) },
      }
    );
    assert.strictEqual(calls.length, 1, 'should open the URL');
    assert.ok(calls[0].includes(encodeURIComponent('sensitive body text')),
      'default action MUST include the body — otherwise the user\'s typed content is silently dropped');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.mode, 'open');
  });

  it('strips the body only when the user explicitly picks "subject only" (response 1)', async () => {
    const calls = [];
    const result = await openOutlookWebEmail(
      { to: 't@test.com', subject: 'S', body: 'sensitive body text' },
      {
        shell: { openExternal: (u) => { calls.push(u); return Promise.resolve(); } },
        dialog: { showMessageBox: async () => ({ response: 1, checkboxChecked: false }) },
      }
    );
    assert.strictEqual(calls.length, 1, 'should still open the URL, just with empty body');
    assert.ok(!calls[0].includes(encodeURIComponent('sensitive body text')),
      'body must NOT appear in the URL when subject-only mode is chosen');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.mode, 'no-body');
  });

  it('the default button is response 0 ("Open in Outlook Web") and Cancel is response 2', async () => {
    /* Pin the button order so a future refactor cannot accidentally
       reintroduce the body-stripping default. */
    let captured = null;
    await openOutlookWebEmail(
      { to: 't@test.com', subject: 'S', body: 'B' },
      {
        shell: { openExternal: () => Promise.resolve() },
        dialog: {
          showMessageBox: async (_win, opts) => {
            captured = opts;
            return { response: opts.defaultId, checkboxChecked: false };
          },
        },
      }
    );
    assert.ok(captured, 'showMessageBox was not invoked');
    assert.strictEqual(captured.defaultId, 0, 'default button must be index 0 (the full-body send)');
    assert.strictEqual(captured.cancelId, 2, 'cancel button must be index 2');
    assert.ok(/^Open in Outlook/i.test(captured.buttons[0]),
      'button 0 should be the full-body send, got: ' + captured.buttons[0]);
    assert.ok(/subject only/i.test(captured.buttons[1]),
      'button 1 should be the privacy opt-in, got: ' + captured.buttons[1]);
    assert.ok(/cancel/i.test(captured.buttons[2]),
      'button 2 should be Cancel, got: ' + captured.buttons[2]);
  });

  it('"Don\'t ask again" remembers the user\'s last mode (subject-only sticks across sends)', async () => {
    /* If a user picked "subject only" with the checkbox ticked, every
       subsequent send must also be subject-only — not silently switch
       to full body. */
    const opens = [];
    const dialog = {
      showMessageBox: async () => ({ response: 1, checkboxChecked: true }),
    };
    const shell = { openExternal: (u) => { opens.push(u); return Promise.resolve(); } };
    await openOutlookWebEmail({ to: 't@test.com', subject: 'S', body: 'private body 1' }, { shell, dialog });
    /* Second send should NOT prompt again (ack is sticky). It must still
       suppress the body because that was the user's last choice. */
    let dialogShownAgain = false;
    const shell2 = { openExternal: (u) => { opens.push(u); return Promise.resolve(); } };
    const dialog2 = { showMessageBox: async () => { dialogShownAgain = true; return { response: 0, checkboxChecked: false }; } };
    await openOutlookWebEmail({ to: 't@test.com', subject: 'S', body: 'private body 2' }, { shell: shell2, dialog: dialog2 });
    assert.strictEqual(dialogShownAgain, false, 'dialog must not reopen after Don\'t ask again');
    assert.strictEqual(opens.length, 2);
    assert.ok(!opens[0].includes(encodeURIComponent('private body 1')), 'first send should be subject-only');
    assert.ok(!opens[1].includes(encodeURIComponent('private body 2')), 'second send must respect the remembered subject-only choice');
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

describe('buildOutlookWebComposeUrl — multi-account-type support (v1.6.2)', () => {
  it('default (no accountType) preserves the legacy outlook.office.com URL for backwards-compat', () => {
    const u = buildOutlookWebComposeUrl({ to: 'a@b.c', subject: 'S', body: 'B' });
    assert.ok(u.startsWith('https://outlook.office.com/mail/deeplink/compose?'),
      'no-arg call must keep working with the office.com URL: ' + u);
  });

  it("accountType='personal' targets outlook.live.com (Outlook.com / Hotmail / Live)", () => {
    const u = buildOutlookWebComposeUrl({ accountType: 'personal', to: 'a@b.c', subject: 'S', body: 'B' });
    assert.ok(u.startsWith('https://outlook.live.com/mail/0/deeplink/compose?'),
      'personal must target outlook.live.com: ' + u);
    assert.ok(u.includes('to=' + encodeURIComponent('a@b.c')));
    assert.ok(u.includes('subject=S'));
    assert.ok(u.includes('body=B'));
  });

  it("accountType='work' targets outlook.office.com (M365)", () => {
    const u = buildOutlookWebComposeUrl({ accountType: 'work', to: 'a@b.c', subject: 'S', body: 'B' });
    assert.ok(u.startsWith('https://outlook.office.com/mail/deeplink/compose?'), u);
  });

  it("accountType='mailto' produces a RFC 6068 mailto: URI with subject + body in headers", () => {
    const u = buildOutlookWebComposeUrl({
      accountType: 'mailto',
      to: 'oic@met.police.uk',
      cc: 'cc@example.com',
      subject: 'Disclosure for John Doe',
      body: 'Hello,\n\nPlease send disclosure.',
    });
    assert.ok(u.startsWith('mailto:'), 'mailto must use mailto: scheme: ' + u);
    assert.ok(u.includes(encodeURIComponent('oic@met.police.uk')));
    assert.ok(u.includes('cc=' + encodeURIComponent('cc@example.com')));
    assert.ok(u.includes('subject=' + encodeURIComponent('Disclosure for John Doe')));
    assert.ok(u.includes('body=' + encodeURIComponent('Hello,\n\nPlease send disclosure.')));
  });

  it('accepts case-insensitive aliases (Office, M365, Hotmail, Desktop, …)', () => {
    assert.ok(buildOutlookWebComposeUrl({ accountType: 'M365', to: 'a@b.c' }).startsWith('https://outlook.office.com/'));
    assert.ok(buildOutlookWebComposeUrl({ accountType: 'Hotmail', to: 'a@b.c' }).startsWith('https://outlook.live.com/'));
    assert.ok(buildOutlookWebComposeUrl({ accountType: 'Desktop', to: 'a@b.c' }).startsWith('mailto:'));
  });

  it('preserves line breaks via percent-encoding for all surfaces', () => {
    const body = 'Line 1\nLine 2\r\nLine 3';
    for (const t of ['personal', 'work', 'mailto']) {
      const u = buildOutlookWebComposeUrl({ accountType: t, to: 'a@b.c', body });
      assert.ok(u.includes(encodeURIComponent(body)), t + ' must preserve newlines: ' + u.slice(0, 200));
    }
  });

  it('encodes ampersands, apostrophes, spaces and unicode safely (no double-encoding)', () => {
    const subject = "R v O'Brien & Co — café";
    for (const t of ['personal', 'work', 'mailto']) {
      const u = buildOutlookWebComposeUrl({ accountType: t, to: 'a@b.c', subject, body: '' });
      assert.ok(u.includes(encodeURIComponent(subject)), t + ' must encode subject exactly once');
      // double-encoding would produce %2520, %2526 etc — none must appear.
      assert.ok(!/%25(2[0-9A-F]|3[0-9A-F])/.test(u), t + ' double-encoded subject: ' + u);
    }
  });

  it('omits null/undefined fields without producing literal "undefined" / "null" text', () => {
    const u = buildOutlookWebComposeUrl({
      accountType: 'personal', to: 'a@b.c',
      cc: undefined, bcc: null, subject: undefined, body: null,
    });
    assert.ok(!u.includes('undefined'), 'must not leak the word "undefined": ' + u);
    assert.ok(!/[?&]subject=null/.test(u), 'must not leak the word "null"');
  });
});

describe('buildOutlookWebComposeUrlWithMeta — truncation per surface', () => {
  it('mailto: uses a tighter URL budget (~1900 chars) than OWA web (~6000)', () => {
    const huge = 'X'.repeat(20000);
    const mailtoMeta = buildOutlookWebComposeUrlWithMeta({ accountType: 'mailto', to: 'a@b.c', subject: 's', body: huge });
    const webMeta = buildOutlookWebComposeUrlWithMeta({ accountType: 'personal', to: 'a@b.c', subject: 's', body: huge });
    assert.strictEqual(mailtoMeta.truncated, true);
    assert.strictEqual(webMeta.truncated, true);
    assert.ok(mailtoMeta.url.length < webMeta.url.length, 'mailto must trim earlier than OWA: ' + mailtoMeta.url.length + ' vs ' + webMeta.url.length);
  });

  it('reports the chosen accountType back so the renderer can show a matching toast', () => {
    const meta = buildOutlookWebComposeUrlWithMeta({ accountType: 'personal', to: 'a@b.c', subject: 's', body: 'b' });
    assert.strictEqual(meta.accountType, 'personal');
  });
});

describe('inferOutlookAccountType — pick a sensible Outlook surface from the user\'s own email', () => {
  it('detects personal Microsoft consumer domains', () => {
    for (const e of ['me@outlook.com', 'me@hotmail.com', 'me@hotmail.co.uk', 'me@live.com', 'me@msn.com']) {
      assert.strictEqual(inferOutlookAccountType(e), 'personal', e + ' should be personal');
    }
  });
  it('treats common non-Microsoft consumer addresses (gmail, yahoo, icloud) as personal', () => {
    for (const e of ['me@gmail.com', 'me@yahoo.co.uk', 'me@icloud.com', 'me@protonmail.com']) {
      assert.strictEqual(inferOutlookAccountType(e), 'personal', e + ' should default to personal Outlook');
    }
  });
  it('treats unknown / custom-domain addresses as work (M365 is the common case in firms)', () => {
    assert.strictEqual(inferOutlookAccountType('robert@cashman-law.co.uk'), 'work');
    assert.strictEqual(inferOutlookAccountType('partner@firmname.com'), 'work');
  });
  it('falls back to the work surface (office.com) when the address is empty / malformed', () => {
    /* v1.6.4 — DEFAULT_ACCOUNT_TYPE switched from "personal" to "work"
       so the OOTB compose URL is https://outlook.office.com/mail/deeplink/compose,
       which is the surface that actually opens compose for the common
       case (solicitors on M365 firm accounts). Personal users opt in
       via Settings → Your Details → "Quick Email opens in". */
    assert.strictEqual(inferOutlookAccountType(''), 'work');
    assert.strictEqual(inferOutlookAccountType(null), 'work');
    assert.strictEqual(inferOutlookAccountType('not-an-email'), 'work');
  });
});

describe('openOutlookWebEmail — account-type plumbing + Edge-forcing rules', () => {
  const { _resetOutlookWebAckForTests } = require('../main/openOutlookWebEmail');
  beforeEach(() => { _resetOutlookWebAckForTests(); });

  function shellSpy() {
    const calls = [];
    return { calls, shell: { openExternal: (u) => { calls.push(u); return Promise.resolve(); } } };
  }

  it("personal account on Windows does NOT prefix microsoft-edge: (default browser handles outlook.live.com)", async () => {
    const prev = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const spy = shellSpy();
      await openOutlookWebEmail(
        { to: 'a@b.c', subject: 'S', body: 'B' },
        { shell: spy.shell, skipConfirm: true, accountType: 'personal' }
      );
      assert.strictEqual(spy.calls.length, 1);
      assert.ok(spy.calls[0].startsWith('https://outlook.live.com/'),
        'personal must launch outlook.live.com without microsoft-edge: prefix: ' + spy.calls[0]);
    } finally {
      Object.defineProperty(process, 'platform', { value: prev, configurable: true });
    }
  });

  it("work account on Windows uses plain HTTPS (avoids Edge/Outlook cloud shell losing compose)", async () => {
    const prev = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const spy = shellSpy();
      await openOutlookWebEmail(
        { to: 'a@b.c', subject: 'S', body: 'B' },
        { shell: spy.shell, skipConfirm: true, accountType: 'work' }
      );
      assert.ok(spy.calls[0].startsWith('https://outlook.office.com/mail/deeplink/compose'),
        'work must launch the plain office.com compose URL: ' + spy.calls[0]);
      assert.ok(!spy.calls[0].startsWith('microsoft-edge:'),
        'work must not use microsoft-edge: prefix: ' + spy.calls[0]);
    } finally {
      Object.defineProperty(process, 'platform', { value: prev, configurable: true });
    }
  });

  it("mailto account on Windows uses the OS default mail handler (no microsoft-edge:)", async () => {
    const prev = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const spy = shellSpy();
      const result = await openOutlookWebEmail(
        { to: 'oic@met.police.uk', subject: 'Hi', body: 'Hello' },
        { shell: spy.shell, skipConfirm: true, accountType: 'mailto' }
      );
      assert.ok(spy.calls[0].startsWith('mailto:'), 'mailto must use the mailto: scheme: ' + spy.calls[0]);
      assert.ok(spy.calls[0].includes(encodeURIComponent('oic@met.police.uk')));
      assert.ok(spy.calls[0].includes('subject=' + encodeURIComponent('Hi')));
      assert.ok(spy.calls[0].includes('body=' + encodeURIComponent('Hello')));
      assert.strictEqual(result.accountType, 'mailto');
    } finally {
      Object.defineProperty(process, 'platform', { value: prev, configurable: true });
    }
  });

  it('infers account type from feeEarnerEmail when caller does not pass accountType explicitly', async () => {
    const spy = shellSpy();
    const result = await openOutlookWebEmail(
      { to: 'oic@met.police.uk', subject: 'S', body: 'B', feeEarnerEmail: 'me@hotmail.co.uk' },
      { shell: spy.shell, skipConfirm: true }
    );
    assert.strictEqual(result.accountType, 'personal');
    assert.ok(spy.calls[0].startsWith('https://outlook.live.com/'));
  });

  it('copies the FULL body to the clipboard when the URL had to be trimmed', async () => {
    const huge = 'PRIVATE_BODY_' + 'X'.repeat(20000);
    let clipboardWritten = '';
    const spy = shellSpy();
    const result = await openOutlookWebEmail(
      { to: 'a@b.c', subject: 'S', body: huge },
      {
        shell: spy.shell,
        skipConfirm: true,
        accountType: 'personal',
        clipboard: { writeText: (t) => { clipboardWritten = t; } },
      }
    );
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.clipboardCopied, true);
    assert.strictEqual(clipboardWritten, huge, 'clipboard must contain the FULL untrimmed body');
  });

  it('returns a clear error result when the user cancels the confirm dialog', async () => {
    const spy = shellSpy();
    const result = await openOutlookWebEmail(
      { to: 'a@b.c', subject: 'S', body: 'B' },
      {
        shell: spy.shell,
        accountType: 'personal',
        dialog: { showMessageBox: async () => ({ response: 2, checkboxChecked: false }) },
      }
    );
    assert.strictEqual(spy.calls.length, 0);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.cancelled, true);
    assert.strictEqual(result.reason, 'user_cancelled');
    assert.strictEqual(result.accountType, 'personal');
  });
});
