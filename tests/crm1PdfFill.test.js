/**
 * Regression: CRM1 official PDF prefill (main.js fillCRM1) — USN, benefit ticks, weekly £.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

describe('CRM1 PDF fill (main.js)', () => {
  it('clears USN field FillText644 and does not write UFN into it', () => {
    assert.ok(mainSrc.includes("safeClearText(form, 'FillText644')"), 'expected USN field clear');
    assert.ok(!mainSrc.includes("safeSet(form, 'FillText644', d.ufn)"), 'UFN must not populate USN');
  });

  it('maps main passporting question to CheckBox10 (Yes) and CheckBox9 (No)', () => {
    assert.ok(mainSrc.includes("safeCheck(form, 'CheckBox10', onBenefit)"), 'Yes tick must be CheckBox10');
    assert.ok(mainSrc.includes("safeCheck(form, 'CheckBox9', !onBenefit)"), 'No tick must be CheckBox9');
  });

  it('converts annual gross figures to weekly for CRM1 income boxes', () => {
    assert.ok(mainSrc.includes('poundsAnnualToWeeklyOrEmpty'), 'weekly conversion helper expected');
    assert.ok(mainSrc.includes("safeSet(form, 'Partner_if_living_with_t_', wkPartner)"), 'partner box must be weekly £');
  });

  it('fills capital page fields FillText23–FillText27 from record', () => {
    assert.ok(mainSrc.includes("safeSet(form, 'FillText23'"), 'capital client');
    assert.ok(mainSrc.includes("safeSet(form, 'FillText27'"), 'capital total');
  });

  it('maps equal opportunities ethnicity/disability codes to CRM1 page 6 checkboxes', () => {
    assert.ok(mainSrc.includes('CRM1_ETHNICITY_FIELD_BY_CODE'), 'ethnicity map');
    assert.ok(mainSrc.includes("'01': 'CheckBox137'"), 'ethnicity code 01');
    assert.ok(mainSrc.includes('CRM1_DISABILITY_FIELD_BY_CODE'), 'disability map');
    assert.ok(mainSrc.includes("NCD: 'CheckBox31'"), 'disability NCD');
    assert.ok(mainSrc.includes('fillCRM1EqualOpportunities'), 'equal op fill helper');
  });
});

describe('Applicant Declaration PDF (main.js)', () => {
  it('clears Text4 USN field', () => {
    assert.ok(mainSrc.includes("safeClearText(form, 'Text4')"), 'USN Text4 cleared');
  });
});

describe('CRM3 PDF fill (main.js)', () => {
  it('uses Yes1/No1 for action started and mutual counsel ticks', () => {
    assert.ok(mainSrc.includes("safeUncheck(form, 'Yes1')"), 'Yes1 uncheck');
    assert.ok(mainSrc.includes("safeCheck(form, 'CheckBox2', counselYes)"), 'counsel Yes');
  });
  it('clears header FillText8 (UFN for firm)', () => {
    assert.ok(mainSrc.includes("safeClearText(form, 'FillText8')"), 'CRM3 header UFN cleared');
  });
});
