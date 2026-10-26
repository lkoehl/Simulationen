import { describe, expect, it } from 'vitest';
import { Field } from './field';
import { stepProbes } from './probes';
import { bodiesOf, type Capacitor, type PointCharge, type Ring } from './scene';
import { makeProbe } from '../presets';

const bounds = { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 };
const charge = (x: number, y: number, q: number): PointCharge => ({ kind: 'charge', id: 0, x, y, q });

function run(f: Field, probe: ReturnType<typeof makeProbe>, mode: 'friction' | 'inertia', seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) stepProbes([probe], f, mode, 1 / 60, bounds);
  return probe;
}

describe('probes', () => {
  it('are pushed away from a like charge even when dropped onto it', () => {
    for (const mode of ['friction', 'inertia'] as const) {
      for (const r of [5.8, 12.4, 16.3]) {
        const f = new Field([charge(0, 0, 2)], []);
        const p = run(f, makeProbe(r, 0, 1), mode, 2);
        expect(Math.hypot(p.x, p.y)).toBeGreaterThan(50);
      }
    }
  });

  it('leave a like-charged plate they touch', () => {
    const cap: Capacitor = { kind: 'capacitor', id: 1, x: 0, y: 0, length: 300, gap: 200, angle: 90, q: 3 };
    // positive plate at x = -100
    for (const d of [1, 2, 3]) {
      const f = new Field([], bodiesOf(cap));
      const p = run(f, makeProbe(-100 + d, 0, 1), 'friction', 1);
      expect(p.x).toBeGreaterThan(-80);
    }
  });

  it('rest on an attracting charge and start again after a sign flip', () => {
    const f = new Field([charge(0, 0, -2)], []);
    const p = run(f, makeProbe(60, 0, 1), 'friction', 3);
    expect(p.stuck).toBe(true);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(13 + 0.6 * 9, 1);
    p.sign = -1;
    p.stuck = false;
    const before = Math.hypot(p.x, p.y);
    stepProbes([p], f, 'friction', 1 / 60, bounds);
    expect(Math.hypot(p.x, p.y)).toBeGreaterThan(before);
  });

  it('leave a charge centre they were dropped on', () => {
    const f = new Field([charge(0, 0, 2)], []);
    const p = run(f, makeProbe(0, 0, 1), 'friction', 1);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Math.hypot(p.x, p.y)).toBeGreaterThan(30);
  });

  it('stay still inside a Faraday cage without friction', () => {
    const cap: Capacitor = { kind: 'capacitor', id: 1, x: 0, y: 0, length: 460, gap: 440, angle: 90, q: 4 };
    const ring: Ring = { kind: 'ring', id: 2, x: 10, y: 0, radius: 95, opening: 0, angle: 180, q: 0, grounded: false };
    const f = new Field([], [...bodiesOf(cap), ...bodiesOf(ring)]);
    const p = makeProbe(0, 30, 1);
    expect(stepProbes([p], f, 'inertia', 1 / 60, bounds)).toBe(false);
    run(f, p, 'inertia', 60);
    expect(Math.hypot(p.x, p.y - 30)).toBeLessThan(1);
  });

  it('report no motion in an empty field', () => {
    const f = new Field([], []);
    expect(stepProbes([makeProbe(0, 0, 1)], f, 'inertia', 1 / 60, bounds)).toBe(false);
  });
});
