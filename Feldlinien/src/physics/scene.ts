// Scene objects live in world coordinates (y points down, like the screen).
// The physics is two-dimensional: every charge is a line charge perpendicular
// to the drawing plane. In 2D the field of a charge falls off with 1/r, field
// line density is exactly proportional to field strength and a closed ring
// really is a Faraday cage.

export interface PointCharge {
  kind: 'charge';
  id: number;
  x: number;
  y: number;
  q: number;
}

export interface Probe {
  kind: 'probe';
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  sign: 1 | -1;
  startX: number;
  startY: number;
  stuck: boolean;
  trail: number[];
}

export interface Plate {
  kind: 'plate';
  id: number;
  x: number;
  y: number;
  length: number;
  angle: number; // degrees
  q: number;
  grounded: boolean;
}

export interface Capacitor {
  kind: 'capacitor';
  id: number;
  x: number;
  y: number;
  length: number;
  gap: number;
  angle: number; // degrees, direction of the plates
  q: number; // charge of the positive plate, the other one carries -q
}

export interface Ring {
  kind: 'ring';
  id: number;
  x: number;
  y: number;
  radius: number;
  opening: number; // degrees, 0 = closed cage
  angle: number; // degrees, where the opening points
  q: number;
  grounded: boolean;
}

export interface Box {
  kind: 'box';
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  q: number;
  grounded: boolean;
}

export type ConductorObject = Plate | Capacitor | Ring | Box;
export type SceneObject = PointCharge | Probe | ConductorObject;
export type ObjectKind = SceneObject['kind'];

export function isConductor(o: SceneObject): o is ConductorObject {
  return o.kind === 'plate' || o.kind === 'capacitor' || o.kind === 'ring' || o.kind === 'box';
}

// Cheap analytic shape used for distance estimates (step sizes, hit testing).
export type Shape =
  | { type: 'segment'; ax: number; ay: number; bx: number; by: number }
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'rect'; cx: number; cy: number; hw: number; hh: number; c: number; s: number };

// A single connected conductor, discretised as a polyline.
export interface Body {
  objectId: number;
  xs: number[];
  ys: number[];
  closed: boolean;
  q: number;
  grounded: boolean;
  shape: Shape;
}

const SEG_LEN = 7;
const DEG = Math.PI / 180;

// Parameter in [0, 1] that clusters vertices towards the ends of open
// conductors, where the surface charge density is highest.
function endClustered(t: number): number {
  return 0.6 * 0.5 * (1 - Math.cos(Math.PI * t)) + 0.4 * t;
}

function plateBody(
  objectId: number,
  cx: number,
  cy: number,
  length: number,
  angleDeg: number,
  q: number,
  grounded: boolean
): Body {
  const c = Math.cos(angleDeg * DEG);
  const s = Math.sin(angleDeg * DEG);
  const n = Math.max(12, Math.min(80, Math.round(length / SEG_LEN)));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    const d = (endClustered(i / n) - 0.5) * length;
    xs.push(cx + c * d);
    ys.push(cy + s * d);
  }
  const h = length / 2;
  return {
    objectId,
    xs,
    ys,
    closed: false,
    q,
    grounded,
    shape: { type: 'segment', ax: cx - c * h, ay: cy - s * h, bx: cx + c * h, by: cy + s * h }
  };
}

export function capacitorPlates(cap: Capacitor) {
  // Normal of the plate direction; the positive plate sits on the +normal side.
  const nx = -Math.sin(cap.angle * DEG);
  const ny = Math.cos(cap.angle * DEG);
  const h = cap.gap / 2;
  return {
    plus: { x: cap.x + nx * h, y: cap.y + ny * h },
    minus: { x: cap.x - nx * h, y: cap.y - ny * h }
  };
}

export function bodiesOf(o: ConductorObject): Body[] {
  switch (o.kind) {
    case 'plate':
      return [plateBody(o.id, o.x, o.y, o.length, o.angle, o.q, o.grounded)];
    case 'capacitor': {
      const { plus, minus } = capacitorPlates(o);
      return [
        plateBody(o.id, plus.x, plus.y, o.length, o.angle, o.q, false),
        plateBody(o.id, minus.x, minus.y, o.length, o.angle, -o.q, false)
      ];
    }
    case 'ring': {
      const xs: number[] = [];
      const ys: number[] = [];
      const opening = Math.max(0, Math.min(300, o.opening)) * DEG;
      const closed = opening < 1e-6;
      const span = 2 * Math.PI - opening;
      const n = Math.max(36, Math.min(140, Math.round((span * o.radius) / SEG_LEN)));
      const start = o.angle * DEG + opening / 2;
      for (let i = 0; i < (closed ? n : n + 1); i++) {
        const t = closed ? i / n : endClustered(i / n);
        const a = start + t * span;
        xs.push(o.x + o.radius * Math.cos(a));
        ys.push(o.y + o.radius * Math.sin(a));
      }
      return [
        {
          objectId: o.id,
          xs,
          ys,
          closed,
          q: o.q,
          grounded: o.grounded,
          shape: { type: 'circle', cx: o.x, cy: o.y, r: o.radius }
        }
      ];
    }
    case 'box': {
      const c = Math.cos(o.angle * DEG);
      const s = Math.sin(o.angle * DEG);
      const hw = o.width / 2;
      const hh = o.height / 2;
      const corners = [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh]
      ];
      const xs: number[] = [];
      const ys: number[] = [];
      for (let k = 0; k < 4; k++) {
        const [x0, y0] = corners[k];
        const [x1, y1] = corners[(k + 1) % 4];
        const len = Math.hypot(x1 - x0, y1 - y0);
        // even count: a vertex sits exactly on every edge midpoint (symmetry)
        const n = 2 * Math.max(3, Math.min(20, Math.round(len / (2 * SEG_LEN))));
        for (let i = 0; i < n; i++) {
          // Refine towards the corners, where the field is strongest.
          const t = endClustered(i / n);
          const lx = x0 + (x1 - x0) * t;
          const ly = y0 + (y1 - y0) * t;
          xs.push(o.x + lx * c - ly * s);
          ys.push(o.y + lx * s + ly * c);
        }
      }
      return [
        {
          objectId: o.id,
          xs,
          ys,
          closed: true,
          q: o.q,
          grounded: o.grounded,
          shape: { type: 'rect', cx: o.x, cy: o.y, hw, hh, c, s }
        }
      ];
    }
  }
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Distance from a point to the outline of a shape (not to its interior).
export function distToShape(sh: Shape, px: number, py: number): number {
  switch (sh.type) {
    case 'segment':
      return distToSegment(px, py, sh.ax, sh.ay, sh.bx, sh.by);
    case 'circle':
      return Math.abs(Math.hypot(px - sh.cx, py - sh.cy) - sh.r);
    case 'rect': {
      const dx = px - sh.cx;
      const dy = py - sh.cy;
      const lx = Math.abs(dx * sh.c + dy * sh.s);
      const ly = Math.abs(-dx * sh.s + dy * sh.c);
      const ox = lx - sh.hw;
      const oy = ly - sh.hh;
      if (ox > 0 || oy > 0) return Math.hypot(Math.max(ox, 0), Math.max(oy, 0));
      return Math.min(-ox, -oy);
    }
  }
}

let nextId = 1;
export function newId(): number {
  return nextId++;
}
