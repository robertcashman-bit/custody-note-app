'use strict';

/** Sales fee lines (attendance fixed fee, parking, etc.). */
const QUICKFILE_NOMINAL_FEE = '4000';

/** Mileage and other travel disbursement lines. */
const QUICKFILE_NOMINAL_TRAVEL_MILEAGE = '4906';

/**
 * Whether a QuickFile line should post to the travel/mileage nominal (4906).
 * @param {unknown} shortName ItemName / short label
 * @param {unknown} description ItemDescription
 */
function isTravelOrMileageQuickFileLine(shortName, description) {
  const name = String(shortName || '').trim().toLowerCase();
  const desc = String(description || '').trim().toLowerCase();
  if (!name && !desc) return false;

  if (name === 'mileage' || name.startsWith('mileage ')) return true;
  if (/\bmileage\b/.test(name)) return true;

  if (/\btravel\b/.test(name) || /\btravel\b/.test(desc)) return true;

  if (/^mileage\s*\(/i.test(desc)) return true;
  if (/\bmiles?\b/.test(desc) && (/\b\/\s*mile\b/.test(desc) || /\bgbp\s*\/\s*mile\b/.test(desc))) {
    return true;
  }

  return false;
}

/**
 * @param {unknown} shortName
 * @param {unknown} description
 * @returns {string}
 */
function nominalCodeForQuickFileLineItem(shortName, description) {
  return isTravelOrMileageQuickFileLine(shortName, description)
    ? QUICKFILE_NOMINAL_TRAVEL_MILEAGE
    : QUICKFILE_NOMINAL_FEE;
}

/**
 * Build one QuickFile Invoice_Create ItemLine.
 * @param {string} shortName
 * @param {string} description
 * @param {number} unitCost
 * @param {number} qty
 * @param {number} vatRate decimal e.g. 0.2
 * @param {string} [nominalCodeOverride]
 */
function buildQuickFileItemLine(shortName, description, unitCost, qty, vatRate, nominalCodeOverride) {
  const vr = Number.isFinite(Number(vatRate)) ? Number(vatRate) : 0.2;
  const net = Number.isFinite(Number(unitCost)) ? Number(unitCost) : 0;
  const q = Number.isFinite(Number(qty)) && Number(qty) > 0 ? Number(qty) : 1;
  if (net <= 0) throw new Error('Line item unit cost must be > 0: ' + shortName);
  const taxAmt = net * vr;
  const name = String(shortName || 'Item').replace(/\s+/g, ' ').trim().slice(0, 25);
  const nominal = String(nominalCodeOverride || '').trim()
    || nominalCodeForQuickFileLineItem(name, description);
  return {
    ItemID: 0,
    ItemName: name,
    ItemDescription: String(description || '').slice(0, 5000),
    ItemNominalCode: nominal,
    Qty: q,
    UnitCost: Number(net.toFixed(2)),
    Tax1: {
      TaxName: 'VAT',
      TaxPercentage: Number((vr * 100).toFixed(2)),
      TaxAmount: Number(taxAmt.toFixed(2)),
    },
  };
}

module.exports = {
  QUICKFILE_NOMINAL_FEE,
  QUICKFILE_NOMINAL_TRAVEL_MILEAGE,
  isTravelOrMileageQuickFileLine,
  nominalCodeForQuickFileLineItem,
  buildQuickFileItemLine,
};
