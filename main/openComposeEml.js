'use strict';

/**
 * Open a fully-populated Outlook compose window via an .eml draft file.
 *
 * Why this exists
 * ---------------
 * Web URL strategies (outlook.office.com/mail/deeplink/compose,
 * outlook.office.com/owa/?path=/mail/action/compose, outlook.live.com)
 * are inherently unreliable: even when we send a syntactically perfect
 * compose URL, Outlook can server-side route the user back to the inbox
 * (tenant policy, multi-account, Edge work-profile shell, etc).
 *
 * This module sidesteps the web entirely. It writes a tiny RFC 822 .eml
 * file with the X-Unsent: 1 header (the magic flag that tells Outlook
 * "treat me as a draft"), then asks the OS to open it. On Windows with
 * Outlook installed, the .eml extension is registered to Outlook (verify
 * with `assoc .eml` → `Outlook.File.eml.15`), so opening it pops the
 * Outlook desktop compose window pre-populated with To/Cc/Bcc/Subject/Body
 * — every time, regardless of browser session state.
 *
 * Cleanup: temp .eml files are written to the OS temp dir and deleted
 * after a short grace period so Outlook has time to import them.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { shell, app } = require('electron');

const CRLF = '\r\n';
const TEMP_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes — Outlook reads file immediately

function _toAddrList(value) {
  if (value == null) return '';
  /* Accept arrays, or comma/semicolon/CRLF-separated strings. CRLF is
     treated as a separator (NOT as a header break) so addresses pasted
     from Outlook one-per-line normalise correctly AND a malicious CR/LF
     embedded in a single address can never start a new header. */
  var parts;
  if (Array.isArray(value)) {
    parts = value.map(function(v) { return String(v == null ? '' : v); });
  } else {
    parts = String(value).split(/[,;\r\n]+/);
  }
  return parts
    .map(function(v) { return _stripHeaderInjection(v); })
    .filter(Boolean)
    .join(', ');
}

function _stripHeaderInjection(s) {
  /* Belt-and-braces: refuse CR/LF in any header value. Outlook would
     interpret embedded CRLF as a new header → potential header injection. */
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
}

function _needsRfc2047(s) {
  return /[^\x20-\x7E]/.test(String(s || ''));
}

/** RFC 2047 base64-encoded UTF-8 for headers containing non-ASCII (subject). */
function _encodeHeaderValue(raw) {
  var s = _stripHeaderInjection(raw);
  if (!s) return '';
  if (!_needsRfc2047(s)) return s;
  var b64 = Buffer.from(s, 'utf8').toString('base64');
  return '=?UTF-8?B?' + b64 + '?=';
}

/**
 * Quoted-printable encode a UTF-8 body for the Content-Transfer-Encoding header.
 * Keeps line length ≤ 76 chars per RFC 2045 §6.7. Spaces at end-of-line are
 * encoded as =20 to survive transfer; '=' itself is encoded as =3D.
 */
function _quotedPrintable(text) {
  var bytes = Buffer.from(String(text == null ? '' : text), 'utf8');
  var out = '';
  var line = '';

  function pushChunk(chunk) {
    /* If adding this chunk would exceed 75 chars (1 char reserved for soft
       line-break '='), close the current line with a soft break. */
    if (line.length + chunk.length > 75) {
      out += line + '=' + CRLF;
      line = '';
    }
    line += chunk;
  }

  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b === 0x0D /* \r */) continue; /* normalise CRLF/CR to LF below */
    if (b === 0x0A /* \n */) {
      /* Trailing space/tab on a line must be encoded so the recipient does
         not strip them. */
      if (line.length > 0) {
        var lastCh = line.charCodeAt(line.length - 1);
        if (lastCh === 0x20 || lastCh === 0x09) {
          line = line.slice(0, -1) + (lastCh === 0x20 ? '=20' : '=09');
        }
      }
      out += line + CRLF;
      line = '';
      continue;
    }
    if (b === 0x3D /* = */) { pushChunk('=3D'); continue; }
    if (b >= 0x20 && b <= 0x7E) {
      pushChunk(String.fromCharCode(b));
      continue;
    }
    /* Non-printable / 8-bit byte → =XX */
    var hex = b.toString(16).toUpperCase();
    if (hex.length === 1) hex = '0' + hex;
    pushChunk('=' + hex);
  }
  out += line;
  return out;
}

function _generateMessageId() {
  var rand = crypto.randomBytes(8).toString('hex');
  return '<' + Date.now().toString(36) + '.' + rand + '@custody-note.local>';
}

/** RFC 2822 date string, e.g. "Wed, 30 Apr 2026 06:42:11 +0000". */
function _rfc2822Date(d) {
  d = d || new Date();
  var DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  var tz = -d.getTimezoneOffset();
  var sign = tz >= 0 ? '+' : '-';
  var absTz = Math.abs(tz);
  var tzStr = sign + pad(Math.floor(absTz / 60)) + pad(absTz % 60);
  return DAY[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()] + ' '
    + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    + ':' + pad(d.getSeconds()) + ' ' + tzStr;
}

/**
 * Build the full RFC 822 .eml content for a draft message that Outlook will
 * open in compose mode. The X-Unsent: 1 header is the critical bit.
 *
 * Inputs are sanitised: no CR/LF in headers (anti-injection), subject is
 * RFC 2047 encoded if it contains non-ASCII characters, body is sent as
 * quoted-printable UTF-8 plain text so paragraph breaks are preserved
 * exactly as the user typed them.
 */
function buildEmlContent(payload) {
  payload = payload || {};
  var to = _toAddrList(payload.to);
  var cc = _toAddrList(payload.cc);
  var bcc = _toAddrList(payload.bcc);
  var from = _stripHeaderInjection(payload.from);
  var subject = _encodeHeaderValue(payload.subject);
  var body = String(payload.body == null ? '' : payload.body);

  var headers = [];
  headers.push('MIME-Version: 1.0');
  headers.push('Date: ' + _rfc2822Date(payload._fixedDate));
  headers.push('Message-ID: ' + _generateMessageId());
  /* X-Unsent: 1 — Outlook recognises this and opens the file in compose,
     not as a read-only received message. This is the critical bit. */
  headers.push('X-Unsent: 1');
  if (from) headers.push('From: ' + from);
  if (to)   headers.push('To: ' + to);
  if (cc)   headers.push('Cc: ' + cc);
  if (bcc)  headers.push('Bcc: ' + bcc);
  headers.push('Subject: ' + subject);
  headers.push('Content-Type: text/plain; charset=UTF-8; format=flowed');
  headers.push('Content-Transfer-Encoding: quoted-printable');

  return headers.join(CRLF) + CRLF + CRLF + _quotedPrintable(body) + CRLF;
}

/**
 * Write the .eml to a temp file and ask the OS to open it. On Windows that
 * means Outlook (because .eml is registered to Outlook); on macOS/Linux the
 * default mail handler will be used.
 *
 * Returns: { ok, filePath, launchMethod, accountType: 'desktop' }
 */
async function openComposeEml(payload, deps) {
  deps = deps || {};
  var shellApi = deps.shell != null ? deps.shell : shell;
  var fsApi = deps.fs != null ? deps.fs : fs;
  var tempDir;
  try {
    tempDir = (deps.tempDir != null ? deps.tempDir : (app && typeof app.getPath === 'function' ? app.getPath('temp') : os.tmpdir()));
  } catch (_) { tempDir = os.tmpdir(); }

  var content = buildEmlContent(payload || {});
  var stamp = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  var filePath = path.join(tempDir, 'custody-note-draft-' + stamp + '.eml');

  fsApi.writeFileSync(filePath, content, { encoding: 'utf8' });

  /* shell.openPath hands the file to the OS-registered handler — Outlook
     desktop on Windows when .eml is associated with Outlook (verified via
     HKLM\SOFTWARE\Classes\.eml → Outlook.File.eml.15). */
  var openErr = '';
  try {
    if (typeof shellApi.openPath === 'function') {
      openErr = await shellApi.openPath(filePath);
    } else if (typeof shellApi.openExternal === 'function') {
      await shellApi.openExternal('file:///' + filePath.replace(/\\/g, '/'));
    } else {
      throw new Error('No shell API available to open .eml file');
    }
  } catch (err) {
    /* Best-effort cleanup of the orphan temp file. */
    try { fsApi.unlinkSync(filePath); } catch (_) {}
    throw err;
  }
  if (openErr) {
    /* shell.openPath returns a non-empty string when it fails. */
    try { fsApi.unlinkSync(filePath); } catch (_) {}
    throw new Error('shell.openPath failed: ' + openErr);
  }

  /* Schedule cleanup so we do not pollute the temp dir indefinitely.
     Outlook reads the file immediately and creates its own draft, so it is
     safe to delete after a short grace period. */
  if (deps.skipCleanup !== true) {
    setTimeout(function() {
      try { fsApi.unlinkSync(filePath); } catch (_) { /* best effort */ }
    }, deps.cleanupAfterMs || TEMP_LIFETIME_MS).unref?.();
  }

  return {
    ok: true,
    accountType: 'desktop',
    launchMethod: 'shell-openPath-eml',
    filePath: filePath,
    composeSignature: true,
    composeReason: 'eml_x_unsent_draft',
  };
}

module.exports = {
  openComposeEml,
  buildEmlContent,
  /* Exposed for tests only. */
  _quotedPrintable: _quotedPrintable,
  _encodeHeaderValue: _encodeHeaderValue,
  _rfc2822Date: _rfc2822Date,
};
