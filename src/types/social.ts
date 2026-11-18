import { CardColor, CardType, GameFormat } from './card';

export type CommunityPostType = 'deck' | 'tournament';

export type EventTier =
  | ''
  | 'Local Store'
  | 'SB (Shop Battle)'
  | 'CS (Championship)'
  | 'Area Qualifier'
  | 'National';

export type TournamentPlacement =
  | ''
  | '1st Place'
  | '2nd Place'
  | 'Top 4'
  | 'Top 8'
  | 'Top 16'
  | 'Participant';

export interface CommunityDeckEntry {
  cardId: string;
  cardNumber: string;
  name: string;
  color: CardColor;
  type: CardType;
  cost: number;
  quantity: number;
  isRevival?: boolean;
}

export interface CommunityPost {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhoto: string;
  postType: CommunityPostType;
  title: string;
  summary: string;
  deckName: string;
  format: GameFormat;
  archetype: string;
  primaryColor: CardColor;
  colors: CardColor[];
  cardCount: number;
  featuredCardId: string;
  entries: CommunityDeckEntry[];
  eventName: string;
  eventTier: EventTier;
  placement: TournamentPlacement;
  record: string;
  mvpCardId: string;
  mvpCardName: string;
  tags: string[];
  likesCount: number;
  commentsCount: number;
  lastCommentId: string;
  importsCount: number;
  isPublic: boolean;
  createdAtMs: number;
  isSeeded?: boolean;
}

export interface CommunityComment {
  id: string;
  postId: string;
  authorUid: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  createdAtMs: number;
}

export interface PublicBuilderProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  bio: string;
  favoriteColor: CardColor;
  followersCount: number;
  isPublic: boolean;
  isSeeded?: boolean;
}
