/**
 * Billing workflow integration tests.
 *
 * Verifies all wiring between main.js IPC handlers, preload.js API surface,
 * index.html elements, app.js view registration, and renderer JS functions.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const billingJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');
const billableJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billable-attendances.js'), 'utf8');
const mileageJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'station-mileage-admin.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

describe('Database schema — billing columns', () => {
  const expectedColumns = [
    'quickfile_invoice_id', 'quickfile_invoice_number', 'quickfile_invoice_url',
    'invoice_created_at', 'invoice_created_by',
    'invoice_subtotal', 'invoice_vat', 'invoice_total',
    'invoice_narrative', 'invoice_mileage_miles', 'invoice_mileage_rate',
    'invoice_parking_amount', 'invoice_attendance_fee', 'invoice_vat_rate',
  ];
  expectedColumns.forEach(col => {
    it(`attendances table has ALTER for ${col}`, () => {
      assert.ok(mainJs.includes(`ALTER TABLE attendances ADD COLUMN ${col}`),
        `Missing ALTER TABLE for ${col}`);
    });
  });

  it('police_stations has mileage_from_base column', () => {
    assert.ok(mainJs.includes('ALTER TABLE police_stations ADD COLUMN mileage_from_base'));
  });

  it('police_stations has postcode column', () => {
    assert.ok(mainJs.includes('ALTER TABLE police_stations ADD COLUMN postcode'));
  });

  it('billing_audit_log table is created', () => {
    assert.ok(mainJs.includes('CREATE TABLE IF NOT EXISTS billing_audit_log'));
  });

  it('billing_audit_log has attendance_id index', () => {
    assert.ok(mainJs.includes('idx_billing_audit_att'));
  });
});

describe('IPC handlers — main.js', () => {
  const expectedHandlers = [
    'preview-pdf-from-html',
    'quickfile-create-invoice',
    'station-mileage-get',
    'stations-mileage-list',
    'station-mileage-save',
    'station-mileage-bulk-save',
    'billing-audit-log-add',
    'billing-audit-log-get',
    'billable-attendances',
    'attendance-invoice-status',
  ];
  expectedHandlers.forEach(handler => {
    it(`ipcMain.handle('${handler}') exists`, () => {
      assert.ok(mainJs.includes(`'${handler}'`),
        `Missing IPC handler: ${handler}`);
    });
  });
});

describe('QuickFile invoice creation handler', () => {
  it('finds or creates client via quickFileFindOrCreateClient', () => {
    assert.ok(mainJs.includes('quickFileFindOrCreateClient'));
  });

  it('creates invoice with line items for fee, mileage, and parking', () => {
    assert.ok(mainJs.includes('PS attendance fee'));
    assert.ok(mainJs.includes("'Mileage'"));
    assert.ok(mainJs.includes("'Parking/disburse'"));
    assert.ok(mainJs.includes('function buildQuickFileItemLine'));
  });

  it('stores invoice result on attendance record', () => {
    assert.ok(mainJs.includes('quickfile_invoice_id = ?'));
    assert.ok(mainJs.includes('quickfile_invoice_number = ?'));
    assert.ok(mainJs.includes('quickfile_invoice_url = ?'));
  });

  it('logs invoice creation in billing_audit_log', () => {
    assert.ok(mainJs.includes("'invoice_created'"));
  });

  it('logs invoice failure in billing_audit_log', () => {
    assert.ok(mainJs.includes("'invoice_failed'"));
  });

  it('returns invoiceId, invoiceNumber, invoiceUrl on success', () => {
    const returnMatch = mainJs.includes('invoiceId: String(invoiceId)');
    assert.ok(returnMatch);
  });
});

describe('Billable attendances query', () => {
  it('filters for finalised records without invoices', () => {
    assert.ok(mainJs.includes("status = 'finalised'"));
    assert.ok(mainJs.includes('quickfile_invoice_id IS NULL'));
  });

  it('excludes deleted records', () => {
    assert.ok(mainJs.includes('deleted_at IS NULL'));
  });
});

describe('Preload API surface', () => {
  const expectedMethods = [
    'previewPdfFromHtml',
    'quickfileCreateInvoice',
    'stationMileageGet',
    'stationsMileageList',
    'stationMileageSave',
    'stationMileageBulkSave',
    'billingAuditLogAdd',
    'billingAuditLogGet',
    'billableAttendances',
    'attendanceInvoiceStatus',
  ];
  expectedMethods.forEach(method => {
    it(`window.api.${method} is exposed`, () => {
      assert.ok(preloadJs.includes(method),
        `Missing preload method: ${method}`);
    });
  });
});

describe('index.html — billing UI elements', () => {
  it('has billing panel button in form header', () => {
    assert.ok(indexHtml.includes('id="billing-panel-btn"'));
  });

  it('has station mileage menu item', () => {
    assert.ok(indexHtml.includes('data-action="station-mileage"'));
  });

  it('has billable attendances section in reports', () => {
    assert.ok(indexHtml.includes('id="billable-attendances-section"'));
  });

  it('has billable search input', () => {
    assert.ok(indexHtml.includes('id="billable-search"'));
  });

  it('has billable date range inputs', () => {
    assert.ok(indexHtml.includes('id="billable-date-from"'));
    assert.ok(indexHtml.includes('id="billable-date-to"'));
  });

  it('has billable firm filter', () => {
    assert.ok(indexHtml.includes('id="billable-firm-filter"'));
  });

  it('has billable table wrapper', () => {
    assert.ok(indexHtml.includes('id="billable-attendances-table-wrap"'));
  });

  it('has station mileage view', () => {
    assert.ok(indexHtml.includes('id="view-station-mileage"'));
  });

  it('has station mileage back button', () => {
    assert.ok(indexHtml.includes('id="station-mileage-back-btn"'));
  });

  it('has mileage search input', () => {
    assert.ok(indexHtml.includes('id="mileage-search"'));
  });

  it('has mileage save button', () => {
    assert.ok(indexHtml.includes('id="mileage-save-all"'));
  });

  it('has station mileage table wrapper', () => {
    assert.ok(indexHtml.includes('id="station-mileage-table-wrap"'));
  });

  it('has billable summary text element', () => {
    assert.ok(indexHtml.includes('id="billable-summary-text"'));
  });

  it('includes billing.js script', () => {
    assert.ok(indexHtml.includes('renderer/views/billing.js'));
  });

  it('loads laa-forms.js before billing.js for CRM14 previews', () => {
    const iLaa = indexHtml.indexOf('renderer/laa-forms.js');
    const iBill = indexHtml.indexOf('renderer/views/billing.js');
    assert.ok(iLaa > 0 && iBill > iLaa, 'laa-forms must load before billing.js');
  });

  it('includes billable-attendances.js script', () => {
    assert.ok(indexHtml.includes('renderer/views/billable-attendances.js'));
  });

  it('includes station-mileage-admin.js script', () => {
    assert.ok(indexHtml.includes('renderer/views/station-mileage-admin.js'));
  });
});

describe('app.js — view wiring', () => {
  it('views map includes station-mileage', () => {
    assert.ok(appJs.includes("'station-mileage': 'view-station-mileage'"));
  });

  it('showView calls loadBillableAttendances for reports', () => {
    assert.ok(appJs.includes('loadBillableAttendances'));
  });

  it('showView calls loadStationMileage for station-mileage view', () => {
    assert.ok(appJs.includes('loadStationMileage'));
  });

  it('billing panel button has click handler', () => {
    assert.ok(appJs.includes('billing-panel-btn'));
    assert.ok(appJs.includes('openBillingPanel'));
  });

  it('gear menu handles station-mileage action', () => {
    assert.ok(appJs.includes("case 'station-mileage': showView('station-mileage')"));
  });

  it('back button handles station-mileage-back-btn', () => {
    assert.ok(appJs.includes('station-mileage-back-btn'));
  });
});

describe('billing.js — core functions', () => {
  it('exports openBillingPanel function', () => {
    assert.ok(billingJs.includes('function openBillingPanel'));
  });

  it('exports closeBillingPanel function', () => {
    assert.ok(billingJs.includes('function closeBillingPanel'));
  });

  it('builds invoice narrative with correct format', () => {
    assert.ok(billingJs.includes('Police Station Attendance Fixed Fee'));
  });

  it('has document preview and attendance HTML for invoice attach', () => {
    assert.ok(billingJs.includes('function _previewDocument'));
    assert.ok(billingJs.includes('attachAttendanceHtml'));
  });

  it('has review confirmation checklist (3 checkboxes)', () => {
    assert.ok(billingJs.includes('billing-check-attendance'));
    assert.ok(billingJs.includes('billing-check-docs'));
    assert.ok(billingJs.includes('billing-check-billing'));
  });

  it('invoice button is disabled until all checkboxes are checked', () => {
    assert.ok(billingJs.includes('createBtn.disabled = !allChecked'));
  });

  it('has duplicate invoice protection', () => {
    assert.ok(billingJs.includes('already has an invoice'));
  });

  it('has live billing recalculation', () => {
    assert.ok(billingJs.includes('function _recalcBillingTotals'));
  });

  it('creates QuickFile invoice with correct parameters (incl. attendance HTML for PDF attach)', () => {
    assert.ok(billingJs.includes('quickfileCreateInvoice'));
    assert.ok(billingJs.includes('billingInvoiceNumber'));
    assert.ok(billingJs.includes('attachAttendanceHtml'));
  });

  it('shows billing summary (firm, client, station, date, offence, auto invoice ref)', () => {
    assert.ok(billingJs.includes('Billing &amp; documents') || billingJs.includes('Billing & documents'));
    assert.ok(billingJs.includes('firmName'));
    assert.ok(billingJs.includes('clientName'));
    assert.ok(billingJs.includes('stationName'));
    assert.ok(billingJs.includes('attendanceDate'));
    assert.ok(billingJs.includes('billing-invoice-ref-display'));
    assert.ok(billingJs.includes('Billing invoice no. (auto)'));
  });

  it('has QuickFile status display', () => {
    assert.ok(billingJs.includes('QuickFile Status'));
    assert.ok(billingJs.includes('billing-status-invoiced'));
    assert.ok(billingJs.includes('billing-status-not-invoiced'));
  });

  it('logs billing actions to audit log', () => {
    assert.ok(billingJs.includes('billingAuditLogAdd'));
  });

  it('displays audit log history', () => {
    assert.ok(billingJs.includes('Billing History'));
  });

  it('auto-populates mileage from station database', () => {
    assert.ok(billingJs.includes('stationMileageGet'));
  });

  it('shows generated documents list', () => {
    assert.ok(billingJs.includes('function _getGeneratedDocuments'));
    assert.ok(billingJs.includes('Attendance Note PDF'));
    assert.ok(billingJs.includes('Applicant Declaration'));
  });

  it('shows LAA attach checklist for official forms', () => {
    assert.ok(billingJs.includes('function _getLaaAttachFormsList'));
    assert.ok(billingJs.includes('LAA forms on file'));
    assert.ok(billingJs.includes('CRM15'));
  });
});

describe('billable-attendances.js — report functions', () => {
  it('exports loadBillableAttendances function', () => {
    assert.ok(billableJs.includes('function loadBillableAttendances'));
  });

  it('has search filtering', () => {
    assert.ok(billableJs.includes('billable-search'));
  });

  it('has date range filtering', () => {
    assert.ok(billableJs.includes('billable-date-from'));
    assert.ok(billableJs.includes('billable-date-to'));
  });

  it('has firm filtering', () => {
    assert.ok(billableJs.includes('billable-firm-filter'));
  });

  it('shows summary totals (count and revenue)', () => {
    assert.ok(billableJs.includes('billable attendance'));
    assert.ok(billableJs.includes('Total potential revenue'));
  });

  it('has row actions: Open and Invoice', () => {
    assert.ok(billableJs.includes('billable-open'));
    assert.ok(billableJs.includes('billable-invoice'));
  });

  it('Invoice row action opens billing panel', () => {
    assert.ok(billableJs.includes('openBillingPanel'));
  });

  it('displays all required columns', () => {
    assert.ok(billableJs.includes('clientName'));
    assert.ok(billableJs.includes('firmName'));
    assert.ok(billableJs.includes('stationName'));
    assert.ok(billableJs.includes('offenceSummary'));
    assert.ok(billableJs.includes('attendanceFee'));
  });
});

describe('station-mileage-admin.js — admin functions', () => {
  it('exports loadStationMileage function', () => {
    assert.ok(mileageJs.includes('function loadStationMileage'));
  });

  it('has search filtering', () => {
    assert.ok(mileageJs.includes('mileage-search'));
  });

  it('has save all changes functionality', () => {
    assert.ok(mileageJs.includes('function _saveAllMileage'));
  });

  it('tracks dirty (modified) rows', () => {
    assert.ok(mileageJs.includes('_mileageDirty'));
  });

  it('uses bulk save API', () => {
    assert.ok(mileageJs.includes('stationMileageBulkSave'));
  });

  it('renders editable mileage and postcode inputs', () => {
    assert.ok(mileageJs.includes('data-field="mileage"'));
    assert.ok(mileageJs.includes('data-field="postcode"'));
  });
});

describe('styles.css — billing styles', () => {
  it('has billing overlay styles', () => {
    assert.ok(stylesCss.includes('.billing-overlay'));
  });

  it('has billing panel styles', () => {
    assert.ok(stylesCss.includes('.billing-panel'));
  });

  it('has billing totals styles', () => {
    assert.ok(stylesCss.includes('.billing-totals'));
  });

  it('has billing status badge styles', () => {
    assert.ok(stylesCss.includes('.billing-status-invoiced'));
    assert.ok(stylesCss.includes('.billing-status-not-invoiced'));
  });

  it('has billing checklist styles', () => {
    assert.ok(stylesCss.includes('.billing-checklist'));
  });

  it('has billable table styles', () => {
    assert.ok(stylesCss.includes('.billable-table'));
  });

  it('has responsive breakpoints for billing', () => {
    assert.ok(stylesCss.includes('.billing-detail-grid'));
  });

  it('has billing audit log styles', () => {
    assert.ok(stylesCss.includes('.billing-audit-entry'));
  });

  it('has billing flow panel styles', () => {
    assert.ok(stylesCss.includes('.billing-panel--flow'));
  });
});

describe('Security — API keys server-side only', () => {
  it('QuickFile auth is computed in main.js only', () => {
    assert.ok(mainJs.includes('getQuickFileAuth'));
    assert.ok(!preloadJs.includes('getQuickFileAuth'));
    assert.ok(!billingJs.includes('getQuickFileAuth'));
    assert.ok(!appJs.includes('getQuickFileAuth'));
  });

  it('API key is not exposed in preload', () => {
    assert.ok(!preloadJs.includes('quickfileApiKey'));
    assert.ok(!preloadJs.includes('quickfileAppId'));
  });

  it('MD5 hashing only happens server-side', () => {
    assert.ok(mainJs.includes('md5Value'));
    assert.ok(!billingJs.includes('md5'));
    assert.ok(!billableJs.includes('md5'));
  });
});

describe('Billing narrative generation', () => {
  it('uses correct format: Fee – Client – Station – Date – Offence', () => {
    assert.ok(billingJs.includes("'Police Station Attendance Fixed Fee'"));
  });

  it('narrative is editable via textarea', () => {
    assert.ok(billingJs.includes('billing-narrative'));
    assert.ok(billingJs.includes('textarea'));
  });

  it('date is formatted as DD.MM.YY', () => {
    assert.ok(billingJs.includes("parts[2] + '.' + parts[1] + '.' + parts[0].slice(2)"));
  });
});

describe('Billing panel (no firm email pack)', () => {
  it('does not embed inline billing PDF iframe / print preview toolbar', () => {
    assert.ok(!billingJs.includes('billing-print-preview-open'));
    assert.ok(!billingJs.includes('billing-preview-iframe'));
  });

  it('does not include Prepare Email to Firm flow', () => {
    assert.ok(!billingJs.includes('_openEmailPackModal'));
    assert.ok(!billingJs.includes('billing-email-pack'));
    assert.ok(!billingJs.includes('email_prepared'));
  });
});

describe('QuickFile client search — required fields', () => {
  it('all quickFileRequest client/search calls include OrderResultsBy and OrderDirection', () => {
    const re = /quickFileRequest\s*\(\s*'\/1_2\/client\/search'\s*,\s*\{[\s\S]*?\}\s*\)/g;
    const matches = mainJs.match(re) || [];
    assert.ok(matches.length >= 2, 'Expected at least 2 client/search calls, found ' + matches.length);
    for (let i = 0; i < matches.length; i++) {
      assert.ok(matches[i].includes('OrderResultsBy'), 'client/search call ' + i + ' missing OrderResultsBy');
      assert.ok(matches[i].includes('OrderDirection'), 'client/search call ' + i + ' missing OrderDirection');
    }
  });
});

describe('Invoice success confirmation modal', () => {
  it('has _showInvoiceSuccessModal function', () => {
    assert.ok(billingJs.includes('function _showInvoiceSuccessModal'));
  });

  it('success modal has View Invoice, Create Another, and Close buttons', () => {
    assert.ok(billingJs.includes('billing-success-view'));
    assert.ok(billingJs.includes('billing-success-another'));
    assert.ok(billingJs.includes('billing-success-close'));
  });

  it('success modal supports Escape to dismiss', () => {
    assert.ok(billingJs.includes("e.key === 'Escape'") || billingJs.includes('e.key === "Escape"'));
  });

  it('removes existing success overlay before showing new one', () => {
    assert.ok(billingJs.includes("getElementById('billing-success-overlay')"));
  });

  it('has double-submit guard on invoice creation', () => {
    assert.ok(billingJs.includes('_invoiceInFlight'));
  });
});

describe('QuickFile input validation', () => {
  it('validates params object before processing', () => {
    assert.ok(mainJs.includes("'Invalid invoice parameters'"));
  });

  it('validates firmName is required', () => {
    assert.ok(mainJs.includes("'Firm name is required"));
  });

  it('uses Number.isFinite for VAT rate normalization', () => {
    assert.ok(mainJs.includes('Number.isFinite(Number(vatRate))'));
  });

  it('guards empty PDF buffer in attachment upload', () => {
    assert.ok(mainJs.includes('PDF buffer is empty'));
  });

  it('guards oversized PDF in attachment upload', () => {
    assert.ok(mainJs.includes('Attachment too large'));
  });

  it('checks HTTP status in QuickFile response handler', () => {
    assert.ok(mainJs.includes('QuickFile HTTP'));
  });

  it('handles empty QuickFile response', () => {
    assert.ok(mainJs.includes('QuickFile returned empty response'));
  });
});

describe('QuickFile invoice payload schema compliance', () => {
  it('nests SingleInvoiceData inside InvoiceData.Scheduling (not as Body sibling)', () => {
    assert.ok(mainJs.includes('Scheduling: {'));
    assert.ok(mainJs.includes('SingleInvoiceData: singleInvoiceData'));
    const bodyMatch = mainJs.match(/quickFileRequest\s*\(\s*'\/1_2\/invoice\/create'\s*,\s*(\w+)\)/);
    assert.ok(bodyMatch, 'invoice/create call should use a named payload variable');
  });

  it('includes Language field inside InvoiceData', () => {
    const createIdx = mainJs.indexOf("'/1_2/invoice/create'");
    const block = mainJs.slice(Math.max(0, createIdx - 600), createIdx + 100);
    assert.ok(block.includes("Language: 'en'"), 'InvoiceData should include Language');
  });

  it('calls validateQuickFileInvoicePayload before invoice/create request', () => {
    const createIdx = mainJs.indexOf("quickFileRequest('/1_2/invoice/create'");
    const validateIdx = mainJs.indexOf('validateQuickFileInvoicePayload(invoicePayload)');
    assert.ok(validateIdx > 0, 'validateQuickFileInvoicePayload call should exist');
    assert.ok(validateIdx < createIdx, 'validateQuickFileInvoicePayload must be called before quickFileRequest');
  });

  it('passes trimmed firmName to quickFileFindOrCreateClient', () => {
    assert.ok(mainJs.includes('quickFileFindOrCreateClient(firmName.trim()'));
  });
});

describe('buildQuickFileItemLine field types', () => {
  it('returns Qty as a number, not a string', () => {
    const fnMatch = mainJs.match(/function buildQuickFileItemLine[\s\S]*?^}/m);
    assert.ok(fnMatch, 'buildQuickFileItemLine function should exist');
    const fnBody = fnMatch[0];
    assert.ok(!fnBody.includes('Qty: String('), 'Qty should not be wrapped in String()');
    assert.ok(fnBody.includes('Qty: q'), 'Qty should be the raw numeric value');
  });

  it('uses ItemID: 0 for one-off items', () => {
    assert.ok(mainJs.includes('ItemID: 0'));
  });

  it('uses ItemNominalCode 4000 as default', () => {
    assert.ok(mainJs.includes("ItemNominalCode: '4000'"));
  });

  it('enforces max 25 chars on ItemName', () => {
    assert.ok(mainJs.includes(".slice(0, 25)"));
  });

  it('enforces max 5000 chars on ItemDescription', () => {
    assert.ok(mainJs.includes(".slice(0, 5000)"));
  });

  it('includes Tax1 with TaxName, TaxPercentage, and TaxAmount', () => {
    const fnMatch = mainJs.match(/function buildQuickFileItemLine[\s\S]*?^}/m);
    const fnBody = fnMatch[0];
    assert.ok(fnBody.includes("TaxName: 'VAT'"));
    assert.ok(fnBody.includes('TaxPercentage:'));
    assert.ok(fnBody.includes('TaxAmount:'));
  });
});

describe('validateQuickFileInvoicePayload — preflight checks', () => {
  it('function exists in main.js', () => {
    assert.ok(mainJs.includes('function validateQuickFileInvoicePayload'));
  });

  it('validates InvoiceData presence', () => {
    assert.ok(mainJs.includes("Preflight: missing InvoiceData"));
  });

  it('validates InvoiceType enum', () => {
    assert.ok(mainJs.includes("Preflight: InvoiceType must be"));
  });

  it('validates ClientID is a positive integer', () => {
    assert.ok(mainJs.includes("Preflight: ClientID must be a positive integer"));
  });

  it('validates Currency is 3-char ISO', () => {
    assert.ok(mainJs.includes("Preflight: Currency must be a 3-char ISO code"));
  });

  it('validates at least one ItemLine', () => {
    assert.ok(mainJs.includes("Preflight: at least one ItemLine required"));
  });

  it('validates ItemNominalCode length 2-5', () => {
    assert.ok(mainJs.includes("ItemNominalCode must be 2-5 chars"));
  });

  it('validates UnitCost > 0', () => {
    assert.ok(mainJs.includes("UnitCost must be > 0"));
  });

  it('validates Qty > 0', () => {
    assert.ok(mainJs.includes("Qty must be > 0"));
  });

  it('validates Scheduling presence', () => {
    assert.ok(mainJs.includes("Preflight: missing Scheduling inside InvoiceData"));
  });

  it('validates IssueDate format YYYY-MM-DD', () => {
    assert.ok(mainJs.includes("Preflight: IssueDate must be YYYY-MM-DD"));
  });

  it('validates ClientAddress.CountryISO when ClientAddress present', () => {
    assert.ok(mainJs.includes("Preflight: ClientAddress requires a 2-char CountryISO"));
  });

  it('validates InvoiceDescription length 2-35 when present', () => {
    assert.ok(mainJs.includes("Preflight: InvoiceDescription must be 2-35 chars"));
  });

  it('validates ItemName max 25 chars', () => {
    assert.ok(mainJs.includes("ItemName max 25 chars"));
  });
});

describe('QuickFile auth generation', () => {
  it('generates unique SubmissionNumber per call', () => {
    assert.ok(mainJs.includes("'cn-' + Date.now()"));
    assert.ok(mainJs.includes("Math.random().toString(36)"));
  });

  it('constructs MD5 from accountNumber + apiKey + submissionNumber', () => {
    assert.ok(mainJs.includes("accountNumber + apiKey + submissionNumber"));
    assert.ok(mainJs.includes("createHash('md5')"));
  });

  it('includes ApplicationID in auth header', () => {
    assert.ok(mainJs.includes("ApplicationID: auth.applicationId"));
  });
});

describe('QuickFile error parsing — structured errors before HTTP status', () => {
  it('parses JSON before checking HTTP status code', () => {
    const fnStart = mainJs.indexOf('function quickFileRequest(');
    const fnBlock = mainJs.slice(fnStart, fnStart + 2000);
    const jsonParseIdx = fnBlock.indexOf('JSON.parse');
    const httpCheckIdx = fnBlock.indexOf('res.statusCode < 200');
    assert.ok(jsonParseIdx > 0, 'JSON.parse should exist in quickFileRequest');
    assert.ok(httpCheckIdx > 0, 'HTTP status check should exist in quickFileRequest');
    assert.ok(jsonParseIdx < httpCheckIdx, 'JSON parsing must happen before HTTP status rejection');
  });

  it('extracts Errors.Error array from QuickFile responses', () => {
    assert.ok(mainJs.includes('json.Errors.Error || json.Errors'));
  });

  it('handles Header.Status === Error responses', () => {
    assert.ok(mainJs.includes("header?.Status === 'Error'"));
  });
});

describe('Scheduling nesting regression', () => {
  it('invoice/create payload wraps SingleInvoiceData inside Scheduling', () => {
    const idx = mainJs.indexOf("quickFileRequest('/1_2/invoice/create'");
    assert.ok(idx > 0);
    const before = mainJs.slice(Math.max(0, idx - 400), idx);
    assert.ok(before.includes('Scheduling: {'), 'Scheduling wrapper must exist before invoice/create call');
    assert.ok(before.includes('SingleInvoiceData:'), 'SingleInvoiceData must be inside Scheduling');
    assert.ok(!before.match(/\}\s*,\s*SingleInvoiceData:/), 'SingleInvoiceData must not be a sibling of InvoiceData');
  });
});
