# The pinball's table in Blender, built from blender/scene.json (the table in use, the same data the physics reads, and
# the stage's camera; tools/export-scene.ts writes it): an Egyptian lapis-and-gold look, the stage's exact camera put on
# it and checked against known pixels (CAMERA MATCH), rendered with Cycles. Made in the Blender spike; npm run picture
# runs it (blender/README.md).
#   stage: the stage's picture, through the stage's camera, transparent, without the live parts the stage draws over
#          it (the flippers, the flip plaques, the drop targets and the spinners): <out dir>/stage.png
#   hero:  the promotional picture, the whole cabinet from the front at HERO_ELEV, with the live parts: <out dir>/hero.png
# The only environment setting is TURNED (a demo for the hero): the ids of flip plaques shown turned, comma-separated.
# Usage:
#   blender -b --factory-startup --python-exit-code 1 --python build_table.py -- <scene.json> <out dir> <samples> stage|hero
import bpy, bmesh, json, math, sys, os, random
import numpy as np
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index('--') + 1:]
if len(argv) != 4 or argv[3] not in ('stage', 'hero'):
    sys.exit('usage: blender -b --python build_table.py -- <scene.json> <out dir> <samples> stage|hero')
SCENE_JSON, OUT, SAMPLES, WHICH = argv[0], argv[1], int(argv[2]), argv[3]
# Blender reads a relative image path against the .blend file, not the working folder: the paths are made absolute.
SCENE_JSON, OUT = os.path.abspath(SCENE_JSON), os.path.abspath(OUT)
# The look, as the spike's final render settled it.
AMBER_E = 2.6        # the amber inserts' glow
CAP_B = 0.42         # the saucer caps' blue
RING_E = 2.2         # the bumpers' glow rings
PYR_H = 2.0          # the pyramid's height
GLARE = dict(threshold=0.6, strength=1.4, saturation=2.0, size=0.25)  # the compositor's soft glow round the lamps
HERO_ELEV = 38       # the hero camera's elevation above the playfield (degrees)
HERO_LENS = 90       # and its lens (mm)
S = json.load(open(SCENE_JSON))
T = S['table']
K = S['tableConst']
random.seed(7)
np.random.seed(7)

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = scene.collection

# Table-local Blender coords: X across (table x), Y up the table (table z), Z height (table y). The parent maps those to
# Blender's world exactly as the stage maps the table into three's world (C converts three's Y-up to Blender's Z-up).
def m3(e):
    return Matrix([[e[c * 4 + r] for c in range(4)] for r in range(4)])

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
Tsw = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # (x,y,z)tbl -> (x,z,y)local; its own inverse
root = bpy.data.objects.new('Table', None)
col.objects.link(root)
root.matrix_world = C @ m3(S['tableMatrix']) @ Tsw

def link(obj):
    col.objects.link(obj)
    obj.parent = root
    return obj

# ---------------------------------------------------------------- materials
def mat(name, base, metal=0.0, rough=0.4, emit=None, estr=0.0, coat=0.0, trans=0.0, ior=1.45, aniso=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*base, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Transmission Weight'].default_value = trans
    p.inputs['IOR'].default_value = ior
    if aniso:
        p.inputs['Anisotropic'].default_value = aniso
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1)
        p.inputs['Emission Strength'].default_value = estr
    return m

GOLD = mat('gold', (1.0, 0.7, 0.14), metal=1, rough=0.16)
BRASS = mat('brass', (0.95, 0.66, 0.16), metal=1, rough=0.24, aniso=0.5)
CHROME = mat('chrome', (0.92, 0.92, 0.95), metal=1, rough=0.06)
BLACK = mat('black lacquer', (0.008, 0.008, 0.01), rough=0.22, coat=1)
RUBBER = mat('rubber', (0.9, 0.86, 0.76), rough=0.55)
BLUE_ENAMEL = mat('blue enamel', (0.02, 0.12, 0.75), rough=0.22, coat=1)
SLING_ENAMEL = mat('sling enamel', (0.02, 0.12, 0.85), rough=0.6, emit=(0.0, 0.1, 1.0), estr=1.6)
EYE_CAP = None  # made once the art folder is known (below)
BLUE_GLASS = mat('blue bumper', (0.004, 0.008, 0.12), rough=0.25, coat=0.6, emit=(0.0, 0.02, 1.0), estr=0.25)
COBALT = mat('cobalt cap', (0.002, 0.012, 0.22), rough=0.3, coat=0.35)
SAUCER = mat('saucer', (0.012, 0.016, CAP_B), rough=0.1, coat=1)
SAUCER.node_tree.nodes['Principled BSDF'].inputs['Coat Roughness'].default_value = 0.02
BLACK_MATTE = mat('matte black', (0.01, 0.008, 0.006), rough=0.6)
BEZEL = mat('insert bezel', (0.015, 0.012, 0.01), rough=0.35)
GLOW_RING = mat('bumper glow', (0.01, 0.04, 1.0), rough=0.3, emit=(0.0, 0.03, 1.0), estr=RING_E)
# The capstone: satin gold with a faint warm glow (mirror gold facing straight up showed the black sky).
CAP_GOLD = mat('capstone gold', (1.0, 0.62, 0.2), metal=1, rough=0.32, emit=(1.0, 0.6, 0.2), estr=0.25)
GOLD_FLOOR = mat('gold channel', (1.0, 0.72, 0.18), metal=1, rough=0.12, aniso=0.6)
STEEL = mat('brushed steel', (0.8, 0.8, 0.83), metal=1, rough=0.28, aniso=0.4)
CREAM = mat('flipper rubber', (0.92, 0.86, 0.72), rough=0.35, coat=0.6)
def lens_material(name, core, edge, strength):
    """A lit insert lens: hottest and palest at its centre, its colour deepening to the edge, under a clear coat. The
    centre is the middle of the object's own bounds (Generated coordinates), in the playfield's plane."""
    m = mat(name, (0.05, 0.02, 0.0), rough=0.3, coat=1)
    N, L = m.node_tree.nodes, m.node_tree.links
    p = N['Principled BSDF']; p.inputs['Coat Roughness'].default_value = 0.03
    tc = N.new('ShaderNodeTexCoord')
    sub = N.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = (0.5, 0.5, 0.5)
    mul = N.new('ShaderNodeVectorMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = (2.0, 2.0, 0.0)
    ln = N.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'
    L.new(tc.outputs['Generated'], sub.inputs[0]); L.new(sub.outputs[0], mul.inputs[0]); L.new(mul.outputs[0], ln.inputs[0])
    g = N.new('ShaderNodeMapRange'); g.inputs['From Min'].default_value = 1.0; g.inputs['From Max'].default_value = 0.0
    L.new(ln.outputs['Value'], g.inputs['Value'])  # 1 at the centre, 0 at the edge
    mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    sock = lambda socks, nm: next(s_ for s_ in socks if s_.name == nm and s_.type == 'RGBA')
    g2 = N.new('ShaderNodeMath'); g2.operation = 'POWER'; g2.inputs[1].default_value = 1.2
    L.new(g.outputs['Result'], g2.inputs[0])
    L.new(g2.outputs[0], mix.inputs['Factor'])  # the pale core only right at the centre
    sock(mix.inputs, 'A').default_value = (*edge, 1); sock(mix.inputs, 'B').default_value = (*core, 1)
    L.new(sock(mix.outputs, 'Result'), p.inputs['Emission Color'])
    st = N.new('ShaderNodeMapRange'); st.inputs['To Min'].default_value = strength * 0.35; st.inputs['To Max'].default_value = strength * 2.4
    L.new(g2.outputs[0], st.inputs['Value']); L.new(st.outputs['Result'], p.inputs['Emission Strength'])
    return m

AMBER_LAMP = lens_material('amber insert', (1.0, 0.86, 0.32), (1.0, 0.34, 0.0), AMBER_E)
BLUE_LAMP = mat('blue insert', (0.02, 0.15, 1.0), rough=0.2, coat=0.3, emit=(0.0, 0.1, 1.0), estr=6)
BLUE_RING = mat('bumper ring', (0.01, 0.04, 0.8), rough=0.3, emit=(0.0, 0.04, 1.0), estr=1.3)
DARK_HOLE = mat('hole', (0.0, 0.0, 0.0), rough=0.9)

# The playfield: lapis lazuli (two blues in noise, with gold flecks) under a clear coat, and gold artwork painted from a
# mask made below.
X0, X1, Y0, Y1 = -5.0, 5.0, -0.5, 17.3  # layout5: no apron, 16.7 long

ART_DIR = os.path.join(os.path.dirname(SCENE_JSON), 'out')

def printed_material(name, art_path, mask_img=None, glow=0.0):
    """A printed, clear-coated surface: the generated artwork's colours, its gold read as gold leaf (three-quarters
    metal, satin) by how much more red-yellow than blue it is, plus the procedural gold linework from `mask_img`."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    p = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord')
    art = N.new('ShaderNodeTexImage'); art.image = bpy.data.images.load(art_path); art.interpolation = 'Cubic'
    L.new(tc.outputs['UV'], art.inputs['Vector'])
    sep = N.new('ShaderNodeSeparateColor'); L.new(art.outputs['Color'], sep.inputs['Color'])
    rg = N.new('ShaderNodeMath'); rg.operation = 'ADD'; L.new(sep.outputs['Red'], rg.inputs[0]); L.new(sep.outputs['Green'], rg.inputs[1])
    half = N.new('ShaderNodeMath'); half.operation = 'MULTIPLY'; half.inputs[1].default_value = 0.5; L.new(rg.outputs[0], half.inputs[0])
    warm = N.new('ShaderNodeMath'); warm.operation = 'SUBTRACT'; L.new(half.outputs[0], warm.inputs[0]); L.new(sep.outputs['Blue'], warm.inputs[1])
    gold = N.new('ShaderNodeMapRange'); gold.inputs['From Min'].default_value = 0.05; gold.inputs['From Max'].default_value = 0.3
    L.new(warm.outputs[0], gold.inputs['Value'])
    color_out = art.outputs['Color']
    gold_out = gold.outputs['Result']
    if mask_img is not None:
        mk = N.new('ShaderNodeTexImage'); mk.image = mask_img; mk.interpolation = 'Cubic'
        L.new(tc.outputs['UV'], mk.inputs['Vector'])
        mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'
        # The Mix node has a socket of each name per data type: pick the colour ones.
        sock = lambda socks, nm: next(s for s in socks if s.name == nm and s.type == 'RGBA')
        L.new(mk.outputs['Color'], mix.inputs['Factor'])
        L.new(color_out, sock(mix.inputs, 'A'))
        sock(mix.inputs, 'B').default_value = (1.0, 0.68, 0.28, 1)
        color_out = sock(mix.outputs, 'Result')
        mx = N.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'
        L.new(gold_out, mx.inputs[0]); L.new(mk.outputs['Color'], mx.inputs[1])
        gold_out = mx.outputs[0]
        bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25
        L.new(mk.outputs['Color'], bump.inputs['Height'])
        L.new(bump.outputs['Normal'], p.inputs['Normal'])
    L.new(color_out, p.inputs['Base Color'])
    leaf = N.new('ShaderNodeMath'); leaf.operation = 'MULTIPLY'; leaf.inputs[1].default_value = 0.75
    L.new(gold_out, leaf.inputs[0]); L.new(leaf.outputs[0], p.inputs['Metallic'])
    rough = N.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = 0.38; rough.inputs['To Max'].default_value = 0.3
    L.new(gold_out, rough.inputs['Value']); L.new(rough.outputs['Result'], p.inputs['Roughness'])
    p.inputs['Coat Weight'].default_value = 1.0
    p.inputs['Coat Roughness'].default_value = 0.05
    if glow:
        # Lit from beneath, as a pinball's plastics and inserts are.
        L.new(color_out, p.inputs['Emission Color'])
        p.inputs['Emission Strength'].default_value = glow
    return m

EYE_CAP = printed_material('eye of Horus cap', os.path.join(os.path.dirname(SCENE_JSON), 'art', 'eye-11.png'), glow=0.6)
FALCON = printed_material('falcon plate', os.path.join(os.path.dirname(SCENE_JSON), 'art', 'falcon-11.png'), glow=2.4)

def playfield_material(mask_img):
    m_ = printed_material('lapis playfield', os.path.join(ART_DIR, 'playfield-art13.png'), mask_img)
    p_ = m_.node_tree.nodes['Principled BSDF']
    src_ = p_.inputs['Base Color'].links[0].from_socket
    bc_ = m_.node_tree.nodes.new('ShaderNodeBrightContrast')
    bc_.inputs['Bright'].default_value = 0.12; bc_.inputs['Contrast'].default_value = 0.22
    m_.node_tree.links.new(src_, bc_.inputs['Color'])
    m_.node_tree.links.new(bc_.outputs['Color'], p_.inputs['Base Color'])
    m_.node_tree.links.new(bc_.outputs['Color'], p_.inputs['Emission Color'])
    p_.inputs['Emission Strength'].default_value = 0.35
    return m_

# ---------------------------------------------------------------- the gold artwork, painted as a mask
MW, MH = 1400, 3200
mask = np.zeros((MH, MW), np.float32)
ys, xs = np.mgrid[0:MH, 0:MW]
PX = X0 + (xs + 0.5) / MW * (X1 - X0)
PY = Y0 + (ys + 0.5) / MH * (Y1 - Y0)

def paint(cond, v=1.0):
    mask[cond] = np.maximum(mask[cond], v)

def seg_dist(ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = np.clip(((PX - ax) * dx + (PY - ay) * dy) / (dx * dx + dy * dy), 0, 1)
    return np.hypot(PX - (ax + t * dx), PY - (ay + t * dy))

CX = -0.4
# (The sun, the pyramids, the pharaoh and the hieroglyphs are in the generated artwork now: compose_art.py.)
# Borders: double gold pinstripes inside the walls.
for off in (0.18, 0.28):
    paint(np.abs(PX - (-5 + off)) < 0.02)
    paint((np.abs(PX - (4.2 - off)) < 0.02) & (PY < 10.4))
# Lane guides toward the flippers, echoing the reference's stepped bands.
for side in (-1, 1):
    for k in range(4):
        ax = CX + side * (1.2 + k * 0.18)
        paint(seg_dist(ax, 5.0, ax + side * 0.9, 2.9) < 0.018)
mask = np.clip(mask, 0, 1)
# A generated image is made again blank when it renders, so the artwork goes to a PNG and comes back as a file.
os.makedirs(OUT, exist_ok=True)
tmp = bpy.data.images.new('gold art paint', MW, MH, alpha=False, float_buffer=False)
rgba = np.stack([mask, mask, mask, np.ones_like(mask)], -1)
tmp.pixels.foreach_set(rgba.ravel())
mask_path = os.path.join(OUT, 'gold-art.png')
tmp.filepath_raw = mask_path
tmp.file_format = 'PNG'
tmp.save()
mask_img = bpy.data.images.load(mask_path)
mask_img.name = 'gold art'
mask_img.colorspace_settings.name = 'Non-Color'
print('MASK coverage', float(mask.mean()))

# ---------------------------------------------------------------- geometry helpers (table-local coords)
def mesh_obj(name, verts, faces, material, bevel=0.0, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    if smooth:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(material)
    link(ob)
    if bevel:
        md = ob.modifiers.new('bevel', 'BEVEL')
        md.width = bevel; md.segments = 3; md.harden_normals = True; md.limit_method = 'ANGLE'
    return ob

def prism(name, poly, z0, z1, material, bevel=0.0):
    n = len(poly)
    verts = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly]
    faces = [list(range(n))[::-1], list(range(n, 2 * n))]
    faces += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    return mesh_obj(name, verts, faces, material, bevel)

def wall(name, pts, thick, h, material, z0=0.0, bevel=0.015):
    # A polyline thickened both ways, mitred at the joints.
    left, right = [], []
    for i, (x, y) in enumerate(pts):
        dirs = []
        if i > 0:
            dirs.append(Vector((x - pts[i - 1][0], y - pts[i - 1][1])).normalized())
        if i < len(pts) - 1:
            dirs.append(Vector((pts[i + 1][0] - x, pts[i + 1][1] - y)).normalized())
        d = sum(dirs, Vector((0, 0))).normalized()
        nrm = Vector((-d.y, d.x))
        scale = 1.0
        if len(dirs) == 2:
            scale = 1 / max(0.35, nrm.dot(Vector((-dirs[0].y, dirs[0].x))))
        left.append((x + nrm.x * thick / 2 * scale, y + nrm.y * thick / 2 * scale))
        right.append((x - nrm.x * thick / 2 * scale, y - nrm.y * thick / 2 * scale))
    poly = left + right[::-1]
    return prism(name, poly, z0, z0 + h, material, bevel)

def cylinder(name, x, y, r, z0, z1, material, seg=48, bevel=0.0, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=z1 - z0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, y, (z0 + z1) / 2))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    if smooth:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material); link(ob)
    if bevel:
        md = ob.modifiers.new('bevel', 'BEVEL'); md.width = bevel; md.segments = 3; md.harden_normals = True; md.limit_method = 'ANGLE'
    return ob

def dome(name, x, y, r, z, h, material):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=r)
    for v in bm.verts:
        v.co.z = max(v.co.z, 0) * (h / r)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, y, z))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material); link(ob)
    return ob

def wire(name, pts, z, r, material):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for p, (x, y) in zip(sp.points, pts):
        p.co = (x, y, z, 1)
    cu.bevel_depth = r; cu.bevel_resolution = 6; cu.use_fill_caps = True
    ob = bpy.data.objects.new(name, cu); ob.data.materials.append(material); link(ob)
    return ob

def rod(name, x, y0, y1, r, z, material):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=r, radius2=r, depth=y1 - y0)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, (y0 + y1) / 2, z))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material); link(ob)

def facing_quad(name, corners, uvs, material):
    me = bpy.data.meshes.new(name); me.from_pydata(corners, [], [[0, 1, 2, 3]])
    uvl_ = me.uv_layers.new(name='UVMap')
    for li, uv in enumerate(uvs):
        uvl_.data[li].uv = uv
    ob_ = bpy.data.objects.new(name, me); ob_.data.materials.append(material); link(ob_)
    return ob_

# ---------------------------------------------------------------- the table
# Playfield (UVs span the mask's rectangle).
bm = bmesh.new()
vs = [bm.verts.new(v) for v in ((X0, Y0, 0), (X1, Y0, 0), (X1, Y1, 0), (X0, Y1, 0))]
f = bm.faces.new(vs)
uv = bm.loops.layers.uv.new()
for loop in f.loops:
    loop[uv].uv = ((loop.vert.co.x - X0) / (X1 - X0), (loop.vert.co.y - Y0) / (Y1 - Y0))
me = bpy.data.meshes.new('playfield'); bm.to_mesh(me); bm.free()
pf = bpy.data.objects.new('playfield', me); pf.data.materials.append(playfield_material(mask_img)); link(pf)
prism('playfield base', [(X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)], -0.4, -0.001, BLACK)

H = 0.42  # wall height: below the glass (TABLE.glassY 2.4)
walls = T['walls']
ACRYLIC = mat('clear acrylic', (0.92, 0.94, 1.0), rough=0.04, trans=1, ior=1.49)
def along(pts, step):
    seg = [math.dist(a, b) for a, b in zip(pts, pts[1:])]
    n_ = max(1, round(sum(seg) / step)); out_ = []
    for k_ in range(n_ + 1):
        d_ = k_ / n_ * sum(seg); i_ = 0
        while i_ < len(seg) - 1 and d_ > seg[i_]:
            d_ -= seg[i_]; i_ += 1
        f_ = d_ / seg[i_] if seg[i_] else 0
        out_.append(tuple(pts[i_][j] + (pts[i_ + 1][j] - pts[i_][j]) * f_ for j in range(len(pts[0]))))
    return out_
def twin_rails(name, pts):
    """The reference's habitrail: two slim brass tubes (the lower one at the ball's equator, so it meets what the wall
    meets) on thin brass posts with gold collars."""
    wire(name + ' rail lo', pts, 0.27, 0.032, BRASS)
    wire(name + ' rail hi', pts, 0.55, 0.032, BRASS)
    wire(name + ' rail top', pts, 0.82, 0.032, BRASS)
    for x_, y_ in along(pts, 0.75):
        cylinder(name + ' rail post', x_, y_, 0.035, 0, 0.85, BRASS, 12)
        cylinder(name + ' rail collar', x_, y_, 0.05, 0.8, 0.84, GOLD, 12)
        dome(name + ' post cap', x_, y_, 0.05, 0.85, 0.05, GOLD)
        cylinder(name + ' rail collar', x_, y_, 0.05, 0.25, 0.29, GOLD, 12)
        cylinder(name + ' rail collar', x_, y_, 0.05, 0.53, 0.57, GOLD, 12)

# The outer wall: thick gold, with a chrome wire rail along its top.
outer = walls[0]['points']
# The outer wall solid gold up the sides, and twin wire rails round the top arch (the orbits' outer side).
arch_ = [tuple(p) for p in outer if p[1] >= outer[1][1] - 0.01]
low_l = [tuple(p) for p in outer[:2]]; low_r = [tuple(p) for p in outer[-2:]]
for nm_, part_ in (('outer wall l', low_l), ('outer wall r', low_r)):
    twin_rails(nm_, part_)
twin_rails('outer', arch_)
# The fill outside the arch, up to the cabinet's edge: black, edged with gold.
FX0, FX1, FY0, FY1 = -5.75, 5.75, -0.5, 17.7
CAB_BOTTOM = -3.0  # the cabinet's underside, below the playfield
ARCH0 = outer[1][1]
arch_l = [p for p in outer if p[0] <= 0]
arch_r = [p for p in outer if p[0] >= 0]
prism('corner fill left', [(FX0, ARCH0)] + [tuple(p) for p in arch_l if p[1] >= ARCH0] + [(0, FY1), (FX0, FY1)], 0, 0.5, BLACK, 0.02)
prism('corner fill right', [tuple(p) for p in arch_r if p[1] >= ARCH0] + [(FX1, ARCH0), (FX1, FY1), (0, FY1)], 0, 0.5, BLACK, 0.02)
# The cabinet: black sides with brass caps, and the front rail.
prism('cabinet left', [(FX0, FY0), (-5.08, FY0), (-5.08, FY1), (FX0, FY1)], CAB_BOTTOM, 0.9, BLACK, 0.03)
prism('cabinet right', [(5.08, FY0), (FX1, FY0), (FX1, FY1), (5.08, FY1)], CAB_BOTTOM, 0.9, BLACK, 0.03)
prism('cabinet top', [(FX0, FY1 - 0.05), (FX1, FY1 - 0.05), (FX1, FY1 + 0.5), (FX0, FY1 + 0.5)], CAB_BOTTOM, 0.9, BLACK, 0.03)
# The side rails: black lacquer on top, with a brass lip along the inside edge, as the reference's frame.
for nm, poly in (('cap left', [(FX0 - 0.05, FY0), (-5.04, FY0), (-5.04, FY1 + 0.5), (FX0 - 0.05, FY1 + 0.5)]),
                 ('cap right', [(5.04, FY0), (FX1 + 0.05, FY0), (FX1 + 0.05, FY1 + 0.5), (5.04, FY1 + 0.5)]),
                 ('cap top', [(FX0 - 0.05, FY1 + 0.2), (FX1 + 0.05, FY1 + 0.2), (FX1 + 0.05, FY1 + 0.55), (FX0 - 0.05, FY1 + 0.55)])):
    prism(nm, poly, 0.9, 1.0, BLACK, 0.02)
for nm, poly in (('lip left', [(-5.42, FY0), (-5.04, FY0), (-5.04, FY1 + 0.2), (-5.42, FY1 + 0.2)]),
                 ('lip right', [(5.04, FY0), (5.42, FY0), (5.42, FY1 + 0.2), (5.04, FY1 + 0.2)]),
                 ('lip top', [(-5.42, FY1 + 0.2), (5.42, FY1 + 0.2), (5.42, FY1 + 0.45), (-5.42, FY1 + 0.45)])):
    prism(nm, poly, 0.9, 1.08, BLACK, 0.03)
for x_b in (-5.42, -5.04, 5.04, 5.42):
    wire('rail bead', [(x_b, FY0), (x_b, FY1 + 0.2)], 1.08, 0.03, GOLD)
wire('rail bead', [(-5.42, FY1 + 0.45), (5.42, FY1 + 0.45)], 1.08, 0.03, GOLD)
for nm, poly in (('edge left', [(FX0 - 0.06, FY0), (FX0 + 0.06, FY0), (FX0 + 0.06, FY1 + 0.5), (FX0 - 0.06, FY1 + 0.5)]),
                 ('edge right', [(FX1 - 0.06, FY0), (FX1 + 0.06, FY0), (FX1 + 0.06, FY1 + 0.5), (FX1 - 0.06, FY1 + 0.5)])):
    prism(nm, poly, 0.98, 1.06, BRASS, 0.015)
prism('front rail', [(FX0 - 0.05, FY0 - 0.45), (FX1 + 0.05, FY0 - 0.45), (FX1 + 0.05, FY0), (FX0 - 0.05, FY0)], CAB_BOTTOM, 1.0, BLACK, 0.03)
# The front panel's printed art (an Anubis each side, winged suns), the coin door in the middle, and brass trim.
fy = FY0 - 0.452
facing_quad('front art', [(FX0 + 0.05, fy, CAB_BOTTOM + 0.15), (FX1 - 0.05, fy, CAB_BOTTOM + 0.15), (FX1 - 0.05, fy, 0.45), (FX0 + 0.05, fy, 0.45)],
            [(0, 0), (1, 0), (1, 1), (0, 1)], printed_material('front art', os.path.join(ART_DIR, 'front-art13.png'), glow=0.15))
for z0_, z1_ in ((CAB_BOTTOM, CAB_BOTTOM + 0.12), (0.86, 1.0)):
    prism('front trim', [(FX0 - 0.06, FY0 - 0.5), (FX1 + 0.06, FY0 - 0.5), (FX1 + 0.06, FY0 - 0.44), (FX0 - 0.06, FY0 - 0.44)], z0_, z1_, BRASS, 0.01)
door_y = FY0 - 0.5
prism('front band', [(FX0, door_y - 0.01), (FX1, door_y - 0.01), (FX1, door_y + 0.05), (FX0, door_y + 0.05)], 0.5, 0.86, BLACK, 0.01)
prism('front band trim', [(FX0, door_y - 0.04), (FX1, door_y - 0.04), (FX1, door_y + 0.02), (FX0, door_y + 0.02)], 0.43, 0.5, GOLD, 0.01)
for x0_, x1_ in ((FX0 - 0.08, FX0 + 0.22), (FX1 - 0.22, FX1 + 0.08)):
    for y0_, y1_ in ((FY0 - 0.56, FY0 - 0.26), (FY1 + 0.25, FY1 + 0.55)):
        prism('corner post', [(x0_, y0_), (x1_, y0_), (x1_, y1_), (x0_, y1_)], CAB_BOTTOM, 1.0, GOLD, 0.03)
for x_s in (FX0 - 0.03, FX1 + 0.03):
    for z0_, z1_ in ((CAB_BOTTOM, CAB_BOTTOM + 0.14), (0.78, 0.9)):
        prism('side edging', [(x_s - 0.03, FY0 - 0.4), (x_s + 0.03, FY0 - 0.4), (x_s + 0.03, FY1 + 0.4), (x_s - 0.03, FY1 + 0.4)], z0_, z1_, GOLD, 0.01)
    for y_ in np.linspace(FY0 + 1.0, FY1 - 1.0, 7):
        rod('side screw', x_s, float(y_) - 0.03, float(y_) + 0.03, 0.06, CAB_BOTTOM + 0.07, GOLD)
prism('coin door', [(-1.25, door_y - 0.06), (0.45, door_y - 0.06), (0.45, door_y), (-1.25, door_y)], -2.55, -0.25, BLACK, 0.03)
prism('coin door frame', [(-1.32, door_y - 0.03), (0.52, door_y - 0.03), (0.52, door_y), (-1.32, door_y)], -2.62, -0.18, STEEL, 0.01)
xc_ = -0.4
SATIN = mat('satin steel', (0.8, 0.82, 0.86), metal=0.45, rough=0.3, coat=0.5)
prism('coin slot bezel', [(xc_ - 0.42, door_y - 0.14), (xc_ - 0.06, door_y - 0.14), (xc_ - 0.06, door_y - 0.06), (xc_ - 0.42, door_y - 0.06)], -1.35, -0.5, SATIN, 0.03)
prism('coin slot', [(xc_ - 0.28, door_y - 0.145), (xc_ - 0.2, door_y - 0.145), (xc_ - 0.2, door_y - 0.12), (xc_ - 0.28, door_y - 0.12)], -1.2, -0.65, DARK_HOLE)
rod('coin button', xc_ + 0.3, door_y - 0.17, door_y - 0.06, 0.11, -0.95, SATIN)
rod('coin button ring', xc_ + 0.3, door_y - 0.1, door_y - 0.06, 0.15, -0.95, STEEL)
prism('coin return', [(xc_ - 0.42, door_y - 0.16), (xc_ + 0.02, door_y - 0.16), (xc_ + 0.02, door_y - 0.06), (xc_ - 0.42, door_y - 0.06)], -2.15, -1.6, SATIN, 0.03)
prism('coin return mouth', [(xc_ - 0.34, door_y - 0.165), (xc_ - 0.06, door_y - 0.165), (xc_ - 0.06, door_y - 0.14), (xc_ - 0.34, door_y - 0.14)], -2.0, -1.85, DARK_HOLE)
for bx_, by_ in ((FX0, FY0 - 0.5), (FX1, FY0 - 0.5), (FX0, FY1 + 0.5), (FX1, FY1 + 0.5)):
    sx_ = 1 if bx_ < 0 else -1; sy_ = 1 if by_ < 5 else -1
    prism('corner bracket', [(bx_ - 0.06 * sx_, by_ - 0.06 * sy_), (bx_ + 0.7 * sx_, by_ - 0.06 * sy_), (bx_ + 0.7 * sx_, by_ + 0.18 * sy_),
                             (bx_ + 0.18 * sx_, by_ + 0.18 * sy_), (bx_ + 0.18 * sx_, by_ + 0.7 * sy_), (bx_ - 0.06 * sx_, by_ + 0.7 * sy_)][::sx_ * sy_], 1.0, 1.14, GOLD, 0.02)
for sx_, sz_ in ((-1.15, -0.35), (0.35, -0.35), (-1.15, -2.45), (0.35, -2.45)):
    rod('door screw', sx_, door_y - 0.09, door_y - 0.06, 0.045, sz_, CHROME)
prism('front rail brass', [(FX0 - 0.05, FY0 - 0.5), (FX1 + 0.05, FY0 - 0.5), (FX1 + 0.05, FY0 - 0.2), (FX0 - 0.05, FY0 - 0.2)], 1.0, 1.08, BRASS, 0.02)
for x in np.linspace(FX0 + 0.25, FX1 - 0.25, 9):
    cylinder('screw', float(x), FY0 - 0.35, 0.07, 1.08, 1.11, GOLD, 16)
for y in np.linspace(FY0 + 0.4, FY1, 12):
    for x in (FX0 + 0.33, FX1 - 0.33):
        cylinder('screw', x, float(y), 0.06, 0.9, 1.02, GOLD, 16)
# No apron (the owner's ask, 2026-10-17): the playfield runs to the front rail, and the drain hole is at the bottom.
cylinder('drain hole', CX, 0.32, 0.4, -0.05, 0.006, DARK_HOLE, 64)
cylinder('drain ring', CX, 0.32, 0.5, 0.0, 0.022, GOLD, 64, 0.01)
for k_ in range(16):
    a_ = k_ / 16 * math.tau
    prism('drain ray', [(CX + 0.52 * math.cos(a_ - 0.05), 0.32 + 0.52 * math.sin(a_ - 0.05)), (CX + 0.78 * math.cos(a_), 0.32 + 0.78 * math.sin(a_)),
                        (CX + 0.52 * math.cos(a_ + 0.05), 0.32 + 0.52 * math.sin(a_ + 0.05))], 0, 0.004, GOLD)

# Walls by kind. Each is drawn as thick as its physics (0.16), so the ball meets what it's seen to meet.
for i, w in enumerate(walls[1:], 1):
    kind = w.get('kind', 'guide')
    pts = w['points']
    if kind in ('pyramid', 'slingback'):
        continue  # the sculpted pyramid and the slingshots are drawn below
    if kind == 'orbit':
        # The orbit: a tall polished gold channel wall, a flange over it, and two chrome wire rails (a habitrail look).
        twin_rails(f'orbit {i}', pts)
        posts = [pts[0], pts[-1]]
    else:
        wall(f'{kind} {i}', pts, 0.16, H, GOLD)
        if len(pts) > 2 or abs(pts[0][1] - pts[-1][1]) > 3:
            wire(f'guide rail {i}', pts, H + 0.06, 0.025, CHROME)
        posts = [pts[0], pts[-1]]
    for k_, (x, y) in enumerate(posts):
        if y > 0.5:
            top_ = 0.66 if kind == 'orbit' else 0.5
            cylinder('post', x, y, 0.08, 0, top_, BRASS, 24)
            dome('post led', x, y, 0.075, top_, 0.08, BLUE_LAMP if k_ % 2 == 0 else AMBER_LAMP)
            cylinder('post ring', x, y, 0.1, 0.12, 0.2, RUBBER, 24)
orbit_w = next(w for w in walls if w.get('kind') == 'orbit')['points']
outer_part = [(-5, orbit_w[0][1])] + [tuple(p) for p in outer if p[1] >= ARCH0 and p[0] <= 4.2] + [(4.2, orbit_w[-1][1])]
floor_poly = outer_part + [tuple(p) for p in reversed(orbit_w)]
prism('orbit floor', floor_poly, 0.0005, 0.004, GOLD_FLOOR)
# Blue LEDs along the frame's inner brass lip, both sides, as the reference's.
for y_ in np.arange(0.4, FY1 - 1.2, 1.05):
    for x_ in (-5.12, 5.12):
        dome('frame screw', float(x_) * 5.23 / 5.12, float(y_), 0.05, 1.08, 0.03, GOLD)
        dome('rail led', float(x_) * 5.23 / 5.12, float(y_) + 0.52, 0.07, 1.08, 0.06, BLUE_LAMP)
for k_ in range(40):
    p_ = outer[0]
    # Points spaced along the outer wall, for LEDs on its top inside the playfield's edge.
    seglen = [math.dist(a, b) for a, b in zip(outer, outer[1:])]
    d_ = (k_ + 0.5) / 40 * sum(seglen); i_ = 0
    while i_ < len(seglen) - 1 and d_ > seglen[i_]:
        d_ -= seglen[i_]; i_ += 1
    f_ = d_ / seglen[i_]; a_, b_ = outer[i_], outer[i_ + 1]
    dome('wall led', a_[0] + (b_[0] - a_[0]) * f_, a_[1] + (b_[1] - a_[1]) * f_, 0.065, 0.55, 0.06, BLUE_LAMP)

# The pyramid on the playfield: carved sandstone with a gold capstone, on a black plinth with gold trim. Its footprint is
# the physics's diamond grown by the wall's half thickness (0.08), so the ball stops where it's seen to.
SAND = bpy.data.materials.new('carved sandstone'); SAND.use_nodes = True
_N, _L = SAND.node_tree.nodes, SAND.node_tree.links
_p = _N['Principled BSDF']
_tc = _N.new('ShaderNodeTexCoord')
_im = _N.new('ShaderNodeTexImage'); _im.image = bpy.data.images.load(os.path.join(os.path.dirname(SCENE_JSON), 'art', 'sandstone-31.png'))
_L.new(_tc.outputs['UV'], _im.inputs['Vector']); _L.new(_im.outputs['Color'], _p.inputs['Base Color'])
_p.inputs['Metallic'].default_value = 0.12; _p.inputs['Roughness'].default_value = 0.6
_bw = _N.new('ShaderNodeRGBToBW'); _L.new(_im.outputs['Color'], _bw.inputs['Color'])
_bump = _N.new('ShaderNodeBump'); _bump.inputs['Strength'].default_value = 1.0; _bump.inputs['Distance'].default_value = 0.05
_L.new(_bw.outputs['Val'], _bump.inputs['Height']); _L.new(_bump.outputs['Normal'], _p.inputs['Normal'])
for w in walls:
    if w.get('kind') != 'pyramid':
        continue
    corners_ = w['points'][:-1]
    pcx = sum(p[0] for p in corners_) / 4; pcy = sum(p[1] for p in corners_) / 4
    def grow(p, d):
        vx_, vy_ = p[0] - pcx, p[1] - pcy; L_ = math.hypot(vx_, vy_)
        return (pcx + vx_ * (L_ + d * math.sqrt(2)) / L_, pcy + vy_ * (L_ + d * math.sqrt(2)) / L_)
    base = [grow(p, 0.08) for p in corners_]
    prism('pyramid plinth', base, 0, 0.36, BLACK_MATTE, 0.015)
    prism('pyramid trim', [grow(p, 0.0) for p in corners_], 0.36, 0.42, GOLD, 0.01)
    PH = PYR_H; cap = 0.2  # height, and the gold capstone's share of it
    body = [grow(p, -0.05) for p in corners_]
    bm = bmesh.new(); uvp = bm.loops.layers.uv.new()
    bv = [bm.verts.new((x, y, 0.42)) for x, y in body]
    lift = [bm.verts.new((pcx + (x - pcx) * cap, pcy + (y - pcy) * cap, 0.42 + PH * (1 - cap))) for x, y in body]
    for k in range(4):
        f_ = bm.faces.new([bv[k], bv[(k + 1) % 4], lift[(k + 1) % 4], lift[k]])
        for loop, uv_ in zip(f_.loops, ((0, 0), (1, 0), (0.5 + 0.5 * cap, 1 - cap), (0.5 - 0.5 * cap, 1 - cap))):
            loop[uvp].uv = (uv_[0] * 0.9 + 0.05, uv_[1] * 0.9 + 0.05)
    bm.faces.new(bv[::-1])
    me = bpy.data.meshes.new('pyramid body'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('pyramid body', me); ob.data.materials.append(SAND); link(ob)
    md = ob.modifiers.new('bevel', 'BEVEL'); md.width = 0.02; md.segments = 2
    bm = bmesh.new()
    lv = [bm.verts.new((pcx + (x - pcx) * cap, pcy + (y - pcy) * cap, 0.42 + PH * (1 - cap))) for x, y in body]
    av = bm.verts.new((pcx, pcy, 0.42 + PH))
    for k in range(4):
        bm.faces.new([lv[k], lv[(k + 1) % 4], av])
    bm.faces.new(lv[::-1])
    me = bpy.data.meshes.new('capstone'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('capstone', me); ob.data.materials.append(CAP_GOLD); link(ob)
    for x, y in base:
        cylinder('plinth post', x, y, 0.08, 0, 0.52, BRASS, 24)
        dome('plinth led', x, y, 0.075, 0.52, 0.07, AMBER_LAMP)
    lamp = bpy.data.lights.new('pyramid glow', 'POINT'); lamp.energy = 40; lamp.color = (1.0, 0.75, 0.4)
    lo = bpy.data.objects.new('pyramid glow', lamp); lo.location = (pcx, pcy - 1.6, 1.2); link(lo)

# Pop bumpers: gold base, blue glass body that glows, gold rim and a domed glass cap with the eye of Horus inside it.
for b in T['bumpers']:
    x, y, r = b['x'], b['z'], b['radius']
    yb = b.get('y0', 0.0)
    cylinder('bumper base', x, y, r * 1.28, yb, yb + 0.05, GOLD, 64, 0.01)
    cylinder('bumper skirt', x, y, r * 1.1, yb + 0.05, yb + 0.16, GOLD, 64, 0.03)
    cylinder('bumper body', x, y, r * 0.9, yb + 0.16, yb + 0.46, BLUE_GLASS, 64)
    cylinder('bumper led ring', x, y, r * 1.16, yb + 0.12, yb + 0.16, BLUE_RING, 64)
    cylinder('bumper step', x, y, r * 1.2, yb, yb + 0.1, GOLD, 64, 0.02)
    cylinder('bumper rim', x, y, r * 1.04, yb + 0.46, yb + 0.55, GOLD, 64, 0.02)
    prof_ = [(r * 0.8, yb + 0.55), (r * 1.18, yb + 0.66), (r * 1.12, yb + 0.71), (r * 0.78, yb + 0.79), (r * 0.52, yb + 0.82)]
    seg_ = 16; vs_ = []
    for rr_, zz_ in prof_:
        for k_ in range(seg_):
            a_ = (k_ + 0.5) / seg_ * math.tau
            vs_.append((x + rr_ * math.cos(a_), y + rr_ * math.sin(a_), zz_))
    fs_ = [[i_ * seg_ + k_, i_ * seg_ + (k_ + 1) % seg_, (i_ + 1) * seg_ + (k_ + 1) % seg_, (i_ + 1) * seg_ + k_]
           for i_ in range(len(prof_) - 1) for k_ in range(seg_)]
    fs_.append([(len(prof_) - 1) * seg_ + k_ for k_ in range(seg_)])
    mesh_obj('bumper saucer', vs_, fs_, SAUCER)
    cylinder('saucer rim', x, y, r * 1.21, yb + 0.645, yb + 0.675, GOLD, 64, 0.008)
    cap = dome('bumper cap', x, y, r * 0.5, yb + 0.815, 0.05, EYE_CAP)
    uvl = cap.data.uv_layers.new(name='UVMap')
    for poly in cap.data.polygons:
        for li in poly.loop_indices:
            v = cap.data.vertices[cap.data.loops[li].vertex_index].co
            # The emblem's disc in eye-11.png is centred at (0.507, 0.5) with a radius of 0.31 of the image.
            uvl.data[li].uv = (0.507 + (v.x - x) / (r * 0.5) * 0.31, 0.5 + (v.y - y) / (r * 0.5) * 0.31)
    cylinder('bumper under-glow', x, y, r * 1.24, yb + 0.002, yb + 0.03, GLOW_RING, 64)

# The ramps and the dish, from the same data the physics runs (sim-ramps.mts): each ramp's floor polished gold, with
# solid gold sides down to the playfield and a chrome rail along the top of each; the wireform as twin chrome tubes
# below and above the ball's path; the dish a gold platform with its rim open at its gaps.
def ramp_edges(rp):
    pts = rp['path']; out = []
    for i_, (x_, z_, y_) in enumerate(pts):
        px_, pz_ = pts[max(0, i_ - 1)][:2]; nx_, nz_ = pts[min(len(pts) - 1, i_ + 1)][:2]
        dx_, dz_ = nx_ - px_, nz_ - pz_; l_ = math.hypot(dx_, dz_) or 1
        t_ = i_ / (len(pts) - 1); w_ = rp['width'] + rp.get('flare', 0) * max(0, 1 - t_ * 4) ** 2
        ox_, oz_ = (-dz_ / l_) * w_ / 2, (dx_ / l_) * w_ / 2
        out.append(((x_ + ox_, z_ + oz_), (x_ - ox_, z_ - oz_), y_))
    return out

def strip(name, a_pts, b_pts, material):
    """A quad strip between two equal-length lists of 3D points (table-local Blender coords)."""
    verts = list(a_pts) + list(b_pts); n = len(a_pts)
    faces = [[k, k + 1, n + k + 1, n + k] for k in range(n - 1)]
    return mesh_obj(name, verts, faces, material, smooth=True)

def wire3d(name, pts, r, material):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for p_, q in zip(sp.points, pts):
        p_.co = (q[0], q[1], q[2], 1)
    cu.bevel_depth = r; cu.bevel_resolution = 6; cu.use_fill_caps = True
    ob = bpy.data.objects.new(name, cu); ob.data.materials.append(material); link(ob)

for rp in T.get('ramps', []):
    E = ramp_edges(rp)
    L_ = [(l[0], l[1], y_) for l, r_, y_ in E]; R_ = [(r_[0], r_[1], y_) for l, r_, y_ in E]
    if rp.get('skirt', True):
        C_ = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2]) for a, b in zip(L_, R_)]
        def toward(P, f):
            return [(c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f, p[2]) for p, c in zip(P, C_)]
        bedL, bedR = toward(L_, 0.42), toward(R_, 0.42)
        for side, P, B in (('l', L_, bedL), ('r', R_, bedR)):
            wire3d(rp['id'] + ' bed ' + side, [(x_, y_, z_ - 0.03) for x_, y_, z_ in B], 0.032, BRASS)
            wire3d(rp['id'] + ' guide ' + side, [(x_, y_, z_ + 0.32) for x_, y_, z_ in P], 0.03, BRASS)
            strip(rp['id'] + ' acrylic ' + side, [(x_, y_, 0.0) for x_, y_, z_ in P], [(x_, y_, z_ + 0.3) for x_, y_, z_ in P], ACRYLIC)
        for k_ in range(2, len(E) - 1, 4):
            (a, b) = L_[k_], R_[k_]; (c, d_) = bedL[k_], bedR[k_]
            wire3d(rp['id'] + ' hoop', [(a[0], a[1], a[2] + 0.32), (a[0], a[1], a[2] - 0.06), (c[0], c[1], c[2] - 0.06),
                                        (d_[0], d_[1], d_[2] - 0.06), (b[0], b[1], b[2] - 0.06), (b[0], b[1], b[2] + 0.32)], 0.02, GOLD)
            if a[2] > 0.25:
                for p_ in (a, b):
                    cylinder(rp['id'] + ' post', p_[0], p_[1], 0.035, 0, p_[2] - 0.06, BRASS, 12)
    else:
        # The raised right ramp: a polished gold channel standing clear of the playfield, with low lips and a bead
        # (its physics is the same floor and rails; the review wanted a solid gold channel, as the reference's).
        strip(rp['id'] + ' floor', L_, R_, GOLD_FLOOR)
        strip(rp['id'] + ' underside', [(x_, y_, z_ - 0.05) for x_, y_, z_ in L_], [(x_, y_, z_ - 0.05) for x_, y_, z_ in R_], BRASS)
        for side, P in (('l', L_), ('r', R_)):
            strip(rp['id'] + ' lip ' + side, [(x_, y_, z_ - 0.05) for x_, y_, z_ in P], [(x_, y_, z_ + 0.3) for x_, y_, z_ in P], GOLD)
            wire3d(rp['id'] + ' bead ' + side, [(x_, y_, z_ + 0.32) for x_, y_, z_ in P], 0.05, GOLD)
for d in T.get('dishes', []):
    cylinder('dish floor', d['x'], d['z'], d['r'], d['y'] - 0.06, d['y'], GOLD_FLOOR, 64, 0.01)
    gaps = d.get('gaps', [])
    def in_gap(deg):
        return any(((deg - g0) % 360) <= ((g1 - g0) % 360) for g0, g1 in gaps)
    run = []
    for k_ in range(97):
        a_ = k_ / 96 * 360
        if in_gap(a_ % 360):
            if len(run) > 1:
                strip('dish rim', [(x_, y_, d['y']) for x_, y_ in run], [(x_, y_, d['y'] + 0.45) for x_, y_ in run], GOLD); strip('dish guard', [(x_, y_, d['y'] + 0.45) for x_, y_ in run], [(x_, y_, d['y'] + d['rail']) for x_, y_ in run], ACRYLIC)
                wire3d('dish rail', [(x_, y_, d['y'] + d['rail'] + 0.04) for x_, y_ in run], 0.03, CHROME)
            run = []
        else:
            run.append((d['x'] + d['r'] * math.cos(math.radians(a_)), d['z'] + d['r'] * math.sin(math.radians(a_))))
    if len(run) > 1:
        strip('dish rim', [(x_, y_, d['y']) for x_, y_ in run], [(x_, y_, d['y'] + 0.45) for x_, y_ in run], GOLD); strip('dish guard', [(x_, y_, d['y'] + 0.45) for x_, y_ in run], [(x_, y_, d['y'] + d['rail']) for x_, y_ in run], ACRYLIC)
        wire3d('dish rail', [(x_, y_, d['y'] + d['rail'] + 0.04) for x_, y_ in run], 0.03, CHROME)
    # Two brass posts hold it up from the outer wall's side (outside the play under it).
    for ax_, az_ in ((-4.55, 14.0), (-4.3, 15.0)):
        cylinder('dish post', ax_, az_, 0.07, 0.55, d['y'] - 0.06, BRASS, 16)

FALCON_BRIGHT = printed_material('falcon plate bright', os.path.join(os.path.dirname(SCENE_JSON), 'art', 'falcon-11.png'), glow=2.4)
_p = FALCON_BRIGHT.node_tree.nodes['Principled BSDF']
_src = _p.inputs['Base Color'].links[0].from_socket
_g = FALCON_BRIGHT.node_tree.nodes.new('ShaderNodeGamma'); _g.inputs['Gamma'].default_value = 0.55
FALCON_BRIGHT.node_tree.links.new(_src, _g.inputs['Color'])
FALCON_BRIGHT.node_tree.links.new(_g.outputs['Color'], _p.inputs['Base Color'])
FALCON_BRIGHT.node_tree.links.new(_g.outputs['Color'], _p.inputs['Emission Color'])
for img_, x0_, x1_ in (('panel_left-24.png', -2.55, -2.05), ('panel_right-24.png', 1.25, 1.75)):
    y0_, y1_ = 6.3, 7.5
    facing_quad('glyph panel', [(x0_, y0_, 0.004), (x1_, y0_, 0.004), (x1_, y1_, 0.004), (x0_, y1_, 0.004)],
                [(0, 0), (1, 0), (1, 1), (0, 1)], printed_material('glyph panel ' + img_, os.path.join(os.path.dirname(SCENE_JSON), 'art', img_), glow=0.5))
    wire('glyph panel frame', [(x0_, y0_), (x1_, y0_), (x1_, y1_), (x0_, y1_), (x0_, y0_)], 0.006, 0.025, GOLD)
# Slingshots: a blue enamel plate edged in gold, with the rubber band along the face the ball meets.
for s in T['slings']:
    (ax, ay), (bx, by) = s['a'], s['b']
    mx, my = (ax + bx) / 2, (ay + by) / 2
    d = Vector((bx - ax, by - ay)).normalized(); n = Vector((-d.y, d.x))
    if abs((mx + n.x) - CX) < abs(mx - CX):
        n = -n
    back = next((w['points'][1] for w in walls if w.get('kind') == 'slingback' and w['points'][0] == s['a']), None)
    c = tuple(back) if back else (mx + n.x * 0.3, my + n.y * 0.3)
    tri = [(ax, ay), (bx, by), c]
    prism('sling body', tri, 0, 0.38, SLING_ENAMEL, 0.02)
    wire('sling frame', tri + [tri[0]], 0.4, 0.07, GOLD)
    wire('sling base frame', tri + [tri[0]], 0.04, 0.06, GOLD)
    wire('sling mid band', tri + [tri[0]], 0.22, 0.025, GOLD)
    inset = [(px * 0.94 + (ax + bx + c[0]) / 3 * 0.06, py * 0.94 + (ay + by + c[1]) / 3 * 0.06) for px, py in tri]
    bm = bmesh.new()
    tv = [bm.verts.new((px, py, 0.385)) for px, py in inset]
    tf = bm.faces.new(tv if (inset[1][0] - inset[0][0]) * (inset[2][1] - inset[0][1]) - (inset[1][1] - inset[0][1]) * (inset[2][0] - inset[0][0]) > 0 else tv[::-1])
    uvt = bm.loops.layers.uv.new()
    xs_, ys_ = [q[0] for q in inset], [q[1] for q in inset]
    span = max(max(xs_) - min(xs_), max(ys_) - min(ys_))
    cx_, cy_ = sum(xs_) / 3, sum(ys_) / 3
    for loop in tf.loops:
        loop[uvt].uv = (0.5 + (loop.vert.co.x - cx_) / span * 1.05, 0.5 + (loop.vert.co.y - cy_) / span * 1.05)
    me = bpy.data.meshes.new('sling art'); bm.to_mesh(me); bm.free()
    so = bpy.data.objects.new('sling art', me); so.data.materials.append(FALCON_BRIGHT); link(so)
    wall('sling rubber', [(ax, ay), (bx, by)], 0.09, 0.22, RUBBER, 0.06, 0.03)
    for px, py in tri:
        cylinder('sling post', px, py, 0.07, 0, 0.5, CHROME, 24)
        dome('post led', px, py, 0.095, 0.5, 0.1, BLUE_LAMP)
    lamp = bpy.data.lights.new('sling lamp', 'POINT'); lamp.energy = 8; lamp.color = (0.4, 0.6, 1.0)
    lo = bpy.data.objects.new('sling lamp', lamp); lo.location = (mx + n.x * 0.3, my + n.y * 0.3, 0.6); link(lo)
# Standup targets: a gold-framed plaque with its emblem, standing along the wall nearest it as the physics stands it
# (0.2 thick, its width along the wall), the emblem on the side the ball comes from.
def nearest_segment(px_, py_):
    best, bd = None, 1e9
    for w in walls:
        for a_, b_ in zip(w['points'], w['points'][1:]):
            dx_, dy_ = b_[0] - a_[0], b_[1] - a_[1]
            u_ = max(0, min(1, ((px_ - a_[0]) * dx_ + (py_ - a_[1]) * dy_) / (dx_ * dx_ + dy_ * dy_)))
            d_ = math.hypot(px_ - a_[0] - u_ * dx_, py_ - a_[1] - u_ * dy_)
            if d_ < bd:
                bd, best = d_, (a_, b_, (a_[0] + u_ * dx_, a_[1] + u_ * dy_))
    return best
EMBLEMS = {'target-ankh': 'ankh-62.png', 'target-scarab': 'scarab-62.png', 'target-falcon': 'falconplaque-62.png',
           'target-ra-1': 'falconplaque-62.png', 'target-ra-2': 'falconplaque-62.png', 'target-ra-3': 'falconplaque-62.png',
           'target-horus-1': 'falconplaque-31.png', 'target-horus-2': 'falconplaque-31.png', 'target-horus-3': 'falconplaque-31.png',
           'target-eye': 'eye-22.png',
           **{f'target-ankh-{i}': 'ankh-31.png' for i in (1, 2, 3)}, **{f'target-eye-{i}': 'eye-22.png' for i in (1, 2, 3)}}
TURNED = set(filter(None, os.environ.get('TURNED', '').split(',')))
SUN_BACK = printed_material('sun disc back', os.path.join(os.path.dirname(SCENE_JSON), 'art', 'sundisc-14.png'), glow=1.4)
# The live parts: what the stage draws over the picture itself (they move), so the stage's picture leaves them out and
# the hero's has them: the targets (the flip plaques and the drop targets), the spinners and the flippers.
LIVE = []
_before = set(bpy.data.objects)
for t in T['targets']:
    x, y, w_ = t['x'], t['z'], t['width']
    if 'angle' in t:
        # A target standing at its own angle (not along a wall): its face toward the flippers.
        ux, uy = math.cos(math.radians(t['angle'])), math.sin(math.radians(t['angle']))
        nx_, ny_ = -uy, ux
        if nx_ * (CX - x) + ny_ * (2.0 - y) < 0:
            nx_, ny_ = -nx_, -ny_
    else:
        a_, b_, foot = nearest_segment(x, y)
        ux, uy = b_[0] - a_[0], b_[1] - a_[1]; ul = math.hypot(ux, uy); ux, uy = ux / ul, uy / ul
        nx_, ny_ = x - foot[0], y - foot[1]; nl = math.hypot(nx_, ny_) or 1; nx_, ny_ = nx_ / nl, ny_ / nl
    hw, ht = w_ / 2, 0.1
    quad = [(x - ux * hw - nx_ * ht, y - uy * hw - ny_ * ht), (x + ux * hw - nx_ * ht, y + uy * hw - ny_ * ht),
            (x + ux * hw + nx_ * ht, y + uy * hw + ny_ * ht), (x - ux * hw + nx_ * ht, y - uy * hw + ny_ * ht)]
    prism('target', quad, 0, 0.52, GOLD, 0.012)
    fx_, fy_ = x + nx_ * (ht + 0.003), y + ny_ * (ht + 0.003)
    m_ = printed_material(t['id'], os.path.join(os.path.dirname(SCENE_JSON), 'art', EMBLEMS.get(t['id'], 'ankh-62.png')), glow=0.5)
    if t.get('flip'):
        # A flip plaque: on a gold pivot pin; turned, its sun disc back faces the play.
        cylinder('flip pin', x, y, 0.035, 0.52, 0.64, GOLD, 16)
        dome('flip pin cap', x, y, 0.05, 0.64, 0.04, GOLD)
        bx_, by_ = x - nx_ * (ht + 0.003), y - ny_ * (ht + 0.003)
        facing_quad('target back', [(bx_ + ux * (hw - 0.04), by_ + uy * (hw - 0.04), 0.06), (bx_ - ux * (hw - 0.04), by_ - uy * (hw - 0.04), 0.06),
                                    (bx_ - ux * (hw - 0.04), by_ - uy * (hw - 0.04), 0.48), (bx_ + ux * (hw - 0.04), by_ + uy * (hw - 0.04), 0.48)],
                    [(0.16, 0.12), (0.84, 0.12), (0.84, 0.88), (0.16, 0.88)], m_ if t['id'] in TURNED else SUN_BACK)
        if t['id'] in TURNED:
            m_ = SUN_BACK
    e = hw - 0.04
    facing_quad('target emblem', [(fx_ - ux * e, fy_ - uy * e, 0.06), (fx_ + ux * e, fy_ + uy * e, 0.06),
                                  (fx_ + ux * e, fy_ + uy * e, 0.48), (fx_ - ux * e, fy_ - uy * e, 0.48)],
                [(0.16, 0.12), (0.84, 0.12), (0.84, 0.88), (0.16, 0.88)], m_)
LIVE += [ob_ for ob_ in bpy.data.objects if ob_ not in _before]
# Rollover lamps in the top lanes (their guides are walls of the layout).
for r_ in T['rollovers']:
    if r_['id'].startswith('centre-'):
        continue  # under the centre lane's own lamps
    prism('rollover lamp', [(r_['x'] - 0.17, r_['z'] - 0.2), (r_['x'] + 0.17, r_['z'] - 0.2), (r_['x'], r_['z'] + 0.2)], 0, 0.006, AMBER_LAMP)
# The spinners: a gold-framed gate with a blue plate.
_before = set(bpy.data.objects)
for sp in [T['spinner']] + T.get('spinners', []):
  for sx in (sp['x'] - sp['width'] / 2, sp['x'] + sp['width'] / 2):
    cylinder('spinner post', sx, sp['z'], 0.04, 0, 0.62, GOLD, 16)
  wire('spinner bar', [(sp['x'] - sp['width'] / 2, sp['z']), (sp['x'] + sp['width'] / 2, sp['z'])], 0.62, 0.025, GOLD)
  prism('spinner plate', [(sp['x'] - 0.38, sp['z'] - 0.02), (sp['x'] + 0.38, sp['z'] - 0.02), (sp['x'] + 0.38, sp['z'] + 0.02), (sp['x'] - 0.38, sp['z'] + 0.02)], 0.2, 0.58, BLUE_ENAMEL, 0.005)
LIVE += [ob_ for ob_ in bpy.data.objects if ob_ not in _before]
# The saucers: a dark hole in a gold ring, four amber lamps round it.
for sc in T.get('saucers', []):
    if sc['id'].startswith('magnet'):
        # The magnet under the lane: an Eye of Ra disc in a gold ring, amber lamps either side (the ways it flings).
        cylinder('magnet ring', sc['x'], sc['z'], 0.44, 0, 0.012, GOLD, 64, 0.004)
        cylinder('magnet bezel', sc['x'], sc['z'], 0.38, 0, 0.014, BEZEL, 64)
        bm_ = bmesh.new(); bmesh.ops.create_circle(bm_, cap_ends=True, segments=48, radius=0.33)
        bmesh.ops.translate(bm_, verts=bm_.verts, vec=(sc['x'], sc['z'], 0.016))
        me_ = bpy.data.meshes.new('magnet eye'); bm_.to_mesh(me_); bm_.free()
        uv_ = me_.uv_layers.new(name='UVMap')
        for poly in me_.polygons:
            for li in poly.loop_indices:
                v = me_.vertices[me_.loops[li].vertex_index].co
                uv_.data[li].uv = (0.507 + (v.x - sc['x']) / 0.33 * 0.31, 0.5 + (v.y - sc['z']) / 0.33 * 0.31)
        ob_ = bpy.data.objects.new('magnet eye', me_); ob_.data.materials.append(printed_material('magnet eye', os.path.join(os.path.dirname(SCENE_JSON), 'art', 'eye-11.png'), glow=2.5)); link(ob_)
        for sx_ in (-1, 1):
            prism('magnet arrow', [(sc['x'] + sx_ * 0.55, sc['z'] - 0.12), (sc['x'] + sx_ * 0.55, sc['z'] + 0.12), (sc['x'] + sx_ * 0.75, sc['z'])], 0, 0.006, AMBER_LAMP)
        continue
    cylinder('saucer ring', sc['x'], sc['z'], 0.44, 0, 0.03, GOLD, 64, 0.01)
    cylinder('saucer bezel', sc['x'], sc['z'], 0.36, 0, 0.034, BEZEL, 64)
    cylinder('saucer hole', sc['x'], sc['z'], 0.3, -0.2, 0.038, DARK_HOLE, 64)
    for k_ in range(4):
        a_ = k_ / 4 * math.tau + math.pi / 4
        dome('saucer lamp', sc['x'] + 0.56 * math.cos(a_), sc['z'] + 0.56 * math.sin(a_), 0.06, 0.0, 0.05, AMBER_LAMP)
# The lock: a saucer, a dark hole in a gold scarab ring.
lk = T['lock']
cylinder('lock ring', lk['x'], lk['z'], lk['radius'] * 1.2, 0, 0.03, GOLD, 64, 0.01)
cylinder('lock hole', lk['x'], lk['z'], lk['radius'] * 0.8, -0.2, 0.035, DARK_HOLE, 64)
# The kickback: a chrome plunger in the right outlane (x 3.72).
kb = T['kickback']
cylinder('kickback', kb['x'], kb['z'] - 0.5, 0.12, 0, 0.18, CHROME, 24)
# The plunger: chrome rod, spring and a brass knob out through the front rail.
pl = T['plunger']
rod('plunger rod', pl['x'], FY0 - 0.9, 0.25, 0.07, 0.38, CHROME)
coil = [(pl['x'] + 0.12 * math.cos(t), -1.6 + t * 0.012) for t in np.linspace(0, 40 * math.pi, 600)]
cu = bpy.data.curves.new('spring', 'CURVE'); cu.dimensions = '3D'
spl = cu.splines.new('POLY'); spl.points.add(len(coil) - 1)
for p_, (cx_, cy_), t in zip(spl.points, coil, np.linspace(0, 40 * math.pi, 600)):
    p_.co = (cx_, cy_, 0.38 + 0.12 * math.sin(t), 1)
cu.bevel_depth = 0.018; ob = bpy.data.objects.new('spring', cu); ob.data.materials.append(CHROME); link(ob)
rod('plunger housing', pl['x'], FY0 - 0.68, FY0 - 0.45, 0.22, 0.38, BRASS)
rod('plunger rod out', pl['x'], FY0 - 1.55, FY0 - 0.6, 0.06, 0.38, STEEL)
rod('plunger knob', pl['x'], FY0 - 2.0, FY0 - 1.5, 0.3, 0.38, BRASS)
for k_ in range(5):
    rod('knurl', pl['x'], FY0 - 1.95 + k_ * 0.09, FY0 - 1.91 + k_ * 0.09, 0.315, 0.38, GOLD)
coil_ = cu_ = bpy.data.curves.new('outer spring', 'CURVE'); cu_.dimensions = '3D'
sp_ = cu_.splines.new('POLY'); ts_ = np.linspace(0, 16 * math.pi, 320); sp_.points.add(len(ts_) - 1)
for p_, t_ in zip(sp_.points, ts_):
    p_.co = (pl['x'] + 0.13 * math.cos(t_), FY0 - 1.5 + t_ / (16 * math.pi) * 0.82, 0.38 + 0.13 * math.sin(t_), 1)
cu_.bevel_depth = 0.022; ob_ = bpy.data.objects.new('outer spring', cu_); ob_.data.materials.append(STEEL); link(ob_)
# Lit inserts: ladders up both sides of the pyramid, arrows up both orbits, a column under the pyramid, and the ankh,
# scarab and falcon plaques under the bumpers (decoration: printed pictures set in the playfield, no targets, and
# nothing lights them in play).
def arrow(x, y, s, m):
    prism('insert ring', [(x - s * 1.45, y - s * 1.15), (x + s * 1.45, y - s * 1.15), (x, y + s * 1.35)], 0, 0.002, GOLD)
    prism('insert bezel', [(x - s * 1.25, y - s), (x + s * 1.25, y - s), (x, y + s * 1.15)], 0, 0.004, BEZEL)
    prism('insert', [(x - s, y - s * 0.8), (x + s, y - s * 0.8), (x, y + s * 0.9)], 0, 0.006, m)
EYE_INSERT = printed_material('eye insert', os.path.join(os.path.dirname(SCENE_JSON), 'art', 'eye-11.png'), glow=3.5)
def roundel(x, y, r, m):
    cylinder('roundel ring', x, y, r * 1.45, 0, 0.002, GOLD, 48)
    cylinder('roundel bezel', x, y, r * 1.28, 0, 0.004, BEZEL, 48)
    if m is BLUE_LAMP:
        # An eye of Horus icon, as the reference's framed icon roundels.
        bm_ = bmesh.new(); bmesh.ops.create_circle(bm_, cap_ends=True, segments=40, radius=r)
        bmesh.ops.translate(bm_, verts=bm_.verts, vec=(x, y, 0.007))
        me_ = bpy.data.meshes.new('icon roundel'); bm_.to_mesh(me_); bm_.free()
        uv_ = me_.uv_layers.new(name='UVMap')
        for poly in me_.polygons:
            for li in poly.loop_indices:
                v = me_.vertices[me_.loops[li].vertex_index].co
                uv_.data[li].uv = (0.507 + (v.x - x) / r * 0.31, 0.5 + (v.y - y) / r * 0.31)
        ob_ = bpy.data.objects.new('icon roundel', me_); ob_.data.materials.append(EYE_INSERT); link(ob_)
    else:
        cylinder('roundel', x, y, r, 0, 0.007, m, 48)
for k in range(5):
    for lx, z0 in ((-3.62, 6.75), (2.82, 6.55)):
        if k % 2 == 0:
            arrow(lx, z0 + k * 0.6, 0.23, AMBER_LAMP)
        else:
            roundel(lx, z0 + k * 0.6, 0.21, BLUE_LAMP)
for k in range(3):
    arrow(-4.5, 9.9 + k * 0.55, 0.17, AMBER_LAMP)
    arrow(3.7, 11.3 + k * 0.45, 0.15, AMBER_LAMP)
for k in range(4):
    roundel(CX, 2.9 + k * 0.62, 0.2, BLUE_LAMP if k % 2 else AMBER_LAMP)
for ox_, oz_ in ((3.72, 4.0), (3.72, 4.7)):
    roundel(ox_, oz_, 0.16, BLUE_LAMP)
for (tid, img), px_ in zip(list(EMBLEMS.items())[:3], (-1.3, -0.4, 0.5)):
    m_ = printed_material('plaque ' + tid, os.path.join(os.path.dirname(SCENE_JSON), 'art', img), glow=2.5)
    prism('plaque rim', [(px_ - 0.3, 9.02), (px_ + 0.3, 9.02), (px_ + 0.3, 9.66), (px_ - 0.3, 9.66)], 0, 0.004, GOLD)
    facing_quad('plaque', [(px_ - 0.26, 9.06, 0.007), (px_ + 0.26, 9.06, 0.007), (px_ + 0.26, 9.62, 0.007), (px_ - 0.26, 9.62, 0.007)],
                [(0.14, 0.14), (0.86, 0.14), (0.86, 0.86), (0.14, 0.86)], m_)

# Statues on the corner fills, outside the outer wall, so nothing the ball can't touch stands where it rolls: pyramids,
# obelisks and palms in gold. Each footprint is checked against the playfield's outline.
PLAYFIELD = [tuple(p) for p in outer] + [(5, -1.7), (-5, -1.7)]

def on_playfield(x, y):
    inside = False
    for (ax, ay), (bx, by) in zip(PLAYFIELD, PLAYFIELD[1:] + PLAYFIELD[:1]):
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            inside = not inside
    return inside

SKIP_CHECK = False

def clear_of_playfield(name, x, y, r):
    if SKIP_CHECK:
        return
    for dx, dy in ((-r, -r), (r, -r), (r, r), (-r, r), (0, 0)):
        assert not on_playfield(x + dx, y + dy), f'{name} at ({x}, {y}) reaches onto the playfield'

def pyramid(x, y, half, h, z=0.5):
    clear_of_playfield('pyramid', x, y, half)
    bm = bmesh.new()
    base_v = [bm.verts.new((x + sx * half, y + sy * half, z)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    apex = bm.verts.new((x, y, z + h))
    bm.faces.new(base_v[::-1])
    for i in range(4):
        bm.faces.new([base_v[i], base_v[(i + 1) % 4], apex])
    me = bpy.data.meshes.new('pyramid'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('pyramid', me); ob.data.materials.append(GOLD); link(ob)
    md = ob.modifiers.new('bevel', 'BEVEL'); md.width = 0.015; md.segments = 2

def obelisk(x, y, w, h, z=0.5):
    clear_of_playfield('obelisk', x, y, w * 0.9)
    prism('obelisk base', [(x - w * 0.8, y - w * 0.8), (x + w * 0.8, y - w * 0.8), (x + w * 0.8, y + w * 0.8), (x - w * 0.8, y + w * 0.8)], z, z + 0.12, BLACK, 0.01)
    bm = bmesh.new()
    lo = [bm.verts.new((x + sx * w / 2, y + sy * w / 2, z + 0.12)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    hi = [bm.verts.new((x + sx * w * 0.33, y + sy * w * 0.33, z + h)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    tip = bm.verts.new((x, y, z + h + w * 0.55))
    bm.faces.new(lo[::-1])
    for i in range(4):
        bm.faces.new([lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]])
        bm.faces.new([hi[i], hi[(i + 1) % 4], tip])
    me = bpy.data.meshes.new('obelisk'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('obelisk', me); ob.data.materials.append(GOLD); link(ob)
    md = ob.modifiers.new('bevel', 'BEVEL'); md.width = 0.01; md.segments = 2

def palm(x, y, h, z=0.5):
    clear_of_playfield('palm', x, y, 0.15)
    cu = bpy.data.curves.new('palm trunk', 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(1)
    sp.bezier_points[0].co = (x, y, z); sp.bezier_points[0].handle_left_type = sp.bezier_points[0].handle_right_type = 'AUTO'
    sp.bezier_points[1].co = (x + 0.12, y, z + h); sp.bezier_points[1].handle_left_type = sp.bezier_points[1].handle_right_type = 'AUTO'
    cu.bevel_depth = 0.045; cu.bevel_resolution = 4
    ob = bpy.data.objects.new('palm trunk', cu); ob.data.materials.append(GOLD); link(ob)
    for k in range(7):
        ang = k / 7 * math.tau
        leaf = bpy.data.curves.new('palm leaf', 'CURVE'); leaf.dimensions = '3D'
        sl = leaf.splines.new('BEZIER'); sl.bezier_points.add(2)
        top = Vector((x + 0.12, y, z + h))
        out = Vector((math.cos(ang), math.sin(ang), 0))
        for i, (d, up) in enumerate(((0, 0), (0.28, 0.12), (0.55, -0.18))):
            bp = sl.bezier_points[i]
            bp.co = top + out * d + Vector((0, 0, up)); bp.handle_left_type = bp.handle_right_type = 'AUTO'
            bp.radius = (1.0, 0.8, 0.15)[i]
        leaf.bevel_depth = 0.06; leaf.bevel_resolution = 1
        lo_ = bpy.data.objects.new('palm leaf', leaf); lo_.data.materials.append(GOLD); link(lo_)
        lo_.scale = (1, 1, 1)

SAND_ISLE = mat('terrace', (0.015, 0.06, 0.36), rough=0.3, coat=0.6)
prism('diorama terrace', [(-5.6, 13.0), (-5.15, 13.0), (-4.33, 15.1), (-2.58, 16.33), (0, 16.85), (2.58, 16.33), (4.33, 15.1),
                          (5.15, 13.0), (5.6, 13.0), (5.6, 17.6), (-5.6, 17.6)], 0.5, 0.62, SAND_ISLE, 0.04)
wire('terrace edge', [(-5.15, 13.0), (-4.33, 15.1), (-2.58, 16.33), (0, 16.85), (2.58, 16.33), (4.33, 15.1), (5.15, 13.0)], 0.63, 0.04, GOLD)
pyramid(-4.35, 16.6, 0.62, 1.1, z=0.62)
for ob_ in [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('pyramid') and o.data.materials and o.data.materials[0] is GOLD][-1:]:
    ob_.data.materials[0] = SAND
pyramid(-3.2, 17.1, 0.3, 0.55, z=0.62)
obelisk(-5.25, 15.2, 0.32, 1.9, z=0.62)
palm(-5.3, 16.6, 1.15, z=0.62)
palm(-2.85, 17.3, 0.95, z=0.62)
obelisk(-5.3, 13.6, 0.26, 1.3, z=0.62)
obelisk(5.3, 13.8, 0.3, 1.5, z=0.62)
palm(5.0, 15.9, 1.0, z=0.62)
palm(-1.75, 17.2, 0.85, z=0.62)
STANDEES = [('anubis_statue-11.png', -5.3, 15.4, 1.1, True, 0.62), ('pylon-41.png', 0.0, 17.1, 1.8, True, 0.62),
            ('seated-41.png', 2.72, 13.4, 0.75, False, 0.64), ('sphinx-11.png', 3.55, 16.95, 1.7, True, 0.62)]
obelisk(-1.45, 17.3, 0.24, 1.4, z=0.62)
obelisk(1.45, 17.3, 0.24, 1.4, z=0.62)
SKIP_CHECK = True
obelisk(-4.6, 4.4, 0.26, 1.25, z=0.0)
pyramid(-4.6, 2.5, 0.28, 0.55, z=0.0)
SKIP_CHECK = False

# ---------------------------------------------------------------- lights and world
# A studio for the metal to reflect: dark below the horizon, a warm glow above with soft vertical "softbox" bands, so
# gold and chrome pick up streaks of light as in a product photograph.
world = bpy.data.worlds.new('world'); scene.world = world
world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
bg = wn['Background']
tcw = wn.new('ShaderNodeTexCoord')
sep = wn.new('ShaderNodeSeparateXYZ'); wl.new(tcw.outputs['Generated'], sep.inputs[0])
horizon = wn.new('ShaderNodeMapRange'); horizon.inputs['From Min'].default_value = -0.05; horizon.inputs['From Max'].default_value = 0.45
wl.new(sep.outputs['Z'], horizon.inputs['Value'])
bands = wn.new('ShaderNodeTexWave'); bands.inputs['Scale'].default_value = 1.6; bands.inputs['Distortion'].default_value = 0.0
bands.wave_profile = 'SIN'
wl.new(tcw.outputs['Generated'], bands.inputs['Vector'])
bandsharp = wn.new('ShaderNodeMapRange'); bandsharp.inputs['From Min'].default_value = 0.55; bandsharp.inputs['From Max'].default_value = 0.95
wl.new(bands.outputs['Fac'], bandsharp.inputs['Value'])
glow = wn.new('ShaderNodeMath'); glow.operation = 'MULTIPLY_ADD'; glow.inputs[2].default_value = 0.25
wl.new(bandsharp.outputs['Result'], glow.inputs[0]); glow.inputs[1].default_value = 2.4
lit = wn.new('ShaderNodeMath'); lit.operation = 'MULTIPLY'
wl.new(horizon.outputs['Result'], lit.inputs[0]); wl.new(glow.outputs[0], lit.inputs[1])
# Dark straight overhead, so the playfield's clear coat (seen from above) mirrors darkness, not a milky sky.
zenith = wn.new('ShaderNodeMapRange'); zenith.inputs['From Min'].default_value = 0.5; zenith.inputs['From Max'].default_value = 0.85
zenith.inputs['To Min'].default_value = 1.0; zenith.inputs['To Max'].default_value = 0.15
wl.new(sep.outputs['Z'], zenith.inputs['Value'])
lit2 = wn.new('ShaderNodeMath'); lit2.operation = 'MULTIPLY'
wl.new(lit.outputs[0], lit2.inputs[0]); wl.new(zenith.outputs['Result'], lit2.inputs[1])
wl.new(lit2.outputs[0], bg.inputs['Strength'])
bg.inputs['Color'].default_value = (1.0, 0.72, 0.46, 1)

def area(name, loc_tbl, size, energy, color, aim_tbl, glossy=True):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.size = size; l.color = color
    o = bpy.data.objects.new(name, l); link(o); o.location = loc_tbl
    d = Vector(aim_tbl) - Vector(loc_tbl)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    # A big flat light would show as a grey slab in the playfield's clear coat: the fills light it without being seen.
    o.visible_glossy = glossy
    return o

area('key', (0, 9, 14), 10, 4200, (1.0, 0.62, 0.3), (0, 9, 0), glossy=False)
area('glint', (-3, 2, 9), 1.2, 900, (1.0, 0.85, 0.6), (0, 9, 0))
area('glint 2', (4, 15, 8), 1.0, 700, (1.0, 0.85, 0.6), (0, 7, 0))
area('rim left', (-9, 6, 5), 4, 900, (1.0, 0.66, 0.36), (0, 10, 0))
area('rim right', (9, 14, 5), 4, 800, (1.0, 0.68, 0.4), (0, 8, 0))
area('front fill', (0, -7, 4), 7, 220, (1.0, 0.7, 0.45), (0, 4, 0), glossy=False)
area('panel light', (0, -9, -1), 6, 900, (1.0, 0.78, 0.55), (0, -2.5, -1.2), glossy=False)

# ---------------------------------------------------------------- cameras
cam_data = bpy.data.cameras.new('stage camera')
cam = bpy.data.objects.new('stage camera', cam_data); col.objects.link(cam)
cam.matrix_world = C @ m3(S['cameraMatrix'])
cam_data.sensor_fit = 'VERTICAL'
cam_data.angle_y = math.radians(S['fovY'])
cam_data.clip_start = 0.5; cam_data.clip_end = 200
W, Hh = S['width'], S['height']
# three's view offset of viewY pixels moves the picture down by -viewY; Blender's shift (fitted vertically) is in units
# of the frame's height, and a positive shift moves the picture down. Measured against the probes: exact.
cam_data.shift_y = -S['viewY'] / Hh

scene.render.resolution_x = W; scene.render.resolution_y = Hh
scene.camera = cam
bpy.context.view_layer.update()
err = 0
for p in S['pixels']:
    x, y, z = p['table']
    wpt = root.matrix_world @ Vector((x, z, y))
    v = world_to_camera_view(scene, cam, wpt)
    px = (v.x * W, (1 - v.y) * Hh)
    e = math.hypot(px[0] - p['px'][0], px[1] - p['px'][1])
    err = max(err, e)
    print(f'probe {p["table"]}: blender {px[0]:.1f},{px[1]:.1f}  stage {p["px"][0]:.1f},{p["px"][1]:.1f}  off {e:.2f}px')
print(f'CAMERA MATCH: worst {err:.2f} px')
if err > 0.5:
    raise SystemExit(f"the camera is {err:.2f} px off the stage's: not rendering")

# ---------------------------------------------------------------- statue cutouts
# A photoreal statue from the image service's sprite output (background cut away), on a card that stands up from the
# corner fill and faces the stage camera: from a camera that never moves, it reads as a sculpture.
def standee(img_name, x, y, width, check=True, base_z=None):
    global SKIP_CHECK
    SKIP_CHECK = not check
    img = bpy.data.images.load(os.path.join(os.path.dirname(SCENE_JSON), 'art', img_name))
    px_ = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(px_)
    a = px_[3::4].reshape(img.size[1], img.size[0]) > 0.1
    rows, cols = np.where(a.any(1))[0], np.where(a.any(0))[0]
    u0, u1 = cols.min() / img.size[0], (cols.max() + 1) / img.size[0]
    v0, v1 = rows.min() / img.size[1], (rows.max() + 1) / img.size[1]
    height = width * (v1 - v0) * img.size[1] / ((u1 - u0) * img.size[0])
    clear_of_playfield(img_name, x, y, 0.1)
    base = root.matrix_world @ Vector((x, y, base_z if base_z is not None else (0.5 if check else 0.42)))
    up = (root.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    to_cam = (cam.matrix_world.translation - base)
    side = up.cross(to_cam).normalized()
    for end in (-1, 1):  # both ends of the card stay off the playfield too
        local = root.matrix_world.inverted() @ (base + side * end * width / 2)
        clear_of_playfield(img_name, local.x, local.y, 0.0)
    corners = [base - side * width / 2, base + side * width / 2, base + side * width / 2 + up * height, base - side * width / 2 + up * height]
    me = bpy.data.meshes.new(img_name)
    me.from_pydata([tuple(c) for c in corners], [], [[0, 1, 2, 3]])
    uvl = me.uv_layers.new(name='UVMap')
    for li, uv in zip(range(4), ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
        uvl.data[li].uv = uv
    m = bpy.data.materials.new(img_name)
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    N.remove(N['Principled BSDF'])
    tex = N.new('ShaderNodeTexImage'); tex.image = img
    em = N.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1.0
    tr = N.new('ShaderNodeBsdfTransparent')
    mix = N.new('ShaderNodeMixShader')
    L.new(tex.outputs['Color'], em.inputs['Color'])
    L.new(tex.outputs['Alpha'], mix.inputs['Fac'])
    L.new(tr.outputs[0], mix.inputs[1]); L.new(em.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], N['Material Output'].inputs['Surface'])
    ob = bpy.data.objects.new(img_name, me); ob.data.materials.append(m); col.objects.link(ob)
    ob.visible_shadow = False

for args in STANDEES:
    standee(*args)
SKIP_CHECK = False

# The flippers (live parts: the hero's only), in the physics' shape, as src/shared/table.ts's FLIPPER_SHAPE (scene.json's
# flipperShape; the stage's live flippers have it too): round on the pivot and at the tip, the tip's round ending at the
# flipper's length, as tall as the physics'. A cream body, a gold cap on its top (its outline at 0.82) and a gold pin.
FLIPPER_SHAPE = S['flipperShape']
RB, RT, FH = FLIPPER_SHAPE['baseRadius'], FLIPPER_SHAPE['tipRadius'], FLIPPER_SHAPE['height']
for fl in T['flippers']:
    px_, py_ = fl['pivot']; a_ = math.radians(fl['restDeg']); L_ = fl['length']
    tipx, tipy = px_ + (L_ - RT) * math.cos(a_), py_ + (L_ - RT) * math.sin(a_)
    outline = []
    for k in range(24):
        t_ = math.pi / 2 + k / 23 * math.pi
        outline.append((px_ + RB * math.cos(a_ + t_), py_ + RB * math.sin(a_ + t_)))
    for k in range(24):
        t_ = -math.pi / 2 + k / 23 * math.pi
        outline.append((tipx + RT * math.cos(a_ + t_), tipy + RT * math.sin(a_ + t_)))
    LIVE.append(prism('flipper', outline, 0.02, FH, CREAM, 0.04))
    LIVE.append(prism('flipper cap', [(px_ + (x_ - px_) * 0.82, py_ + (y_ - py_) * 0.82) for x_, y_ in outline], FH, FH + 0.03, GOLD, 0.01))
    LIVE.append(cylinder('flipper pin', px_, py_, 0.09, FH + 0.03, FH + 0.06, GOLD, 24))


# ---------------------------------------------------------------- render
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
for kind in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        if any(d.type == kind for d in prefs.devices):
            break
    except TypeError:
        continue
for d in prefs.devices:
    d.use = d.type == kind
scene.cycles.device = 'GPU'
print('devices:', [(d.name, d.type, d.use) for d in prefs.devices])
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.view_settings.view_transform = 'AgX'
try:
    scene.view_settings.look = 'AgX - Punchy'
except TypeError:
    pass
scene.view_settings.exposure = -0.25
# A soft glow round the lamps (the compositor's Glare); Blender 5 made the compositor a node group and Glare's settings
# inputs, so both forms are tried, and the render goes on without a glow if neither works.
try:
    ng = bpy.data.node_groups.new('glow', 'CompositorNodeTree')
    ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    rl = ng.nodes.new('CompositorNodeRLayers')
    gl = ng.nodes.new('CompositorNodeGlare')
    out = ng.nodes.new('NodeGroupOutput')
    def setg(attr, sock, v):
        if hasattr(gl, attr):
            setattr(gl, attr, v)
        elif sock in gl.inputs:
            gl.inputs[sock].default_value = v
    setg('glare_type', 'Type', 'Fog Glow' if 'Type' in gl.inputs else 'FOG_GLOW')
    setg('threshold', 'Threshold', GLARE['threshold'])
    setg('quality', 'Quality', 'High' if 'Quality' in gl.inputs else 'HIGH')
    if 'Strength' in gl.inputs:
        gl.inputs['Strength'].default_value = GLARE['strength']
    if 'Saturation' in gl.inputs:
        gl.inputs['Saturation'].default_value = GLARE['saturation']
    if 'Size' in gl.inputs:
        gl.inputs['Size'].default_value = GLARE['size']
    ng.links.new(rl.outputs['Image'], gl.inputs['Image'])
    ng.links.new(gl.outputs['Image'], out.inputs[0])
    scene.compositing_node_group = ng
    print('GLOW on')
except Exception as e:
    print('GLOW skipped:', e)
scene.render.image_settings.file_format = 'PNG'
os.makedirs(OUT, exist_ok=True)

print('LIVE parts', len(LIVE), 'left out of the stage picture' if WHICH == 'stage' else 'in the hero picture')
if WHICH == 'stage':
    for ob_ in LIVE:
        ob_.hide_render = True
    scene.render.film_transparent = True
    scene.render.filepath = os.path.join(OUT, 'stage.png')
    bpy.ops.render.render(write_still=True)
if WHICH == 'hero':
    for ob_ in LIVE:
        ob_.hide_render = False
    # Transparent, as the reference is a cutout: composited onto white for the review.
    scene.render.film_transparent = True
    hero_d = bpy.data.cameras.new('hero'); hero = bpy.data.objects.new('hero', hero_d); col.objects.link(hero)
    hero_d.lens = HERO_LENS
    scene.camera = hero
    scene.render.resolution_x, scene.render.resolution_y = 1254, 1254
    # A front, elevated view of the whole cabinet like the reference's (HERO_ELEV degrees above the playfield).
    ELEV = math.radians(HERO_ELEV)
    target = root.matrix_world @ Vector((0, 7.9, -0.6))
    back_ = (root.matrix_world.to_3x3() @ Vector((0, -math.cos(ELEV), math.sin(ELEV)))).normalized()
    box = [root.matrix_world @ Vector((x, y, z)) for x in (FX0, FX1) for y in (FY0 - 0.5, FY1 + 0.5) for z in (CAB_BOTTOM, 1.1)] + [root.matrix_world @ Vector((x, FY1, 2.4)) for x in (-1.2, 1.2)]
    for dist in np.arange(15, 90, 0.25):
        hero.location = target + back_ * float(dist)
        hero.rotation_euler = (target - hero.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.view_layer.update()
        if all(0.015 < p.x < 0.985 and 0.015 < p.y < 0.985 for p in (world_to_camera_view(scene, hero, q) for q in box)):
            break
    # Centre the cabinet in the frame (a lens shift), then bring the camera in until it just fits again.
    for _ in range(3):
        pts_ = [world_to_camera_view(scene, hero, q) for q in box]
        hero_d.shift_x += ((min(p.x for p in pts_) + max(p.x for p in pts_)) / 2 - 0.5)
        hero_d.shift_y += ((min(p.y for p in pts_) + max(p.y for p in pts_)) / 2 - 0.5)
        bpy.context.view_layer.update()
        for dist in np.arange(float((hero.location - target).length), 15, -0.1):
            hero.location = target + back_ * float(dist)
            bpy.context.view_layer.update()
            if not all(0.015 < p.x < 0.985 and 0.015 < p.y < 0.985 for p in (world_to_camera_view(scene, hero, q) for q in box)):
                hero.location = target + back_ * float(dist + 0.1)
                break
        bpy.context.view_layer.update()
    scene.render.filepath = os.path.join(OUT, 'hero.png')
    bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'pinball.blend'))
print('DONE')
