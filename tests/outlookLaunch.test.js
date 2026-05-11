'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SEND_METHODS,
  OWA_COMPOSE_BASE,
  validatePayload,
  buildEmlContent,
  buildOwaComposeUrl,
  buildMailtoUri,
  redactForLog,
  formatLogLine,
  recommendSendMethod,
} = require('../lib/outlookLaunch');

const VALID = Object.freeze({
  to: 'dc.jarvis@police.uk',
  subject: 'Smith - Disclosure request',
  body: 'Dear DC Jarvis,\n\nPlease provide disclosure for the matter of John Smith.\n\nKind regards,\nRobert Cashman',
});

test('SEND_METHODS lists exactly the four supported send methods', () => {
  assert.deepEqual([...SEND_METHODS], ['outlook-desktop', 'outlook-web', 'default-mailto', 'copy-only']);
});

test('validatePayload accepts a well-formed payload', () => {
  const r = validatePayload(VALID);
  assert.equal(r.ok, true);
  assert.equal(r.error, undefined);
});

test('validatePayload rejects missing to / subject / body', () => {
  assert.equal(validatePayload({ ...VALID, to: '' }).ok, false);
  assert.equal(validatePayload({ ...VALID, subject: '' }).ok, false);
  assert.equal(validatePayload({ ...VALID, body: '   ' }).ok, false);
  assert.equal(validatePayload(null).ok, false);
  assert.equal(validatePayload(undefined).ok, false);
});

test('validatePayload rejects CR/LF in to or subject (header injection)', () => {
  assert.equal(validatePayload({ ...VALID, to: 'a@b.com\r\nBcc: evil@x' }).ok, false);
  assert.equal(validatePayload({ ...VALID, subject: 'X\nInjected: yes' }).ok, false);
});

test('validatePayload enforces length limits', () => {
  assert.equal(validatePayload({ ...VALID, subject: 'x'.repeat(2000) }).ok, false);
  assert.equal(validatePayload({ ...VALID, body: 'x'.repeat(60000) }).ok, false);
});

test('buildEmlContent emits CRLF line endings throughout', () => {
  const eml = buildEmlContent(VALID);
  /* No bare LFs except when preceded by CR. */
  for (let i = 0; i < eml.length; i++) {
    if (eml[i] === '\n') {
      assert.equal(eml[i - 1], '\r', 'bare LF at position ' + i);
    }
  }
  /* No bare CRs except when followed by LF. */
  for (let i = 0; i < eml.length - 1; i++) {
    if (eml[i] === '\r') {
      assert.equal(eml[i + 1], '\n', 'bare CR at position ' + i);
    }
  }
});

test('buildEmlContent includes mandatory MIME / draft headers', () => {
  const eml = buildEmlContent(VALID);
  assert.ok(eml.includes('MIME-Version: 1.0\r\n'), 'has MIME-Version');
  assert.ok(eml.includes('Content-Type: text/plain; charset=utf-8\r\n'), 'has Content-Type');
  assert.ok(eml.includes('Content-Transfer-Encoding: 8bit\r\n'), 'has CTE');
  assert.ok(eml.includes('X-Unsent: 1\r\n'), 'has X-Unsent draft hint');
  assert.ok(eml.includes('X-Mailer: CustodyNote\r\n'), 'has X-Mailer');
  assert.match(eml, /Date: [A-Z][a-z]{2}, /, 'has RFC-formatted Date');
  assert.ok(eml.includes('To: dc.jarvis@police.uk\r\n'), 'has To');
  assert.ok(eml.includes('Subject: Smith - Disclosure request\r\n'), 'has Subject');
});

test('buildEmlContent has empty line separating headers from body', () => {
  const eml = buildEmlContent(VALID);
  const idx = eml.indexOf('\r\n\r\n');
  assert.ok(idx > 0, 'header/body boundary present');
  const body = eml.slice(idx + 4);
  /* Body retains paragraph breaks as CRLF */
  assert.ok(body.includes('Dear DC Jarvis,\r\n\r\nPlease provide disclosure'));
});

test('buildEmlContent does NOT include From: (Outlook fills from active account)', () => {
  const eml = buildEmlContent(VALID);
  assert.ok(!/^From:/m.test(eml.split('\r\n\r\n')[0]), 'no From: header');
});

test('buildEmlContent rfc-2047 encodes non-ASCII subject', () => {
  const eml = buildEmlContent({ ...VALID, subject: 'Café — review' });
  /* base64 of "Café — review" UTF-8 is "Q2Fmw6kg4oCUIHJldmlldw==" */
  assert.match(eml, /Subject: =\?utf-8\?B\?[A-Za-z0-9+/]+=*\?=\r\n/);
});

test('buildEmlContent throws on invalid payload', () => {
  assert.throws(() => buildEmlContent({ to: '', subject: 's', body: 'b' }));
});

test('buildOwaComposeUrl uses the M365 deeplink endpoint', () => {
  const url = buildOwaComposeUrl(VALID);
  assert.ok(url.startsWith(OWA_COMPOSE_BASE + '?'), 'starts with deeplink/compose base');
});

test('buildOwaComposeUrl percent-encodes & in subject so URL never breaks', () => {
  const url = buildOwaComposeUrl({ ...VALID, subject: 'A & B & C' });
  /* `&` inside the subject value must be `%26`, not the literal `&` (which
     would be parsed as a query-param separator and break the URL). */
  assert.ok(url.includes('subject=A+%26+B+%26+C') || url.includes('subject=A%20%26%20B%20%26%20C'));
  /* Either way: there must be exactly TWO `&` separators (between to/subject
     and between subject/body). */
  const ampCount = (url.match(/&/g) || []).length;
  assert.equal(ampCount, 2, 'exactly two & query separators');
});

test('buildOwaComposeUrl preserves paragraph breaks via CRLF in body', () => {
  const url = buildOwaComposeUrl(VALID);
  /* %0D%0A is CRLF — OWA renders this as a paragraph break. */
  assert.ok(url.includes('%0D%0A'), 'body has CRLF percent-encoding');
});

test('buildOwaComposeUrl is parseable as a valid URL', () => {
  const url = buildOwaComposeUrl(VALID);
  /* Throws if invalid. */
  const parsed = new URL(url);
  assert.equal(parsed.hostname, 'outlook.office.com');
  assert.equal(parsed.pathname, '/mail/deeplink/compose');
  assert.equal(parsed.searchParams.get('to'), VALID.to);
  assert.equal(parsed.searchParams.get('subject'), VALID.subject);
  /* OWA expects CRLF between paragraphs; URLSearchParams round-trips it. */
  const bodyOut = parsed.searchParams.get('body');
  assert.ok(bodyOut.includes('Please provide disclosure'));
});

test('buildMailtoUri encodes spaces as %20 (RFC 6068), not + (URL form)', () => {
  const uri = buildMailtoUri(VALID);
  assert.ok(uri.startsWith('mailto:'));
  /* Subject "Smith - Disclosure request" has spaces; must be %20 not +. */
  assert.ok(uri.includes('subject=Smith%20-%20Disclosure%20request'));
  assert.ok(!uri.includes('subject=Smith+-+Disclosure+request'),
    '+ for space breaks RFC 6068 — must be %20');
});

test('buildMailtoUri uses LF body newlines (mail clients expect %0A)', () => {
  const uri = buildMailtoUri(VALID);
  /* Body has \n which becomes %0A — Outlook/Thunderbird/Apple Mail all treat
     %0A as a paragraph break in mailto:. */
  assert.ok(uri.includes('%0A'));
});

test('buildMailtoUri exactly two query-string fields', () => {
  const uri = buildMailtoUri(VALID);
  const queryStart = uri.indexOf('?');
  const query = uri.slice(queryStart + 1);
  /* Should be `subject=...&body=...` — exactly one `&`. */
  const ampCount = (query.match(/&/g) || []).length;
  assert.equal(ampCount, 1, 'exactly one & between subject and body params');
});

test('redactForLog never includes recipient address, subject text, or body text', () => {
  const r = redactForLog({
    to: 'dc.jarvis@police.uk',
    subject: 'CONFIDENTIAL - case 12345',
    body: 'Dear officer, our client...',
  });
  assert.equal(r.toDomain, 'police.uk');
  assert.equal(r.subjectLength, 'CONFIDENTIAL - case 12345'.length);
  assert.equal(r.bodyLength, 'Dear officer, our client...'.length);
  assert.ok(!('to' in r));
  assert.ok(!('subject' in r));
  assert.ok(!('body' in r));
  /* Sanity: stringify the whole record and grep for the local-part/case ref */
  const json = JSON.stringify(r);
  assert.ok(!/dc\.jarvis/.test(json), 'recipient local-part must not appear');
  assert.ok(!/CONFIDENTIAL/.test(json), 'subject text must not appear');
  assert.ok(!/Dear officer/.test(json), 'body text must not appear');
});

test('redactForLog handles missing @ gracefully', () => {
  const r = redactForLog({ to: 'not-an-email', subject: 's', body: 'b' });
  assert.equal(r.toDomain, '(no-at)');
});

test('formatLogLine produces a one-line PII-safe entry with status / method / lengths', () => {
  const line = formatLogLine({
    ts: '2026-05-11T22:00:00.000Z',
    method: 'outlook-desktop',
    ok: true,
    redacted: { toDomain: 'police.uk', subjectLength: 25, bodyLength: 200 },
    durationMs: 412,
  });
  assert.ok(line.startsWith('2026-05-11T22:00:00.000Z OK outlook-desktop'));
  assert.ok(line.includes('toDomain=police.uk'));
  assert.ok(line.includes('subjLen=25'));
  assert.ok(line.includes('bodyLen=200'));
  assert.ok(line.includes('dur=412ms'));
  assert.ok(!line.includes('\n'), 'one-line — no embedded newlines');
});

test('formatLogLine includes truncated error on FAIL', () => {
  const longErr = 'x'.repeat(500);
  const line = formatLogLine({
    method: 'outlook-web',
    ok: false,
    error: longErr,
    redacted: { toDomain: 'x.com', subjectLength: 1, bodyLength: 1 },
  });
  assert.ok(line.startsWith(/^[\d-]+T[\d:.]+Z FAIL outlook-web/.toString().slice(1, -1).replace(/\\/g, '') )
    || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z FAIL outlook-web/.test(line));
  /* Truncated to 200 chars by the formatter. */
  const m = line.match(/err="(x+)"/);
  assert.ok(m);
  assert.ok(m[1].length <= 200);
});

test('recommendSendMethod prefers outlook-desktop when Outlook is installed', () => {
  assert.equal(recommendSendMethod({ outlookDesktopInstalled: true }), 'outlook-desktop');
  assert.equal(recommendSendMethod({ outlookDesktopInstalled: true, defaultMailtoApp: 'ChromeHTML' }), 'outlook-desktop');
});

test('recommendSendMethod uses default-mailto only for recognized mail-app ProgIds', () => {
  assert.equal(recommendSendMethod({ defaultMailtoApp: 'Outlook.URL.mailto.15' }), 'default-mailto');
  assert.equal(recommendSendMethod({ defaultMailtoApp: 'Mozilla.Thunderbird' }), 'default-mailto');
  /* Browser-hosted mailto handler — DON'T use default-mailto (would render as text). */
  assert.equal(recommendSendMethod({ defaultMailtoApp: 'ChromeHTML' }), 'outlook-web');
  assert.equal(recommendSendMethod({ defaultMailtoApp: 'MSEdgeHTM' }), 'outlook-web');
});

test('recommendSendMethod falls back to outlook-web when nothing is installed', () => {
  assert.equal(recommendSendMethod({}), 'outlook-web');
  assert.equal(recommendSendMethod({ outlookDesktopInstalled: false, defaultMailtoApp: null }), 'outlook-web');
});
