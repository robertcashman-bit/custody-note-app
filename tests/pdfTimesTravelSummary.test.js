'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

require('../renderer/lib/station-visits.js');
const tt = require('../lib/pdfTimesTravelSummary.js');
const { buildSyntheticAttendanceForPdfTimes } = require('./fixtures/syntheticAttendancePdfTimes.js');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('pdfTimesTravelSummary — synthetic custody record', () => {
  const d = buildSyntheticAttendanceForPdfTimes();

  it('builds a non-empty model with travel, waiting, attendance, interview, totals, mileage, costs', () => {
    const model = tt.buildTimesTravelSummaryModel(d, { variant: 'custody' });
    assert.ok(model.hasContent);
    const labels = model.rows.map((r) => r.label);
    assert.ok(labels.includes('Travel there'));
    assert.ok(labels.includes('Travel back'));
    assert.ok(labels.includes('Waiting'));
    assert.ok(labels.includes('Attendance & consultation'));
    assert.ok(labels.includes('Interview time'));
    assert.ok(labels.includes('Total time'));
    assert.ok(labels.includes('Mileage'));
    assert.ok(labels.includes('Parking'));
    assert.ok(labels.includes('Other travel costs'));
  });

  it('renders Times & travel HTML with bold value styling', () => {
    const html = tt.buildPdfTimesTravelHtml(d, (s) => s, { variant: 'custody' });
    assert.match(html, /Times &amp; travel/);
    assert.match(html, /class="tt-value"/);
    assert.match(html, /42\.5 miles/);
    assert.match(html, /£6\.50/);
    assert.match(html, /08:15/);
  });

  it('attendance subline explains waiting deduction (no contradictory on-site duration)', () => {
    const html = tt.buildPdfTimesTravelHtml(d, (s) => s, { variant: 'custody' });
    assert.match(html, /less 30m waiting/);
    assert.doesNotMatch(html, /09:30 → 12:45 \(3h 15m\)/);
  });

  it('panel total equals sum of travel, waiting, and attendance lines', () => {
    const totals = tt.computePanelTimeTotals(d, { variant: 'custody' });
    assert.strictEqual(totals.panelTotalMins, 315);
    assert.strictEqual(totals.totalRowMins, 315);
    assert.strictEqual(totals.sumDisplayedPartsMins, 315);
    assert.ok(totals.reconciled);
    assert.strictEqual(totals.billableTotalMins, 315);
  });

  it('returns empty HTML when nothing is recorded', () => {
    const empty = tt.buildPdfTimesTravelHtml({}, (s) => s, { variant: 'custody' });
    assert.strictEqual(empty, '');
  });
});

describe('pdfTimesTravelSummary — telephone variant', () => {
  it('shows call-focused rows without requiring station travel', () => {
    const html = tt.buildPdfTimesTravelHtml({
      timeFirstContactWithClient: '14:05',
      telephoneCallDuration: '25',
      numberOfCalls: '2',
    }, (s) => s, { variant: 'telephone' });
    assert.match(html, /First contact/);
    assert.match(html, /25m/);
    assert.match(html, /Number of calls/);
  });
});

describe('pdfTimesTravelSummary — app wiring', () => {
  it('index.html loads pdfTimesTravelSummary.js after station-visits', () => {
    const sv = indexHtml.indexOf('renderer/lib/station-visits.js');
    const ttScript = indexHtml.indexOf('lib/pdfTimesTravelSummary.js');
    assert.ok(sv >= 0 && ttScript > sv);
  });

  it('all three PDF builders include the summary after the cover block', () => {
    assert.match(appJs, /pdfTimesTravelSummaryHtml\(d, h, 'custody'\)/);
    assert.match(appJs, /pdfTimesTravelSummaryHtml\(d, h, 'telephone'\)/);
    assert.match(appJs, /pdfTimesTravelSummaryHtml\(d, h, 'voluntary'\)/);
    assert.match(appJs, /pdfTimesTravelSummaryCss\(\)/);
  });

  it('PDF audit footer resolves app version from app-version / settings (not legacy id version)', () => {
    assert.match(appJs, /resolvePdfAppVersion/);
    assert.match(appJs, /getElementById\('app-version'\)/);
    assert.doesNotMatch(
      appJs.slice(appJs.indexOf('function pdfAuditFooterHtml'), appJs.indexOf('function buildPdfHtml')),
      /getElementById\('version'\)/
    );
  });
});
