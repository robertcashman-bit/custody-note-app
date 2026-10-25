'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const line = require('../lib/quickfileInvoiceLine');

describe('quickfileInvoiceLine nominal codes', () => {
  it('uses 4000 for attendance fee lines', () => {
    assert.strictEqual(
      line.nominalCodeForQuickFileLineItem('PS Attendance Fixed Fee', 'Smith - Central'),
      line.QUICKFILE_NOMINAL_FEE
    );
    const built = line.buildQuickFileItemLine(
      'PS Attendance Fixed Fee',
      'Police Station Attendance Fixed Fee',
      180,
      1,
      0.2
    );
    assert.strictEqual(built.ItemNominalCode, '4000');
  });

  it('uses 4906 for Mileage lines by name and description', () => {
    assert.strictEqual(line.nominalCodeForQuickFileLineItem('Mileage', 'anything'), '4906');
    const desc = 'Mileage (12.0 miles at 0.45 GBP/mile)';
    assert.strictEqual(line.isTravelOrMileageQuickFileLine('Mileage', desc), true);
    const built = line.buildQuickFileItemLine('Mileage', desc, 5.4, 1, 0.2);
    assert.strictEqual(built.ItemNominalCode, '4906');
  });

  it('uses 4906 for travel-labelled lines', () => {
    assert.strictEqual(
      line.nominalCodeForQuickFileLineItem('Travel', 'Train to station'),
      '4906'
    );
    assert.strictEqual(
      line.nominalCodeForQuickFileLineItem('Disbursement', 'Travel (public transport)'),
      '4906'
    );
  });

  it('keeps parking on fee nominal 4000', () => {
    const built = line.buildQuickFileItemLine('Parking', 'Parking', 8, 1, 0.2);
    assert.strictEqual(built.ItemNominalCode, '4000');
  });
});
