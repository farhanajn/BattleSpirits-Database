import { ALL_SYMBOLS, COLOR_META, SYMBOL_META } from '../data/theme';
import { BattleSpiritsCard, BattleSymbolKind } from '../types/card';
import { formatRestrictionSummary, getMaxCardCopies, isTokenCard } from './cardRules';
import { buildWikiImageUrl } from './wikiImageClient';

export interface CardShareImageResult {
  blob: Blob;
  objectUrl: string;
  filename: string;
  width: number;
  height: number;
}

export interface CardShareStatsSummary {
  minCost: number;
  maxBp: number;
  levelLines: string[];
  restrictionLabel: string;
  formatLabel: string;
  conditionLine: string | null;
  effectLines: string[];
}

export function buildCardShareStatsSummary(card: BattleSpiritsCard): CardShareStatsSummary {
  const totalReduction = (Object.values(card.reduction) as (number | undefined)[]).reduce<number>(
    (acc, n) => acc + (n || 0),
    0
  );
  const minCost = Math.max(0, (card.cost || 0) - totalReduction);
  const levels = Array.isArray(card.levels) ? card.levels : [];
  const maxBp = levels.length > 0 ? Math.max(...levels.map((l) => l.bp || 0)) : 0;

  const levelLines = levels.slice(0, 4).map((l) =>
    l.bp > 0
      ? `LV${l.level} (${l.cores}c): ${l.bp.toLocaleString()} BP`
      : `LV${l.level} (${l.cores}c): Nexus`
  );

  if (card.braveBonusBp !== undefined && card.braveBonusBp > 0) {
    levelLines.push(`Brave: +${card.braveBonusBp.toLocaleString()} BP`);
  }

  const isStandard = Array.isArray(card.formats) && card.formats.includes('Standard');
  const formatLabel = `${isStandard ? 'Standard & Eternal' : 'Eternal Only'} · ${card.blockIcon || 'Block A'}`;
  const restrictionLabel = formatRestrictionSummary(card);

  let conditionLine: string | null = null;
  if (card.summonCondition) {
    const isContractOrAdvent =
      Boolean(card.subtypeLabel && /contract/i.test(card.subtypeLabel)) ||
      (card.effects || []).some((e) =>
        /Summon\/Advent Condition|Contract Advent|\bAdvent\b/i.test(`${e.timing} ${e.text}`)
      );
    conditionLine = `${isContractOrAdvent ? 'Summon / Advent' : 'Summon'} Condition: ${card.summonCondition}`;
  } else if (card.braveCondition) {
    conditionLine = `Brave Condition: ${card.braveCondition}`;
  }

  const effectLines = (card.effects || []).map((eff) =>
    eff.timing ? `${eff.timing} ${eff.text}`.trim() : eff.text.trim()
  );

  return {
    minCost,
    maxBp,
    levelLines,
    restrictionLabel,
    formatLabel,
    conditionLine,
    effectLines,
  };
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
}

function loadImageWithTimeout(src: string, timeoutMs = 2500): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }

    const img = new Image();
    if (!src.startsWith('/') && !src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }

    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    img.onload = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(img);
      }
    };

    img.onerror = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(null);
      }
    };

    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
        current = word;
      } else {
        // Single extra-long word truncation
        let trimmed = word;
        while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
          trimmed = trimmed.slice(0, -1);
        }
        lines.push(`${trimmed}…`);
        current = '';
      }

      if (lines.length >= maxLines) {
        const lastIdx = maxLines - 1;
        let last = lines[lastIdx];
        while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
          last = last.slice(0, -1);
        }
        lines[lastIdx] = last.endsWith('…') ? last : `${last}…`;
        return lines;
      }
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

function fitSingleLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}

function drawSymbolCircle(
  ctx: CanvasRenderingContext2D,
  symbol: BattleSymbolKind,
  cx: number,
  cy: number,
  radius: number,
  variant: 'reduction' | 'gem',
  symbolImages: Map<BattleSymbolKind, HTMLImageElement | null>
) {
  ctx.save();
  if (variant === 'reduction') {
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  const img = symbolImages.get(symbol);
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const pad = variant === 'reduction' ? radius * 0.22 : 0;
    const drawR = radius - pad;
    ctx.drawImage(img, cx - drawR, cy - drawR, drawR * 2, drawR * 2);
    ctx.restore();
    return;
  }

  ctx.fillStyle = SYMBOL_META[symbol].hex;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.82, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export async function generateCardShareImage(
  card: BattleSpiritsCard,
  preferredImageUrl?: string
): Promise<CardShareImageResult> {
  const artSrc = buildWikiImageUrl(card, preferredImageUrl);
  const symbolImages = new Map<BattleSymbolKind, HTMLImageElement | null>();

  const [artImage] = await Promise.all([
    loadImageWithTimeout(artSrc, 4500),
    ...ALL_SYMBOLS.map(async (sym) => {
      const img = await loadImageWithTimeout(SYMBOL_META[sym].image, 1800);
      symbolImages.set(sym, img);
    }),
  ]);

  const width = 1200;
  const height = 630;
  const scale = 2;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available');
  }
  ctx.scale(scale, scale);

  const primaryMeta = COLOR_META[card.color] || COLOR_META.Red;
  const secondaryMeta = card.secondaryColor ? COLOR_META[card.secondaryColor] : null;
  const summary = buildCardShareStatsSummary(card);
  const isToken = isTokenCard(card);
  const maxCopies = getMaxCardCopies(card);
  const isBanned = !isToken && maxCopies === 0;

  // Base dark studio background
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#090F1E');
  bgGrad.addColorStop(0.55, '#0F172A');
  bgGrad.addColorStop(1, '#111827');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Color accent glow behind card frame
  const glow = ctx.createRadialGradient(255, 315, 24, 255, 315, 420);
  glow.addColorStop(0, `${primaryMeta.hex}44`);
  glow.addColorStop(0.6, `${(secondaryMeta || primaryMeta).hex}18`);
  glow.addColorStop(1, 'rgba(9, 15, 30, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Subtle top color stripe
  if (secondaryMeta) {
    const barGrad = ctx.createLinearGradient(0, 0, width, 0);
    barGrad.addColorStop(0, primaryMeta.hex);
    barGrad.addColorStop(1, secondaryMeta.hex);
    ctx.fillStyle = barGrad;
  } else {
    ctx.fillStyle = primaryMeta.hex;
  }
  ctx.fillRect(0, 0, width, 6);

  // Outer hairline frame
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(18, 22, width - 36, height - 40);

  // Left Card Artwork Frame (5:7 aspect inside studio matte)
  const artX = 48;
  const artY = 44;
  const artW = 382;
  const artH = 536;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  drawRoundedRect(ctx, artX, artY, artW, artH, 20);
  ctx.fillStyle = '#020617';
  ctx.fill();
  ctx.restore();

  ctx.save();
  drawRoundedRect(ctx, artX, artY, artW, artH, 20);
  ctx.clip();

  if (artImage && artImage.naturalWidth > 0 && artImage.naturalHeight > 0) {
    const pad = 8;
    const innerW = artW - pad * 2;
    const innerH = artH - pad * 2;
    const imgRatio = artImage.naturalWidth / artImage.naturalHeight;
    const boxRatio = innerW / innerH;
    let drawW = innerW;
    let drawH = innerH;
    if (imgRatio > boxRatio) {
      drawH = innerW / imgRatio;
    } else {
      drawW = innerH * imgRatio;
    }
    const drawX = artX + (artW - drawW) / 2;
    const drawY = artY + (artH - drawH) / 2;
    ctx.drawImage(artImage, drawX, drawY, drawW, drawH);
  } else {
    const fallbackGrad = ctx.createLinearGradient(artX, artY, artX + artW, artY + artH);
    fallbackGrad.addColorStop(0, primaryMeta.hex);
    fallbackGrad.addColorStop(1, '#0F172A');
    ctx.fillStyle = fallbackGrad;
    ctx.fillRect(artX, artY, artW, artH);

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(artX + artW / 2, artY + artH / 2 - 20, 88, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 44px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(card.cost), artX + artW / 2, artY + artH / 2 - 4);
    ctx.font = '600 15px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(card.type.toUpperCase(), artX + artW / 2, artY + artH / 2 + 28);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  // Artwork border
  ctx.save();
  drawRoundedRect(ctx, artX, artY, artW, artH, 20);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Right Info Column
  const colX = 468;
  const colW = width - colX - 48; // 684px
  let cursorY = 56;

  // 1. Metadata strip
  ctx.textBaseline = 'top';
  ctx.font = '700 15px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#CBD5E1';
  const cardNumText = card.cardNumber || '';
  ctx.fillText(cardNumText, colX, cursorY);
  let metaCursorX = colX + ctx.measureText(cardNumText).width + 14;

  ctx.font = '600 15px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('·', metaCursorX, cursorY);
  metaCursorX += 16;

  ctx.fillStyle = primaryMeta.hex;
  ctx.font = '700 15px Inter, system-ui, sans-serif';
  const rarityAndSet = `${card.setCode} · ${card.rarity}`;
  ctx.fillText(rarityAndSet, metaCursorX, cursorY);
  metaCursorX += ctx.measureText(rarityAndSet).width + 16;

  ctx.fillStyle = '#64748B';
  ctx.fillText('·', metaCursorX, cursorY);
  metaCursorX += 16;

  ctx.font = '600 14px Inter, system-ui, sans-serif';
  ctx.fillStyle = isBanned ? '#FCA5A5' : isToken ? '#94A3B8' : '#38BDF8';
  const statusStr = fitSingleLine(
    ctx,
    isBanned ? 'BANNED (0/deck)' : isToken ? 'TOKEN · OUTSIDE DECK' : summary.formatLabel,
    colX + colW - metaCursorX
  );
  ctx.fillText(statusStr, metaCursorX, cursorY + 1);

  cursorY += 32;

  // 2. Card Title (1-2 lines cleanly balanced)
  let titleFontSize = 36;
  ctx.font = `800 ${titleFontSize}px Inter, system-ui, -apple-system, sans-serif`;
  let titleLines = wrapTextLines(ctx, card.name, colW, 2);
  if (titleLines.length > 1 && card.name.length > 36) {
    titleFontSize = 30;
    ctx.font = `800 ${titleFontSize}px Inter, system-ui, -apple-system, sans-serif`;
    titleLines = wrapTextLines(ctx, card.name, colW, 2);
  }

  ctx.fillStyle = '#F8FAFC';
  for (const line of titleLines) {
    ctx.fillText(line, colX, cursorY);
    cursorY += titleFontSize + 6;
  }

  // Japanese name & Type / Families sub-row
  if (card.jpName) {
    ctx.font = '500 15px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#94A3B8';
    ctx.fillText(fitSingleLine(ctx, card.jpName, colW), colX, cursorY + 2);
    cursorY += 24;
  } else {
    cursorY += 4;
  }

  // Attribute / Type + Families inline line
  const cardColors =
    card.colors && card.colors.length > 0
      ? card.colors
      : card.secondaryColor
      ? [card.color, card.secondaryColor]
      : [card.color];

  let attrX = colX;
  for (const c of cardColors) {
    drawSymbolCircle(ctx, c, attrX + 9, cursorY + 10, 9, 'gem', symbolImages);
    attrX += 22;
  }
  ctx.font = '700 16px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#E2E8F0';
  const typeAndFamilies = [
    card.subtypeLabel || card.type,
    card.families.length > 0 ? card.families.join(' / ') : '',
  ]
    .filter(Boolean)
    .join('  ·  ');
  ctx.fillText(fitSingleLine(ctx, typeAndFamilies, colX + colW - attrX), attrX + 4, cursorY + 1);
  cursorY += 34;

  // 3. Key Stats Bento Strip (Cost | BP/Levels | Symbols & Legality)
  const tileGap = 14;
  const tileW = (colW - tileGap * 2) / 3;
  const tileH = 98;
  const tileY = cursorY;

  // Tile 1: Cost & Reductions
  drawRoundedRect(ctx, colX, tileY, tileW, tileH, 14);
  ctx.fillStyle = 'rgba(30, 41, 59, 0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#94A3B8';
  ctx.fillText('SUMMON COST', colX + 14, tileY + 12);

  ctx.font = '800 32px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#FFFFFF';
  const costStr = String(card.cost);
  ctx.fillText(costStr, colX + 14, tileY + 32);

  ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#94A3B8';
  ctx.fillText(`Min ${summary.minCost}`, colX + 22 + ctx.measureText(costStr).width, tileY + 46);

  const reductionEntries = (
    Object.entries(card.reduction) as [BattleSymbolKind, number][]
  ).filter(([, count]) => count > 0);
  if (reductionEntries.length > 0) {
    let rx = colX + 22;
    const ry = tileY + 78;
    let drawn = 0;
    for (const [rColor, count] of reductionEntries) {
      for (let i = 0; i < count && drawn < 8; i++) {
        drawSymbolCircle(ctx, rColor, rx, ry, 8, 'reduction', symbolImages);
        rx += 20;
        drawn++;
      }
    }
  } else {
    ctx.font = '500 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#64748B';
    ctx.fillText('No reduction symbols', colX + 14, tileY + 72);
  }

  // Tile 2: Levels / BP
  const tile2X = colX + tileW + tileGap;
  drawRoundedRect(ctx, tile2X, tileY, tileW, tileH, 14);
  ctx.fillStyle = 'rgba(30, 41, 59, 0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.stroke();

  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#94A3B8';
  ctx.fillText(
    summary.maxBp > 0
      ? 'MAX BATTLE POINTS'
      : card.braveBonusBp
      ? 'BRAVE BONUS BP'
      : 'CARD TIMING',
    tile2X + 14,
    tileY + 12
  );

  if (summary.maxBp > 0) {
    ctx.font = '800 26px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`${summary.maxBp.toLocaleString()}`, tile2X + 14, tileY + 34);

    ctx.font = '500 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#CBD5E1';
    const compactLevels = (card.levels || [])
      .slice(0, 3)
      .map((l) => (l.bp > 0 ? `L${l.level}:${l.bp / 1000}k` : `L${l.level}`))
      .join(' · ');
    ctx.fillText(fitSingleLine(ctx, compactLevels, tileW - 28), tile2X + 14, tileY + 71);
  } else if (card.braveBonusBp) {
    ctx.font = '800 26px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#FCA5A5';
    ctx.fillText(`+${card.braveBonusBp.toLocaleString()}`, tile2X + 14, tileY + 34);
    ctx.font = '500 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#94A3B8';
    ctx.fillText('Brave Merge BP', tile2X + 14, tileY + 71);
  } else {
    ctx.font = '700 22px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(card.type, tile2X + 14, tileY + 36);
    ctx.font = '500 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#94A3B8';
    const timings = (card.effects || []).map((e) => e.timing).filter(Boolean).join(' · ') || 'Base Effect';
    ctx.fillText(fitSingleLine(ctx, timings, tileW - 28), tile2X + 14, tileY + 71);
  }

  // Tile 3: Symbols & Copy Limit
  const tile3X = colX + (tileW + tileGap) * 2;
  drawRoundedRect(ctx, tile3X, tileY, tileW, tileH, 14);
  ctx.fillStyle = 'rgba(30, 41, 59, 0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.stroke();

  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#94A3B8';
  ctx.fillText('SYMBOLS & DECK LIMIT', tile3X + 14, tileY + 12);

  const symbolEntries = (
    Object.entries(card.symbols) as [BattleSymbolKind, number][]
  ).filter(([, count]) => count > 0);
  if (symbolEntries.length > 0) {
    let sx = tile3X + 24;
    const sy = tileY + 46;
    let drawn = 0;
    for (const [sColor, count] of symbolEntries) {
      for (let i = 0; i < count && drawn < 5; i++) {
        drawSymbolCircle(ctx, sColor, sx, sy, 10, 'gem', symbolImages);
        sx += 24;
        drawn++;
      }
    }
  } else {
    ctx.font = '600 15px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#CBD5E1';
    ctx.fillText('0 Symbols', tile3X + 14, tileY + 38);
  }

  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = isBanned ? '#FCA5A5' : maxCopies < 3 && !isToken ? '#FCD34D' : '#CBD5E1';
  ctx.fillText(fitSingleLine(ctx, summary.restrictionLabel, tileW - 28), tile3X + 14, tileY + 71);

  cursorY = tileY + tileH + 16;

  // 4. Primary Effect / Condition Box
  const footerReserved = 46;
  const effectBoxH = Math.max(120, height - cursorY - footerReserved - 16);

  drawRoundedRect(ctx, colX, cursorY, colW, effectBoxH, 16);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.stroke();

  let effY = cursorY + 16;
  const effMaxW = colW - 32;
  const effMaxY = cursorY + effectBoxH - 14;

  if (summary.conditionLine) {
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#FCD34D';
    const condLines = wrapTextLines(ctx, summary.conditionLine, effMaxW, 2);
    for (const line of condLines) {
      if (effY + 18 > effMaxY) break;
      ctx.fillText(line, colX + 16, effY);
      effY += 19;
    }
    effY += 4;
  }

  if (summary.effectLines.length > 0) {
    for (const rawEff of summary.effectLines) {
      if (effY + 20 > effMaxY) break;
      const availableLines = Math.max(1, Math.floor((effMaxY - effY) / 21));
      ctx.font = '400 14px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#E2E8F0';
      const lines = wrapTextLines(ctx, rawEff, effMaxW, Math.min(4, availableLines));
      for (const line of lines) {
        if (effY + 18 > effMaxY) break;
        ctx.fillText(line, colX + 16, effY);
        effY += 21;
      }
      effY += 6;
    }
  } else {
    ctx.font = '500 14px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#64748B';
    ctx.fillText('Battle Spirits Reference Card — English text pending sync.', colX + 16, effY);
  }

  // 5. Quiet Footer
  const footerY = height - 42;
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText(
    fitSingleLine(ctx, `${card.setCode} — ${card.setName}`, 460),
    colX,
    footerY
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = '#94A3B8';
  ctx.fillText(
    card.illustrator ? `Illust. ${card.illustrator} · BS Card Reference` : 'Battle Spirits Card Reference',
    colX + colW,
    footerY
  );
  ctx.textAlign = 'left';

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) {
        resolve(b);
      } else {
        reject(new Error('Failed to encode card share image'));
      }
    }, 'image/png');
  });

  const objectUrl = URL.createObjectURL(blob);
  const filename = `${card.cardNumber || 'card'}-${sanitizeFilename(card.name || 'battle-spirits')}.png`;

  return {
    blob,
    objectUrl,
    filename,
    width,
    height,
  };
}
