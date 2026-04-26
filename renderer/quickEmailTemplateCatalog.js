/* ═══════════════════════════════════════════════════════
   QUICK EMAIL — Template catalog (no DOM).
   Loads system templates from data/quick-email-templates.json
   and merges them with user-saved templates.
   Exposes:
     - getQuickEmailCatalog()
     - getQuickEmailTemplateById(id)
     - getFieldsUsedByTemplate(template)
     - getRequiredFieldsForTemplate(template)
   ═══════════════════════════════════════════════════════ */

(function (global) {
  /* The list of "always shown" matter-detail fields in the modal.
     Anything outside this set is treated as an OPTIONAL field that
     only appears in the form when the chosen template uses it. */
  var COMMON_FIELDS = [
    'officerEmail', 'oicName', 'clientName', 'station',
    'offenceType', 'attendanceType', 'date', 'time'
  ];

  var OPTIONAL_FIELDS = [
    'bailDate', 'bailTime',
    'bailConditions',
    'ourFileNumber', 'ufn'
  ];

  /* The bundled JSON file never changes at runtime, so we cache it once.
     Overrides/deletions live in app settings and are re-read every call
     so edits made in the modal show up instantly without an app reload. */
  var _systemJsonCache = null;

  function _loadSystemDefaults() {
    if (_systemJsonCache !== null) return _systemJsonCache;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'data/quick-email-templates.json', false);
      xhr.send(null);
      if (xhr.status === 200 && xhr.responseText) {
        var parsed = JSON.parse(xhr.responseText);
        var list = (parsed && Array.isArray(parsed.templates)) ? parsed.templates : [];
        _systemJsonCache = list.map(_normaliseSystemTemplate);
        return _systemJsonCache;
      }
    } catch (e) {
      console.warn('[quickEmailTemplateCatalog] Could not load data/quick-email-templates.json', e);
    }
    _systemJsonCache = [];
    return _systemJsonCache;
  }

  function _getSystemOverrides() {
    if (typeof global._getSystemEmailOverrides !== 'function') return {};
    try { return global._getSystemEmailOverrides() || {}; }
    catch (_) { return {}; }
  }

  function _getDeletedSystemIds() {
    if (typeof global._getDeletedSystemEmailIds !== 'function') return [];
    try { return global._getDeletedSystemEmailIds() || []; }
    catch (_) { return []; }
  }

  function _loadSystemTemplates() {
    var defaults = _loadSystemDefaults();
    var overrides = _getSystemOverrides();
    var deletedIds = _getDeletedSystemIds();
    var deletedSet = {};
    deletedIds.forEach(function(id) { deletedSet[id] = true; });
    return defaults
      .filter(function(t) { return !deletedSet[t.id]; })
      .map(function(t) {
        var ov = overrides && overrides[t.id];
        if (!ov || typeof ov !== 'object') return t;
        var merged = Object.assign({}, t, {
          name:            (typeof ov.name === 'string' && ov.name.trim()) ? ov.name.trim() : t.name,
          category:        (typeof ov.category === 'string' && ov.category.trim()) ? ov.category.trim() : t.category,
          description:     (typeof ov.description === 'string') ? ov.description : t.description,
          subjectTemplate: (typeof ov.subjectTemplate === 'string') ? ov.subjectTemplate : t.subjectTemplate,
          bodyTemplate:    (typeof ov.bodyTemplate === 'string') ? ov.bodyTemplate : t.bodyTemplate,
          requiredFields:  Array.isArray(ov.requiredFields) ? ov.requiredFields.slice() : t.requiredFields,
          isSystemTemplate: true,
          isCustomized: true
        });
        return merged;
      });
  }

  function _normaliseSystemTemplate(t) {
    t = t || {};
    return {
      id:               String(t.id || '').trim() || ('system:' + Math.random().toString(36).slice(2, 9)),
      name:             String(t.name || 'Untitled').trim(),
      category:         String(t.category || 'Other').trim(),
      description:      String(t.description || '').trim(),
      subjectTemplate:  String(t.subjectTemplate || t.subject || ''),
      bodyTemplate:     String(t.bodyTemplate    || t.body    || ''),
      requiredFields:   Array.isArray(t.requiredFields) ? t.requiredFields.slice() : [],
      isSystemTemplate: true,
      isCustomized:     false
    };
  }

  function hasSystemEmailCustomizations() {
    var overrides = _getSystemOverrides();
    var deleted = _getDeletedSystemIds();
    return Object.keys(overrides).length > 0 || deleted.length > 0;
  }

  function _normaliseUserTemplate(t, idx) {
    t = t || {};
    var subject = String(t.subjectTemplate || t.subject || '');
    var body    = String(t.bodyTemplate    || t.body    || '');
    var required = Array.isArray(t.requiredFields)
      ? t.requiredFields.slice()
      : (typeof global.extractQuickEmailPlaceholderKeys === 'function'
          ? global.extractQuickEmailPlaceholderKeys(subject, body).filter(function(k) {
              return COMMON_FIELDS.indexOf(k) !== -1 && k !== 'oicName';
            })
          : []);
    return {
      id:               t.id ? String(t.id) : ('custom:' + idx),
      name:             String(t.name || 'Custom template').trim(),
      category:         String(t.category || 'Other').trim() || 'Other',
      description:      String(t.description || '').trim(),
      subjectTemplate:  subject,
      bodyTemplate:     body,
      requiredFields:   required,
      isSystemTemplate: false,
      _userIndex:       idx,
      _raw:             t
    };
  }

  function _loadUserTemplates() {
    if (typeof global._getCustomEmailTemplates !== 'function') return [];
    var raw = global._getCustomEmailTemplates() || [];
    return raw
      .map(function(t, idx) { return _normaliseUserTemplate(t, idx); })
      .filter(function(t) {
        var scope = (t._raw && t._raw.scope) || 'all';
        if (scope !== 'all' && scope !== 'officer') return false;
        if (t._raw && t._raw.archived) return false;
        return true;
      });
  }

  function getQuickEmailCatalog() {
    var system = _loadSystemTemplates().slice();
    var user   = _loadUserTemplates();
    return {
      system: system,
      user:   user,
      all:    system.concat(user)
    };
  }

  function getQuickEmailTemplateById(id) {
    if (!id) return null;
    var cat = getQuickEmailCatalog();
    for (var i = 0; i < cat.all.length; i++) {
      if (cat.all[i].id === id) return cat.all[i];
    }
    return null;
  }

  /** Unique placeholder keys used by the template (subject + body),
      including those wrapped in {{#if X}}…{{/if}} blocks. */
  function getFieldsUsedByTemplate(template) {
    if (!template) return [];
    if (typeof global.extractQuickEmailPlaceholderKeys === 'function') {
      return global.extractQuickEmailPlaceholderKeys(
        template.subjectTemplate || '',
        template.bodyTemplate || ''
      );
    }
    return [];
  }

  /** Required fields the user MUST supply for the template to make sense.
      Falls back to common fields the template references outside any
      {{#if}} block (i.e. unconditional placeholders) when not declared. */
  function getRequiredFieldsForTemplate(template) {
    if (!template) return [];
    if (Array.isArray(template.requiredFields) && template.requiredFields.length) {
      return template.requiredFields.slice();
    }
    var subject = String(template.subjectTemplate || '');
    var body    = String(template.bodyTemplate    || '');
    /* Strip conditional blocks — anything inside is optional. */
    var unconditional = (subject + '\n' + body).replace(
      /\{\{\s*#if\s+[a-zA-Z0-9_]+\s*\}\}[\s\S]*?\{\{\s*\/if\s*\}\}/g,
      ''
    );
    if (typeof global.extractQuickEmailPlaceholderKeys === 'function') {
      return global.extractQuickEmailPlaceholderKeys('', unconditional)
        .filter(function(k) { return k !== 'feeEarnerName' && k !== 'todayDate'; });
    }
    return [];
  }

  global.QUICK_EMAIL_COMMON_FIELDS = COMMON_FIELDS.slice();
  global.QUICK_EMAIL_OPTIONAL_FIELDS = OPTIONAL_FIELDS.slice();
  global.getQuickEmailCatalog = getQuickEmailCatalog;
  global.getQuickEmailTemplateById = getQuickEmailTemplateById;
  global.getFieldsUsedByTemplate = getFieldsUsedByTemplate;
  global.getRequiredFieldsForTemplate = getRequiredFieldsForTemplate;
  global.hasSystemEmailCustomizations = hasSystemEmailCustomizations;
})(typeof window !== 'undefined' ? window : globalThis);
