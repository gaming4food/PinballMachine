// The kit's server door (docs/MACHINE_REPOS.md section 2): what a machine's server side may use of Coin-Op City.
import type { Platform, RoomInfo } from '../shared/protocol';

export type { HypePurchase, Machine, MachineDeps, MachineOutlet, MakeMachine } from '../server/games/machine';
export { Economy, type User } from '../server/economy';
export { EventBus, type StreamEvent } from '../server/events';
export { ChatSimulator } from '../server/connectors/simulator';
export { RateLimiter } from '../server/moderation';
export { log } from '../server/log';
export { DT, initPhysics } from '../server/games/physics';
export { defineMachine, MACHINE_API, type MachineEntryText, type MachineManifest } from './manifest';
export { hypeAction, hypeId, type HypeAction, type HypeButton, type HypeSale } from './hype-action';
// A viewer's career and its earned drops (the coin pusher counts what each drops and sets off their rewards).
export { goalsReached, REWARD_LABELS, rewardGoal, selfDropped, type RewardDrop } from '../shared/career';
// The city's own chat commands, which a machine leaves to the city (no free coin for them).
export { isCityCommand } from '../shared/city-commands';

/** A room every platform plays, for a machine's own tests and the stand-in host. */
export function roomInfo(id: string, label: string): RoomInfo {
  const platforms: Platform[] = ['youtube', 'kick', 'twitch', 'tiktok', 'tips', 'sim'];
  return { id, label, platforms, shownPlatforms: ['youtube', 'kick', 'twitch'], badges: false } as RoomInfo;
}
