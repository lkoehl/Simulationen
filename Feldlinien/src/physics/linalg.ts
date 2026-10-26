// Dense LU decomposition with partial pivoting (row-major N x N).
export interface LU {
  n: number;
  a: Float64Array;
  piv: Int32Array;
}

export function luFactor(a: Float64Array, n: number): LU {
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;
  for (let k = 0; k < n; k++) {
    let p = k;
    let max = Math.abs(a[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(a[i * n + k]);
      if (v > max) {
        max = v;
        p = i;
      }
    }
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const t = a[k * n + j];
        a[k * n + j] = a[p * n + j];
        a[p * n + j] = t;
      }
      const t = piv[k];
      piv[k] = piv[p];
      piv[p] = t;
    }
    const akk = a[k * n + k];
    if (akk === 0) continue;
    for (let i = k + 1; i < n; i++) {
      const row = i * n;
      const f = (a[row + k] /= akk);
      if (f === 0) continue;
      const krow = k * n;
      for (let j = k + 1; j < n; j++) a[row + j] -= f * a[krow + j];
    }
  }
  return { n, a, piv };
}

export function luSolve({ n, a, piv }: LU, b: Float64Array): Float64Array {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = b[piv[i]];
  for (let i = 0; i < n; i++) {
    let s = x[i];
    for (let j = 0; j < i; j++) s -= a[i * n + j] * x[j];
    x[i] = s;
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= a[i * n + j] * x[j];
    x[i] = a[i * n + i] !== 0 ? s / a[i * n + i] : 0;
  }
  return x;
}
