# PinballMachine

The pinball machine, Coin-Op City's pinball table, as its own project: a streamer's chat puts balls in a line
(`ball`) and flips the flippers together (`left`, `right`), and a drained ball pays its owner and everyone who flipped it.
It is in development: an empty pinball so far, with the machine contract kept.

```sh
npm install
npm run dev        # the stand-in host: http://localhost:7841/stage.html and /panel.html
npm test           # contract-test
npm run typecheck
```

- `kit/` is Coin-Op City's kit, copied in by coin-op-city's `npm run kit:export`. Don't edit it.
- The design and the plan are in coin-op-city's `docs/superpowers/`. Agents: start with `CLAUDE.md`.
