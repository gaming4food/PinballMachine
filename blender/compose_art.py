"""The printed art for the Blender build (from the Blender spike): the playfield, the apron and the cabinet's front
panel, composited from the generated pieces in the art folder (blender/art, made by gen_art.py) and placed by table
units. Writes playfield-art13.png, apron-art13.png and front-art13.png, which build_table.py loads from blender/out.
Usage: python compose_art.py <art dir> <out dir>"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps

ART = Path(sys.argv[1]); OUT = Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
PPU = 140
X0, X1, Y0, Y1 = -5.0, 5.0, -0.5, 17.3  # layout5: no apron, 16.7 long
W, H = int((X1 - X0) * PPU), int((Y1 - Y0) * PPU)

def load(name):
    return np.asarray(Image.open(ART / name).convert('RGB'), np.float32) / 255

def mirrored_tile(tex, w, h):
    t = np.concatenate([tex, tex[:, ::-1]], 1)
    t = np.concatenate([t, t[::-1]], 0)
    return np.tile(t, (h // t.shape[0] + 1, w // t.shape[1] + 1, 1))[:h, :w]

lapis = np.asarray(Image.open(ART / 'lapis-101.png').convert('RGB').resize((1100, 1100), Image.LANCZOS), np.float32) / 255
# The white veins go (the review: they read as marble cracks): anything pale is pulled to the stone's own blue.
_vein = np.clip((lapis.min(-1, keepdims=True) - 0.18) * 5, 0, 1)
lapis = lapis * (1 - _vein) + lapis.reshape(-1, 3).mean(0) * _vein
# Brighter, more saturated royal blue.
lapis = np.clip(lapis * np.array([0.85, 1.05, 1.35]) + np.array([0.0, 0.01, 0.04]), 0, 1)
lapis_mean = (lapis * 0.9).reshape(-1, 3).mean(0)

def goldness(img):
    return np.clip(((img[..., 0] + img[..., 1]) / 2 - img[..., 2] - 0.05) * 4, 0, 1)

GOLD_ONLY = False

def place(tgt, ox, oy, img, cx, cy, width, height=None, feather=0.18, crop=None, flip=False, fade=1.0):
    pil = Image.fromarray((img * 255).astype(np.uint8))
    if crop:
        pil = pil.crop(crop)
    if flip:
        pil = ImageOps.mirror(pil)
    height = height or width * pil.height / pil.width
    pw, ph = int(width * PPU), int(height * PPU)
    a = np.asarray(pil.resize((pw, ph), Image.LANCZOS), np.float32) / 255
    border = np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3), a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)])
    g = goldness(a)[..., None]
    a = a + (lapis_mean - np.median(border, 0)) * (1 - g)
    yy, xx = np.mgrid[0:ph, 0:pw]
    edge = np.minimum(np.minimum(xx, pw - 1 - xx) / (pw * feather), np.minimum(yy, ph - 1 - yy) / (ph * feather))
    alpha = np.clip(edge, 0, 1); alpha = alpha * alpha * (3 - 2 * alpha)
    if GOLD_ONLY:
        # Only the piece's gold comes through: its plain background drops away and the glyph field shows round it.
        alpha = (np.clip(g[..., 0] * 1.6, 0, 1) * np.clip(edge * 4, 0, 1) * fade)[..., None]
    else:
        alpha = (np.maximum(alpha, g[..., 0] * np.clip(edge * 3, 0, 1)) * fade)[..., None]
    left, top = int((cx - width / 2 - ox) * PPU), int((oy - (cy + height / 2)) * PPU)
    x0, y0 = max(left, 0), max(top, 0)
    x1, y1 = min(left + pw, tgt.shape[1]), min(top + ph, tgt.shape[0])
    if x1 <= x0 or y1 <= y0:
        return
    al = alpha[y0 - top:y1 - top, x0 - left:x1 - left]
    tgt[y0:y1, x0:x1] = tgt[y0:y1, x0:x1] * (1 - al) + a[y0 - top:y1 - top, x0 - left:x1 - left] * al

def warm_gold(img):
    g = goldness(img)[..., None]
    amber = np.clip(img * np.array([1.12, 0.92, 0.55]) + np.array([0.06, 0.02, 0.0]), 0, 1)
    return img * (1 - g) + amber * g

def save(img, name):
    img = warm_gold(img)
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(OUT / name)

CX = -0.4
GOLD_ONLY = True
pf = mirrored_tile(lapis, W, H) * 0.9
# A dense field of small gold hieroglyphs over all of it, as the reference's playfield is packed edge to edge.
gw = np.asarray(Image.open(ART / 'glyphwall-41.png').convert('RGB').resize((420, 420), Image.LANCZOS), np.float32) / 255
gwt = mirrored_tile(gw, W, H)
gmask = goldness(gwt)[..., None] * 0.35
pf = pf * (1 - gmask) + gwt * gmask
P = lambda *a, **k: place(pf, X0, Y1, *a, **k)
glyphs = load('glyphs-101.png')
P(load('sun-202.png'), CX, 9.9, 6.4, feather=0.2)                       # the horizon of pyramids behind the 3D one
P(glyphs, CX, 14.45, 3.6, 1.3, feather=0.15, fade=0.85)
P(load('horizon-39.png'), CX - 0.15, 9.1, 5.4, 1.75, crop=(150, 40, 618, 196), feather=0.1)   # round 13: a desert horizon of pyramids and palms behind the 3D one, wide enough to show either side of it                    # behind the top lanes
god = load('god-62.png')
P(god, -3.1, 7.3, 1.15, 2.55, crop=(250, 180, 560, 740), feather=0.12)    # Horus left of the pyramid, Anubis right, facing it
P(load('anubis_stand-41.png'), 2.35, 7.3, 1.15, 2.55, crop=(240, 150, 560, 740), feather=0.12, flip=True)
P(load('pharaoh_walk-41.png'), -3.65, 4.3, 0.8, 1.7, crop=(260, 170, 540, 720), feather=0.12)   # in the inlane bands
P(load('pharaoh_walk-41.png'), 2.75, 4.3, 0.8, 1.7, crop=(260, 170, 540, 720), feather=0.12, flip=True)
P(load('isis-82.png'), CX, 13.32, 2.1, 0.66, crop=(60, 150, 708, 520), feather=0.1)             # wings spread over the bumpers
P(load('wingedscarab-31.png'), CX, 1.3, 4.0, 1.6, crop=(40, 150, 728, 560), feather=0.12)
P(glyphs, -4.35, 4.0, 0.85, 3.6, crop=(8, 0, 160, 768), feather=0.08)   # the sealed left outlane
P(glyphs, -2.35, 6.0, 0.7, 2.6, crop=(160, 0, 310, 768), feather=0.08)     # cartouche columns by the pyramid
P(glyphs, 1.55, 6.0, 0.7, 2.6, crop=(460, 0, 610, 768), feather=0.08)
frieze_ = load('frieze-62.png')
P(frieze_, -2.55, 0.45, 2.7, 1.15, crop=(0, 250, 330, 470), feather=0.1)                # a reclining Anubis each side of the drain
P(frieze_, 1.75, 0.45, 2.7, 1.15, crop=(438, 250, 768, 470), feather=0.1)
save(pf, 'playfield-art13.png')

GOLD_ONLY = False
frieze = load('frieze-62.png')
AW, AH = 8.6, 1.25
apron = mirrored_tile(lapis, int(AW * PPU), int(AH * PPU)) * 0.85
place(apron, -AW / 2, AH / 2, frieze, 0, 0, AW, AH, crop=(0, 250, 768, 610), feather=0.06)
save(apron, 'apron-art13.png')

front = load('frieze-31.png')
FW, FH = 11.7, 3.0
panel = mirrored_tile(lapis, int(FW * PPU), int(FH * PPU)) * 0.85
place(panel, -FW / 2, FH / 2, front, -3.4, 0, 4.6, 2.6, crop=(0, 180, 400, 640), feather=0.08)
place(panel, -FW / 2, FH / 2, front, 3.4, 0, 4.6, 2.6, crop=(368, 180, 768, 640), feather=0.08)
save(panel, 'front-art13.png')
print('ok', W, H)

