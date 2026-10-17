# PinballMachine

The pinball machine, Coin-Op City's pinball table, as its own project: a streamer's chat puts balls in a line
(`ball`) and flips the flippers together (`left`, `right`), and a drained ball pays its owner and everyone who flipped it.
It is in development: it plays on a stand-in table until the owner's picture comes (the plan's Task 8).

```sh
npm install
npm run dev           # the stand-in host: http://localhost:7841/stage.html and /panel.html
npm test              # contract-test, table-test, pinball-sim-test, pinball-test, pinball-hype-test,
                      # pinball-header-test, pinball-hud-test, pinball-sounds-test
npm run typecheck
npm run pinball-play  # plays unattended balls and prints what a ball scores and pays (balls=N, seed=N)
```

- `src/` is the machine (the game and its Rapier physics in `src/server/`, the table and the rules in `src/shared/`,
  the scene, scoreboard and sounds in `src/stage/`, the card in `src/panel/`), and `tests/` its tests.
- The control panel shows the pinball's card (the line, with a Remove button each), its four hype buttons and its
  Reset (`src/panel.ts`; the buttons are listed in `src/entry.ts`, and the game plays them in `PinballGame.action`):
  Multiball (2 more balls in now), Ball saver (15 s), Double score (30 s) and Nudge. The Reset clears the table and the
  line; nobody is paid for the balls taken away.
- Chat buys the hype buttons too, with coins: `!multiball`, `!saver`, `!double` and `!nudge` (each sale is in
  `src/entry.ts`). Coin-Op City takes the coins, then `PinballGame.buyHype` presses the button for the buyer, or says
  why not, and the city gives the coins back.
- Subs and gifts press one for free, by their size: under $1 a nudge, a sub or up to $5 a ball saver, up to $20 double
  score, $20 and up multiball (`PinballGame.supported`). The city's support card names what it set off.
- `kit/` is Coin-Op City's kit, copied in by coin-op-city's `npm run kit:export`. Don't edit it.
- The design and the plan are in coin-op-city's `docs/superpowers/`. A version reaches streamers when the owner imports
  it into coin-op-city with `npm run machine:import` and releases the app. Agents: start with `CLAUDE.md`.
