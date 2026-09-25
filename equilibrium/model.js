// 力とモーメントのつり合い — 力学モデルと式の組み立て（純粋関数のみ、DOM 非依存）
//
// 単位・座標の約束:
//   位置 t は棒の長さ L を 1 とした無次元量（左端 0、右端 1）。
//   力は kN、角度は deg。モーメントの値は kN·m（L[m] を掛けて返す）。
//   力の向き dir は +x（右）から反時計まわりに測った角度（上向き = 90、下向き = -90）。
//   モーメントは反時計まわりを正とする。
//   長さの記号 lsym は 'L'（棒全体）か 'x'（切り取った自由体の長さ）。どちらも書き方は同じで、
//   位置・腕の長さを lsym の分数で書く（例: \frac{5}{12}L ／ \frac{5}{12}x）。
//
// 荷重の種類は ACTION_TYPES に登録する（集中荷重・未知反力・集中モーメント・反力モーメント）。
// 未知量（反力・反力モーメント）は「仮定した向きの大きさ u」を未知数にとり、
// つり合いの式（ピン: M_O = 0、自由体: F_x = F_y = M_O = 0）から解く。
// 合計・式・アニメーションの側は、各種類の effect()/terms()/names() しか見ていない。

// ---------------------------------------------------------------- 吸着

/** 位置が吸い付く分母（L/2, L/3, L/4, L/5, L/10 の倍数） */
export const SNAP_DENOMS = [1, 2, 3, 4, 5, 10];
/** 鉛直からの傾きが吸い付く角度 [deg] */
export const TILT_SNAPS = [0, 30, 45, 60, 90];
/** 吸着しなかった位置はこの刻みに丸める（小数表記が長くならないように） */
export const FREE_STEP = 1 / 200;

/**
 * 位置 t を分数の位置へ吸着させる。tol は t 単位の許容幅。
 * 分母が小さいほど吸い付きやすい（L/2 の近くでは L/2 を優先する）。
 */
export function snapPosition(t, tol) {
  let best = null;
  for (const d of SNAP_DENOMS) {
    const n = Math.round(t * d);
    const v = n / d;
    if (v < -1e-12 || v > 1 + 1e-12) continue;
    const err = Math.abs(t - v);
    const w = tol * (d <= 2 ? 1.3 : d <= 5 ? 1.0 : 0.7);
    if (err <= w && (!best || err < best.err - 1e-12)) best = { v, err };
  }
  if (best) return best.v;
  return clamp01(Math.round(t / FREE_STEP) * FREE_STEP);
}

/** 鉛直からの傾き（deg、符号付き）を吸着させる。細かい角度は 1° 刻み。 */
export function snapTilt(tilt, tolDeg = 5) {
  const s = Math.sign(tilt) || 1;
  const a = Math.abs(tilt);
  for (const v of TILT_SNAPS) {
    if (Math.abs(a - v) <= (v === 0 ? tolDeg * 1.4 : tolDeg)) return s * v;
  }
  return Math.round(tilt);
}

export function clamp01(t) {
  return Math.min(1, Math.max(0, t));
}

// ---------------------------------------------------------------- 向きの分解

export function normDeg(d) {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x <= -180) x += 360;
  return x;
}

/**
 * 向き dir を「上向き/下向き」と「鉛直からの傾き tilt（右へ倒すと正、-90..90）」に分解する。
 * 真横（tilt = ±90）のときは up = true として扱う。
 */
export function decompose(dir) {
  const d = normDeg(dir);
  const s = Math.sin((d * Math.PI) / 180);
  if (s > 1e-9) return { up: true, tilt: round6(90 - d) };
  if (s < -1e-9) return { up: false, tilt: round6(d + 90) };
  return { up: true, tilt: Math.abs(d) < 90 ? 90 : -90 };
}

export function compose(up, tilt) {
  return normDeg(up ? 90 - tilt : -90 + tilt);
}

function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}

// ---------------------------------------------------------------- 厳密な係数
//
// 係数 c = (n/d)·√s（s は平方因子を含まない整数）。符号は持たない（呼ぶ側で neg を持つ）。
// 分数に直せない位置のときは r = null で、v（小数）だけを使う。

const EXACT_COS = { 0: [1, 1, 1], 30: [1, 2, 3], 45: [1, 2, 2], 60: [1, 2, 1], 90: [0, 1, 1] };
const EXACT_SIN = { 0: [0, 1, 1], 30: [1, 2, 1], 45: [1, 2, 2], 60: [1, 2, 3], 90: [1, 1, 1] };

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** x を分母 maxDen 以下の分数 [n, d] に直す。直せなければ null。 */
export function toRational(x, maxDen = 60) {
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(x * d);
    if (Math.abs(x * d - n) < 1e-7) {
      const g = gcd(n, d);
      return [n / g, d / g];
    }
  }
  return null;
}

function makeCoef(n, d, s) {
  // √s の平方因子を外に出す（√12 = 2√3）
  let out = 1;
  for (const f of [2, 3, 5]) while (s % (f * f) === 0) { s /= f * f; out *= f; }
  n *= out;
  const g = gcd(n, d);
  return { r: [n / g, d / g], s, v: (n / d) * Math.sqrt(s) };
}

function mulCoef(a, b) {
  if (a.r && b.r) return makeCoef(a.r[0] * b.r[0], a.r[1] * b.r[1], a.s * b.s);
  return { r: null, s: 1, v: a.v * b.v };
}

/** a / b（b ≠ 0）。分母の √ は有理化する（1/√3 = √3/3）。 */
function divCoef(a, b) {
  if (a.r && b.r && b.r[0] !== 0) {
    return makeCoef(a.r[0] * b.r[1], a.r[1] * b.r[0] * b.s, a.s * b.s);
  }
  return { r: null, s: 1, v: a.v / b.v };
}

const ONE = { r: [1, 1], s: 1, v: 1 };

function coefOf(x) {
  const r = toRational(x);
  return r ? { r, s: 1, v: x } : { r: null, s: 1, v: x };
}

function trigCoef(table, deg) {
  const a = Math.abs(deg);
  const e = table[a];
  if (e) return { r: [e[0], e[1]], s: e[2], v: (e[0] / e[1]) * Math.sqrt(e[2]) };
  const rad = (a * Math.PI) / 180;
  return { r: null, s: 1, v: table === EXACT_COS ? Math.cos(rad) : Math.sin(rad) };
}

function isZero(c) {
  return c.r ? c.r[0] === 0 : Math.abs(c.v) < 1e-12;
}

/** 係数の TeX（符号なし）。unit を付けたとき係数 1 は省く（1·P → P）。 */
export function coefTex(c, unit = '') {
  if (c.r) {
    const [n, d] = c.r;
    if (n === 0) return '0';
    const sq = c.s > 1 ? `\\sqrt{${c.s}}` : '';
    let num = n === 1 && sq ? sq : `${n}${sq}`;
    if (d === 1) {
      if (n === 1 && !sq && unit) return unit;
      return num + unit;
    }
    if (n === 1 && !sq && unit) num = '1';
    return `\\frac{${num}}{${d}}${unit}`;
  }
  return fmt(c.v, 3) + (unit ? '\\,' + unit : '');
}

/** 角度の TeX（度数で統一。吸着角も 30° のように書く） */
export function angleTex(deg) {
  return `${fmt(Math.abs(deg), 1)}^\\circ`;
}

/** 位置 t の TeX。lsym は長さの記号（L か x）。例: 2/3 → \frac{2}{3}L */
export function posTex(t, lsym = 'L') {
  return coefTex(coefOf(Math.abs(t)), lsym);
}

/** 位置 t の短い文字表記（UI 用）。例: 2/3 → "2L/3"、0.37 → "0.37L" */
export function posText(t, lsym = 'L') {
  const r = toRational(Math.abs(t));
  if (!r) return `${fmt(t, 3)}${lsym}`;
  const [n, d] = r;
  if (n === 0) return '0';
  const head = n === 1 ? lsym : `${n}${lsym}`;
  return d === 1 ? head : `${head}/${d}`;
}

/** 数値の書式（末尾の 0 は落とす） */
export function fmt(x, digits = 3) {
  if (!isFinite(x)) return '—';
  if (Math.abs(x) < 0.5 * 10 ** -digits) x = 0;
  return String(Number(x.toFixed(digits)));
}

export function signed(x, digits = 3) {
  const s = fmt(x, digits);
  if (s === '0') return '0';
  return x < 0 ? s : '+' + s;
}

const SIGN = (b) => (b ? '+' : '-');

// ---------------------------------------------------------------- 荷重の種類
//
// 各種類の約束:
//   unknown           … true なら大きさが未知（反力・反力モーメント）
//   unit              … 未知量の単位（'kN' | 'kN·m'）
//   names(i)          … 記号（i = null なら添え字なし。その種類が 1 つだけのとき）
//                       { sym, theta?, x? }
//   create(t)         … 新しく足すときの既定値
//   effect(a, tO, u)  … { fx, fy [kN], m [kN·L] }（O まわり。未知量は大きさ u のときの値）
//   terms(a, ctx)     … 解説の式の部品（forceTerms / momentTerms を参照）

export const ACTION_TYPES = {
  point: {
    label: '集中荷重',
    unknown: false,
    names: (i) => (i === null
      ? { sym: 'P', theta: '\\theta' }
      : { sym: `P_{${i}}`, theta: `\\theta_{${i}}` }),
    create: (t = 0.5) => ({ type: 'point', t, P: 5, dir: -90 }),
    effect: (a, tO) => forceEffect(a.dir, a.P, a.t, tO),
    terms: (a, ctx) => forceTerms(a, a.P, ctx),
  },
  reaction: {
    label: '未知反力',
    unknown: true,
    unit: 'kN',
    names: (i) => (i === null
      ? { sym: 'R', theta: '\\theta_{R}' }
      : { sym: `R_{${i}}`, theta: `\\theta_{R_{${i}}}` }),
    create: (t = 0) => ({ type: 'reaction', t, dir: 90 }),
    effect: (a, tO, u) => forceEffect(a.dir, u, a.t, tO),
    terms: (a, ctx) => forceTerms(a, ctx.u, ctx),
  },
  moment: {
    label: '集中モーメント',
    unknown: false,
    names: (i) => (i === null ? { sym: 'M' } : { sym: `M_{${i}}` }),
    create: (t = 0.5) => ({ type: 'moment', t, C: 4 }),
    effect: (a) => ({ fx: 0, fy: 0, m: a.C }),
    terms: (a, ctx) => momentTerms(a.C >= 0, Math.abs(a.C), ctx),
  },
  rmoment: {
    label: '反力モーメント',
    unknown: true,
    unit: 'kN·m',
    // Beam.py と同じく M_{R1} の形（M_{R_1} ではない）
    names: (i) => (i === null ? { sym: 'M_{R}' } : { sym: `M_{R${i}}` }),
    create: (t = 0) => ({ type: 'rmoment', t, sgn: 1 }),
    effect: (a, tO, u) => ({ fx: 0, fy: 0, m: a.sgn * u }),
    terms: (a, ctx) => momentTerms(a.sgn > 0, ctx.u, ctx),
  },
};

export function actionType(a) {
  return ACTION_TYPES[a.type];
}

/** 記号の番号は種類ごとに 1 から振る */
export function symbolIndex(actions, k) {
  const type = actions[k].type;
  let n = 0;
  for (let j = 0; j <= k; j++) if (actions[j].type === type) n++;
  return n;
}

/** k 番目の荷重の記号。その種類が 1 つだけなら添え字なし（P, θ, R, M, M_R）。 */
export function namesOf(actions, k) {
  const a = actions[k];
  const n = actions.filter((b) => b.type === a.type).length;
  return ACTION_TYPES[a.type].names(n === 1 ? null : symbolIndex(actions, k));
}

function forceEffect(dir, mag, t, tO) {
  const r = (dir * Math.PI) / 180;
  const fx = mag * Math.cos(r);
  const fy = mag * Math.sin(r);
  return { fx, fy, m: (t - tO) * fy };
}

/**
 * 力（集中荷重・未知反力）の O まわりのモーメントの式。
 * mag = 大きさ（未知で未解決なら null）。
 * 返り値:
 *   sym   … 記号の式（先頭に符号）      simp … 整理した式（L 表記のみ）
 *   subst … 数値を代入した式（mag が null なら null）   value … kN·m（null なら NaN）
 *   lin   … { c, neg, sym, p } 「±c·sym·L^p」（合計・未知量を解くときの記号計算に使う）
 *   fx/fy … 力の成分の式の部品
 */
function forceTerms(a, mag, ctx) {
  const { tO, Lm, nm, lsym } = ctx;
  const S = nm.sym;
  const { up, tilt } = decompose(a.dir);
  const at = Math.abs(tilt);
  const arm = a.t - tO;
  const cos = trigCoef(EXACT_COS, at);
  const sin = trigCoef(EXACT_SIN, at);
  const known = mag !== null && mag !== undefined && isFinite(mag);
  const value = known ? arm * mag * Math.sin((a.dir * Math.PI) / 180) * Lm : NaN;
  const cosSym = at === 0 ? '' : `\\cos ${angleTex(at)}`;
  const cosNum = at === 0 ? '' : `\\times ${coefTex(cos)}`;
  const magTex = known ? fmt(mag) : S;

  const out = { value, zeroReason: null, lin: null };
  out.fy = compTerm(S, up ? 1 : -1, cos, cosSym, mag);
  out.fx = compTerm(S, tilt >= 0 ? 1 : -1, sin, at === 0 ? '' : `\\sin ${angleTex(at)}`, mag, at === 0);

  if (at === 90) out.zeroReason = '力が棒に沿っていて、作用線が O を通る';
  else if (Math.abs(arm) < 1e-9) out.zeroReason = '力が O に作用している（腕の長さが 0）';

  // 「O からの距離」と「回す向き」を自分で判断する書き方。
  // 長さの記号だけ L（棒全体）／ x（切り取った自由体の長さ）で切り替える。
  const ccw = arm * (up ? 1 : -1) > 0;
  const armC = coefOf(Math.abs(arm));
  out.sym = `${SIGN(ccw)}${S}${cosSym}\\times ${coefTex(armC, lsym)}`;
  const c = mulCoef(cos, armC);
  const simp = `${SIGN(ccw)}${coefTex(c, `${S}${lsym}`)}`;
  out.simp = simp !== out.sym ? simp : null;
  out.lin = { c, neg: !ccw, sym: S, p: 1 };
  out.subst = known
    ? `${SIGN(ccw)}${magTex}${cosNum}\\times ${fmt(Math.abs(arm))}\\times ${fmt(Lm)}` : null;
  if (out.zeroReason) out.lin = null;
  return out;
}

/** 力の成分の式の部品（ΣFx, ΣFy 用）。mag が null なら記号のまま。 */
function compTerm(S, sgn, c, trigSym, mag, zero = false) {
  if (zero || isZero(c)) return null;
  const known = mag !== null && mag !== undefined && isFinite(mag);
  return {
    sym: `${sgn > 0 ? '+' : '-'}${S}${trigSym}`,
    subst: known ? `${sgn > 0 ? '+' : '-'}${fmt(mag)}${trigSym ? '\\times ' + coefTex(c) : ''}` : null,
    c, neg: sgn < 0, S,
  };
}

/** 集中モーメント・反力モーメント。O の位置によらずそのまま加わる。 */
function momentTerms(ccw, mag, ctx) {
  const S = ctx.nm.sym;
  const known = mag !== null && mag !== undefined && isFinite(mag);
  return {
    sym: `${SIGN(ccw)}${S}`,
    simp: null,
    subst: known ? `${SIGN(ccw)}${fmt(mag)}` : null,
    value: known ? (ccw ? mag : -mag) : NaN,
    zeroReason: null,
    lin: { c: ONE, neg: !ccw, sym: S, p: 0 },
    fx: null, fy: null,
    couple: true,
  };
}

// ---------------------------------------------------------------- 未知量を解く

/**
 * 最小二乗（正規方程式）で A u = -k を解く。
 * 返り値 { status: 'none'|'solved'|'under'|'inconsistent', u: number[] }
 *   under        … 式が足りない／未知量が式に現れない（決まらない）
 *   inconsistent … 未知量をどう選んでもつり合わない（u は最小二乗の値）
 */
function solveLinear(A, k) {
  const n = A[0] ? A[0].length : 0;
  if (n === 0) return { status: 'none', u: [] };
  const N = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  let scale = 0;
  for (let r = 0; r < A.length; r++) {
    for (let i = 0; i < n; i++) {
      scale = Math.max(scale, Math.abs(A[r][i]));
      for (let j = 0; j < n; j++) N[i][j] += A[r][i] * A[r][j];
      N[i][n] += -A[r][i] * k[r];
    }
  }
  const tol = 1e-10 * Math.max(1, scale * scale);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(N[r][c]) > Math.abs(N[p][c])) p = r;
    if (Math.abs(N[p][c]) < tol) return { status: 'under', u: new Array(n).fill(NaN) };
    [N[c], N[p]] = [N[p], N[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = N[r][c] / N[c][c];
      for (let j = c; j <= n; j++) N[r][j] -= f * N[c][j];
    }
  }
  const u = N.map((row, i) => row[n] / row[i]);
  let res = 0;
  for (let r = 0; r < A.length; r++) {
    let s = k[r];
    for (let i = 0; i < n; i++) s += A[r][i] * u[i];
    res = Math.max(res, Math.abs(s));
  }
  return { status: res < 1e-6 ? 'solved' : 'inconsistent', u };
}

// ---------------------------------------------------------------- 合計

/**
 * state = { actions, tO, Lm, notation, mode: 'pin'|'free' }
 * 返り値 {
 *   terms[], unknowns: [{ k, sym, unit, value }], status,
 *   eqs: [{ key: 'fx'|'fy'|'m', known, coefs[] }]   … つり合いの式（数値。未知量の係数つき）
 *   MO, MG [kN·m], Fx, Fy [kN]  … 未知量に解いた値を入れた合計（決まらなければ 0 とする）
 * }
 */
export function analyze(state) {
  const { actions, tO, Lm, mode } = state;
  const unkIdx = [];
  actions.forEach((a, k) => { if (actionType(a).unknown) unkIdx.push(k); });

  // つり合いの式: 既知の部分 k と、未知量ごとの係数（u = 1 のときの効果）
  const keys = mode === 'free' ? ['fx', 'fy', 'm'] : ['m'];
  const eqs = keys.map((key) => ({ key, known: 0, coefs: unkIdx.map(() => 0) }));
  const scaleOf = (key) => (key === 'm' ? Lm : 1);
  actions.forEach((a, k) => {
    const T = actionType(a);
    const j = unkIdx.indexOf(k);
    const e = T.effect(a, tO, 1);
    for (const eq of eqs) {
      const v = e[eq.key] * scaleOf(eq.key);
      if (j >= 0) eq.coefs[j] += v;
      else eq.known += v;
    }
  });
  const sol = solveLinear(eqs.map((e) => e.coefs), eqs.map((e) => e.known));
  const uOf = (k) => {
    const j = unkIdx.indexOf(k);
    if (j < 0) return null;
    return sol.status === 'solved' ? sol.u[j] : null;
  };
  // 動かすときに使う値（決まらなければ 0、つり合わないときは最小二乗の値）
  const uMotion = (k) => {
    const j = unkIdx.indexOf(k);
    if (j < 0) return 0;
    return sol.status === 'solved' || sol.status === 'inconsistent' ? sol.u[j] : 0;
  };

  const lsym = lengthSym(state);
  const terms = actions.map((a, k) => {
    const nm = namesOf(actions, k);
    const t = actionType(a).terms(a, { ...state, nm, lsym, u: uOf(k) });
    t.lhs = `M_{O}(${nm.sym})`;
    t.nm = nm;
    return t;
  });

  let MO = 0, MG = 0, Fx = 0, Fy = 0;
  actions.forEach((a, k) => {
    const T = actionType(a);
    const u = uMotion(k);
    const e = T.effect(a, tO, u);
    Fx += e.fx; Fy += e.fy; MO += e.m * Lm;
    MG += T.effect(a, 0.5, u).m * Lm;
  });

  const unknowns = unkIdx.map((k, j) => ({
    k, j, sym: terms[k].nm.sym, unit: actionType(actions[k]).unit,
    value: sol.status === 'solved' ? sol.u[j] : null,
  }));
  return { terms, unknowns, status: sol.status, eqs, MO, MG, Fx, Fy };
}

// ---------------------------------------------------------------- 式の行

/** 長さの記号（'L' か、切り取った自由体の長さとしての 'x'） */
export function lengthSym(state) {
  return state.notation === 'x' ? 'x' : 'L';
}

function stripPlus(s) {
  return s.replace(/^\+/, '');
}

/** lin 項（±c·sym·L^p）の TeX */
function linTex(l, withL = true, lsym = 'L') {
  const unit = !withL || l.p === 0 ? l.sym : l.p === 1 ? `${l.sym}${lsym}` : `\\frac{${l.sym}}{${lsym}}`;
  return `${l.neg ? '-' : '+'}${coefTex(l.c, unit)}`;
}

/** 数値の一次式「既知の値 ± 係数×未知量」の TeX */
function numericLinear(known, coefs, unknowns) {
  let s = '';
  const kk = fmt(known);
  if (kk !== '0' || !coefs.some((c) => Math.abs(c) > 1e-9)) s += fmt(known);
  coefs.forEach((c, j) => {
    if (Math.abs(c) < 1e-9) return;
    const a = fmt(Math.abs(c));
    const body = a === '1' ? unknowns[j].sym : `${a}\\,${unknowns[j].sym}`;
    s += `${c < 0 ? ' - ' : s ? ' + ' : ''}${body}`;
  });
  return s;
}

/**
 * 合計と、つり合いの式・その解の TeX 行を組み立てる。
 * 返り値 { moment: [], force: [], equil: [], solution: [] }
 */
export function sumLines(state, res) {
  const { terms, unknowns, eqs, status } = res;
  const out = { moment: [], force: [], equil: [], solution: [] };
  if (!terms.length) {
    out.moment.push('M_{O} = 0');
    return out;
  }
  const hasUnk = unknowns.length > 0;
  const live = terms.filter((t) => !t.zeroReason);

  // M_O = M_O(P_1) + … = 記号の式
  let l1 = `M_{O} = ${terms.map((t) => t.lhs).join(' + ')}`;
  const symM = momentSym(state, live);
  if (symM) l1 += ` = ${symM}`;
  out.moment.push(l1);

  const eqM = eqs.find((e) => e.key === 'm');
  if (!hasUnk || status === 'solved') {
    const vals = terms.map((t) => `(${signed(t.value)})`);
    out.moment.push(`\\phantom{M_{O}} = ${vals.join(' + ')} = ${signed(res.MO)}\\ \\mathrm{kN\\cdot m}`);
  } else {
    out.moment.push(`\\phantom{M_{O}} = ${numericLinear(eqM.known, eqM.coefs, unknowns)}\\ \\mathrm{[kN\\cdot m]}`);
  }

  // 力の合計（自由体）
  if (state.mode === 'free') {
    for (const [key, label] of [['fx', 'x'], ['fy', 'y']]) {
      const ps = terms.map((t) => t[key]).filter(Boolean);
      const eq = eqs.find((e) => e.key === key);
      if (!ps.length) { out.force.push(`F_{${label}} = 0`); continue; }
      const sym = stripPlus(ps.map((p) => p.sym).join(' '));
      if (!hasUnk || status === 'solved') {
        const total = key === 'fx' ? res.Fx : res.Fy;
        const sub = ps.every((p) => p.subst) ? stripPlus(ps.map((p) => p.subst).join(' ')) : null;
        out.force.push(`F_{${label}} = ${sym}${sub ? ' = ' + sub : ''} = ${signed(total)}\\ \\mathrm{kN}`);
      } else {
        out.force.push(`F_{${label}} = ${sym} = ${numericLinear(eq.known, eq.coefs, unknowns)}\\ \\mathrm{[kN]}`);
      }
    }
  }

  // つり合いの式と、その解
  if (hasUnk) {
    for (const eq of eqs) {
      const name = eq.key === 'm' ? 'M_{O}' : `F_{${eq.key === 'fx' ? 'x' : 'y'}}`;
      const trivial = Math.abs(eq.known) < 1e-9 && eq.coefs.every((c) => Math.abs(c) < 1e-9);
      if (trivial) continue;
      out.equil.push(`${name} = ${numericLinear(eq.known, eq.coefs, unknowns)} = 0`);
    }
    if (status === 'solved') {
      const symSol = symbolicSolution(state, res);
      for (const u of unknowns) {
        const unit = u.unit === 'kN' ? '\\mathrm{kN}' : '\\mathrm{kN\\cdot m}';
        const s = symSol && symSol.sym === u.sym ? ` = ${symSol.tex}` : '';
        out.solution.push(`${u.sym}${s} = ${signed(u.value)}\\ ${unit}`);
      }
    }
  }
  return out;
}

/** M_O の記号の式（力の項は長さの記号 L / x でくくる） */
function momentSym(state, live) {
  if (!live.length) return '';
  const lsym = lengthSym(state);
  const withL = live.filter((t) => t.lin && t.lin.p === 1 && !isZero(t.lin.c));
  const noL = live.filter((t) => t.lin && t.lin.p === 0);
  let s = '';
  if (withL.length === 1) s = linTex(withL[0].lin, true, lsym);
  else if (withL.length > 1) s = `+\\left(${stripPlus(withL.map((t) => linTex(t.lin, false)).join(' '))}\\right)${lsym}`;
  s += noL.map((t) => ' ' + linTex(t.lin)).join('');
  return stripPlus(s.trim());
}

/**
 * 未知量が 1 つで、M_O = 0 の式にそれが現れるとき（L 表記）、
 * その式を記号のまま解く。例: R = \frac{1}{2}P + \frac{M}{L}
 */
function symbolicSolution(state, res) {
  if (res.unknowns.length !== 1) return null;
  const lsym = lengthSym(state);
  const k = res.unknowns[0].k;
  const tu = res.terms[k];
  if (!tu.lin || isZero(tu.lin.c) || tu.zeroReason) return null;
  if (!tu.lin.c.r) return null;
  const parts = [];
  res.terms.forEach((t, i) => {
    if (i === k || !t.lin || t.zeroReason || isZero(t.lin.c)) return;
    if (!t.lin.c.r) { parts.length = 0; parts.push(null); return; }
    // 移項して割る: u = -Σ(±c_i sym_i L^p_i) / (±c_u L^p_u)
    const c = divCoef(t.lin.c, tu.lin.c);
    const neg = !(t.lin.neg !== tu.lin.neg); // 移項で符号が反転
    parts.push({ c, neg, sym: t.lin.sym, p: t.lin.p - tu.lin.p });
  });
  if (parts.includes(null)) return null;
  if (!parts.length) return { sym: tu.nm.sym, tex: '0' };
  return { sym: tu.nm.sym, tex: stripPlus(parts.map((l) => linTex(l, true, lsym)).join(' ')) };
}

/** 回す向きの日本語 */
export function senseText(M, eps = 1e-9) {
  if (!isFinite(M)) return '未知量を含む';
  if (Math.abs(M) < eps) return '0（回さない）';
  return M > 0 ? '反時計まわり' : '時計まわり';
}

// ---------------------------------------------------------------- 運動（アニメーション）
//
// 見た目用の簡単な剛体の運動。長さは L 単位、質量 m は「F = 10 kN で T 秒後に 0.2L 動く」
// ように決めてある（荷重の大きさと動きの速さの対応が荷重の増減で伝わるように、
// 可視化の都合で固定した値。物理的な質量ではない）。
// 動き始めの加速度のまま動かす（回っても荷重の向き・大きさは変えない）。
// 未知量は解いた値を入れて動かす（解けていれば当然つり合って動かない）。

export const ANIM_T = 1.4;
const MASS = 25 * ANIM_T * ANIM_T;

/** 角加速度 [rad/s²] と並進加速度 [L/s²] */
export function accelerations(state, res) {
  const MOL = res.MO / state.Lm; // kN·L
  const MGL = res.MG / state.Lm;
  if (state.mode === 'pin') {
    const d = state.tO - 0.5;
    const I = MASS * (1 / 12 + d * d);
    return { alpha: MOL / I, ax: 0, ay: 0, pivot: state.tO };
  }
  return { alpha: MGL / (MASS / 12), ax: res.Fx / MASS, ay: res.Fy / MASS, pivot: 0.5 };
}
