/* ═══════════════════════════════════════════════════════
   SETTINGS VIEW helpers — loadSettings / saveSettings / loadFirmsList / renderFirmsPage /
   addFirm are defined in app.js. Do not redeclare them here (second copies override the
   real implementations and broke office postcode persistence).
   ═══════════════════════════════════════════════════════ */

function _updateAddonStatusLabel() {
  var lbl = document.getElementById('officer-email-templates-status');
  if (!lbl) return;
  var enabled = window._emailTemplatesAddonEnabled;
  lbl.textContent = enabled ? 'Enabled' : 'Disabled';
  lbl.className   = 'addon-status ' + (enabled ? 'addon-status-on' : 'addon-status-off');
}

/* ── Advanced settings toggle ── */
(function() {
  var toggle = document.getElementById('settings-advanced-toggle');
  if (!toggle) return;
  var shown = false;
  toggle.addEventListener('click', function() {
    shown = !shown;
    toggle.textContent = shown ? 'Hide advanced settings' : 'Show advanced settings';
    document.querySelectorAll('[data-advanced-tab]').forEach(function(el) {
      el.style.display = shown ? '' : 'none';
    });
    document.querySelectorAll('.settings-advanced-section').forEach(function(el) {
      el.style.display = shown ? '' : 'none';
    });
  });
})();
