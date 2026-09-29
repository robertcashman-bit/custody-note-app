'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

describe('home onboarding UX (source)', () => {
  it('shows free beta home card with start attendance CTA', () => {
    assert.match(indexHtml, /id="home-free-beta-card"/);
    assert.match(indexHtml, /Free during beta.*start your first attendance/i);
    assert.match(indexHtml, /id="home-free-start-attendance-btn"/);
    assert.match(indexHtml, /home-email-licence-key-btn/);
  });

  it('keeps email-key on licence activation card for Store invalid licence path', () => {
    assert.match(indexHtml, /id="home-licence-email-key-btn"/);
    assert.match(appJs, /home-licence-email-key-btn/);
    assert.match(appJs, /goToLicenceEmailKeySettings/);
  });

  it('DSCC PIN is optional in welcome wizard', () => {
    assert.match(indexHtml, /fl-dscc-pin/);
    assert.doesNotMatch(indexHtml, /fl-dscc-pin[\s\S]{0,80}color:#dc2626.*\*<\/span>/);
    assert.match(appJs, /welcomeWizardDoneAt/);
    assert.doesNotMatch(appJs, /Please enter your DSCC PIN/);
  });

  it('surfaces dismissible home invite card and Settings help share block', () => {
    assert.match(indexHtml, /id="home-invite-colleague-card"/);
    assert.match(indexHtml, /Invite a colleague/);
    assert.match(indexHtml, /share-app-copy-btn/);
    assert.match(appJs, /getReferralInvitePathUrl/);
    assert.match(appJs, /custodynote\.com\/r\//);
    assert.match(appJs, /markReferralInviteMilestone/);
  });
});
