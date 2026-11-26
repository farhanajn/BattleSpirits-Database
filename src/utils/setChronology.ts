import type { BattleSpiritsCard, ProductSet } from '../types/card';
import { normalizeSetIdentifier } from './setMetadataSync';

export interface SetChronologyRecord {
  setCode: string;
  releaseDate: string;
  /** Numeric YYYYMMDD integer for strict chronological sorting (smaller = older release). */
  sortKey: number;
  releaseTimestampMs: number | null;
  source: 'official_date' | 'product_set_date' | 'series_estimate';
}

/**
 * Official chronological release dates keyed by canonical uppercase set code.
 * Sources: server/setMetadata.ts WIKI_SET_METADATA & PRODUCT_SETS official release dates.
 * Alphabetical set codes must NEVER be used as release chronology.
 */
const OFFICIAL_SET_RELEASE_DATES: Record<string, string> = {
  // Standard / 2026+ Series
  '26RBS01': '2026-04-01',
  '26RBS02': '2026-07-01',
  '26RBS03': '2026-10-01',
  '26RBS04': '2026-12-01',
  '26RCB01': '2026-06-20',
  '26RCB02': '2026-12-26',
  '26RCB03': '2026-12-28',
  '26REB01': '2026-08-01',
  '26RDB01': '2026-09-01',
  'RP26-STD': '2026-04-01',
  'PX26-STD': '2026-04-01',
  RPX26: '2026-04-01',

  // Main Boosters BS01 - BS77 (2008 - 2026)
  BS01: '2008-09-13',
  BS02: '2008-12-11',
  BS03: '2009-03-06',
  BS04: '2009-06-11',
  BS05: '2009-08-06',
  BS06: '2009-11-06',
  BS07: '2010-02-05',
  BS08: '2010-05-13',
  BS09: '2010-08-06',
  BS10: '2010-11-12',
  BS11: '2011-02-11',
  BS12: '2011-05-13',
  BS13: '2011-07-22',
  BS14: '2011-10-08',
  BS15: '2011-12-16',
  BS16: '2012-03-09',
  BS17: '2012-05-23',
  BS18: '2012-07-28',
  BS19: '2012-10-13',
  BS20: '2012-12-21',
  BS21: '2013-03-08',
  BS22: '2013-05-24',
  BS23: '2013-08-09',
  BS24: '2013-10-26',
  BS25: '2014-01-11',
  BS26: '2014-03-21',
  BS27: '2014-05-24',
  BS28: '2014-08-09',
  BS29: '2014-10-26',
  BS30: '2015-01-17',
  BS31: '2015-04-25',
  BS32: '2015-07-25',
  BS33: '2015-10-17',
  BS34: '2016-01-30',
  BS35: '2016-04-29',
  BS36: '2016-07-30',
  BS37: '2016-09-24',
  BS38: '2016-12-17',
  BS39: '2017-02-25',
  BS40: '2017-04-29',
  BS41: '2017-07-29',
  BS42: '2017-10-28',
  BS43: '2018-01-27',
  BS44: '2018-04-21',
  BS45: '2018-07-28',
  BS46: '2018-10-27',
  BS47: '2019-01-26',
  BS48: '2019-04-27',
  BS49: '2019-07-27',
  BS50: '2019-10-26',
  BS51: '2020-01-25',
  BS52: '2020-04-25',
  BS53: '2020-08-29',
  BS54: '2020-10-31',
  BS55: '2021-01-30',
  BS56: '2021-04-24',
  BS57: '2021-07-31',
  BS58: '2021-10-30',
  BS59: '2022-01-29',
  BS60: '2022-05-28',
  BS61: '2022-08-27',
  BS62: '2022-11-26',
  BS63: '2023-02-25',
  BS64: '2023-05-27',
  BS65: '2023-08-26',
  BS66: '2023-11-25',
  BS67: '2024-01-27',
  BS68: '2024-04-27',
  BS69: '2024-07-27',
  BS70: '2024-10-26',
  BS71: '2025-01-25',
  BS72: '2025-05-17',
  BS73: '2025-08-30',
  BS74: '2025-11-22',
  BS75: '2026-02-14',
  BS76: '2026-05-30',
  BS77: '2026-11-21',

  // Starter Decks SD01 - SD70
  SD01: '2009-09-10',
  SD02: '2009-12-10',
  SD03: '2010-09-10',
  SD04: '2010-12-10',
  SD05: '2011-03-11',
  SD06: '2011-09-16',
  SD07: '2011-09-16',
  SD08: '2011-11-18',
  SD09: '2012-03-23',
  SD10: '2012-09-08',
  SD11: '2012-09-08',
  SD12: '2012-09-08',
  SD13: '2012-11-16',
  SD14: '2012-11-16',
  SD15: '2012-11-16',
  SD16: '2012-11-16',
  SD17: '2013-03-22',
  SD18: '2013-03-22',
  SD19: '2013-09-14',
  SD20: '2013-09-14',
  SD21: '2013-11-01',
  SD26: '2014-10-11',
  SD27: '2014-11-15',
  SD28: '2014-12-13',
  SD29: '2015-04-11',
  SD30: '2015-04-11',
  SD31: '2015-04-11',
  SD34: '2016-04-09',
  SD35: '2016-10-15',
  SD36: '2016-11-19',
  SD37: '2017-04-15',
  SD38: '2017-04-15',
  SD39: '2017-09-09',
  SD40: '2017-11-18',
  SD41: '2017-11-18',
  SD42: '2018-03-24',
  SD45: '2018-05-26',
  SD49: '2019-06-15',
  SD50: '2019-11-30',
  SD51: '2019-12-07',
  SD52: '2020-03-14',
  SD53: '2020-03-14',
  SD54: '2020-03-14',
  SD56: '2020-12-12',
  SD57: '2020-12-12',
  SD58: '2021-03-13',
  SD62: '2021-12-18',
  SD63: '2022-03-26',
  SD65: '2023-04-29',
  SD66: '2023-09-23',
  SD68: '2024-03-30',
  SD69: '2025-01-11',
  SD70: '2025-02-22',

  // Collab Boosters CB01 - CB34, CBX01
  CB01: '2017-06-24',
  CB02: '2017-09-30',
  CB03: '2018-02-10',
  CB04: '2018-03-24',
  CB05: '2018-05-26',
  CB06: '2018-09-29',
  CB07: '2018-11-24',
  CB08: '2019-02-23',
  CB09: '2019-08-31',
  CB10: '2019-12-21',
  CB11: '2020-02-29',
  CB12: '2020-03-28',
  CB13: '2020-05-30',
  CB14: '2020-06-27',
  CB15: '2020-09-26',
  CB16: '2021-02-27',
  CB17: '2021-03-27',
  CB18: '2021-06-26',
  CB19: '2021-09-25',
  CB20: '2021-11-27',
  CB21: '2021-12-18',
  CB22: '2022-03-26',
  CB23: '2022-06-25',
  CB24: '2022-09-24',
  CB25: '2022-11-26',
  CB26: '2022-12-24',
  CB27: '2023-03-25',
  CB28: '2023-09-30',
  CB29: '2023-12-16',
  CBX01: '2024-02-03',
  CB30: '2024-03-16',
  CB31: '2024-07-27',
  CB32: '2024-11-30',
  CB33: '2025-02-22',
  CB34: '2025-03-29',

  // Supplementary Boosters BSC01 - BSC51
  BSC01: '2009-10-01',
  BSC02: '2009-12-01',
  BSC03: '2010-04-01',
  BSC04: '2010-07-01',
  BSC05: '2010-10-01',
  BSC06: '2011-01-01',
  BSC07: '2011-04-01',
  BSC08: '2011-09-01',
  BSC09: '2012-01-01',
  BSC10: '2012-06-01',
  BSC11: '2012-11-01',
  BSC12: '2013-02-01',
  BSC13: '2013-07-01',
  BSC14: '2013-10-01',
  BSC15: '2013-11-23',
  BSC16: '2014-02-01',
  BSC17: '2014-06-01',
  BSC18: '2014-12-01',
  BSC19: '2015-03-01',
  BSC20: '2015-06-20',
  BSC21: '2015-09-05',
  BSC22: '2015-12-19',
  BSC23: '2016-02-20',
  BSC24: '2016-03-19',
  BSC25: '2016-06-01',
  BSC26: '2016-08-13',
  BSC27: '2016-10-29',
  BSC28: '2017-01-28',
  BSC29: '2017-03-11',
  BSC30: '2017-12-16',
  BSC31: '2018-02-24',
  BSC32: '2018-08-25',
  BSC33: '2019-03-23',
  BSC34: '2019-06-29',
  BSC35: '2019-11-30',
  BSC36: '2020-07-25',
  BSC37: '2020-11-28',
  BSC38: '2021-05-29',
  BSC39: '2022-02-26',
  BSC40: '2023-04-15',
  BSC41: '2023-06-24',
  BSC42: '2023-07-29',
  BSC43: '2024-06-29',
  BSC44: '2024-09-28',
  BSC45: '2024-12-21',
  BSC46: '2025-03-15',
  BSC47: '2025-06-28',
  BSC48: '2025-07-26',
  BSC49: '2025-10-18',
  BSC50: '2025-12-27',
  BSC51: '2026-03-01',

  // Premium Bandai PB01 - PB50
  PB01: '2019-01-18',
  PB02: '2021-02-01',
  PB03: '2019-09-10',
  PB04: '2019-09-10',
  PB05: '2019-11-20',
  PB06: '2020-03-01',
  PB08: '2020-06-26',
  PB09: '2020-10-23',
  PB10: '2020-11-27',
  PB11: '2020-11-27',
  PB12: '2012-09-27',
  PB13: '2013-03-28',
  PB14: '2021-04-28',
  PB15: '2015-08-19',
  PB16: '2017-03-29',
  PB17: '2017-11-08',
  PB19: '2021-12-17',
  PB20: '2021-12-17',
  PB21: '2022-04-01',
  PB27: '2022-08-05',
  PB29: '2022-10-14',
  PB30: '2022-11-18',
  PB31: '2022-11-18',
  PB32: '2023-04-21',
  PB33: '2023-04-27',
  PB34: '2023-12-15',
  PB35: '2024-03-14',
  PB37: '2024-10-14',
  PB38: '2024-10-14',
  PB39: '2024-10-31',
  PB40: '2024-11-05',
  PB41: '2025-06-19',
  PB42: '2025-07-24',
  PB43: '2025-07-31',
  PB44: '2025-08-21',
  PB45: '2025-09-03',
  PB46: '2025-09-25',
  PB47: '2025-09-26',
  PB48: '2025-09-26',
};

const MONTH_NAME_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Parses release date strings into a numeric YYYYMMDD sort key + epoch timestamp.
 * Handles:
 * - "2017-09-30"
 * - "September 30th, 2017" / "Feb 10, 2018" / "21st November 2026"
 * - "Apr 2026" / "December 2015"
 * - "2026" / "2014–2025" (uses earliest start year)
 */
export function parseReleaseDateToSortKey(
  rawDate?: string | null
): { sortKey: number; timestampMs: number | null } | null {
  const raw = (rawDate || '').trim();
  if (!raw) return null;

  // ISO: YYYY-MM-DD or YYYY-MM
  const isoMatch = raw.match(/\b((?:19|20)\d{2})-(\d{1,2})(?:-(\d{1,2}))?\b/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Math.min(12, Math.max(1, Number(isoMatch[2])));
    const day = isoMatch[3] ? Math.min(31, Math.max(1, Number(isoMatch[3]))) : 15;
    const sortKey = year * 10000 + month * 100 + day;
    const timestampMs = Date.UTC(year, month - 1, day);
    return { sortKey, timestampMs };
  }

  // "Month Day(st/nd/rd/th), Year" e.g. "September 30th, 2017"
  const mdyMatch = raw.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2})\b/i
  );
  if (mdyMatch) {
    const month = MONTH_NAME_MAP[mdyMatch[1].toLowerCase()] || 6;
    const day = Math.min(31, Math.max(1, Number(mdyMatch[2])));
    const year = Number(mdyMatch[3]);
    const sortKey = year * 10000 + month * 100 + day;
    const timestampMs = Date.UTC(year, month - 1, day);
    return { sortKey, timestampMs };
  }

  // "Day(st/nd/rd/th) Month Year" e.g. "21st November 2026"
  const dmyMatch = raw.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?),?\s+((?:19|20)\d{2})\b/i
  );
  if (dmyMatch) {
    const day = Math.min(31, Math.max(1, Number(dmyMatch[1])));
    const month = MONTH_NAME_MAP[dmyMatch[2].toLowerCase()] || 6;
    const year = Number(dmyMatch[3]);
    const sortKey = year * 10000 + month * 100 + day;
    const timestampMs = Date.UTC(year, month - 1, day);
    return { sortKey, timestampMs };
  }

  // "Month Year" e.g. "Apr 2026"
  const myMatch = raw.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+((?:19|20)\d{2})\b/i
  );
  if (myMatch) {
    const month = MONTH_NAME_MAP[myMatch[1].toLowerCase()] || 6;
    const year = Number(myMatch[2]);
    const sortKey = year * 10000 + month * 100 + 15;
    const timestampMs = Date.UTC(year, month - 1, 15);
    return { sortKey, timestampMs };
  }

  // Year range or bare year e.g. "2014–2025" or "2026"
  const yMatch = raw.match(/\b((?:19|20)\d{2})\b/);
  if (yMatch) {
    const year = Number(yMatch[1]);
    const sortKey = year * 10000 + 601;
    const timestampMs = Date.UTC(year, 5, 1);
    return { sortKey, timestampMs };
  }

  return null;
}

function estimateSeriesChronologySortKey(setCodeRaw: string): number {
  const code = normalizeSetIdentifier(setCodeRaw) || (setCodeRaw || '').trim().toUpperCase();
  if (!code) return 20990101;

  // 2026+ Standard sets: 26RBS01 -> 20260401, etc.
  const std26 = code.match(/^26R([A-Z]+)(\d{1,2})$/);
  if (std26) {
    const num = Number(std26[2]);
    return 20260400 + Math.min(899, num * 30);
  }
  if (/^(?:RP26|PX26|RPX26)/.test(code)) return 20260401;

  // Year-coded promo cards / promo sets e.g. P17, P20, PX15
  const promoYear = code.match(/^(?:PROMO-)?P(?:X)?(\d{2})\b/);
  if (promoYear) {
    const yr = 2000 + Number(promoYear[1]);
    if (yr >= 2008 && yr <= 2035) {
      return yr * 10000 + 601;
    }
  }

  // Main boosters BS01..BS77 (~4 sets/year from 2008-09)
  const bsM = code.match(/^BS(\d{1,3})$/);
  if (bsM) {
    const n = Number(bsM[1]);
    const monthsSinceOrigin = (n - 1) * 3;
    const year = 2008 + Math.floor((8 + monthsSinceOrigin) / 12);
    const month = ((8 + monthsSinceOrigin) % 12) + 1;
    return year * 10000 + month * 100 + 15;
  }

  // Starter Decks SD01..SD70
  const sdM = code.match(/^SD(\d{1,3})$/);
  if (sdM) {
    const n = Number(sdM[1]);
    const totalMonths = Math.round(((n - 1) / 69) * (16 * 12));
    const year = 2009 + Math.floor((8 + totalMonths) / 12);
    const month = ((8 + totalMonths) % 12) + 1;
    return year * 10000 + month * 100 + 15;
  }

  // Collab Boosters CB01..CB34
  const cbM = code.match(/^CB(\d{1,3})$/);
  if (cbM) {
    const n = Number(cbM[1]);
    const totalMonths = Math.round(((n - 1) / 33) * (8 * 12));
    const year = 2017 + Math.floor((5 + totalMonths) / 12);
    const month = ((5 + totalMonths) % 12) + 1;
    return year * 10000 + month * 100 + 15;
  }

  // Supplementary Boosters BSC01..BSC51
  const bscM = code.match(/^BSC(\d{1,3})$/);
  if (bscM) {
    const n = Number(bscM[1]);
    const totalMonths = Math.round(((n - 1) / 50) * (17 * 12));
    const year = 2009 + Math.floor((9 + totalMonths) / 12);
    const month = ((9 + totalMonths) % 12) + 1;
    return year * 10000 + month * 100 + 15;
  }

  // Premium Bandai PB01..PB50
  const pbM = code.match(/^PB(\d{1,3})$/);
  if (pbM) {
    const n = Number(pbM[1]);
    const totalMonths = Math.round(((n - 1) / 49) * (7 * 12));
    const year = 2019 + Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;
    return year * 10000 + month * 100 + 15;
  }

  // Premium Card Set PC01..PC12 (2022-2025)
  const pcM = code.match(/^PC(\d{1,3})$/);
  if (pcM) {
    const n = Number(pcM[1]);
    const year = 2022 + Math.floor((n - 1) / 4);
    const month = (((n - 1) % 4) * 3) + 2;
    return year * 10000 + month * 100 + 15;
  }

  if (code === 'TOKENS' || code === 'TOKEN') return 20260401;
  if (code.startsWith('PROMO') || code === 'PX') return 20180101;
  if (code === 'REVIVAL') return 20151219;

  return 20200101;
}

/**
 * Resolves chronological release information for any setCode (with optional ProductSet metadata).
 */
export function resolveSetReleaseInfo(
  setCodeRaw: string,
  productSet?: ProductSet
): SetChronologyRecord {
  const canonicalCode =
    normalizeSetIdentifier(setCodeRaw) || (setCodeRaw || '').trim().toUpperCase() || 'UNKNOWN';

  const officialIso = OFFICIAL_SET_RELEASE_DATES[canonicalCode];
  if (officialIso) {
    const parsed = parseReleaseDateToSortKey(officialIso);
    if (parsed) {
      return {
        setCode: canonicalCode,
        releaseDate: productSet?.releaseDate || officialIso,
        sortKey: parsed.sortKey,
        releaseTimestampMs: parsed.timestampMs,
        source: 'official_date',
      };
    }
  }

  if (productSet?.releaseDate) {
    const parsed = parseReleaseDateToSortKey(productSet.releaseDate);
    if (parsed) {
      return {
        setCode: canonicalCode,
        releaseDate: productSet.releaseDate,
        sortKey: parsed.sortKey,
        releaseTimestampMs: parsed.timestampMs,
        source: 'product_set_date',
      };
    }
  }

  const estimatedKey = estimateSeriesChronologySortKey(canonicalCode);
  return {
    setCode: canonicalCode,
    releaseDate: productSet?.releaseDate || `${Math.floor(estimatedKey / 10000)}`,
    sortKey: estimatedKey,
    releaseTimestampMs: null,
    source: 'series_estimate',
  };
}

function extractNumericOrderInCardNumber(cardNumber: string): number {
  const m = (cardNumber || '').match(/(\d{1,4})(?:\([AB]\))?$/i);
  return m ? Number(m[1]) : 9999;
}

function getCardPromoPrefixYearSortKey(card: Pick<BattleSpiritsCard, 'cardNumber'>): number | null {
  const num = (card.cardNumber || '').trim().toUpperCase();
  const m = num.match(/^(?:P|PB|LM|EX)(\d{2})-/);
  if (m) {
    const yr = 2000 + Number(m[1]);
    if (yr >= 2008 && yr <= 2035) {
      return yr * 10000 + 601;
    }
  }
  return null;
}

/**
 * Compares two printings of a card chronologically (OLDEST release FIRST).
 * Guarantee:
 * - Official release chronology is always primary (never alphabetical order).
 * - If set dates are identical/undated promo sets, falls back to promo year-prefix & series progression.
 */
export function compareCardPrintingChronology(
  a: BattleSpiritsCard,
  b: BattleSpiritsCard,
  setLookupByCode?: Map<string, ProductSet>
): number {
  const codeA = normalizeSetIdentifier(a.setCode || '') || (a.setCode || '').toUpperCase();
  const codeB = normalizeSetIdentifier(b.setCode || '') || (b.setCode || '').toUpperCase();

  const setA = setLookupByCode?.get(codeA);
  const setB = setLookupByCode?.get(codeB);

  const relA = resolveSetReleaseInfo(codeA, setA);
  const relB = resolveSetReleaseInfo(codeB, setB);

  let effectiveKeyA = relA.sortKey;
  let effectiveKeyB = relB.sortKey;

  if (relA.source === 'series_estimate') {
    const promoYrA = getCardPromoPrefixYearSortKey(a);
    if (promoYrA !== null) effectiveKeyA = promoYrA;
  }
  if (relB.source === 'series_estimate') {
    const promoYrB = getCardPromoPrefixYearSortKey(b);
    if (promoYrB !== null) effectiveKeyB = promoYrB;
  }

  if (effectiveKeyA !== effectiveKeyB) {
    return effectiveKeyA - effectiveKeyB;
  }

  // Prefer non-Revival if sharing identical date estimate
  if (Boolean(a.isRevival) !== Boolean(b.isRevival)) {
    return a.isRevival ? 1 : -1;
  }

  // Prefer card whose own cardNumber prefix matches its setCode (native original printing over reprint carrying old cardNumber)
  const prefixA = ((a.cardNumber || '').match(/^([A-Z0-9]+)-/i)?.[1] || '').toUpperCase();
  const prefixB = ((b.cardNumber || '').match(/^([A-Z0-9]+)-/i)?.[1] || '').toUpperCase();
  const nativeA = prefixA && normalizeSetIdentifier(prefixA) === codeA ? 0 : 1;
  const nativeB = prefixB && normalizeSetIdentifier(prefixB) === codeB ? 0 : 1;
  if (nativeA !== nativeB) {
    return nativeA - nativeB;
  }

  const numDiff =
    extractNumericOrderInCardNumber(a.cardNumber) -
    extractNumericOrderInCardNumber(b.cardNumber);
  if (numDiff !== 0) return numDiff;

  return (a.cardNumber || '').localeCompare(b.cardNumber || '') || (a.id || '').localeCompare(b.id || '');
}
