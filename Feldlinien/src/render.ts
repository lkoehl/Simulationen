import type { Field } from './physics/field';
import { CHARGE_RADIUS, PROBE_RADIUS } from './physics/probes';
import { capacitorPlates, type Capacitor, type ConductorObject, type Probe, type SceneObject } from './physics/scene';
import { distribute, FLUX_PER_CHARGE, type FieldLine, type SurfaceSample } from './viz/fieldlines';

export interface View {
  width: number; // css px
  height: number;
  dpr: number;
  zoom: number; // css px per world unit
}

export interface Colors {
  fieldBg: string;
  gridMinor: string;
  gridMajor: string;
  line: string;
  pos: string;
  neg: string;
  metal: string;
  metalHi: string;
  probe: string;
  probeInk: string;
  force: string;
  equi: string;
  vector: string;
  select: string;
  trail: string;
  chargeGlyph: string;
  ink: string;
}

export function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    fieldBg: v('--field-bg'),
    gridMinor: v('--grid-minor'),
    gridMajor: v('--grid-major'),
    line: v('--line'),
    pos: v('--pos'),
    neg: v('--neg'),
    metal: v('--metal'),
    metalHi: v('--metal-hi'),
    probe: v('--probe'),
    probeInk: v('--probe-ink'),
    force: v('--force'),
    equi: v('--equi'),
    vector: v('--vector'),
    select: v('--select'),
    trail: v('--trail'),
    chargeGlyph: v('--charge-glyph'),
    ink: v('--ink')
  };
}

export interface Show {
  lines: boolean;
  vectors: boolean;
  equi: boolean;
  induced: boolean;
  force: boolean;
  trails: boolean;
}

export interface FieldPicture {
  lines: FieldLine[];
  equi: Float32Array | null;
  vectors: { x: number; y: number; ex: number; ey: number }[] | null;
  surfaces: SurfaceSample[][];
}

export interface Frame {
  objects: SceneObject[];
  field: Field;
  picture: FieldPicture;
  show: Show;
  selectedId: number | null;
  removingId: number | null; // object dragged outside the field
}

const FONT = "'Atkinson Hyperlegible', system-ui, sans-serif";

export function draw(ctx: CanvasRenderingContext2D, view: View, frame: Frame, col: Colors) {
  const { width, height, dpr, zoom } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = col.fieldBg;
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, view, col);

  // world transform: origin in the centre
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, (dpr * width) / 2, (dpr * height) / 2);
  // Annotations (labels, signs, line widths) are at least one css pixel per
  // unit and grow with the zoom on large screens, so they stay readable on a beamer.
  const px = Math.max(1, zoom) / zoom;

  const { picture, show } = frame;
  if (show.equi && picture.equi) drawEquipotentials(ctx, picture.equi, col, px);
  if (show.vectors && picture.vectors) drawVectors(ctx, picture.vectors, col, px);
  if (show.lines) drawFieldLines(ctx, picture.lines, col, px);

  if (show.trails) {
    for (const o of frame.objects) if (o.kind === 'probe') drawTrail(ctx, o, col, px);
  }

  for (const o of frame.objects) {
    if (o.kind === 'charge' || o.kind === 'probe') continue;
    ctx.globalAlpha = o.id === frame.removingId ? 0.35 : 1;
    drawConductor(ctx, o, frame, col, px);
  }
  ctx.globalAlpha = 1;
  if (show.induced) drawSurfaceCharges(ctx, picture.surfaces, col, px);
  for (const o of frame.objects) if (o.kind === 'capacitor') drawCapacitorSigns(ctx, o, col, px);

  for (const o of frame.objects) {
    if (o.kind !== 'charge') continue;
    ctx.globalAlpha = o.id === frame.removingId ? 0.35 : 1;
    const selected = o.id === frame.selectedId;
    if (selected) selectionRing(ctx, o.x, o.y, CHARGE_RADIUS + 6 * px, col, px);
    drawCharge(ctx, o.x, o.y, o.q, col, px);
  }
  for (const o of frame.objects) {
    if (o.kind !== 'probe') continue;
    ctx.globalAlpha = o.id === frame.removingId ? 0.35 : 1;
    if (o.id === frame.selectedId) selectionRing(ctx, o.x, o.y, PROBE_RADIUS + 6 * px, col, px);
    drawProbe(ctx, o, frame.field, show.force, col, px);
  }
  ctx.globalAlpha = 1;
}

function drawGrid(ctx: CanvasRenderingContext2D, view: View, col: Colors) {
  const { width, height, zoom } = view;
  const cx = width / 2;
  const cy = height / 2;
  const minor = 10 * zoom;
  ctx.lineWidth = 1;
  for (const [step, color] of [
    [minor, col.gridMinor],
    [minor * 5, col.gridMajor]
  ] as const) {
    if (step < 5) continue;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let x = cx % step; x < width; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
    }
    for (let y = cy % step; y < height; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }
}

function drawFieldLines(ctx: CanvasRenderingContext2D, lines: FieldLine[], col: Colors, px: number) {
  ctx.strokeStyle = col.line;
  ctx.lineWidth = 1.7 * px;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const l of lines) {
    const p = l.pts;
    if (p.length < 4) continue;
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  }
  ctx.stroke();

  // arrowheads in field direction, spaced along each line
  ctx.fillStyle = col.line;
  ctx.beginPath();
  const spacing = 200 * px;
  for (const l of lines) {
    const p = l.pts;
    let total = 0;
    for (let i = 2; i < p.length; i += 2) total += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    if (total < 30 * px) continue;
    const count = Math.max(1, Math.floor(total / spacing));
    const targets: number[] = [];
    for (let k = 0; k < count; k++) targets.push(((k + 0.5) / count) * total);
    let acc = 0;
    let t = 0;
    for (let i = 2; i < p.length && t < targets.length; i += 2) {
      const dx = p[i] - p[i - 2];
      const dy = p[i + 1] - p[i - 1];
      const d = Math.hypot(dx, dy);
      while (t < targets.length && acc + d >= targets[t]) {
        const f = d > 0 ? (targets[t] - acc) / d : 0;
        const s = l.forward ? 1 : -1;
        arrowPath(ctx, p[i - 2] + dx * f, p[i - 1] + dy * f, (s * dx) / d, (s * dy) / d, 7.5 * px);
        t++;
      }
      acc += d;
    }
  }
  ctx.fill();
}

function arrowPath(ctx: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number, size: number) {
  ctx.moveTo(x + ux * size, y + uy * size);
  ctx.lineTo(x - ux * size * 0.6 - uy * size * 0.6, y - uy * size * 0.6 + ux * size * 0.6);
  ctx.lineTo(x - ux * size * 0.6 + uy * size * 0.6, y - uy * size * 0.6 - ux * size * 0.6);
  ctx.closePath();
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number, size: number) {
  ctx.beginPath();
  arrowPath(ctx, x, y, ux, uy, size);
  ctx.fill();
}

function drawEquipotentials(ctx: CanvasRenderingContext2D, seg: Float32Array, col: Colors, px: number) {
  ctx.strokeStyle = col.equi;
  ctx.lineWidth = 1.4 * px;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  for (let i = 0; i < seg.length; i += 4) {
    ctx.moveTo(seg[i], seg[i + 1]);
    ctx.lineTo(seg[i + 2], seg[i + 3]);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// PhET-style vectors: equal length, brightness shows the field strength.
function drawVectors(
  ctx: CanvasRenderingContext2D,
  vectors: { x: number; y: number; ex: number; ey: number }[],
  col: Colors,
  px: number
) {
  const ref = 0.04;
  const len = 26 * px;
  ctx.strokeStyle = col.vector;
  ctx.fillStyle = col.vector;
  ctx.lineWidth = 2 * px;
  for (const v of vectors) {
    const m = Math.hypot(v.ex, v.ey);
    if (m < 1e-9) continue;
    const a = Math.min(1, Math.pow(m / ref, 0.6));
    if (a < 0.04) continue;
    ctx.globalAlpha = a * 0.75;
    const ux = v.ex / m;
    const uy = v.ey / m;
    const x0 = v.x - (ux * len) / 2;
    const y0 = v.y - (uy * len) / 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(v.x + ux * len * 0.25, v.y + uy * len * 0.25);
    ctx.stroke();
    arrowHead(ctx, v.x + ux * len * 0.3, v.y + uy * len * 0.3, ux, uy, 7 * px);
  }
  ctx.globalAlpha = 1;
}

function drawTrail(ctx: CanvasRenderingContext2D, p: Probe, col: Colors, px: number) {
  const t = p.trail;
  if (t.length < 4) return;
  ctx.strokeStyle = col.trail;
  ctx.lineWidth = 3 * px;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(t[0], t[1]);
  for (let i = 2; i < t.length; i += 2) ctx.lineTo(t[i], t[i + 1]);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // start marker
  ctx.strokeStyle = col.trail;
  ctx.lineWidth = 2 * px;
  ctx.beginPath();
  ctx.arc(p.startX, p.startY, 4 * px, 0, Math.PI * 2);
  ctx.stroke();
}

function polylinePath(ctx: CanvasRenderingContext2D, field: Field, objectId: number) {
  for (const b of field.bodies) {
    if (b.objectId !== objectId) continue;
    ctx.moveTo(b.xs[0], b.ys[0]);
    for (let i = 1; i < b.xs.length; i++) ctx.lineTo(b.xs[i], b.ys[i]);
    if (b.closed) ctx.closePath();
  }
}

function drawConductor(ctx: CanvasRenderingContext2D, o: ConductorObject, frame: Frame, col: Colors, px: number) {
  const field = frame.field;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const w = Math.max(6, 7 * px);

  if (o.id === frame.selectedId) {
    ctx.strokeStyle = col.select;
    ctx.globalAlpha *= 0.5;
    ctx.lineWidth = w + 6 * px;
    ctx.beginPath();
    polylinePath(ctx, field, o.id);
    ctx.stroke();
    ctx.globalAlpha = o.id === frame.removingId ? 0.35 : 1;
  }

  ctx.strokeStyle = col.metal;
  ctx.lineWidth = w;
  ctx.beginPath();
  polylinePath(ctx, field, o.id);
  ctx.stroke();
  ctx.strokeStyle = col.metalHi;
  ctx.lineWidth = w * 0.3;
  ctx.beginPath();
  polylinePath(ctx, field, o.id);
  ctx.stroke();

  if (o.kind !== 'capacitor' && o.grounded) drawGround(ctx, o, col, px);
}

// Big + and − next to the capacitor plates, with a halo so field lines
// running underneath do not cut through them.
function drawCapacitorSigns(ctx: CanvasRenderingContext2D, o: Capacitor, col: Colors, px: number) {
  if (o.q === 0) return;
  const { plus, minus } = capacitorPlates(o);
  const nx = plus.x - minus.x;
  const ny = plus.y - minus.y;
  const d = Math.hypot(nx, ny) || 1;
  const off = 36 * px;
  const size = 14 * px;
  for (const [x, y, sign] of [
    [plus.x + (nx / d) * off, plus.y + (ny / d) * off, Math.sign(o.q)],
    [minus.x - (nx / d) * off, minus.y - (ny / d) * off, -Math.sign(o.q)]
  ]) {
    signGlyph(ctx, x, y, sign, size, col.fieldBg, 9 * px);
    signGlyph(ctx, x, y, sign, size, sign > 0 ? col.pos : col.neg, 3.2 * px);
  }
}

function groundAnchor(o: ConductorObject): { x: number; y: number } {
  if (o.kind === 'ring') return { x: o.x, y: o.y + o.radius };
  if (o.kind === 'box') {
    // lowest corner
    const c = Math.cos((o.angle * Math.PI) / 180);
    const s = Math.sin((o.angle * Math.PI) / 180);
    let best = { x: o.x, y: -Infinity };
    for (const [lx, ly] of [
      [-o.width / 2, -o.height / 2],
      [o.width / 2, -o.height / 2],
      [o.width / 2, o.height / 2],
      [-o.width / 2, o.height / 2]
    ]) {
      const y = o.y + lx * s + ly * c;
      if (y > best.y) best = { x: o.x + lx * c - ly * s, y };
    }
    return best;
  }
  if (o.kind === 'plate') {
    const c = Math.cos((o.angle * Math.PI) / 180);
    const s = Math.sin((o.angle * Math.PI) / 180);
    const a = { x: o.x + (c * o.length) / 2, y: o.y + (s * o.length) / 2 };
    const b = { x: o.x - (c * o.length) / 2, y: o.y - (s * o.length) / 2 };
    return a.y >= b.y ? a : b;
  }
  return { x: o.x, y: o.y };
}

function drawGround(ctx: CanvasRenderingContext2D, o: ConductorObject, col: Colors, px: number) {
  const a = groundAnchor(o);
  const stem = 22 * px;
  ctx.strokeStyle = col.ink;
  ctx.lineWidth = 2 * px;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(a.x, a.y + stem);
  for (let i = 0; i < 3; i++) {
    const hw = (12 - i * 4) * px;
    const y = a.y + stem + i * 5 * px;
    ctx.moveTo(a.x - hw, y);
    ctx.lineTo(a.x + hw, y);
  }
  ctx.stroke();
  ctx.lineCap = 'round';
}

// Influenced and free charges on conductors as small + and − signs,
// one sign per 0.15 charge units on each side of the metal.
const MAX_SIGNS = 3000;

function drawSurfaceCharges(ctx: CanvasRenderingContext2D, surfaces: SurfaceSample[][], col: Colors, px: number) {
  const quantum = FLUX_PER_CHARGE * 0.15;
  const off = 11 * px;
  const size = 4.5 * px;
  let count = 0;
  for (const chain of surfaces) {
    for (const sign of [1, -1] as const) {
      ctx.strokeStyle = sign > 0 ? col.pos : col.neg;
      ctx.lineWidth = 2.3 * px;
      ctx.beginPath();
      distribute(chain, quantum, sign, (s, x, y) => {
        if (++count > MAX_SIGNS) return false;
        const cx = x + s.nx * off;
        const cy = y + s.ny * off;
        ctx.moveTo(cx - size, cy);
        ctx.lineTo(cx + size, cy);
        if (sign > 0) {
          ctx.moveTo(cx, cy - size);
          ctx.lineTo(cx, cy + size);
        }
      });
      ctx.stroke();
    }
  }
}

function signGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sign: number,
  size: number,
  color: string,
  width: number
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - size / 2, y);
  ctx.lineTo(x + size / 2, y);
  if (sign > 0) {
    ctx.moveTo(x, y - size / 2);
    ctx.lineTo(x, y + size / 2);
  }
  ctx.stroke();
}

function selectionRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: Colors, px: number) {
  ctx.strokeStyle = col.select;
  ctx.lineWidth = 3 * px;
  ctx.setLineDash([5 * px, 4 * px]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCharge(ctx: CanvasRenderingContext2D, x: number, y: number, q: number, col: Colors, px: number) {
  const r = CHARGE_RADIUS;
  const base = q > 0 ? col.pos : col.neg;
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // soft highlight for a bit of volume
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, col.chargeGlyph === '#ffffff' ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fill();
  signGlyph(ctx, x, y, q, r * 0.95, col.chargeGlyph, 3 * Math.min(px, 1.3));

  const label = (q > 0 ? '+' : '−') + formatNumber(Math.abs(q));
  ctx.font = `700 ${14 * px}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3 * px;
  ctx.strokeStyle = col.fieldBg;
  ctx.lineJoin = 'round';
  const lx = x + r + 3 * px;
  const ly = y + r * 0.85;
  ctx.strokeText(label, lx, ly);
  ctx.fillStyle = base;
  ctx.fillText(label, lx, ly);
}

const forceVec = [0, 0];

// How far a ray from the probe edge can go before it runs into a charge or metal.
function freeDistance(field: Field, p: Probe, ux: number, uy: number, max: number): number {
  let free = max;
  for (const c of field.charges) {
    // ray-circle intersection with the drawn charge
    const ox = p.x - c.x;
    const oy = p.y - c.y;
    const b = ox * ux + oy * uy;
    const disc = b * b - (ox * ox + oy * oy - CHARGE_RADIUS * CHARGE_RADIUS);
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0) free = Math.min(free, t - PROBE_RADIUS);
  }
  const reach = PROBE_RADIUS + max;
  const hit = field.intersect(p.x, p.y, p.x + ux * reach, p.y + uy * reach);
  if (hit) free = Math.min(free, hit.t * reach - PROBE_RADIUS - 3);
  return free;
}

function drawProbe(ctx: CanvasRenderingContext2D, p: Probe, field: Field, showForce: boolean, col: Colors, px: number) {
  if (showForce) {
    field.E(p.x, p.y, forceVec);
    const fx = p.sign * forceVec[0];
    const fy = p.sign * forceVec[1];
    const m = Math.hypot(fx, fy);
    const ux = fx / m;
    const uy = fy / m;
    // proportional to the force, 30 units for the field of a unit charge at
    // 100 units, but never through a charge or a plate
    let len = Math.min(140, (30 * m) / 0.02);
    if (len > 3) {
      const free = freeDistance(field, p, ux, uy, len);
      len = free < 8 ? 0 : Math.min(len, free);
    }
    if (len > 3) {
      const head = Math.min(12 * px, len * 0.45);
      ctx.strokeStyle = col.force;
      ctx.fillStyle = col.force;
      ctx.lineWidth = 3.5 * px;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x + ux * PROBE_RADIUS, p.y + uy * PROBE_RADIUS);
      ctx.lineTo(p.x + ux * (PROBE_RADIUS + len - head), p.y + uy * (PROBE_RADIUS + len - head));
      ctx.stroke();
      arrowHead(ctx, p.x + ux * (PROBE_RADIUS + len - head * 0.9), p.y + uy * (PROBE_RADIUS + len - head * 0.9), ux, uy, head);
    }
  }
  // yellow body, rim in the colour of its sign
  ctx.fillStyle = col.probe;
  ctx.strokeStyle = p.sign > 0 ? col.pos : col.neg;
  ctx.lineWidth = 2.5 * Math.min(px, 1.3);
  ctx.beginPath();
  ctx.arc(p.x, p.y, PROBE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  signGlyph(ctx, p.x, p.y, p.sign, PROBE_RADIUS * 1.05, col.probeInk, 2.2 * Math.min(px, 1.3));
}

export function formatNumber(v: number): string {
  const r = Math.round(v * 10) / 10 || 0;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
}
