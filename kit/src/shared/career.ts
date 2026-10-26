// Every viewer's career (2026-10-02): what they've dropped, won and spent, their big moments, how often they play,
// and the streamer drops they've earned by dropping coins. Kept forever with their wallet (server/economy.ts), shown
// with !stats, in the control panel's viewer lookup, and on the stage's career leaders page.

/**
 * What viewers spend coins on (the coin shop's skins, colors and names; skipping the house song; a machine's hype).
 * 'songs' also holds what was spent on song requests before they were removed on 2026-10-18.
 */
export type SpendKind = 'drop' | 'fireworks' | 'skins' | 'colors' | 'songs' | 'hype';
export const SPEND_KINDS: readonly SpendKind[] = ['drop', 'fireworks', 'skins', 'colors', 'songs', 'hype'];

/** The streamer drops a viewer can earn and set off with the same commands (!rain, !goldrush, !jackpot, !barrage). */
export type RewardDrop = 'rain' | 'goldrush' | 'jackpot' | 'barrage';
export const REWARD_DROPS: readonly RewardDrop[] = ['rain', 'goldrush', 'jackpot', 'barrage'];
export const REWARD_LABELS: Record<RewardDrop, string> = { rain: 'COIN RAIN', goldrush: 'GOLD RUSH', jackpot: 'JACKPOT', barrage: 'BOMB BARRAGE' };

export interface CareerStats {
  /** Free coins from chatting, and coins dropped with !drop: together, what counts toward the reward goals. */
  freeDropped: number;
  cmdDropped: number;
  /** The most won in one go (one "+N name" popup). */
  biggestWin: number;
  /** Coins spent, by what on. */
  spent: Record<SpendKind, number>;
  jackpots: number;
  /** Gifts, donations and tips sent, how much they came to (in US cents), and subs and memberships. */
  gifts: number;
  giftCents: number;
  subs: number;
  fireworks: number;
  /** Coins they pushed off the machine (theirs and others'). */
  pushedOff: number;
  /** Days they've chatted on, today's run of days in a row, their best run, and the last day (YYYY-MM-DD). */
  daysPlayed: number;
  streak: number;
  bestStreak: number;
  lastDay: string;
  /** Streamer drops earned at the goals and not yet used; how many they've earned and used in all. */
  rewards: Record<RewardDrop, number>;
  rewardsEarned: number;
  rewardsUsed: number;
}

export function emptyCareer(): CareerStats {
  return {
    freeDropped: 0,
    cmdDropped: 0,
    biggestWin: 0,
    spent: { drop: 0, fireworks: 0, skins: 0, colors: 0, songs: 0, hype: 0 },
    jackpots: 0,
    gifts: 0,
    giftCents: 0,
    subs: 0,
    fireworks: 0,
    pushedOff: 0,
    daysPlayed: 0,
    streak: 0,
    bestStreak: 0,
    lastDay: '',
    rewards: { rain: 0, goldrush: 0, jackpot: 0, barrage: 0 },
    rewardsEarned: 0,
    rewardsUsed: 0,
  };
}

/** A saved career, filled out with anything it's missing (careers saved before a stat existed). */
export function readCareer(json: string): CareerStats {
  const base = emptyCareer();
  if (!json) return base;
  try {
    const saved = JSON.parse(json) as Partial<CareerStats>;
    return { ...base, ...saved, spent: { ...base.spent, ...saved.spent }, rewards: { ...base.rewards, ...saved.rewards } };
  } catch {
    return base;
  }
}

/** Coins spent in all. A kind a career has no number for counts as 0 (the cloud keeps careers as older apps sent them). */
export const totalSpent = (c: CareerStats) => SPEND_KINDS.reduce((sum, kind) => sum + (c.spent[kind] ?? 0), 0);
/** Coins a viewer dropped themselves, chatting or with !drop: what the reward goals count. */
export const selfDropped = (c: CareerStats) => c.freeDropped + c.cmdDropped;

/**
 * The reward goals, in coins dropped (your pick 2026-10-02: free rewards rather than buying them): a Coin Rain at
 * 1,000, a Gold Rush at 2,500, a Jackpot at 5,000 and a Bomb Barrage at 10,000, then one every 5,000 more, the four
 * taking turns.
 */
const FIRST_GOALS = [1_000, 2_500, 5_000, 10_000];
const GOAL_STEP_AFTER = 5_000;
export function rewardGoal(index: number): { at: number; reward: RewardDrop } {
  const at = index < FIRST_GOALS.length ? FIRST_GOALS[index] : FIRST_GOALS.at(-1)! + (index - FIRST_GOALS.length + 1) * GOAL_STEP_AFTER;
  return { at, reward: REWARD_DROPS[index % REWARD_DROPS.length] };
}

/** How many goals a viewer has reached with this many coins dropped. */
export function goalsReached(dropped: number): number {
  let n = 0;
  while (rewardGoal(n).at <= dropped) n++;
  return n;
}

/** One viewer's career for the control panel's lookup. */
export interface CareerView {
  /** The viewer's number in the channel's wallet: what removing them names, since two viewers can share a name. */
  id: number;
  name: string;
  platform: string;
  color: number;
  balance: number;
  wonTotal: number;
  droppedTotal: number;
  firstSeen: number;
  lastSeen: number;
  skin: string;
  career: CareerStats;
}

/** The stage's career leaders page: the top viewer in each category. */
export interface CareerLeader {
  title: string;
  name: string;
  color: number;
  fx?: string;
  value: string;
}
