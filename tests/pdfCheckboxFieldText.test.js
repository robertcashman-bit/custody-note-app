'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { formatCheckboxGroupForPdf } = require('../lib/pdfCheckboxFieldText');

describe('pdfCheckboxFieldText', () => {
  it('joins array checkbox values for PDF rows', () => {
    assert.equal(
      formatCheckboxGroupForPdf(['To prevent escape', 'To protect a child']),
      'To prevent escape, To protect a child'
    );
  });

  it('converts pipe strings and leaves scalars intact', () => {
    assert.equal(formatCheckboxGroupForPdf('A|B'), 'A, B');
    assert.equal(formatCheckboxGroupForPdf('plain'), 'plain');
  });

  it('buildPdfHtml uses formatCheckboxGroupForPdf for grounds fields', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.match(appJs, /formatCheckboxGroupForPdf\(d\.groundsForArrest\)/);
    assert.match(appJs, /formatCheckboxGroupForPdf\(d\.groundsForDetention\)/);
    assert.match(appJs, /formatCheckboxGroupForPdf\(d\.specialWarningType\)/);
    assert.match(appJs, /formatCheckboxGroupForPdf\(d\.sufficientBenefitTest/);
  });
});
