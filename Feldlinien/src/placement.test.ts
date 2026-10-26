import { describe, expect, it } from 'vitest';
import { bodiesOf, distToShape, isConductor, newId, type SceneObject } from './physics/scene';
import { freeSpot } from './placement';
import { makeProbe, presets } from './presets';

const bounds = { minX: -500, maxX: 500, minY: -300, maxY: 300 };

const make = (tool: string) => (x: number, y: number): SceneObject => {
  switch (tool) {
    case 'charge':
      return { kind: 'charge', id: newId(), x, y, q: 2 };
    case 'probe':
      return makeProbe(x, y, 1);
    case 'ring':
      return { kind: 'ring', id: newId(), x, y, radius: 90, opening: 0, angle: 0, q: 0, grounded: false };
    default:
      return { kind: 'box', id: newId(), x, y, width: 180, height: 130, angle: 0, q: 0, grounded: false };
  }
};

function place(objects: SceneObject[], tool: string) {
  const p = freeSpot(objects, bounds, make(tool));
  const o = make(tool)(p.x, p.y);
  objects.push(o);
  return o;
}

const distToMetal = (objects: SceneObject[], x: number, y: number) =>
  Math.min(...objects.filter(isConductor).flatMap(bodiesOf).map((b) => distToShape(b.shape, x, y)));

describe('tap placement', () => {
  it('puts a charge into the middle of a box instead of onto its wall', () => {
    const objects: SceneObject[] = [];
    place(objects, 'box');
    const c = place(objects, 'charge');
    expect(Math.hypot(c.x, c.y)).toBeLessThan(1e-9);
    expect(distToMetal(objects, c.x, c.y)).toBeGreaterThanOrEqual(38);
  });

  it('keeps charges and probes off a ring', () => {
    const objects: SceneObject[] = [];
    place(objects, 'ring');
    const c = place(objects, 'charge');
    const p = place(objects, 'probe');
    expect(distToMetal(objects, c.x, c.y)).toBeGreaterThanOrEqual(38);
    expect(distToMetal(objects, p.x, p.y)).toBeGreaterThanOrEqual(38);
  });

  it('finds room next to a full cage scene instead of stacking on the cage', () => {
    const objects = presets.find((p) => p.id === 'kaefig')!.build();
    const r = place(objects, 'ring');
    const others = objects.filter(isConductor).filter((o) => o !== r).flatMap(bodiesOf);
    for (const b of bodiesOf(r as never)) {
      for (const o of others) for (let i = 0; i < o.xs.length; i++) expect(distToShape(b.shape, o.xs[i], o.ys[i])).toBeGreaterThan(6);
    }
  });

  it('does not cut a capacitor plate with a new ring', () => {
    const objects = presets.find((p) => p.id === 'kondensator')!.build();
    const r = place(objects, 'ring');
    const ringBodies = bodiesOf(r as never);
    const plates = objects.filter((o) => o.kind === 'capacitor').flatMap((o) => bodiesOf(o as never));
    for (const plate of plates) {
      for (let i = 0; i < plate.xs.length; i++) expect(distToShape(ringBodies[0].shape, plate.xs[i], plate.ys[i])).toBeGreaterThan(5);
    }
  });
});
