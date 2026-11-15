import { ALL_COLORS, ALL_SYMBOLS, ALL_TYPES, COLOR_META, SYMBOL_META } from '../data/theme';
import { BattleSpiritsCard, BattleSymbolKind, CardType, Deck } from '../types/card';

export interface ResolvedDeckEntry {
  card: BattleSpiritsCard;
  quantity: number;
}

const TYPE_SORT_ORDER: Record<CardType, number> = {
  Spirit: 0,
  Ultimate: 1,
  Brave: 2,
  Nexus: 3,
  Magic: 4,
};

function loadImageWithTimeout(src: string, timeoutMs = 1800): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }

    const img = new Image();
    if (!src.startsWith('/') && !src.startsWith('data:')) {
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

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}

function drawElementSymbol(
  ctx: CanvasRenderingContext2D,
  symbol: BattleSymbolKind,
  cx: number,
  cy: number,
  radius: number,
  variant: 'reduction' | 'gem' = 'gem',
  symbolImages?: Map<BattleSymbolKind, HTMLImageElement | null>
) {
  ctx.save();
  const img = symbolImages?.get(symbol);
  if (variant === 'reduction') {
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const pad = variant === 'reduction' ? radius * 0.2 : 0;
    const drawR = radius - pad;
    ctx.drawImage(img, cx - drawR, cy - drawR, drawR * 2, drawR * 2);
    ctx.restore();
    return;
  }

  ctx.fillStyle = SYMBOL_META[symbol].hex;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export async function exportDecklistImage(
  deck: Deck,
  resolvedEntries: ResolvedDeckEntry[]
): Promise<string> {
  const sortedEntries = [...resolvedEntries].sort((a, b) => {
    const typeDiff = TYPE_SORT_ORDER[a.card.type] - TYPE_SORT_ORDER[b.card.type];
    if (typeDiff !== 0) return typeDiff;
    const costDiff = a.card.cost - b.card.cost;
    if (costDiff !== 0) return costDiff;
    return a.card.cardNumber.localeCompare(b.card.cardNumber);
  });

  const loadedImages = new Map<string, HTMLImageElement | null>();
  const symbolImages = new Map<BattleSymbolKind, HTMLImageElement | null>();

  await Promise.all([
    ...sortedEntries.map(async ({ card }) => {
      const img = await loadImageWithTimeout(card.artworkImage);
      loadedImages.set(card.id, img);
    }),
    ...ALL_SYMBOLS.map(async (sym) => {
      const img = await loadImageWithTimeout(SYMBOL_META[sym].image);
      symbolImages.set(sym, img);
    }),
  ]);

  const scale = 2;
  const width = 1200;
  const padX = 48;
  const contentW = width - padX * 2;
  const headerH = 148;
  const analyticsH = 214;
  const listHeaderH = 44;

  const cols = 2;
  const colGap = 20;
  const rowGap = 12;
  const rowH = 74;
  const colW = (contentW - colGap) / cols;
  const numRows = Math.max(1, Math.ceil(sortedEntries.length / cols));
  const gridH = numRows * rowH + Math.max(0, numRows - 1) * rowGap;
  const footerH = 68;

  const height = headerH + 24 + analyticsH + 24 + listHeaderH + gridH + 28 + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available');
  }

  ctx.scale(scale, scale);

  // Page Background
  ctx.fillStyle = '#F7F8FA';
  ctx.fillRect(0, 0, width, height);

  // Header Banner
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, width, headerH);

  // Accent bar at top
  const isStandard = deck.format === 'Standard';
  ctx.fillStyle = isStandard ? '#0369A1' : '#B45309';
  ctx.fillRect(0, 0, width, 6);

  const totalCards = sortedEntries.reduce((sum, item) => sum + item.quantity, 0);
  const formatViolations = sortedEntries.filter(
    ({ card }) => isStandard && !card.formats.includes('Standard')
  ).length;
  const copyViolations = sortedEntries.filter(({ card, quantity }) => {
    const max =
      card.restriction === 'Restricted <1>'
        ? 1
        : card.restriction === 'Restricted <2>'
        ? 2
        : 3;
    return quantity > max;
  }).length;
  const hasViolations = formatViolations > 0 || copyViolations > 0;

  // Brand line
  ctx.fillStyle = '#94A3B8';
  ctx.font = '700 14px system-ui, -apple-system, sans-serif';
  ctx.fillText('BATTLESPIRITS DECKLIST', padX, 40);

  // Format Badge
  const fmtText = isStandard ? 'STANDARD FORMAT' : 'ETERNAL FORMAT';
  ctx.font = '700 13px system-ui, -apple-system, sans-serif';
  const fmtBadgeW = ctx.measureText(fmtText).width + 26;
  drawRoundedRect(ctx, width - padX - fmtBadgeW, 24, fmtBadgeW, 30, 8);
  ctx.fillStyle = isStandard ? '#0369A1' : '#B45309';
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(fmtText, width - padX - fmtBadgeW + 13, 44);

  // Deck Title
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 34px system-ui, -apple-system, sans-serif';
  ctx.fillText(fitText(ctx, deck.name, contentW - 220), padX, 90);

  // Deck Meta Subtitle
  ctx.fillStyle = '#CBD5E1';
  ctx.font = '500 15px system-ui, -apple-system, sans-serif';
  const statusStr = hasViolations
    ? 'Format / Copy Check Needed'
    : totalCards >= 40
    ? `Legal (${isStandard ? 'STD' : 'ETN'})`
    : `Need ${40 - totalCards} more for 40`;
  ctx.fillText(
    `${deck.archetype || `${deck.format} Build`}  ·  ${sortedEntries.length} Unique  ·  ${statusStr}  ·  Updated ${deck.updatedAt}`,
    padX,
    122
  );

  // Total Count Callout on right
  ctx.textAlign = 'right';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 32px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(`${totalCards}`, width - padX, 96);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '600 13px system-ui, -apple-system, sans-serif';
  ctx.fillText('TOTAL CARDS', width - padX, 118);
  ctx.textAlign = 'left';

  // Visual Analytics Card (Cost Histogram + Attribute & Type Summary)
  const analyticsY = headerH + 24;
  drawRoundedRect(ctx, padX, analyticsY, contentW, analyticsH, 18);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Left half: Cost Distribution Histogram
  const histX = padX + 24;
  const histY = analyticsY + 24;
  const histW = 540;
  ctx.fillStyle = '#0F172A';
  ctx.font = '700 15px system-ui, -apple-system, sans-serif';
  ctx.fillText('Cost Distribution Histogram', histX, histY + 12);

  const avgCost =
    totalCards > 0
      ? (
          sortedEntries.reduce((s, { card, quantity }) => s + card.cost * quantity, 0) /
          totalCards
        ).toFixed(1)
      : '0.0';
  ctx.fillStyle = '#64748B';
  ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(`Avg Cost: ${avgCost}`, histX + 390, histY + 12);

  const buckets = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const bucketData = buckets.map((b) => {
    const matching = sortedEntries.filter(({ card }) =>
      b === 8 ? card.cost >= 8 : card.cost === b
    );
    const total = matching.reduce((s, item) => s + item.quantity, 0);
    const byColor = ALL_COLORS.map((color) => ({
      color,
      count: matching
        .filter((item) => item.card.color === color)
        .reduce((s, item) => s + item.quantity, 0),
    })).filter((c) => c.count > 0);
    return { bucket: b, total, byColor };
  });
  const maxBucket = Math.max(1, ...bucketData.map((b) => b.total));

  const barAreaTop = histY + 38;
  const barAreaH = 104;
  const slotW = histW / buckets.length;
  const barW = 36;

  // Baseline
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(histX, barAreaTop + barAreaH);
  ctx.lineTo(histX + histW, barAreaTop + barAreaH);
  ctx.stroke();

  bucketData.forEach((b, idx) => {
    const bx = histX + idx * slotW + (slotW - barW) / 2;
    const centerX = bx + barW / 2;

    if (b.total > 0) {
      const totalBarH = Math.max(10, (b.total / maxBucket) * (barAreaH - 18));
      let curBottom = barAreaTop + barAreaH;

      b.byColor.forEach(({ color, count }) => {
        const segH = (count / b.total) * totalBarH;
        ctx.fillStyle = COLOR_META[color].hex;
        ctx.fillRect(bx, curBottom - segH, barW, segH);
        curBottom -= segH;
      });

      ctx.textAlign = 'center';
      ctx.fillStyle = '#0F172A';
      ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(`${b.total}`, centerX, curBottom - 6);
    } else {
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(bx, barAreaTop + barAreaH - 4, barW, 4);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = '#475569';
    ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(b.bucket === 8 ? '8+' : `${b.bucket}`, centerX, barAreaTop + barAreaH + 20);
  });
  ctx.textAlign = 'left';

  // Vertical Divider inside Analytics
  const divX = padX + 596;
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(divX, analyticsY + 22);
  ctx.lineTo(divX, analyticsY + analyticsH - 22);
  ctx.stroke();

  // Right half: Card Type & Attribute Breakdown
  const rightX = divX + 28;
  const rightW = contentW - (rightX - padX) - 24;
  ctx.fillStyle = '#0F172A';
  ctx.font = '700 15px system-ui, -apple-system, sans-serif';
  ctx.fillText('Type & Attribute Breakdown', rightX, histY + 12);

  // Attribute bar
  const attrBarY = histY + 32;
  const attrBarH = 14;
  drawRoundedRect(ctx, rightX, attrBarY, rightW, attrBarH, 7);
  ctx.fillStyle = '#F1F5F9';
  ctx.fill();

  const colorCounts = ALL_COLORS.map((color) => ({
    color,
    count: sortedEntries
      .filter((e) => e.card.color === color)
      .reduce((s, e) => s + e.quantity, 0),
  })).filter((c) => c.count > 0);

  if (totalCards > 0) {
    ctx.save();
    drawRoundedRect(ctx, rightX, attrBarY, rightW, attrBarH, 7);
    ctx.clip();
    let curX = rightX;
    colorCounts.forEach(({ color, count }) => {
      const segW = (count / totalCards) * rightW;
      ctx.fillStyle = COLOR_META[color].hex;
      ctx.fillRect(curX, attrBarY, segW + 1, attrBarH);
      curX += segW;
    });
    ctx.restore();
  }

  // Attribute legend row
  let legX = rightX;
  const legY = attrBarY + 36;
  colorCounts.forEach(({ color, count }) => {
    drawElementSymbol(ctx, color, legX + 7, legY - 4, 7.5, 'gem', symbolImages);

    ctx.fillStyle = COLOR_META[color].hex;
    ctx.font = '700 13px system-ui, -apple-system, sans-serif';
    const label = `${color} ${count}`;
    ctx.fillText(label, legX + 18, legY);
    legX += ctx.measureText(label).width + 32;
  });

  // Type chips row
  const typeY = legY + 34;
  const typeChipW = (rightW - 12 * (ALL_TYPES.length - 1)) / ALL_TYPES.length;
  ALL_TYPES.forEach((t, idx) => {
    const count = sortedEntries
      .filter((e) => e.card.type === t)
      .reduce((s, e) => s + e.quantity, 0);
    const tx = rightX + idx * (typeChipW + 12);
    drawRoundedRect(ctx, tx, typeY, typeChipW, 66, 12);
    ctx.fillStyle = '#F8FAFC';
    ctx.fill();
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#0F172A';
    ctx.font = '800 20px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`${count}`, tx + typeChipW / 2, typeY + 30);

    ctx.fillStyle = '#64748B';
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.fillText(t, tx + typeChipW / 2, typeY + 50);
  });
  ctx.textAlign = 'left';

  // Card Roster Section Heading
  const listTitleY = analyticsY + analyticsH + 46;
  ctx.fillStyle = '#0F172A';
  ctx.font = '700 18px system-ui, -apple-system, sans-serif';
  ctx.fillText(`Deck Card List (${sortedEntries.length} Unique · ${totalCards} Total)`, padX, listTitleY);

  // 2-Column Card Grid
  const gridStartY = listTitleY + 20;
  sortedEntries.forEach(({ card, quantity }, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = padX + col * (colW + colGap);
    const y = gridStartY + row * (rowH + rowGap);

    const meta = COLOR_META[card.color];
    const isIllegalInStd = isStandard && !card.formats.includes('Standard');

    drawRoundedRect(ctx, x, y, colW, rowH, 14);
    ctx.fillStyle = isIllegalInStd ? '#FFFBEB' : '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = isIllegalInStd ? '#F59E0B' : '#E2E8F0';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // Left color accent bar
    ctx.save();
    drawRoundedRect(ctx, x, y, 8, rowH, 4);
    ctx.fillStyle = meta.hex;
    ctx.fill();
    ctx.restore();

    // Card Artwork Thumbnail or Cost Tile
    const thumbX = x + 16;
    const thumbY = y + 9;
    const thumbW = 56;
    const thumbH = 56;
    const img = loadedImages.get(card.id);

    ctx.save();
    drawRoundedRect(ctx, thumbX, thumbY, thumbW, thumbH, 10);
    ctx.clip();
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const imgRatio = img.naturalWidth / img.naturalHeight;
      const boxRatio = thumbW / thumbH;
      let drawW = thumbW;
      let drawH = thumbH;
      let drawX = thumbX;
      let drawY = thumbY;
      if (imgRatio > boxRatio) {
        drawW = thumbH * imgRatio;
        drawX = thumbX - (drawW - thumbW) / 2;
      } else {
        drawH = thumbW / imgRatio;
        drawY = thumbY - (drawH - thumbH) / 4;
      }
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
    } else {
      ctx.fillStyle = meta.hex;
      ctx.fillRect(thumbX, thumbY, thumbW, thumbH);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.font = '800 20px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(`${card.cost}`, thumbX + thumbW / 2, thumbY + 35);
      ctx.textAlign = 'left';
    }
    ctx.restore();

    // Cost chip on bottom-left of thumbnail
    drawRoundedRect(ctx, thumbX + 3, thumbY + 3, 22, 18, 5);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`${card.cost}`, thumbX + 14, thumbY + 16);
    ctx.textAlign = 'left';

    // Quantity box on right
    const qtyW = 56;
    const qtyX = x + colW - qtyW - 12;
    const qtyY = y + 17;
    drawRoundedRect(ctx, qtyX, qtyY, qtyW, 40, 10);
    ctx.fillStyle = '#0F172A';
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.font = '800 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`×${quantity}`, qtyX + qtyW / 2, qtyY + 26);
    ctx.textAlign = 'left';

    // Card Name + Symbol + Metadata
    const textX = thumbX + thumbW + 14;
    const maxTextW = qtyX - textX - 12;

    const cardColors =
      card.colors && card.colors.length > 0
        ? card.colors
        : card.secondaryColor
        ? [card.color, card.secondaryColor]
        : [card.color];

    drawElementSymbol(ctx, card.color, textX + 7, y + 25, 7.5, 'gem', symbolImages);
    ctx.fillStyle = '#0F172A';
    ctx.font = '700 16px system-ui, -apple-system, sans-serif';
    ctx.fillText(fitText(ctx, card.name, maxTextW - 20), textX + 20, y + 30);

    // Reduction icons inline next to metadata
    const redList: BattleSymbolKind[] = [];
    for (const [rc, n] of Object.entries(card.reduction) as [BattleSymbolKind, number][]) {
      for (let i = 0; i < Math.min(n, 4); i++) redList.push(rc);
    }
    let metaTextX = textX;
    if (redList.length > 0) {
      redList.slice(0, 5).forEach((rc, rIdx) => {
        drawElementSymbol(ctx, rc, metaTextX + 6 + rIdx * 13, y + 48, 5.5, 'reduction', symbolImages);
      });
      metaTextX += Math.min(redList.length, 5) * 13 + 6;
    }

    const colorStr = cardColors.length > 2 ? `${cardColors.length}-Color` : cardColors.join('/');
    const tags = [card.cardNumber, `${colorStr} ${card.subtypeLabel || card.type}`, card.rarity];
    if (isIllegalInStd) {
      tags.push('ETN Only');
    } else if (card.restriction === 'Restricted <1>') {
      tags.push('Restricted <1>');
    } else if (card.restriction === 'Restricted <2>') {
      tags.push('Restricted <2>');
    }
    ctx.fillStyle = isIllegalInStd ? '#B45309' : '#64748B';
    ctx.font = '500 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(fitText(ctx, tags.join(' · '), Math.max(40, qtyX - metaTextX - 12)), metaTextX, y + 52);
  });

  // Footer
  const footerY = height - footerH + 22;
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, footerY - 12);
  ctx.lineTo(width - padX, footerY - 12);
  ctx.stroke();

  ctx.fillStyle = '#64748B';
  ctx.font = '600 13px system-ui, -apple-system, sans-serif';
  ctx.fillText(
    `BattleSpirits · ${isStandard ? 'Standard Format (26R+ Block A)' : 'Eternal Format (All-Era BS01–BS77, SD01–SD70 & 26R)'}`,
    padX,
    footerY + 14
  );

  ctx.textAlign = 'right';
  ctx.fillText(deck.updatedAt, width - padX, footerY + 14);
  ctx.textAlign = 'left';

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to render decklist PNG'))),
      'image/png'
    );
  });

  const safeSlug =
    deck.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'battle-spirits-deck';
  const filename = `${safeSlug}-${deck.format.toLowerCase()}-decklist.png`;

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

  return filename;
}
