// SFD・BMD — 記号の式（荷重の記号・L・x の多項式）
//
// 反力を荷重の記号で解き（例: R_1 = \frac{2}{3}P）、断面力を x の多項式として組み立てる。
// グラフのラベルを「数式ベース」にするため（M_max = \frac{1}{8}wL^2 のように出す）。
//
// 多項式は項の集まり。各項は c·S·L^p·x^q（S は荷重の記号、c は数。位置が分数なら c も分数になる）。
// 集中モーメントの記号は大きさ（向きは符号 c に入れる）。反力は解いた式に置きかえるか、記号のまま残す。

import { toRational, fmt, DIST_SHAPES, distResultant } from '../equilibrium/model.js';
import { breakpoints } from './model.js';

// ---------------------------------------------------------------- 多項式

const key = (S, p, q) => `${S}|${p}|${q}`;

export function poly() { return new Map(); }

function addTerm(P, S, c, p = 0, q = 0) {
  if (Math.abs(c) < 1e-13) return P;
  const k = key(S, p, q);
  const t = P.get(k);
  if (t) {
    t.c += c;
    if (Math.abs(t.c) < 1e-12) P.delete(k);
  } else P.set(k, { S, c, p, q });
  return P;
}

/** P += f·Q（L の次数を dp、x の次数を dq だけずらす） */
function addPoly(P, Q, f = 1, dp = 0, dq = 0) {
  for (const t of Q.values()) addTerm(P, t.S, t.c * f, t.p + dp, t.q + dq);
  return P;
}

/** Q·(x − aL)^n を P に足す（二項展開） */
function addTimesXMinus(P, Q, a, n, f = 1) {
  let binom = 1;
  for (let k = 0; k <= n; k++) {
    // C(n,k) x^{n−k} (−aL)^k
    const c = binom * (-a) ** k;
    if (Math.abs(c) > 1e-15) addPoly(P, Q, f * c, k, n - k);
    binom = (binom * (n - k)) / (k + 1);
  }
  return P;
}

const single = (S, c = 1, p = 0) => addTerm(poly(), S, c, p, 0);

/** x = xv·L を代入（x の次数が L の次数になる） */
export function atX(P, xv) {
  const out = poly();
  for (const t of P.values()) addTerm(out, t.S, t.c * xv ** t.q, t.p + t.q, 0);
  return out;
}

/** 数値に直す（vals: 記号 → 値、L は m、x は m） */
export function evalPoly(P, vals, Lm, xm = 0) {
  let s = 0;
  for (const t of P.values()) s += t.c * (vals[t.S] ?? 0) * Lm ** t.p * xm ** t.q;
  return s;
}

/** 係数が分数に直せるか（分母は大きめまで許す。位置が 1/200 刻みのときは小数で出す） */
function ratOf(c) {
  return toRational(Math.abs(c), 720);
}

/** 多項式の TeX。教科書の書き方に合わせて x の次数の低い順（wL/2 − wx の順）、同じなら L の次数の高い順 */
export function polyTex(P) {
  const ts = [...P.values()].sort((a, b) => a.q - b.q || b.p - a.p || a.S.localeCompare(b.S));
  if (!ts.length) return '0';
  const pw = (v, e) => (e === 0 ? '' : e === 1 ? v : `${v}^{${e}}`);
  return ts.map((t, i) => {
    const sg = t.c < 0 ? '-' : i ? '+' : '';
    const r = ratOf(t.c);
    const body = `${t.S}${pw('L', Math.max(0, t.p))}${pw('x', t.q)}`;
    const denL = t.p < 0 ? pw('L', -t.p) : '';
    if (!r) return `${sg}${fmt(Math.abs(t.c), 3)}${denL ? `\\frac{${body}}{${denL}}` : body}`;
    const [n, d] = r;
    if (d === 1 && !denL) return `${sg}${n === 1 ? '' : n}${body}`;
    // 分数は \frac{n}{d} を前に出す（\frac{1}{2}wL^2）。L で割る項だけ \frac{M_0}{L} の形
    if (denL) return `${sg}\\frac{${n === 1 ? '' : n}${body}}{${d === 1 ? '' : d}${denL}}`;
    return `${sg}\\frac{${n}}{${d}}${body}`;
  }).join(' ');
}

// ---------------------------------------------------------------- 反力を記号で解く

/**
 * 反力を荷重の記号で表す。未知量が 2 つで一意に解けるときだけ（静定梁）。
 * 返り値 Map(反力の記号 → 多項式) か null。
 * つり合い: ΣF = 0、左端まわり ΣM = 0 を L で割ったもの（未知量の係数を数にするため、
 * 反力モーメントは m = M_R / L を未知量にして、解いたあと L を掛け戻す）。
 */
export function symbolicReactions(state, sol) {
  if (sol.status !== 'solved' || sol.reactions.length !== 2) return null;
  const F = poly(), Mo = poly(); // 既知の荷重の ΣF、ΣM/L
  state.loads.forEach((a, k) => {
    const S = sol.names[k].sym;
    if (a.type === 'point') {
      const s = a.up ? 1 : -1;
      addTerm(F, S, s); addTerm(Mo, S, s * a.t);
    } else if (a.type === 'moment') {
      if (Math.abs(a.C) > 1e-12) addTerm(Mo, S, Math.sign(a.C), -1);
    } else if (a.type === 'dist') {
      const s = a.up ? 1 : -1;
      const sh = DIST_SHAPES[a.shape] || DIST_SHAPES.u;
      const kb = (sh.k[0] / sh.k[1]) * (a.t2 - a.t1);
      const tc = distResultant(a, 1).tc;
      addTerm(F, S, s * kb, 1); addTerm(Mo, S, s * kb * tc, 1);
    }
  });
  const U = sol.reactions.map((r) => (r.kind === 'R' ? [1, r.t] : [0, 1]));
  const det = U[0][0] * U[1][1] - U[1][0] * U[0][1];
  if (Math.abs(det) < 1e-12) return null;
  // A = [[U0F, U1F], [U0M, U1M]]、A u = −[F; Mo]
  const inv = [[U[1][1] / det, -U[1][0] / det], [-U[0][1] / det, U[0][0] / det]];
  const out = new Map();
  sol.reactions.forEach((r, i) => {
    const P = poly();
    addPoly(P, F, -inv[i][0]);
    addPoly(P, Mo, -inv[i][1]);
    out.set(r.sym, r.kind === 'M' ? addPoly(poly(), P, 1, 1) : P);
  });
  return out;
}

// ---------------------------------------------------------------- 断面力の多項式

/**
 * 区間 [a, b] の中での V(x)・M(x)。subs があれば反力をその式に置きかえ、無ければ記号のまま。
 * 断面より左にあるかは区間の中央で判定する（model.js の sectionFormulas と同じ）。
 */
export function sectionPolys(state, sol, [a, b], subs) {
  const mid = (a + b) / 2;
  const V = poly(), M = poly();
  const react = (sym) => (subs && subs.get(sym)) || single(sym);
  for (const r of sol.reactions) {
    if (r.t >= mid) continue;
    if (r.kind === 'R') { addPoly(V, react(r.sym)); addTimesXMinus(M, react(r.sym), r.t, 1); }
    else addPoly(M, react(r.sym), -1);
  }
  state.loads.forEach((d, k) => {
    const S = sol.names[k].sym;
    if (d.type === 'point') {
      if (d.t >= mid) return;
      const s = d.up ? 1 : -1;
      addTerm(V, S, s);
      addTimesXMinus(M, single(S), d.t, 1, s);
    } else if (d.type === 'moment') {
      if (d.t >= mid || Math.abs(d.C) < 1e-12) return;
      addTerm(M, S, -Math.sign(d.C));
    } else if (d.type === 'dist') {
      if (mid <= d.t1) return;
      const s = d.up ? 1 : -1;
      const bl = d.t2 - d.t1;
      if (mid >= d.t2) {
        const sh = DIST_SHAPES[d.shape] || DIST_SHAPES.u;
        const W = single(S, s * (sh.k[0] / sh.k[1]) * bl, 1);
        addPoly(V, W);
        addTimesXMinus(M, W, distResultant(d, 1).tc, 1);
        return;
      }
      const w = single(S, s);
      const wl = single(S, s / bl, -1); // w/(bL)
      if (d.shape === 'r') {
        addTimesXMinus(V, wl, d.t1, 2, 1 / 2);
        addTimesXMinus(M, wl, d.t1, 3, 1 / 6);
      } else if (d.shape === 'l') {
        addTimesXMinus(V, w, d.t1, 1);
        addTimesXMinus(V, wl, d.t1, 2, -1 / 2);
        addTimesXMinus(M, w, d.t1, 2, 1 / 2);
        addTimesXMinus(M, wl, d.t1, 3, -1 / 6);
      } else {
        addTimesXMinus(V, w, d.t1, 1);
        addTimesXMinus(M, w, d.t1, 2, 1 / 2);
      }
    }
  });
  return { V, M };
}

/** 位置 x（0..1）を含む区間 */
export function intervalOf(state, x) {
  const bps = breakpoints(state);
  for (let i = 0; i + 1 < bps.length; i++) {
    if (x >= bps[i] - 1e-12 && x < bps[i + 1] - 1e-12) return [bps[i], bps[i + 1]];
  }
  return [bps[bps.length - 2] ?? 0, 1];
}

/** 記号の値（数値で確かめる・表示するとき用）。集中モーメントは大きさ */
export function symbolValues(state, sol) {
  const vals = {};
  state.loads.forEach((a, k) => {
    const S = sol.names[k].sym;
    vals[S] = a.type === 'point' ? a.P : a.type === 'moment' ? Math.abs(a.C) : a.w;
  });
  for (const r of sol.reactions) vals[r.sym] = r.value;
  return vals;
}

/**
 * 断面力の位置 xv における値の式。左右の極限のうち、数値 target に合う方を選ぶ
 * （跳びのある境目の最大・最小のため）。xv が分数に直せなければ null。
 */
export function valueTexAt(state, sol, subs, key, xv, target) {
  const r = toRational(xv, 60);
  if (!r) return null;
  const vals = symbolValues(state, sol);
  const cands = [];
  for (const side of [-1, 1]) {
    const xs = xv + side * 1e-7;
    if (xs < 0 || xs > 1) continue;
    const P = sectionPolys(state, sol, intervalOf(state, xs), subs)[key];
    const at = atX(P, xv);
    cands.push({ at, err: Math.abs(evalPoly(at, vals, state.Lm) - target) });
  }
  cands.sort((a, b) => a.err - b.err);
  return cands.length ? polyTex(cands[0].at) : null;
}
