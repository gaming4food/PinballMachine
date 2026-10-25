# PinballMachine: the pinball machine

The pinball machine is one of Coin-Op City's machines: a table where a streamer's chat puts balls in a line (`ball`)
and flips the flippers together (`left`, `right`). A drained ball pays its owner most of its coins, and the rest is
split among everyone who flipped during it. This repo is the machine on its own. Coin-Op City
(gaming4food/coin-op-city) is the city it runs in: the app streamers install, with the wallet, the chat connections,
the stage and the control panel.

- The design is coin-op-city's `docs/superpowers/specs/2026-10-17-pinball-machine-design.md`, and the plan that builds
  it is `docs/superpowers/plans/2026-10-17-pinball-machine.md`; the table's plan is
  `docs/superpowers/plans/2026-10-17-pinball-blender-table.md`, and its "Decisions since the spec" table holds the
  owner's calls about the table. How machines live in their own repos is coin-op-city's `docs/MACHINE_REPOS.md`; the
  claw (gaming4food/ClawMachine) is the model.
- It plays on the pyramid table, whose picture is built in Blender: the physics, the game, the hype buttons, the stage
  and the panel's card are done. The table plan's last step imports it into Coin-Op City (below).

## Folder map

| Folder | What's in it |
|---|---|
| `src/entry.ts` | The machine as the city shows it: its name, icon, How to Play lines, corner tag and Test button, and its seven hype buttons (chat's three events among them) with their chat sales. Plain data. |
| `src/manifest.ts` | The server side's manifest: the machine interface version, the entry, how the server makes the game, and that it stops when no stage is open. |
| `src/pages.ts` | The stage side: the scene, the scoreboard drawn over it, the snapshot type and its header. |
| `src/panel.ts` | The machine in the streamer's control panel: its card, which of its hype buttons wait (for the panel's Ready), and the words for its Reset. |
| `src/server/` | The pinball: the game (`game.ts`: the line, the flips and the auto-save, scoring, the banks, the lock and multiball, the kickback, the ball saver, a stuck ball, paying, the hype buttons and paid support, chat's events (the sandstorm's wind, the curse and the summoned mummy), moving the quest's toys and running the quest (feeding it the table's hits and its clock, and doing what it says), the high scores and the saved quest), the quest's rules on their own (`quest.ts`: the four god modes the banks start, their clock, goals and prizes, the finale and its jackpots, and what to save; plain logic with no physics) and the table's physics (`sim.ts`: Rapier, the ball a sphere with CCD, three flippers as kinematic bodies, the ramps and the dish as triangle meshes, flip targets in banks, targets at an angle, the saucers and the magnet, a second spinner). |
| `src/shared/` | What the server, the stage, the panel and the Blender build all read: the table as data (`pyramid.ts`: `PYRAMID`), its types, `TABLE`, `TABLE_IN_USE` and the flipper's shape, which the physics and the stage share (`table.ts`), and `pinball.ts` (the state the server sends, the quest's in it, the hype moments and the cues (the toys' hits and the quest's moments), `RULES`, the quest's gods and numbers (`QUEST`), chat's words, the snapshot's 47-byte header, written in `sim.ts` and read in `pinball-header.ts`, its lit inserts and toy bits, and `DIVERTER_SPEED`, the speed the physics and the stage both swing the diverter's gate at). |
| `src/stage/` | The scene (`pinball.ts`, with `stageCamera`, the camera the picture is rendered through), the picture's unseen occluders and the stand-in table for when it fails to load (`table-mesh.ts`), the live parts over it, the quest's toys and the lamps the light shows light among them (`pinball-parts.ts`), the snapshot's header (`pinball-header.ts`), the sandstorm's haze and sand (`sand.ts`), the scoreboard and big titles (`pinball-hud.ts`), the sounds (`pinball-sounds.ts`, with the picks in `pinball-sound-picks.ts`), the flash (The flash, below: the show book and the table's clock as drawn in `pinball-shows.ts`, the light shows and their player in `light-show.ts`, the screen flash in `screen-hits.ts`, the sparks and the tomb's beam in `sparks.ts`), the payout's coin burst (`coin-burst.ts`) and `pinball.css`. |
| `src/assets/` | The table's picture (`pinball.png`) with its sidecar (`pinball.json`), and the live plaques' pictures (`plaques/`): made by `npm run picture` and `blender/plaques.py`, not by hand. |
| `src/panel/` | The card: the line, with a Remove button on each viewer (`pinball-card.ts`). |
| `blender/`, `tools/` | What builds the picture: `tools/picture.ts` (`npm run picture`) exports the table and the stage's camera (`export-scene.ts`), renders them with `blender/build_table.py` and grades the render (`grade.py`). `compose_art.py`, `gen_art.py` and `art/` are the printed art, `plaques.py` the live plaques'. `tools/pinball-stress.ts` is the stress run, and `tools/dev-toys.ts` and `tools/toy.ts` the dev host's toy switch (Running it). |
| `tests/` | The machine's tests (below), `pinball-play.ts`, which plays unattended balls to tune the payout, and `stub-assets.ts`, which a test imports before the stage's code so Node can load it (it stubs the CSS, the pictures and the sound files). |
| `kit/` | **Coin-Op City's kit. Never edit it.** |

## Running it

- `npm install` once.
- `npm run dev`: the dev host, standing in for the city: the pinball on its own at http://localhost:7841/stage.html (the
  stage) and http://localhost:7841/panel.html (chat as a viewer, the fake audience, the card, the hype buttons and the
  Reset). Type `ball` there to line a ball up, and `left` or `right` to flip. Its wallet and save file are in
  `data-host/`.
- `npm run dev:toys`: `npm run dev` with the toy switch on (`PINBALL_TOYS=1`; `-- --port N` for another port, 7841 by
  default), so that the quest's field toys can be raised and lowered, and its modes and finale started, by hand. The
  city never sets it and shows no button for it.
- `npm run toy -- <popups|mummy|tomb|diverter|all> <up|down> [port]`: asks a running `dev:toys` host to raise or lower
  those toys (the port is 7841 by default), and `npm run toy -- mode <ra|horus|ankh|eye> [port]` or
  `npm run toy -- finale [port]` starts that god's mode or the finale now (whatever ran ends, with no prize). The table
  steps only while a stage page is open, so the toys move once one is, and a mode's clock runs only while a ball is in
  play; a host from plain `npm run dev` ignores the request. Two things to know when trying the toys:
  - A request is a move, not a standing order: a pop-up or the mummy that a ball knocks down stays down until it is
    asked up again.
  - With every toy up, the mummy shuts the left ramp (with it up, none of the 77 real flips that go up the ramp gets
    up it), so `npm run toy -- all up` never shows the gate at work. Raise the gate alone
    (`npm run toy -- diverter up`) to see it turn the left ramp's shots into the lock.
- `npm test`: the chain in `package.json`: the contract test (the manifest is complete, and the card), table-test (the
  table as data, `RULES` and chat's words), quest-test (the quest's rules on their own: the four modes, the finale, the
  save and the Reset), pinball-sim-test (the physics), pinball-layout-test (every way round the
  table at its rate, the quest's toys up and down: no ball escapes or sticks; `-- <words>` runs only the checks whose
  names hold them), pinball-test (the game, step by step, the quest played through it too), pinball-hype-test (the hype
  buttons and paid support; `npm run pinball-hype-test -- <words>` runs only the tests whose names hold them),
  pinball-header-test (the stage reads the snapshot's header as the server writes it), pinball-hud-test (the scoreboard
  and the titles), pinball-sounds-test (when each sound plays), light-show-test (the light shows and their player, and
  that no light rises more than 3 times a second), pinball-effects-test (the sparks' pool, the tomb's beam, the coin
  burst and the screen flash), pinball-shows-test (what each moment plays, and when), pinball-parts-test (the live parts
  sit on the picture's pixels) and picture-test (the picture is of this table and camera).
- `npm run pinball-stress`: the long physics run (minutes, so not in `npm test`): 250 launches and 3000 flipper shots,
  expecting `found 0 in 3250 runs`; `-- toys=up` makes the same run with every one of the quest's toys up, and
  `-- lock=held` with a ball held in the lock throughout. Run all three after a change to the table or the physics.
- `npm run pinball-play`: plays balls and prints the average and median points, coins and seconds a ball (`balls=N`,
  `seed=N`). Unattended, only the auto-save plays; `chat=human` is a modelled chat flipping instead, calibrated to the
  spec's human-like column. It plays the Pharaoh's quest too, and prints its counts from the cues (each god's modes
  started, won and lost, the finales and the jackpots), the spec's three aims and what a ball that finished a mode pays
  beside one that finished none; `q.<name>=<number>` sets one of `QUEST`'s numbers for the run (`q.modeSeconds=45`,
  `q.goals.ra=2`). `toys=up` keeps every toy up, and `rates` prints how often each bank matches and each toy is hit, a
  ball and per 30 s; the top of `tests/pinball-play.ts` says how. It's how `RULES.pointsPerCoin` was tuned (530 points
  a coin with `chat=human`: about 9 coins a ball that finishes no mode) and `QUEST`'s numbers chosen, and how the toys'
  spots were measured. It's for tuning, not a test.
- `npm run picture`: builds the table's picture in Blender (below); `-- hero` makes the promotional one instead.
- `npm run typecheck`.

Run `npm run typecheck` and `npm test` before every commit. pinball-test and pinball-hype-test run the same every time:
they seed Math.random and start the clock at the same moment, and the physics does the same given the same. So a
failure is real and fails again: read the step and find out why.

## How it plays

- **The line.** `ball` (or `!ball`) puts a viewer's ball in the line: one each, in the line or on the table. When the
  table is empty the next is up ("Ana is up!") and launches up the plunger lane `RULES.launchDelay` (2 s) later.
- **Flipping.** Anyone's `left` or `right` (`l`, `r`) holds that side's flippers up for a quarter second (`right` moves
  the upper-right one too), and counts them once on every ball in play. With no flip word for 3 s the auto-save flips
  at a ball near a flipper, missing 1 in 6; the next word hands the flippers back. Every machine the city has made hears
  every chat line, and the claw's and the Speedway's players say left and right too, so a flip word counts only within
  a second (by the wall clock) of the table's last step: while no stage shows the pinball, it's another machine's chat.
  `ball` still lines up then.
- **Scoring.** Each part scores what the table says (`pyramid.ts`; double score doubles it): the saucer pays 750 and
  the magnet 250. The four rollovers up the centre lane light a lamp each; all four lit pay 1,000 and go out. Four banks
  of three turning plaques (Horus, Ra, Ankh and Eye): a hit turns a plaque to its back, and a bank with all three
  turned is matched, pays 5,000, is titled on the stage (HORUS MATCHED and so on), starts its god's mode of the quest
  (below) and turns back a second later.
- **The lock and the kickback.** The lock lights when both drop targets (the scarab and the eye, right of the pyramid in
  front of the Horus bank) are down; they come back up a second later, once no ball stands where one rises (the plaques
  keep their turns). A ball into the lit lock is held there and multiball brings 2 more balls in (from the line, then
  the house's, which pay nobody); the held ball is let go when the others are down to one. While the lock holds a
  ball, another that reaches it is kicked back out toward the flippers (sim.ts's LOCK_KICK), so none comes to rest
  against the held one. All 3 top rollovers light the kickback, which kicks a ball out of the right outlane once.
- **Second chances.** A ball that drains within 5 s of its first launch, or under a bought ball saver, comes straight
  back with its points. A ball that stays put 4 s gets the table nudged (a ball a saucer, the magnet or the tomb holds
  isn't stuck); one still stuck after 3 nudges is taken off and launched again up the plunger lane for the same owner,
  with its points and flippers (the table lost it, not the player, so it isn't drained and paid).
- **The toys.** The quest's four field toys (the three pop-up targets, the mummy, the tomb and the diverter's gate)
  start down, shut and at rest, and the game moves them when asked (`PinballGame.setToy(toy, up)`, with `toyWanted`):
  each step, after the physics, it brings about what was asked, and a part a ball is in the way of waits and is tried
  again next step. The ways are: a pop-up or the mummy with a ball where it rises; the door with a ball in the doorway
  or held in the tomb; the gate, either way, with a ball in its sweep; and the gate, swinging over, with a ball on the
  left ramp or in the dish (over, it would shut that ball in). A request is a move, not a standing order: a pop-up a
  ball knocks down stays down until it is asked up again. The mummy goes down on its third hit since it rose; a ball
  the tomb catches scores the tomb's points; a Reset puts every toy away. Each pop-up knocked down, each hit on the
  mummy and each ball the tomb catches is also a cue to the stages (`PinballCueMsg`, read with `pinballCueOf`): the
  part, whether the hit put it `down` (a pop-up's does, and the mummy's third), where the ball was and the table's
  time. As a hype moment does, it goes to every client and never in hello, and the panel's card reads only the state.
  The server says each hit because a fast ball can touch a toy and be away again between two snapshots. A pop-up the
  game puts away is no hit and sends none. The quest asks for the toys (below), and on the dev host `npm run dev:toys`
  turns on the `toy` machine action (`{ kind: 'toy', toy, up }`), which `npm run toy` sends.
- **The quest**, the Pharaoh's: its rules are `quest.ts` and its numbers `QUEST` (`shared/pinball.ts`), and `game.ts`
  feeds it what happens on the table and the table's clock, and does what it says. Four gods, in order Ra, Horus, Ankh
  and the Eye, each crossed off when its mode is won. The quest is the table's: it carries across balls and a restart
  (it is kept in the save file with the high scores), and the Reset clears it.
  - **A mode.** A bank matched starts its god's mode, or the next god's not done (after the Eye comes Ra); a match while
    a mode or the finale runs pays its 5,000 and starts nothing. The mode raises its toy: Sun Chase (Ra) swings the gate
    over, Falcon Strike (Horus) raises the pop-ups, The Mummy Wakes (Ankh) the mummy, and Tomb Raid (the Eye) opens the
    tomb. Its clock (`QUEST.modeSeconds` of play) runs only while a ball is in play, so the next ball picks it up.
  - **Its goal.** Sun Chase's are shots round an orbit, up one lane past its switch and down past the other's within
    `ORBIT_ROUND` (4 s; a pass up that falls back is no shot), and up the left ramp, into the dish past its switch going
    up or out through the gate's gap. Falcon Strike's are pop-ups knocked down, each once; The Mummy Wakes', hits on the
    mummy; Tomb Raid's, balls the tomb catches. Each goal hit pays `QUEST.goalPoints`, and the last pays the prize too
    (Tomb Raid's counts down with its time) to the ball that makes it, puts the toy away and crosses the god off; double
    score doubles neither. Out of time, the toy goes away and the god is left to try again.
  - **The finale**, Pharaoh's Gold, begins as the fourth god is crossed off: multiball (2 more balls, from the line and
    then the house, unless multiball is on already), the tomb open, the pop-ups and the mummy up (but the part the
    fourth god's winning hit put down, which comes back later as below). Each ball the tomb catches is a jackpot, each
    worth more than the last (`QUEST.jackpot`); a pop-up knocked down and each hit on the mummy pay goal points, and
    each comes back up `QUEST.finaleRaise` seconds of play after it goes down. It ends when multiball does: the toys go
    away, and the quest starts over with no god done.
  - **A restart** in the middle of a mode picks it up from the save, its time, its progress and its toy (a time or a
    progress past what `QUEST` allows now, since retuned, is cut to fit: the progress to one short of the goal); in the
    middle of the finale, the finale begins again with the next ball in play, since its multiball went with the balls.
  - **To the stages**, each moment is a cue (`PinballCueMsg`, never in hello): a mode started, each goal hit (where the
    ball was), the mode won with its prize or lost, a jackpot with its value (where the ball was), the finale begun and
    over. What lasts is in the state (`PinballState.quest`): the gods done, the mode with its time left at a table time
    and whether its clock runs (a stage counts it down itself, so the state isn't sent for the clock), its progress, and
    the finale's next jackpot. On the dev host, `npm run toy -- mode <god>` and `npm run toy -- finale` start them (the
    `quest` action, `{ kind: 'quest', start }`, taken only with `PINBALL_TOYS=1`).
- **Paying.** A drained ball's points make coins (`RULES.pointsPerCoin`): 70% to its owner, and 30% split equally among
  everyone who flipped it, the owner included if they flipped; what's left over goes to the owner. The high scores
  (the best 10 balls) are kept in the save file (`machine-pinball.json`).
- **Every timer runs on the table's clock** (`sim.time`), never the wall clock: the city stops stepping the machine
  while no stage shows it (`runsUnseen: false`), and the ball, its saver, the auto-save and the quest's clock all wait
  with it. The one wall-clock check is the flip words' above. The stage's titles and sounds let go of what they kept
  when the table's clock starts again (the server restarted while the page stayed open).

## The hype buttons

The streamer's seven (`src/entry.ts`) come to the game as a `machine.action` `{ kind: 'hype', id }`
(`PinballGame.action`; an id it hasn't got does nothing): **Multiball** (2 more balls in now; the ball in play stays
in play, none is held, and it ends when one ball is left; refused with no ball on the table or multiball already on),
**Ball saver** (15 s; with no ball on the table it waits for the next launch, and the panel marks it Ready), **Double
score** (30 s; a second press adds 30) and **Nudge** (jolts every ball; refused with none).

Then chat's three events (`PinballGame.startEvent`), each refused with no ball on the table, each on the table's clock
(running on between balls too), and none saved, so a restart forgets them:
- **Sandstorm** (10 s, `RULES.sandstormHype`): a gusting wind across the table (`gust`, `PinballSim.setWind`), toward a
  side picked at random. A second adds 10 s to its end, blowing the same way. The wind pushes along x only, so it never
  lifts a ball, and held balls (lock, saucer, tomb) feel none. Its strength is `RULES.wind.strength`, 20 units/s²,
  about the table's own downhill pull (21.7); it gusts between 40% and 100% of that on a 2.3 s cycle and eases in and
  out over 0.5 s. The comment on `RULES.wind` has the measured limits. A storm may hold a ball in a corner while it
  blows (about 1 drop in 80, the left inlane's corner); the stuck watcher nudges it, and no ball is left trapped once
  the storm ends (`pinball-sim-test`, and `npm run pinball-stress -- wind=on`).
- **Pharaoh's curse** (10 s, `RULES.curseHype`): chat's left and right swap where they're read (`handle`), so the
  auto-save keeps its own sides and a cursed flip still counts its viewer on the ball. A second adds 10 s.
- **Summon the mummy** (20 s from the press, `RULES.mummyHype`): the mummy rises as the quest raises it, waiting for a
  ball in its way. Its hits score 750 as ever, and its third puts it down and pays that ball 10,000
  (`RULES.summonPrize`, not doubled) with a `summonDown` cue at the ball; at its time it goes down unpaid. It is refused
  while it's up already, in The Mummy Wakes and in the finale, and allowed in Sun Chase (its hits are no Sun Chase
  shots). The Mummy Wakes or the finale starting while it's up takes it over: the summon ends unpaid and the mummy's
  hits start again from none, so the mode can still be won.

The state carries what is on (`PinballState.events`: the storm's end and direction, the curse's end, the summon's end),
so a page that opens late draws it; `pinballStateOf` gives an older server's state none. The Reset ends all three,
paying nothing. Paid support never presses them.

Chat buys them too (`multiball`, `saver`, `double`, `nudge`, `sandstorm`, `curse`, `mummy`): coin-op-city takes the
coins, then calls `PinballGame.buyHype(id, purchase)`, which does what the streamer's press does or says why not (the
city gives the coins back; a bought refusal puts nothing in the feed). Its feed line leads with the buyer, and its
moment (`PinballHypeMsg`, never in hello) names them. A waiting saver keeps its purchase, and a reset gives the coins
back, saying so only when coins really went back.

Paid support presses one for free (`PinballGame.supported`): a gift under $1 nudges, a sub or a gift up to $5 is a ball
saver, up to $20 double score, $20 and up multiball; one that can't happen gives way to the next that can. Its line
thanks the supporter, and `supportEffect` names on the city's card what it set off, once.

On the stage (`pinball-hud.ts`), each moment gets a big title at its time (MULTIBALL!, BALL SAVER!, DOUBLE SCORE!,
NUDGE!, a matched bank's: HORUS MATCHED, RA MATCHED, ANKH MATCHED, EYE MATCHED, and chat's events': SANDSTORM!,
PHARAOH'S CURSE! and THE MUMMY RISES!, each of those three naming its buyer), as do multiball from the lock, a saved
ball and a ball's result. The summoned mummy put down has MUMMY DOWN! +10,000 at its cue. While an event is on, the
status line shows a flag: SANDSTORM, CURSED or MUMMY. The quest's moments have titles too: a mode's start (SUN CHASE!,
FALCON STRIKE!, THE MUMMY WAKES!, TOMB RAID!), won (the same with its prize, +10,000, or Tomb Raid's countdown, +20,000
down to +5,000) or lost (THE SUN SETS, THE FALCON FLIES, THE MUMMY SLEEPS, THE TOMB SEALS), a jackpot (JACKPOT 50,000!,
then 25,000 more each) and the finale's start, PHARAOH'S GOLD!, which has no MULTIBALL! title with it (the finale's end
has none). One rule for every title: it is let go when it is more than 2 s late when its turn comes (the later of its
moment and the end of the title before it), or more than 6.4 s after its moment.

## The flash

Each moment on the table plays some of these on the stage: a light show over the table's lamps, a flash of the table's
picture, sparks and a shake. The show book (`src/stage/pinball-shows.ts`) says which each plays, with its values:

- A bank matched bursts its god's colour (Ra gold, Horus blue, Ankh green, Eye red) from its plaques, with a flash in
  it and sparks off each plaque. Multiball, a press's or the lock's, flashes white and chases pink twice round the
  frame's rail lights, then strobes every lamp white. The ball saver sweeps green up the table; double score strobes the
  ladders gold, with a gold flash; a nudge shakes the view 0.3 s; a payout bursts gold from where its coins burst.
- The toys' hits, from the server's cues: a pop-up knocked down bursts blue, each of the mummy's hits green and the
  tomb's catch red, each with sparks at the ball; the mummy's third hit, which puts it down, bursts wider, flashes white
  and shakes the view 0.6 s. While the tomb is open, a beam of light stands in its doorway with motes rising in it.
- The quest's moments: a mode's start sweeps the lamps up into its toy's, a goal bursts in the god's colour where it was
  hit, a mode won chases the ring and strobes, and a jackpot and the finale's start strobe gold with a gold flash and a
  shake; a jackpot rains coins (`CoinBurst.rain`) and sounds a chime. A mode lost fades every glow to dark (0.5 s),
  holds it dark 0.2 s and brings it back (0.5 s), once for each lamp.
- Chat's events, one row each: a sandstorm sweeps every lamp across x in the wind's direction, amber (0xffa030), for 1 s
  and shakes the view 0.4 s; the curse strobes every lamp red (0xff2a2a) 3 times at 2.5 a second with a red flash of
  0.5; the summoned mummy sweeps the lamps from z 0 up to its lamp, green, for 1 s; the mummy put down (`summonDown`)
  bursts gold from where it was hit (reach 4, 0.6 s) with a gold flash of 0.6, 24 sparks at the ball and a shake of
  0.5 s.
- **The look of an event** comes from the state each frame, as a mode's does. A sandstorm lays a haze on the picture,
  0xd9a35a at most 0.18, easing in and out over 0.8 real seconds (`HazeTracker`, `sand.ts`; it never changes faster
  than that, a hello or a restarted clock included, and a page's very first look shows the haze as it is, at once), and
  blows sand across in the wind's direction from a pool of its own, 240 grains (`MAX_GRAINS`), so it never takes the
  sparks'. The curse pulses the rail lights and orbit arrows red once a second, `GLOW_LIT` for half a second and dark
  for the other half, over a mode's colour while it lasts. Dark, not `GLOW_DIM`: a dim half sits just above
  `DARK_BELOW`, so the lamps would never go dark and their rise limits would hold nothing a show lit over them. The
  summoned mummy's lamp blinks green while the mummy is up, dark while it is down. The haze is not a flash; the pulse
  is lit at `GLOW_LIT`, which the 3-a-second rule never counts as a rise, and the blink stays at the blinking lamps'
  two levels.
- **The events' sounds** are synthesised, with no files: a filtered noise swell for the storm's first 2 s (`wind`) and
  a low falling sting for the curse (`curse`). The summoned mummy has no sound of its own: its bit clearing as it rises
  plays the toys' rise, and its third hit's `toyHit` cue plays a target's hit as every hit on it does, so its moment
  and `summonDown` add none (they would sound each twice).
- **The look of a mode** comes from the state each frame, so a stage opened late shows it. While a mode runs, its toy's
  lamp blinks in the god's colour and the rail lights and the orbit arrows glow steadily in it; while the finale runs,
  the ring chases gold and the rainbow in laps of 0.9 s. The state reaches the stage unguarded: `pinballStateOf` gives
  an older server's state the empty quest. All of it keeps to the 3-a-second rule below.
- **Nothing flashes more than 3 times a second**, for the viewers a flashing picture can hurt. A light rises when it
  goes above half its peak after being below 0.15 of it, and none rises again within `FLASH_GAP` (0.34 s) of its last
  rise, so never 4 times in a second. Each show keeps to that alone (a chase's lap and a strobe's flash take at least
  `FLASH_GAP`, and multiball's strobe waits 0.4 s after its chase), and `RiseLimit` (`light-show.ts`) holds every glow
  to it besides, whatever lights it. The screen flash (`screen-hits.ts`) lights only the table's picture, adding at
  most `FLASH_CAP` (0.3) of its colour, and drops a flash that would begin, or first show, less than `FLASH_GAP` after
  the last one did, at any frame rate.
- **The ball's look.** Each ball is drawn in its owner's colour (`PinballState.balls[].color`; a house ball, or a server
  too old to send one, is gold, `0xffc23a`) by `BallTrails` (`ball-trail.ts`, numbers in `BALL_LOOK`): a trail behind it
  that shows from 18 units a second at nothing and is full at 36, covers the last 0.12 s of its path as 8 points, is as
  wide as the ball at its head and tapers to nothing, and peaks at 0.55 opacity, additive; and a glow under it, a disc
  1.6 ball radii across on the playfield at 0.22 opacity, additive, on while the ball is drawn. The chrome ball also
  reflects the table: `tableEnvironment` (`table-environment.ts`) builds, once when the picture has loaded, a room with
  the picture on a floor under the ball and the neon panels above it, and swaps it in for the neon room (which stays
  with the stand-in table). **None of it flashes.** The trail follows the ball's speed smoothly and is never a
  lamp: it never goes dark to lit more than 3 times in a second, so the 3-a-second rule has nothing to count; a test
  holds that, even for a ball rattling between bumpers. The state doesn't say a ball is held, so the stage passes `held`
  as false: a held ball isn't moving, and its trail is dark.
- **Fixed pools.** The sparks are one pool of `MAX_SPARKS` (400) and the coins one of 180, made at the start: a busy
  moment takes the oldest again. Nothing is made per frame.
- **The table's clock.** The shows, the flash, the sparks, the beam and the coins run on the table's time as drawn
  (`DrawnClock`), so they stand still while the table does. The shows and the flash go by its `now`, the latest drawn
  time, which holds still where the drawn time slips back a little after a pause, since the flash's 3 a second needs a
  clock that never goes back; the sparks, the beam and the coins move on by its step, at most 0.1 s. A moment drawn
  more than 2 s after its time plays nothing, and the drawn time going back by more than a second (the server
  restarted) clears what plays and lets go of the old clock's moments, as a fresh hello does. Two guards count real
  seconds instead, from the browser's own clock (`performance.now()`): the glows' rise limits, and a last `RiseLimit`
  on the screen flash's amount, which a hello never resets. They guard what the viewers see, and a host's `dt` or the
  drawn time can run faster than real time (the city's `dt` sums to about 1.5 times it). A shake, the view's quake,
  runs on the scene's frame clock, the sum of the host's `dt`.
- The browser's console has `pinballScene`, with its `player`, `flash`, `sparks`, `beam` and `shows`, for looking
  inside. Read `pinballScene.player.running`, `pinballScene.sparks.live()`, `pinballScene.beam.level` and
  `pinballScene.flashUniforms.uFlashAmount.value`, not `flash.at()` or `player.lights()`: a look through either changes
  what it looks at, and can drop flashes or let shows go.

## The table and its picture

- **One table, one file.** `src/shared/pyramid.ts` (`PYRAMID`, which `TABLE_IN_USE` in `table.ts` is) is the table as
  data; the physics, the game, the stage and the Blender build all read it. `TABLE` is the cabinet: 16.7 long, the
  walls `wallTop` (0.7) high and the glass `glassY` (2.4) up, over the ramps and the dish; the header of `table.ts` has
  the units and axes. The snapshot header has room for 3 flippers, 2 spinners and 32 targets: table-test fails a table
  with more, and the header (`SNAP_PINBALL_HEADER`) has to grow first.
- **What `sim.ts` finds by shape.** Walls carry a `kind` (`outer`, `shooter`, `guide`, `orbit`, `pyramid`, `lane`,
  `slingback`, `island`), which the picture's build and the stage's occluders read. `sim.ts` builds the walls from
  `wallsWithTomb` (`table.ts`), which finds the `pyramid` wall by its kind to cut the tomb's doorway into it and adds
  the doorway's jambs (`tomb`); it reads no other kind. It finds the shooter lane's one-way gate as the first wall of
  two points that runs straight up and down within 1 unit left of the plunger (on this table the lane's inner wall),
  takes `walls[0]` for the outer wall in `archZ` (table-test holds it to `kind: 'outer'`), and stands a target with no
  `angle` along the wall nearest it. A table that breaks those needs `sim.ts` looked at, or `kind` read there instead.
- **The picture.** The stage draws `src/assets/pinball.png`, rendered in Blender from `TABLE_IN_USE` through the stage's
  own camera (`stageCamera`); `pinball.json` says which table (a hash of its data) and which camera. It leaves out what
  moves, and the stage draws that live over it (`pinball-parts.ts`): the balls, the three flippers, the turning plaques,
  the two drop targets, the quest's toys, both spinners, and glows over the lamps and bumpers. The toys are the three
  pop-ups and the mummy, which rise out of the picture's slots and sink back by the header's bits (the mummy rocks when
  a ball meets it), the tomb's door, which slides up into the pyramid while the tomb is open, and the diverter's gate,
  which swings over across the left ramp and back (the header's toy bits). The picture's solid shapes are in the depth
  buffer too, unseen (`pictureDepth` in `table-mesh.ts`), so a ball behind the pyramid or under the right ramp is hidden
  as the picture shows it. The pyramid there is carved for the tomb's doorway as the picture's is, so a ball the tomb
  holds is seen, and the risen door is hidden. The stand-in table in that file is only the fallback if the picture
  doesn't load.
- **After any change to the table or the camera, run `npm run picture`** (about 15 s; Blender 5.2, and Python with
  Pillow and numpy; `blender/README.md` says the rest) **and commit the new `pinball.png` and `pinball.json`.**
  picture-test fails until you do (the picture is of another table or camera, or size), but it can't see a change to
  `blender/` itself: run `npm run picture` after one of those too.

## The kit

- `src/` imports Coin-Op City only through `@kit/...` (`kit/src/kit/`): `@kit/server`, `@kit/stage`, `@kit/panel`,
  `@kit/shared`, `@kit/manifest`, `@kit/pages`. Nothing else of the city exists here.
- **Never edit `kit/`.** It's a copy, made in coin-op-city by `npm run kit:export -- <this repo>`; `kit/KIT.json`
  says which commit. If the machine needs something the kit hasn't got, that's a change to coin-op-city first, then a
  new export.

## How a version reaches streamers

The owner imports it into coin-op-city (`npm run machine:import -- pinball <this repo>`, which refuses uncommitted
changes, reads each file of `src/` from the commit (the picture and the plaques are in `src/assets/`, so they go with
it), checksums it, and checks it typechecks and passes coin-op-city's tests). Nothing here reaches a streamer until
then. The pinball is released (`src/entry.ts` says `release: 'released'`): streamers get it with the next app release,
on its own plan or All machines, as the claw.

## Standing rules

- Everything runs on this PC; no cloud services. The image service on 127.0.0.1:7422 is StreamFighter's:
  `blender/gen_art.py` calls it to make any missing art, and nothing here ever starts, stops or restarts it.
- The owner's untracked files (`ChatGPT Image *.png`, `output/`, `tmp/`) are never edited or committed, and nor is
  `spike/` (the Blender spike that proved the table), which is deleted only if the owner says so. Stage files by name.
