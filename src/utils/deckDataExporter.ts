import { BattleSpiritsCard, CardType, Deck } from '../types/card';

export interface ExportableDeckEntry {
  card: BattleSpiritsCard;
  quantity: number;
}

const TYPE_ORDER: Record<CardType, number> = {
  Spirit: 0,
  Ultimate: 1,
  Brave: 2,
  Nexus: 3,
  Magic: 4,
};

function sortEntriesForExport(entries: ExportableDeckEntry[]): ExportableDeckEntry[] {
  return [...entries].sort((a, b) => {
    const tDiff = (TYPE_ORDER[a.card.type] ?? 99) - (TYPE_ORDER[b.card.type] ?? 99);
    if (tDiff !== 0) return tDiff;
    if (a.card.cost !== b.card.cost) return a.card.cost - b.card.cost;
    return a.card.cardNumber.localeCompare(b.card.cardNumber);
  });
}

function buildSafeFilenameBase(deck: Deck): string {
  const slug = deck.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const fmt = (deck.format || 'Eternal') === 'Standard' ? 'std' : 'etn';
  const dateStamp = new Date().toISOString().slice(0, 10);
  return `${slug || 'battle-spirits-deck'}-${fmt}-${dateStamp}`;
}

export function buildDeckJsonString(
  deck: Deck,
  resolvedEntries: ExportableDeckEntry[]
): string {
  const sorted = sortEntriesForExport(resolvedEntries);
  const totalCards = sorted.reduce((sum, e) => sum + e.quantity, 0);

  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    deck: {
      id: deck.id,
      name: deck.name,
      format: deck.format || 'Eternal',
      archetype: deck.archetype,
      updatedAt: deck.updatedAt,
      totalCards,
      uniqueCards: sorted.length,
    },
    cards: sorted.map(({ card, quantity }) => ({
      quantity,
      cardId: card.id,
      cardNumber: card.cardNumber,
      name: card.name,
      jpName: card.jpName || '',
      type: card.type,
      color: card.color,
      colors:
        card.colors && card.colors.length > 0
          ? card.colors
          : card.secondaryColor
          ? [card.color, card.secondaryColor]
          : [card.color],
      cost: card.cost,
      rarity: card.rarity,
      setCode: card.setCode,
      setName: card.setName,
      restriction: card.restriction || 'Unlimited',
      formats: card.formats,
      version: card.isRevival ? 'Revival' : 'Original',
    })),
  };

  return JSON.stringify(payload, null, 2);
}

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildDeckCsvString(
  deck: Deck,
  resolvedEntries: ExportableDeckEntry[]
): string {
  const sorted = sortEntriesForExport(resolvedEntries);
  const headers = [
    'Deck Name',
    'Format',
    'Quantity',
    'Card Number',
    'Card Name',
    'Japanese Name',
    'Type',
    'Colors',
    'Cost',
    'Rarity',
    'Set Code',
    'Set Name',
    'Restriction',
    'Legal Formats',
    'Version',
  ];

  const rows = sorted.map(({ card, quantity }) => {
    const colorsList =
      card.colors && card.colors.length > 0
        ? card.colors
        : card.secondaryColor
        ? [card.color, card.secondaryColor]
        : [card.color];

    return [
      deck.name,
      deck.format || 'Eternal',
      quantity,
      card.cardNumber,
      card.name,
      card.jpName || '',
      card.type,
      colorsList.join(' / '),
      card.cost,
      card.rarity,
      card.setCode,
      card.setName,
      card.restriction || 'Unlimited',
      card.formats.join(' / '),
      card.isRevival ? 'Revival' : 'Original',
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  return [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n');
}

export function exportDeckAsFile(
  deck: Deck,
  resolvedEntries: ExportableDeckEntry[],
  fileFormat: 'json' | 'csv'
): string {
  const baseName = buildSafeFilenameBase(deck);
  const filename = `${baseName}.${fileFormat}`;

  const content =
    fileFormat === 'json'
      ? buildDeckJsonString(deck, resolvedEntries)
      : `\uFEFF${buildDeckCsvString(deck, resolvedEntries)}`;

  const mimeType =
    fileFormat === 'json'
      ? 'application/json;charset=utf-8;'
      : 'text/csv;charset=utf-8;';

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);

  return filename;
}
