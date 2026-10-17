// The viewer dashboard (2026-10-02; see docs/PLATFORM_PLAN.md, phase 1): what a stream PC sends the cloud service,
// and what the dashboard page reads back. Shared by the game server (cloudsync.ts), the cloud service (src/cloud/) and
// the page (src/client/dashboard/).
import type { CareerStats } from './career';

/** One viewer as a stream PC sends it: their wallet and career as they stand now (the cloud works out the changes). */
export interface SyncedViewer {
  /** The stream PC's own number for them (stable for as long as its save lasts). */
  id: number;
  platform: string;
  name: string;
  color: number;
  fx?: string;
  balance: number;
  wonTotal: number;
  firstSeen: number;
  lastSeen: number;
  career: CareerStats;
}

/** Whether a stream PC is sending its viewers to the dashboard (the control panel's Viewer dashboard card). */
export interface CloudState {
  state: 'off' | 'ok' | 'error' | 'sending';
  detail: string;
  /** The dashboard's address for this channel, once the service has said what it is. */
  dashboard: string | null;
  url: string;
}

export interface SyncBatch {
  /** The stream PC's calendar day (YYYY-MM-DD): today's and this week's leaderboards go by it. */
  day: string;
  viewers: SyncedViewer[];
  /** Viewers the stream PC has deleted (on request, or under YouTube's 30-day rule): they go from the dashboard too. */
  removed?: number[];
}

export type Period = 'all' | 'week' | 'day';
export const PERIODS: { id: Period; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'week', label: 'This week' },
  { id: 'day', label: 'Today' },
];

/** The leaderboard categories, and which periods each one has (streaks only make sense all-time). */
export const BOARDS = [
  { id: 'dropped', label: 'Most dropped', periods: ['all', 'week', 'day'] },
  { id: 'won', label: 'Most won', periods: ['all', 'week', 'day'] },
  { id: 'biggest', label: 'Biggest win', periods: ['all', 'week', 'day'] },
  { id: 'spent', label: 'Top spenders', periods: ['all', 'week', 'day'] },
  { id: 'pushed', label: 'Most pushed off', periods: ['all', 'week', 'day'] },
  { id: 'jackpots', label: 'Jackpots', periods: ['all', 'week', 'day'] },
  { id: 'streak', label: 'Longest streak', periods: ['all'] },
  { id: 'balance', label: 'Richest now', periods: ['all'] },
] as const;
export type BoardId = (typeof BOARDS)[number]['id'];

export interface BoardEntry {
  id: number;
  name: string;
  color: number;
  fx?: string;
  platform: string;
  value: number;
}

export interface ChannelBoards {
  channel: { slug: string; title: string; updatedAt: number | null; viewers: number };
  period: Period;
  boards: { id: BoardId; label: string; entries: BoardEntry[] }[];
}

export interface ViewerPage {
  viewer: SyncedViewer;
  /** Places on the all-time boards (1 = top), where they're on them. */
  ranks: Partial<Record<BoardId, number>>;
}
