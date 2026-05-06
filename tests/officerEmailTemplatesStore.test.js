/**
 * Officer Email Templates — Store unit tests.
 *
 * The store seeds with the four built-ins on first run, then every
 * template is fully editable / duplicable / deletable. There are no
 * hard-wired runtime templates after init.
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'renderer', 'officerEmailTemplatesStore.js');

function loadFreshStore() {
  delete require.cache[require.resolve(STORE_PATH)];
  // Reset the simulated browser globals each load so tests are isolated.
  global.window = global.window || {};
  global.window._appSettingsCache = {};
  delete global.window.api;
  // eslint-disable-next-line global-require
  const Store = require(STORE_PATH);
  Store._resetForTests();
  return Store;
}

describe('OfficerEmailTemplatesStore', () => {
  let Store;
  beforeEach(() => { Store = loadFreshStore(); });

  it('seeds with the four built-in templates on a clean install', () => {
    const list = Store.list();
    const keys = list.map((t) => t.key).sort();
    assert.deepStrictEqual(
      keys.sort(),
      ['confirm_representation', 'followup_after_rui', 'request_bail_details', 'request_interview_recording'].sort()
    );
    assert.strictEqual(list.length, 4, 'four built-ins seeded');
    list.forEach((t) => {
      assert.ok(t.name, 'every seed has a name');
      assert.ok(t.subjectTemplate.includes('{{clientName}}'), 'every seed uses {{clientName}}');
    });
  });

  it('persists user edits via window._appSettingsCache (and would call setSettings if present)', () => {
    Store.list();
    Store.update('request_bail_details', { name: 'Custom bail', subjectTemplate: '{{clientName}} - Bail',  bodyTemplate: 'Hi {{officerSurname}}' });
    const persisted = JSON.parse(global.window._appSettingsCache.customOfficerEmailTemplatesJson);
    const updated = persisted.find((t) => t.key === 'request_bail_details');
    assert.strictEqual(updated.name, 'Custom bail');
    assert.strictEqual(updated.subjectTemplate, '{{clientName}} - Bail');
  });

  it('create() adds a new template with a fresh, unique key', () => {
    Store.list();
    const created = Store.create({ name: 'My new', subjectTemplate: '{{clientName}}', bodyTemplate: 'Hi.' });
    assert.ok(created.key, 'has a key');
    const list = Store.list();
    assert.strictEqual(list.length, 5);
    assert.ok(list.some((t) => t.key === created.key), 'appended');
  });

  it('update() returns null for missing keys and edits the right row', () => {
    Store.list();
    assert.strictEqual(Store.update('does_not_exist', { name: 'X' }), null);
    Store.update('confirm_representation', { name: 'Cf' });
    assert.strictEqual(Store.get('confirm_representation').name, 'Cf');
  });

  it('delete() removes only the targeted template', () => {
    Store.list();
    const ok = Store.delete('confirm_representation');
    assert.strictEqual(ok, true);
    const list = Store.list();
    assert.strictEqual(list.length, 3);
    assert.ok(!list.some((t) => t.key === 'confirm_representation'));
  });

  it('duplicate() creates a new key and " (copy)" suffix in name', () => {
    Store.list();
    const dup = Store.duplicate('request_bail_details');
    assert.ok(dup.key !== 'request_bail_details');
    assert.ok(/\(copy\)$/.test(dup.name));
    assert.strictEqual(Store.list().length, 5);
  });

  it('restoreDefaults() re-adds only deleted built-ins, never overwriting edits', () => {
    Store.list();
    // Edit one built-in and delete two others.
    Store.update('request_bail_details', { name: 'Customised name' });
    Store.delete('confirm_representation');
    Store.delete('followup_after_rui');
    assert.strictEqual(Store.list().length, 2);

    const added = Store.restoreDefaults();
    assert.deepStrictEqual(added.sort(), ['confirm_representation', 'followup_after_rui'].sort());

    // Customised one remains customised.
    assert.strictEqual(Store.get('request_bail_details').name, 'Customised name');
    // Restored ones use the seed defaults.
    assert.ok(Store.get('confirm_representation').name);
    assert.strictEqual(Store.list().length, 4);
  });

  it('after restore returning an idempotent state — second call adds nothing', () => {
    Store.list();
    Store.delete('confirm_representation');
    const a = Store.restoreDefaults();
    const b = Store.restoreDefaults();
    assert.deepStrictEqual(a, ['confirm_representation']);
    assert.deepStrictEqual(b, []);
  });

  it('subscribe() notifies on every change and returns an unsubscribe', () => {
    Store.list();
    let calls = 0;
    const unsub = Store.subscribe(() => { calls += 1; });
    Store.create({ name: 'A' });
    Store.update(Store.list()[Store.list().length - 1].key, { name: 'B' });
    Store.delete(Store.list()[Store.list().length - 1].key);
    assert.strictEqual(calls, 3);
    unsub();
    Store.create({ name: 'C' });
    assert.strictEqual(calls, 3, 'unsubscribe stops callbacks');
  });

  it('init({ initialJson }) replaces seeds with the provided JSON', () => {
    const json = JSON.stringify([{ key: 'only_one', name: 'Only one', subjectTemplate: 's', bodyTemplate: 'b' }]);
    Store._resetForTests();
    Store.init({ initialJson: json });
    const list = Store.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].key, 'only_one');
  });

  it('toJSON() reflects the latest set', () => {
    Store.list();
    Store.delete('confirm_representation');
    const arr = JSON.parse(Store.toJSON());
    assert.strictEqual(arr.length, 3);
    assert.ok(!arr.some((t) => t.key === 'confirm_representation'));
  });

  it('the in-memory list is not mutated by the caller (defensive copy on list())', () => {
    Store.list();
    const a = Store.list();
    a.length = 0;
    a.push({ key: 'evil', name: 'evil', subjectTemplate: '', bodyTemplate: '' });
    const b = Store.list();
    assert.strictEqual(b.length, 4);
    assert.ok(!b.some((t) => t.key === 'evil'));
  });
});
