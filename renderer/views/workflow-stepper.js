/* ═══════════════════════════════════════════════════════
   END-OF-MATTER WORKFLOW
   2-step flow: Documents → Billing
   Replaces the old billing overlay with a full-panel workflow.
   Depends on: filenameUtils.js, billingUtils.js, billing.js globals,
               app.js globals (getFormData, currentAttendanceId, formData, stations, firms)
   ═══════════════════════════════════════════════════════ */

var _workflowOpen = false;
var _workflowStep = 0; // 0=Documents, 1=Billing
var _workflowOnClose = null;

var _workflowSteps = [
  { id: 'documents', label: 'Documents', icon: '&#128196;' },
  { id: 'billing',   label: 'Billing',   icon: '&#163;' },
];

function _wfMatterMeta() {
  var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
  var clientName = [data.forename, data.surname].filter(Boolean).join(' ') || '';
  var firmName = data.firmName || '';
  var stationName = data.policeStationName || '';
  var attendanceDate = data.date || data.instructionDateTime || '';
  if (attendanceDate && attendanceDate.length > 10) attendanceDate = attendanceDate.slice(0, 10);
  var recordId = window.currentAttendanceId || null;
  return {
    clientName: clientName,
    firmName: firmName,
    stationName: stationName,
    attendanceDate: attendanceDate,
    offenceSummary: data.offenceSummary || data.offence1Details || '',
    recordId: recordId,
    data: data,
  };
}

function _wfEsc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _wfFmtDate(val) {
  if (!val) return '';
  var m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : val;
}

function _wfBuildStepper() {
  var html = '<nav class="wf-stepper" aria-label="Workflow steps">';
  for (var i = 0; i < _workflowSteps.length; i++) {
    var step = _workflowSteps[i];
    var cls = 'wf-step';
    if (i < _workflowStep) cls += ' wf-step--done';
    if (i === _workflowStep) cls += ' wf-step--active';
    html += '<button type="button" class="' + cls + '" data-wf-idx="' + i + '">' +
      '<span class="wf-step-num">' + (i < _workflowStep ? '&#10003;' : (i + 1)) + '</span>' +
      '<span class="wf-step-label">' + step.label + '</span>' +
    '</button>';
    if (i < _workflowSteps.length - 1) html += '<span class="wf-step-arrow">&#8594;</span>';
  }
  html += '</nav>';
  return html;
}

function _wfBuildSummaryStrip(meta, statusHtml) {
  return '<div class="wf-summary-strip">' +
    '<div class="wf-summary-item"><span class="wf-summary-label">Client</span><span class="wf-summary-value">' + _wfEsc(meta.clientName) + '</span></div>' +
    '<div class="wf-summary-item"><span class="wf-summary-label">Station</span><span class="wf-summary-value">' + _wfEsc(meta.stationName) + '</span></div>' +
    '<div class="wf-summary-item"><span class="wf-summary-label">Date</span><span class="wf-summary-value">' + _wfEsc(_wfFmtDate(meta.attendanceDate)) + '</span></div>' +
    '<div class="wf-summary-item"><span class="wf-summary-label">Firm</span><span class="wf-summary-value">' + _wfEsc(meta.firmName) + '</span></div>' +
    (statusHtml ? '<div class="wf-summary-item">' + statusHtml + '</div>' : '') +
  '</div>';
}

function openWorkflow(startStep, onClose) {
  if (_workflowOpen) return;
  _workflowOpen = true;
  _workflowStep = startStep || 0;
  _workflowOnClose = onClose || null;

  var existing = document.getElementById('workflow-overlay');
  if (existing) existing.remove();

  _renderWorkflowShell();
}

function _renderWorkflowShell() {
  var existing = document.getElementById('workflow-overlay');
  if (existing) existing.remove();

  var meta = _wfMatterMeta();
  var html =
    '<div id="workflow-overlay" class="wf-overlay" role="dialog" aria-modal="true" aria-label="End of matter workflow">' +
      '<div class="wf-panel">' +
        '<div class="wf-panel-header">' +
          '<h2 class="wf-panel-title">&#163; Billing &amp; Documents</h2>' +
          '<button type="button" class="wf-panel-close" aria-label="Close">&times;</button>' +
        '</div>' +
        _wfBuildStepper() +
        _wfBuildSummaryStrip(meta, '') +
        '<div id="wf-body" class="wf-body"></div>' +
        '<div id="wf-footer" class="wf-footer"></div>' +
      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', html);
  _wfBindShellEvents();
  _wfRenderCurrentStep();
}

function _wfBindShellEvents() {
  var overlay = document.getElementById('workflow-overlay');
  if (!overlay) return;
  overlay.querySelector('.wf-panel-close').addEventListener('click', closeWorkflow);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeWorkflow(); });
  function onEsc(e) { if (e.key === 'Escape') closeWorkflow(); }
  document.addEventListener('keydown', onEsc);
  overlay._wfEscHandler = onEsc;

  overlay.querySelectorAll('.wf-step').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var idx = parseInt(btn.getAttribute('data-wf-idx'), 10);
      if (Number.isFinite(idx) && idx >= 0 && idx < _workflowSteps.length) {
        _workflowStep = idx;
        _wfUpdateStepper();
        _wfRenderCurrentStep();
      }
    });
  });
}

function _wfUpdateStepper() {
  var overlay = document.getElementById('workflow-overlay');
  if (!overlay) return;
  overlay.querySelectorAll('.wf-step').forEach(function (btn, i) {
    btn.classList.toggle('wf-step--done', i < _workflowStep);
    btn.classList.toggle('wf-step--active', i === _workflowStep);
    var numEl = btn.querySelector('.wf-step-num');
    if (numEl) numEl.innerHTML = i < _workflowStep ? '&#10003;' : String(i + 1);
  });
}

function _wfRenderCurrentStep() {
  var body = document.getElementById('wf-body');
  var footer = document.getElementById('wf-footer');
  if (!body || !footer) return;

  switch (_workflowSteps[_workflowStep].id) {
    case 'documents': _wfRenderDocumentsStep(body, footer); break;
    case 'billing':   _wfRenderBillingStep(body, footer); break;
  }
}

function _wfGoNext() {
  if (_workflowStep < _workflowSteps.length - 1) {
    _workflowStep++;
    _wfUpdateStepper();
    _wfRenderCurrentStep();
  }
}

function _wfGoBack() {
  if (_workflowStep > 0) {
    _workflowStep--;
    _wfUpdateStepper();
    _wfRenderCurrentStep();
  }
}

function closeWorkflow() {
  _workflowOpen = false;
  var overlay = document.getElementById('workflow-overlay');
  if (overlay) {
    if (overlay._wfEscHandler) document.removeEventListener('keydown', overlay._wfEscHandler);
    overlay.remove();
  }
  if (typeof _workflowOnClose === 'function') {
    var cb = _workflowOnClose;
    _workflowOnClose = null;
    cb();
  }
}
