import { coilTurns, H_pack, lsq, OE } from './physics.js';

export const SD_FLOOR = 0.1 / Math.sqrt(12);
export const FITSPEC = [
  { key: 'k', label: 'Amplitude factor k', unit: '' },
  { key: 'x0', label: 'Probe zero x0', unit: 'mm' },
  { key: 'Hbg', label: 'Background Hbg', unit: 'Oe' },
  { key: 'R1', label: 'Coil 1 radius R1', unit: 'mm' },
  { key: 'd', label: 'Measurement span d', unit: 'mm' },
  { key: 'R2', label: 'Coil 2 radius R2', unit: 'mm' }
];

export function measurementStats(readings) {
  const v = readings.map(Number).filter(Number.isFinite), n = v.length;
  if (!n) return { n: 0, mean: null, sd: null };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1)) : 0;
  return { n, mean, sd };
}

export function measuredRows(positions) {
  return positions.map(p => ({ ...p, ...measurementStats(p.readings) })).filter(p => p.n > 0);
}

export function weightedLinearFit(rows) {
  if (rows.length < 2 || new Set(rows.map(p => p.x)).size < 2) return null;
  const xs = rows.map(p => p.x / 1000), ys = rows.map(p => p.mean);
  const ws = rows.map(p => p.n / Math.pow(Math.max(p.sd, SD_FLOOR), 2));
  return { ...lsq(xs, ys, ws), unweighted: lsq(xs, ys), weights: ws };
}

export function experimentalMetrics(rows, model, target, fit) {
  if (!rows.length) return null;
  const residual = f => rows.map(p => ({ x: p.x, value: p.mean - f(p.x) }));
  const summarize = values => {
    const max = values.reduce((a, b) => Math.abs(b.value) > Math.abs(a.value) ? b : a);
    return { maxAbs: Math.abs(max.value), at: max.x, rmse: Math.sqrt(values.reduce((s, p) => s + p.value ** 2, 0) / values.length),
      bias: values.reduce((s, p) => s + p.value, 0) / values.length };
  };
  const targetResidual = residual(target), modelResidual = residual(model);
  const fitResidual = fit ? residual(x => fit.a * x / 1000 + fit.b) : [];
  const sds = rows.map(p => p.sd);
  return { target: summarize(targetResidual), model: summarize(modelResidual), fit: fit ? summarize(fitResidual) : null,
    targetResidual, modelResidual, fitResidual,
    meanSd: sds.reduce((a, b) => a + b, 0) / sds.length, maxSd: Math.max(...sds),
    endpoints: { first: rows[0], last: rows[rows.length - 1] } };
}

export function modelMaker(S0, P) {
  const c1 = { ...S0.c1, R: P.R1 / 1000 };
  const c2 = { ...S0.c2, R: P.R2 / 1000, xc: P.d / 1000 + S0.c2EdgeOffset };
  const T1 = coilTurns(c1), T2 = coilTurns(c2);
  const I = S0.I * P.k;
  return xmm => {
    const x = (xmm - P.x0) / 1000;
    return (H_pack(x, T1, c1.dir, I) + H_pack(x, T2, c2.dir, I)) / OE + P.Hbg;
  };
}

export function solveLin(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export function invert(A) {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map(r => r.slice(n));
}

export function lmFit(S0, measured, keys = ['k', 'R1'], weighted = true, maxIterations = 80) {
  const active = FITSPEC.filter(f => keys.includes(f.key));
  const n = measured.length, m = active.length;
  if (n < 3 || !m || n <= m) throw new Error(`LM requires at least ${Math.max(3, m + 1)} measured positions.`);
  const design = { k: 1, x0: 0, Hbg: 0, R1: S0.c1.R * 1000, d: S0.d * 1000, R2: S0.c2.R * 1000 };
  const w = measured.map(p => weighted ? p.n / Math.pow(Math.max(p.sd, SD_FLOOR), 2) : 1);
  const build = pv => { const P = { ...design }; active.forEach((f, j) => P[f.key] = pv[j]); return P; };
  const curve = pv => { const f = modelMaker(S0, build(pv)); return measured.map(p => f(p.x)); };
  const chi2 = pv => { const r = curve(pv); let s = 0;
    for (let i = 0; i < n; i++) { const e = measured[i].mean - r[i]; s += w[i] * e * e; } return s; };
  let p = active.map(f => design[f.key]);
  let c = chi2(p), lambda = 1e-3, it = 0, converged = false;
  const MAXIT = Math.max(5, maxIterations | 0);
  const jacobian = pv => {
    const J = Array.from({ length: n }, () => new Array(m).fill(0));
    for (let j = 0; j < m; j++) {
      const h = Math.max(1e-6, Math.abs(pv[j]) * 1e-5);
      const pp = pv.slice(); pp[j] += h; const rp = curve(pp);
      const pm = pv.slice(); pm[j] -= h; const rm = curve(pm);
      for (let i = 0; i < n; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h);
    }
    return J;
  };
  const normal = (pv, J) => {
    const r0 = curve(pv);
    const A = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
    for (let i = 0; i < n; i++) {
      const e = measured[i].mean - r0[i];
      for (let j = 0; j < m; j++) {
        b[j] += w[i] * e * J[i][j];
        for (let k = 0; k < m; k++) A[j][k] += w[i] * J[i][j] * J[i][k];
      }
    }
    return { A, b };
  };
  for (it = 0; it < MAXIT; it++) {
    const J = jacobian(p), { A, b } = normal(p, J);
    let stepped = false;
    for (let t = 0; t < 14; t++) {
      const Ad = A.map((row, j) => row.map((v, k) => k === j ? v * (1 + lambda) : v));
      const dp = solveLin(Ad, b);
      if (!dp) { lambda *= 10; continue; }
      const pn = p.map((v, j) => v + dp[j]);
      const cn = chi2(pn);
      if (isFinite(cn) && cn < c) {
        const rel = (c - cn) / Math.max(c, 1e-30);
        p = pn; c = cn; lambda = Math.max(lambda / 10, 1e-12); stepped = true;
        if (rel < 1e-10) converged = true;
        break;
      }
      lambda *= 10;
      if (lambda > 1e13) break;
    }
    if (!stepped) { converged = true; break; }
    if (converged) break;
  }
  const Jf = jacobian(p), { A: Af } = normal(p, Jf), inv = invert(Af);
  const dof = n - m, chi2red = c / dof;
  const se = inv ? active.map((f, j) => Math.sqrt(Math.max(0, inv[j][j] * chi2red))) : active.map(() => NaN);
  const P = build(p), fn = modelMaker(S0, P);
  const resid = measured.map(q => q.mean - fn(q.x));
  const rms = Math.sqrt(resid.reduce((a, b) => a + b * b, 0) / n), maxr = Math.max(...resid.map(Math.abs));
  const base = modelMaker(S0, design);
  const rmsBase = Math.sqrt(measured.reduce((a, q) => a + Math.pow(q.mean - base(q.x), 2), 0) / n);
  let corr = null, worst = null;
  if (inv) {
    corr = active.map((_, i) => active.map((__, j) => inv[i][j] / Math.sqrt(Math.max(1e-300, inv[i][i] * inv[j][j]))));
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++)
      if (!worst || Math.abs(corr[i][j]) > Math.abs(worst.r)) worst = { r: corr[i][j], a: active[i].label, b: active[j].label };
  }
  return { P, design, active, se, chi2: c, chi2red, rms, maxr, rmsBase, dof, it, converged, weighted, corr, worst, fn, resid };
}
