import { describe, expect, it } from 'vitest';
import { Field } from '../physics/field';
import { bodiesOf, isConductor, type PointCharge, type SceneObject } from '../physics/scene';
import { presets } from '../presets';
import { computeFieldLines, distribute, FLUX_PER_CHARGE, surfaceSamples, type FieldLine } from './fieldlines';

const bounds = { minX: -1000, maxX: 1000, minY: -800, maxY: 800 };

function fieldOf(objects: SceneObject[]) {
  const charges = objects.filter((o): o is PointCharge => o.kind === 'charge');
  return new Field(charges, objects.filter(isConductor).flatMap(bodiesOf));
}

function linesOf(objects: SceneObject[], lpc = 8) {
  const f = fieldOf(objects);
  return { f, lines: computeFieldLines(f, surfaceSamples(f), lpc, bounds) };
}

const touches = (l: FieldLine, x: number, y: number) => {
  const p = l.pts;
  const n = p.length;
  return Math.hypot(p[0] - x, p[1] - y) < 1e-6 || Math.hypot(p[n - 2] - x, p[n - 1] - y) < 1e-6;
};

const charge = (x: number, y: number, q: number): PointCharge => ({ kind: 'charge', id: 0, x, y, q });
const preset = (id: string) => presets.find((p) => p.id === id)!.build();

describe('field lines', () => {
  it('gives both charges of a dipole the same number of lines', () => {
    const { lines } = linesOf([charge(-170, 0, 2), charge(170, 0, -2)]);
    expect(lines.filter((l) => touches(l, -170, 0)).length).toBe(16);
    expect(lines.filter((l) => touches(l, 170, 0)).length).toBe(16);
  });

  it('draws symmetric pictures for symmetric setups', () => {
    for (const id of ['dipol', 'kondensator', 'kaefig']) {
      const { lines } = linesOf(preset(id).filter((o) => o.kind !== 'probe'));
      const left = lines.filter((l) => l.pts.some((v, i) => i % 2 === 0 && v < -330)).length;
      const right = lines.filter((l) => l.pts.some((v, i) => i % 2 === 0 && v > 330)).length;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    }
  });

  it('does not flip when a neutral ring is dragged through a balanced scene', () => {
    const counts: number[] = [];
    for (let x = -200; x <= 200; x += 10) {
      const { lines } = linesOf([
        charge(-170, 0, 2),
        charge(170, 0, -2),
        { kind: 'ring', id: 9, x, y: 180, radius: 60, opening: 0, angle: 0, q: 0, grounded: false }
      ]);
      counts.push(lines.length);
    }
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  });

  it('keeps lines out of an empty cage', () => {
    const scene = preset('kaefig').filter((o) => o.kind !== 'probe');
    const { lines } = linesOf(scene);
    for (const l of lines) {
      for (let i = 0; i < l.pts.length; i += 2) expect(Math.hypot(l.pts[i], l.pts[i + 1])).toBeGreaterThan(90);
    }
  });

  it('finishes quickly even for the slowest preset', () => {
    const t = performance.now();
    linesOf(preset('gleich'), 16);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('surface charges', () => {
  it('places seeds on the influenced plate symmetrically', () => {
    const f = fieldOf(preset('influenz').filter((o) => o.kind !== 'probe'));
    const [chain] = surfaceSamples(f);
    for (const sign of [1, -1] as const) {
      const ys: number[] = [];
      distribute(chain, FLUX_PER_CHARGE * 0.15, sign, (_s, _x, y) => {
        ys.push(y);
      });
      ys.sort((a, b) => a - b);
      expect(ys.length).toBeGreaterThanOrEqual(6);
      for (let i = 0; i < ys.length; i++) expect(ys[i] + ys[ys.length - 1 - i]).toBeCloseTo(0, 0);
    }
  });

  it('places seeds on a charged box with mirror symmetry', () => {
    const f = fieldOf(preset('spitze').filter((o) => o.kind !== 'probe'));
    const [chain] = surfaceSamples(f);
    const pts: [number, number][] = [];
    distribute(chain, FLUX_PER_CHARGE / 8, 1, (_s, x, y) => {
      pts.push([x, y]);
    });
    for (const [x, y] of pts) {
      expect(pts.some(([u, v]) => Math.hypot(u + x, v - y) < 1)).toBe(true);
      expect(pts.some(([u, v]) => Math.hypot(u - x, v + y) < 1)).toBe(true);
    }
  });
});

describe('field lines after the regression check', () => {
  it('lets a neutral influenced plate emit as many lines as it receives', () => {
    const { lines } = linesOf(preset('influenz'));
    const into = lines.filter((l) => l.end === 'conductor').length;
    const out = lines.filter((l) => l.pts[0] > 50 && l.pts[0] < 70).length;
    expect(into).toBe(out);
  });

  it('gives a charged box as many lines as an equal point charge', () => {
    expect(linesOf(preset('spitze'), 16).lines.length).toBe(48);
  });

  it('draws lines for a small plate charge at the lowest density', () => {
    const plate = { kind: 'plate' as const, id: 1, x: 0, y: 0, length: 200, angle: 90, q: 0.5, grounded: false };
    expect(linesOf([plate], 3).lines.length).toBeGreaterThan(0);
  });

  it('does not leave a small negative charge without lines', () => {
    const { lines } = linesOf([charge(-148, 34, 0.5), charge(183, 36, 1), charge(-35, 24, -0.5)], 3);
    expect(lines.filter((l) => touches(l, -35, 24)).length).toBeGreaterThan(0);
  });

  it('keeps a symmetric three-charge setup symmetric', () => {
    const { lines } = linesOf([charge(0, 0, 2), charge(200, 120, -1), charge(200, -120, -1)]);
    for (const l of lines) {
      const m = Math.floor(l.pts.length / 4) * 2;
      const x = l.pts[m];
      const y = -l.pts[m + 1];
      let best = Infinity;
      for (const o of lines) for (let i = 0; i < o.pts.length; i += 2) best = Math.min(best, Math.hypot(o.pts[i] - x, o.pts[i + 1] - y));
      expect(best).toBeLessThan(1);
    }
  });
});
