# PinballMachine

The pinball machine, Coin-Op City's pinball table, as its own project: a streamer's chat puts balls in a line
(`ball`) and flips the flippers together (`left`, `right`), and a drained ball pays its owner and everyone who flipped
it. It is in development (only the owner's own PC plays it), on the pyramid table, whose picture is built in Blender.

```sh
npm install
npm run dev             # the dev host, standing in for the city: http://localhost:7841/stage.html and /panel.html
npm run dev:toys        # the same host with the toy switch on; npm run toy -- all up raises the field toys on it
npm test                # contract-test, table-test, quest-test, pinball-sim-test, pinball-layout-test,
                        # pinball-test, pinball-hype-test, pinball-header-test, pinball-hud-test, pinball-sounds-test,
                        # light-show-test, pinball-effects-test, pinball-shows-test, pinball-parts-test, picture-test
npm run typecheck
npm run pinball-play    # plays unattended balls and prints what a ball scores and pays (balls=N, seed=N,
                        # toys=up, rates)
npm run pinball-stress  # the long physics run (minutes): 250 launches and 3000 flipper shots, expecting "found 0"
                        # (-- toys=up: the same with every toy up; -- lock=held: with a ball held in the lock)
npm run picture         # builds the table's picture in Blender (about 25 s): src/assets/pinball.png
npm run picture -- hero # the promotional picture instead, into blender/renders/hero.png
```

- The table is the pyramid table (`src/shared/pyramid.ts`): 16.7 long, a wide pyramid in the middle, a wireform ramp up
  the left to a raised dish with its own bumper, and a gold ramp from the dish across the top and down the right.
  There are four banks of three turning plaques (Horus, Ra, Ankh and Eye): a hit turns a plaque to its back, and a bank
  with all three turned is matched, pays 5,000 and turns back a second later. Two drop targets, the scarab and the eye,
  right of the pyramid in front of the Horus bank, light the lock once both are down. The scarab saucer and the Eye of
  Ra magnet each hold a slow ball a moment and kick it out; there is a spinner on each orbit, the sun bumper, rollovers
  up the centre lane (all four lit pay 1,000) and an upper-right flipper that moves with `right`. The three top lanes
  light the kickback, which kicks a ball out of the right outlane once. 530 points make a coin (`RULES.pointsPerCoin`).
- Four field toys, which the Pharaoh's quest plays on: three pop-up targets (each drops when hit), a mummy (it goes
  down on its third hit), a tomb in the pyramid's front corner (it catches a ball at its door and kicks it out) and a
  diverter gate on a ramp. The game raises and lowers them when asked (`PinballGame.setToy`), never into a ball. A bank
  matched starts its god's mode on its toy (Sun Chase, Falcon Strike, The Mummy Wakes, Tomb Raid), each with a goal
  and a prize, and the four won begin the finale and its jackpots (`src/server/quest.ts`). On the dev host,
  `npm run dev:toys` and `npm run toy -- <popups|mummy|tomb|diverter|all> <up|down>`, `-- mode <god>` or `-- finale`
  ask (`CLAUDE.md` says how).
- `src/` is the machine (the game and its Rapier physics in `src/server/`, the table as data in `src/shared/pyramid.ts`
  with its types in `table.ts`, the rules in `src/shared/pinball.ts`, the scene, scoreboard, sounds and flash in
  `src/stage/`, the table's picture and the plaques' in `src/assets/`, the card in `src/panel/`), and `tests/` its
  tests.
- `blender/` builds the table's picture from that same table data, through the stage's own camera (`build_table.py`,
  its grade and its printed art), and `tools/` runs it (`picture.ts`, with `export-scene.ts`); `tools/pinball-stress.ts`
  is the stress run. The stage draws the picture as its backdrop with the live parts over it: the balls, the three
  flippers, the turning plaques, the drop targets, the quest's toys (the pop-ups and the mummy rising and sinking, the
  tomb's door sliding up into the pyramid, the diverter's gate swinging), both spinners and glows over the lamps and
  bumpers. In the city's full-screen layout the scoreboard is in the right column (the kit's machine panel) and the
  machine fills the frame's height; in the corner and 9:16 layouts the table fills the frame from near its top edge,
  and the scoreboard sits under it at the frame's foot, across the cabinet's front (`CLAUDE.md`, The stage's layout). Change the table and run `npm run picture` again, then commit the new picture and its sidecar
  (`blender/README.md` says what it needs). If the picture doesn't load, the stage draws a plain three.js stand-in table
  instead (`src/stage/table-mesh.ts`).
- The ball: chrome that reflects the table's picture, with a glow under it and a trail at speed in its owner's colour
  (gold for the house's).
- The flash: each moment on the table (a bank matched, the hype buttons, multiball from the lock, a payout, the toys'
  hits, the quest's moments) plays some of these: a light show over the table's glows, a flash of the picture, sparks
  and a shake. The open tomb sends up a beam of light, and `src/stage/pinball-shows.ts` says which each moment plays.
  While a quest mode runs, its toy's lamp blinks and the rail lights and arrows glow in its god's colour, and the
  finale's ring chases gold and the rainbow; a jackpot rains coins and chimes. Nothing flashes more than 3 times a
  second (the glows' limits count real seconds on the browser's clock), the screen flash adds at most 0.3 of its colour,
  the sparks and the coins come from fixed pools, and the effects run on the table's clock, standing still while the
  table does (`CLAUDE.md`, The flash).
- The tests: `pinball-sim-test` is the physics part by part. `pinball-layout-test` is every way round the table at its
  rate (the orbits, the left ramp, the dish, the saucers, the banks, the quest's toys up and down; no ball escapes or
  sticks) and takes about a minute. `light-show-test`, `pinball-effects-test` and `pinball-shows-test` are the flash:
  the light shows and their player, the sparks, the tomb's beam, the coin burst and the screen flash, what each moment
  plays and when, and that nothing flashes more than 3 times a second. `pinball-parts-test` is the live parts, and that
  the stage's camera puts them on the picture's pixels. `picture-test` fails while the picture was made from another
  table or camera than the stage's, or at another size. `npm run pinball-stress` takes minutes, so it isn't part of
  `npm test`.
- The control panel shows the pinball's card (the line, with a Remove button each), its seven hype buttons and its
  Reset (`src/panel.ts`; the buttons are listed in `src/entry.ts`, and the game plays them in `PinballGame.action`):
  Multiball (2 more balls in now), Ball saver (15 s), Double score (30 s), Nudge, and chat's three events: Sandstorm (a
  gusting wind blows every ball sideways for 10 s), Pharaoh's curse (chat's left and right swap for 10 s) and Summon the
  mummy (it rises for 20 s, and its third hit pays that ball 10,000). Each event is refused with no ball on the table,
  and the mummy also while it's up already, in The Mummy Wakes and in the finale. On the stage a sandstorm lays an amber
  haze and blowing sand over the picture, the curse pulses the rail lights red, and the summoned mummy's lamp blinks
  green, each with a title and a sound. The Reset clears the table and the line, and ends the events; nobody is paid
  for the balls taken away.
- Chat buys the hype buttons too, with coins: `!multiball`, `!saver`, `!double`, `!nudge`, `!sandstorm`, `!curse` and
  `!mummy` (each sale is in `src/entry.ts`). Coin-Op City takes the coins, then `PinballGame.buyHype` presses the
  button for the buyer, or says why not, and the city gives the coins back.
- Subs and gifts press one for free, by their size: under $1 a nudge, a sub or up to $5 a ball saver, up to $20 double
  score, $20 and up multiball (`PinballGame.supported`). The city's support card names what it set off.
- `kit/` is Coin-Op City's kit, copied in by coin-op-city's `npm run kit:export`. Don't edit it.
- The design and the plans are in coin-op-city's `docs/superpowers/` (the table is the plan
  `2026-10-17-pinball-blender-table.md`). A version reaches streamers when the owner imports it into coin-op-city with
  `npm run machine:import` and releases the app. Agents: start with `CLAUDE.md`.
