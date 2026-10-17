// The stand-in table drawn in three.js, until the owner's picture comes (Task 8 swaps this module for the picture): the
// playfield, the walls with some height and a neon edge, the bumpers' bodies, the slings' plastics, the plunger lane
// and its plunger, the side rails and the apron. Only what stays put is here; what moves or lights up (the flippers,
// the bumper caps, the drop targets, the spinner, the inserts) is the scene's live parts (pinball-parts.ts), which the
// picture keeps.
//
// Everything is in the table's own coordinates (shared/table.ts): x across, y up off the playfield, z up the table. The
// scene puts the whole table in a group that turns those into the world's (see PinballScene).
import * as THREE from 'three';
import type { Look } from '@kit/stage';
import type { Table } from '../shared/table';

export const PINK = 0xff2bd6;
export const CYAN = 0x22e6ff;

/** How tall the walls stand off the playfield, and how thick they're drawn (the physics' are 0.16 thick). */
const WALL_HEIGHT = 0.55;
const WALL_THICK = 0.16;
/** The rails each side of the cabinet, outside the outer wall. */
const RAIL_WIDTH = 0.7;
/** The apron below the flippers, toward the player. */
const APRON = 1.6;

/** A wall's piece from a to b on the playfield: a box `thick` wide and `height` tall, its bottom on the playfield. */
export function segmentBox(a: readonly [number, number], b: readonly [number, number], thick: number, height: number, material: THREE.Material): THREE.Mesh {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const m = new THREE.Mesh(new THREE.BoxGeometry(len + thick, height, thick), material);
  m.position.set((a[0] + b[0]) / 2, height / 2, (a[1] + b[1]) / 2);
  // The box's length runs along +x; turned about y so +x points from a to b (a turn of φ about y takes +x to
  // (cos φ, 0, -sin φ)).
  m.rotation.y = -Math.atan2(dz, dx);
  return m;
}

/** The playfield's art: the look's floor colours, a fine grid with dots, and a glow toward the bumpers. */
function playfieldTexture(look: Look): THREE.CanvasTexture {
  const w = 512;
  const h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = look.floor.base;
  g.fillRect(0, 0, w, h);
  // A soft pink glow round the bumpers, and a cyan one toward the flippers (the canvas's top is the table's top).
  const glow = (x: number, y: number, r: number, color: string) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  };
  glow(w * 0.46, h * 0.4, w * 0.45, 'rgba(255,43,214,0.22)');
  glow(w * 0.46, h * 0.85, w * 0.4, 'rgba(34,230,255,0.16)');
  g.strokeStyle = look.floor.line;
  g.globalAlpha = 0.35;
  g.lineWidth = 2;
  const step = w / 16;
  for (let x = 0; x <= w; x += step) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.globalAlpha = 0.6;
  g.fillStyle = look.floor.dot;
  for (let x = 0; x <= w; x += step) for (let y = 0; y <= h; y += step) g.fillRect(x - 2, y - 2, 4, 4);
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * The stand-in table, from `table`'s layout: a group in the table's coordinates. The playfield takes shadows; the walls
 * are dark with a neon top, pink round the outside and cyan inside.
 */
export function standInTable(table: Table, look: Look, width: number, length: number): THREE.Group {
  const group = new THREE.Group();
  const outer = table.walls[0].points;

  // The playfield: the outer wall's outline, closed along the bottom, with the art stretched over the whole table.
  const shape = new THREE.Shape();
  // Drawn in (x, -z) and turned -90° about x, so the shape lies in the playfield facing up: (x, 0, z).
  shape.moveTo(outer[0][0], -outer[0][1]);
  for (const [x, z] of outer.slice(1)) shape.lineTo(x, -z);
  shape.lineTo(outer[outer.length - 1][0], 0);
  shape.lineTo(outer[0][0], 0);
  const field = new THREE.ShapeGeometry(shape, 24);
  field.rotateX(-Math.PI / 2);
  // The art's u across the table, its v up it.
  const uv = field.attributes.uv as THREE.BufferAttribute;
  const pos = field.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + width / 2) / width, pos.getZ(i) / length);
  const playfield = new THREE.Mesh(
    field,
    new THREE.MeshStandardMaterial({ map: playfieldTexture(look), roughness: 0.42, metalness: 0.1, envMapIntensity: 0.6 }),
  );
  playfield.receiveShadow = true;
  group.add(playfield);

  // Under the playfield, out to the rails and down under the apron: so nothing shows through round its edges.
  const base = new THREE.Mesh(new THREE.BoxGeometry(width + 2 * RAIL_WIDTH + 0.4, 0.3, length + APRON + 0.6), new THREE.MeshStandardMaterial({ color: 0x06030c, roughness: 0.8 }));
  base.position.set(0, -0.16, (length - APRON) / 2);
  group.add(base);

  // The walls: dark bodies, each with a glowing top strip.
  const body = new THREE.MeshStandardMaterial({ color: 0x15102a, roughness: 0.35, metalness: 0.6 });
  const pinkTop = new THREE.MeshStandardMaterial({ color: 0x220018, emissive: PINK, emissiveIntensity: 2.2, roughness: 0.4 });
  const cyanTop = new THREE.MeshStandardMaterial({ color: 0x001a20, emissive: CYAN, emissiveIntensity: 1.8, roughness: 0.4 });
  table.walls.forEach((wall, i) => {
    const top = i === 0 ? pinkTop : cyanTop;
    const height = i === 0 ? WALL_HEIGHT * 1.4 : WALL_HEIGHT;
    for (let k = 1; k < wall.points.length; k++) {
      const a = wall.points[k - 1];
      const b = wall.points[k];
      const piece = segmentBox(a, b, WALL_THICK, height, body);
      piece.castShadow = piece.receiveShadow = true;
      const strip = segmentBox(a, b, WALL_THICK * 0.6, 0.05, top);
      strip.position.y = height + 0.02;
      group.add(piece, strip);
    }
    // A post at each corner, so the pieces meet cleanly.
    for (const [x, z] of wall.points) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(WALL_THICK * 0.62, WALL_THICK * 0.62, height, 12), body);
      post.position.set(x, height / 2, z);
      group.add(post);
    }
  });

  // The rails down each side of the cabinet and across the top, black with a neon line along them.
  const rail = new THREE.MeshStandardMaterial({ color: 0x0b0716, roughness: 0.3, metalness: 0.7 });
  const half = width / 2;
  for (const side of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(RAIL_WIDTH, 0.9, length + APRON), rail);
    r.position.set(side * (half + RAIL_WIDTH / 2), 0.45, (length - APRON) / 2);
    r.castShadow = true;
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, length + APRON), side < 0 ? pinkTop : cyanTop);
    line.position.set(side * (half + RAIL_WIDTH / 2), 0.92, (length - APRON) / 2);
    group.add(r, line);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(width + 2 * RAIL_WIDTH, 0.9, 0.5), rail);
  head.position.set(0, 0.45, length + 0.25);
  group.add(head);

  // The apron toward the player, under the flippers: where the ball goes down the drain.
  const apron = new THREE.Mesh(new THREE.BoxGeometry(width, 0.35, APRON), new THREE.MeshStandardMaterial({ color: 0x120a24, roughness: 0.3, metalness: 0.5 }));
  apron.position.set(0, 0.17, -APRON / 2);
  apron.receiveShadow = true;
  const apronEdge = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, 0.06), pinkTop);
  apronEdge.position.set(0, 0.36, -0.03);
  group.add(apron, apronEdge);

  // The bumpers' bodies (their caps are live parts): a dark skirt and a white post.
  const skirt = new THREE.MeshStandardMaterial({ color: 0x1b1430, roughness: 0.3, metalness: 0.4 });
  const post = new THREE.MeshStandardMaterial({ color: 0xe8e6f0, roughness: 0.25, metalness: 0.2 });
  for (const b of table.bumpers) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(b.radius * 1.25, b.radius * 1.3, 0.08, 32), skirt);
    s.position.set(b.x, 0.04, b.z);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(b.radius * 0.9, b.radius, 0.42, 32), post);
    p.position.set(b.x, 0.25, b.z);
    p.castShadow = true;
    group.add(s, p);
  }

  // The slings' plastics: a triangle behind each rubber face (the rubber is a live part, it flashes), toward its wall.
  const plastic = new THREE.MeshStandardMaterial({ color: 0x2a0d3a, emissive: PINK, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.9 });
  for (const s of table.slings) {
    const out = s.a[0] < -0.4 ? -1 : 1;
    const corner: [number, number] = [s.a[0] + out * 0.9, s.b[1]];
    const tri = new THREE.Shape();
    tri.moveTo(s.a[0], -s.a[1]);
    tri.lineTo(s.b[0], -s.b[1]);
    tri.lineTo(corner[0], -corner[1]);
    tri.lineTo(s.a[0], -s.a[1]);
    const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.3, bevelEnabled: false });
    // Extruded along +z, then turned so the depth stands up: (x, -z, d) to (x, d, z).
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, plastic);
    m.castShadow = true;
    group.add(m);
  }

  // The plunger in its lane: a chrome rod and a red tip.
  const pl = table.plunger;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0xc4cad8, metalness: 1, roughness: 0.2 }));
  rod.rotation.x = Math.PI / 2;
  rod.position.set(pl.x, 0.2, pl.zFrom - 0.9);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0x400010, emissive: 0xff2050, emissiveIntensity: 0.8 }));
  tip.rotation.x = Math.PI / 2;
  tip.position.set(pl.x, 0.2, pl.zFrom - 0.25);
  group.add(rod, tip);

  // The spinner's posts (the spinner's blade is a live part).
  const sp = table.spinner;
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 8), post);
    p.position.set(sp.x + (side * sp.width) / 2, 0.275, sp.z);
    group.add(p);
  }
  return group;
}
