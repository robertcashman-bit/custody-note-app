/**
 * Pro AI summary drafts — privacy-first.
 * Default path builds a local structured draft from form fields (no network).
 * Optional cloud path only when explicitly requested AND Pro entitled AND endpoint configured.
 */
const { isProAiEntitled, describeProAiGate } = require('./proAiEntitlement');

function pick(obj, keys) {
  const out = {};
  keys.forEach((k) => {
    if (obj && obj[k] != null && String(obj[k]).trim() !== '') out[k] = String(obj[k]).trim();
  });
  return out;
}

function buildLocalSummaryDraft(formData, kind) {
  const d = formData || {};
  const lines = [];
  const label = kind === 'interview' ? 'Interview summary draft' : 'Attendance summary draft';
  lines.push(label + ' (Pro AI — local draft, not sent to any provider)');
  lines.push('Generated: ' + new Date().toLocaleString('en-GB'));
  lines.push('');

  if (kind === 'interview') {
    const bits = pick(d, [
      'interviewStartTime',
      'interviewEndTime',
      'interviewingOfficers',
      'interviewPosition',
      'headlineAdvice',
      'interviewNotes',
      'significantStatements',
      'noCommentPeriods',
    ]);
    lines.push(
      'Interview times: ' +
        ([bits.interviewStartTime, bits.interviewEndTime].filter(Boolean).join(' – ') || '—'),
    );
    lines.push('Officers: ' + (bits.interviewingOfficers || '—'));
    lines.push('Position: ' + (bits.interviewPosition || '—'));
    lines.push('Headline advice: ' + (bits.headlineAdvice || '—'));
    lines.push('');
    lines.push('Notes to expand:');
    lines.push(bits.interviewNotes || bits.significantStatements || '(Add interview notes in the form, then regenerate.)');
    if (bits.noCommentPeriods) {
      lines.push('');
      lines.push('No-comment periods: ' + bits.noCommentPeriods);
    }
  } else {
    const bits = pick(d, [
      'forename',
      'surname',
      'policeStationName',
      'dsccRef',
      'allegedOffences',
      'disclosureSummary',
      'adviceGiven',
      'outcomeDecision',
      'outcomeNotes',
      'clientInstructions',
    ]);
    lines.push('Client: ' + ([bits.forename, bits.surname].filter(Boolean).join(' ') || '—'));
    lines.push('Station: ' + (bits.policeStationName || '—'));
    lines.push('DSCC: ' + (bits.dsccRef || '—'));
    lines.push('Alleged offences: ' + (bits.allegedOffences || '—'));
    lines.push('');
    lines.push('Disclosure (summarise objectively):');
    lines.push(bits.disclosureSummary || '—');
    lines.push('');
    lines.push('Instructions / advice:');
    lines.push(bits.clientInstructions || bits.adviceGiven || '—');
    lines.push('');
    lines.push('Outcome: ' + (bits.outcomeDecision || '—'));
    if (bits.outcomeNotes) lines.push(bits.outcomeNotes);
  }

  lines.push('');
  lines.push('Review and edit before saving. This draft is a starting point — not legal advice.');
  return lines.join('\n');
}

/**
 * @param {{ formData: object, kind?: string, licenceStatus: object, useCloud?: boolean, cloudFetcher?: Function }} opts
 */
async function requestProAiDraft(opts) {
  const options = opts || {};
  const gate = describeProAiGate(options.licenceStatus);
  if (!gate.allowed) {
    return { ok: false, error: gate.message, reason: gate.reason };
  }
  const kind = options.kind === 'interview' ? 'interview' : 'attendance';
  const localDraft = buildLocalSummaryDraft(options.formData, kind);

  if (!options.useCloud) {
    return {
      ok: true,
      mode: 'local',
      draft: localDraft,
      message: 'Local draft only — no case content left this device.',
    };
  }

  if (typeof options.cloudFetcher !== 'function') {
    return {
      ok: true,
      mode: 'local',
      draft: localDraft,
      message: 'Cloud AI is not configured. Local draft returned instead.',
      cloudSkipped: true,
    };
  }

  try {
    const remote = await options.cloudFetcher({
      kind,
      // Redacted payload: only free-text note sections the user already typed — still requires explicit consent.
      fields: pick(options.formData || {}, [
        'disclosureSummary',
        'adviceGiven',
        'interviewNotes',
        'clientInstructions',
        'outcomeNotes',
        'headlineAdvice',
      ]),
    });
    if (remote && remote.draft) {
      return {
        ok: true,
        mode: 'cloud',
        draft: String(remote.draft),
        message: 'Cloud draft received. Review and edit before saving.',
      };
    }
  } catch (e) {
    return {
      ok: true,
      mode: 'local',
      draft: localDraft,
      message: 'Cloud AI failed — local draft returned. ' + (e && e.message ? e.message : ''),
      cloudError: true,
    };
  }

  return { ok: true, mode: 'local', draft: localDraft, message: 'Local draft only.' };
}

module.exports = {
  buildLocalSummaryDraft,
  requestProAiDraft,
  isProAiEntitled,
  describeProAiGate,
};
