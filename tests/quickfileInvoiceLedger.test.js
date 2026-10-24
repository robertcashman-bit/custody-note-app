'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const ledger = require('../lib/quickfileInvoiceLedger');
const {
  createInvoiceWithDuplicateRecovery,
  isQuickFileInvoiceNumberDuplicateError,
} = require('../lib/quickfileInvoiceNumber');

describe('computeMaxNumericInvoiceFromRecords — mixed 6-digit and high series', () => {
  it('picks 328681 over 006089', () => {
    const max = ledger.computeMaxNumericInvoiceFromRecords([
      { InvoiceNumber: '006089' },
      { InvoiceNumber: '328681' },
      { InvoiceNumber: 'INV-328680' },
    ]);
    assert.strictEqual(max, 328681);
  });
});

describe('computeNextInvoiceNumberAfterSync — large ledger gap', () => {
  it('jumps from stale local 6066 to ledger max+1 (328611)', () => {
    const next = ledger.computeNextInvoiceNumberAfterSync({
      localNext: 6066,
      ledgerMax: 328610,
      defaultStart: 6066,
    });
    assert.strictEqual(next, '328611');
  });

  it('ignores stale per-machine local counter when ledger max is known (328680 → 328681)', () => {
    const next = ledger.computeNextInvoiceNumberAfterSync({
      localNext: 328680,
      ledgerMax: 328680,
    });
    assert.strictEqual(next, '328681');
  });

  it('uses dynamic width when next exceeds 6 digits', () => {
    const next = ledger.computeNextInvoiceNumberAfterSync({
      localNext: 6066,
      ledgerMax: 999999,
      defaultStart: 6066,
      width: 6,
    });
    assert.strictEqual(next, '1000000');
  });
});

describe('fetchLedgerMaxInvoiceNumeric', () => {
  it('finds numeric max across paginated search pages', async () => {
    const pages = [
      { Record: [{ InvoiceNumber: '328610' }, { InvoiceNumber: '328500' }] },
      { Record: [{ InvoiceNumber: 'INV-12000' }, { InvoiceNumber: '006066' }] },
      { Record: [] },
    ];
    let calls = 0;
    const max = await ledger.fetchLedgerMaxInvoiceNumeric(async () => {
      const body = pages[calls] || { Record: [] };
      calls += 1;
      return body;
    }, { pageSize: 2, maxPages: 5 });
    assert.strictEqual(max, 328610);
    assert.ok(calls >= 2);
  });
});

describe('two machines, one QuickFile account', () => {
  it('machine B allocates 328681 after machine A raises ledger max to 328680', () => {
    let ledgerMax = 328679;
    const nextForMachine = () => ledger.computeNextInvoiceNumberAfterSync({ ledgerMax, localNext: 328680 });
    assert.strictEqual(nextForMachine(), '328680');
    ledgerMax = 328680;
    assert.strictEqual(nextForMachine(), '328681');
  });

  it('machine B recovers from duplicate on 328680 by re-reading ledger and jumping to 328681', async () => {
    let ledgerMax = 328679;
    const attempted = [];
    const result = await createInvoiceWithDuplicateRecovery({
      maxAttempts: 3,
      allocateNextNumber: async () => ledger.computeNextInvoiceNumberAfterSync({
        ledgerMax,
        localNext: 328680,
      }),
      onDuplicateConflict: async () => {
        ledgerMax = 328680;
        return true;
      },
      bumpPastNumber: () => {},
      createWithNumber: async (invNum) => {
        attempted.push(invNum);
        if (invNum === '328680') throw new Error('Invoice number already exists');
        return { InvoiceID: 99, InvoiceNumber: invNum };
      },
      findByInvoiceNumber: async () => null,
      findByAttendanceRef: async () => null,
    });
    assert.strictEqual(result.invoiceNumber, '328681');
    assert.deepStrictEqual(attempted, ['328680', '328681']);
  });
});

describe('createInvoiceWithDuplicateRecovery — ledger jump vs misclassified errors', () => {
  it('does not treat "Client already exists" as invoice duplicate (surfaces real error)', async () => {
    let attempts = 0;
    await assert.rejects(
      createInvoiceWithDuplicateRecovery({
        maxAttempts: 5,
        allocateNextNumber: () => '006066',
        createWithNumber: async () => {
          attempts += 1;
          throw new Error('Client already exists');
        },
      }),
      /Client already exists/
    );
    assert.strictEqual(attempts, 1);
    assert.strictEqual(isQuickFileInvoiceNumberDuplicateError(new Error('Client already exists')), false);
  });

  it('after invoice-number duplicate, uses ledger max+1 on next attempt (not +1 from 6066)', async () => {
    const attempted = [];
    let localNext = 6066;
    const bump = (raw) => {
      const n = parseInt(String(raw).replace(/\D/g, ''), 10);
      if (Number.isFinite(n)) localNext = Math.max(localNext, n + 1);
    };
    const result = await createInvoiceWithDuplicateRecovery({
      maxAttempts: 4,
      allocateNextNumber: () => String(localNext).padStart(6, '0'),
      bumpPastNumber: bump,
      onDuplicateConflict: async (invNum) => {
        assert.strictEqual(invNum, '006066');
        bump('328610');
        return true;
      },
      createWithNumber: async (invNum) => {
        attempted.push(invNum);
        if (invNum === '006066') {
          throw new Error('Invoice number already exists');
        }
        return { InvoiceID: 1, InvoiceNumber: invNum };
      },
      findByInvoiceNumber: async () => null,
      findByAttendanceRef: async () => null,
    });
    assert.strictEqual(result.invoiceNumber, '328611');
    assert.deepStrictEqual(attempted, ['006066', '328611']);
  });
});
