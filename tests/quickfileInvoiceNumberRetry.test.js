/**
 * QuickFile invoice-number duplicate recovery — unit tests with MOCK create/search.
 * Never hits the live QuickFile API.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  isQuickFileInvoiceNumberDuplicateError,
  extractConflictingInvoiceNumber,
  parseInvoiceNumberNumericPart,
  attendancePurchaseReference,
  attendanceNotesMarker,
  appendAttendanceNotesMarker,
  invoiceBelongsToAttendance,
  pickInvoiceIdentity,
  createInvoiceWithDuplicateRecovery,
  quickFileExtractInvoiceSearchRecords,
  MAX_INVOICE_NUMBER_ATTEMPTS,
} = require('../lib/quickfileInvoiceNumber');

describe('isQuickFileInvoiceNumberDuplicateError', () => {
  const positives = [
    'Invoice number already exists',
    'The invoice number is already used',
    'Invoice number is already there',
    'Invoice #006066 already exists',
    '006070 already in use',
    'This InvoiceNumber has already been used',
    'Duplicate invoice number',
    'Invoice number already taken',
    'The Invoice Number you have specified is already in use',
    'Invoice number has already been allocated',
  ];
  for (const msg of positives) {
    it('matches: ' + msg, () => {
      assert.strictEqual(isQuickFileInvoiceNumberDuplicateError(new Error(msg)), true);
      assert.strictEqual(isQuickFileInvoiceNumberDuplicateError(msg), true);
    });
  }

  const negatives = [
    'Invalid MD5 signature',
    'ClientID is required',
    'QuickFile HTTP 500: Internal',
    'No billable items to invoice',
    'Account suspended',
  ];
  for (const msg of negatives) {
    it('does not match non-duplicate: ' + msg, () => {
      assert.strictEqual(isQuickFileInvoiceNumberDuplicateError(new Error(msg)), false);
    });
  }
});

describe('extractConflictingInvoiceNumber / parseInvoiceNumberNumericPart', () => {
  it('extracts padded numbers from error text', () => {
    assert.strictEqual(extractConflictingInvoiceNumber('Invoice #006066 already exists'), '006066');
    assert.strictEqual(parseInvoiceNumberNumericPart('006066'), 6066);
    assert.strictEqual(parseInvoiceNumberNumericPart('INV-6069'), 6069);
  });
});

describe('attendance markers and belonging', () => {
  it('builds a PurchaseReference within QuickFile length limit', () => {
    const ref = attendancePurchaseReference(12345);
    assert.strictEqual(ref, 'CN-ATT-12345');
    assert.ok(ref.length <= 25);
  });

  it('matches by PurchaseReference or Notes marker', () => {
    const id = 99;
    assert.strictEqual(
      invoiceBelongsToAttendance({ PurchaseReference: attendancePurchaseReference(id) }, id),
      true
    );
    assert.strictEqual(
      invoiceBelongsToAttendance({ Notes: 'Fees\n' + attendanceNotesMarker(id) }, id),
      true
    );
    assert.strictEqual(
      invoiceBelongsToAttendance({ PurchaseReference: 'OTHER', Notes: 'unrelated' }, id),
      false
    );
  });

  it('appendAttendanceNotesMarker is idempotent and preserves narrative', () => {
    const once = appendAttendanceNotesMarker('Police station fee', 7);
    assert.ok(once.startsWith('Police station fee'));
    assert.ok(once.includes(attendanceNotesMarker(7)));
    const twice = appendAttendanceNotesMarker(once, 7);
    assert.strictEqual(twice, once);
  });
});

describe('pickInvoiceIdentity', () => {
  it('falls back to submitted invoice number when response omits it', () => {
    const id = pickInvoiceIdentity({ InvoiceID: 555 }, '006100');
    assert.strictEqual(id.invoiceId, '555');
    assert.strictEqual(id.invoiceNumber, '006100');
  });
});

describe('quickFileExtractInvoiceSearchRecords', () => {
  it('normalises Record arrays', () => {
    const rows = quickFileExtractInvoiceSearchRecords({
      Record: [{ InvoiceNumber: '1' }, { InvoiceNumber: '2' }],
    });
    assert.strictEqual(rows.length, 2);
  });
});

describe('createInvoiceWithDuplicateRecovery', () => {
  it('retries with next number when QuickFile reports already-used, then succeeds', async () => {
    const allocated = [];
    const result = await createInvoiceWithDuplicateRecovery({
      attendanceId: 10,
      maxAttempts: 5,
      allocateNextNumber: () => {
        const n = String(6066 + allocated.length).padStart(6, '0');
        allocated.push(n);
        return n;
      },
      createWithNumber: async (invNum) => {
        if (invNum === '006066') throw new Error('Invoice number is already there');
        if (invNum === '006067') throw new Error('The invoice number is already used');
        return { InvoiceID: 9001, InvoiceNumber: invNum };
      },
      findByInvoiceNumber: async () => null,
      findByAttendanceRef: async () => null,
    });
    assert.strictEqual(result.reused, false);
    assert.strictEqual(result.invoiceNumber, '006068');
    assert.strictEqual(result.invoiceId, '9001');
    assert.deepStrictEqual(allocated, ['006066', '006067', '006068']);
  });

  it('attaches existing invoice when conflict is for the same attendance', async () => {
    const attendanceId = 42;
    const result = await createInvoiceWithDuplicateRecovery({
      attendanceId,
      maxAttempts: 5,
      allocateNextNumber: () => '006200',
      createWithNumber: async () => {
        throw new Error('Invoice number already exists');
      },
      findByInvoiceNumber: async (invNum) => ({
        InvoiceID: 777,
        InvoiceNumber: invNum,
        PurchaseReference: attendancePurchaseReference(attendanceId),
      }),
      findByAttendanceRef: async () => null,
    });
    assert.strictEqual(result.reused, true);
    assert.strictEqual(result.invoiceId, '777');
    assert.strictEqual(result.invoiceNumber, '006200');
  });

  it('reuses by attendance PurchaseReference before create when prior partial success left QF invoice', async () => {
    const attendanceId = 55;
    let created = 0;
    const result = await createInvoiceWithDuplicateRecovery({
      attendanceId,
      allocateNextNumber: () => {
        throw new Error('should not allocate when reuse found');
      },
      createWithNumber: async () => {
        created += 1;
        throw new Error('should not create');
      },
      findByAttendanceRef: async () => ({
        InvoiceID: 888,
        InvoiceNumber: '006300',
        PurchaseReference: attendancePurchaseReference(attendanceId),
      }),
    });
    assert.strictEqual(result.reused, true);
    assert.strictEqual(result.invoiceId, '888');
    assert.strictEqual(result.invoiceNumber, '006300');
    assert.strictEqual(created, 0);
  });

  it('non-duplicate QuickFile errors still fail clearly without retrying', async () => {
    let attempts = 0;
    await assert.rejects(
      () => createInvoiceWithDuplicateRecovery({
        allocateNextNumber: () => {
          attempts += 1;
          return '006400';
        },
        createWithNumber: async () => {
          throw new Error('Invalid MD5 signature');
        },
      }),
      /Invalid MD5 signature/
    );
    assert.strictEqual(attempts, 1);
  });

  it('persists submitted invoice number when create body omits InvoiceNumber', async () => {
    const result = await createInvoiceWithDuplicateRecovery({
      allocateNextNumber: () => '006500',
      createWithNumber: async () => ({ InvoiceID: 42 }),
    });
    assert.strictEqual(result.invoiceId, '42');
    assert.strictEqual(result.invoiceNumber, '006500');
  });

  it('stops after maxAttempts on persistent duplicates', async () => {
    let attempts = 0;
    await assert.rejects(
      () => createInvoiceWithDuplicateRecovery({
        maxAttempts: 3,
        allocateNextNumber: () => {
          attempts += 1;
          return String(7000 + attempts);
        },
        createWithNumber: async () => {
          throw new Error('invoice number already exists');
        },
        findByInvoiceNumber: async () => null,
      }),
      /already exists/
    );
    assert.strictEqual(attempts, 3);
    assert.ok(MAX_INVOICE_NUMBER_ATTEMPTS >= 3);
  });

  it('bumps past conflicting number extracted from the error', async () => {
    const bumped = [];
    await createInvoiceWithDuplicateRecovery({
      maxAttempts: 4,
      allocateNextNumber: () => (bumped.length ? '006080' : '006066'),
      bumpPastNumber: (raw) => bumped.push(raw),
      createWithNumber: async (invNum) => {
        if (invNum === '006066') throw new Error('Invoice number 006079 already exists');
        return { InvoiceID: 1, InvoiceNumber: invNum };
      },
      findByInvoiceNumber: async () => null,
    });
    assert.deepStrictEqual(bumped, ['006079']);
  });
});
