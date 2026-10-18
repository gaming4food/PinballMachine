# The live plaques' pictures for the stage (src/assets/plaques): the emblems its flip plaques and drop targets carry
# (build_table.py's EMBLEMS, and the sun disc on every flip plaque's back; src/stage/pinball-parts.ts imports them),
# made from the art in blender/art at 256 x 256. A plaque is about 25 px wide on the stage, and the art's 768 x 768 cost
# every page about 3 MB. tests/pinball-parts-test.ts checks the set and the size.
# Usage: python -I blender/plaques.py blender/art src/assets/plaques
import os
import sys

from PIL import Image

NAMES = ['falconplaque-62', 'falconplaque-31', 'ankh-31', 'eye-22', 'scarab-62', 'sundisc-14']
SIZE = 256

if len(sys.argv) != 3:
    sys.exit('usage: python -I blender/plaques.py <art dir> <out dir>')
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for name in NAMES:
    path = os.path.join(out, name + '.png')
    Image.open(os.path.join(src, name + '.png')).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS).save(path, optimize=True)
    print('wrote', path, os.path.getsize(path), 'bytes')
