"""The art pieces the Blender build (build_table.py) and the compositor (compose_art.py) load, made by the local FLUX
schnell image service (http://127.0.0.1:7422/generate, StreamFighter's: this only calls it, it never starts or stops
it). The job tables of the Blender spike's rounds, merged: each piece with its prompt, seed, size and kind ('raw' a
flat picture, 'sprite' a cutout with its background taken away). A piece that is already there is skipped, so this
makes only what is missing.
Usage: python -I gen_art.py <art dir>   (blender/art)"""
import json, sys, time, urllib.request
from pathlib import Path

OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)

# Round 1.
FLAT1 = ('Flat printed artwork seen straight from above like a scan, no perspective, no 3D objects, no frame, no text. '
         'Deep lapis lazuli blue background with fine gold flecks, ornate gold leaf ancient Egyptian illustration, crisp gold '
         'linework, rich detail, museum quality. ')
# Rounds 3 and 4.
FLAT = ('Flat printed artwork seen straight from above like a scan, no perspective, no 3D, no frame, no text. Deep lapis '
        'lazuli blue background, ornate gold leaf ancient Egyptian illustration, crisp gold linework, museum quality. ')
PLAQUE = ('Flat square emblem plaque seen straight on: a gold {} symbol inlaid in deep sapphire blue enamel, thin gold '
          'border, glossy, centered, symmetrical, crisp detail, no text.')
PANEL = ('Flat printed panel seen straight on like a scan, no perspective, no text, tall vertical rectangle: a polished gold '
         'leaf panel with a thick gold border, three tall vertical columns of crisp deep blue Egyptian hieroglyphs in '
         'cartouche bands, a standing {} figure in the middle column, symmetrical, high contrast gold and lapis blue.')

# name: (seed, kind, width, height, prompt)
JOBS = {
    # Round 1: the stone and the big flat pieces.
    'lapis': (101, 'raw', 768, 768, 'Flat seamless texture of polished lapis lazuli stone, deep royal blue with fine golden pyrite flecks and subtle white veins, evenly lit, no objects, no pattern repeats, no border.'),
    'sun': (202, 'raw', 768, 768, FLAT1 + 'Centered: a radiant golden sun disc with long straight rays fanning out above three golden pyramids on a horizon line, palm trees at both sides, symmetrical.'),
    'glyphs': (101, 'raw', 768, 768, FLAT1 + 'Rows of gold Egyptian hieroglyphs inside rectangular gold cartouche frames: ankh, eye of Horus, scarab, falcon, feathers, evenly spaced in columns, filling the whole image.'),
    # Round 2: emblems and statue cutouts.
    'eye': (11, 'raw', 768, 768, 'Flat round emblem seen straight from above: a gold eye of Horus inlaid in a deep sapphire blue enamel disc, '
                                 'thin gold ring border, glossy, centered, filling the image, symmetrical, crisp detail, no text, no background outside the disc.'),
    'eye-22': (22, 'raw', 768, 768, 'Flat round emblem seen straight from above: a gold eye of Horus inlaid in a deep sapphire blue enamel disc, '
                                    'thin gold ring border, glossy, centered, filling the image, symmetrical, crisp detail, no text, no background outside the disc.'),
    'falcon': (11, 'raw', 768, 768, 'Flat printed artwork seen straight from above: a gold Horus falcon with outstretched wings on deep lapis blue enamel, '
                                    'gold leaf linework, Egyptian style, centered, crisp detail, no text, no frame.'),
    'sphinx': (11, 'sprite', 768, 768, 'Photorealistic polished gold statue of the Great Sphinx lying down, three-quarter front view from slightly above, '
                                       'museum miniature, detailed sculpted face and nemes headdress, studio lighting, isolated, plain background.'),
    'anubis_statue': (11, 'sprite', 768, 768, 'Photorealistic polished gold statue of Anubis the jackal god seated upright on a black pedestal, front view from '
                                              'slightly above, museum miniature, detailed, studio lighting, isolated, plain background.'),
    # Round 3: plaques, figures, the sandstone and the frieze.
    'ankh': (31, 'raw', 768, 768, PLAQUE.format('ankh')),
    'ankh-62': (62, 'raw', 768, 768, PLAQUE.format('ankh')),
    'scarab': (62, 'raw', 768, 768, PLAQUE.format('scarab beetle')),
    'falconplaque': (31, 'raw', 768, 768, PLAQUE.format('Horus falcon')),
    'falconplaque-62': (62, 'raw', 768, 768, PLAQUE.format('Horus falcon')),
    'god': (62, 'raw', 768, 768, FLAT + 'A tall standing Egyptian god figure in profile facing right, falcon-headed Horus holding a staff, full body, centered.'),
    'wingedscarab': (31, 'raw', 768, 768, FLAT + 'A golden winged scarab with long outstretched feathered wings spanning the whole width, holding a blue sun disc, symmetrical, centered.'),
    'sandstone': (31, 'raw', 768, 768, 'Flat seamless texture, seen straight on: weathered golden sandstone blocks carved with rows of Egyptian hieroglyphs, evenly lit, no shadows from outside, no objects, fills the image.'),
    'frieze': (31, 'raw', 768, 768, FLAT + 'A wide frieze: a reclining Anubis jackal at each end facing the middle, a winged sun disc in the center, rows of hieroglyphs between, symmetrical.'),
    'frieze-62': (62, 'raw', 768, 768, FLAT + 'A wide frieze: a reclining Anubis jackal at each end facing the middle, a winged sun disc in the center, rows of hieroglyphs between, symmetrical.'),
    # Round 4: the hieroglyph wall, the processional figures, the pylon and the seated pharaoh.
    'glyphwall': (41, 'raw', 768, 768, 'Flat seamless pattern seen straight on: dense rows and columns of small gold leaf Egyptian hieroglyphs on deep lapis lazuli blue, evenly spaced, fills the whole image edge to edge, no border, no large figures.'),
    'isis': (82, 'raw', 768, 768, FLAT + 'The winged goddess Isis kneeling in profile facing right, wings spread wide, full figure, centered.'),
    'pharaoh_walk': (41, 'raw', 768, 768, FLAT + 'A pharaoh walking in profile facing right wearing a tall crown and kilt, holding a crook, full body, centered.'),
    'anubis_stand': (41, 'raw', 768, 768, FLAT + 'Anubis the jackal-headed god standing in profile facing right holding a was sceptre, full body, centered.'),
    'pylon': (41, 'sprite', 768, 768, 'Photorealistic miniature ancient Egyptian temple pylon gateway in polished gold and sandstone, front view, two massive sloped towers carved with hieroglyphs either side of a doorway, low and wide, isolated, plain background.'),
    'seated': (41, 'sprite', 768, 768, 'Photorealistic small polished gold statue of a seated pharaoh on a throne, front view, hands on knees, nemes headdress, museum miniature, isolated, plain background.'),
    # Round 12: the gold hieroglyph panels either side of the pyramid.
    'panel_left': (24, 'raw', 384, 768, PANEL.format('Anubis')),
    'panel_right': (24, 'raw', 384, 768, PANEL.format('Isis')),
    # Round 13: the desert horizon band behind the pyramid.
    'horizon': (39, 'raw', 768, 256, 'Flat printed artwork seen straight on like a scan, no perspective, no text, wide horizontal band: an ancient '
                                     'Egyptian desert horizon in polished gold leaf on deep lapis lazuli blue, a row of three gold pyramids of '
                                     'different sizes, tall gold palm trees between them, a gold ground line with small dunes, crisp gold linework, '
                                     'symmetrical, high contrast.'),
    # Round 14: the flip plaques' back face, what each turns to when hit.
    'sundisc': (14, 'raw', 768, 768, 'Flat square emblem plaque seen straight on: a glowing gold winged sun disc, the disc bright polished gold with '
                                     'rays, outstretched gold feathered wings, inlaid in deep sapphire blue enamel, thin gold border, glossy, centered, '
                                     'symmetrical, crisp detail, no text.'),
    # Round 15: the face of the quest's mummy, the gold sarcophagus box that rises out of the floor. Its face is nearly
    # square (0.8 across, 0.95 tall) and a few dozen pixels on the stage, so the lid's upper half fills the picture,
    # where a whole lid would be a thin strip: what came is the gold mask, its striped headdress and its lapis collar,
    # which read at that size.
    'mummy': (15, 'raw', 768, 768, 'Flat artwork seen straight on like a scan, no perspective, no text: the front view of the upper half of a gold '
                                   'Egyptian sarcophagus lid, a calm golden pharaoh face mask with a striped gold and lapis nemes headdress, arms '
                                   'crossed on the chest holding a crook and flail, a broad jewelled collar, inlaid with deep lapis lazuli blue, '
                                   'polished gold leaf, centered, symmetrical, filling the image, deep sapphire blue background, crisp detail.'),
}

for key, (seed, kind, width, height, prompt) in JOBS.items():
    assert len(prompt) <= 600, (key, len(prompt))
    name = key.split('-')[0]  # a second seed of a piece has its own key ('eye-22')
    path = OUT / f'{name}-{seed}.png'
    if path.exists():
        print('have', path.name); continue
    t = time.monotonic()
    req = urllib.request.Request('http://127.0.0.1:7422/generate', data=json.dumps(
        dict(prompt=prompt, width=width, height=height, steps=4, seed=seed, output_kind=kind)).encode(),
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=900) as r:
        path.write_bytes(r.read())
    print(f'saved {path.name} in {time.monotonic() - t:.1f}s', flush=True)
