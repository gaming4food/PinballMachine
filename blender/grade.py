"""The render's grade (from the Blender spike), two ways at once. AgX turns bright amber lamps toward cream, and one
saturation boost for every warm tone made the gold orange; the lamps and the metal sit at different hues (the lamps
about 31 degrees, the gold 36 to 38), so they are graded apart: amber pushed toward full saturation, gold drawn toward
0.74. Warm hues also turn about 6 degrees toward yellow (the printed gold reads yellow-brass, the inserts bright yellow
lamps), the classes still judged on the hue before the turn. Blues and darks are untouched; the alpha is kept.
Usage: python grade.py in.png out.png [turn degrees, default 6]"""
import sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
turn = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0
im = Image.open(src); alpha = im.getchannel('A') if 'A' in im.getbands() else None
hsv = np.asarray(im.convert('RGB').convert('HSV'), np.float32) / 255
h, s, v = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)
warm = smooth(0.45, 0.7, v) * smooth(0.12, 0.25, s)
amber = smooth(8, 14, h) * (1 - smooth(32, 35, h)) * warm
gold = smooth(32, 35, h) * (1 - smooth(55, 62, h)) * warm
s2 = s + amber * (1 - s) * 0.8 + gold * (0.74 - s) * 0.6
hsv[..., 1] = np.clip(s2, 0, 1)
warm_hue = smooth(12, 20, h) * (1 - smooth(56, 64, h)) * smooth(0.25, 0.45, v) * smooth(0.1, 0.2, s)
hsv[..., 0] = (h + turn * warm_hue) / 360
hsv[..., 2] = np.clip(v * (1 + 0.06 * amber), 0, 1)
out = Image.fromarray((np.clip(hsv, 0, 1) * 255).astype(np.uint8), 'HSV').convert('RGB')
if alpha is not None:
    out.putalpha(alpha)
out.save(dst)
