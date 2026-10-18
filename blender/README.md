# The table's picture, built in Blender

The stage draws the table as one picture, `src/assets/pinball.png` (1920 × 1080, transparent round the cabinet), with
the live parts (the balls, the flippers, the flip plaques, the drop targets and the spinners) drawn over it in three.js.
The picture is rendered here, in Blender, from the table data (`TABLE_IN_USE`) and through the stage's own camera
(`stageCamera` in `src/stage/pinball.ts`), so the two line up. `src/assets/pinball.json` records which table and which
camera it was made from, and `npm run picture-test` fails when either has changed since.

## Rebuild it

    npm run picture

This runs, from the repo:

1. `tools/export-scene.ts`: writes `blender/scene.json` (the table, the table's place in the world, the stage's camera
   and a few probe points' pixels on the stage's frame).
2. `python -I blender/compose_art.py blender/art blender/out`, only if the composed art (`playfield-art13.png`,
   `front-art13.png`) isn't in `blender/out` yet.
3. Blender headless, as `tools/picture.ts` runs it (`--python-exit-code 1` makes a failing script a failing run):

       blender -b --factory-startup --python-exit-code 1 --python blender/build_table.py -- blender/scene.json blender/out 256 stage

   It prints `CAMERA MATCH: worst <px>` (Blender's camera against the stage's on the probe points); over 0.5 px it
   stops. A render takes about 15 s on the RTX 5080. For the stage's picture it also prints `GLOW on` (the soft glow
   round the lamps); without that line the picture is not written, because the build renders without the glow when it
   can't set it up.
4. `python -I blender/grade.py blender/out/stage.png src/assets/pinball.png` (the two-way grade, 6° warm turn), then
   the sidecar `src/assets/pinball.json`.

Rebuild it whenever the table data changes, and commit the picture with its sidecar.

`npm run picture -- hero` renders the promotional picture instead (the whole cabinet from the front at 38°, a 90 mm
lens, with the live parts) to `blender/renders/hero.png`; it leaves `src/assets` alone. `TURNED=target-ra-1,target-eye-2`
shows those flip plaques turned in it. Its flippers have the physics' shape (`FLIPPER_SHAPE` in `src/shared/table.ts`,
which `tools/export-scene.ts` writes into `blender/scene.json`), as the stage's live flippers do. Any other argument
than `hero` is refused with a usage message, so a typo can't overwrite the stage's picture.

## The live plaques' pictures

The stage draws the flip plaques and the drop targets itself, with their emblems from `src/assets/plaques`: the pieces
of `blender/art` they use, at 256 × 256 (a plaque is about 25 px wide on the stage). Make them again from the art with

    python -I blender/plaques.py blender/art src/assets/plaques

and commit them. `npm run pinball-parts-test` checks the set and the size.

## What it needs

- Blender 5.2: `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`, or wherever the `BLENDER` environment
  variable says (if Blender isn't found, `npm run picture` says to set it).
- Python 3 with Pillow and numpy, as `python`.
- The art pieces in `blender/art` (committed). `python -I blender/gen_art.py blender/art` makes any that are missing
  with the local FLUX schnell image service at `http://127.0.0.1:7422/generate` (StreamFighter's: it must already be
  running; this only calls it). It skips the pieces that are there.

`blender/scene.json`, `blender/out/` and `blender/renders/` are working files, not committed.
