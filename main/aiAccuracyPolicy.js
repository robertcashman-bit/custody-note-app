/**
 * Non-negotiable AI accuracy rules for Custody Note legal answers.
 * Used by Ask AI and Law / Elements fill — validate before UI accepts a response.
 */

'use strict';

const PREFERRED_UK_LEGAL_DOMAINS = [
  'legislation.gov.uk',
  'www.legislation.gov.uk',
  'www.sentencingcouncil.org.uk',
  'sentencingcouncil.org.uk',
  'www.cps.gov.uk',
  'cps.gov.uk',
  'www.bailii.org',
  'bailii.org',
  'www.judiciary.uk',
  'judiciary.uk',
  'www.gov.uk',
];

const ACCURACY_SYSTEM_RULES =
  'ACCURACY RULES (non-negotiable — violation means the app will reject your answer):\n' +
  '1. No hallucinations. Do not invent statutes, case names, ratios, citations, or dates.\n' +
  '2. Fact-check from several independent sources using web search before asserting law.\n' +
  '3. Be truthful, up to date, and accurate. Prefer current primary/official materials. If the law may have changed, say so.\n' +
  '4. If in doubt, do not quote or assert the point — omit it and list it under Uncertainties.\n' +
  '5. Case law is especially strict: only cite a case if a retrieved source URL supports that citation. Otherwise do not name the case.\n' +
  '6. Ground every substantive legal answer in web search. The app records source URLs from your citations; you may also add a Sources section for validation. At least two distinct official URLs are required or the answer is rejected.\n' +
  'Prefer UK official domains (legislation.gov.uk, sentencingcouncil.org.uk, cps.gov.uk, bailii.org, judiciary.uk, gov.uk) when available.\n' +
  'This is a draft for a qualified solicitor to verify against primary materials — not legal advice. Do not invent client facts.';

const REQUIRED_OUTPUT_SHAPE =
  'Internal structure (for validation — the app strips this before inserting into notes):\n' +
  'Answer\n' +
  '<substantive legal content only in plain language; no preamble; no inline URLs; no markdown>\n\n' +
  'Uncertainties\n' +
  '<points you could not verify, or None>\n\n' +
  'Sources\n' +
  '1. <title> — <https://url>\n' +
  '2. <title> — <https://url>\n' +
  '(Minimum two distinct source URLs across web-search citations and/or the Sources section. ' +
  'If you cannot reliably confirm, reply with a short refusal under Answer, explain under Uncertainties, and Sources: None — do not invent URLs.)';

const LAW_ELEMENTS_PLAIN_NOTE_RULES =
  'Attendance-note body (what the solicitor will paste into the note):\n' +
  '- Plain text only: no "Answer" heading, no introductory sentence, no markdown (** ## ---), no inline links or URLs, no utm parameters.\n' +
  '- Per offence use headings: Actus reus, Mens rea, Common defences, Sentencing — concise bullet points.\n' +
  '- Put anything unverified only under Uncertainties (not in the note body). List source titles/URLs only under Sources (shown separately in the app).\n' +
  '- Statute and sentencing limits MUST be verified via web search on legislation.gov.uk (current text) and Sentencing Council — not training memory.\n' +
  '- Do NOT cite the Powers of Criminal Courts (Sentencing) Act 2000 (repealed). Use Sentencing Act 2020 for minimum sentences (e.g. third domestic burglary: s.314).\n' +
  '- For magistrates\' court maximums on triable-either-way offences, apply Sentencing Act 2020 s.224 (12 months for a single offence from 18 November 2024) where it applies, not outdated 6-month summaries alone.';

const CASE_LAW_PATTERN =
  /\b(?:v\.?|vs\.?)\b|\[[12]\d{3}\]\s*[A-Z]|\b(?:EWCA|EWHC|UKSC|UKHL|Cr\.?\s*App\.?\s*R\.?|WLR|All\s*ER)\b/i;

const REFUSAL_PATTERN =
  /\b(cannot reliably confirm|unable to verify|insufficient (?:reliable )?sources|do not have (?:reliable )?sources|cannot find (?:reliable )?sources)\b/i;

const URL_PATTERN = /https?:\/\/[^\s)\]>'"]+/gi;

function extractUrlsFromText(text) {
  const raw = String(text || '');
  const found = raw.match(URL_PATTERN) || [];
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < found.length; i++) {
    let u = found[i].replace(/[.,;:]+$/, '');
    if (!seen[u]) {
      seen[u] = true;
      out.push(u);
    }
  }
  return out;
}

function normaliseCitations(citations) {
  if (!Array.isArray(citations)) return [];
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < citations.length; i++) {
    const c = citations[i];
    if (!c || typeof c !== 'object') continue;
    const url = String(c.url || c.href || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen[url]) continue;
    seen[url] = true;
    out.push({
      title: String(c.title || c.name || url).trim() || url,
      url: url,
    });
  }
  return out;
}

function extractSourcesSection(text) {
  const raw = String(text || '');
  const m = raw.match(/\n\s*Sources\s*\n([\s\S]*)$/i);
  if (!m) return { hasHeading: /\bSources\b/i.test(raw), body: '' };
  return { hasHeading: true, body: m[1].trim() };
}

function extractUncertainties(text) {
  const raw = String(text || '');
  const m = raw.match(/\n\s*Uncertainties\s*\n([\s\S]*?)(?=\n\s*Sources\s*\n|$)/i);
  if (!m) return '';
  return m[1].trim();
}

function isHonestRefusal(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (!REFUSAL_PATTERN.test(raw)) return false;
  const sources = extractSourcesSection(raw);
  const urls = extractUrlsFromText(raw);
  /* Refusal may say Sources: None and must not assert detailed case law. */
  if (CASE_LAW_PATTERN.test(raw) && urls.length < 1) return false;
  const sourcesNone = /sources\s*:\s*none\b/i.test(raw) || /^none\b/i.test(sources.body);
  return sourcesNone || urls.length === 0;
}

function hasLegalAssertions(text) {
  const raw = String(text || '');
  if (!raw.trim()) return false;
  if (isHonestRefusal(raw)) return false;
  return (
    /\b(actus reus|mens rea|offence|statute|section\s+\d|sentencing|defence|prosecution|guilty|indictment|summary.?only|either.?way)\b/i.test(
      raw,
    ) ||
    CASE_LAW_PATTERN.test(raw) ||
    /\b(must prove|elements of|maximum (?:sentence|penalty)|guideline)\b/i.test(raw)
  );
}

function formatSourcesBlock(citations) {
  const list = normaliseCitations(citations);
  if (!list.length) return '';
  const lines = list.map(function (c, i) {
    return i + 1 + '. ' + c.title + ' — ' + c.url;
  });
  return 'Sources\n' + lines.join('\n');
}

function collectValidationSources(text, citations) {
  const {
    normaliseSourceList,
    parseSourcesSectionUrls,
    mergeSourceLists,
  } = require('./aiNoteTextCleanup');
  const fromCite = normaliseSourceList(citations);
  const fromSection = parseSourcesSectionUrls(text);
  const fromInline = extractUrlsFromText(text).map(function (url) {
    return { title: url, url: url };
  });
  return mergeSourceLists(fromCite, mergeSourceLists(fromSection, fromInline));
}

/**
 * @param {{ text?: string, citations?: Array<{title?: string, url?: string}> }} opts
 * @returns {{ ok: boolean, error?: string, text?: string, sources?: Array, uncertainties?: string, refusal?: boolean }}
 */
function validateAiLegalResponse(opts) {
  const options = opts || {};
  const rawText = String(options.text || '').trim();
  const {
    cleanLawElementsNoteText,
    cleanAskAnswerNoteText,
  } = require('./aiNoteTextCleanup');
  const sources = collectValidationSources(rawText, options.citations);
  const uncertainties = extractUncertainties(rawText);
  const noteMode = options.noteMode === 'ask' ? 'ask' : 'law';

  if (!rawText) {
    return { ok: false, error: 'Empty AI response.' };
  }

  if (isHonestRefusal(rawText)) {
    const cleaned =
      noteMode === 'ask' ? cleanAskAnswerNoteText(rawText) : cleanLawElementsNoteText(rawText);
    return {
      ok: true,
      text: cleaned.noteText || rawText,
      sources: sources,
      uncertainties: cleaned.uncertainties || uncertainties || 'Insufficient reliable sources.',
      refusal: true,
    };
  }

  const sourceUrls = sources.map(function (s) {
    return s.url;
  });

  if (CASE_LAW_PATTERN.test(rawText) && sourceUrls.length < 1) {
    return {
      ok: false,
      error:
        'AI response rejected: case-law references require supporting source URLs. ' +
        'If in doubt, the case must not be cited.',
      text: rawText,
      sources: sources,
    };
  }

  if (hasLegalAssertions(rawText) && sourceUrls.length < 2) {
    return {
      ok: false,
      error:
        'AI response rejected: legal answers require at least two source URLs. ' +
        'Doubtful or unsourced material must not be quoted.',
      text: rawText,
      sources: sources,
    };
  }

  const cleaned =
    noteMode === 'ask' ? cleanAskAnswerNoteText(rawText) : cleanLawElementsNoteText(rawText);

  let noteText = cleaned.noteText;
  let stalenessWarnings = [];
  if (noteMode === 'law') {
    const { guardLawNoteStaleness } = require('./aiLawStalenessGuard');
    const guarded = guardLawNoteStaleness(noteText);
    noteText = guarded.noteText;
    stalenessWarnings = guarded.stalenessWarnings || [];
    if (guarded.needsRegenerate) {
      return {
        ok: false,
        error: 'AI response rejected: out-of-date legislation or sentencing limits detected.',
        text: noteText,
        sources: sources,
        uncertainties: cleaned.uncertainties || uncertainties,
        stalenessWarnings: stalenessWarnings,
        needsRegenerate: true,
        regeneratePrompt: guarded.regeneratePrompt,
      };
    }
  }

  return {
    ok: true,
    text: noteText,
    sources: sources,
    uncertainties: cleaned.uncertainties || uncertainties,
    stalenessWarnings: stalenessWarnings,
    refusal: false,
  };
}

module.exports = {
  ACCURACY_SYSTEM_RULES,
  REQUIRED_OUTPUT_SHAPE,
  LAW_ELEMENTS_PLAIN_NOTE_RULES,
  PREFERRED_UK_LEGAL_DOMAINS,
  CASE_LAW_PATTERN,
  extractUrlsFromText,
  extractSourcesSection,
  extractUncertainties,
  normaliseCitations,
  formatSourcesBlock,
  collectValidationSources,
  validateAiLegalResponse,
  hasLegalAssertions,
  isHonestRefusal,
};
