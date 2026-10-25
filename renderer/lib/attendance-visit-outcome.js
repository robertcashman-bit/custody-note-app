/* attendance-visit-outcome.js — quick visit outcome bar ↔ section 8 outcomeDecision (single source of truth) */
(function (global) {
  'use strict';

  /** Canonical outcomeDecision strings for out-of-court disposals (must match custody §8 options). */
  var OUT_OF_COURT_DISPOSAL_DECISIONS = [
    'Simple Caution',
    'Conditional Caution',
    'Youth caution / Youth conditional caution',
    'Community Resolution',
    'Penalty Notice (PND)',
    'Cannabis / khat warning',
  ];

  var QUICK_CHARGED = 'charged';
  var QUICK_NFA = 'nfa';
  var QUICK_RE_BAILED = 're_bailed';
  var QUICK_RUI = 'rui';
  var QUICK_FURTHER_INTERVIEW = 'further_interview_needed';

  var QUICK_OOC_SIMPLE = 'ooc_simple_caution';
  var QUICK_OOC_CONDITIONAL = 'ooc_conditional_caution';
  var QUICK_OOC_YOUTH = 'ooc_youth_caution';
  var QUICK_OOC_COMMUNITY = 'ooc_community_resolution';
  var QUICK_OOC_PND = 'ooc_penalty_notice';
  var QUICK_OOC_CANNABIS = 'ooc_cannabis_khat';

  var PRIMARY_QUICK_OPTIONS = [
    { code: QUICK_CHARGED, label: 'Charged' },
    { code: QUICK_NFA, label: 'NFA (no further action)' },
    { code: QUICK_RE_BAILED, label: 'Re-bailed' },
    { code: QUICK_RUI, label: 'Released under investigation' },
    { code: QUICK_FURTHER_INTERVIEW, label: 'Further interview needed' },
  ];

  var OOC_QUICK_OPTIONS = [
    { code: QUICK_OOC_SIMPLE, label: 'Simple caution', decision: 'Simple Caution' },
    { code: QUICK_OOC_CONDITIONAL, label: 'Conditional caution', decision: 'Conditional Caution' },
    { code: QUICK_OOC_YOUTH, label: 'Youth caution / Youth conditional caution', decision: 'Youth caution / Youth conditional caution' },
    { code: QUICK_OOC_COMMUNITY, label: 'Community resolution', decision: 'Community Resolution' },
    { code: QUICK_OOC_PND, label: 'Penalty notice (PND)', decision: 'Penalty Notice (PND)' },
    { code: QUICK_OOC_CANNABIS, label: 'Cannabis / khat warning', decision: 'Cannabis / khat warning' },
  ];

  var QUICK_TO_DECISION = {
    charged: 'Charged without Bail',
    nfa: 'Released NFA',
    re_bailed: 'Bail without charge',
    rui: 'Released Under Investigation',
    further_interview_needed: 'Ongoing / Unknown',
  };

  OOC_QUICK_OPTIONS.forEach(function (o) {
    QUICK_TO_DECISION[o.code] = o.decision;
  });

  var DECISION_TO_QUICK = {};
  Object.keys(QUICK_TO_DECISION).forEach(function (code) {
    DECISION_TO_QUICK[QUICK_TO_DECISION[code]] = code;
  });

  var CHARGED_DECISIONS = ['Charged without Bail', 'Charged with Bail', 'Remanded in Custody'];

  /** Visit types that show the quick outcome control (not first / ID / RUI return). */
  function visitTypeShowsQuickOutcome(visitTypeCode) {
    if (!visitTypeCode || visitTypeCode === 'first') return false;
    if (visitTypeCode === 'identification' || visitTypeCode === 'rui_return') return false;
    return true;
  }

  function mapQuickOutcomeToDecision(quickCode) {
    if (!quickCode) return '';
    return QUICK_TO_DECISION[quickCode] || '';
  }

  function resolveQuickOutcomeFromDecision(decision) {
    var d = String(decision || '').trim();
    if (!d) return '';
    if (CHARGED_DECISIONS.indexOf(d) !== -1) return QUICK_CHARGED;
    if (DECISION_TO_QUICK[d]) return DECISION_TO_QUICK[d];
    return '';
  }

  function listQuickVisitOutcomeOptions() {
    var flat = PRIMARY_QUICK_OPTIONS.slice();
    OOC_QUICK_OPTIONS.forEach(function (o) {
      flat.push({ code: o.code, label: o.label });
    });
    return flat;
  }

  function listQuickVisitOutcomeOptionGroups() {
    return [
      { label: '', options: PRIMARY_QUICK_OPTIONS.slice() },
      { label: 'Out-of-court disposal', options: OOC_QUICK_OPTIONS.map(function (o) {
        return { code: o.code, label: o.label };
      }) },
    ];
  }

  global.OUT_OF_COURT_DISPOSAL_DECISIONS = OUT_OF_COURT_DISPOSAL_DECISIONS;
  global.visitTypeShowsQuickOutcome = visitTypeShowsQuickOutcome;
  global.mapQuickVisitOutcomeToDecision = mapQuickOutcomeToDecision;
  global.resolveQuickVisitOutcomeFromDecision = resolveQuickOutcomeFromDecision;
  global.listQuickVisitOutcomeOptions = listQuickVisitOutcomeOptions;
  global.listQuickVisitOutcomeOptionGroups = listQuickVisitOutcomeOptionGroups;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      OUT_OF_COURT_DISPOSAL_DECISIONS: OUT_OF_COURT_DISPOSAL_DECISIONS,
      visitTypeShowsQuickOutcome: visitTypeShowsQuickOutcome,
      mapQuickVisitOutcomeToDecision: mapQuickOutcomeToDecision,
      resolveQuickVisitOutcomeFromDecision: resolveQuickOutcomeFromDecision,
      listQuickVisitOutcomeOptions: listQuickVisitOutcomeOptions,
      listQuickVisitOutcomeOptionGroups: listQuickVisitOutcomeOptionGroups,
      QUICK_TO_DECISION: QUICK_TO_DECISION,
    };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : globalThis));
