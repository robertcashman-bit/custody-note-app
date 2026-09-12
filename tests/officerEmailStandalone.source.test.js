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

  it('includes attendance time field in standalone form', () => {
    assert.ok(standalone.includes('id="oes-time"'));
    assert.ok(standalone.includes('attendanceTime'));
  });

  it('uses type=text (not type=email) for recipient so police domains are never browser-rejected', () => {
    assert.match(
      standalone,
      /id="oes-to"[^>]*inputmode="email"|inputmode="email"[^>]*id="oes-to"/
    );
    assert.ok(
      /<input type="text"[^>]*id="oes-to"/.test(standalone) ||
        /id="oes-to"[^>]*type="text"/.test(standalone) ||
        standalone.includes('<input type="text" id="oes-to" inputmode="email"'),
      'oes-to must be type=text with inputmode=email'
    );
    assert.ok(
      !standalone.includes('<input type="email" id="oes-to"'),
      'oes-to must not use type=email (Chromium can reject valid .police.uk addresses)'
    );
  });
});

describe('Officer Emails custody-note panel', () => {
  const panel = read('renderer/views/officerEmailsPanel.js');

  it('includes attendance time and clear fields controls', () => {
    assert.ok(panel.includes('id="oep-time"'));
    assert.ok(panel.includes('id="oep-clear"'));
    assert.ok(panel.includes('attendanceTime'));
    assert.ok(panel.includes('timeArrival'));
  });

  it('uses type=text for recipient email (parity with standalone)', () => {
    assert.ok(
      panel.includes('<input type="text" id="oep-to" inputmode="email"') ||
        /<input type="text"[^>]*id="oep-to"/.test(panel),
      'oep-to must be type=text with inputmode=email'
    );
    assert.ok(!panel.includes('<input type="email" id="oep-to"'));
  });
});
