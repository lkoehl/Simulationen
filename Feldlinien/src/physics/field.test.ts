import { describe, expect, it } from 'vitest';
import { Field } from './field';
import { bodiesOf, type Capacitor, type Plate, type PointCharge, type Ring } from './scene';

const E = (f: Field, x: number, y: number) => {
  const out = [0, 0];
  f.E(x, y, out);
  return out;
};
const mag = (v: number[]) => Math.hypot(v[0], v[1]);

const charge = (x: number, y: number, q: number): PointCharge => ({ kind: 'charge', id: 0, x, y, q });
const ring = (o: Partial<Ring> = {}): Ring => ({
  kind: 'ring',
  id: 1,
  x: 0,
  y: 0,
  radius: 100,
  opening: 0,
  angle: 0,
  q: 0,
  grounded: false,
  ...o
});
const capacitor = (o: Partial<Capacitor> = {}): Capacitor => ({
  kind: 'capacitor',
  id: 2,
  x: 0,
  y: 0,
  length: 400,
  gap: 300,
  angle: 90,
  q: 3,
  ...o
});

describe('point charge', () => {
  it('has the 2D Coulomb field 2q/r pointing away from a positive charge', () => {
    const f = new Field([charge(0, 0, 2)], []);
    const v = E(f, 50, 0);
    expect(v[0]).toBeCloseTo(4 / 50, 10);
    expect(v[1]).toBeCloseTo(0, 10);
  });
});

describe('capacitor', () => {
  it('produces a nearly homogeneous field between long plates', () => {
    const cap = capacitor({ length: 800, gap: 100, q: 4 });
    const f = new Field([], bodiesOf(cap));
    const centre = E(f, 0, 0);
    // plates are vertical, the positive plate sits on the left (+normal = -x)
    expect(centre[0]).toBeGreaterThan(0);
    // E = U / d, with U the potential difference of the plates
    const U = f.bodies[0].V - f.bodies[1].V;
    expect(Math.abs(mag(centre) - U / 100) / mag(centre)).toBeLessThan(0.02);
    // finite plates: part of the charge sits on the outer faces and edges,
    // for L/d = 8 the 2D edge correction predicts about 84 % of sigma/epsilon
    const ideal = (4 * Math.PI * 4) / 800;
    expect(mag(centre) / ideal).toBeGreaterThan(0.8);
    expect(mag(centre) / ideal).toBeLessThan(0.88);
    const offCentre = E(f, 20, 120);
    expect(Math.abs(mag(offCentre) - mag(centre)) / mag(centre)).toBeLessThan(0.03);
  });

  it('carries the prescribed charges on its plates', () => {
    const f = new Field([], bodiesOf(capacitor()));
    const sum = (bi: number) => {
      const b = f.bodies[bi];
      let s = 0;
      for (let j = b.first; j < b.first + b.count; j++) s += f.lambda[j] * f.len[j];
      return s;
    };
    expect(sum(0)).toBeCloseTo(3, 8);
    expect(sum(1)).toBeCloseTo(-3, 8);
  });
});

describe('Faraday cage', () => {
  it('shields the inside of a closed neutral ring from an external field', () => {
    const cap = capacitor({ length: 500, gap: 420, q: 4 });
    const withoutCage = new Field([], bodiesOf(cap));
    const withCage = new Field([], [...bodiesOf(cap), ...bodiesOf(ring({ radius: 100 }))]);
    const outside = mag(E(withoutCage, 0, 0));
    for (const [x, y] of [
      [0, 0],
      [50, 30],
      [-70, -20],
      [0, 85]
    ]) {
      expect(mag(E(withCage, x, y))).toBeLessThan(0.002 * outside);
    }
  });

  it('keeps the ring an equipotential surface', () => {
    const f = new Field([charge(-250, 40, 3)], bodiesOf(ring({ radius: 120 })));
    const values: number[] = [];
    for (let a = 0; a < 2 * Math.PI; a += 0.37) values.push(f.phi(120 * Math.cos(a), 120 * Math.sin(a)));
    const spread = Math.max(...values) - Math.min(...values);
    expect(spread).toBeLessThan(0.01 * Math.abs(f.phi(-250 + 30, 40) - values[0]));
  });

  it('lets a field leak into a ring with a wide opening', () => {
    const cap = capacitor({ length: 500, gap: 420, q: 4 });
    const outside = mag(E(new Field([], bodiesOf(cap)), 0, 0));
    const open = new Field([], [...bodiesOf(cap), ...bodiesOf(ring({ radius: 100, opening: 90, angle: 180 }))]);
    expect(mag(E(open, -40, 0))).toBeGreaterThan(0.05 * outside);
  });

  it('shows the inner charge outside an isolated ring but hides it when grounded', () => {
    const inner = charge(20, -10, 2);
    const isolated = new Field([inner], bodiesOf(ring({ radius: 100 })));
    const grounded = new Field([inner], bodiesOf(ring({ radius: 100, grounded: true })));
    // isolated: the outer surface carries +2 uniformly -> field of a charge 2 at the centre
    expect(mag(E(isolated, 200, 0))).toBeCloseTo(4 / 200, 4);
    expect(mag(E(grounded, 200, 0))).toBeLessThan(1e-4);
  });
});

describe('influence', () => {
  it('induces opposite charge on the near side of a neutral plate', () => {
    const plate: Plate = { kind: 'plate', id: 3, x: 0, y: 0, length: 300, angle: 90, q: 0, grounded: false };
    const f = new Field([charge(-150, 0, 3)], bodiesOf(plate));
    // field just left of the plate points into it (negative surface charge),
    // just right of it points away (positive surface charge)
    const left = E(f, -1, 0);
    const right = E(f, 1, 0);
    expect(left[0]).toBeGreaterThan(0);
    expect(right[0]).toBeGreaterThan(0);
    let total = 0;
    const b = f.bodies[0];
    for (let j = b.first; j < b.first + b.count; j++) total += f.lambda[j] * f.len[j];
    expect(total).toBeCloseTo(0, 8);
  });
});

describe('multipole expansion', () => {
  it('matches direct integration far from a conductor', () => {
    const f = new Field([charge(-60, 0, 2)], bodiesOf(ring({ radius: 50 })));
    // just inside the multipole radius vs. well outside: both must agree with phi gradient
    for (const [x, y] of [
      [200, 30],
      [0, 400]
    ]) {
      const h = 1e-3;
      const ex = -(f.phi(x + h, y) - f.phi(x - h, y)) / (2 * h);
      const ey = -(f.phi(x, y + h) - f.phi(x, y - h)) / (2 * h);
      const v = E(f, x, y);
      expect(v[0]).toBeCloseTo(ex, 5);
      expect(v[1]).toBeCloseTo(ey, 5);
    }
  });
});

describe('robustness', () => {
  const twoCapacitors = (gapA: number, gapB: number) => [
    ...bodiesOf(capacitor({ id: 10, length: 320, gap: gapA, q: 3 })),
    ...bodiesOf(capacitor({ id: 11, x: 90, length: 320, gap: gapB, q: 3 }))
  ];

  it('solves overlapping capacitors whose plates coincide', () => {
    for (const [a, b] of [
      [40, 220],
      [100, 80],
      [400, 220]
    ]) {
      const f = new Field([], twoCapacitors(a, b));
      expect(f.ok).toBe(true);
      let max = 0;
      for (const l of f.lambda) max = Math.max(max, Math.abs(l));
      expect(max).toBeLessThan(1);
      // charge of each electrical group is conserved
      const groups = new Map<number, { q: number; sum: number }>();
      for (const b of f.bodies) {
        const g = groups.get(b.group) ?? { q: 0, sum: 0 };
        g.q += b.q;
        for (let j = b.first; j < b.first + b.count; j++) g.sum += f.lambda[j] * f.len[j];
        groups.set(b.group, g);
      }
      for (const g of groups.values()) expect(g.sum).toBeCloseTo(g.q, 6);
    }
  });

  it('stays finite with a charge exactly on a collocation point', () => {
    const plate: Plate = { kind: 'plate', id: 3, x: 0, y: 0, length: 300, angle: 90, q: 0, grounded: false };
    const bodies = bodiesOf(plate);
    const mid = Math.floor(bodies[0].xs.length / 2);
    const x = (bodies[0].xs[mid - 1] + bodies[0].xs[mid]) / 2;
    const y = (bodies[0].ys[mid - 1] + bodies[0].ys[mid]) / 2;
    const f = new Field([charge(x, y, 2)], bodies);
    expect(f.ok).toBe(true);
    for (const l of f.lambda) expect(Number.isFinite(l)).toBe(true);
  });
});

describe('cavities', () => {
  it('makes the inside of an empty closed ring exactly field-free', () => {
    const cap = capacitor({ length: 460, gap: 440, q: 4 });
    const f = new Field([], [...bodiesOf(cap), ...bodiesOf(ring({ x: 10, radius: 95 }))]);
    for (let i = 0; i < 20; i++) {
      const a = i * 0.7;
      const r = i === 0 ? 0 : 90 - (i % 5) * 18;
      const v = E(f, 10 + r * Math.cos(a), r * Math.sin(a));
      expect(v[0]).toBe(0);
      expect(v[1]).toBe(0);
      expect(f.phi(10 + r * Math.cos(a), r * Math.sin(a))).toBe(f.bodies[2].V);
    }
    // just outside the wall the field is the normal BEM field, pointing along the normal
    const out = E(f, 10 + 97, 0);
    expect(Math.abs(out[0])).toBeGreaterThan(10 * Math.abs(out[1]));
  });

  it('does not treat a ring with a charge inside as empty', () => {
    const f = new Field([charge(20, -10, 2)], bodiesOf(ring({ radius: 100 })));
    expect(mag(E(f, -40, 30))).toBeGreaterThan(0.01);
  });
});

describe('contact', () => {
  it('connects a charged plate touching a neutral ring', () => {
    const plate: Plate = { kind: 'plate', id: 3, x: -200, y: 0, length: 200, angle: 0, q: 4, grounded: false };
    // plate tip at x = -100 touches the ring at x = -100
    const f = new Field([], [...bodiesOf(plate), ...bodiesOf(ring({ radius: 100 }))]);
    expect(f.bodies[0].group).toBe(f.bodies[1].group);
    expect(Math.abs(f.bodies[0].V - f.bodies[1].V)).toBeLessThan(1e-9);
    expect(f.netCharge(3) + f.netCharge(1)).toBeCloseTo(4, 6);
    expect(f.netCharge(1)).toBeGreaterThan(0.5);
  });

  it('grounds a plate through a grounded ring it touches', () => {
    const plate: Plate = { kind: 'plate', id: 3, x: -200, y: 0, length: 200, angle: 0, q: 4, grounded: false };
    const f = new Field([], [...bodiesOf(plate), ...bodiesOf(ring({ radius: 100, grounded: true }))]);
    expect(f.bodies[0].V).toBe(0);
  });
});

describe('grounding', () => {
  it('keeps the field when a grounded conductor is isolated with its induced charge', () => {
    const plate: Plate = { kind: 'plate', id: 3, x: 60, y: 0, length: 320, angle: 90, q: 0, grounded: true };
    const grounded = new Field([charge(-190, 0, 3)], bodiesOf(plate));
    const net = grounded.netCharge(3);
    expect(net).toBeLessThan(-1);
    const isolated = new Field([charge(-190, 0, 3)], bodiesOf({ ...plate, grounded: false, q: net }));
    for (const [x, y] of [
      [200, 0],
      [0, 250],
      [-300, 100]
    ]) {
      const a = E(grounded, x, y);
      const b = E(isolated, x, y);
      expect(b[0]).toBeCloseTo(a[0], 6);
      expect(b[1]).toBeCloseTo(a[1], 6);
    }
  });
});

describe('solver cache', () => {
  it('reuses the factorisation for a translated conductor', async () => {
    const { createSolverCache } = await import('./field');
    const cache = createSolverCache();
    const box = { kind: 'box' as const, id: 5, x: 0, y: 0, width: 200, height: 120, angle: 0, q: 2, grounded: false };
    new Field([charge(-200, 0, 1)], bodiesOf(box), cache);
    const lu = cache.lu;
    const moved = new Field([charge(-200, 0, 1)], bodiesOf({ ...box, x: 30, y: -20 }), cache);
    expect(cache.lu).toBe(lu);
    const fresh = new Field([charge(-200, 0, 1)], bodiesOf({ ...box, x: 30, y: -20 }));
    for (let i = 0; i < fresh.nSeg; i++) expect(moved.lambda[i]).toBeCloseTo(fresh.lambda[i], 9);
  });

  it('caps the discretisation of large boxes', () => {
    const b = bodiesOf({ kind: 'box', id: 5, x: 0, y: 0, width: 600, height: 600, angle: 0, q: 0, grounded: false });
    expect(b[0].xs.length).toBeLessThanOrEqual(160);
  });
});

describe('cage touched from outside', () => {
  it('stays exactly field-free when a plate touches it', () => {
    const cap = capacitor({ length: 460, gap: 440, q: 4 });
    const a = -Math.PI / 3;
    const plate: Plate = {
      kind: 'plate',
      id: 3,
      x: 98 * Math.cos(a) + 50 * Math.cos(Math.PI / 6),
      y: 98 * Math.sin(a) + 50 * Math.sin(Math.PI / 6),
      length: 100,
      angle: 30,
      q: 0,
      grounded: false
    };
    const f = new Field([], [...bodiesOf(cap), ...bodiesOf(ring({ radius: 95 })), ...bodiesOf(plate)]);
    expect(f.bodies[2].group).toBe(f.bodies[3].group);
    expect(f.bodies[2].cavity).toBe(true);
    const v = E(f, 0, 30);
    expect(v[0]).toBe(0);
    expect(v[1]).toBe(0);
  });
});
