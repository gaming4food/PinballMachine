// Coin wallets, the high-score board and the community meter.
// Coins are points only: they are never exchangeable for money or anything else of real value.
import { type CareerLeader, type CareerStats, emptyCareer, readCareer, selfDropped, type SpendKind, totalSpent } from '../shared/career';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BoardRow, MeterState, Platform, RoomId } from '../shared/protocol';
import { DEFAULT_SKIN, type Skin } from '../shared/skins';
import { cleanDisplayName } from './moderation';

/** A day on this PC's calendar, as YYYY-MM-DD (for days played and streaks). */
const dayOf = (ms: number) => new Date(ms).toLocaleDateString('en-CA');

export interface User {
  id: number;
  platform: Platform;
  platformUserId: string;
  name: string;
  /** Neon color for this viewer's coin rims and name tags (0xRRGGBB). */
  color: number;
  balance: number;
  wonTotal: number;
  droppedTotal: number;
  firstSeen: number;
  lastSeen: number;
  /**
   * When their platform last told us their name and picture: as they chat, or a lookup (youtube-upkeep.ts keeps
   * YouTube's within its 30 days).
   */
  refreshedAt: number;
  /** The coin skin they're using (an id from shared/skins.ts). */
  skin: string;
  /** Skins they've bought from the coin shop. */
  unlocked: Set<string>;
  /** An animated name they've bought (see NAME_EFFECTS in shared/skins.ts), or '' for a plain color. */
  nameFx: string;
  /** Everything else worth remembering about them (see shared/career.ts). */
  career: CareerStats;
}

// Placeholder community milestones: names only, no pledges. Charity pledges go here once decided —
// and only amounts the channel has committed to pay. Only coins owned by viewers count toward the meter.
const MILESTONES: { at: number; label: string }[] = [
  { at: 250, label: 'NEON UPGRADE' },
  { at: 1_000, label: 'TURBO HOUR' },
  { at: 2_500, label: 'GOLDEN RAIN' },
  { at: 5_000, label: 'CITY EXPANSION' },
];
const MILESTONE_STEP_AFTER_LAST = 5_000;

function milestoneWindow(total: number): { prevAt: number; nextAt: number; label: string } {
  let prevAt = 0;
  for (const m of MILESTONES) {
    if (m.at > total) return { prevAt, nextAt: m.at, label: m.label };
    prevAt = m.at;
  }
  const last = MILESTONES[MILESTONES.length - 1].at;
  const k = Math.floor((total - last) / MILESTONE_STEP_AFTER_LAST) + 1;
  const nextAt = last + k * MILESTONE_STEP_AFTER_LAST;
  return { prevAt: nextAt - MILESTONE_STEP_AFTER_LAST, nextAt, label: `MILESTONE ${MILESTONES.length + k}` };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hslToInt(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

function colorFor(key: string): number {
  return hslToInt(hash(key) % 360, 1, 0.62);
}

interface UserRow {
  id: number;
  platform: string;
  platform_user_id: string;
  name: string;
  color: number;
  balance: number;
  won_total: number;
  dropped_total: number;
  first_seen: number;
  last_seen: number;
  refreshed_at: number;
  skin: string;
  unlocked: string;
  name_fx: string;
  career: string;
}

/**
 * The viewer behind the control panel's test buttons (see ChatSimulator.testChat). Never on a leaderboard; like every
 * simulated viewer ("sim:"), never sent to the dashboard, and gone with "Remove test viewers".
 */
export const TEST_VIEWER_ID = 'sim:test-viewer';
const isTestViewer = (u: User) => u.platformUserId === TEST_VIEWER_ID;

/**
 * The next viewer number, kept once viewers are removed: a number is never handed out twice, or a newcomer would be
 * paid for a removed viewer's coins still in the coin pusher.
 */
const NEXT_ID_KEY = 'users.nextId';

export class Economy {
  private readonly db: DatabaseSync;
  private readonly users = new Map<number, User>();
  private readonly byKey = new Map<string, User>();
  private readonly rawNames = new Map<number, string>();
  private readonly dirty = new Set<User>();
  /** Viewers changed since the viewer dashboard was last sent them (see cloudsync.ts); kept apart from saving. */
  private readonly unsynced = new Set<User>();
  private nextId = 1;
  /**
   * On the owner's own channel (set by Channel), the channel's own account buys without paying: song requests, skips,
   * skins, colors and fireworks cost it nothing, so the owner can try them out on the stream (the owner's ask,
   * 2026-10-04). Drops still cost coins. Streamers' channels never have it.
   */
  ownerBuysFree = false;
  /** The channel's own account, once it has chatted (see noteStreamer). */
  private readonly buysFree = new Set<number>();
  /** Community meter per machine: each community only ever sees its own progress. */
  private readonly meters = new Map<RoomId, number>();
  private readonly meterDirty = new Set<RoomId>();
  private legacyMeterKey = false;

  constructor(dataDir: string) {
    this.db = new DatabaseSync(join(dataDir, 'coinopcity.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      -- A removed viewer's bytes are overwritten, not left in the file's free space (see remove).
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        platform TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color INTEGER NOT NULL,
        balance INTEGER NOT NULL DEFAULT 0,
        won_total INTEGER NOT NULL DEFAULT 0,
        dropped_total INTEGER NOT NULL DEFAULT 0,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        skin TEXT NOT NULL DEFAULT '',
        unlocked TEXT NOT NULL DEFAULT '',
        name_fx TEXT NOT NULL DEFAULT '',
        career TEXT NOT NULL DEFAULT '',
        UNIQUE (platform, platform_user_id)
      );
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      -- Viewers deleted here but not yet from the viewer dashboard (cloudsync.ts sends them).
      CREATE TABLE IF NOT EXISTS removed_viewers (id INTEGER PRIMARY KEY);
    `);
    // Saves from before the coin shop don't have its columns yet.
    const columns = new Set((this.db.prepare('PRAGMA table_info(users)').all() as unknown as { name: string }[]).map((c) => c.name));
    for (const column of ['skin', 'unlocked', 'name_fx', 'career']) {
      if (!columns.has(column)) this.db.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    }
    // Nor saves from before the 30-day refreshes (0: as fresh as when last seen).
    if (!columns.has('refreshed_at')) this.db.exec('ALTER TABLE users ADD COLUMN refreshed_at INTEGER NOT NULL DEFAULT 0');
    for (const row of this.db.prepare('SELECT * FROM users').all() as unknown as UserRow[]) {
      const user: User = {
        id: row.id,
        platform: row.platform as Platform,
        platformUserId: row.platform_user_id,
        name: row.name,
        color: row.color,
        balance: row.balance,
        wonTotal: row.won_total,
        droppedTotal: row.dropped_total,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        refreshedAt: Math.max(row.refreshed_at ?? 0, row.last_seen),
        skin: row.skin || DEFAULT_SKIN,
        unlocked: new Set(row.unlocked.split(',').filter(Boolean)),
        nameFx: row.name_fx ?? '',
        career: readCareer(row.career ?? ''),
      };
      this.users.set(user.id, user);
      this.byKey.set(`${user.platform}:${user.platformUserId}`, user);
      this.nextId = Math.max(this.nextId, user.id + 1);
    }
    // Past every viewer ever removed too (see keepNextId).
    const kept = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(NEXT_ID_KEY) as { value: string } | undefined;
    this.nextId = Math.max(this.nextId, Number(kept?.value) || 0);
    for (const row of this.db.prepare("SELECT key, value FROM kv WHERE key LIKE 'meter.total%'").all() as unknown as { key: string; value: string }[]) {
      // 'meter.total' predates separate machines; it belongs to the main machine and is rewritten on the next save.
      const legacy = row.key === 'meter.total';
      const room = (legacy ? 'main' : row.key.slice('meter.total.'.length)) as RoomId;
      this.meters.set(room, (this.meters.get(room) ?? 0) + Number(row.value));
      if (legacy) {
        this.legacyMeterKey = true;
        this.meterDirty.add(room);
      }
    }
  }

  get userCount(): number {
    return this.users.size;
  }

  get(id: number): User | undefined {
    return this.users.get(id);
  }

  /** The viewer with this platform id, if they've been seen before (unlike touch, never creates one). */
  find(platform: Platform, platformUserId: string): User | undefined {
    return this.byKey.get(`${platform}:${platformUserId}`);
  }

  /** Finds or creates the viewer behind an event, refreshing their (filtered) display name. */
  touch(platform: Platform, platformUserId: string, rawName: string): { user: User; isNew: boolean } {
    const key = `${platform}:${platformUserId}`;
    const now = Date.now();
    let user = this.byKey.get(key);
    const isNew = !user;
    if (!user) {
      user = {
        id: this.nextId++,
        platform,
        platformUserId,
        name: '',
        color: colorFor(key),
        balance: 0,
        wonTotal: 0,
        droppedTotal: 0,
        firstSeen: now,
        lastSeen: now,
        refreshedAt: now,
        skin: DEFAULT_SKIN,
        unlocked: new Set(),
        nameFx: '',
        career: emptyCareer(),
      };
      this.users.set(user.id, user);
      this.byKey.set(key, user);
    }
    this.setName(user, rawName);
    user.lastSeen = now;
    user.refreshedAt = now;
    this.countDay(user, now);
    this.mark(user);
    return { user, isNew };
  }

  /** A viewer's display name as their platform gives it, filtered (unchanged names aren't filtered again). */
  private setName(user: User, rawName: string): void {
    if (this.rawNames.get(user.id) === rawName) return;
    this.rawNames.set(user.id, rawName);
    user.name = cleanDisplayName(rawName, `${user.platform}:${user.platformUserId}`);
  }

  /**
   * Their platform told us a viewer's name as it is now (a lookup, not a visit: when they were last seen stays). An
   * empty name keeps the one they have.
   */
  refreshed(user: User, rawName: string, now = Date.now()): void {
    if (rawName) this.setName(user, rawName);
    user.refreshedAt = now;
    this.mark(user);
  }

  /** Everyone from a platform (never test viewers). */
  onPlatform(platform: Platform): User[] {
    return [...this.users.values()].filter((u) => u.platform === platform && !u.platformUserId.startsWith('sim:'));
  }

  /** Viewers from a platform whose name and picture were last fresh before `before` (never test viewers). */
  staleOn(platform: Platform, before: number): User[] {
    return this.onPlatform(platform).filter((u) => u.refreshedAt < before);
  }

  /** Days played and the daily streak: the first time a viewer shows up on a new day (this PC's calendar). */
  private countDay(user: User, now: number): void {
    const c = user.career;
    const today = dayOf(now);
    if (c.lastDay === today) return;
    c.streak = c.lastDay === dayOf(now - 86_400_000) ? c.streak + 1 : 1;
    c.bestStreak = Math.max(c.bestStreak, c.streak);
    c.daysPlayed++;
    c.lastDay = today;
  }

  credit(user: User, amount: number, won: boolean): void {
    user.balance += amount;
    if (won) user.wonTotal += amount;
    this.mark(user);
  }

  /** A viewer chatting as the channel's own account (the streamer); on the owner's channel, they then buy for free. */
  noteStreamer(user: User): void {
    if (this.ownerBuysFree) this.buysFree.add(user.id);
  }

  private free(user: User, kind: SpendKind): boolean {
    return kind !== 'drop' && this.buysFree.has(user.id);
  }

  /** Whether a viewer can pay this much for this: their balance covers it, or they buy for free (see ownerBuysFree). */
  canAfford(user: User, amount: number, kind: SpendKind): boolean {
    return this.free(user, kind) || user.balance >= amount;
  }

  /** Takes coins from a balance, noting what on; returns false (and changes nothing) if the viewer can't afford it. */
  spend(user: User, amount: number, kind: SpendKind): boolean {
    if (amount > 0 && this.free(user, kind)) return true;
    if (amount <= 0 || user.balance < amount) return false;
    user.balance -= amount;
    user.career.spent[kind] += amount;
    this.mark(user);
    return true;
  }

  /** Gives back coins spent on something that didn't happen (a song that couldn't play). */
  refund(user: User, amount: number, kind: SpendKind): void {
    if (this.free(user, kind)) return; // nothing was taken
    user.balance += amount;
    user.career.spent[kind] = Math.max(0, user.career.spent[kind] - amount);
    this.mark(user);
  }

  recordDrops(user: User, count: number): void {
    user.droppedTotal += count;
    this.mark(user);
  }

  /**
   * Notes a viewer as changed: saved with the next flush, and sent with the next dashboard sync. Not a viewer removed
   * since: a machine or a song request still holding them (paying a claw turn they steered, say) must never write them
   * back.
   */
  private mark(user: User): void {
    if (this.users.get(user.id) !== user) return;
    this.dirty.add(user);
    this.unsynced.add(user);
  }

  /** Viewers changed since this was last called (or everyone, the first time), for the viewer dashboard. */
  takeUnsynced(all = false): User[] {
    const out = all ? [...this.users.values()] : [...this.unsynced].filter((u) => this.users.has(u.id));
    this.unsynced.clear();
    return out;
  }

  /** Puts viewers back to be sent again (a sync that failed). */
  returnUnsynced(users: User[]): void {
    for (const u of users) if (this.users.has(u.id)) this.unsynced.add(u);
  }

  /** Marks a career as changed, so it's saved with the next flush. */
  touched(user: User): void {
    this.mark(user);
  }

  /** Viewers whose name contains `query` (any case), best matches first, for the control panel's lookup. */
  lookup(query: string, limit = 5): User[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits = [...this.users.values()].filter((u) => u.name.toLowerCase().includes(q));
    hits.sort((a, b) => Number(b.name.toLowerCase() === q) - Number(a.name.toLowerCase() === q) || b.lastSeen - a.lastSeen);
    return hits.slice(0, limit);
  }

  /** The top viewer (from these platforms) in each career category, for the stage's career leaders page. */
  careerLeaders(platforms: ReadonlySet<Platform>): CareerLeader[] {
    const n = (v: number) => v.toLocaleString('en-US');
    const categories: { title: string; score: (u: User) => number; show: (v: number) => string }[] = [
      { title: 'MOST DROPPED', score: (u) => selfDropped(u.career), show: n },
      { title: 'MOST WON', score: (u) => u.wonTotal, show: n },
      { title: 'BIGGEST WIN', score: (u) => u.career.biggestWin, show: n },
      { title: 'TOP SPENDER', score: (u) => totalSpent(u.career), show: n },
      { title: 'JACKPOTS', score: (u) => u.career.jackpots, show: n },
      { title: 'LONGEST STREAK', score: (u) => u.career.bestStreak, show: (v) => `${v} day${v === 1 ? '' : 's'}` },
    ];
    const out: CareerLeader[] = [];
    for (const c of categories) {
      let best: User | null = null;
      let top = 0;
      for (const u of this.users.values()) {
        if (!platforms.has(u.platform) || isTestViewer(u)) continue;
        const v = c.score(u);
        if (v > top) [best, top] = [u, v];
      }
      if (best) out.push({ title: c.title, name: best.name, color: best.color, ...(best.nameFx ? { fx: best.nameFx } : {}), value: c.show(top) });
    }
    return out;
  }

  /** Whether a viewer can use a coin skin without paying: it's free, or they've bought it before. */
  ownsSkin(user: User, skin: Skin): boolean {
    return skin.price <= 0 || user.unlocked.has(skin.id);
  }

  /**
   * Switches a viewer to a coin skin, buying it first if they don't own it.
   * Returns what they paid (0 if they already owned it), or null (changing nothing) if they can't afford it.
   */
  equipSkin(user: User, skin: Skin): number | null {
    let paid = 0;
    if (!this.ownsSkin(user, skin)) {
      if (!this.spend(user, skin.price, 'skins')) return null;
      user.unlocked.add(skin.id);
      paid = skin.price;
    }
    user.skin = skin.id;
    this.mark(user);
    return paid;
  }

  /** Buys a viewer a new neon color; returns false (changing nothing) if they can't afford it. */
  /** A new name color, plain or animated (`fx`, see NAME_EFFECTS); a plain one ends an animated name. */
  buyColor(user: User, color: number, price: number, fx = ''): boolean {
    if (!this.spend(user, price, 'colors')) return false;
    user.color = color;
    user.nameFx = fx;
    this.mark(user);
    return true;
  }

  /** Adds viewer-owned coins to a machine's community meter; returns the milestone label if one was just crossed. */
  addToMeter(room: RoomId, amount: number): string | null {
    const total = this.meters.get(room) ?? 0;
    const before = milestoneWindow(total);
    this.meters.set(room, total + amount);
    this.meterDirty.add(room);
    return total + amount >= before.nextAt ? before.label : null;
  }

  meterState(room: RoomId): MeterState {
    const total = this.meters.get(room) ?? 0;
    const w = milestoneWindow(total);
    return { total, prevAt: w.prevAt, nextAt: w.nextAt, nextLabel: w.label };
  }

  /** Top balances among viewers from the given platforms (never the test buttons' viewer). */
  leaderboard(platforms: ReadonlySet<Platform>, size = 10): BoardRow[] {
    const top: User[] = [];
    for (const user of this.users.values()) {
      if (user.balance <= 0 || !platforms.has(user.platform) || isTestViewer(user)) continue;
      if (top.length === size && user.balance <= top[size - 1].balance) continue;
      top.push(user);
      top.sort((a, b) => b.balance - a.balance || b.wonTotal - a.wonTotal);
      if (top.length > size) top.pop();
    }
    return top.map((u) => ({ name: u.name, color: u.color, ...(u.nameFx ? { fx: u.nameFx } : {}), platform: u.platform, balance: u.balance }));
  }

  /** A viewer's place among viewers from the given platforms (1 = top), ordered like the leaderboard. */
  rank(user: User, platforms: ReadonlySet<Platform>): number {
    let ahead = 0;
    for (const u of this.users.values()) {
      if (isTestViewer(u)) continue;
      if (u !== user && platforms.has(u.platform) && (u.balance > user.balance || (u.balance === user.balance && u.wonTotal > user.wonTotal))) ahead++;
    }
    return ahead + 1;
  }

  /** Deletes simulated viewers (ids starting with "sim:") so test data never mixes with real viewers. */
  purgeTestUsers(): number {
    let removed = 0;
    for (const [key, user] of this.byKey) {
      if (!user.platformUserId.startsWith('sim:')) continue;
      this.byKey.delete(key);
      this.users.delete(user.id);
      this.rawNames.delete(user.id);
      this.dirty.delete(user);
      removed++;
    }
    this.db.prepare("DELETE FROM users WHERE platform_user_id LIKE 'sim:%'").run();
    if (removed) this.keepNextId();
    return removed;
  }

  /** Keeps the next viewer number past the removed ones (NEXT_ID_KEY). */
  private keepNextId(): void {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(NEXT_ID_KEY, String(this.nextId));
  }

  /**
   * Deletes one viewer's record: their coins, career and looks (a viewer's request, the privacy policy). Coins of theirs
   * still in the machine pay nobody when they fall. False when there's no such viewer.
   */
  remove(id: number): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    this.users.delete(id);
    this.byKey.delete(`${user.platform}:${user.platformUserId}`);
    this.rawNames.delete(id);
    this.dirty.delete(user);
    this.unsynced.delete(user);
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (!user.platformUserId.startsWith('sim:')) this.db.prepare('INSERT OR IGNORE INTO removed_viewers (id) VALUES (?)').run(id);
    this.keepNextId();
    // Into the database file now, and the write-ahead log, which still holds their earlier saves, emptied.
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return true;
  }

  /** Viewers deleted here and not yet from the viewer dashboard. */
  takeRemoved(): number[] {
    return (this.db.prepare('SELECT id FROM removed_viewers').all() as unknown as { id: number }[]).map((r) => r.id);
  }

  /** The viewer dashboard has deleted these too. */
  removedSynced(ids: number[]): void {
    const forget = this.db.prepare('DELETE FROM removed_viewers WHERE id = ?');
    for (const id of ids) forget.run(id);
  }

  /** A whole copy of the database, consistent while it's in use (the nightly backups). */
  copyTo(file: string): void {
    this.flush();
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }

  resetBalances(): void {
    for (const user of this.users.values()) {
      user.balance = 0;
      user.wonTotal = 0;
      this.mark(user);
    }
  }

  /** Sets a machine's community meter back to zero (its milestones start over from the first). */
  resetMeter(room: RoomId): void {
    this.meters.set(room, 0);
    this.meterDirty.add(room);
  }

  /** Writes changed wallets to disk. Called every couple of seconds and on shutdown. */
  flush(): void {
    if (!this.dirty.size && !this.meterDirty.size) return;
    const upsert = this.db.prepare(`
      INSERT INTO users (id, platform, platform_user_id, name, color, balance, won_total, dropped_total, first_seen, last_seen, refreshed_at, skin, unlocked, name_fx, career)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name, color = excluded.color, balance = excluded.balance, won_total = excluded.won_total,
        dropped_total = excluded.dropped_total, last_seen = excluded.last_seen, refreshed_at = excluded.refreshed_at, skin = excluded.skin,
        unlocked = excluded.unlocked, name_fx = excluded.name_fx, career = excluded.career
    `);
    this.db.exec('BEGIN');
    try {
      for (const u of this.dirty) {
        upsert.run(
          u.id, u.platform, u.platformUserId, u.name, u.color, u.balance, u.wonTotal, u.droppedTotal, u.firstSeen, u.lastSeen,
          u.refreshedAt, u.skin, [...u.unlocked].join(','), u.nameFx, JSON.stringify(u.career),
        );
      }
      const saveMeter = this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
      for (const room of this.meterDirty) saveMeter.run(`meter.total.${room}`, String(this.meters.get(room) ?? 0));
      if (this.legacyMeterKey) this.db.exec("DELETE FROM kv WHERE key = 'meter.total'");
      this.db.exec('COMMIT');
      this.dirty.clear();
      this.meterDirty.clear();
      this.legacyMeterKey = false;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.flush();
    this.db.close();
  }
}
