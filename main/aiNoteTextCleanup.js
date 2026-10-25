'use strict';

/**
 * Strip model markdown, inline citations, and meta sections from AI output
 * before inserting into attendance-note fields. Sources/uncertainties belong in UI only.
 */

const { extractSourcesSection, extractUncertainties } = require('./aiAccuracyPolicy');

function stripTrackingParamsFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    let out = u.toString();
    if (out.endsWith('?')) out = out.slice(0, -1);
    return out;
  } catch (_) {
    return raw.replace(/([?&])utm_source=[^&]*&?/gi, '$1').replace(/[?&]$/, '');
  }
}

function normaliseSourceList(citations) {
  if (!Array.isArray(citations)) return [];
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < citations.length; i++) {
    const c = citations[i];
    if (!c || typeof c !== 'object') continue;
    const url = stripTrackingParamsFromUrl(String(c.url || c.href || '').trim());
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

function stripTrailingMetaSections(text) {
  let t = String(text || '').replace(/\r\n/g, '\n');
  // Only cut at a trailing Uncertainties / Sources heading (optionally preceded by a
  // horizontal rule). A bare `---` between law headings must never drop later sections.
  const META_HEADING = '(?:#{1,6}[ \\t]*)?(?:\\*\\*)?[ \\t]*(?:Uncertainties|Sources)[ \\t]*:?[ \\t]*(?:\\*\\*)?[ \\t]*\\n';
  t = t.replace(new RegExp('\\n[ \\t]*---+[ \\t]*\\n\\s*(?=' + META_HEADING + ')[\\s\\S]*$', 'i'), '');
  t = t.replace(new RegExp('\\n[ \\t]*' + META_HEADING + '[\\s\\S]*$', 'i'), '');
  t = t.replace(/\n[ \t]*---+[ \t]*$/, '');
  return t.trim();
}

function stripLawElementsIntro(body) {
  let t = String(body || '').replace(/\r\n/g, '\n');
  t = t.replace(/^Answer\s*\n+/i, '');
  t = t.replace(
    /^The following is structured content for[^\n]*\n+/i,
    '',
  );
  t = t.replace(
    /^[^\n]*Law \/ Elements of offence[^\n]*\n+/i,
    '',
  );
  return t.trim();
}

function demarkdownForNote(text) {
  let t = String(text || '');
  t = t.replace(/\*\*\s*1\.\s*Actus\s*Reus\s*\*\*/gi, 'Actus reus');
  t = t.replace(/\*\*\s*2\.\s*Mens\s*Rea\s*\*\*/gi, 'Mens rea');
  t = t.replace(/\*\*\s*3\.\s*Common\s*Defences\s*\*\*/gi, 'Common defences');
  t = t.replace(/\*\*\s*4\.\s*Sentencing[^\n*]*\*\*/gi, 'Sentencing');
  t = t.replace(/\*\*\s*(\d+)\.\s*([^*\n]+)\s*\*\*/g, function (_, num, title) {
    return String(title || '').trim();
  });
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  t = t.replace(/\*([^*\n]+)\*/g, '$1');
  t = t.replace(/^\#{1,6}\s+/gm, '');
  t = t.replace(/\s*\(\[[^\]]+\]\([^)]+\)\)/g, '');
  t = t.replace(/\[[^\]]+\]\([^)]+\)/g, '');
  t = t.replace(/https?:\/\/[^\s)\]>]+/gi, '');
  t = t.replace(/\n---+\n/g, '\n');
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/**
 * @param {string} rawText - Full model output (may include Answer / Uncertainties / Sources)
 * @returns {{ noteText: string, uncertainties: string }}
 */
function cleanLawElementsNoteText(rawText) {
  const raw = String(rawText || '');
  const uncertainties = extractUncertainties(raw) || '';
  let body = stripTrailingMetaSections(raw);
  body = stripLawElementsIntro(body);
  body = demarkdownForNote(body);
  return { noteText: body, uncertainties: uncertainties.trim() };
}

/**
 * Plain-text cleanup for Ask AI answers shown in session / appended to notes.
 */
function cleanAskAnswerNoteText(rawText) {
  const raw = String(rawText || '');
  const uncertainties = extractUncertainties(raw) || '';
  let body = stripTrailingMetaSections(raw);
  body = body.replace(/^Answer\s*\n+/i, '');
  body = demarkdownForNote(body);
  return { noteText: body, uncertainties: uncertainties.trim() };
}

function parseSourcesSectionUrls(rawText) {
  const section = extractSourcesSection(String(rawText || ''));
  if (!section.body) return [];
  const URL_PATTERN = /https?:\/\/[^\s)\]>'"]+/gi;
  const found = section.body.match(URL_PATTERN) || [];
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < found.length; i++) {
    const url = stripTrackingParamsFromUrl(found[i].replace(/[.,;:]+$/, ''));
    if (url && !seen[url]) {
      seen[url] = true;
      out.push({ title: url, url: url });
    }
  }
  return out;
}

function mergeSourceLists(primary, secondary) {
  const out = [];
  const seen = Object.create(null);
  function add(list) {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      const url = stripTrackingParamsFromUrl(String(list[i].url || '').trim());
      if (!url || seen[url]) continue;
      seen[url] = true;
      out.push({
        title: String(list[i].title || url).trim() || url,
        url: url,
      });
    }
  }
  add(primary);
  add(secondary);
  return out;
}

module.exports = {
  stripTrackingParamsFromUrl,
  normaliseSourceList,
  stripTrailingMetaSections,
  stripLawElementsIntro,
  demarkdownForNote,
  cleanLawElementsNoteText,
  cleanAskAnswerNoteText,
  parseSourcesSectionUrls,
  mergeSourceLists,
};
