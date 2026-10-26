import { describe, expect, it } from 'vitest';
import { CAPACITY, DT, Recording, SETTLING, X_MAX, step, type LiveState } from './motion';

function live(partial: Partial<LiveState>): LiveState {
  return { driver: 'position', x: 0, target: 0, v: 0, a: 0, ...partial };
}

// Deterministic noise so the tests do not flicker.
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

describe('dragging', () => {
  it('recovers v and a of a jerky hand movement', () => {
    // x(t) = 2 sin(t): v = 2 cos(t), a = -2 sin(t). The pointer position is
    // rounded to whole pixels (~3 cm) and sampled with uneven timing.
    const rnd = noise(7);
    const rec = new Recording();
    const pxPerM = 35;
    for (let i = 0; i < 600; i++) {
      const t = i * DT + rnd() * DT * 0.5;
      const x = Math.round(2 * Math.sin(t) * pxPerM) / pxPerM;
      rec.push({ x });
    }
    let vErr = 0;
    let aErr = 0;
    for (let i = 30; i < 570; i++) {
      const t = i * DT;
      vErr = Math.max(vErr, Math.abs(rec.v[i] - 2 * Math.cos(t)));
      aErr = Math.max(aErr, Math.abs(rec.a[i] + 2 * Math.sin(t)));
    }
    expect(vErr).toBeLessThan(0.25);
    expect(aErr).toBeLessThan(1);
  });

  it('shows zero velocity and acceleration while standing still', () => {
    const rec = new Recording();
    for (let i = 0; i < 120; i++) rec.push({ x: 3 });
    expect(rec.last()).toEqual({ x: 3, v: 0, a: 0 });
  });

  it('keeps the man between the walls', () => {
    const s = live({ target: 50 });
    expect(step(s).x).toBe(X_MAX);
    s.target = -50;
    expect(step(s).x).toBe(-X_MAX);
  });
});

describe('set velocity', () => {
  it('moves uniformly and records the exact velocity', () => {
    const s = live({ driver: 'velocity', v: 1.5 });
    const rec = new Recording();
    rec.push({ x: 0, v: 1.5 });
    for (let i = 0; i < 120; i++) rec.push(step(s));
    expect(rec.last().x).toBeCloseTo(3, 9);
    expect(rec.v[60]).toBe(1.5);
    expect(rec.a[60]).toBeCloseTo(0, 9);
  });

  it('stops at the wall', () => {
    const s = live({ driver: 'velocity', x: 9.9, v: 3 });
    const hits = [];
    for (let i = 0; i < 30; i++) hits.push(step(s).hitWall);
    expect(s.x).toBe(X_MAX);
    expect(s.v).toBe(0);
    expect(hits.filter(Boolean)).toHaveLength(1);
  });
});

describe('set acceleration', () => {
  it('follows s = a/2 t² from rest', () => {
    const s = live({ driver: 'acceleration', x: -8, a: 1 });
    const rec = new Recording();
    rec.push({ x: -8, v: 0, a: 1 });
    for (let i = 0; i < 240; i++) rec.push(step(s));
    // 4 s: s = 8 m, v = 4 m/s (exact for constant a)
    expect(rec.last().x).toBeCloseTo(0, 6);
    expect(rec.last().v).toBeCloseTo(4, 9);
    expect(rec.last().a).toBe(1);
  });

  it('rests against the wall without accelerating', () => {
    const s = live({ driver: 'acceleration', x: 9, v: 2, a: 2 });
    for (let i = 0; i < 120; i++) step(s);
    const r = step(s);
    expect(r).toEqual({ x: X_MAX, v: 0, a: 0, hitWall: false });
  });
});

describe('recording', () => {
  it('holds exactly 20 s', () => {
    const rec = new Recording();
    for (let i = 0; i < CAPACITY + 50; i++) rec.push({ x: 0 });
    expect(rec.length).toBe(CAPACITY);
    expect(rec.duration).toBeCloseTo(20, 9);
    expect(rec.full).toBe(true);
  });

  it('interpolates between samples', () => {
    const rec = new Recording();
    rec.push({ x: 0, v: 0 });
    rec.push({ x: 1, v: 0 });
    expect(rec.sampleAt(DT / 2).x).toBeCloseTo(0.5, 9);
    expect(rec.sampleAt(99).x).toBe(1);
  });

  it('truncates and restores', () => {
    const rec = new Recording();
    for (let i = 0; i < 120; i++) rec.push({ x: i * 0.01 });
    const snap = rec.snapshot();
    rec.truncate(1);
    expect(rec.length).toBe(61);
    expect(rec.duration).toBeCloseTo(1, 9);
    rec.restore(snap);
    expect(rec.length).toBe(120);
    expect(rec.v[60]).toBeCloseTo(0.6, 6);
  });

  it('only revises the last samples while recording', () => {
    const rec = new Recording();
    for (let i = 0; i < 200; i++) rec.push({ x: Math.sin(i / 20) });
    const settled = rec.a.slice(0, 200 - SETTLING);
    for (let i = 200; i < 260; i++) rec.push({ x: Math.sin(i / 20) });
    expect(rec.a.slice(0, 200 - SETTLING)).toEqual(settled);
  });
});
