/* ═══════════════════════════════════════════════════════════════
   OFFICER EMAIL TEMPLATES — Manager Modal

   CRUD UI on top of OfficerEmailTemplatesStore. Pure copy-and-paste
   workflow — never opens Outlook, never saves anything outside the
   user's settings JSON layer.

     window.openOfficerEmailTemplatesManager({
       onChange: function () { ... re-render dropdown ... }
     })
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var Store = (typeof window !== 'undefined' && window.OfficerEmailTemplatesStore) || null;
  if (!Store) {
    /* Loaded out of order — fail gracefully but still provide the global so callers don't crash. */
    if (typeof window !== 'undefined') {
      window.openOfficerEmailTemplatesManager = function () {
        try { console.error('[officerEmailTemplatesManager] Store not loaded'); } catch (_) {}
      };
    }
    return;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ask(message) {
    if (typeof window !== 'undefined' && typeof window.showConfirm === 'function') {
      return window.showConfirm(message);
    }
    return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(message) : true);
  }

  function toast(msg, type, ms) {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(msg, type || 'info', ms);
    }
  }

  /** Strip newlines from subject so a stray Enter cannot break Outlook headers. */
  function stripSubjectNewlines(s) {
    return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  function openOfficerEmailTemplatesManager(opts) {
    opts = opts || {};
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

    /* Remove any stale instance */
    var stale = document.getElementById('officer-tpl-manager-overlay');
    if (stale) stale.remove();

    var overlay = document.createElement('div');
    overlay.id = 'officer-tpl-manager-overlay';
    overlay.className = 'officer-tpl-mgr-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Officer email templates');

    overlay.innerHTML =
      '<div class="officer-tpl-mgr-box">' +
        '<header class="officer-tpl-mgr-head">' +
          '<h2>Officer email templates</h2>' +
          '<div class="officer-tpl-mgr-head-actions">' +
            '<button type="button" class="btn btn-secondary" id="officerTplMgrRestoreBtn" title="Add any built-in templates that you have deleted (never overwrites your edits)">Restore defaults</button>' +
            '<button type="button" class="btn btn-secondary" id="officerTplMgrCloseBtn" aria-label="Close">Close</button>' +
          '</div>' +
        '</header>' +

        '<div class="officer-tpl-mgr-body">' +

          '<aside class="officer-tpl-mgr-side">' +
            '<div class="officer-tpl-mgr-side-head">' +
              '<h3>Your templates</h3>' +
              '<button type="button" class="btn btn-primary" id="officerTplMgrNewBtn">+ New</button>' +
            '</div>' +
            '<ul id="officerTplMgrList" class="officer-tpl-mgr-list" role="listbox" aria-label="Templates"></ul>' +
            '<p id="officerTplMgrEmpty" class="officer-tpl-mgr-empty muted" style="display:none;"></p>' +
          '</aside>' +

          '<section class="officer-tpl-mgr-edit">' +
            '<h3 id="officerTplMgrFormTitle">Edit template</h3>' +
            '<label>Name<input type="text" id="officerTplMgrName" maxlength="120" placeholder="e.g. Bail variation request" autocomplete="off" /></label>' +
            '<label>Subject template <span class="muted">(single line — newlines will be stripped)</span><input type="text" id="officerTplMgrSubject" maxlength="300" placeholder="{{clientName}} - Subject line" autocomplete="off" /></label>' +
            '<label>Body template<textarea id="officerTplMgrBody" rows="10" placeholder="Dear {{officerRank}} {{officerSurname}},&#10;&#10;Body of the email...&#10;&#10;Note: a closing signature is appended automatically when the template is generated."></textarea></label>' +
            '<details class="officer-tpl-mgr-placeholders">' +
              '<summary>Available placeholders</summary>' +
              '<p class="muted">Click to insert at the cursor position in the body. Subject placeholders are typed manually.</p>' +
              '<div id="officerTplMgrPlaceholderChips" class="officer-tpl-mgr-chips"></div>' +
            '</details>' +
            '<div class="officer-tpl-mgr-actions">' +
              '<button type="button" class="btn btn-primary" id="officerTplMgrSaveBtn">Save</button>' +
              '<button type="button" class="btn btn-secondary" id="officerTplMgrCancelBtn">Cancel</button>' +
              '<button type="button" class="btn btn-secondary" id="officerTplMgrDuplicateBtn">Duplicate</button>' +
              '<button type="button" class="danger-button" id="officerTplMgrDeleteBtn">Delete</button>' +
            '</div>' +
          '</section>' +

        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    /* ── State ──────────────────────────────────── */
    var templates = Store.list();
    var selectedKey = templates[0] ? templates[0].key : '';
    var dirty = false;
    var creating = false;

    var $list = overlay.querySelector('#officerTplMgrList');
    var $empty = overlay.querySelector('#officerTplMgrEmpty');
    var $name = overlay.querySelector('#officerTplMgrName');
    var $subject = overlay.querySelector('#officerTplMgrSubject');
    var $body = overlay.querySelector('#officerTplMgrBody');
    var $title = overlay.querySelector('#officerTplMgrFormTitle');
    var $delete = overlay.querySelector('#officerTplMgrDeleteBtn');
    var $duplicate = overlay.querySelector('#officerTplMgrDuplicateBtn');
    var $chips = overlay.querySelector('#officerTplMgrPlaceholderChips');

    function isDirty() {
      var snap = Store.get(selectedKey);
      if (creating) return ($name.value + $subject.value + $body.value) !== '';
      if (!snap) return false;
      return $name.value !== snap.name
        || $subject.value !== snap.subjectTemplate
        || $body.value !== snap.bodyTemplate;
    }

    function syncDirty() { dirty = isDirty(); }

    function applyEditor(tpl) {
      creating = !tpl;
      if (tpl) {
        $name.value = tpl.name || '';
        $subject.value = tpl.subjectTemplate || '';
        $body.value = tpl.bodyTemplate || '';
        $title.textContent = 'Edit "' + (tpl.name || 'Untitled') + '"';
        $delete.style.display = '';
        $duplicate.style.display = '';
      } else {
        $name.value = '';
        $subject.value = '';
        $body.value = '';
        $title.textContent = 'New template';
        $delete.style.display = 'none';
        $duplicate.style.display = 'none';
      }
      dirty = false;
    }

    function renderList() {
      templates = Store.list();
      if (!templates.length) {
        $list.innerHTML = '';
        $empty.style.display = '';
        $empty.textContent = 'No templates yet — click + New to add one, or "Restore defaults" to bring back the built-in starter set.';
        applyEditor(null);
        creating = true;
        return;
      }
      $empty.style.display = 'none';
      $list.innerHTML = templates.map(function (t) {
        var isActive = t.key === selectedKey ? ' active' : '';
        return '<li class="officer-tpl-mgr-item' + isActive + '" role="option" aria-selected="' + (t.key === selectedKey) + '" data-key="' + esc(t.key) + '" tabindex="0">' +
          '<span class="officer-tpl-mgr-item-name">' + esc(t.name || 'Untitled') + '</span>' +
          '<span class="officer-tpl-mgr-item-subject muted">' + esc(t.subjectTemplate || '') + '</span>' +
        '</li>';
      }).join('');
      var nodes = $list.querySelectorAll('.officer-tpl-mgr-item');
      for (var i = 0; i < nodes.length; i++) {
        (function (li) {
          function go() {
            if (!isDirty()) {
              selectedKey = li.dataset.key;
              applyEditor(Store.get(selectedKey));
              renderList();
              return;
            }
            ask('Discard unsaved changes to this template?').then(function (ok) {
              if (!ok) return;
              selectedKey = li.dataset.key;
              applyEditor(Store.get(selectedKey));
              renderList();
            });
          }
          li.addEventListener('click', go);
          li.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
          });
        })(nodes[i]);
      }
    }

    function renderChips() {
      var keys = [
        ['officerRank', 'Officer rank (e.g. DC)'],
        ['officerSurname', 'Officer surname'],
        ['clientName', 'Full client name'],
        ['policeStation', 'Police station / unit'],
        ['interviewDate', 'Attendance / interview date (formatted)'],
        ['custodyNumber', 'Custody record number'],
        ['dsccReference', 'DSCC reference'],
        ['matter', 'Matter / allegation'],
        ['attendanceNote', 'Attendance note'],
      ];
      $chips.innerHTML = keys.map(function (k) {
        return '<button type="button" class="officer-tpl-mgr-chip" data-token="' + esc(k[0]) + '" title="' + esc(k[1]) + '">{{' + esc(k[0]) + '}}</button>';
      }).join('');
      var chips = $chips.querySelectorAll('.officer-tpl-mgr-chip');
      for (var i = 0; i < chips.length; i++) {
        (function (chip) {
          chip.addEventListener('click', function () {
            var token = '{{' + chip.dataset.token + '}}';
            var ta = $body;
            var start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
            var end = ta.selectionEnd != null ? ta.selectionEnd : start;
            ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
            ta.focus();
            ta.selectionStart = ta.selectionEnd = start + token.length;
            ta.dispatchEvent(new Event('input'));
          });
        })(chips[i]);
      }
    }

    function tryClose() {
      if (!isDirty()) { overlay.remove(); return; }
      ask('Discard unsaved changes and close?').then(function (ok) {
        if (ok) overlay.remove();
      });
    }

    /* ── Wire events ───────────────────────────── */

    overlay.querySelector('#officerTplMgrCloseBtn').addEventListener('click', tryClose);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) tryClose(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        tryClose();
        document.removeEventListener('keydown', escHandler);
      }
    });

    [$name, $subject, $body].forEach(function (el) {
      el.addEventListener('input', syncDirty);
      el.addEventListener('change', syncDirty);
    });
    $subject.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') e.preventDefault();
    });
    $subject.addEventListener('blur', function () {
      var clean = stripSubjectNewlines($subject.value);
      if (clean !== $subject.value) { $subject.value = clean; syncDirty(); }
    });

    overlay.querySelector('#officerTplMgrNewBtn').addEventListener('click', function () {
      function start() {
        creating = true;
        selectedKey = '';
        applyEditor(null);
        renderList();
        $name.focus();
      }
      if (isDirty()) ask('Discard unsaved changes and start a new template?').then(function (ok) { if (ok) start(); });
      else start();
    });

    overlay.querySelector('#officerTplMgrSaveBtn').addEventListener('click', function () {
      var name = ($name.value || '').trim();
      var subject = stripSubjectNewlines($subject.value);
      var body = $body.value || '';
      if (!name) { toast('Please enter a template name.', 'error'); $name.focus(); return; }
      if (!subject) { toast('Please enter a subject template.', 'error'); $subject.focus(); return; }
      if (!body.trim()) { toast('Please enter the body template.', 'error'); $body.focus(); return; }
      $subject.value = subject;

      if (creating) {
        var created = Store.create({ name: name, subjectTemplate: subject, bodyTemplate: body });
        creating = false;
        selectedKey = created.key;
        toast('Template added.', 'success');
      } else {
        var updated = Store.update(selectedKey, { name: name, subjectTemplate: subject, bodyTemplate: body });
        if (!updated) { toast('Template no longer exists — saving as new.', 'warning'); var c2 = Store.create({ name: name, subjectTemplate: subject, bodyTemplate: body }); selectedKey = c2.key; }
        else toast('Template saved.', 'success');
      }
      onChange();
      renderList();
      applyEditor(Store.get(selectedKey));
    });

    overlay.querySelector('#officerTplMgrCancelBtn').addEventListener('click', function () {
      if (creating) {
        creating = false;
        selectedKey = templates[0] ? templates[0].key : '';
        applyEditor(selectedKey ? Store.get(selectedKey) : null);
        renderList();
        toast('Cancelled.', 'info');
        return;
      }
      var snap = Store.get(selectedKey);
      if (snap) applyEditor(snap);
      toast('Changes discarded.', 'info');
    });

    overlay.querySelector('#officerTplMgrDeleteBtn').addEventListener('click', function () {
      if (creating || !selectedKey) return;
      var t = Store.get(selectedKey);
      var label = t ? t.name : 'this template';
      ask('Delete "' + label + '"? This cannot be undone — but you can use "Restore defaults" to bring back any built-in template you delete.').then(function (ok) {
        if (!ok) return;
        Store.delete(selectedKey);
        var rest = Store.list();
        selectedKey = rest[0] ? rest[0].key : '';
        applyEditor(selectedKey ? Store.get(selectedKey) : null);
        renderList();
        toast('Template deleted.', 'info');
        onChange();
      });
    });

    overlay.querySelector('#officerTplMgrDuplicateBtn').addEventListener('click', function () {
      if (creating || !selectedKey) return;
      function go() {
        var copy = Store.duplicate(selectedKey);
        if (!copy) return;
        selectedKey = copy.key;
        applyEditor(Store.get(selectedKey));
        renderList();
        toast('Template duplicated.', 'success');
        onChange();
      }
      if (isDirty()) ask('Discard unsaved changes and duplicate?').then(function (ok) { if (ok) go(); });
      else go();
    });

    overlay.querySelector('#officerTplMgrRestoreBtn').addEventListener('click', function () {
      ask('Add any built-in templates that you have deleted? Your existing templates will not be changed.').then(function (ok) {
        if (!ok) return;
        var added = Store.restoreDefaults();
        renderList();
        if (!added.length) toast('All built-ins are already present.', 'info');
        else toast('Restored ' + added.length + ' default template' + (added.length === 1 ? '' : 's') + '.', 'success');
        onChange();
      });
    });

    /* ── Initial render ────────────────────────── */
    if (selectedKey) applyEditor(Store.get(selectedKey));
    else applyEditor(null);
    renderChips();
    renderList();
  }

  if (typeof window !== 'undefined') {
    window.openOfficerEmailTemplatesManager = openOfficerEmailTemplatesManager;
  }
})();
