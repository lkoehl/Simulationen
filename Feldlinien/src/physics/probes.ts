import type { Field } from './field';
import type { Probe } from './scene';
import type { Bounds } from '../viz/fieldlines';

export const PROBE_RADIUS = 9;
export const CHARGE_RADIUS = 13;
// Where a probe comes to rest: touching a charge, or touching the metal stroke.
const REST_CHARGE = CHARGE_RADIUS + 0.6 * PROBE_RADIUS;
export const REST_METAL = 3.5 + 0.6 * PROBE_RADIUS;

// With friction the probe drifts with v = mobility * q * E, i.e. exactly along
// the field line through its position. Without friction it is a massive body
// with a = (q/m) * E and overshoots the field lines.
const MOBILITY = 4000;
const CHARGE_PER_MASS = 6000;
const MAX_SPEED = 900;
const MAX_TRAIL = 6000;

export type Motion = 'friction' | 'inertia';

const e = [0, 0];

// Advances all probes by dt. Returns true if any probe visibly moved.
export function stepProbes(probes: Probe[], field: Field, motion: Motion, dt: number, bounds: Bounds): boolean {
  let moving = false;
  for (const p of probes) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) resetProbe(p);
    if (p.stuck) continue;
    // exactly on a charge the field is undefined: put it on the surface
    for (const c of field.charges) {
      if (Math.hypot(p.x - c.x, p.y - c.y) < 1e-6) p.x = c.x + REST_CHARGE;
    }
    const x0 = p.x;
    const y0 = p.y;
    let t = 0;
    while (t < dt) {
      field.E(p.x, p.y, e);
      if (!Number.isFinite(e[0]) || !Number.isFinite(e[1])) break;
      let ax = 0;
      let ay = 0;
      if (motion === 'friction') {
        p.vx = MOBILITY * p.sign * e[0];
        p.vy = MOBILITY * p.sign * e[1];
      } else {
        ax = CHARGE_PER_MASS * p.sign * e[0];
        ay = CHARGE_PER_MASS * p.sign * e[1];
      }
      const speed = Math.hypot(p.vx, p.vy) + Math.hypot(ax, ay) / 240;
      // at most 1.5 world units per substep
      const h = Math.min(dt - t, speed > 0 ? 1.5 / speed : dt - t, 1 / 240);
      t += h;
      if (motion === 'inertia') {
        p.vx += ax * h;
        p.vy += ay * h;
      }
      const v = Math.hypot(p.vx, p.vy);
      if (v > MAX_SPEED) {
        p.vx *= MAX_SPEED / v;
        p.vy *= MAX_SPEED / v;
      }
      if (v < 0.05 && motion === 'friction') break;

      const nx = p.x + p.vx * h;
      const ny = p.y + p.vy * h;
      if (collide(p, field, nx, ny)) break;
      // stop at the edge of the visible field
      if (nx < bounds.minX || nx > bounds.maxX || ny < bounds.minY || ny > bounds.maxY) {
        stop(p);
        break;
      }
      p.x = nx;
      p.y = ny;
    }
    if (Math.hypot(p.x - x0, p.y - y0) > 1e-3) moving = true;
    addTrailPoint(p);
  }
  return moving;
}

// Stops the probe when it runs into a charge or a conductor. Probes that are
// already in contact but move away (e.g. repelled) are let go.
function collide(p: Probe, field: Field, nx: number, ny: number): boolean {
  for (const c of field.charges) {
    const d = Math.hypot(nx - c.x, ny - c.y);
    if (d < REST_CHARGE && d < Math.hypot(p.x - c.x, p.y - c.y)) {
      // rest on the surface of the charge
      const k = REST_CHARGE / Math.max(d, 1e-6);
      p.x = c.x + (nx - c.x) * k;
      p.y = c.y + (ny - c.y) * k;
      stop(p);
      return true;
    }
  }
  const hit = field.intersect(p.x, p.y, nx, ny);
  if (hit) {
    const leaving = hit.t < 1e-9 && field.distToBody(hit.body, nx, ny) > field.distToBody(hit.body, p.x, p.y);
    if (!leaving) {
      // stop in front of the conductor
      const len = Math.hypot(nx - p.x, ny - p.y);
      const back = Math.max(0, hit.t - REST_METAL / Math.max(1e-9, len));
      p.x += (nx - p.x) * back;
      p.y += (ny - p.y) * back;
      stop(p);
      return true;
    }
  }
  for (let bi = 0; bi < field.bodies.length; bi++) {
    const b = field.bodies[bi];
    if (nx < b.minX - REST_METAL || nx > b.maxX + REST_METAL || ny < b.minY - REST_METAL || ny > b.maxY + REST_METAL) continue;
    const dn = field.distToBody(bi, nx, ny);
    if (dn < REST_METAL && dn < field.distToBody(bi, p.x, p.y)) {
      stop(p);
      return true;
    }
  }
  return false;
}

function stop(p: Probe) {
  p.vx = 0;
  p.vy = 0;
  p.stuck = true;
}

export function addTrailPoint(p: Probe) {
  const n = p.trail.length;
  if (n >= 2 && Math.hypot(p.trail[n - 2] - p.x, p.trail[n - 1] - p.y) < 1.5) return;
  p.trail.push(p.x, p.y);
  if (p.trail.length > MAX_TRAIL * 2) p.trail.splice(0, p.trail.length - MAX_TRAIL * 2);
}

export function resetProbe(p: Probe) {
  p.x = p.startX;
  p.y = p.startY;
  p.vx = 0;
  p.vy = 0;
  p.stuck = false;
  p.trail = [p.x, p.y];
}
