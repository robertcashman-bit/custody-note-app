/**
 * UI / source checks for the Officer Emails Compose surface (v1.6.20+).
 *
 * v1.6.20 removed the entire Outlook-launch flow ("Open in Outlook" /
 * "Open in Outlook Web" / "Reopen Outlook" / "Continue opening draft" /
 * "Copy & reopen" fallback panel) because the Windows launch path was
 * unreliable (Outlook PWA hijack, Edge sign-in prompts, Default-browser
 * interception). Officer Emails is now copy-and-paste only.
 *
 * These assertions guarantee:
 *   1. The launch surface stays gone (no UI button, no source mention).
 *   2. The copy-only surface still ships (hero copy, compose copy buttons,
 *      preview copy buttons, side panel copy, records copy).
 *   3. The Compose validation + warnings still wire.
 *
 * If you re-introduce any of the removed launch buttons, justify it in
 * the changelog and update this test deliberately — the user has decided
 * the launch flow is removed.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('Email compose UI (source) — v1.6.20 copy-only workflow', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const officerJs = fs.readFileSync(path.join(ROOT, 'renderer', 'officerEmails.js'), 'utf8');
  const emailModalJs = fs.readFileSync(path.join(ROOT, 'renderer', 'views', 'email-modal.js'), 'utf8');

  it('index.html has NO Outlook-launch UI in Officer Emails', () => {
    const FORBIDDEN_IDS = [
      // Hero
      'officerOpenOutlookMailtoHeroBtn',
      'officerOpenOutlookHeroBtn',
      // Sign-in / Continue
      'officerEmailSignInPanel',
      'officerContinueDraftBtn',
      // Compose tab
      'officerOpenOutlookMailtoBtn',
      'officerOpenOutlookBtn',
      // Fallback "Copy & reopen" panel
      'officerEmailFallbackPanel',
      'officerFbOpenMailtoBtn',
      'officerFbOpenWebBtn',
      'officerFbContinueBtn',
      'officerClearPendingDraftBtn',
      'officerDraftOpenedSuccessBtn',
      // Preview tab
      'officerOpenOutlookMailtoPreviewBtn',
      'officerOpenOutlookPreviewBtn',
      // Side panel
      'officerOpenOutlookMailtoSideBtn',
      'officerOpenOutlookSideBtn',
      // Quick Email modal
      'email-oic-open-mailto',
      'email-oic-open-app',
      // Compose Advanced launch options
      'officerHandlerEdgeInPrivate',
      'officerHandlerDesktop',
      'officerHandlerWeb',
      'officerHandlerStatus',
      'officerLoginHintInput',
    ];
    const present = FORBIDDEN_IDS.filter((id) => html.includes('id="' + id + '"'));
    assert.deepStrictEqual(
      present,
      [],
      'These Outlook-launch IDs were re-introduced into index.html: ' + present.join(', ')
    );
  });

  it('index.html keeps the copy-only Officer Emails surfaces', () => {
    const REQUIRED_IDS = [
      // Hero copy
      'officerHeroCopyBodyBtn',
      // Compose copy
      'officerCopyBodyBtn',
      'officerCopyOfficerEmailBtn',
      'officerCopySubjectBtn',
      'officerCopyFullBtn',
      // Save / Mark Sent / Cancel still present
      'officerSaveDraftBtn',
      'officerMarkSentBtn',
      'officerCancelBtn',
      // Preview copy
      'officerCopyBodyPreviewBtn',
      'officerCopyFullPreviewBtn',
      'officerCopySubjectPreviewBtn',
      // Side panel copy
      'officerSideCopyBodyBtn',
    ];
    for (const id of REQUIRED_IDS) {
      assert.ok(
        html.includes('id="' + id + '"'),
        'index.html missing required copy-only button: ' + id
      );
    }
    assert.ok(html.includes('Copy Email Body'));
    assert.ok(html.includes('Copy Officer Email'));
    assert.ok(html.includes('Copy Subject'));
    assert.ok(html.includes('Copy Full Email'));
  });

  it('officerEmails.js has no Outlook-launch wiring or stale handlers', () => {
    const FORBIDDEN = [
      // Removed function names
      'function openOfficerDraft',
      'function reopenRecord',
      'function bindFallbackAndPendingButtons',
      // Removed bindClicks
      'officerOpenOutlookMailtoHeroBtn',
      'officerOpenOutlookHeroBtn',
      'officerOpenOutlookMailtoBtn',
      'officerOpenOutlookBtn',
      'officerOpenOutlookMailtoPreviewBtn',
      'officerOpenOutlookPreviewBtn',
      'officerOpenOutlookMailtoSideBtn',
      'officerOpenOutlookSideBtn',
      'officerFbOpenMailtoBtn',
      'officerFbOpenWebBtn',
      'officerFbContinueBtn',
      'officerContinueDraftBtn',
      'officerClearPendingDraftBtn',
      'officerDraftOpenedSuccessBtn',
      // Removed records "reopen" action
      'data-action="reopen"',
      'Reopen Outlook',
    ];
    const offenders = FORBIDDEN.filter((needle) => officerJs.includes(needle));
    assert.deepStrictEqual(
      offenders,
      [],
      'officerEmails.js still references removed Outlook-launch surfaces: ' + offenders.join(', ')
    );
  });

  it('officerEmails.js wires the records-list copy actions (Officer / Subject / Body / Full)', () => {
    const REQUIRED_DATA_ACTIONS = [
      'data-action="copy-officer"',
      'data-action="copy-subject"',
      'data-action="copy-body"',
      'data-action="copy-full"',
    ];
    for (const sel of REQUIRED_DATA_ACTIONS) {
      assert.ok(
        officerJs.includes(sel),
        'records-list missing copy action selector: ' + sel
      );
    }
  });

  it('Quick Email modal exposes only copy/save/mark-sent/cancel/clear actions', () => {
    const FORBIDDEN = [
      "id=\"email-oic-open-mailto\"",
      "id=\"email-oic-open-app\"",
      'function _wireOpenDraft',
      '_wireOpenDraft(',
      '_truncateBodyForOutlook',
    ];
    const offenders = FORBIDDEN.filter((needle) => emailModalJs.includes(needle));
    assert.deepStrictEqual(
      offenders,
      [],
      'email-modal.js still references the removed Outlook-launch flow: ' + offenders.join(', ')
    );
    assert.ok(emailModalJs.includes("id=\"email-oic-copy\""), 'Quick Email Copy button must remain');
    assert.ok(emailModalJs.includes("id=\"email-oic-copy-subject\""), 'Quick Email Copy Subject button must be added');
    assert.ok(emailModalJs.includes("id=\"email-oic-mark-sent\""), 'Quick Email Mark Sent button must remain');
  });

  it('officerEmails.js retains compose validation + warnings + primary Copy Email Body', () => {
    assert.ok(officerJs.includes('function validate'));
    assert.ok(officerJs.includes('getMissingRequiredFields'));
    assert.ok(officerJs.includes('updateComposeWarnings'));
    assert.ok(officerJs.includes('officerHeroCopyBodyBtn'));
    assert.ok(html.includes('id="officerComposeWarnings"'));
  });
});
