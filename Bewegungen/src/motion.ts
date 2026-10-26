// Motion model and recording. Everything here is in SI units (m, s) and free
// of DOM code, so it can be tested on its own.

/** Fixed simulation step. Samples are recorded at exactly this spacing. */
export const DT = 1 / 60;
/** Length of one recording, as in the PhET original. */
export const T_MAX = 20;
export const CAPACITY = Math.round(T_MAX / DT) + 1;
/** The man walks between two walls at -X_MAX and +X_MAX. */
export const X_MAX = 10;

/**
 * Half widths (in samples) of the windows for the derivative estimates of a
 * dragged motion. Hand movements are jerky and pointer events arrive unevenly,
 * so v and a come from a local least-squares fit instead of plain differences.
 */
const H_V = 6; // ±0.1 s, linear fit
const H_A = 15; // ±0.25 s, quadratic fit

/** Samples at the end of a live recording whose a (and v) may still change. */
export const SETTLING = H_A;
export const SETTLING_V = H_V;

/** What the user currently controls: the position (dragging), v or a. */
export type Driver = 'position' | 'velocity' | 'acceleration';

export interface Sample {
  x: number;
  v: number;
  a: number;
}

export interface LiveState {
  driver: Driver;
  /** where the man is now */
  x: number;
  /** position the pointer or slider asks for (driver 'position') */
  target: number;
  /** current velocity in the v and a modes */
  v: number;
  /** set acceleration (driver 'acceleration') */
  a: number;
}

export interface StepResult {
  x: number;
  /** exact v if the model knows it, otherwise it is estimated from x */
  v?: number;
  /** exact a if the model knows it */
  a?: number;
  hitWall: boolean;
}

export function clampX(x: number): number {
  return Math.max(-X_MAX, Math.min(X_MAX, x));
}

/** Advance the live state by one step and report what to record. */
export function step(state: LiveState, dt = DT): StepResult {
  switch (state.driver) {
    case 'position': {
      state.x = clampX(state.target);
      return { x: state.x, hitWall: false };
    }
    case 'velocity': {
      const x = state.x + state.v * dt;
      const before = state.x;
      state.x = clampX(x);
      // Running into a wall stops the man; the set velocity drops to zero.
      const hitWall = state.x !== x && Math.abs(before) !== X_MAX;
      if (state.x !== x) state.v = 0;
      return { x: state.x, v: state.v, hitWall };
    }
    case 'acceleration': {
      const x = state.x + state.v * dt + 0.5 * state.a * dt * dt;
      state.v += state.a * dt;
      const before = state.x;
      state.x = clampX(x);
      if (state.x !== x) {
        state.v = 0;
        // Pressed against the wall nothing moves, so nothing accelerates.
        return { x: state.x, v: 0, a: 0, hitWall: Math.abs(before) !== X_MAX };
      }
      return { x: state.x, v: state.v, a: state.a, hitWall: false };
    }
  }
}

/**
 * Least-squares polynomial (degree 1 or 2) through values[lo..hi], evaluated
 * at index i. Returns the first or second derivative per index step.
 */
function fitDerivative(values: Float64Array, lo: number, hi: number, i: number, order: 1 | 2): number {
  const n = hi - lo + 1;
  if (n < order + 1) return 0;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let t0 = 0, t1 = 0, t2 = 0;
  for (let j = lo; j <= hi; j++) {
    const k = j - i;
    const k2 = k * k;
    const y = values[j];
    s0 += 1;
    s1 += k;
    s2 += k2;
    s3 += k2 * k;
    s4 += k2 * k2;
    t0 += y;
    t1 += k * y;
    t2 += k2 * y;
  }
  if (order === 1) {
    const det = s0 * s2 - s1 * s1;
    return det === 0 ? 0 : (s0 * t1 - s1 * t0) / det;
  }
  // Normal equations for c0 + c1 k + c2 k²; we need 2 c2 (Cramer's rule).
  const det =
    s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (det === 0) return 0;
  const detC2 =
    s0 * (s2 * t2 - t1 * s3) - s1 * (s1 * t2 - t1 * s2) + t0 * (s1 * s3 - s2 * s2);
  return (2 * detC2) / det;
}

export interface Snapshot {
  x: Float64Array;
  vSet: Float64Array;
  aSet: Float64Array;
  length: number;
}

/** Recorded motion: one sample every DT, starting at t = 0. */
export class Recording {
  readonly x = new Float64Array(CAPACITY);
  readonly v = new Float64Array(CAPACITY);
  readonly a = new Float64Array(CAPACITY);
  // Exact values from the v and a modes; NaN where they have to be estimated.
  private readonly vSet = new Float64Array(CAPACITY).fill(NaN);
  private readonly aSet = new Float64Array(CAPACITY).fill(NaN);
  length = 0;

  get duration(): number {
    return this.length > 0 ? (this.length - 1) * DT : 0;
  }

  get full(): boolean {
    return this.length >= CAPACITY;
  }

  push(r: { x: number; v?: number; a?: number }): void {
    if (this.full) return;
    const i = this.length++;
    this.x[i] = r.x;
    this.vSet[i] = r.v ?? NaN;
    this.aSet[i] = r.a ?? NaN;
    this.refresh(i - 2 * H_A);
  }

  /** Keep samples up to and including time t. */
  truncate(t: number): void {
    const n = Math.min(this.length, Math.floor(t / DT + 1e-6) + 1);
    this.vSet.fill(NaN, n);
    this.aSet.fill(NaN, n);
    this.length = n;
    this.refresh(n - 1 - 2 * H_A);
  }

  clear(): void {
    this.vSet.fill(NaN);
    this.aSet.fill(NaN);
    this.length = 0;
  }

  /** Recompute v and a from index `from` on. */
  private refresh(from: number): void {
    const n = this.length;
    from = Math.max(0, from);
    for (let i = from; i < n; i++) {
      if (!Number.isNaN(this.vSet[i])) {
        this.v[i] = this.vSet[i];
      } else {
        const lo = Math.max(0, i - H_V);
        const hi = Math.min(n - 1, i + H_V);
        this.v[i] = fitDerivative(this.x, lo, hi, i, 1) / DT;
      }
    }
    for (let i = from; i < n; i++) {
      if (!Number.isNaN(this.aSet[i])) {
        this.a[i] = this.aSet[i];
      } else if (!Number.isNaN(this.vSet[i])) {
        // v is known exactly (v mode): a is how fast it changes.
        const lo = Math.max(0, i - H_V);
        const hi = Math.min(n - 1, i + H_V);
        this.a[i] = fitDerivative(this.v, lo, hi, i, 1) / DT;
      } else {
        const lo = Math.max(0, i - H_A);
        const hi = Math.min(n - 1, i + H_A);
        this.a[i] = fitDerivative(this.x, lo, hi, i, 2) / (DT * DT);
      }
    }
  }

  /** Linearly interpolated values at time t (clamped to the recording). */
  sampleAt(t: number): Sample {
    if (this.length === 0) return { x: 0, v: 0, a: 0 };
    const f = Math.max(0, Math.min(this.length - 1, t / DT));
    const i = Math.min(this.length - 2, Math.floor(f));
    if (i < 0) return { x: this.x[0], v: this.v[0], a: this.a[0] };
    const w = f - i;
    const lerp = (arr: Float64Array) => arr[i] + (arr[i + 1] - arr[i]) * w;
    return { x: lerp(this.x), v: lerp(this.v), a: lerp(this.a) };
  }

  last(): Sample {
    const i = this.length - 1;
    return i < 0 ? { x: 0, v: 0, a: 0 } : { x: this.x[i], v: this.v[i], a: this.a[i] };
  }

  snapshot(): Snapshot {
    return {
      x: this.x.slice(0, this.length),
      vSet: this.vSet.slice(0, this.length),
      aSet: this.aSet.slice(0, this.length),
      length: this.length
    };
  }

  restore(s: Snapshot): void {
    this.x.set(s.x);
    this.vSet.fill(NaN);
    this.aSet.fill(NaN);
    this.vSet.set(s.vSet);
    this.aSet.set(s.aSet);
    this.length = s.length;
    this.refresh(0);
  }
}
