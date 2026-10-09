/**
 * "Send Bill to QuickFile" must always end in a visible result:
 *  - QuickFile calls have a deadline (no endless "Sending to QuickFile...");
 *  - success shows a persistent confirmation with the QuickFile invoice number;
 *  - failure shows the reason, and says when QuickFile may still have made it.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const qfClient = require('../lib/quickfileClient');
const qfNum = require('../lib/quickfileInvoiceNumber');
const R = require('../renderer/lib/quickfileInvoiceResult');
const MAIN = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const BILLING_SCREEN = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing-screen.js'), 'utf8');
const BILLING_JS = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');
const COMPLETION = fs.readFileSync(path.join(root, 'renderer', 'views', 'completion-screen.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const BILLING_UTILS = fs.readFileSync(path.join(root, 'renderer', 'billingUtils.js'), 'utf8');

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

describe('QuickFile request deadline (postWithDeadline)', () => {
  const servers = [];
  after(() => servers.forEach((s) => { try { s.closeAllConnections && s.closeAllConnections(); s.close(); } catch (_) {} }));

  it('rejects with QF_TIMEOUT when QuickFile never replies', async () => {
    const srv = await listen(() => { /* never respond */ });
    servers.push(srv);
    const started = Date.now();
    await assert.rejects(
      qfClient.postWithDeadline(http, { hostname: '127.0.0.1', port: srv.address().port, path: '/1_2/invoice/create', method: 'POST' }, '{}', 150),
      (e) => {
        assert.strictEqual(e.code, 'QF_TIMEOUT');
        assert.ok(qfClient.isQuickFileTimeoutError(e));
        assert.ok(qfClient.isQuickFileNetworkError(e));
        assert.match(e.message, /did not reply within/);
        assert.match(e.message, /Wi-Fi/);
        return true;
      }
    );
    assert.ok(Date.now() - started < 5000, 'must give up promptly');
  });

  it('resolves status and body on a normal reply', async () => {
    const srv = await listen((req, res) => {
      req.resume();
      req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":1}'); });
    });
    servers.push(srv);
    const out = await qfClient.postWithDeadline(http, { hostname: '127.0.0.1', port: srv.address().port, path: '/x', method: 'POST' }, '{}', 2000);
    assert.strictEqual(out.statusCode, 200);
    assert.strictEqual(out.raw, '{"ok":1}');
  });

  it('rejects (never hangs) when the connection is refused', async () => {
    const srv = await listen(() => {});
    const port = srv.address().port;
    await new Promise((r) => srv.close(r));
    await assert.rejects(
      qfClient.postWithDeadline(http, { hostname: '127.0.0.1', port, path: '/x', method: 'POST' }, '{}', 2000),
      (e) => { assert.ok(qfClient.isQuickFileNetworkError(e), 'refused is a network error: ' + e.code); return true; }
    );
  });

  it('document uploads get a longer deadline than other calls', () => {
    assert.strictEqual(qfClient.quickFileTimeoutForPath('/1_2/invoice/create'), qfClient.QUICKFILE_REQUEST_TIMEOUT_MS);
    assert.strictEqual(qfClient.quickFileTimeoutForPath('/1_2/document/upload'), qfClient.QUICKFILE_UPLOAD_TIMEOUT_MS);
    assert.ok(qfClient.QUICKFILE_UPLOAD_TIMEOUT_MS > qfClient.QUICKFILE_REQUEST_TIMEOUT_MS);
  });

  it('main.js quickFileRequest goes through the deadline helper', () => {
    const start = MAIN.indexOf('function quickFileRequest(');
    const body = MAIN.slice(start, MAIN.indexOf('function quickFileExtractRecords', start));
    assert.ok(body.includes('quickfileClient.postWithDeadline('), 'quickFileRequest must use postWithDeadline');
    assert.ok(!body.includes('https.request('), 'no raw https.request without a timeout');
  });
});

describe('create-invoice failure result', () => {
  const isNet = qfClient.isQuickFileNetworkError;

  it('timeout after invoice/create went out => QF_UNCONFIRMED (may have been created)', () => {
    const r = qfNum.describeCreateInvoiceFailure(qfClient.quickFileTimeoutError('/1_2/invoice/create', 30000), { createRequestSent: true, isNetworkError: isNet });
    assert.deepStrictEqual([r.ok, r.code, r.mayHaveBeenCreated], [false, 'QF_UNCONFIRMED', true]);
    assert.ok(r.error.length > 0);
  });

  it('timeout before invoice/create => QF_TIMEOUT, nothing created', () => {
    const r = qfNum.describeCreateInvoiceFailure(qfClient.quickFileTimeoutError('/1_2/client/search', 30000), { createRequestSent: false, isNetworkError: isNet });
    assert.deepStrictEqual([r.code, r.mayHaveBeenCreated], ['QF_TIMEOUT', false]);
  });

  it('dropped connection before create => QF_NETWORK', () => {
    const e = new Error('socket hang up'); e.code = 'ECONNRESET';
    const r = qfNum.describeCreateInvoiceFailure(e, { createRequestSent: false, isNetworkError: isNet });
    assert.strictEqual(r.code, 'QF_NETWORK');
  });

  it('QuickFile validation error after create => rejected, nothing created', () => {
    const r = qfNum.describeCreateInvoiceFailure(new Error('ClientID is invalid'), { createRequestSent: true, isNetworkError: isNet });
    assert.strictEqual(r.code, undefined);
    assert.strictEqual(r.mayHaveBeenCreated, false);
    assert.strictEqual(r.error, 'ClientID is invalid');
  });

  it('never returns a blank reason', () => {
    assert.strictEqual(qfNum.describeCreateInvoiceFailure(new Error(''), {}).error, 'Unknown error');
    assert.strictEqual(qfNum.describeCreateInvoiceFailure(null, {}).error, 'Unknown error');
  });

  it('main.js handler marks the create request and returns the shaped failure', () => {
    const start = MAIN.indexOf("ipcMain.handle('quickfile-create-invoice'");
    const body = MAIN.slice(start, MAIN.indexOf('STATION MILEAGE', start));
    assert.ok(body.indexOf('createRequestSent = true') > -1);
    assert.ok(body.indexOf('createRequestSent = true') < body.indexOf("quickFileRequest('/1_2/invoice/create'"));
    assert.ok(body.includes('describeCreateInvoiceFailure(err'));
    assert.match(body, /try \{\s*await ensureQuickFileSettingsFromServer\(\{ reason: 'create-invoice'/);
  });
});

describe('success confirmation copy', () => {
  it('names the QuickFile invoice number, total and attachments', () => {
    const c = R.buildInvoiceSentConfirmation(
      { ok: true, invoiceId: '555', invoiceNumber: '1042', total: 192, invoiceUrl: 'https://app.quickfile.co.uk/invoice/view/555', attachResults: [{ name: 'note.pdf', ok: true }] },
      { firmName: 'Test Firm LLP' }
    );
    assert.strictEqual(c.level, 'success');
    assert.strictEqual(c.title, 'Sent to QuickFile: invoice #1042');
    assert.deepStrictEqual(c.rows.map((r) => r.value), ['#1042', 'Test Firm LLP', '\u00A3192.00', '1 uploaded']);
    assert.strictEqual(c.invoiceUrl, 'https://app.quickfile.co.uk/invoice/view/555');
  });

  it('says when an existing invoice was linked instead of duplicated', () => {
    const c = R.buildInvoiceSentConfirmation({ ok: true, invoiceNumber: '#77', reused: true });
    assert.strictEqual(c.title, 'Already in QuickFile: invoice #77 linked');
    assert.match(c.summary, /No duplicate/);
  });

  it('warns with names and reasons when attachments fail', () => {
    const c = R.buildInvoiceSentConfirmation({ ok: true, invoiceNumber: '9', attachResults: [{ name: 'crm1.pdf', ok: false, error: 'QuickFile did not reply' }] });
    assert.strictEqual(c.level, 'warning');
    assert.deepStrictEqual(c.attachmentFailures, [{ name: 'crm1.pdf', error: 'QuickFile did not reply' }]);
    assert.match(c.summary, /failed to upload/);
  });

  it('falls back to the invoice ID if no number came back', () => {
    assert.strictEqual(R.invoiceLabel({ invoiceId: '123' }), 'ID 123');
  });
});

describe('failure message copy', () => {
  it('unconfirmed: may or may not have been created, safe to press Send again', () => {
    const m = R.buildInvoiceFailureMessage({ code: 'QF_UNCONFIRMED', error: 'QuickFile did not reply within 30 seconds.' });
    assert.strictEqual(m.title, "QuickFile didn't confirm the invoice");
    assert.match(m.advice, /may or may not/);
    assert.match(m.advice, /rather than creating a duplicate/);
  });

  it('network before create: nothing created', () => {
    const m = R.buildInvoiceFailureMessage({ code: 'QF_TIMEOUT', error: 'x' });
    assert.strictEqual(m.title, 'Not sent to QuickFile');
    assert.match(m.advice, /Nothing was created/);
  });

  it('credential problems point at the connection test', () => {
    const m = R.buildInvoiceFailureMessage({ error: 'QuickFile HTTP 401: denied' });
    assert.match(m.advice, /Test QuickFile connection/);
  });

  it('always has a reason', () => {
    assert.strictEqual(R.buildInvoiceFailureMessage({}).reason, 'Unknown error');
  });

  it('toast formatter handles the new codes', () => {
    const ctx = {};
    new Function('exports', BILLING_UTILS + '\nexports.f = formatBillingCreateFailureToast; exports.l = formatLegacyBillingCreateFailureToast;')(ctx);
    assert.match(ctx.f('timed out', 'QF_UNCONFIRMED'), /may or may not have been created/);
    assert.match(ctx.f('timed out', 'QF_TIMEOUT'), /Nothing was created/);
    assert.match(ctx.l('timed out', 'QF_NETWORK'), /Nothing was created/);
  });
});

describe('renderer wiring', () => {
  it('workflow success shows the persistent confirmation before leaving step 2', () => {
    const okIdx = BILLING_SCREEN.indexOf('if (result && result.ok)');
    const showIdx = BILLING_SCREEN.indexOf('_wfShowInvoiceSent(result, opts)', okIdx);
    const navIdx = BILLING_SCREEN.indexOf('_wfAfterInvoiceCreatedGoToCompletion()', okIdx);
    assert.ok(okIdx > -1 && showIdx > okIdx && navIdx > showIdx, 'confirm first, then navigate');
    assert.ok(BILLING_SCREEN.includes("showModal(conf.title"), 'confirmation must be a dialog, not only a toast');
  });

  it('failure shows a dialog with the reason (never silent)', () => {
    const start = BILLING_SCREEN.indexOf('function _wfShowInvoiceFailure');
    const body = BILLING_SCREEN.slice(start, start + 1200);
    assert.ok(body.includes("showToast(toast, 'error'"));
    assert.ok(body.includes('buildInvoiceFailureMessage'));
    assert.ok(body.includes('showModal(msg.title'));
  });

  it('shows "Still waiting for QuickFile..." if the send is slow', () => {
    assert.ok(BILLING_SCREEN.includes('Still waiting for QuickFile...'));
    assert.ok(BILLING_SCREEN.includes('clearTimeout(slowTimer)'));
  });

  it('standalone billing panel routes failures to the shared dialog', () => {
    assert.ok((BILLING_JS.match(/_wfShowInvoiceFailure\(/g) || []).length >= 2);
  });

  it('step 3 names the QuickFile invoice number', () => {
    assert.ok(COMPLETION.includes("'Sent to QuickFile' + (invNum ? ': invoice #' + invNum : '')"));
  });

  it('index.html loads the result copy helper', () => {
    assert.ok(INDEX.includes('<script src="renderer/lib/quickfileInvoiceResult.js"></script>'));
  });
});
