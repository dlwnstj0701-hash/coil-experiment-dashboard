// Numerical model ported from ragel8326/coil-simulator, main/index.html (2026-09-28).
export const OE = 79.5774715459;
export const RHO = 1.68e-8;

export function coilTurns(c) {
  const rs = [], xs = [];
  for (let j = 0; j < c.n; j++) {
    const rj = c.R + (j - (c.n - 1) / 2) * c.dw;
    const cnt = j === c.n - 1 ? c.last : c.m;
    for (let i = 0; i < cnt; i++) {
      rs.push(rj);
      xs.push(c.xc + (i - (cnt - 1) / 2) * c.dw);
    }
  }
  return { rs: Float64Array.from(rs), xs: Float64Array.from(xs), N: rs.length };
}

export function turnCount(c) { return c.m * (c.n - 1) + c.last; }

export function H_pack(x, T, dir, I) {
  let s = 0;
  const rs = T.rs, xs = T.xs, L = rs.length;
  for (let k = 0; k < L; k++) {
    const r = rs[k], dx = x - xs[k];
    const q = r * r + dx * dx;
    s += r * r / (q * Math.sqrt(q));
  }
  return dir * I * s / 2;
}

export function H_thin(x, c, I) {
  const N = turnCount(c), dx = x - c.xc, q = c.R * c.R + dx * dx;
  return c.dir * I * N * c.R * c.R / (2 * q * Math.sqrt(q));
}

export function lsq(xs, ys, ws) {
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const w = ws ? ws[i] : 1;
    sw += w; sx += w * xs[i]; sy += w * ys[i]; sxx += w * xs[i] * xs[i]; sxy += w * xs[i] * ys[i];
  }
  const den = sw * sxx - sx * sx;
  const a = den === 0 ? 0 : (sw * sxy - sx * sy) / den;
  const b = den === 0 ? sy / sw : (sy - a * sx) / sw;
  const ym = sy / sw; let ssr = 0, sst = 0;
  for (let i = 0; i < xs.length; i++) {
    const w = ws ? ws[i] : 1;
    ssr += w * Math.pow(ys[i] - (a * xs[i] + b), 2); sst += w * Math.pow(ys[i] - ym, 2);
  }
  return { a, b, r2: sst === 0 ? 1 : 1 - ssr / sst };
}

export function findInflection(f, xa, xb) {
  const h = (xb - xa) / 400;
  const d2 = x => (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
  let prev = d2(xa + h), best = null;
  const n = 200;
  for (let i = 1; i <= n; i++) {
    const x = xa + (xb - xa) * i / n;
    const cur = d2(x);
    if (prev === 0 || (prev < 0) !== (cur < 0)) {
      let lo = xa + (xb - xa) * (i - 1) / n, hi = x;
      for (let t = 0; t < 40; t++) {
        const mid = (lo + hi) / 2;
        if ((d2(lo) < 0) !== (d2(mid) < 0)) hi = mid; else lo = mid;
      }
      best = (lo + hi) / 2; break;
    }
    prev = cur;
  }
  return best;
}

export function setupToState(setup) {
  const dw = setup.dw / 1000, d = setup.d / 1000;
  const mk = (c, xc) => ({
    R: Math.max(1e-4, c.R / 1000), m: Math.max(1, Math.round(c.m)),
    n: Math.max(1, Math.round(c.n)), last: Math.min(Math.max(1, Math.round(c.last)), Math.max(1, Math.round(c.m))),
    dw, xc, dir: c.dir
  });
  return { I: setup.I || 1, dw, d, c1: mk(setup.c1, 0), c2: mk(setup.c2, d), xa: 0, xb: d, h1: setup.h1, h2: setup.h2 };
}

export function evaluate(S, nWin = 121) {
  const T1 = coilTurns(S.c1), T2 = coilTurns(S.c2);
  const total = x => (H_pack(x, T1, S.c1.dir, S.I) + H_pack(x, T2, S.c2.dir, S.I)) / OE;
  const thin = x => (H_thin(x, S.c1, S.I) + H_thin(x, S.c2, S.I)) / OE;
  const xa = S.xa, xb = S.xb, span = xb - xa;
  const wx = [], wm = [], wt = [], wthin = [];
  for (let i = 0; i < nWin; i++) {
    const u = i / (nWin - 1), x = xa + span * u;
    wx.push(x); wm.push(total(x)); wthin.push(thin(x));
  }
  const hAt0 = wm[0], hAtD = wm[wm.length - 1];
  for (let i = 0; i < nWin; i++) wt.push(S.h1 + (S.h2 - S.h1) * i / (nWin - 1));
  const fieldDrop = Math.abs(S.h1 - S.h2);
  let maxDev = 0, sse = 0, normMaxDev = 0, normSse = 0, thinDiffPct = 0;
  for (let i = 0; i < nWin; i++) {
    const e = wm[i] - wt[i];
    if (Math.abs(e) > maxDev) maxDev = Math.abs(e);
    sse += e * e;
    const re = e / fieldDrop;
    if (Math.abs(re) > normMaxDev) normMaxDev = Math.abs(re);
    normSse += re * re;
    const td = Math.abs(wm[i] - wthin[i]) / Math.max(1e-9, Math.abs(wthin[i])) * 100;
    if (td > thinDiffPct) thinDiffPct = td;
  }
  const rmsDev = Math.sqrt(sse / nWin), normRmsDev = Math.sqrt(normSse / nWin);
  const fit = lsq(wx, wm);
  let nonlin = 0;
  for (let i = 0; i < nWin; i++) nonlin = Math.max(nonlin, Math.abs(wm[i] - (fit.a * wx[i] + fit.b)));
  const wireLength = T => { let L = 0; for (let k = 0; k < T.rs.length; k++) L += 2 * Math.PI * T.rs[k]; return L; };
  const resistance = (len, diameter) => RHO * len / (Math.PI * (diameter / 2) ** 2);
  const L1 = wireLength(T1), L2 = wireLength(T2);
  const R1o = resistance(L1, S.dw), R2o = resistance(L2, S.dw);
  const Rtot = R1o + R2o, P = S.I * S.I * Rtot, V = S.I * Rtot;
  const h1solo = H_pack(S.c1.xc, T1, 1, S.I) / OE;
  const infl = findInflection(total, xa, xb);
  return { T1, T2, total, thin, wx, wm, wt, wthin, maxDev, rmsDev, normMaxDev, normRmsDev,
    nonlin, fit, thinDiffPct, L1, L2, R1o, R2o, Rtot, P, V, h1solo, hAt0, hAtD, infl,
    N1: turnCount(S.c1), N2: turnCount(S.c2), span };
}
