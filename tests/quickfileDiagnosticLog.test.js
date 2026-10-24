'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('../lib/quickfileDiagnosticLog');

describe('quickfileDiagnosticLog redaction', () => {
  it('strips API key, account number, MD5, client names and amounts from log lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-log-'));
    log.init(dir);
    log.append({
      event: 'invoice_create_attempt',
      apiPath: '/1_2/invoice/create',
      outcome: 'error',
      invoiceNumberTried: '328680',
      qfErrorMessage: 'Invoice number already exists',
      accidental: {
        apiKey: 'secret-key-12345',
        accountNumber: '12345678',
        md5Value: 'a'.repeat(32),
        firmName: 'Secret Firm LLP',
        ClientName: 'John Smith',
        grandTotal: 192.5,
      },
    });
    const file = path.join(dir, 'logs', 'quickfile.log');
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(!raw.includes('secret-key-12345'));
    assert.ok(!raw.includes('12345678'));
    assert.ok(!raw.includes('a'.repeat(32)));
    assert.ok(!raw.includes('Secret Firm'));
    assert.ok(!raw.includes('John Smith'));
    assert.ok(!raw.includes('192.5'));
    assert.ok(raw.includes('328680'));
    assert.ok(raw.includes('Invoice number already exists'));
  });
});
