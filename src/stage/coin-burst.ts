// A ball's payout on the stage: a short burst of gold coin sprites from where the ball drained, flying up and out and
// falling back as they fade. In the table's own coordinates, as table-mesh.ts.
import * as THREE from 'three';

/** How long a coin flies, how hard the burst throws, and how hard they fall back (units a second, a second squared). */
const LIFE = 1.3;
const THROW = 4.5;
const GRAVITY = 11;
/**
 * The most coins one burst throws, and the most flying at once. A burst grows with its payout, so a big one rains:
 * three of the biggest fit the pool before the oldest coins are thrown again.
 */
const MOST = 60;
const POOL = 180;

/**
 * A gold coin, face on: a disc with a rim and a shine (drawn once for every coin). Without a page to draw it on (the
 * tests load this file in Node) it is a blank texture, as pinball-parts.ts's art() has.
 */
function coinTexture(): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size * 0.38, size * 0.35, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, '#fff6c0');
  grad.addColorStop(0.45, '#ffd23f');
  grad.addColorStop(1, '#b07800');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#7a5200';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 9, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CoinBurst {
  readonly group = new THREE.Group();
  private readonly coins: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; v: THREE.Vector3; age: number }[] = [];
  private next = 0;

  constructor() {
    const map = coinTexture();
    for (let i = 0; i < POOL; i++) {
      // A touch over 1, so the bloom catches the gold.
      const mat = new THREE.SpriteMaterial({ map, color: new THREE.Color(1.6, 1.4, 1), transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.setScalar(0.42);
      sprite.visible = false;
      this.group.add(sprite);
      this.coins.push({ sprite, mat, v: new THREE.Vector3(), age: LIFE });
    }
  }

  /** A burst for `coins` coins from (x, z) on the playfield: 8 coins, and one more for each coin paid, up to MOST. */
  burst(coins: number, x: number, z: number): void {
    const n = Math.max(8, Math.min(MOST, Math.round(8 + coins)));
    for (let i = 0; i < n; i++) {
      const c = this.coins[this.next];
      this.next = (this.next + 1) % this.coins.length;
      const a = Math.random() * Math.PI * 2;
      const out = THROW * (0.3 + 0.5 * Math.random());
      c.v.set(Math.cos(a) * out, THROW * (0.8 + 0.6 * Math.random()), Math.abs(Math.sin(a)) * out + 1);
      c.sprite.position.set(x, 0.4, z);
      c.age = -Math.random() * 0.12;
      c.sprite.visible = false;
    }
  }

  update(dt: number): void {
    for (const c of this.coins) {
      if (c.age >= LIFE) continue;
      c.age += dt;
      if (c.age < 0) continue;
      if (c.age >= LIFE) {
        c.sprite.visible = false;
        continue;
      }
      c.v.y -= GRAVITY * dt;
      c.sprite.position.addScaledVector(c.v, dt);
      if (c.sprite.position.y < 0.2) {
        c.sprite.position.y = 0.2;
        c.v.y = Math.abs(c.v.y) * 0.35;
      }
      c.mat.opacity = Math.min(1, 3 * (1 - c.age / LIFE));
      c.mat.rotation += dt * 6;
      c.sprite.visible = true;
    }
  }
}
