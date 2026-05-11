/* ═══════════════════════════════════════════════════════════════
   OFFICER EMAIL TEMPLATES — Store

   Pure-JS, no DOM. Loads templates from a JSON blob persisted in
   app settings (key: customOfficerEmailTemplatesJson). Seeds with
   the four built-in defaults on first run; from that moment on
   every template is fully user-editable — there are no hard-wired
   templates left in the runtime path.

   Surface:
     OfficerEmailTemplatesStore.init({ initialJson, onChange })
     OfficerEmailTemplatesStore.list()
     OfficerEmailTemplatesStore.get(key)
     OfficerEmailTemplatesStore.create({ name, subjectTemplate, bodyTemplate })
     OfficerEmailTemplatesStore.update(key, patch)
     OfficerEmailTemplatesStore.delete(key)
     OfficerEmailTemplatesStore.duplicate(key)
     OfficerEmailTemplatesStore.restoreDefaults()       // adds any missing built-ins (never overwrites)
     OfficerEmailTemplatesStore.subscribe(fn)           // returns unsubscribe
     OfficerEmailTemplatesStore.toJSON()                // for persistence
     OfficerEmailTemplatesStore.BUILT_IN_TEMPLATES      // raw seed data

   The store mirrors any change into window._appSettingsCache and
   then asynchronously calls window.api.setSettings({ ... }) when
   available. In jsdom tests both are typically absent — the store
   still works in-memory.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SETTINGS_KEY = 'customOfficerEmailTemplatesJson';

  /** Built-in seed templates. These are NOT used at render time —
   *  they are only copied into the user's editable list when the
   *  user has no templates of their own (first install) or when
   *  they explicitly choose "Restore defaults". */
  var BUILT_IN_TEMPLATES = [
    {
      key: 'request_bail_details',
      name: 'Request Bail Details',
      subjectTemplate: '{{clientName}} - Bail Details Request',
      bodyTemplate:
        'Dear {{officerRank}} {{officerSurname}},\n\n' +
        'I am writing in relation to {{clientName}}, who was detained at {{policeStation}} on {{interviewDate}} under custody record number {{custodyNumber}}.\n\n' +
        'The DSCC reference is {{dsccReference}}.\n\n' +
        'We understand that {{clientName}} was released on police bail. Please could you confirm the bail return date, time, and any bail conditions imposed.',
    },
    {
      key: 'request_interview_recording',
      name: 'Request Interview Recording',
      subjectTemplate: '{{clientName}} - Interview Recording Request',
      bodyTemplate:
        'Dear {{officerRank}} {{officerSurname}},\n\n' +
        'I am writing in relation to {{clientName}}, who was interviewed at {{policeStation}} on {{interviewDate}}.\n\n' +
        'Please could you provide a copy of the interview recording, or confirm the process for obtaining it.\n\n' +
        'The custody record number is {{custodyNumber}} and the DSCC reference is {{dsccReference}}.',
    },
    {
      key: 'followup_after_rui',
      name: 'Follow-up After RUI',
      subjectTemplate: '{{clientName}} - Case Update Request',
      bodyTemplate:
        'Dear {{officerRank}} {{officerSurname}},\n\n' +
        'I am writing in relation to {{clientName}}, who was interviewed at {{policeStation}} on {{interviewDate}}.\n\n' +
        'Please could you confirm the current position regarding the investigation and whether any further action is anticipated.\n\n' +
        'The custody record number is {{custodyNumber}} and the DSCC reference is {{dsccReference}}.',
    },
    {
      key: 'confirm_representation',
      name: 'Confirm Representation',
      subjectTemplate: '{{clientName}} - Confirmation of Representation',
      bodyTemplate:
        'Dear {{officerRank}} {{officerSurname}},\n\n' +
        'I write to confirm that I represent {{clientName}} in relation to this matter.\n\n' +
        'Please ensure that all future correspondence is sent to me by email.\n\n' +
        'The custody record number is {{custodyNumber}} and the DSCC reference is {{dsccReference}}.',
    },
  ];

  /** Stable, URL-safe key for new templates. */
  function _newKey() {
    var rand = (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    return 'tpl_' + Date.now().toString(36) + '_' + rand;
  }

  function _normalise(t) {
    return {
      key: String(t && t.key ? t.key : _newKey()),
      name: String(t && t.name != null ? t.name : 'Untitled').trim() || 'Untitled',
      subjectTemplate: String(t && t.subjectTemplate != null ? t.subjectTemplate : ''),
      bodyTemplate: String(t && t.bodyTemplate != null ? t.bodyTemplate : ''),
    };
  }

  function _cloneBuiltIns() {
    return BUILT_IN_TEMPLATES.map(function (t) { return _normalise(t); });
  }

  /* ── Module state ─────────────────────────────────────────── */

  var _templates = [];
  var _initialised = false;
  var _subscribers = [];

  function _emit() {
    for (var i = 0; i < _subscribers.length; i++) {
      try { _subscribers[i](_templates.slice()); } catch (e) { /* swallow */ }
    }
  }

  function _persist() {
    var json = JSON.stringify(_templates);
    try {
      if (typeof window !== 'undefined') {
        if (!window._appSettingsCache) window._appSettingsCache = {};
        window._appSettingsCache[SETTINGS_KEY] = json;
        if (window.api && typeof window.api.setSettings === 'function') {
          var payload = {};
          payload[SETTINGS_KEY] = json;
          window.api.setSettings(payload).catch(function (e) {
            try { console.error('[officerEmailTemplatesStore] setSettings failed', e); } catch (_) {}
          });
        }
      }
    } catch (e) { /* in tests, ignore */ }
    _emit();
  }

  /* ── Public API ───────────────────────────────────────────── */

  /**
   * @param {object} [opts]
   * @param {string} [opts.initialJson] Raw JSON string from settings (sync init).
   *                                    If omitted, the store reads from
   *                                    window._appSettingsCache[SETTINGS_KEY] when present.
   */
  function init(opts) {
    opts = opts || {};
    var raw = opts.initialJson;
    if (raw == null && typeof window !== 'undefined' && window._appSettingsCache) {
      raw = window._appSettingsCache[SETTINGS_KEY];
    }
    var loaded = null;
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) loaded = parsed.map(_normalise);
      } catch (e) { loaded = null; }
    }
    if (!loaded || !loaded.length) {
      _templates = _cloneBuiltIns();
      _initialised = true;
      // Persist the seeded set so future loads skip seeding.
      _persist();
    } else {
      _templates = loaded;
      _initialised = true;
      _emit();
    }
    return _templates.slice();
  }

  function _ensureInit() { if (!_initialised) init(); }

  function list() { _ensureInit(); return _templates.slice(); }

  function get(key) {
    _ensureInit();
    for (var i = 0; i < _templates.length; i++) {
      if (_templates[i].key === key) return Object.assign({}, _templates[i]);
    }
    return null;
  }

  function create(input) {
    _ensureInit();
    var t = _normalise(Object.assign({ key: _newKey() }, input || {}));
    _templates = _templates.concat([t]);
    _persist();
    return Object.assign({}, t);
  }

  function update(key, patch) {
    _ensureInit();
    var found = false;
    _templates = _templates.map(function (t) {
      if (t.key !== key) return t;
      found = true;
      return _normalise(Object.assign({}, t, patch || {}, { key: t.key }));
    });
    if (!found) return null;
    _persist();
    return get(key);
  }

  function remove(key) {
    _ensureInit();
    var before = _templates.length;
    _templates = _templates.filter(function (t) { return t.key !== key; });
    if (_templates.length === before) return false;
    _persist();
    return true;
  }

  function duplicate(key) {
    _ensureInit();
    var src = get(key);
    if (!src) return null;
    var copy = _normalise({
      key: _newKey(),
      name: src.name + ' (copy)',
      subjectTemplate: src.subjectTemplate,
      bodyTemplate: src.bodyTemplate,
    });
    _templates = _templates.concat([copy]);
    _persist();
    return Object.assign({}, copy);
  }

  /** Adds any built-ins whose `key` is not present in the current list.
   *  Never overwrites user edits. Returns the keys that were re-added. */
  function restoreDefaults() {
    _ensureInit();
    var existing = {};
    _templates.forEach(function (t) { existing[t.key] = true; });
    var added = [];
    BUILT_IN_TEMPLATES.forEach(function (b) {
      if (!existing[b.key]) {
        _templates.push(_normalise(b));
        added.push(b.key);
      }
    });
    if (added.length) _persist();
    return added;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    _subscribers.push(fn);
    return function () {
      _subscribers = _subscribers.filter(function (x) { return x !== fn; });
    };
  }

  function toJSON() {
    _ensureInit();
    return JSON.stringify(_templates);
  }

  /** Test helper — wipe internal state. Not exported on window. */
  function _resetForTests() {
    _templates = [];
    _initialised = false;
    _subscribers = [];
    if (typeof window !== 'undefined' && window._appSettingsCache) {
      delete window._appSettingsCache[SETTINGS_KEY];
    }
  }

  var api = {
    SETTINGS_KEY: SETTINGS_KEY,
    BUILT_IN_TEMPLATES: BUILT_IN_TEMPLATES,
    init: init,
    list: list,
    get: get,
    create: create,
    update: update,
    delete: remove,
    duplicate: duplicate,
    restoreDefaults: restoreDefaults,
    subscribe: subscribe,
    toJSON: toJSON,
    _resetForTests: _resetForTests,
  };

  if (typeof window !== 'undefined') {
    window.OfficerEmailTemplatesStore = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
