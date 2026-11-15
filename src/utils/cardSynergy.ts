import { BattleSpiritsCard, GameFormat } from '../types/card';

export interface SynergySuggestion {
  card: BattleSpiritsCard;
  score: number;
  sharedFamilies: string[];
  sharedKeywords: string[];
  mentionedFamilies: string[];
  isSameColor: boolean;
  isFormatLegal: boolean;
}

export interface SynergyAnalysis {
  targetFamilies: string[];
  targetKeywords: string[];
  suggestions: SynergySuggestion[];
  familyMatchCounts: { family: string; count: number }[];
  keywordMatchCounts: { keyword: string; count: number }[];
}

function getColorsSet(card: BattleSpiritsCard): Set<string> {
  const set = new Set<string>();
  if (card.colors && card.colors.length > 0) {
    card.colors.forEach((c) => set.add(c));
  } else {
    set.add(card.color);
    if (card.secondaryColor) set.add(card.secondaryColor);
  }
  return set;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function analyzeCardSynergies(
  target: BattleSpiritsCard,
  allCards: BattleSpiritsCard[],
  activeFormat: GameFormat
): SynergyAnalysis {
  const targetFamilies = target.families.map((f) => f.trim()).filter(Boolean);
  const targetKeywords = target.keywords.map((k) => k.trim()).filter(Boolean);
  const targetColors = getColorsSet(target);

  const targetFamMap = new Map(targetFamilies.map((f) => [f.toLowerCase(), f]));
  const targetKwMap = new Map(targetKeywords.map((k) => [k.toLowerCase(), k]));
  const targetEffectText = target.effects.map((e) => `${e.timing} ${e.text}`).join(' ').toLowerCase();

  const familyCounter = new Map<string, number>();
  targetFamilies.forEach((f) => familyCounter.set(f, 0));

  const keywordCounter = new Map<string, number>();
  targetKeywords.forEach((k) => keywordCounter.set(k, 0));

  const suggestions: SynergySuggestion[] = [];

  for (const cand of allCards) {
    if (cand.id === target.id) continue;
    if (cand.setCode.toUpperCase() === 'BSS01') continue;

    const sharedFamilies: string[] = [];
    for (const fam of cand.families || []) {
      const clean = fam.trim();
      const matched = targetFamMap.get(clean.toLowerCase());
      if (matched && !sharedFamilies.includes(matched)) {
        sharedFamilies.push(matched);
        familyCounter.set(matched, (familyCounter.get(matched) || 0) + 1);
      }
    }

    const sharedKeywords: string[] = [];
    for (const kw of cand.keywords || []) {
      const clean = kw.trim();
      const matched = targetKwMap.get(clean.toLowerCase());
      if (matched && !sharedKeywords.includes(matched)) {
        sharedKeywords.push(matched);
        keywordCounter.set(matched, (keywordCounter.get(matched) || 0) + 1);
      }
    }

    // Check if candidate's effects reference target's families, or target's effects reference candidate's families
    const mentionedFamilies: string[] = [];
    if (targetFamilies.length > 0 && cand.effects.length > 0) {
      const candEffectText = cand.effects.map((e) => `${e.timing} ${e.text}`).join(' ').toLowerCase();
      for (const tFam of targetFamilies) {
        if (tFam.length < 3) continue;
        const rx = new RegExp(`\\b${escapeRegExp(tFam.toLowerCase())}\\b`, 'i');
        if (rx.test(candEffectText) && !sharedFamilies.includes(tFam)) {
          mentionedFamilies.push(tFam);
        }
      }
    }
    if (cand.families.length > 0 && targetEffectText) {
      for (const cFam of cand.families) {
        const clean = cFam.trim();
        if (clean.length < 3) continue;
        const rx = new RegExp(`\\b${escapeRegExp(clean.toLowerCase())}\\b`, 'i');
        if (
          rx.test(targetEffectText) &&
          !sharedFamilies.includes(clean) &&
          !mentionedFamilies.includes(clean)
        ) {
          mentionedFamilies.push(clean);
        }
      }
    }

    if (
      sharedFamilies.length === 0 &&
      sharedKeywords.length === 0 &&
      mentionedFamilies.length === 0
    ) {
      continue;
    }

    const candColors = getColorsSet(cand);
    let isSameColor = false;
    for (const c of candColors) {
      if (targetColors.has(c)) {
        isSameColor = true;
        break;
      }
    }

    const isFormatLegal = cand.formats.includes(activeFormat);

    let score =
      sharedFamilies.length * 25 +
      mentionedFamilies.length * 20 +
      sharedKeywords.length * 15;
    if (isSameColor) score += 6;
    if (isFormatLegal) score += 4;
    if (cand.type !== target.type && (sharedFamilies.length > 0 || mentionedFamilies.length > 0)) {
      // Bonus for complementary card types (e.g., Magic/Nexus/Brave supporting a Spirit family)
      score += 3;
    }

    suggestions.push({
      card: cand,
      score,
      sharedFamilies,
      sharedKeywords,
      mentionedFamilies,
      isSameColor,
      isFormatLegal,
    });
  }

  suggestions.sort(
    (a, b) =>
      b.score - a.score ||
      a.card.cost - b.card.cost ||
      a.card.cardNumber.localeCompare(b.card.cardNumber)
  );

  return {
    targetFamilies,
    targetKeywords,
    suggestions,
    familyMatchCounts: targetFamilies.map((family) => ({
      family,
      count: familyCounter.get(family) || 0,
    })),
    keywordMatchCounts: targetKeywords.map((keyword) => ({
      keyword,
      count: keywordCounter.get(keyword) || 0,
    })),
  };
}
