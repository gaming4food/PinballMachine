# PinballMachine: the pinball machine

The pinball machine is one of Coin-Op City's machines: a table where a streamer's chat puts balls in a line (`ball`)
and flips the flippers together (`left`, `right`). A drained ball pays its owner most of its coins, and the rest is
split among everyone who flipped during it. This repo is the machine on its own. Coin-Op City
(gaming4food/coin-op-city) is the city it runs in: the app streamers install, with the wallet, the chat connections,
the stage and the control panel.

- The design is coin-op-city's `docs/superpowers/specs/2026-10-17-pinball-machine-design.md`, and the plan that builds it
  is `docs/superpowers/plans/2026-10-17-pinball-machine.md`. How machines live in their own repos is coin-op-city's
  `docs/MACHINE_REPOS.md`; the claw (gaming4food/ClawMachine) is the model.
- So far it is an empty pinball that keeps the machine contract. The table, the physics, the game and the stage come in
  the plan's later tasks.

## Folder map

| Folder | What's in it |
|---|---|
| `src/entry.ts` | The machine as the city shows it: its name, icon, How to Play lines, corner tag and Test button, and its four hype buttons with their chat sales. Plain data. |
| `src/manifest.ts` | The server side's manifest: the machine interface version, the entry, how the server makes the game, and that it stops when no stage is open. |
| `src/pages.ts` | The stage side: the scene. |
| `src/panel.ts` | The machine in the streamer's control panel: its card, which of its hype buttons wait (for the panel's Ready), and the words for its Reset. |
| `src/server/` | The game (`game.ts`; a stub for now). |
| `src/shared/` | What the server, the stage and the panel all read: the state the server sends (`pinball.ts`). |
| `src/stage/`, `src/panel/` | The scene (a stub) and the panel's card (a stub). |
| `tests/` | The machine's tests, and `stub-assets.ts`, which a test imports before the stage's code so Node can load it (it stubs the CSS, the pictures and the sound files). |
| `kit/` | **Coin-Op City's kit. Never edit it.** |

## Running it

- `npm install` once.
- `npm run dev`: the stand-in host, the pinball on its own at http://localhost:7841/stage.html (the stage) and
  http://localhost:7841/panel.html (chat as a viewer, the fake audience, the card, the hype buttons and the Reset).
- `npm test`: the contract test (the manifest is complete).
- `npm run pinball-play`: plays unattended balls (auto-save only) and prints the average and median points, coins and
  seconds a ball (`balls=N`, `seed=N`; the top of `tests/pinball-play.ts` says how). It's how `RULES.pointsPerCoin` was tuned.
- `npm run typecheck`.

Run `npm run typecheck` and `npm test` before every commit.

## The kit

- `src/` imports Coin-Op City only through `@kit/...` (`kit/src/kit/`): `@kit/server`, `@kit/stage`, `@kit/panel`,
  `@kit/shared`, `@kit/manifest`, `@kit/pages`. Nothing else of the city exists here.
- **Never edit `kit/`.** It's a copy, made in coin-op-city by `npm run kit:export -- <this repo>`; `kit/KIT.json`
  says which commit. If the machine needs something the kit hasn't got, that's a change to coin-op-city first, then a
  new export.

## How a version reaches streamers

The owner imports it into coin-op-city (`npm run machine:import -- pinball <this repo>`, which refuses uncommitted
changes, reads each file of `src/` from the commit, checksums it, and checks it typechecks and passes coin-op-city's
tests). Nothing here reaches a streamer until then. The pinball is in development (`src/entry.ts` says
`release: 'development'`): only the owner's own PC plays it, and everywhere else it is Coming soon, until `release` is
set to `'released'` here and it is imported again and the app released.
