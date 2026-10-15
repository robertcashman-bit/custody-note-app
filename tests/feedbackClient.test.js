const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const F = require('../lib/feedbackClient');
const { resultMessage } = require('../renderer/help-feedback.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cn-fb-')); }
function res(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

describe('feedbackClient', () => {
  let dir;
  beforeEach(() => { dir = tmp(); });

  it('validates type, length and email', () => {
    assert.strictEqual(F.validate({ type: 'x', message: 'long enough text' }).ok, false);
    assert.strictEqual(F.validate({ type: 'idea', message: 'short' }).ok, false);
    assert.strictEqual(F.validate({ type: 'idea', message: 'long enough text', email: 'bad' }).ok, false);
    assert.strictEqual(F.validate({ type: 'support', message: 'long enough text' }).ok, true);
  });

  it('reads the last 50 sync.log lines and scrubs emails', () => {
    fs.mkdirSync(path.join(dir, 'logs'));
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i} a@b.com`);
    fs.writeFileSync(path.join(dir, 'logs', 'sync.log'), lines.join('\n') + '\n');
    const tail = F.readSyncLogTail(dir).split('\n');
    assert.strictEqual(tail.length, 50);
    assert.strictEqual(tail[49], 'line 79 [email]');
    assert.strictEqual(F.readSyncLogTail(tmp()), '');
  });

  it('registers once, then sends a signed request with metadata', async () => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/register')) return res(200, { installToken: 'tok' });
      return res(200, { ok: true });
    };
    const c = F.createFeedbackClient({ userDataDir: dir, fetch, now: () => 1234 });
    const r = await c.submit({ type: 'problem', message: 'Sync stays pending' }, { appVersion: '1.9.114', os: 'win32', tier: 'free', diagnostics: 'log' });
    assert.deepStrictEqual(r, { ok: true, queued: false });
    const post = calls[1];
    const body = JSON.parse(post.init.body);
    assert.strictEqual(body.source, 'app');
    assert.strictEqual(body.appVersion, '1.9.114');
    assert.strictEqual(body.diagnostics, 'log');
    const h = post.init.headers;
    const expect = crypto.createHmac('sha256', 'tok').update(h['X-CN-Install'] + '.1234.' + post.init.body).digest('hex');
    assert.strictEqual(h['X-CN-Signature'], expect);
    await c.submit({ type: 'idea', message: 'Another idea here' }, {});
    assert.strictEqual(calls.filter((x) => x.url.endsWith('/register')).length, 1);
  });

  it('omits the log when the user unticks it', async () => {
    let sent;
    const fetch = async (url, init) => url.endsWith('/register') ? res(200, { installToken: 't' }) : (sent = JSON.parse(init.body), res(200, {}));
    const c = F.createFeedbackClient({ userDataDir: dir, fetch });
    await c.submit({ type: 'support', message: 'How do I export?' }, { includeLog: false, diagnostics: 'secret-ish' });
    assert.strictEqual(sent.diagnostics, '');
  });

  it('queues when offline and flushes later', async () => {
    let online = false;
    const fetch = async (url) => {
      if (!online) throw new Error('ENOTFOUND');
      return url.endsWith('/register') ? res(200, { installToken: 't' }) : res(200, {});
    };
    const c = F.createFeedbackClient({ userDataDir: dir, fetch });
    const r = await c.submit({ type: 'problem', message: 'Offline report text' }, {});
    assert.deepStrictEqual([r.ok, r.queued], [true, true]);
    assert.strictEqual(c.readQueue().length, 1);
    assert.deepStrictEqual(await c.flushQueue(), { sent: 0, remaining: 1 });
    online = true;
    assert.deepStrictEqual(await c.flushQueue(), { sent: 1, remaining: 0 });
  });

  it('reports a server refusal without queueing', async () => {
    const fetch = async (url) => url.endsWith('/register') ? res(200, { installToken: 't' }) : res(400, { error: 'Please include no more than 2 links.' });
    const c = F.createFeedbackClient({ userDataDir: dir, fetch });
    const r = await c.submit({ type: 'idea', message: 'see http://a http://b http://c' }, {});
    assert.deepStrictEqual(r, { ok: false, queued: false, error: 'Please include no more than 2 links.' });
    assert.strictEqual(c.readQueue().length, 0);
  });

  it('re-registers after a 401 and queues for retry', async () => {
    let regs = 0;
    const fetch = async (url) => url.endsWith('/register') ? (regs++, res(200, { installToken: 't' + regs })) : res(401, { error: 'unverified' });
    const c = F.createFeedbackClient({ userDataDir: dir, fetch });
    const r = await c.submit({ type: 'idea', message: 'some idea text' }, {});
    assert.strictEqual(r.queued, true);
    await c.flushQueue();
    assert.strictEqual(regs, 2);
  });
});

describe('help-feedback messages', () => {
  it('distinguishes sent, queued and failed', () => {
    assert.match(resultMessage({ ok: true }).text, /has been sent/);
    assert.match(resultMessage({ ok: true, queued: true }).text, /send automatically/);
    assert.strictEqual(resultMessage({ ok: false, error: 'x' }).tone, 'error');
  });
});

describe('wiring', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  it('top bar has the Help & feedback button and dialog with three types', () => {
    assert.match(html, /id="help-feedback-btn"/);
    for (const t of ['problem', 'support', 'idea']) assert.match(html, new RegExp(`name="help-feedback-type" value="${t}"`));
    assert.match(html, /renderer\/help-feedback\.js/);
  });
  it('CSP already allows custodynote.com', () => {
    assert.match(html, /connect-src[^;]*https:\/\/custodynote\.com/);
  });
});
