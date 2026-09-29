'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const HomeOnboarding = require('../lib/homeOnboarding');

describe('HomeOnboarding licence cards', () => {
  const freeSt = { key: 'FREE-ABC', tier: 'free', isFree: true, status: 'active' };
  const proSt = { key: 'CN-AAAA-BBBB', tier: 'pro', status: 'active' };
  const trialSt = { key: 'TRIAL-ABC', tier: 'trial', isTrial: true, status: 'active' };

  it('shows free beta card for packaged free licences', () => {
    assert.equal(HomeOnboarding.shouldShowFreeBetaHomeCard(true, freeSt), true);
    assert.equal(HomeOnboarding.shouldShowLicenceActivationHomeCard(true, freeSt), false);
  });

  it('shows licence activation card for invalid packaged trial without free tier', () => {
    assert.equal(HomeOnboarding.shouldShowFreeBetaHomeCard(true, trialSt), false);
    assert.equal(HomeOnboarding.shouldShowLicenceActivationHomeCard(true, trialSt), true);
  });

  it('hides activation card when cloud licence is validated', () => {
    assert.equal(HomeOnboarding.hasValidatedCloudLicence(proSt), true);
    assert.equal(HomeOnboarding.shouldShowLicenceActivationHomeCard(true, proSt), false);
  });
});

describe('HomeOnboarding welcome wizard', () => {
  it('auto-shows only until done or legacy name present', () => {
    assert.equal(HomeOnboarding.shouldAutoShowWelcomeWizard({}), true);
    assert.equal(HomeOnboarding.shouldAutoShowWelcomeWizard({ welcomeWizardDoneAt: '2026-01-01' }), false);
    assert.equal(HomeOnboarding.shouldAutoShowWelcomeWizard({ feeEarnerNameDefault: 'Jane' }), false);
  });
});

describe('HomeOnboarding invite card', () => {
  it('shows after milestone unless dismissed', () => {
    assert.equal(HomeOnboarding.shouldShowHomeInviteCard({ milestone: true, dismissed: false }), true);
    assert.equal(HomeOnboarding.shouldShowHomeInviteCard({ milestone: true, dismissed: true }), false);
    assert.equal(HomeOnboarding.shouldShowHomeInviteCard({ milestone: false, dismissed: false }), false);
  });

  it('builds referral path URLs', () => {
    assert.equal(HomeOnboarding.buildReferralInviteUrl('ABC123'), 'https://custodynote.com/r/ABC123');
  });
});
