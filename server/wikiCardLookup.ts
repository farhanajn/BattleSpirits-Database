export interface CardLookupCriteria {
  id?: string;
  fileName?: string;
  cardNumber?: string;
  wikiTitle?: string;
  name?: string;
  jpName?: string;
  setCode?: string;
  isRevival?: boolean;
}

export interface LookupResolutionTrace {
  ok: boolean;
  wikiUrl: string | null;
  resolvedFile: string | null;
  resolvedTitle: string | null;
  stage: string | null;
  stagesAttempted: string[];
  wikiSearchResults: string[];
  failureReason: string | null;
  needsManualMapping: boolean;
}

export interface ArtworkDiagnosticRecord {
  cardId: string;
  cardName: string;
  cardNumber: string;
  setCode: string;
  searchMethodAttempted: string;
  stagesAttempted: string[];
  wikiSearchResults: string[];
  resolvedUrl: string | null;
  resolvedFile: string | null;
  resolvedStage: string | null;
  ok: boolean;
  failureReason: string | null;
  needsManualMapping: boolean;
}

export interface WikiCandidatePage {
  title: string;
  wikitext: string;
  pageImages: string[];
  origSource?: string;
  redirectFrom?: string;
}

const LEGACY_PLACEHOLDER_RE =
  /^bs_(?:red_dragon|purple_phantom|white_mecha|yellow_seraph|green_beast|blue_titan|contract_|standard_banner|arcane_magic|relic_brave)/i;

const NON_CARD_ART_FILE_RE =
  /(?:^|[_/\s:-])(?:(?:stan|red|purple|white|yellow|green|blue|gold|god|soul|ultimate|omni|all)[_\s]+)?(?:core|symbol|gem|ex[_\s]+symbol)(?:[_.\s]|$)|(?:^|[_/\s:-])(?:reduction|flash\d*|bursticon|burst_?mark|mirage\d*|contract\d*|flag\d*|lv\d+|block[_\s]?\d*|rarity|icon|symbol|banner|logo|mini|mark|counter|button|template)\.(?:png|jpe?g|webp|gif|svg)|^(?:(?:left|right|up|down|next|prev|back)[_\s-]*)?arrow\d*\.(?:png|jpe?g|webp|gif|svg)$/i;

export function isNonCardWikiIcon(fileTitleOrUrl: string): boolean {
  const clean = fileTitleOrUrl
    .replace(/^https?:\/\/[^/]+\/[^?]*\/revision\/.*$/i, (m) => m)
    .split('/revision/')[0]
    .split('/')
    .pop() || fileTitleOrUrl;
  const decoded = (() => {
    try {
      return decodeURIComponent(clean);
    } catch {
      return clean;
    }
  })()
    .replace(/^(?:File|Image):/i, '')
    .replace(/\u00A0/g, ' ')
    .trim();

  if (!decoded) return true;
  if (LEGACY_PLACEHOLDER_RE.test(decoded)) return true;
  if (NON_CARD_ART_FILE_RE.test(decoded)) return true;
  if (
    /(?:stan_?soul_?core|soul_?core|ex_?symbol|reduction\.png|rarity_|button|banner\.jpe?g)/i.test(
      decoded
    )
  ) {
    return true;
  }
  return false;
}

export function isCardArtworkFile(fileRaw: string): boolean {
  const clean = fileRaw
    .replace(/^(?:File|Image):/i, '')
    .replace(/\u00A0/g, ' ')
    .trim();
  if (!clean || !/\.(png|jpe?g|webp|gif)$/i.test(clean)) return false;
  return !isNonCardWikiIcon(clean);
}

export function expandWikiFileCandidates(
  fileName?: string,
  fallbackNumber?: string,
  options?: { isSideB?: boolean; isRevival?: boolean }
): string[] {
  const candidates: string[] = [];
  const cleanNum = (fallbackNumber || '').trim().toUpperCase();
  const isSideB = Boolean(options?.isSideB || /\(B\)$/i.test(cleanNum));

  const pushUnique = (val: string) => {
    const cleaned = val
      .trim()
      .replace(/^\/+images\//i, '')
      .replace(/^File:/i, '')
      .trim();
    if (!cleaned) return;
    if (isNonCardWikiIcon(cleaned)) return;
    if (!candidates.some((c) => c.toLowerCase() === cleaned.toLowerCase())) {
      candidates.push(cleaned);
    }
  };

  const cleanFile = (fileName || '')
    .trim()
    .replace(/^\/+images\//i, '')
    .replace(/^File:/i, '');

  if (cleanFile) {
    const isWebp = /\.webp$/i.test(cleanFile);
    const stem = cleanFile.replace(/\.(?:png|jpe?g|webp|gif)$/i, '');

    if (!isWebp) pushUnique(cleanFile);
    if (stem) {
      pushUnique(`${stem}.png`);
      pushUnique(`${stem}.jpg`);
      pushUnique(`${stem}.JPG`);
      pushUnique(`${stem}.PNG`);
      pushUnique(`${stem}.jpeg`);
      pushUnique(`${stem}.gif`);
      if (isWebp) pushUnique(cleanFile);

      // Restore sanitized apostrophes (e.g. "Hell_s_Birthday" -> "Hell's Birthday", "The_Shinobi_s_Hidden_Village" -> "The Shinobi's Hidden Village")
      if (/_s(?:_|$)/i.test(stem)) {
        const apostropheStem = stem.replace(/_s(?=_|$)/g, "'s").replace(/_/g, ' ');
        pushUnique(`${apostropheStem}.png`);
        pushUnique(`${apostropheStem}.jpg`);
        pushUnique(`${apostropheStem.replace(/ /g, '_')}.png`);
        pushUnique(`${apostropheStem.replace(/ /g, '_')}.jpg`);
      }

      // Restore variant parentheses (e.g. "BS72-084_Toppa" -> "BS72-084 (Toppa).png")
      const variantMatch = stem.match(/^([A-Z0-9-]+)_([A-Za-z0-9-]+)$/i);
      if (variantMatch && !/^[ab]$/i.test(variantMatch[2])) {
        const parenStem = `${variantMatch[1]} (${variantMatch[2]})`;
        pushUnique(`${parenStem}.png`);
        pushUnique(`${parenStem}.jpg`);
      }

      if (stem.includes('_')) {
        const dashStem = stem.replace(/_/g, '-');
        pushUnique(`${dashStem}.png`);
        pushUnique(`${dashStem}.jpg`);
      }
    }
  }

  if (cleanNum) {
    if (isSideB) {
      const baseCode = cleanNum.replace(/\s*\(B\)$/i, '').trim();
      for (const variant of [
        `${baseCode}_b`,
        `${baseCode} b`,
        `${baseCode}-b`,
        `${baseCode}B`,
        `${baseCode}(B)`,
      ]) {
        pushUnique(`${variant}.png`);
        pushUnique(`${variant}.jpg`);
        pushUnique(`${variant}.PNG`);
        pushUnique(`${variant}.JPG`);
      }
      // Deliberately do NOT fall back to plain Side-A `${baseCode}.png` for (B) cards!
    } else {
      pushUnique(`${cleanNum}.png`);
      pushUnique(`${cleanNum}.jpg`);
      pushUnique(`${cleanNum}.JPG`);
      pushUnique(`${cleanNum}.PNG`);

      const strippedParen = cleanNum.replace(/\([A-Z0-9]+\)$/i, '').trim();
      if (strippedParen && strippedParen !== cleanNum) {
        if (/\(A\)$/i.test(cleanNum)) {
          pushUnique(`${strippedParen}_a.png`);
          pushUnique(`${strippedParen} a.png`);
        }
        pushUnique(`${strippedParen}.png`);
        pushUnique(`${strippedParen}.jpg`);
      }

      const spaceRv = cleanNum.replace(/-RV(?=[A-Z0-9])/i, '-RV ');
      if (spaceRv !== cleanNum) {
        pushUnique(`${spaceRv}.png`);
        pushUnique(`${spaceRv}.jpg`);
      }
    }
  }

  return candidates.slice(0, 18);
}

const ROMAN_PAIRS: Array<[string, string]> = [
  ['XII', '12'],
  ['XI', '11'],
  ['VIII', '8'],
  ['VII', '7'],
  ['III', '3'],
  ['IV', '4'],
  ['IX', '9'],
  ['VI', '6'],
  ['II', '2'],
  ['X', '10'],
  ['V', '5'],
  ['I', '1'],
];

export const KNOWN_CARD_NAME_ALIASES: Record<string, string[]> = {
  beelzebub: ['belzeebub', 'beelzebeat'],
  belzeebub: ['beelzebub'],
  beelzebeat: ['beelzebub', 'belzeebub'],
  siegwurm: ['seigwurm'],
  siegfried: ['siegefried'],
  sarifael: ['sarifael'],
  'agrimonia': ['agrimonia'],
};

export function normalizeCardSearchText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u2018\u2019`´＇]/g, "'")
    .replace(/[\u201C\u201D＂]/g, '"')
    .replace(/[\u2010-\u2015\u2212・=＝]/g, ' ')
    .replace(/['"`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeCompact(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

export function generateRomanArabicVariants(raw: string): string[] {
  const variants = new Set<string>();
  const trimmed = raw.trim();
  if (!trimmed) return [];
  variants.add(trimmed);

  // Hyphen / whitespace boundaries so we don't mutate ordinary words like "King" or "Victor"
  let toArabic = trimmed;
  let toRoman = trimmed;

  for (const [roman, arabic] of ROMAN_PAIRS) {
    const romanBoundaryRe = new RegExp(
      `(^|[\\s\\-_/])${roman}($|[\\s\\-_/.,:])`,
      'gi'
    );
    toArabic = toArabic.replace(romanBoundaryRe, `$1${arabic}$2`);

    const arabicBoundaryRe = new RegExp(
      `(^|[\\s\\-_/])${arabic}($|[\\s\\-_/.,:])`,
      'g'
    );
    toRoman = toRoman.replace(arabicBoundaryRe, `$1${roman}$2`);
  }

  variants.add(toArabic.trim());
  variants.add(toRoman.trim());
  return Array.from(variants).filter(Boolean);
}

export function stripCardNameDecorations(raw: string): string {
  return raw
    .replace(/\s*\((?:Revival|Side\s*[AB]|Card|[A-Z0-9]{2,8}-[A-Z0-9]{2,6})\)\s*/gi, ' ')
    .replace(/\s*-[^-]{2,40}Form-\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildAlternateTitleCandidates(criteria: CardLookupCriteria): string[] {
  const out: string[] = [];
  const push = (val?: string) => {
    const clean = (val || '')
      .replace(/[\u2018\u2019`´]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean || clean.length < 2) return;
    if (!out.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      out.push(clean);
    }
  };

  const baseTitle = (criteria.wikiTitle || '').trim();
  const baseName = (criteria.name || '').trim();

  // Stage 1: Exact provided titles first
  if (baseTitle) push(baseTitle);
  if (baseName) push(baseName);

  // Restored possessive apostrophes if sanitized (`Hell s Birthday` -> `Hell's Birthday`)
  for (const src of [baseTitle, baseName]) {
    if (!src) continue;
    if (/\bs\b/i.test(src)) {
      push(src.replace(/(\p{L})\s+s\b/giu, "$1's"));
    }
    // Roman <-> Arabic numeral conversion
    for (const rv of generateRomanArabicVariants(src)) {
      push(rv);
    }
    // Strip subtitles / parentheticals
    const stripped = stripCardNameDecorations(src);
    if (stripped && stripped !== src) {
      push(stripped);
      for (const rv of generateRomanArabicVariants(stripped)) {
        push(rv);
      }
      push(`${stripped} (Card)`);
    }
    if (!/\(Card\)$/i.test(src) && src.length <= 40) {
      push(`${src} (Card)`);
    }
    // Title case normalized
    const titled = src
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
      .join(' ');
    push(titled);
    if (stripped) {
      const titledStripped = stripped
        .split(/\s+/)
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
        .join(' ');
      push(titledStripped);
    }
  }

  // Known aliases replacement
  for (const existing of [...out]) {
    const lower = existing.toLowerCase();
    for (const [aliasKey, replacements] of Object.entries(KNOWN_CARD_NAME_ALIASES)) {
      if (lower.includes(aliasKey)) {
        const re = new RegExp(aliasKey, 'gi');
        for (const rep of replacements) {
          push(existing.replace(re, rep));
        }
      }
    }
  }

  return out.slice(0, 14);
}

export interface ParsedWikitextCardMeta {
  hasCardTable: boolean;
  isDisambigOrList: boolean;
  kanjiNames: string[];
  enNames: string[];
  sets: string[];
  images: string[];
  cardNumbersInPage: string[];
}

export function extractCardTableMetaFromWikitext(
  wikitext: string
): ParsedWikitextCardMeta {
  const hasCardTable = /\{\{CardTable\d*/i.test(wikitext);
  const isDisambigOrList =
    /\{\{(?:disambig|set|booster|starter)\b/i.test(wikitext) ||
    (!hasCardTable && /\[\[Category:(?:Booster Sets|Starter Decks|Sets|Disambiguation)/i.test(wikitext));

  const grabFieldValues = (pattern: RegExp): string[] => {
    const vals: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(wikitext)) !== null) {
      const v = (m[1] || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
        .replace(/'''?/g, '')
        .trim();
      if (v && !vals.includes(v)) vals.push(v);
    }
    return vals;
  };

  const kanjiNames = grabFieldValues(/\|\s*(?:kanji|jpname|japanese)\s*=\s*([^\n|}]+)/gi);
  const enNames = grabFieldValues(/\|\s*(?:name|enname|english|title)\s*=\s*([^\n|}]+)/gi);
  const sets = grabFieldValues(/\|\s*set\d*\s*=\s*([^\n|}]+)/gi).map((s) =>
    s.toUpperCase()
  );
  const images = grabFieldValues(
    /\|\s*(?:image\d*|bimage|image_?b|imageb|alt(?:image)?\d*)\s*=\s*([^\n|}]+)/gi
  );

  const numMatches = new Set<string>();
  const numRegex =
    /\b((?:26RBS|26RSD|26REB|26RDB|26RCB|BSC|CBX|BS|SD|CB|PB|PC|LM|EX|CP|PX|RP|P)\d{1,2}-[A-Z0-9]+(?:\([AB]\))?)\b/gi;
  let nm: RegExpExecArray | null;
  while ((nm = numRegex.exec(wikitext)) !== null) {
    numMatches.add(nm[1].toUpperCase());
  }

  return {
    hasCardTable,
    isDisambigOrList,
    kanjiNames,
    enNames,
    sets,
    images,
    cardNumbersInPage: Array.from(numMatches),
  };
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(normalizeCardSearchText(a).split(' ').filter((w) => w.length >= 2));
  const tb = new Set(normalizeCardSearchText(b).split(' ').filter((w) => w.length >= 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const w of ta) {
    if (tb.has(w)) intersection++;
  }
  const union = ta.size + tb.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function scoreWikiCandidatePage(
  candidate: WikiCandidatePage,
  criteria: CardLookupCriteria
): { accepted: boolean; score: number; reasons: string[]; meta: ParsedWikitextCardMeta } {
  const reasons: string[] = [];
  let score = 0;
  const meta = extractCardTableMetaFromWikitext(candidate.wikitext || '');

  if (
    /^(?:Category|File|Image|Template|User|Talk|Help|Module|MediaWiki|Special|Battle Spirits Wiki):/i.test(
      candidate.title
    )
  ) {
    return { accepted: false, score: -100, reasons: ['non-article namespace'], meta };
  }
  if (!candidate.wikitext) {
    return { accepted: false, score: -100, reasons: ['missing wikitext'], meta };
  }
  if (!meta.hasCardTable || meta.isDisambigOrList) {
    return { accepted: false, score: -80, reasons: ['not a CardTable article'], meta };
  }

  const targetName = (criteria.name || criteria.wikiTitle || '').trim();
  const targetJp = (criteria.jpName || '').trim();
  const targetSet = (criteria.setCode || '').trim().toUpperCase();
  const rawNumber = (criteria.cardNumber || '').trim().toUpperCase();
  const baseNumber = rawNumber.replace(/\s*\([AB]\)$/i, '').trim();
  const compactBaseNum = baseNumber.replace(/[^A-Z0-9]/g, '');

  // 1. Check card number match against wikitext / images / pageImages
  let numberMatched = false;
  if (compactBaseNum && compactBaseNum.length >= 4) {
    const inImages = [...meta.images, ...candidate.pageImages].some((img) =>
      img.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(compactBaseNum)
    );
    const inPageNums = meta.cardNumbersInPage.some(
      (n) => n.replace(/[^A-Z0-9]/g, '') === compactBaseNum
    );
    const inWikitext = candidate.wikitext
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .includes(compactBaseNum);

    if (inImages || inPageNums || inWikitext) {
      numberMatched = true;
      score += 60;
      reasons.push(`cardNumber match (${baseNumber})`);
    } else if (
      meta.cardNumbersInPage.length > 0 &&
      !targetName &&
      !targetJp
    ) {
      // Number-only query: must contain requested number!
      return {
        accepted: false,
        score: -50,
        reasons: [`number-only mismatch: expected ${baseNumber}`],
        meta,
      };
    } else if (meta.cardNumbersInPage.length > 0 && targetSet && !meta.sets.includes(targetSet)) {
      score -= 35;
      reasons.push(`number/set absent (${baseNumber}/${targetSet})`);
    }
  }

  // 2. Check Japanese name (kanji) match
  let jpMatched = false;
  if (targetJp) {
    const normTargetJp = normalizeCompact(targetJp);
    for (const k of meta.kanjiNames) {
      const normK = normalizeCompact(k);
      if (normK && normTargetJp && normK === normTargetJp) {
        jpMatched = true;
        score += 65;
        reasons.push('jpName exact match');
        break;
      }
      if (normK && normTargetJp && (normK.includes(normTargetJp) || normTargetJp.includes(normK))) {
        jpMatched = true;
        score += 40;
        reasons.push('jpName partial match');
        break;
      }
    }
    if (!jpMatched && meta.kanjiNames.length > 0 && !numberMatched && !targetName) {
      score -= 40;
      reasons.push('jpName mismatch');
    }
  }

  // 3. Check English card name / wikiTitle vs page title / enNames (handling CamelCase, leading 'The', punctuation, Roman<->Arabic, subtitles)
  const targetNameList = Array.from(
    new Set(
      [criteria.name, criteria.wikiTitle].filter((x): x is string => Boolean(x && x.trim()))
    )
  );
  const expandTheAndCamel = (s: string): string[] => {
    const out = [s];
    const noThe = s.replace(/^the\s+/i, '').trim();
    if (noThe && noThe !== s) out.push(noThe);
    const camelSplit = s.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    if (camelSplit !== s) {
      out.push(camelSplit);
      const camelNoThe = camelSplit.replace(/^the\s+/i, '').trim();
      if (camelNoThe) out.push(camelNoThe);
    }
    return out;
  };

  let nameMatched = false;
  if (targetNameList.length > 0) {
    const hasExplicitEditionSuffix = Boolean(
      criteria.wikiTitle &&
        compactBaseNum &&
        new RegExp(`\\(${rawNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`, 'i').test(
          criteria.wikiTitle.trim()
        )
    );

    const rawList = Array.from(
      new Set(
        targetNameList.flatMap((src) => {
          const baseVars = [
            ...expandTheAndCamel(src),
            ...generateRomanArabicVariants(src),
          ];
          const extra = [...baseVars];
          for (const rv of baseVars) {
            const lower = rv.toLowerCase();
            for (const [aliasKey, replacements] of Object.entries(KNOWN_CARD_NAME_ALIASES)) {
              if (lower.includes(aliasKey)) {
                const re = new RegExp(aliasKey, 'gi');
                for (const rep of replacements) extra.push(rv.replace(re, rep));
              }
            }
          }
          return extra;
        })
      )
    );
    const cleanTargetVariants = Array.from(
      new Set(
        targetNameList.flatMap((src) => {
          const stripped = stripCardNameDecorations(src);
          return [
            ...expandTheAndCamel(stripped),
            ...generateRomanArabicVariants(stripped),
          ];
        })
      )
    );

    const pageCandidates = Array.from(
      new Set(
        [candidate.title, stripCardNameDecorations(candidate.title), ...meta.enNames]
          .filter(Boolean)
          .flatMap((pc) => expandTheAndCamel(pc))
      )
    );

    // Prevent card-number-suffixed Standard reprints like "The LeoDragon Lion-Howl (RPX26-01)"
    // from silently matching an unrelated old promo page without RPX26-01.
    if (hasExplicitEditionSuffix && !numberMatched) {
      return {
        accepted: false,
        score: -40,
        reasons: [`edition-suffixed title (${criteria.wikiTitle}) absent on ${candidate.title}`],
        meta,
      };
    }

    const exactHit = rawList.some((tv) =>
      pageCandidates.some((pc) => {
        if (normalizeCardSearchText(tv) === normalizeCardSearchText(pc)) return true;
        const cTv = normalizeCompact(tv);
        const cPc = normalizeCompact(pc);
        return cTv.length >= 8 && cTv === cPc;
      })
    );
    const strippedHit = cleanTargetVariants.some((tv) =>
      pageCandidates.some((pc) => {
        if (normalizeCardSearchText(tv) === normalizeCardSearchText(pc)) return true;
        const cTv = normalizeCompact(tv);
        const cPc = normalizeCompact(pc);
        return cTv.length >= 8 && cTv === cPc;
      })
    );

    if (exactHit) {
      nameMatched = true;
      score += 55;
      reasons.push('name normalized exact match');
    } else if (strippedHit) {
      nameMatched = true;
      score += 42;
      reasons.push('name subtitle-normalized match');
    } else {
      let bestJaccard = 0;
      for (const tv of [...rawList, ...cleanTargetVariants]) {
        for (const pc of pageCandidates) {
          bestJaccard = Math.max(bestJaccard, tokenJaccard(tv, pc));
        }
      }
      if (bestJaccard >= 0.75) {
        nameMatched = true;
        score += Math.round(bestJaccard * 40);
        reasons.push(`name token similarity ${bestJaccard.toFixed(2)}`);
      } else if (bestJaccard < 0.4 && !numberMatched && !jpMatched) {
        score -= 45;
        reasons.push(`name mismatch (${targetName} vs ${candidate.title})`);
      }
    }
  }

  // 4. Check setCode corroboration
  if (targetSet && targetSet !== 'WIKI' && targetSet !== 'REVIVAL') {
    if (
      meta.sets.includes(targetSet) ||
      meta.cardNumbersInPage.some((n) => n.startsWith(`${targetSet}-`))
    ) {
      score += 20;
      reasons.push(`set match (${targetSet})`);
    }
  }

  // 5. Revival tag corroboration
  if (criteria.isRevival) {
    if (
      /\[\[Category:Revival Cards\]\]|\brevival\b|bsc22-|-rv/i.test(
        candidate.wikitext
      )
    ) {
      score += 10;
      reasons.push('revival corroboration');
    }
  }

  const accepted =
    score >= 35 &&
    (numberMatched || jpMatched || nameMatched);

  return { accepted, score, reasons, meta };
}
