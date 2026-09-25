// SFD・BMD — 梁の力学モデル（純粋関数のみ、DOM 非依存）
//
// 反力は equilibrium/ のつり合いの解法（analyze）をそのまま使う。支点を未知反力に置き換えて渡す:
//   ピン・ローラー … 鉛直の未知反力 R（上向きを仮定）
//   固定          … R と反力モーメント M_R（反時計まわりを仮定）
// 荷重は鉛直だけなので、ピンの水平反力は常に 0 として省いている。
//
// 断面力の符号は Grading の Beam.py と同じ（左側の自由体の、右端の断面に働く力で定義）:
//   V … 下向きが正     V = Σ（断面より左の上向きの力）
//   M … 反時計まわりが正（下側が引張＝サギング）  M = Σ F_i (x − a_i) − Σ C_i
//   （C_i は断面より左の集中モーメント・反力モーメント。反時計まわり正）
// グラフは V・M とも上が正（Beam.py の SFD/BMD と同じ）。
//
// 位置 t は梁の長さ L を 1 とした無次元量。力は kN、w は kN/m、モーメントは kN·m。

import {
  analyze, sumLines, posTex, toRational, fmt, DIST_SHAPES, distResultant, distResultantTex,
} from '../equilibrium/model.js';

export { fmt, posTex, DIST_SHAPES };

// ---------------------------------------------------------------- 記号

/** 支点を左から並べたときの反力の記号（Beam.py と同じ: 1 つなら R、複数なら R_1 …、M_R / M_{R1} …） */
function supportActions(supports) {
  const sorted = supports.map((s, i) => ({ ...s, i })).sort((a, b) => a.t - b.t);
  const nR = sorted.length;
  const nM = sorted.filter((s) => s.type === 'fixed').length;
  const out = [];
  let iM = 0;
  sorted.forEach((s, j) => {
    const r = nR === 1 ? 'R' : `R_{${j + 1}}`;
    out.push({ type: 'reaction', t: s.t, dir: 90, name: { sym: r, theta: '' }, support: s.i });
    if (s.type === 'fixed') {
      iM++;
      out.push({ type: 'rmoment', t: s.t, sgn: 1, name: { sym: nM === 1 ? 'M_{R}' : `M_{R${iM}}` }, support: s.i });
    }
  });
  return out;
}

/**
 * 荷重の記号。集中荷重は P / P_1 …、分布荷重は w / w_1 …（equilibrium/ と同じ）。
 * 集中モーメントは曲げモーメント M と衝突するので、Beam.py と同じく M_0, M_1 … と 0 から振る。
 */
export function loadNames(loads) {
  const count = (type) => loads.filter((a) => a.type === type).length;
  const idx = { point: 0, moment: 0, dist: 0 };
  return loads.map((a) => {
    const n = count(a.type);
    const i = ++idx[a.type];
    if (a.type === 'moment') return { sym: `M_{${i - 1}}` };
    const base = a.type === 'point' ? 'P' : 'w';
    return { sym: n === 1 ? base : `${base}_{${i}}` };
  });
}

// ---------------------------------------------------------------- 反力

/**
 * state = { supports: [{type, t}], loads: [...], Lm }
 * 返り値 { status, reactions: [{ support, kind: 'R'|'M', sym, t, value }], lines, actions }
 *   status: 'solved' | 'under'（不静定・決まらない）| 'inconsistent'（不安定）| 'none'（支点なし）
 */
export function solveReactions(state) {
  const names = loadNames(state.loads);
  // 集中荷重は up（上向きか）で持っているので、equilibrium/ の dir（+x から反時計まわり）に直す
  const loads = state.loads.map((a, k) => ({
    ...a, name: names[k], ...(a.type === 'point' ? { dir: a.up ? 90 : -90 } : {}),
  }));
  const reacts = supportActions(state.supports);
  const actions = [...reacts, ...loads];
  const st = { actions, tO: 0, Lm: state.Lm, notation: 'L', mode: 'free' };
  if (!reacts.length) return { status: 'none', reactions: [], lines: null, actions, names };
  const res = analyze(st);
  const reactions = res.unknowns.map((u) => {
    const a = actions[u.k];
    return {
      support: a.support, kind: a.type === 'rmoment' ? 'M' : 'R', sym: u.sym, t: a.t,
      value: u.value,
    };
  });
  return { status: res.status, reactions, lines: sumLines(st, res), actions, names };
}

// ---------------------------------------------------------------- 断面力（数値）

/** 断面より左（t < x）にある分布荷重の部分の合力 F [kN、上向き正] と、断面まわりのモーメント [kN·m] */
function distPart(a, x, Lm) {
  if (x <= a.t1) return { F: 0, M: 0 };
  const c = (a.t2 - a.t1) * Lm;
  const u = (Math.min(x, a.t2) - a.t1) * Lm;
  const w = a.w;
  let F, S; // F = ∫q ds、S = ∫q s ds（s は始点からの距離）
  if (a.shape === 'r') { F = (w * u * u) / (2 * c); S = (w * u ** 3) / (3 * c); }
  else if (a.shape === 'l') { F = w * (u - (u * u) / (2 * c)); S = w * ((u * u) / 2 - u ** 3 / (3 * c)); }
  else { F = w * u; S = (w * u * u) / 2; }
  if (c < 1e-12) { F = 0; S = 0; }
  const sg = a.up ? 1 : -1;
  const xm = (x - a.t1) * Lm; // 始点から断面まで
  // 断面まわり: 上向きの力は断面の左にあると M を正に（F·(x − a)）
  return { F: sg * F, M: sg * (F * xm - S) };
}

/**
 * 位置 x（0..1）の断面力。断面より左（t < x）にあるものだけを数える
 * （ちょうど x にある集中荷重は含めない。グラフではそこで跳ぶ）。
 * items は forceItems() の結果（反力の値を入れたもの）。
 */
export function sectionAt(items, x, Lm) {
  let V = 0, M = 0;
  for (const it of items) {
    if (it.kind === 'dist') {
      const d = distPart(it.a, x, Lm);
      V += d.F; M += d.M;
    } else if (it.t < x - 1e-12) {
      if (it.kind === 'force') { V += it.Fy; M += it.Fy * (x - it.t) * Lm; }
      else M -= it.C;
    }
  }
  return { V, M };
}

/**
 * 断面力の計算に使う力の一覧（反力は解いた値を入れる）
 *   { kind: 'force', t, Fy, sym, isReaction } / { kind: 'couple', t, C, sym } / { kind: 'dist', a, sym }
 */
export function forceItems(state, sol) {
  const items = [];
  if (sol.status === 'solved') {
    for (const r of sol.reactions) {
      if (r.kind === 'R') items.push({ kind: 'force', t: r.t, Fy: r.value, sym: r.sym, isReaction: true });
      else items.push({ kind: 'couple', t: r.t, C: r.value, sym: r.sym, isReaction: true, sgnAssumed: 1 });
    }
  }
  state.loads.forEach((a, k) => {
    const sym = sol.names[k].sym;
    if (a.type === 'point') items.push({ kind: 'force', t: a.t, Fy: a.up ? a.P : -a.P, sym, up: a.up, k });
    else if (a.type === 'moment') items.push({ kind: 'couple', t: a.t, C: a.C, sym, k });
    else if (a.type === 'dist') items.push({ kind: 'dist', a, sym, k });
  });
  return items;
}

/** 区間の境目（荷重・支点・分布荷重の端） */
export function breakpoints(state) {
  const set = [0, 1];
  for (const s of state.supports) set.push(s.t);
  for (const a of state.loads) {
    if (a.type === 'dist') set.push(a.t1, a.t2);
    else set.push(a.t);
  }
  const out = [...new Set(set.map((t) => Math.round(t * 1e9) / 1e9))].sort((a, b) => a - b);
  return out.filter((t) => t >= 0 && t <= 1);
}

/**
 * グラフ用の点列。区間ごとに標本をとり、境目では左の極限と右の極限を両方入れる（跳びを縦線で描くため）。
 * 返り値 { pts: [{ x, V, M }], extremes: { Vmax, Vmin, Mmax, Mmin（それぞれ { x, v }）} }
 */
export function diagram(state, items, n = 80) {
  const Lm = state.Lm;
  const bps = breakpoints(state);
  const pts = [];
  const eps = 1e-9;
  for (let i = 0; i < bps.length - 1; i++) {
    const a = bps[i], b = bps[i + 1];
    if (b - a < 1e-9) continue;
    for (let j = 0; j <= n; j++) {
      const x = j === 0 ? a + eps : j === n ? b - eps : a + ((b - a) * j) / n;
      const f = sectionAt(items, x, Lm);
      pts.push({ x: j === 0 ? a : j === n ? b : x, ...f });
    }
  }
  // 両端（梁の外）は 0。支点の反力で 0 から跳ぶ様子を縦線で見せる
  const first = { x: 0, V: 0, M: 0 };
  const lastF = sectionAt(items, 1 + 1e-6, Lm); // 右端の荷重・反力も含めた合計（つり合えば 0）
  const last = { x: 1, V: lastF.V, M: lastF.M };
  const all = [first, ...pts, last];

  // 最大・最小。M は V = 0 になる点（区間内で連続に符号が変わるところ）を二分法で詰める
  const ext = { Vmax: null, Vmin: null, Mmax: null, Mmin: null };
  const upd = (key, x, v, better) => { if (!ext[key] || better(v, ext[key].v)) ext[key] = { x, v }; };
  for (const p of pts) {
    upd('Vmax', p.x, p.V, (u, v) => u > v + 1e-9);
    upd('Vmin', p.x, p.V, (u, v) => u < v - 1e-9);
    upd('Mmax', p.x, p.M, (u, v) => u > v + 1e-9);
    upd('Mmin', p.x, p.M, (u, v) => u < v - 1e-9);
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1];
    if (q.x - p.x < 1e-12 || p.V * q.V >= 0) continue;
    let lo = p.x, hi = q.x;
    const sLo = Math.sign(p.V);
    for (let it = 0; it < 50; it++) {
      const mid = (lo + hi) / 2;
      if (Math.sign(sectionAt(items, mid, Lm).V) === sLo) lo = mid; else hi = mid;
    }
    const x0 = (lo + hi) / 2;
    const m = sectionAt(items, x0, Lm).M;
    upd('Mmax', x0, m, (u, v) => u > v + 1e-9);
    upd('Mmin', x0, m, (u, v) => u < v - 1e-9);
  }
  return { pts: all, extremes: ext, bps };
}

// ---------------------------------------------------------------- 式（TeX）
//
// 仮想断面を x の位置にとったとき、左側の自由体のつり合いから V・M を x の式で書く。
// 反力は記号のまま（値は別に出す）。長さは L の分数で書く。

/** c·S/L の TeX（例: c = 1/2 → \frac{w}{2L}、c = 3/2 → \frac{3w}{2L}） */
function wOverL(S, c) {
  const r = toRational(c, 120);
  if (!r) return `${fmt(c, 3)}\\frac{${S}}{L}`;
  const [n, d] = r;
  return `\\frac{${n === 1 ? '' : n}${S}}{${d === 1 ? '' : d}L}`;
}

/** (x − aL)。a = 0 なら x */
function xMinus(a) {
  if (Math.abs(a) < 1e-12) return 'x';
  return `\\left(x - ${posTex(a, 'L')}\\right)`;
}
/** (x − aL)^p。a = 0 なら x^p */
function xMinusPow(a, p) {
  if (p === 1) return xMinus(a);
  return Math.abs(a) < 1e-12 ? `x^{${p}}` : `${xMinus(a)}^{${p}}`;
}

const sgnTex = (neg) => (neg ? '-' : '+');

/**
 * 仮想断面が x にあるときの V・M の式。
 * 返り値 { V: TeX, M: TeX, left: [記号…]（左側に含まれるもの）, interval: [a, b] }
 */
export function sectionFormulas(state, items, x) {
  const bps = breakpoints(state);
  let a = 0, b = 1;
  for (let i = 0; i + 1 < bps.length; i++) {
    if (x >= bps[i] - 1e-12 && x <= bps[i + 1] + 1e-12) { a = bps[i]; b = bps[i + 1]; if (x < bps[i + 1] - 1e-12) break; }
  }
  const mid = (a + b) / 2; // 区間の中で式は同じ形なので、中央で判定する
  const V = [], M = [];
  for (const it of items) {
    if (it.kind === 'force') {
      if (it.t >= mid) continue;
      const neg = it.Fy < 0 && !it.isReaction; // 反力は上向きを仮定した記号のまま
      V.push(`${sgnTex(neg)}${it.sym}`);
      M.push(`${sgnTex(neg)}${it.sym}${Math.abs(it.t) < 1e-12 ? 'x' : xMinus(it.t)}`);
    } else if (it.kind === 'couple') {
      if (it.t >= mid) continue;
      // M = … − C（反時計まわり正）。集中モーメントは向きを符号に、反力モーメントは仮定の向きのまま
      const ccw = it.isReaction ? true : it.C >= 0;
      M.push(`${sgnTex(ccw)}${it.sym}`);
    } else {
      const d = it.a;
      if (mid <= d.t1) continue;
      const S = it.sym;
      const neg = !d.up;
      if (mid >= d.t2) {
        // 通り過ぎた分布荷重は合力（図心に作用）に置きかえる
        const W = distResultantTex(d, S, 'L');
        const tc = distResultant(d, state.Lm).tc;
        V.push(`${sgnTex(neg)}${W}`);
        M.push(`${sgnTex(neg)}${W}${xMinus(tc)}`);
      } else {
        // 三角形は強さが w·(x − a)/c（c = 区間の長さ = bL）。係数 1/(2b), 1/(6b) を w/L にまとめる
        const bL = d.t2 - d.t1;
        const k2 = wOverL(S, 1 / (2 * bL));
        const k6 = wOverL(S, 1 / (6 * bL));
        if (d.shape === 'r') {
          V.push(`${sgnTex(neg)}${k2}${xMinusPow(d.t1, 2)}`);
          M.push(`${sgnTex(neg)}${k6}${xMinusPow(d.t1, 3)}`);
        } else if (d.shape === 'l') {
          V.push(`${sgnTex(neg)}${S}${xMinus(d.t1)} ${sgnTex(!neg)}${k2}${xMinusPow(d.t1, 2)}`);
          M.push(`${sgnTex(neg)}\\frac{${S}}{2}${xMinusPow(d.t1, 2)} ${sgnTex(!neg)}${k6}${xMinusPow(d.t1, 3)}`);
        } else {
          V.push(`${sgnTex(neg)}${S}${xMinus(d.t1)}`);
          M.push(`${sgnTex(neg)}\\frac{${S}}{2}${xMinusPow(d.t1, 2)}`);
        }
      }
    }
  }
  const join = (arr) => (arr.length ? arr.join(' ').replace(/^\+/, '') : '0');
  return { V: join(V), M: join(M), interval: [a, b] };
}

/** 区間の TeX（例: \frac{1}{3}L < x < \frac{1}{2}L） */
export function intervalTex([a, b]) {
  return `${posTex(a, 'L')} < x < ${posTex(b, 'L')}`;
}

export function signed(x, digits = 3) {
  const s = fmt(x, digits);
  if (s === '0') return '0';
  return x < 0 ? s : '+' + s;
}
