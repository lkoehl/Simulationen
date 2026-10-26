import type { Field } from '../physics/field';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type LineEnd = 'charge' | 'conductor' | 'bounds' | 'stall' | 'max';

export interface FieldLine {
  pts: number[]; // flat x, y
  forward: boolean; // traced along the field (true) or against it
  end: LineEnd;
  endBody: number; // conductor the line ends on, or -1
}

// Point on a conductor surface, offset to one side, with the outward flux
// through that side. Used for seeding field lines and for drawing the
// influenced surface charges.
export interface SurfaceSample {
  x: number;
  y: number;
  nx: number; // unit normal pointing away from the conductor on this side
  ny: number;
  flux: number; // > 0: field leaves the surface (positive surface charge)
  segLen: number;
  tx: number;
  ty: number;
  body: number;
  closed: boolean; // the side is a closed loop
}

export const FLUX_PER_CHARGE = 4 * Math.PI;
const SIDE_OFFSET = 0.6;
// Backstops so that no configuration can freeze the page.
const MAX_SEEDS = 1500;
const STEP_BUDGET = 400000;

// Both sides of every conductor, each walked in a continuous order. The chain
// holds side +1 followed by side -1, each with one sample per segment.
export function surfaceSamples(field: Field): SurfaceSample[][] {
  const out: SurfaceSample[][] = [];
  const e = [0, 0];
  const e2 = [0, 0];
  field.bodies.forEach((b, bi) => {
    const sides: SurfaceSample[] = [];
    // Closed boxes start at the middle of an edge, a symmetry point of the box.
    let start = 0;
    if (b.closed && b.shape.type === 'rect') {
      const { cx, cy, hh, c, s } = b.shape;
      const tx = cx + hh * s;
      const ty = cy - hh * c;
      let best = Infinity;
      for (let i = 0; i < b.count; i++) {
        const d = Math.hypot(field.ax[b.first + i] - tx, field.ay[b.first + i] - ty);
        if (d < best) {
          best = d;
          start = i;
        }
      }
    }
    // Flux through each side of each segment: the mean of the field on both
    // sides plus the exact jump of a charged sheet, 2*pi*lambda. Both sides
    // together give exactly 4*pi times the segment's charge.
    const fluxPlus = new Float64Array(b.count);
    const fluxMinus = new Float64Array(b.count);
    for (let i = 0; i < b.count; i++) {
      const j = b.first + i;
      const nx = -field.sn[j];
      const ny = field.cs[j];
      const mx = field.mx[j];
      const my = field.my[j];
      const cover = covered(field, bi, mx, my, nx, ny);
      if (cover === 'duplicate') continue;
      field.E(mx + nx * SIDE_OFFSET, my + ny * SIDE_OFFSET, e);
      field.E(mx - nx * SIDE_OFFSET, my - ny * SIDE_OFFSET, e2);
      const L = field.len[j];
      if (cover === 'coincident') {
        // another conductor lies on top: measure each side directly
        fluxPlus[i] = (e[0] * nx + e[1] * ny) * L;
        fluxMinus[i] = -(e2[0] * nx + e2[1] * ny) * L;
        continue;
      }
      const mean = ((e[0] + e2[0]) / 2) * nx + ((e[1] + e2[1]) / 2) * ny;
      const jump = 2 * Math.PI * field.lambda[j];
      // a side facing into a touching conductor carries no flux
      fluxPlus[i] = cover === 'plus' || cover === 'both' ? 0 : (mean + jump) * L;
      fluxMinus[i] = cover === 'minus' || cover === 'both' ? 0 : (-mean + jump) * L;
    }
    for (const side of [1, -1]) {
      const order: number[] = [];
      for (let i = 0; i < b.count; i++) order.push((i + start) % b.count);
      // for open conductors walk back along the other side, round the tip
      if (side === -1 && !b.closed) order.reverse();
      for (const i of order) {
        const j = b.first + i;
        const tx = field.cs[j];
        const ty = field.sn[j];
        const nx = -ty * side;
        const ny = tx * side;
        sides.push({
          x: field.mx[j],
          y: field.my[j],
          nx,
          ny,
          flux: side === 1 ? fluxPlus[i] : fluxMinus[i],
          segLen: field.len[j],
          tx: side === -1 && !b.closed ? -tx : tx,
          ty: side === -1 && !b.closed ? -ty : ty,
          body: bi,
          closed: b.closed
        });
      }
    }
    out.push(sides);
  });
  return out;
}

// Checks whether another conductor lies on top of a segment ('coincident';
// only the lower-numbered conductor counts it, the other is a 'duplicate')
// or right in front of one of its sides ('plus', 'minus', 'both').
function covered(field: Field, bi: number, mx: number, my: number, nx: number, ny: number) {
  let plus = false;
  let minus = false;
  for (let oi = 0; oi < field.bodies.length; oi++) {
    if (oi === bi) continue;
    const o = field.bodies[oi];
    const r = SIDE_OFFSET + 1;
    if (mx < o.minX - r || mx > o.maxX + r || my < o.minY - r || my > o.maxY + r) continue;
    if (field.distToBody(oi, mx, my) < 1e-3) return oi < bi ? 'duplicate' : 'coincident';
    if (crosses(field, oi, mx, my, mx + nx * SIDE_OFFSET, my + ny * SIDE_OFFSET)) plus = true;
    if (crosses(field, oi, mx, my, mx - nx * SIDE_OFFSET, my - ny * SIDE_OFFSET)) minus = true;
  }
  return plus && minus ? 'both' : plus ? 'plus' : minus ? 'minus' : 'free';
}

function crosses(field: Field, oi: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const o = field.bodies[oi];
  const rx = x1 - x0;
  const ry = y1 - y0;
  for (let j = o.first; j < o.first + o.count; j++) {
    const sx = field.bx[j] - field.ax[j];
    const sy = field.by[j] - field.ay[j];
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) continue;
    const qx = field.ax[j] - x0;
    const qy = field.ay[j] - y0;
    const t = (qx * sy - qy * sx) / den;
    const u = (qx * ry - qy * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
  }
  return false;
}

// Places points along a conductor so that every point stands for the same
// amount of flux of the requested sign. Each connected region of that sign is
// handled on its own and its points are centred within their shares, so
// symmetric charge distributions give symmetric points and tiny regions (less
// than 3/4 of a quantum) give none. `emit` may return false to stop early.
export function distribute(
  chain: SurfaceSample[],
  quantum: number,
  sign: 1 | -1,
  emit: (s: SurfaceSample, x: number, y: number) => boolean | void
): boolean {
  if (chain.length === 0) return true;
  const half = chain.length / 2;
  const sides = [chain.slice(0, half), chain.slice(half)];
  const threshold = 0.75 * quantum * (1 - 1e-9);
  const flux = (side: SurfaceSample[]) => side.reduce((a, s) => a + Math.max(0, s.flux * sign), 0);

  let loops: SurfaceSample[][];
  if (chain[0].closed) {
    // inner and outer face of a ring or box
    loops = sides;
  } else if (chain.some((s) => s.flux * sign <= 0)) {
    // The two faces of a plate meet at its tips: one loop, so a region
    // reaching round a tip is not cut in two.
    loops = [chain];
  } else {
    // The whole plate carries this sign: centre each face on its own, but
    // round the number of points for the plate as a whole.
    const tot = sides.map(flux);
    const f = tot.map((t) => t / quantum);
    if (f[0] + f[1] < 0.75 * (1 - 1e-9)) return true;
    const n = f.map(Math.floor);
    let extra = Math.max(1, Math.round(f[0] + f[1])) - n[0] - n[1];
    for (const i of f[0] - n[0] >= f[1] - n[1] ? [0, 1] : [1, 0]) if (extra-- > 0) n[i]++;
    for (let i = 0; i < 2; i++) if (n[i] > 0 && !emitRegion(sides[i], tot[i], n[i], sign, emit)) return false;
    return true;
  }

  for (let loop of loops) {
    const k = loop.findIndex((s) => s.flux * sign <= 0);
    if (k < 0) {
      // the whole loop is one region
      const total = flux(loop);
      if (total >= threshold && !emitRegion(loop, total, Math.max(1, Math.round(total / quantum)), sign, emit)) return false;
      continue;
    }
    // start outside any region so none is cut in two
    if (k > 0) loop = loop.slice(k).concat(loop.slice(0, k));
    let i = 0;
    while (i < loop.length) {
      if (loop[i].flux * sign <= 0) {
        i++;
        continue;
      }
      let j = i;
      let total = 0;
      while (j < loop.length && loop[j].flux * sign > 0) total += loop[j++].flux * sign;
      if (total >= threshold && !emitRegion(loop.slice(i, j), total, Math.max(1, Math.round(total / quantum)), sign, emit))
        return false;
      i = j;
    }
  }
  return true;
}

function emitRegion(
  region: SurfaceSample[],
  total: number,
  n: number,
  sign: 1 | -1,
  emit: (s: SurfaceSample, x: number, y: number) => boolean | void
): boolean {
  const step = total / n;
  let target = step / 2;
  let acc = 0;
  for (const s of region) {
    const f = s.flux * sign;
    while (target <= acc + f && target < total) {
      // position along the segment, centred on its midpoint
      const t = Math.max(0, Math.min(1, (target - acc) / f)) - 0.5;
      if (emit(s, s.x + s.tx * t * s.segLen, s.y + s.ty * t * s.segLen) === false) return false;
      target += step;
    }
    acc += f;
  }
  return true;
}

interface Seed {
  x: number;
  y: number;
  // start the polyline at the centre of the source charge
  originX?: number;
  originY?: number;
  charge: number; // index of the source charge, or -1
  body: number; // index of the source conductor, or -1
}

function seedsFor(field: Field, surfaces: SurfaceSample[][], fluxPerLine: number, sign: 1 | -1, limit: number) {
  const seeds: Seed[] = [];
  const ext = [0, 0];
  field.charges.forEach((c, ci) => {
    if (c.q * sign <= 0) return;
    const n = Math.max(1, Math.round((Math.abs(c.q) * FLUX_PER_CHARGE) / fluxPerLine));
    // Align the pattern with the field of all other sources at the charge,
    // offset by half a step, so symmetric setups get symmetric pictures and
    // the fan turns smoothly while something is dragged.
    field.E(c.x, c.y, ext);
    const base = Math.hypot(ext[0], ext[1]) > 1e-12 ? Math.atan2(ext[1], ext[0]) : 0;
    const r = 3;
    for (let i = 0; i < n && seeds.length < limit; i++) {
      const a = base + ((i + 0.5) / n) * 2 * Math.PI;
      const x = c.x + r * Math.cos(a);
      const y = c.y + r * Math.sin(a);
      // a charge lying on metal: no lines through the metal
      if (field.intersect(c.x, c.y, x, y)) continue;
      seeds.push({ x, y, originX: c.x, originY: c.y, charge: ci, body: -1 });
    }
  });
  for (const chain of surfaces) {
    const go = distribute(chain, fluxPerLine, sign, (s, x, y) => {
      if (seeds.length >= limit) return false;
      seeds.push({ x: x + s.nx * SIDE_OFFSET, y: y + s.ny * SIDE_OFFSET, originX: x, originY: y, charge: -1, body: s.body });
    });
    if (!go) break;
  }
  return seeds;
}

export function computeFieldLines(
  field: Field,
  surfaces: SurfaceSample[][],
  linesPerCharge: number,
  bounds: Bounds
): FieldLine[] {
  const fluxPerLine = FLUX_PER_CHARGE / linesPerCharge;
  const budget = { steps: STEP_BUDGET };

  // Lines start at every positive source. Lines are also traced backwards
  // from every negative sink; those that end on a positive source duplicate
  // a forward line and are dropped, the others (coming in from far away) stay.
  // Tracing from both ends keeps symmetric setups symmetric.
  const plus = seedsFor(field, surfaces, fluxPerLine, 1, MAX_SEEDS);
  const minus = seedsFor(field, surfaces, fluxPerLine, -1, MAX_SEEDS - plus.length);

  // Between two conductors the lines are spaced by the one with less charge
  // of its own (a neutral cage rather than the capacitor plate), so swapping
  // + and − gives the mirrored picture.
  const groundedGroups = new Set(field.bodies.filter((b) => b.grounded).map((b) => b.group));
  const weight = field.bodies.map((b) => {
    if (groundedGroups.has(b.group)) return Infinity;
    let q = 0;
    for (let j = b.first; j < b.first + b.count; j++) q += field.lambda[j] * field.len[j];
    return Math.abs(q);
  });
  const between = (from: number, l: FieldLine) => from >= 0 && l.end === 'conductor' && l.endBody >= 0;

  const lines: FieldLine[] = [];
  for (const s of plus) {
    const l = traceLine(field, s, true, bounds, budget);
    if (between(s.body, l) && weight[s.body] > weight[l.endBody] + 1e-6) continue;
    lines.push(l);
  }
  const dropped = new Map<number, FieldLine[]>();
  const kept = new Map<number, number>();
  for (const s of minus) {
    const l = traceLine(field, s, false, bounds, budget);
    const keep =
      (l.end !== 'charge' && l.end !== 'conductor') || (between(s.body, l) && weight[s.body] < weight[l.endBody] - 1e-6);
    if (keep) {
      lines.push(l);
      if (s.charge >= 0) kept.set(s.charge, (kept.get(s.charge) ?? 0) + 1);
    } else if (s.charge >= 0) {
      dropped.set(s.charge, [...(dropped.get(s.charge) ?? []), l]);
    }
  }

  // A small negative charge among several sources may be missed by every
  // forward line. It still gets some of its own lines.
  for (const [ci, own] of dropped) {
    const c = field.charges[ci];
    const arriving = lines.filter((l) => l.forward && l.end === 'charge' && endsAt(l, c.x, c.y)).length;
    if (arriving + (kept.get(ci) ?? 0) > 0) continue;
    const want = Math.ceil(own.length / 2);
    for (let k = 0; k < want; k++) lines.push(own[Math.floor((k * own.length) / want)]);
  }
  return lines;
}

function endsAt(l: FieldLine, x: number, y: number) {
  const n = l.pts.length;
  return Math.abs(l.pts[n - 2] - x) < 1e-9 && Math.abs(l.pts[n - 1] - y) < 1e-9;
}

const MAX_LENGTH = 6000;
const MAX_STEPS = 5000;

function traceLine(field: Field, seed: Seed, forward: boolean, bounds: Bounds, budget: { steps: number }): FieldLine {
  const dir = forward ? 1 : -1;
  const pts: number[] = [];
  if (seed.originX !== undefined) pts.push(seed.originX, seed.originY!);
  pts.push(seed.x, seed.y);

  const e = [0, 0];
  const f = (x: number, y: number, out: number[]) => {
    field.E(x, y, e);
    const m = Math.hypot(e[0], e[1]);
    if (!(m > 1e-14)) return false;
    out[0] = (dir * e[0]) / m;
    out[1] = (dir * e[1]) / m;
    return true;
  };
  let endBody = -1;
  const nearMetal = () => {
    endBody = field.bodies.findIndex((_, bi) => field.distToBody(bi, x, y) < 1.5);
    return endBody >= 0;
  };

  const k1 = [0, 0];
  const k2 = [0, 0];
  const k3 = [0, 0];
  const k4 = [0, 0];
  let x = seed.x;
  let y = seed.y;
  let length = 0;
  let px = 0;
  let py = 0;
  const minStep = 0.6;
  const maxStep = 9;
  let end: LineEnd = 'max';

  for (let step = 0; step < MAX_STEPS && length < MAX_LENGTH && budget.steps > 0; step++, budget.steps--) {
    const d = field.nearestFeature(x, y);
    const h = Math.max(minStep, Math.min(maxStep, 0.3 * d));
    if (!f(x, y, k1)) {
      end = nearMetal() ? 'conductor' : 'stall';
      break;
    }
    // Close to metal: check the plain Euler step first, so a line running
    // into a conductor ends there instead of stalling in front of it.
    if (d <= 1.05 * h) {
      const hit = field.intersect(x, y, x + h * k1[0], y + h * k1[1]);
      if (hit) {
        pts.push(x + h * k1[0] * hit.t, y + h * k1[1] * hit.t);
        end = 'conductor';
        endBody = hit.body;
        break;
      }
    }
    if (
      !f(x + 0.5 * h * k1[0], y + 0.5 * h * k1[1], k2) ||
      !f(x + 0.5 * h * k2[0], y + 0.5 * h * k2[1], k3) ||
      !f(x + h * k3[0], y + h * k3[1], k4)
    ) {
      end = nearMetal() ? 'conductor' : 'stall';
      break;
    }
    const dx = (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    const dy = (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    const dl = Math.hypot(dx, dy);
    // RK4 directions cancelling out, or the direction flipping back:
    // we are sitting on a stagnation point
    if (dl < 0.3 * h || (length > 0 && dx * px + dy * py < -0.2 * dl * Math.hypot(px, py))) {
      end = nearMetal() ? 'conductor' : 'stall';
      break;
    }

    const nx = x + dx;
    const ny = y + dy;

    const hit = field.intersect(x, y, nx, ny);
    if (hit) {
      pts.push(x + dx * hit.t, y + dy * hit.t);
      end = 'conductor';
      endBody = hit.body;
      break;
    }

    // Reaching a sink (or a source when tracing backwards)?
    let sink = -1;
    for (let i = 0; i < field.charges.length; i++) {
      const c = field.charges[i];
      if (c.q * dir >= 0) continue;
      if (Math.hypot(nx - c.x, ny - c.y) < Math.max(3, 1.2 * h) && !field.intersect(nx, ny, c.x, c.y)) {
        sink = i;
        break;
      }
    }
    if (sink >= 0) {
      pts.push(field.charges[sink].x, field.charges[sink].y);
      end = 'charge';
      break;
    }

    pts.push(nx, ny);
    length += dl;
    px = dx;
    py = dy;
    x = nx;
    y = ny;
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
      end = 'bounds';
      break;
    }
  }
  return { pts, forward, end, endBody };
}
