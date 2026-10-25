'use strict';

/**
 * Detect and correct common out-of-date statutory references in AI law drafts.
 * Maintained list — police-station / either-way sentencing focus.
 *
 * Verified references (2026):
 * - Sentencing Act 2020 s.314 — third domestic burglary minimum (replaced PCC(S)A 2000 s.111).
 * - Magistrates' TEW single-offence custody limit: 12 months from 18 Nov 2024 (SI 2024/1067 amending SA 2020 s.224).
 * - CJA 1988 s.139(6)(a) still states 6 months on summary conviction; either-way summary trial uses SA 2020 s.224 limit.
 */

const REPEALED_ACT_PATTERNS = [
  {
    id: 'pccsa-2000',
    actPattern: /Powers of Criminal Courts \(Sentencing\) Act 2000/gi,
    shortPattern: /\bPCC\s*\(?S\s*\)?\s*A\s*2000\b/gi,
    replacementAct: 'Sentencing Act 2020',
    userWarning:
      'Powers of Criminal Courts (Sentencing) Act 2000 was repealed — use Sentencing Act 2020 for current minimum sentences.',
  },
];

const SECTION_REMAP = [
  {
    id: 'domestic-burglary-third-min',
    contextPattern: /domestic burglary|third burglary|3(?:rd)?\s+domestic/i,
    oldSection: /\bs\.?\s*111\b(?:\s*\([^)]*\))?/gi,
    oldActHint: /PCC\s*\(?S\s*\)?\s*A|Powers of Criminal Courts \(Sentencing\) Act 2000/i,
    newCitation: 'Sentencing Act 2020 s.314',
    userWarning:
      'Third domestic burglary minimum sentence is Sentencing Act 2020 s.314 (not PCC(S)A 2000 s.111).',
  },
];

/** Either-way offences: magistrates' 6-month summary cap is often stale post Nov 2024. */
const MAGISTRATES_SIX_MONTH_STALE = {
  id: 'magistrates-tew-12-months',
  textPattern:
    /magistrates['’]?\s+court[\s\S]{0,200}?\b6\s*(?:months?|mths?)\b/i,
  altPattern:
    /\b(?:up to|maximum)\b[\s\S]{0,120}?\b6\s*(?:months?|mths?)\b[\s\S]{0,120}?magistrates['’]?\s+court/i,
  contextPattern:
    /either\s+way|triable either way|s\.?\s*139\b|bladed|Criminal Justice Act 1988|CJA\s*1988/i,
  userWarning:
    'Magistrates may impose up to 12 months for a single triable-either-way offence on summary trial (Sentencing Act 2020 s.224, as amended with effect from 18 November 2024). CJA 1988 s.139(6)(a) still lists 6 months on summary conviction — apply the Sentencing Act general limit for either-way summary trial.',
  correctionSnippet:
    'In the magistrates\' court on summary trial of this either-way offence, the general custodial limit is up to 12 months (Sentencing Act 2020 s.224, as amended from 18 November 2024), subject to the offence maximum on indictment (4 years for s.139 CJA 1988).',
};

function uniqueWarnings(list) {
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < list.length; i++) {
    const w = String(list[i] || '').trim();
    if (!w || seen[w]) continue;
    seen[w] = true;
    out.push(w);
  }
  return out;
}

function detectStaleLegalReferences(noteText) {
  const text = String(noteText || '');
  const warnings = [];
  const flags = [];

  for (let i = 0; i < REPEALED_ACT_PATTERNS.length; i++) {
    const row = REPEALED_ACT_PATTERNS[i];
    if (row.actPattern.test(text) || row.shortPattern.test(text)) {
      flags.push(row.id);
      warnings.push(row.userWarning);
    }
    row.actPattern.lastIndex = 0;
    row.shortPattern.lastIndex = 0;
  }

  for (let j = 0; j < SECTION_REMAP.length; j++) {
    const map = SECTION_REMAP[j];
    const hasOldSection = map.oldSection.test(text);
    const hasContext = map.contextPattern.test(text);
    const hasOldAct = map.oldActHint.test(text);
    map.oldSection.lastIndex = 0;
    map.contextPattern.lastIndex = 0;
    map.oldActHint.lastIndex = 0;
    if (hasOldSection && (hasContext || hasOldAct)) {
      flags.push(map.id);
      warnings.push(map.userWarning);
    }
  }

  const m = MAGISTRATES_SIX_MONTH_STALE;
  const staleMag =
    (m.textPattern.test(text) || m.altPattern.test(text)) && m.contextPattern.test(text);
  m.textPattern.lastIndex = 0;
  m.altPattern.lastIndex = 0;
  m.contextPattern.lastIndex = 0;
  if (staleMag) {
    flags.push(m.id);
    warnings.push(m.userWarning);
  }

  return { flags: flags, warnings: uniqueWarnings(warnings) };
}

function applyStatuteReplacements(noteText) {
  let text = String(noteText || '');
  const applied = [];

  for (let i = 0; i < REPEALED_ACT_PATTERNS.length; i++) {
    const row = REPEALED_ACT_PATTERNS[i];
    if (row.actPattern.test(text)) {
      text = text.replace(row.actPattern, row.replacementAct);
      applied.push('act:' + row.id);
    }
    row.actPattern.lastIndex = 0;
    if (row.shortPattern.test(text)) {
      text = text.replace(row.shortPattern, row.replacementAct);
      applied.push('short:' + row.id);
    }
    row.shortPattern.lastIndex = 0;
  }

  for (let j = 0; j < SECTION_REMAP.length; j++) {
    const map = SECTION_REMAP[j];
    const hasContext = map.contextPattern.test(text);
    map.contextPattern.lastIndex = 0;
    if (!hasContext && !map.oldActHint.test(text)) {
      map.oldActHint.lastIndex = 0;
      continue;
    }
    map.oldActHint.lastIndex = 0;
    if (map.oldSection.test(text)) {
      text = text.replace(map.oldSection, map.newCitation);
      applied.push('section:' + map.id);
    }
    map.oldSection.lastIndex = 0;
  }

  return { text: text.trim(), applied: applied };
}

function applyMagistratesSentencingCorrection(noteText, warnings) {
  const text = String(noteText || '');
  const m = MAGISTRATES_SIX_MONTH_STALE;
  const stale =
    (m.textPattern.test(text) || m.altPattern.test(text)) && m.contextPattern.test(text);
  m.textPattern.lastIndex = 0;
  m.altPattern.lastIndex = 0;
  m.contextPattern.lastIndex = 0;
  if (!stale) return { text: text, applied: false };

  const staleLine =
    /magistrates['’]?\s+court[\s\S]{0,200}?\b6\s*(?:months?|mths?)\b/i.test(text) ||
    /\b6\s*(?:months?|mths?)\b[\s\S]{0,200}?magistrates['’]?\s+court/i.test(text);

  let newText = text;
  if (staleLine) {
    newText = newText.replace(
      /-[^\n]*magistrates['’]?\s+court[^\n]*\b6\s*(?:months?|mths?)\b[^\n]*/i,
      '- ' + m.correctionSnippet,
    );
    if (newText === text) {
      newText = newText.replace(
        /-[^\n]*\b6\s*(?:months?|mths?)\b[^\n]*magistrates['’]?\s+court[^\n]*/i,
        '- ' + m.correctionSnippet,
      );
    }
  }
  if (newText === text) {
    newText = text.trim() + '\n\nSentencing\n- ' + m.correctionSnippet;
  }
  return {
    text: newText.trim(),
    applied: true,
    warnings: warnings && warnings.length ? warnings : [m.userWarning],
  };
}

/**
 * @param {string} noteText - cleaned note body
 * @returns {{ noteText: string, stalenessWarnings: string[], needsRegenerate: boolean, regeneratePrompt?: string }}
 */
function guardLawNoteStaleness(noteText) {
  const detected = detectStaleLegalReferences(noteText);
  let text = noteText;
  const replaced = applyStatuteReplacements(text);
  text = replaced.text;

  const afterDetect = detectStaleLegalReferences(text);
  let warnings = uniqueWarnings(detected.warnings.concat(afterDetect.warnings));

  const magFix = applyMagistratesSentencingCorrection(text, warnings);
  if (magFix.applied) {
    text = magFix.text;
    warnings = uniqueWarnings(warnings.concat(magFix.warnings || []));
  }

  const finalDetect = detectStaleLegalReferences(text);
  const needsRegenerate = finalDetect.flags.length > 0;

  if (replaced.applied.length) {
    warnings = uniqueWarnings(
      warnings.concat(['Statutory references were updated to current legislation (Sentencing Act 2020).']),
    );
  }
  if (magFix.applied) {
    warnings = uniqueWarnings(
      warnings.concat(['Magistrates\' court sentencing limit was adjusted to reflect Sentencing Act 2020 s.224.']),
    );
  }

  let regeneratePrompt;
  if (needsRegenerate) {
    regeneratePrompt =
      'Your previous draft was flagged as citing OUT-OF-DATE legislation or sentencing limits. Regenerate using web search on legislation.gov.uk and sentencingcouncil.org.uk ONLY.\n' +
      '- Do NOT cite the Powers of Criminal Courts (Sentencing) Act 2000 (repealed). Minimum sentences for third domestic burglary are in Sentencing Act 2020 s.314.\n' +
      '- For triable-either-way offences in the magistrates\' court, state the Sentencing Act 2020 s.224 custodial limit (12 months for a single offence from 18 November 2024) where relevant — not only the old 6-month figure from the offence Act.\n' +
      'Issues detected:\n' +
      finalDetect.warnings.map(function (w, idx) {
        return idx + 1 + '. ' + w;
      }).join('\n') +
      '\nKeep plain-text note format (Actus reus / Mens rea / Common defences / Sentencing). No intro, URLs, or markdown.';
  }

  return {
    noteText: text,
    stalenessWarnings: uniqueWarnings(warnings.concat(finalDetect.warnings)),
    needsRegenerate: needsRegenerate,
    regeneratePrompt: regeneratePrompt,
  };
}

function buildRegeneratePromptFromWarnings(warnings) {
  const list = Array.isArray(warnings) ? warnings : [];
  if (!list.length) return '';
  return (
    'Regenerate the law draft. The previous version may be out of date:\n' +
    list.map(function (w, i) {
      return i + 1 + '. ' + w;
    }).join('\n')
  );
}

module.exports = {
  REPEALED_ACT_PATTERNS,
  SECTION_REMAP,
  MAGISTRATES_SIX_MONTH_STALE,
  detectStaleLegalReferences,
  applyStatuteReplacements,
  applyMagistratesSentencingCorrection,
  guardLawNoteStaleness,
  buildRegeneratePromptFromWarnings,
};
