'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { mayDismissCredentialFreeBlanker } = require('../lib/sessionBlankerPolicy');

describe('sessionBlankerPolicy — credential-free dismiss rules', () => {
  it('allows dismiss on empty/safe screens', () => {
    assert.equal(mayDismissCredentialFreeBlanker({}), true);
    assert.equal(mayDismissCredentialFreeBlanker({
      formViewActive: false,
      listViewActive: false,
      homeViewActive: true,
      homeHasActiveMatters: false,
    }), true);
  });

  it('blocks dismiss when a form with open attendance is active', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      formViewActive: true,
      hasOpenAttendance: true,
    }), false);
  });

  it('blocks dismiss when meaningful client/case form data is present', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      formViewActive: true,
      hasMeaningfulFormData: true,
    }), false);
  });

  it('blocks dismiss when form context bar shows case content', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      formViewActive: true,
      formContextBarHasText: true,
    }), false);
  });

  it('blocks dismiss when records list has rows', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      listViewActive: true,
      listHasRows: true,
    }), false);
  });

  it('allows dismiss on empty list view', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      listViewActive: true,
      listHasRows: false,
    }), true);
  });

  it('blocks dismiss when home shows active matters', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      homeViewActive: true,
      homeHasActiveMatters: true,
    }), false);
  });
});

describe('app.js wires blanker dismiss policy', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  it('loads sessionBlankerPolicy in the renderer', () => {
    assert.match(indexHtml, /sessionBlankerPolicy\.js/);
  });

  it('only renders dismiss when allowDismiss is true', () => {
    assert.match(appJs, /allowDismiss/);
    assert.match(appJs, /mayDismissCredentialFreeBlanker/);
    assert.match(appJs, /cn-credentialfree-dismiss/);
    assert.ok(
      appJs.includes('Client or case data may be on screen'),
      'non-dismissible path must explain why dismiss is unavailable'
    );
  });
});
