export type CardColor = 'Red' | 'Purple' | 'White' | 'Yellow' | 'Green' | 'Blue';

export type BattleSymbolKind = CardColor | 'God' | 'Ultimate';

export type ColorFilter = CardColor | 'Multicolor' | 'All';

export type CardType = 'Spirit' | 'Ultimate' | 'Brave' | 'Nexus' | 'Magic';

export type CardRarity =
  | 'C'
  | 'U'
  | 'R'
  | 'M'
  | 'X'
  | 'XX'
  | 'CX'
  | 'NX'
  | 'AX'
  | 'TX'
  | 'XV'
  | 'P';

export type GameFormat = 'Standard' | 'Eternal';

export type FormatFilter = 'All' | GameFormat;

export type SetCategory =
  | 'Booster'
  | 'Starter Deck'
  | 'Promo'
  | 'Standard Booster'
  | 'Standard Starter'
  | 'Collab Booster'
  | 'Supplementary'
  | 'Premium Bandai'
  | 'Premium Card Set'
  | 'Token'
  | 'Revival';

export interface LevelTier {
  level: 1 | 2 | 3 | 4 | 5;
  cores: number;
  bp: number;
}

export interface CardRuling {
  question: string;
  answer: string;
}

export interface CardGalleryImage {
  url: string;
  caption: string;
}

export interface BattleSpiritsCard {
  id: string;
  cardNumber: string;
  name: string;
  jpName: string;
  color: CardColor;
  secondaryColor?: CardColor;
  colors?: CardColor[];
  type: CardType;
  subtypeLabel?: string;
  rarity: CardRarity;
  setCode: string;
  setName: string;
  formats: GameFormat[];
  blockIcon: string;
  restriction?: 'Unlimited' | 'Banned' | 'Restricted <1>' | 'Restricted <2>' | 'Restricted <20>';
  isRevival?: boolean;
  isToken?: boolean;
  cost: number;
  reduction: Partial<Record<BattleSymbolKind, number>>;
  symbols: Partial<Record<BattleSymbolKind, number>>;
  families: string[];
  levels?: LevelTier[];
  braveBonusBp?: number;
  braveCondition?: string;
  summonCondition?: string;
  effects: {
    timing: string;
    text: string;
  }[];
  keywords: string[];
  flavorText: string;
  illustrator: string;
  artworkImage: string;
  galleryImages?: CardGalleryImage[];
  artVariant:
    | 'dragon'
    | 'phantom'
    | 'mecha'
    | 'seraph'
    | 'beast'
    | 'titan'
    | 'nexus'
    | 'magic'
    | 'brave';
  wikiTitle?: string;
  wikiUrl: string;
  isWikiLoaded?: boolean;
  rulings: CardRuling[];
}

export interface DeckEntry {
  cardId: string;
  quantity: number;
}

export interface DeckFolder {
  id: string;
  name: string;
  color?: CardColor;
  createdAt: string;
}

export interface Deck {
  id: string;
  name: string;
  format: GameFormat;
  archetype: string;
  folderId?: string;
  category?: string;
  updatedAt: string;
  entries: DeckEntry[];
}

export interface FilterState {
  search: string;
  format: FormatFilter;
  version: 'All' | 'Original' | 'Revival';
  color: ColorFilter;
  type: CardType | 'All';
  rarity: CardRarity | 'All';
  setCode: string | 'All';
  costBracket: 'All' | '0-2' | '3-4' | '5-6' | '7+';
  keyword: string | 'All';
  sortBy: 'number' | 'cost-asc' | 'cost-desc' | 'bp-desc' | 'name';
}

export interface KeywordGlossaryItem {
  name: string;
  jpName: string;
  colors: CardColor[];
  summary: string;
  timing: string;
}

export interface ProductSet {
  setCode: string;
  wikiTitle?: string;
  category?: SetCategory;
  name: string;
  jpName: string;
  productType:
    | 'Booster Set'
    | 'Collab Booster'
    | 'Supplementary Set'
    | 'Premium Bandai'
    | 'Premium Card Set'
    | 'Starter Deck'
    | 'Mega Deck'
    | 'Promo Set'
    | 'Token Set'
    | 'Revival Set';
  releaseDate: string;
  formats: GameFormat[];
  blockLabel: string;
  isLatestStandard?: boolean;
  isLatestEternal?: boolean;
  tagline: string;
  featuredCardId: string;
  colors: CardColor[];
  totalCardsInSet: number;
  wikiUrl: string;
}
