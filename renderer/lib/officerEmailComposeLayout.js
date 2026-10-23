/* Shared Officer Emails compose layout (standalone + custody-note panel). */
(function (global) {
  'use strict';

  var TEMPLATE_OPTIONS = (typeof OFFICER_EMAIL_TEMPLATE_OPTIONS !== 'undefined')
    ? OFFICER_EMAIL_TEMPLATE_OPTIONS
    : [];
  var DT = global.OfficerEmailDateTime;
  var PINNED = DT && DT.PINNED_TEMPLATE_CHIPS ? DT.PINNED_TEMPLATE_CHIPS : [];

  function chipButtonsHtml() {
    return PINNED.map(function (c) {
      return '<button type="button" class="officer-email-chip" data-template="' + c.value + '">' + c.short + '</button>';
    }).join('');
  }

  function templateOptionsHtml() {
    return TEMPLATE_OPTIONS.map(function (o) {
      return '<option value="' + o.value + '">' + o.label + '</option>';
    }).join('');
  }

  /**
   * @param {string} prefix oes | oep
   * @param {{ showFilledBadge?: boolean }} opts
   */
  function buildFormStepsHtml(prefix, opts) {
    var options = opts || {};
    var badge = options.showFilledBadge
      ? ' <span class="officer-email-filled-badge">filled from the note</span>'
      : '';
    return (
      '<div class="officer-email-step">' +
      '<h3 class="officer-email-step-title"><span class="officer-email-step-num">1</span>What is the email for?</h3>' +
      '<div class="officer-email-chips" data-role="template-chips">' + chipButtonsHtml() + '</div>' +
      '<label class="officer-email-field officer-email-field--full"><span>All email types</span>' +
      '<select id="' + prefix + '-template"></select></label></div>' +
      '<div class="officer-email-step">' +
      '<h3 class="officer-email-step-title"><span class="officer-email-step-num">2</span>Who to</h3>' +
      '<div id="' + prefix + '-recipients" class="officer-email-recipients-block"></div>' +
      '<label class="officer-email-check-row officer-email-multi-recipient-toggle"><input type="checkbox" id="' + prefix + '-multi-officer" />' +
      '<span>Send to another officer as well?</span></label></div>' +
      '<div class="officer-email-step">' +
      '<h3 class="officer-email-step-title"><span class="officer-email-step-num">3</span>' +
      '<span id="' + prefix + '-when-title">When is the attendance?</span></h3>' +
      '<div id="' + prefix + '-when-mount"></div>' +
      '<div id="' + prefix + '-bail-extra" class="officer-email-bail-extra hidden">' +
      '<label class="officer-email-field officer-email-field--full"><span>Bail conditions (optional)</span>' +
      '<textarea id="' + prefix + '-bail-cond" rows="2"></textarea></label></div></div>' +
      '<div class="officer-email-step">' +
      '<h3 class="officer-email-step-title"><span class="officer-email-step-num">4</span>Case details' + badge + '</h3>' +
      '<div class="officer-email-case-grid">' +
      '<label class="officer-email-field"><span>Client name</span><input type="text" id="' + prefix + '-client" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Police station</span><input type="text" id="' + prefix + '-station" autocomplete="off" /></label></div>' +
      '<label class="officer-email-field officer-email-field--full"><span>Offence / allegation</span>' +
      '<input type="text" id="' + prefix + '-offence" autocomplete="off" /></label>' +
      '<details class="officer-email-more-options"><summary>More options (duty solicitor, extra note, my email)</summary>' +
      '<div class="officer-email-more-options-body">' +
      '<label class="officer-email-check-row"><input type="checkbox" id="' + prefix + '-duty-solicitor" />' +
      '<span>I am acting as duty solicitor</span></label>' +
      '<label class="officer-email-check-row"><input type="checkbox" id="' + prefix + '-outlook-sig" />' +
      '<span>My Outlook signature already includes my name</span></label>' +
      '<label class="officer-email-field officer-email-field--full"><span>Extra note (optional)</span>' +
      '<textarea id="' + prefix + '-extra" rows="2"></textarea></label>' +
      '<label class="officer-email-field officer-email-field--full"><span>My email address (optional)</span>' +
      '<input type="email" id="' + prefix + '-user-email" autocomplete="off" /></label>' +
      '</div></details></div>'
    );
  }

  function buildPreviewHtml(prefix) {
    return (
      '<div class="officer-email-preview-card">' +
      '<h3 class="officer-email-preview-heading">Preview <span class="officer-email-preview-tag">updates as you go · click the text to edit</span></h3>' +
      '<div class="officer-email-preview-to">To: <strong id="' + prefix + '-preview-to"></strong></div>' +
      '<label class="officer-email-field officer-email-field--full officer-email-preview-subject-wrap">' +
      '<input type="text" id="' + prefix + '-subject" class="officer-email-preview-subject" autocomplete="off" aria-label="Subject" /></label>' +
      '<textarea id="' + prefix + '-body" class="officer-email-preview-body" rows="16" aria-label="Email body"></textarea>' +
      '<div class="officer-email-preview-actions">' +
      '<button type="button" class="btn btn-primary officer-email-open-outlook" id="' + prefix + '-open">Open in Outlook</button>' +
      '<div class="officer-email-copy-row">' +
      '<button type="button" class="btn btn-secondary btn-small" id="' + prefix + '-copy-owa">Copy link</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="' + prefix + '-copy-to">Copy recipient</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="' + prefix + '-copy-sub">Copy subject</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="' + prefix + '-copy-body">Copy body</button>' +
      '</div></div>' +
      '<p class="officer-email-panel-hint">Nothing is sent until you press Send in Outlook. If Outlook sign-in gets in the way, use the copy buttons.</p>' +
      '<button type="button" class="officer-email-refresh-link hidden" id="' + prefix + '-refresh">Refresh text from template</button>' +
      '</div>'
    );
  }

  function syncTemplateChipSelection(container, templateValue) {
    if (!container) return;
    container.querySelectorAll('.officer-email-chip[data-template]').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-template') === templateValue);
    });
  }

  function updateWhenTitle(el, templateType) {
    if (!el || !DT) return;
    el.textContent = DT.getWhenStepTitle(templateType);
  }

  function syncBailExtraVisibility(wrap, templateType) {
    if (!wrap || !DT) return;
    wrap.classList.toggle('hidden', !DT.isBailTemplate(templateType));
  }

  global.OfficerEmailComposeLayout = {
    buildFormStepsHtml: buildFormStepsHtml,
    buildPreviewHtml: buildPreviewHtml,
    templateOptionsHtml: templateOptionsHtml,
    syncTemplateChipSelection: syncTemplateChipSelection,
    updateWhenTitle: updateWhenTitle,
    syncBailExtraVisibility: syncBailExtraVisibility,
    PINNED: PINNED,
  };
})(typeof window !== 'undefined' ? window : globalThis);
