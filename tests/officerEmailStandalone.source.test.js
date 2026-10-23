'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Officer Emails standalone view', () => {
  const html = read('index.html');
  const app = read('app.js');
  const main = read('main.js');
  const standalone = read('renderer/views/officerEmailsStandalone.js');
  const composeLayout = read('renderer/lib/officerEmailComposeLayout.js');
  const recipientRows = read('renderer/lib/officerEmailRecipientRows.js');

  it('is reachable from Home and registered as a view', () => {
    assert.ok(html.includes('home-card-officer-emails'));
    assert.ok(html.includes('view-officer-emails'));
    assert.ok(app.includes("'officer-emails': 'view-officer-emails'"));
    assert.ok(app.includes("case 'home-card-officer-emails':"));
  });

  it('loads the standalone renderer module', () => {
    assert.ok(html.includes('renderer/views/officerEmailsStandalone.js'));
    assert.ok(standalone.includes('OfficerEmailsStandalone'));
    assert.ok(standalone.includes('openOneOffOutlook'));
  });

  it('opens one-off Outlook compose without requiring a custody note draft', () => {
    assert.ok(main.includes("'officer-email-drafts-open-one-off-outlook'"));
    assert.ok(main.includes('normaliseOfficerEmailDraft(fields || {})'));
    assert.ok(
      main.includes('prepareOutlookComposeForOpen') || main.includes('_openOfficerEmailInOutlook'),
      'one-off open must prepare compose with body in Outlook'
    );
  });

  it('includes shared date/time picker in standalone form', () => {
    assert.ok(standalone.includes('oes-when-mount') || standalone.includes('-when-mount'));
    assert.ok(standalone.includes('OfficerEmailDateTimePicker'));
    assert.ok(standalone.includes('attendanceTime'));
  });

  it('uses type=text recipient rows (not type=email) so police domains are never browser-rejected', () => {
    assert.ok(standalone.includes("PREFIX + '-recipients'") || standalone.includes('-recipients'));
    assert.ok(standalone.includes('OfficerEmailRecipientRows'));
    assert.ok(!standalone.includes('type="email" id="oes-to"'));
    assert.ok(standalone.includes("PREFIX + '-recipients'") || standalone.includes('-recipients'));
    assert.ok(standalone.includes('-duty-solicitor'));
    assert.ok(standalone.includes('-outlook-sig'));
    assert.ok(composeLayout.includes('officer-email-check-row'));
    assert.ok(composeLayout.includes('officer-email-step-title'));
    assert.ok(composeLayout.includes('Case details'));
    assert.ok(composeLayout.includes('What is the email for?'));
    assert.ok(standalone.includes('OfficerEmailComposeLayout'));
    assert.ok(!standalone.includes('officer-email-duty-check'));
    assert.ok(standalone.includes('-multi-officer'));
    assert.ok(composeLayout.includes('Send to another officer as well?'));
  });

  it('persists Outlook signature preference via setSettings (not sessionStorage)', () => {
    assert.ok(recipientRows.includes('officerEmailOutlookSignatureIncludesName'));
    assert.ok(recipientRows.includes('setSettings'));
    assert.ok(recipientRows.includes('cn-officer-email-duty-solicitor'));
    assert.ok(!recipientRows.includes('sessionStorage.getItem(OUTLOOK_SIG'));
  });

  it('uses compact link-style controls for recipient rows', () => {
    assert.ok(recipientRows.includes('officer-email-link-btn'));
    assert.ok(recipientRows.includes('+ Add another officer'));
    assert.ok(recipientRows.includes('officer-email-recipient-primary'));
    assert.ok(recipientRows.includes('officer-email-recipients-extra'));
    assert.ok(recipientRows.includes('multiOfficerCheckbox'));
    assert.ok(recipientRows.includes('officer-email-recipients-multi'));
    assert.ok(recipientRows.includes('officer-email-add-recipient hidden'));
  });

  it('checkbox fields avoid full-width input rule in CSS', () => {
    const css = read('styles.css');
    assert.ok(css.includes('.officer-email-field input:not([type="checkbox"])'));
    assert.ok(css.includes('.officer-email-check-row'));
    assert.ok(css.includes('.officer-email-actions-outlook .btn-primary'));
  });
});

describe('Officer Emails custody-note panel', () => {
  const panel = read('renderer/views/officerEmailsPanel.js');
  const composeLayout = read('renderer/lib/officerEmailComposeLayout.js');

  it('includes date/time picker and clear fields controls', () => {
    assert.ok(panel.includes('OfficerEmailDateTimePicker'));
    assert.ok(panel.includes('id="oep-clear"'));
    assert.ok(panel.includes('attendanceTime'));
    assert.ok(panel.includes('timeArrival'));
  });

  it('uses recipient rows and prefs checkboxes (parity with standalone)', () => {
    assert.ok(panel.includes("PREFIX + '-recipients'") || panel.includes('-recipients'));
    assert.ok(panel.includes('OfficerEmailRecipientRows'));
    assert.ok(panel.includes('-duty-solicitor'));
    assert.ok(panel.includes('-outlook-sig'));
    assert.ok(composeLayout.includes('officer-email-check-row'));
    assert.ok(!panel.includes('<input type="email" id="oep-to"'));
    assert.ok(panel.includes('-multi-officer'));
    assert.ok(composeLayout.includes('Send to another officer as well?'));
  });
});
