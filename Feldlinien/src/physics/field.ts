import { distToShape, type Body, type PointCharge } from './scene';
import { luFactor, luSolve, type LU } from './linalg';

// Units: Coulomb constant k = 1. A line charge q produces E = 2q/r and the
// potential phi = -2q ln(r / R0). The flux leaving a charge q is 4*pi*q.
export const R0 = 5000;
const LN_R0_SQ = Math.log(R0 * R0);
const MULTIPOLE_ORDER = 14;
const MULTIPOLE_RADIUS = 2.2; // use the expansion beyond this many body radii
const NEAR_SEGMENT = 16; // (4 segment lengths)^2: closer segments are integrated exactly
// Conductors closer than this (the drawn metal stroke) touch electrically.
export const CONTACT_DIST = 6;

export interface SolvedBody extends Body {
  first: number; // index of the first segment
  count: number;
  group: number; // electrically connected conductors share a group
  V: number; // potential of the conductor
  cx: number;
  cy: number;
  radius: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  mre: Float64Array; // multipole coefficients
  mim: Float64Array;
  cavity: boolean; // closed and empty inside: the interior is exactly field-free
}

// Potential at local point (px, py) of a segment [0, L] on the x axis with unit density.
function segPotentialLocal(px: number, py: number, L: number): number {
  const F = (u: number) => {
    const r2 = u * u + py * py;
    let v = (r2 > 0 ? u * Math.log(r2) : 0) - 2 * u;
    if (Math.abs(py) > 1e-12) v += 2 * py * Math.atan(u / py);
    return v;
  };
  return -(F(L - px) - F(-px)) + L * LN_R0_SQ;
}

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const sx = bx - ax;
  const sy = by - ay;
  const l2 = sx * sx + sy * sy;
  let t = l2 > 0 ? ((px - ax) * sx + (py - ay) * sy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * sx, py - ay - t * sy);
}

function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): boolean {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return false;
  const qx = cx - ax;
  const qy = cy - ay;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export class Field {
  readonly charges: PointCharge[];
  readonly bodies: SolvedBody[];
  // Segment data (struct of arrays)
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly bx: Float64Array;
  readonly by: Float64Array;
  readonly mx: Float64Array;
  readonly my: Float64Array;
  readonly len: Float64Array;
  readonly cs: Float64Array;
  readonly sn: Float64Array;
  readonly lambda: Float64Array;
  readonly segBody: Int32Array;
  readonly nSeg: number;
  // false if the solution is unusable (non-finite or absurd charge densities)
  ok = true;
  private readonly cavities: number[] = [];

  constructor(charges: PointCharge[], bodies: Body[], cache?: SolverCache) {
    this.charges = charges.map((c) => ({ ...c }));
    let n = 0;
    for (const b of bodies) n += b.closed ? b.xs.length : b.xs.length - 1;
    this.nSeg = n;
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    this.bx = new Float64Array(n);
    this.by = new Float64Array(n);
    this.mx = new Float64Array(n);
    this.my = new Float64Array(n);
    this.len = new Float64Array(n);
    this.cs = new Float64Array(n);
    this.sn = new Float64Array(n);
    this.lambda = new Float64Array(n);
    this.segBody = new Int32Array(n);

    this.bodies = [];
    let k = 0;
    bodies.forEach((b, bi) => {
      const first = k;
      const m = b.closed ? b.xs.length : b.xs.length - 1;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < b.xs.length; i++) {
        minX = Math.min(minX, b.xs[i]);
        maxX = Math.max(maxX, b.xs[i]);
        minY = Math.min(minY, b.ys[i]);
        maxY = Math.max(maxY, b.ys[i]);
      }
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % b.xs.length;
        this.ax[k] = b.xs[i];
        this.ay[k] = b.ys[i];
        this.bx[k] = b.xs[j];
        this.by[k] = b.ys[j];
        this.mx[k] = (b.xs[i] + b.xs[j]) / 2;
        this.my[k] = (b.ys[i] + b.ys[j]) / 2;
        const dx = b.xs[j] - b.xs[i];
        const dy = b.ys[j] - b.ys[i];
        const l = Math.hypot(dx, dy) || 1e-9;
        this.len[k] = l;
        this.cs[k] = dx / l;
        this.sn[k] = dy / l;
        this.segBody[k] = bi;
        k++;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      let radius = 0;
      for (let i = 0; i < b.xs.length; i++) radius = Math.max(radius, Math.hypot(b.xs[i] - cx, b.ys[i] - cy));
      this.bodies.push({
        ...b,
        first,
        count: m,
        group: bi,
        V: 0,
        cx,
        cy,
        radius,
        minX,
        minY,
        maxX,
        maxY,
        mre: new Float64Array(MULTIPOLE_ORDER + 1),
        mim: new Float64Array(MULTIPOLE_ORDER + 1),
        cavity: false
      });
    });

    this.connectTouching();
    if (n > 0) this.solve(cache);
    this.findCavities();
  }

  // Union-find over conductors whose outlines come closer than CONTACT_DIST.
  private connectTouching() {
    const parent = this.bodies.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let a = 0; a < this.bodies.length; a++) {
      for (let b = a + 1; b < this.bodies.length; b++) {
        if (root(a) === root(b) || !this.touching(a, b)) continue;
        parent[root(a)] = root(b);
      }
    }
    this.bodies.forEach((b, i) => (b.group = root(i)));
  }

  private touching(ia: number, ib: number): boolean {
    const A = this.bodies[ia];
    const B = this.bodies[ib];
    const d = CONTACT_DIST;
    if (A.maxX + d < B.minX || B.maxX + d < A.minX || A.maxY + d < B.minY || B.maxY + d < A.minY) return false;
    for (let i = A.first; i < A.first + A.count; i++) {
      // skip segments far from the other body's box
      if (
        Math.max(this.ax[i], this.bx[i]) + d < B.minX ||
        Math.min(this.ax[i], this.bx[i]) - d > B.maxX ||
        Math.max(this.ay[i], this.by[i]) + d < B.minY ||
        Math.min(this.ay[i], this.by[i]) - d > B.maxY
      )
        continue;
      for (let j = B.first; j < B.first + B.count; j++) {
        if (segmentsCross(this.ax[i], this.ay[i], this.bx[i], this.by[i], this.ax[j], this.ay[j], this.bx[j], this.by[j]))
          return true;
        const dist = Math.min(
          pointSegDist(this.ax[i], this.ay[i], this.ax[j], this.ay[j], this.bx[j], this.by[j]),
          pointSegDist(this.bx[i], this.by[i], this.ax[j], this.ay[j], this.bx[j], this.by[j]),
          pointSegDist(this.ax[j], this.ay[j], this.ax[i], this.ay[i], this.bx[i], this.by[i]),
          pointSegDist(this.bx[j], this.by[j], this.ax[i], this.ay[i], this.bx[i], this.by[i])
        );
        if (dist < d) return true;
      }
    }
    return false;
  }

  // Boundary element method: find the surface charge density on every
  // conductor so that each conductor is an equipotential. Isolated groups of
  // conductors keep their total charge, grounded ones are held at potential 0.
  private solve(cache?: SolverCache) {
    const n = this.nSeg;
    // one potential unknown per isolated group
    const groups = [...new Set(this.bodies.map((b) => b.group))];
    const grounded = new Set(this.bodies.filter((b) => b.grounded).map((b) => b.group));
    const unknownOf = new Map<number, number>();
    for (const g of groups) if (!grounded.has(g)) unknownOf.set(g, n + unknownOf.size);
    const N = n + unknownOf.size;
    const key = this.geometryKey();

    let lu: LU | null = cache && cache.key === key ? cache.lu : null;
    if (!lu) {
      const A = new Float64Array(N * N);
      for (let i = 0; i < n; i++) {
        const row = i * N;
        for (let j = 0; j < n; j++) A[row + j] = this.segPotential(j, this.mx[i], this.my[i]);
        // A tiny shift of the (positive) self term keeps the system regular
        // even when segments of two conductors lie exactly on top of each other.
        A[row + i] *= 1 + 1e-9;
        const u = unknownOf.get(this.bodies[this.segBody[i]].group);
        if (u !== undefined) A[row + u] = -1;
      }
      for (const [g, u] of unknownOf) {
        const row = u * N;
        for (const b of this.bodies) {
          if (b.group !== g) continue;
          for (let j = b.first; j < b.first + b.count; j++) A[row + j] = this.len[j];
        }
      }
      lu = luFactor(A, N);
      if (cache) {
        cache.key = key;
        cache.lu = lu;
      }
    }

    const rhs = new Float64Array(N);
    for (let i = 0; i < n; i++) {
      let phi = 0;
      for (const c of this.charges) {
        const r2 = (this.mx[i] - c.x) ** 2 + (this.my[i] - c.y) ** 2;
        phi -= c.q * Math.log(Math.max(r2, 1e-9) / (R0 * R0));
      }
      rhs[i] = -phi;
    }
    for (const b of this.bodies) {
      const u = unknownOf.get(b.group);
      if (u !== undefined) rhs[u] += b.q;
    }
    const sol = luSolve(lu, rhs);
    let max = 0;
    for (let i = 0; i < n; i++) {
      this.lambda[i] = sol[i];
      max = Math.max(max, Math.abs(sol[i]));
    }
    this.ok = Number.isFinite(max) && max < 1e3;
    for (const b of this.bodies) {
      const u = unknownOf.get(b.group);
      b.V = u === undefined ? 0 : sol[u];
    }

    for (const b of this.bodies) this.buildMultipole(b);
  }

  // The matrix only depends on the relative geometry, so the key is taken
  // relative to the first vertex: dragging a lone conductor reuses the LU.
  private geometryKey(): string {
    const parts: string[] = [];
    const ox = this.bodies.length ? this.bodies[0].xs[0] : 0;
    const oy = this.bodies.length ? this.bodies[0].ys[0] : 0;
    for (const b of this.bodies) {
      parts.push(b.grounded ? 'g' : 'i', String(b.xs.length), b.closed ? 'c' : 'o');
      for (let i = 0; i < b.xs.length; i++) parts.push((b.xs[i] - ox).toFixed(4), (b.ys[i] - oy).toFixed(4));
    }
    return parts.join(',');
  }

  // Potential at (x, y) of segment j carrying unit charge density.
  private segPotential(j: number, x: number, y: number): number {
    const dx = x - this.ax[j];
    const dy = y - this.ay[j];
    const c = this.cs[j];
    const s = this.sn[j];
    return segPotentialLocal(dx * c + dy * s, -dx * s + dy * c, this.len[j]);
  }

  // a_m = sum over segments of lambda * integral (z - z0)^m ds
  private buildMultipole(b: SolvedBody) {
    const { mre, mim } = b;
    mre.fill(0);
    mim.fill(0);
    for (let j = b.first; j < b.first + b.count; j++) {
      const l = this.lambda[j];
      const ar = this.ax[j] - b.cx;
      const ai = this.ay[j] - b.cy;
      const br = this.bx[j] - b.cx;
      const bi = this.by[j] - b.cy;
      // divide by e^{i theta} = multiply by e^{-i theta}
      const er = this.cs[j];
      const ei = -this.sn[j];
      let par = ar;
      let pai = ai;
      let pbr = br;
      let pbi = bi;
      for (let m = 0; m <= MULTIPOLE_ORDER; m++) {
        // (zb^{m+1} - za^{m+1}) / (m+1) / e^{i theta}
        const dr = (pbr - par) / (m + 1);
        const di = (pbi - pai) / (m + 1);
        mre[m] += l * (dr * er - di * ei);
        mim[m] += l * (dr * ei + di * er);
        const nar = par * ar - pai * ai;
        pai = par * ai + pai * ar;
        par = nar;
        const nbr = pbr * br - pbi * bi;
        pbi = pbr * bi + pbi * br;
        pbr = nbr;
      }
    }
  }

  // Uniqueness theorem: inside a closed conductor without charges or other
  // conductors in it, the field is exactly zero and the potential equals the
  // conductor's potential. Using that directly removes the small numerical
  // residual of the discretisation (no drifting probes in a Faraday cage).
  private findCavities() {
    this.bodies.forEach((b, bi) => {
      if (!b.closed || (b.shape.type !== 'circle' && b.shape.type !== 'rect')) return;
      for (const c of this.charges) if (this.insideShape(b, c.x, c.y, 0)) return;
      for (let oi = 0; oi < this.bodies.length; oi++) {
        const o = this.bodies[oi];
        // conductors touching the cage share its potential and do not
        // disturb the field-free interior, even where they reach into it
        if (oi === bi || o.group === b.group) continue;
        if (o.maxX < b.minX || o.minX > b.maxX || o.maxY < b.minY || o.minY > b.maxY) continue;
        for (let i = 0; i < o.xs.length; i++) if (this.insideShape(b, o.xs[i], o.ys[i], 0)) return;
      }
      b.cavity = true;
      this.cavities.push(bi);
    });
  }

  // Inside the conductor's polygon, shrunk by `inset` (negative grows it).
  private insideShape(b: SolvedBody, x: number, y: number, inset: number): boolean {
    const sh = b.shape;
    if (sh.type === 'circle') {
      // the polygon is inscribed in the circle
      const r = sh.r * Math.cos(Math.PI / b.count) - inset;
      const dx = x - sh.cx;
      const dy = y - sh.cy;
      return dx * dx + dy * dy < r * r;
    }
    if (sh.type === 'rect') {
      const dx = x - sh.cx;
      const dy = y - sh.cy;
      return (
        Math.abs(dx * sh.c + dy * sh.s) < sh.hw - inset && Math.abs(-dx * sh.s + dy * sh.c) < sh.hh - inset
      );
    }
    return false;
  }

  inCavity(x: number, y: number): boolean {
    return this.cavities.length > 0 && this.cavityAt(x, y) >= 0;
  }

  private cavityAt(x: number, y: number): number {
    for (const bi of this.cavities) {
      const b = this.bodies[bi];
      if (x > b.minX && x < b.maxX && y > b.minY && y < b.maxY && this.insideShape(b, x, y, 0)) return bi;
    }
    return -1;
  }

  // Electric field at (x, y), written into out[0], out[1].
  E(x: number, y: number, out: Float64Array | number[]): void {
    if (this.cavities.length && this.cavityAt(x, y) >= 0) {
      out[0] = 0;
      out[1] = 0;
      return;
    }
    let ex = 0;
    let ey = 0;
    for (const c of this.charges) {
      const dx = x - c.x;
      const dy = y - c.y;
      const r2 = dx * dx + dy * dy;
      if (r2 < 1e-9) continue;
      const f = (2 * c.q) / r2;
      ex += f * dx;
      ey += f * dy;
    }
    for (const b of this.bodies) {
      const wr = x - b.cx;
      const wi = y - b.cy;
      const w2 = wr * wr + wi * wi;
      const lim = MULTIPOLE_RADIUS * b.radius;
      if (w2 > lim * lim) {
        // conj(E) = 2 * sum a_m / w^{m+1}
        const ir = wr / w2;
        const ii = -wi / w2;
        let pr = ir;
        let pi = ii;
        let sr = 0;
        let si = 0;
        for (let m = 0; m <= MULTIPOLE_ORDER; m++) {
          sr += b.mre[m] * pr - b.mim[m] * pi;
          si += b.mre[m] * pi + b.mim[m] * pr;
          const npr = pr * ir - pi * ii;
          pi = pr * ii + pi * ir;
          pr = npr;
        }
        ex += 2 * sr;
        ey -= 2 * si;
        continue;
      }
      for (let j = b.first; j < b.first + b.count; j++) {
        const l = this.lambda[j];
        const L = this.len[j];
        const ddx = x - this.mx[j];
        const ddy = y - this.my[j];
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > NEAR_SEGMENT * L * L) {
          const f = (2 * l * L) / d2;
          ex += f * ddx;
          ey += f * ddy;
          continue;
        }
        const dx = x - this.ax[j];
        const dy = y - this.ay[j];
        const c = this.cs[j];
        const s = this.sn[j];
        const px = dx * c + dy * s;
        const py = -dx * s + dy * c;
        const r1 = px * px + py * py;
        const r2 = (px - L) * (px - L) + py * py;
        const el = r1 > 0 && r2 > 0 ? Math.log(r1 / r2) : 0;
        const et = 2 * (Math.atan2(py, px - L) - Math.atan2(py, px));
        ex += l * (el * c - et * s);
        ey += l * (el * s + et * c);
      }
    }
    out[0] = ex;
    out[1] = ey;
  }

  phi(x: number, y: number): number {
    if (this.cavities.length) {
      const cb = this.cavityAt(x, y);
      if (cb >= 0) return this.bodies[cb].V;
    }
    let v = 0;
    for (const c of this.charges) {
      const r2 = (x - c.x) ** 2 + (y - c.y) ** 2;
      v -= c.q * Math.log(Math.max(r2, 1e-9) / (R0 * R0));
    }
    for (const b of this.bodies) {
      const wr = x - b.cx;
      const wi = y - b.cy;
      const w2 = wr * wr + wi * wi;
      const lim = MULTIPOLE_RADIUS * b.radius;
      if (w2 > lim * lim) {
        // phi = -2 (Q ln(|w|/R0) - Re sum_{m>=1} a_m / (m w^m))
        const ir = wr / w2;
        const ii = -wi / w2;
        let pr = ir;
        let pi = ii;
        let s = 0;
        for (let m = 1; m <= MULTIPOLE_ORDER; m++) {
          s += (b.mre[m] * pr - b.mim[m] * pi) / m;
          const npr = pr * ir - pi * ii;
          pi = pr * ii + pi * ir;
          pr = npr;
        }
        v += -2 * (b.mre[0] * 0.5 * Math.log(w2 / (R0 * R0)) - s);
        continue;
      }
      for (let j = b.first; j < b.first + b.count; j++) {
        const L = this.len[j];
        const d2 = (x - this.mx[j]) ** 2 + (y - this.my[j]) ** 2;
        if (d2 > NEAR_SEGMENT * L * L) {
          v -= this.lambda[j] * L * Math.log(d2 / (R0 * R0));
        } else {
          v += this.lambda[j] * this.segPotential(j, x, y);
        }
      }
    }
    return v;
  }

  // Distance from (x, y) to the nearest conductor outline or point charge.
  nearestFeature(x: number, y: number): number {
    let d = Infinity;
    for (const c of this.charges) d = Math.min(d, Math.hypot(x - c.x, y - c.y));
    for (const b of this.bodies) d = Math.min(d, distToShape(b.shape, x, y));
    return d;
  }

  // First crossing of the path (x0,y0)->(x1,y1) with any conductor.
  // Returns the path parameter t in [0, 1] and the body index, or null.
  intersect(x0: number, y0: number, x1: number, y1: number): { t: number; body: number; seg: number } | null {
    let best: { t: number; body: number; seg: number } | null = null;
    const pminX = Math.min(x0, x1);
    const pmaxX = Math.max(x0, x1);
    const pminY = Math.min(y0, y1);
    const pmaxY = Math.max(y0, y1);
    this.bodies.forEach((b, bi) => {
      if (pmaxX < b.minX - 1 || pminX > b.maxX + 1 || pmaxY < b.minY - 1 || pminY > b.maxY + 1) return;
      const rx = x1 - x0;
      const ry = y1 - y0;
      for (let j = b.first; j < b.first + b.count; j++) {
        const sx = this.bx[j] - this.ax[j];
        const sy = this.by[j] - this.ay[j];
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-12) continue;
        const qx = this.ax[j] - x0;
        const qy = this.ay[j] - y0;
        const t = (qx * sy - qy * sx) / den;
        const u = (qx * ry - qy * rx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (!best || t < best.t)) best = { t, body: bi, seg: j };
      }
    });
    return best;
  }

  // Distance from a point to the actual polyline of a body.
  distToBody(bi: number, x: number, y: number): number {
    const b = this.bodies[bi];
    let d = Infinity;
    for (let j = b.first; j < b.first + b.count; j++) {
      d = Math.min(d, pointSegDist(x, y, this.ax[j], this.ay[j], this.bx[j], this.by[j]));
    }
    return d;
  }

  // Net charge carried by the conductor bodies of one scene object.
  netCharge(objectId: number): number {
    let q = 0;
    for (const b of this.bodies) {
      if (b.objectId !== objectId) continue;
      for (let j = b.first; j < b.first + b.count; j++) q += this.lambda[j] * this.len[j];
    }
    return q;
  }
}

export interface SolverCache {
  key: string;
  lu: LU | null;
}

export function createSolverCache(): SolverCache {
  return { key: '', lu: null };
}
