/* eslint-disable no-console */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* The module pulls in `electron` for `shell` and `app`. We stub Electron via
   `require.cache` injection BEFORE requiring openComposeEml so the test
   suite does not need to spin up an Electron process. */
require.cache[require.resolve('electron')] = {
  id: require.resolve('electron'),
  filename: require.resolve('electron'),
  loaded: true,
  exports: {
    shell: { openPath: async () => '' },
    app: { getPath: () => os.tmpdir() },
  },
};

const {
  openComposeEml,
  buildEmlContent,
  _quotedPrintable,
  _encodeHeaderValue,
  _rfc2822Date,
} = require('../main/openComposeEml');

/** Parse an .eml string into { headers, body }. Headers map preserves the
 *  last-written value (sufficient for our tests; we never write duplicates). */
function parseEml(eml) {
  const idx = eml.indexOf('\r\n\r\n');
  assert.notStrictEqual(idx, -1, 'eml must use CRLF and have an empty header/body separator');
  const headerBlock = eml.slice(0, idx);
  const body = eml.slice(idx + 4);
  const headers = {};
  /* Unfold continuation lines (RFC 5322 §2.2.3). */
  const unfolded = headerBlock.replace(/\r\n[ \t]+/g, ' ');
  unfolded.split('\r\n').forEach((line) => {
    const colon = line.indexOf(':');
    if (colon < 0) return;
    const k = line.slice(0, colon).trim();
    const v = line.slice(colon + 1).trim();
    headers[k.toLowerCase()] = v;
  });
  return { headers, body };
}

/** Decode a quoted-printable body back to UTF-8 plain text. */
function decodeQp(body) {
  /* Soft line breaks (= at end of line) are continuation markers, drop them. */
  let cleaned = body.replace(/=\r\n/g, '');
  /* Decode =XX sequences into raw bytes, then UTF-8 decode the whole thing. */
  const bytes = [];
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === '=' && i + 2 < cleaned.length) {
      const hex = cleaned.substr(i + 1, 2);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    if (c === '\r') continue;
    if (c === '\n') { bytes.push(0x0a); continue; }
    bytes.push(c.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Decode an RFC 2047 base64 word back to UTF-8 plain text. */
function decodeRfc2047(value) {
  const m = String(value).match(/^=\?UTF-8\?B\?([^?]+)\?=$/i);
  if (!m) return value;
  return Buffer.from(m[1], 'base64').toString('utf8');
}

test('buildEmlContent: produces RFC 822 with X-Unsent: 1 header', () => {
  const eml = buildEmlContent({
    to: 'oic@example.com',
    subject: 'Test',
    body: 'Hello',
  });
  const { headers, body } = parseEml(eml);
  assert.strictEqual(headers['x-unsent'], '1', 'X-Unsent: 1 is the magic header that opens compose');
  assert.strictEqual(headers['mime-version'], '1.0');
  assert.strictEqual(headers['to'], 'oic@example.com');
  assert.strictEqual(headers['subject'], 'Test');
  assert.match(headers['content-type'] || '', /text\/plain/);
  assert.match(headers['content-transfer-encoding'] || '', /quoted-printable/i);
  assert.match(decodeQp(body), /Hello/);
});

test('buildEmlContent: preserves paragraph breaks in the body', () => {
  const original = 'Dear Officer Jarvis,\n\nI am instructed in relation to David Walter, who is attending Maidstone Police Station on 30/04/2026 at 09:00 as a voluntary attendee in relation to Common Assault.\n\nPlease could you provide disclosure ahead of the interview, or alternatively contact me so that I can take instructions.\n\nKind regards,\nRobert Cashman';
  const eml = buildEmlContent({ to: 'a@b.com', subject: 's', body: original });
  const { body } = parseEml(eml);
  const decoded = decodeQp(body).replace(/\r\n/g, '\n').replace(/\n+$/, '');
  assert.strictEqual(decoded, original, 'body must round-trip verbatim including blank lines');
});

test('buildEmlContent: encodes non-ASCII subject via RFC 2047 base64 UTF-8', () => {
  const eml = buildEmlContent({
    to: 'a@b.com',
    subject: 'Café résumé — déjà vu',
    body: 'x',
  });
  const { headers } = parseEml(eml);
  assert.match(headers['subject'], /^=\?UTF-8\?B\?/, 'non-ASCII subjects need RFC 2047 encoding');
  assert.strictEqual(decodeRfc2047(headers['subject']), 'Café résumé — déjà vu');
});

test('buildEmlContent: ASCII subject is NOT encoded (kept readable)', () => {
  const eml = buildEmlContent({
    to: 'a@b.com',
    subject: 'Disclosure request - David Walter - Maidstone - 30/04/2026',
    body: 'x',
  });
  const { headers } = parseEml(eml);
  assert.strictEqual(headers['subject'], 'Disclosure request - David Walter - Maidstone - 30/04/2026');
});

test('buildEmlContent: refuses CR/LF injection in headers (To, Subject)', () => {
  const eml = buildEmlContent({
    to: 'a@b.com\r\nBcc: leak@evil.com',
    subject: 'x\r\nX-Injected: yes',
    body: 'x',
  });
  /* The actual security property: NO CRLF anywhere inside a header value, so
     a malicious value cannot start a new header line. We check the raw eml
     to see that the only CRLFs in the header block are the legitimate ones
     between header lines (i.e. no CRLF appears DIRECTLY before "Bcc:" or
     "X-Injected:" anywhere). */
  assert.doesNotMatch(eml, /\r\nBcc:/i, 'CRLF before Bcc would mean header injection succeeded');
  assert.doesNotMatch(eml, /\r\nX-Injected:/i, 'CRLF before X-Injected would mean header injection succeeded');
  /* The injected text is kept inside its enclosing header value; for the
     To header CRLF acts as an address separator, so the malicious "Bcc: …"
     is preserved as a (junk) recipient string rather than a new header.
     The Subject is collapsed to a single line with a space. */
  assert.match(eml, /\r\nTo: a@b\.com, Bcc: leak@evil\.com\r\n/);
  assert.match(eml, /\r\nSubject: x X-Injected: yes\r\n/);
});

test('buildEmlContent: comma- or semicolon-separated To list normalises to "addr, addr"', () => {
  const eml = buildEmlContent({
    to: 'one@x.com; two@x.com,three@x.com',
    subject: 's',
    body: 'b',
  });
  const { headers } = parseEml(eml);
  assert.strictEqual(headers['to'], 'one@x.com, two@x.com, three@x.com');
});

test('buildEmlContent: Cc and Bcc headers are emitted only when populated', () => {
  const withCc = buildEmlContent({ to: 'a@b.com', cc: 'c@d.com', subject: 's', body: 'b' });
  assert.match(withCc, /\r\nCc: c@d\.com\r\n/);
  const withoutCc = buildEmlContent({ to: 'a@b.com', subject: 's', body: 'b' });
  assert.doesNotMatch(withoutCc, /\r\nCc:/);
  assert.doesNotMatch(withoutCc, /\r\nBcc:/);
});

test('buildEmlContent: every header line is CRLF terminated (Outlook is strict)', () => {
  const eml = buildEmlContent({ to: 'a@b.com', subject: 's', body: 'b' });
  const lines = eml.split('\r\n');
  /* The header block must have at least 8 lines (MIME-Version, Date,
     Message-ID, X-Unsent, To, Subject, Content-Type, CTE) and at no point
     contain a bare \n. */
  assert.ok(lines.length >= 9);
  assert.doesNotMatch(eml.replace(/\r\n/g, ''), /\n/, 'no bare LF anywhere outside CRLF');
});

test('_quotedPrintable: encodes "=" as =3D, leaves space alone mid-line, =20 at EOL', () => {
  assert.strictEqual(_quotedPrintable('a=b'), 'a=3Db');
  /* Trailing space on a line must become =20 to survive transfer. */
  const out = _quotedPrintable('hello \nworld');
  assert.match(out, /hello=20\r\nworld/);
});

test('_quotedPrintable: keeps lines under 76 chars with soft line breaks', () => {
  const long = 'x'.repeat(200);
  const enc = _quotedPrintable(long);
  enc.split('\r\n').forEach((line) => {
    /* The 76-char limit includes the trailing soft '=' so keep some slack. */
    assert.ok(line.length <= 76, 'line too long: ' + line.length + ' chars');
  });
});

test('_quotedPrintable: encodes UTF-8 multi-byte chars as =XX=YY sequences', () => {
  /* "é" is 0xC3 0xA9 in UTF-8 — must appear as =C3=A9. */
  const out = _quotedPrintable('é');
  assert.strictEqual(out, '=C3=A9');
});

test('_encodeHeaderValue: ASCII passes through unchanged', () => {
  assert.strictEqual(_encodeHeaderValue('Plain ASCII'), 'Plain ASCII');
});

test('_encodeHeaderValue: empty / null returns empty string', () => {
  assert.strictEqual(_encodeHeaderValue(''),    '');
  assert.strictEqual(_encodeHeaderValue(null),  '');
  assert.strictEqual(_encodeHeaderValue(undefined), '');
});

test('_rfc2822Date: produces a parseable RFC 2822 date', () => {
  const fixed = new Date(Date.UTC(2026, 3, 30, 6, 42, 11));
  const s = _rfc2822Date(fixed);
  /* Format: "Thu, 30 Apr 2026 HH:MM:11 ±HHMM"  (HH/MM depend on timezone). */
  assert.match(s, /^Thu, 30 Apr 2026 \d{2}:\d{2}:11 [+-]\d{4}$/, 'got: ' + s);
});

test('openComposeEml: writes an .eml to the temp dir and asks shell.openPath to open it', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-eml-'));
  const opens = [];
  const result = await openComposeEml(
    {
      to: 'oic@example.com',
      subject: 'Disclosure request - David Walter - Maidstone - 30/04/2026',
      body: 'Dear Officer Jarvis,\n\nBody here.\n\nKind regards,\nRobert Cashman',
    },
    {
      tempDir,
      shell: { openPath: async (p) => { opens.push(p); return ''; } },
      skipCleanup: true, /* keep file so we can assert its contents */
    }
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.accountType, 'desktop');
  assert.strictEqual(result.composeSignature, true);
  assert.strictEqual(result.composeReason, 'eml_x_unsent_draft');
  assert.strictEqual(opens.length, 1, 'shell.openPath called exactly once');
  assert.strictEqual(opens[0], result.filePath);
  assert.ok(fs.existsSync(result.filePath), 'eml file must exist on disk');
  const eml = fs.readFileSync(result.filePath, 'utf8');
  const { headers, body } = parseEml(eml);
  assert.strictEqual(headers['x-unsent'], '1');
  assert.strictEqual(headers['to'], 'oic@example.com');
  assert.strictEqual(headers['subject'], 'Disclosure request - David Walter - Maidstone - 30/04/2026');
  assert.match(decodeQp(body), /Dear Officer Jarvis,/);
  assert.match(decodeQp(body), /Robert Cashman/);
  fs.unlinkSync(result.filePath);
  fs.rmdirSync(tempDir);
});

test('openComposeEml: throws and cleans up the orphan file when shell.openPath fails', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-eml-'));
  const filesBefore = fs.readdirSync(tempDir);
  await assert.rejects(
    openComposeEml(
      { to: 'a@b.com', subject: 's', body: 'b' },
      {
        tempDir,
        shell: { openPath: async () => 'simulated open failure' },
      }
    ),
    /shell\.openPath failed: simulated open failure/
  );
  const filesAfter = fs.readdirSync(tempDir);
  assert.deepStrictEqual(filesAfter, filesBefore, 'orphan eml must be cleaned up on failure');
  fs.rmdirSync(tempDir);
});

test('openComposeEml: throws and cleans up when the shell API itself rejects', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-eml-'));
  await assert.rejects(
    openComposeEml(
      { to: 'a@b.com', subject: 's', body: 'b' },
      {
        tempDir,
        shell: { openPath: async () => { throw new Error('shell missing'); } },
      }
    ),
    /shell missing/
  );
  const filesAfter = fs.readdirSync(tempDir);
  assert.deepStrictEqual(filesAfter, [], 'orphan eml must be cleaned up on shell rejection');
  fs.rmdirSync(tempDir);
});

test('openComposeEml: ACCEPTANCE — David Walter disclosure eml has full populated draft fields', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-eml-'));
  const expectedSubject = 'Disclosure request - David Walter - Maidstone - 30/04/2026';
  const expectedBody = [
    'Dear Officer Jarvis,',
    '',
    'I am instructed in relation to David Walter, who is attending Maidstone Police Station on 30/04/2026 at 09:00 as a voluntary attendee in relation to Common Assault.',
    '',
    'Please could you provide disclosure ahead of the interview, or alternatively contact me so that I can take instructions.',
    '',
    'Kind regards,',
    'Robert Cashman',
  ].join('\n');

  const result = await openComposeEml(
    {
      to: '30052@kent.police.uk',
      subject: expectedSubject,
      body: expectedBody,
    },
    {
      tempDir,
      shell: { openPath: async () => '' },
      skipCleanup: true,
    }
  );

  const eml = fs.readFileSync(result.filePath, 'utf8');
  const { headers, body } = parseEml(eml);

  assert.strictEqual(headers['x-unsent'], '1', 'must have X-Unsent: 1 so Outlook treats this as a draft');
  assert.strictEqual(headers['to'], '30052@kent.police.uk');
  assert.strictEqual(headers['subject'], expectedSubject);
  const decoded = decodeQp(body).replace(/\r\n/g, '\n').replace(/\n+$/, '');
  assert.strictEqual(decoded, expectedBody, 'body must round-trip verbatim');
  fs.unlinkSync(result.filePath);
  fs.rmdirSync(tempDir);
});
