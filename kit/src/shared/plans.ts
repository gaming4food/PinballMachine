// What Coin-Op City costs streamers (your picks 2026-10-02, 2026-10-03 and 2026-10-06): one machine (the Coin Pusher
// or the Claw Machine) at $12 a month or $100 a year ($44 less than twelve months), or All machines (every machine,
// now and to come) at $29 a month or $290 a year, with a 14-day free trial that starts when they add a card
// (docs/DOWNLOADABLE_APP.md). Shared by the website, sign-up and the hosted server's billing (server/billing.ts), which
// still sells only the Coin Pusher's one-machine plan.
export const TRIAL_DAYS = 14;
/** A failed payment keeps the machine running this long while Stripe retries the card (the owner's pick, 2026-10-03). */
export const GRACE_DAYS = 3;

export const PLANS = {
  single: { label: 'One machine', monthly: 12, yearly: 100, soon: false },
  bundle: { label: 'All machines', monthly: 29, yearly: 290, soon: false },
} as const;
export type PlanId = keyof typeof PLANS;

/**
 * How much less a year costs than twelve months, in whole percent, rounded down so it never claims more than it saves
 * ($100 against $144: 30%). The website and the panels show it as a green SAVE 30% (the owner's pick, 2026-10-04).
 */
export function yearlySaving(monthly: number, yearly: number): number {
  return Math.floor((1 - yearly / (monthly * 12)) * 100);
}

/** The machines: the coin pusher and the claw are in the app; the others are coming. */
export const MACHINES = [
  { id: 'coinpusher', name: 'Coin Pusher', live: true },
  { id: 'claw', name: 'Claw Machine', live: true },
  { id: 'speedway', name: 'Speedway', live: false },
  { id: 'pinball', name: 'Pinball', live: false },
  { id: 'plinko', name: 'Plinko', live: false },
] as const;

/**
 * The licences sold (docs/superpowers/specs/2026-10-13-licences-design.md): each plan's Stripe prices, by lookup key,
 * and the machines it covers ('*': every machine, now and to come). The licence checker and the app both read it, and
 * scripts/billing.ts makes the products from it.
 */
export const LICENCE_PLANS = {
  coinpusher: { label: 'Coin Pusher', covers: ['main'], monthly: 12, yearly: 100, lookup: { month: 'coinpusher_monthly', year: 'coinpusher_yearly' } },
  clawmachine: { label: 'Claw Machine', covers: ['claw'], monthly: 12, yearly: 100, lookup: { month: 'clawmachine_monthly', year: 'clawmachine_yearly' } },
  allmachines: { label: 'All machines', covers: ['*'], monthly: 29, yearly: 290, lookup: { month: 'allmachines_monthly', year: 'allmachines_yearly' } },
} as const satisfies Record<string, { label: string; covers: readonly string[]; monthly: number; yearly: number; lookup: { month: string; year: string } }>;
export type LicencePlan = keyof typeof LICENCE_PLANS;

/** The plan a Stripe price belongs to, from its lookup key; null for a price that isn't a licence's. */
export function planOfLookup(lookupKey: string): LicencePlan | null {
  for (const [plan, p] of Object.entries(LICENCE_PLANS) as [LicencePlan, (typeof LICENCE_PLANS)[LicencePlan]][]) {
    if (p.lookup.month === lookupKey || p.lookup.year === lookupKey) return plan;
  }
  return null;
}
