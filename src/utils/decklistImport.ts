import type { BattleSpiritsCard, DeckEntry, GameFormat } from '../types/card.ts';
import { getMaxCardCopies, isTokenCard } from './cardRules.ts';

export type ImportMatchConfidence =
  | 'exact-number'
  | 'exact-name'
  | 'fuzzy-name'
  | 'unmatched';

export interface ParsedImportLine {
  lineNumber: number;
  rawText: string;
  quantity: number;
  parsedCardNumber?: string;
  parsedName?: string;
  isRevivalHint: boolean;
  matchedCard?: BattleSpiritsCard;
  confidence: ImportMatchConfidence;
  reason?: string;
}

export interface DecklistImportResult {
  detectedDeckName?: string;
  detectedFormat?: GameFormat;
  lines: ParsedImportLine[];
  matchedLines: ParsedImportLine[];
  unmatchedLines: ParsedImportLine[];
  aggregatedEntries: { card: BattleSpiritsCard; quantity: number }[];
  totalMatchedCards: number;
  totalParsedLines: number;
}

const CARD_CODE_CORE_REGEX =
  '(?:26R(?:BS|SD|EB|DB|CB)\\d+(?:-[A-Z0-9]+)+|[A-Z]{1,5}\\d{0,4}(?:-[A-Z0-9]+)+(?:\\([A-Z0-9]+\\))?|PX\\d{2}|EX\\d{3}|XX\\d{2}|TK\\d{1,3}|[A-Z]{1,3}\\d{2}-\\d{2,3})';
const CARD_CODE_STANDALONE_REGEX = new RegExp(`\\b(${CARD_CODE_CORE_REGEX})\\b`, 'i');
const CARD_CODE_BRACKETED_REGEX = new RegExp(
  `[\\[(]\\s*(${CARD_CODE_CORE_REGEX})\\s*[\\])]`,
  'i'
);

const SECTION_HEADER_REGEX =
  /^(?:spirits?|ultimates?|braves?|nexuses|nexus|magics?|tokens?|main\s*deck|side\s*deck|sideboard|deck\s*list|total)\b(?:\s*[:(\[]\s*\d*\s*[)\]]?)?:?$/i;

export function normalizeCardNumber(num: string): string {
  return (num || '')
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .toUpperCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '');
}

export function compactCardNumber(num: string): string {
  // Normalizes BS01-001 and BS01-1 into BS01-1 for loose fallback comparison
  const upper = normalizeCardNumber(num);
  return upper.replace(/-0+(\d)/g, '-$1');
}

export function normalizeCardName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u2018\u2019`´]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripPunctuation(name: string): string {
  return normalizeCardName(name)
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSetCodeFromCardNumber(cardNumber: string): string | null {
  const clean = normalizeCardNumber(cardNumber);
  if (!clean) return null;

  // Unhyphenated promo formats (e.g. PX01..PX18, EX001)
  if (/^PX\d{2}$/i.test(clean)) return 'PX';
  if (/^EX\d{2,3}$/i.test(clean)) return 'EXPROMO';

  const dashIdx = clean.indexOf('-');
  if (dashIdx <= 0) return null;
  const prefix = clean.slice(0, dashIdx);
  if (prefix === 'RP26') return 'RP26-STD';
  if (prefix === 'RPX26') return 'PX26-STD';
  if (prefix === 'PX') return 'PX19';
  if (prefix === 'X') return 'PROMO-X';
  if (prefix === 'GX') return 'PROMO-ANM';
  if (prefix === 'KF') return 'KFC';
  return prefix;
}

function tokenJaccardScore(a: string, b: string): number {
  const tokensA = new Set(stripPunctuation(a).split(' ').filter(Boolean));
  const tokensB = new Set(stripPunctuation(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function chooseBestCandidate(
  candidates: BattleSpiritsCard[],
  parsedName: string | undefined,
  parsedCardNumber: string | undefined,
  isRevivalHint: boolean,
  preferredFormat?: GameFormat
): BattleSpiritsCard {
  if (candidates.length === 1) return candidates[0];

  const normParsedName = parsedName ? stripPunctuation(parsedName) : '';
  const normParsedNum = parsedCardNumber ? normalizeCardNumber(parsedCardNumber) : '';

  const scored = candidates.map((c) => {
    let score = 0;
    if (c.setCode.toUpperCase() !== 'BSS01') score += 50;
    if (normParsedNum && normalizeCardNumber(c.cardNumber) === normParsedNum) {
      score += 40;
    }
    if (normParsedName) {
      const cName = stripPunctuation(c.name);
      if (cName === normParsedName) score += 35;
      else if (cName.includes(normParsedName) || normParsedName.includes(cName)) score += 18;
      else score += Math.round(tokenJaccardScore(normParsedName, cName) * 15);
    }
    if (isRevivalHint) {
      if (c.isRevival) score += 25;
      else score -= 10;
    } else if (parsedCardNumber && !/-RV/i.test(parsedCardNumber)) {
      if (!c.isRevival) score += 8;
    }
    if (preferredFormat === 'Standard' && c.formats.includes('Standard')) {
      score += 6;
    }
    if (c.isWikiLoaded) score += 2;
    return { card: c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].card;
}

export function parseDecklistText(
  rawText: string,
  allCards: BattleSpiritsCard[],
  preferredFormat?: GameFormat
): DecklistImportResult {
  const databaseCards = allCards.filter((c) => c.setCode.toUpperCase() !== 'BSS01');

  // Build fast lookup indexes
  const byExactNumber = new Map<string, BattleSpiritsCard[]>();
  const byCompactNumber = new Map<string, BattleSpiritsCard[]>();
  const byNormName = new Map<string, BattleSpiritsCard[]>();
  const byStrippedName = new Map<string, BattleSpiritsCard[]>();

  for (const card of databaseCards) {
    const exactNum = normalizeCardNumber(card.cardNumber);
    if (exactNum) {
      const list = byExactNumber.get(exactNum) || [];
      list.push(card);
      byExactNumber.set(exactNum, list);

      const compactNum = compactCardNumber(card.cardNumber);
      const compactList = byCompactNumber.get(compactNum) || [];
      compactList.push(card);
      byCompactNumber.set(compactNum, compactList);
    }

    const norm = normalizeCardName(card.name);
    if (norm) {
      const list = byNormName.get(norm) || [];
      list.push(card);
      byNormName.set(norm, list);
    }

    const stripped = stripPunctuation(card.name);
    if (stripped) {
      const list = byStrippedName.get(stripped) || [];
      list.push(card);
      byStrippedName.set(stripped, list);
    }

    if (card.jpName) {
      const jpNorm = normalizeCardName(card.jpName);
      if (jpNorm) {
        const list = byNormName.get(jpNorm) || [];
        list.push(card);
        byNormName.set(jpNorm, list);
      }
    }
  }

  let detectedDeckName: string | undefined;
  let detectedFormat: GameFormat | undefined;

  const rawLines = rawText.split(/\r?\n/);
  const parsedLines: ParsedImportLine[] = [];

  for (let idx = 0; idx < rawLines.length; idx++) {
    const lineNumber = idx + 1;
    const rawLine = rawLines[idx];
    const trimmed = rawLine.trim();

    if (!trimmed) continue;

    // Comment lines: check first comment for exported deck header metadata
    if (/^(?:\/\/|#|===|---)/.test(trimmed)) {
      if (!detectedDeckName) {
        const headerMatch = trimmed
          .replace(/^(?:\/\/|#)\s*/, '')
          .match(/^(.+?)\s*(?:\[(Standard|Eternal)\]|\((Standard|Eternal)[^)]*\))\s*(?:\(\d+\s*cards?\))?$/i);
        if (headerMatch) {
          const candidateName = headerMatch[1].trim();
          const fmtRaw = (headerMatch[2] || headerMatch[3] || '').toLowerCase();
          if (
            candidateName &&
            !/^(?:spirit|ultimate|brave|nexus|magic|token)s?$/i.test(candidateName)
          ) {
            detectedDeckName = candidateName;
          }
          if (fmtRaw === 'standard') detectedFormat = 'Standard';
          else if (fmtRaw === 'eternal') detectedFormat = 'Eternal';
        }
      }
      continue;
    }

    // Remove leading bullet markers like "- " or "* " or "• "
    let working = trimmed.replace(/^[-*•]\s+/, '').trim();
    if (!working) continue;

    // Skip pure section headers (e.g., "Spirits (24)", "Magic:", "Main Deck")
    if (SECTION_HEADER_REGEX.test(working)) continue;

    // Parse quantity (leading or trailing)
    let quantity = 1;
    const leadingX = working.match(/^(\d{1,2})\s*[x×]\s+(.+)$/i);
    if (leadingX) {
      quantity = Math.max(1, parseInt(leadingX[1], 10));
      working = leadingX[2].trim();
    } else {
      const leadingXPrefix = working.match(/^[x×](\d{1,2})\s+(.+)$/i);
      if (leadingXPrefix) {
        quantity = Math.max(1, parseInt(leadingXPrefix[1], 10));
        working = leadingXPrefix[2].trim();
      } else {
        const leadingNum = working.match(/^([1-9]\d?)\s+(.+)$/);
        if (leadingNum) {
          quantity = Math.max(1, parseInt(leadingNum[1], 10));
          working = leadingNum[2].trim();
        } else {
          const trailingX = working.match(/^(.+?)\s+[x×]\s*(\d{1,2})$/i);
          if (trailingX) {
            quantity = Math.max(1, parseInt(trailingX[2], 10));
            working = trailingX[1].trim();
          } else {
            const trailingBracketQty = working.match(/^(.+?)\s+[\[(](\d{1,2})[\])]$/);
            if (trailingBracketQty) {
              quantity = Math.max(1, parseInt(trailingBracketQty[2], 10));
              working = trailingBracketQty[1].trim();
            }
          }
        }
      }
    }

    // Check Revival markers
    let isRevivalHint = /[\[(]\s*(?:revival|rv)\s*[\])]/i.test(working);
    working = working.replace(/[\[(]\s*(?:revival|rv)\s*[\])]/gi, ' ').trim();

    // Extract Card Number (prefer bracketed code first, then standalone code)
    let parsedCardNumber: string | undefined;
    const bracketMatch = working.match(CARD_CODE_BRACKETED_REGEX);
    if (bracketMatch) {
      parsedCardNumber = normalizeCardNumber(bracketMatch[1]);
      working = working.replace(bracketMatch[0], ' ').trim();
    } else {
      const standaloneMatch = working.match(CARD_CODE_STANDALONE_REGEX);
      if (standaloneMatch) {
        parsedCardNumber = normalizeCardNumber(standaloneMatch[1]);
        working = working.replace(standaloneMatch[0], ' ').trim();
      }
    }

    if (parsedCardNumber && /-RV/i.test(parsedCardNumber)) {
      isRevivalHint = true;
    }

    // Clean leftover separators around card name
    const parsedName = working
      .replace(/\t+/g, ' ')
      .replace(/^[\s\-–—|:·/]+|[\s\-–—|:·/]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!parsedCardNumber && !parsedName) continue;

    // Skip lines that still look like plain section headers without numbers
    if (!parsedCardNumber && SECTION_HEADER_REGEX.test(parsedName)) continue;

    // Match against existing card database
    let matchedCard: BattleSpiritsCard | undefined;
    let confidence: ImportMatchConfidence = 'unmatched';
    let reason: string | undefined;

    if (parsedCardNumber) {
      const exactNumMatches = byExactNumber.get(parsedCardNumber);
      if (exactNumMatches && exactNumMatches.length > 0) {
        matchedCard = chooseBestCandidate(
          exactNumMatches,
          parsedName,
          parsedCardNumber,
          isRevivalHint,
          preferredFormat
        );
        confidence = 'exact-number';
      } else {
        const compactMatches = byCompactNumber.get(compactCardNumber(parsedCardNumber));
        if (compactMatches && compactMatches.length > 0) {
          matchedCard = chooseBestCandidate(
            compactMatches,
            parsedName,
            parsedCardNumber,
            isRevivalHint,
            preferredFormat
          );
          confidence = 'exact-number';
        }
      }
    }

    if (!matchedCard && parsedName) {
      const norm = normalizeCardName(parsedName);
      const exactNameMatches = byNormName.get(norm);
      if (exactNameMatches && exactNameMatches.length > 0) {
        matchedCard = chooseBestCandidate(
          exactNameMatches,
          parsedName,
          parsedCardNumber,
          isRevivalHint,
          preferredFormat
        );
        confidence = 'exact-name';
      } else {
        const stripped = stripPunctuation(parsedName);
        const strippedMatches = byStrippedName.get(stripped);
        if (strippedMatches && strippedMatches.length > 0) {
          matchedCard = chooseBestCandidate(
            strippedMatches,
            parsedName,
            parsedCardNumber,
            isRevivalHint,
            preferredFormat
          );
          confidence = 'exact-name';
        }
      }
    }

    if (!matchedCard && parsedName && stripPunctuation(parsedName).length >= 3) {
      const targetStripped = stripPunctuation(parsedName);
      const targetNoThe = targetStripped.replace(/^the\s+/i, '');
      let bestScore = 0;
      let bestMatches: BattleSpiritsCard[] = [];

      for (const card of databaseCards) {
        const candStripped = stripPunctuation(card.name);
        const candNoThe = candStripped.replace(/^the\s+/i, '');

        let score = 0;
        if (candNoThe === targetNoThe) {
          score = 0.96;
        } else if (
          candStripped.includes(targetStripped) ||
          targetStripped.includes(candStripped)
        ) {
          const minLen = Math.min(candStripped.length, targetStripped.length);
          const maxLen = Math.max(candStripped.length, targetStripped.length);
          score = maxLen > 0 ? 0.65 + 0.3 * (minLen / maxLen) : 0;
        } else {
          score = tokenJaccardScore(targetStripped, candStripped);
        }

        if (score >= 0.72) {
          if (score > bestScore + 0.01) {
            bestScore = score;
            bestMatches = [card];
          } else if (Math.abs(score - bestScore) <= 0.01) {
            bestMatches.push(card);
          }
        }
      }

      if (bestMatches.length > 0) {
        matchedCard = chooseBestCandidate(
          bestMatches,
          parsedName,
          parsedCardNumber,
          isRevivalHint,
          preferredFormat
        );
        confidence = 'fuzzy-name';
      }
    }

    if (!matchedCard) {
      reason = parsedCardNumber
        ? `No card matching "${parsedCardNumber}"${parsedName ? ` (${parsedName})` : ''} in loaded database`
        : `No card named "${parsedName}" in loaded database`;
    }

    parsedLines.push({
      lineNumber,
      rawText: trimmed,
      quantity,
      parsedCardNumber,
      parsedName,
      isRevivalHint,
      matchedCard,
      confidence,
      reason,
    });
  }

  const matchedLines = parsedLines.filter((l) => Boolean(l.matchedCard));
  const unmatchedLines = parsedLines.filter((l) => !l.matchedCard);

  // Aggregate duplicate card IDs
  const aggregatedMap = new Map<string, { card: BattleSpiritsCard; quantity: number }>();
  for (const line of matchedLines) {
    if (!line.matchedCard) continue;
    const existing = aggregatedMap.get(line.matchedCard.id);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      aggregatedMap.set(line.matchedCard.id, {
        card: line.matchedCard,
        quantity: line.quantity,
      });
    }
  }

  const aggregatedEntries = Array.from(aggregatedMap.values());
  const totalMatchedCards = aggregatedEntries.reduce((sum, e) => sum + e.quantity, 0);

  return {
    detectedDeckName,
    detectedFormat,
    lines: parsedLines,
    matchedLines,
    unmatchedLines,
    aggregatedEntries,
    totalMatchedCards,
    totalParsedLines: parsedLines.length,
  };
}

export function buildImportedDeckEntries(
  aggregatedEntries: { card: BattleSpiritsCard; quantity: number }[],
  existingEntries: DeckEntry[],
  mode: 'replace' | 'merge' | 'new'
): { entries: DeckEntry[]; cappedCards: string[] } {
  const cappedCards: string[] = [];
  const nextMap = new Map<string, number>();

  if (mode === 'merge') {
    for (const e of existingEntries) {
      nextMap.set(e.cardId, e.quantity);
    }
  }

  for (const { card, quantity } of aggregatedEntries) {
    const maxCopies = getMaxCardCopies(card);
    if (maxCopies === 0) {
      const label = isTokenCard(card)
        ? `${card.name} (Token — outside deck)`
        : `${card.name} (Banned)`;
      if (!cappedCards.includes(label)) cappedCards.push(label);
      continue;
    }
    const prevQty = nextMap.get(card.id) || 0;
    const combined = prevQty + quantity;
    const clamped = Math.min(maxCopies, combined);
    if (combined > maxCopies && !cappedCards.includes(card.name)) {
      cappedCards.push(card.name);
    }
    if (clamped > 0) {
      nextMap.set(card.id, clamped);
    }
  }

  const entries: DeckEntry[] = Array.from(nextMap.entries()).map(([cardId, quantity]) => ({
    cardId,
    quantity,
  }));

  return { entries, cappedCards };
}
