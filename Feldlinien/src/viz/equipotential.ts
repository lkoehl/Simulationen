import type { Field } from '../physics/field';
import type { Bounds } from './fieldlines';

// Spacing of neighbouring equipotential lines (potential units, k = 1).
export const DELTA_PHI = 2.5;

// Marching squares on a regular grid. Returns flat line segments x0,y0,x1,y1.
export function computeEquipotentials(field: Field, bounds: Bounds, cell: number): Float32Array {
  const nx = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1;
  const ny = Math.ceil((bounds.maxY - bounds.minY) / cell) + 1;
  const v = new Float64Array(nx * ny);
  // Skip cells right next to point charges, where the potential diverges.
  const mask = new Uint8Array(nx * ny);
  const skip = 10;
  for (let j = 0; j < ny; j++) {
    const y = bounds.minY + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = bounds.minX + i * cell;
      v[j * nx + i] = field.phi(x, y) / DELTA_PHI;
      for (const c of field.charges) if (Math.abs(x - c.x) < skip && Math.abs(y - c.y) < skip) mask[j * nx + i] = 1;
      // inside a cage the potential is constant: nothing to draw
      if (field.inCavity(x, y)) mask[j * nx + i] = 1;
    }
  }

  const out: number[] = [];
  const corner = [0, 0, 0, 0];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const i0 = j * nx + i;
      if (mask[i0] || mask[i0 + 1] || mask[i0 + nx] || mask[i0 + nx + 1]) continue;
      corner[0] = v[i0];
      corner[1] = v[i0 + 1];
      corner[2] = v[i0 + nx + 1];
      corner[3] = v[i0 + nx];
      const min = Math.min(corner[0], corner[1], corner[2], corner[3]);
      const max = Math.max(corner[0], corner[1], corner[2], corner[3]);
      // practically field-free: numerical noise around a level is no contour
      if (max - min < 1e-3) continue;
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (hi - lo > 6) continue; // too steep to resolve, near a singularity
      const x0 = bounds.minX + i * cell;
      const y0 = bounds.minY + j * cell;
      // corners: 0 (x0,y0), 1 (x1,y0), 2 (x1,y1), 3 (x0,y1)
      const cx = [x0, x0 + cell, x0 + cell, x0];
      const cy = [y0, y0, y0 + cell, y0 + cell];
      for (let level = lo; level <= hi; level++) {
        const hits: number[] = [];
        for (let e = 0; e < 4; e++) {
          const a = corner[e];
          const b = corner[(e + 1) % 4];
          if ((a < level && b >= level) || (a >= level && b < level)) {
            const t = (level - a) / (b - a);
            hits.push(cx[e] + (cx[(e + 1) % 4] - cx[e]) * t, cy[e] + (cy[(e + 1) % 4] - cy[e]) * t);
          }
        }
        if (hits.length === 4) out.push(hits[0], hits[1], hits[2], hits[3]);
        else if (hits.length === 8) out.push(...hits);
      }
    }
  }
  return new Float32Array(out);
}

// Field strength sampled on a grid, for the vector view.
export function sampleVectors(field: Field, bounds: Bounds, spacing: number) {
  const out: { x: number; y: number; ex: number; ey: number }[] = [];
  const e = [0, 0];
  const x0 = bounds.minX + (((bounds.maxX - bounds.minX) % spacing) + spacing) / 2;
  const y0 = bounds.minY + (((bounds.maxY - bounds.minY) % spacing) + spacing) / 2;
  for (let y = y0; y < bounds.maxY; y += spacing) {
    for (let x = x0; x < bounds.maxX; x += spacing) {
      if (field.nearestFeature(x, y) < spacing * 0.3) continue;
      field.E(x, y, e);
      out.push({ x, y, ex: e[0], ey: e[1] });
    }
  }
  return out;
}
