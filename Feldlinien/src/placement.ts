import { CONTACT_DIST } from './physics/field';
import { CHARGE_RADIUS } from './physics/probes';
import { bodiesOf, distToShape, isConductor, type Body, type ConductorObject, type SceneObject } from './physics/scene';
import type { Bounds } from './viz/fieldlines';

const DEG = Math.PI / 180;

// Smallest gap between the outlines of two sets of conductor bodies.
function clearance(a: Body[], b: Body[]): number {
  let d = Infinity;
  for (const p of a) {
    for (const q of b) {
      for (let i = 0; i < q.xs.length; i++) d = Math.min(d, distToShape(p.shape, q.xs[i], q.ys[i]));
      for (let i = 0; i < p.xs.length; i++) d = Math.min(d, distToShape(q.shape, p.xs[i], p.ys[i]));
    }
  }
  return d;
}

// A free spot near the centre for an object added by tapping a tool.
// Charges and probes never land on metal (but may land inside a cage),
// conductors keep clear of other objects. If the field is too full, the spot
// with the most room is used.
export function freeSpot(
  objects: SceneObject[],
  bounds: Bounds,
  make: (x: number, y: number) => SceneObject
): { x: number; y: number } {
  const conductors = objects.filter(isConductor);
  const bodies = conductors.flatMap(bodiesOf);
  const points = objects.filter((o) => o.kind === 'charge' || o.kind === 'probe');
  const sample = make(0, 0);
  const isPoint = !isConductor(sample);
  let best = { x: 0, y: 0 };
  let bestClear = -Infinity;

  for (let r = 0; r < 700; r += 45) {
    for (let a = 0; a < 360; a += r === 0 ? 360 : 40) {
      const x = r * Math.cos(a * DEG);
      const y = r * Math.sin(a * DEG);
      if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
      if (isPoint) {
        if (bodies.some((b) => distToShape(b.shape, x, y) < CHARGE_RADIUS + 25)) continue;
        if (points.some((p) => Math.hypot(p.x - x, p.y - y) < 50)) continue;
        return { x, y };
      }
      const cb = bodiesOf(make(x, y) as ConductorObject);
      if (points.some((p) => cb.some((b) => distToShape(b.shape, p.x, p.y) < 30))) continue;
      const clear = clearance(cb, bodies);
      if (clear >= CONTACT_DIST + 15) return { x, y };
      if (clear > bestClear) {
        bestClear = clear;
        best = { x, y };
      }
    }
  }
  return best;
}
