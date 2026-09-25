// モーメントのつり合い — 力学モデルと式の組み立て（純粋関数のみ、DOM 非依存）
//
// 単位・座標の約束:
//   位置 t は棒の長さ L を 1 とした無次元量（左端 0、右端 1）。
//   力は kN、角度は deg。モーメントの値は kN·m（L[m] を掛けて返す）。
//   荷重の向き dir は +x（右）から反時計まわりに測った角度（上向き = 90、下向き = -90）。
//   モーメントは反時計まわりを正とする。
//
// 荷重の種類は ACTION_TYPES に登録する。今は集中荷重（point）だけだが、
// 分布荷重・集中モーメントも同じインターフェース（force / momentAbout / terms）を
// 実装して足せば、合計・式・アニメーションの側は触らずに済むようにしてある。

// ---------------------------------------------------------------- 吸着

/** 位置が吸い付く分母（L/2, L/3, L/4, L/5, L/10 の倍数） */
export const SNAP_DENOMS = [1, 2, 3, 4, 5, 10];
/** 鉛直からの傾きが吸い付く角度（0, π/6, π/4, π/3, π/2） */
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
// 係数 c = (n/d)·√s（s = 1, 2, 3）。分数に直せない位置のときは dec（小数）を使う。

const EXACT_COS = { 0: [1, 1, 1], 30: [1, 2, 3], 45: [1, 2, 2], 60: [1, 2, 1], 90: [0, 1, 1] };
const EXACT_SIN = { 0: [0, 1, 1], 30: [1, 2, 1], 45: [1, 2, 2], 60: [1, 2, 3], 90: [1, 1, 1] };
const PI_TEX = { 30: '\\frac{\\pi}{6}', 45: '\\frac{\\pi}{4}', 60: '\\frac{\\pi}{3}', 90: '\\frac{\\pi}{2}' };

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

function mulCoef(a, b) {
  if (a.r && b.r) {
    let n = a.r[0] * b.r[0];
    let d = a.r[1] * b.r[1];
    let s = a.s * b.s;
    if (a.s === b.s && a.s > 1) { n *= a.s; s = 1; } // √3·√3 = 3
    const g = gcd(n, d);
    return { r: [n / g, d / g], s, v: a.v * b.v };
  }
  return { r: null, s: 1, v: a.v * b.v };
}

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

/** 係数の TeX（符号なし）。unit を付けたとき係数 1 は省く（1·P_1 → P_1）。 */
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

/** 角度の TeX。吸着角は π 表記、それ以外は度。 */
export function angleTex(deg) {
  const a = Math.abs(deg);
  return PI_TEX[a] || `${fmt(a, 1)}^\\circ`;
}

/** 位置 t の TeX（L 表記）。例: 2/3 → \frac{2}{3}L */
export function posTex(t) {
  return coefTex(coefOf(Math.abs(t)), 'L');
}

/** 位置 t の短い文字表記（UI 用）。例: 2/3 → "2L/3"、0.37 → "0.37L" */
export function posText(t) {
  const r = toRational(Math.abs(t));
  if (!r) return `${fmt(t, 3)}L`;
  const [n, d] = r;
  if (n === 0) return '0';
  const head = n === 1 ? 'L' : `${n}L`;
  return d === 1 ? head : `${head}/${d}`;
}

/** 数値の書式（末尾の 0 は落とす） */
export function fmt(x, digits = 3) {
  if (!isFinite(x)) return '—';
  if (Math.abs(x) < 0.5 * 10 ** -digits) x = 0;
  return String(Number(x.toFixed(digits)));
}

function signed(x, digits = 3) {
  const s = fmt(x, digits);
  return x < 0 && s !== '0' ? s : s === '0' ? '0' : '+' + s;
}

const SIGN = (b) => (b ? '+' : '-');

// ---------------------------------------------------------------- 荷重の種類

/**
 * 荷重の種類ごとの実装。各メソッドの約束:
 *   force(a)              → { fx, fy }  [kN]（合力。回転の運動方程式と ΣF に使う）
 *   momentAbout(a, tO)    → O（位置 tO）まわりのモーメント [kN·L]（反時計まわり正）
 *   terms(a, ctx)         → 解説用の式の部品（下の point.terms を参照）
 *   symbol(i)             → 図・式で使う記号（P_1 など）
 */
export const ACTION_TYPES = {
  point: {
    label: '集中荷重',
    create: (t = 0.5) => ({ type: 'point', t, P: 5, dir: -90 }),
    symbol: (i) => `P_{${i}}`,
    force(a) {
      const r = (a.dir * Math.PI) / 180;
      return { fx: a.P * Math.cos(r), fy: a.P * Math.sin(r) };
    },
    momentAbout(a, tO) {
      return (a.t - tO) * this.force(a).fy;
    },
    /**
     * ctx = { i, tO, Lm, notation: 'L'|'x' }
     * 返り値 { name, sym: 記号の式, simp: 整理した式|null, subst: 数値代入, value [kN·m],
     *          zeroReason, coef: L 表記の P_iL の係数（符号付き）, fx/fy の式 }
     */
    terms(a, ctx) {
      const { i, tO, Lm, notation } = ctx;
      const P = `P_{${i}}`;
      const name = `M_{${i}}`;
      const { up, tilt } = decompose(a.dir);
      const at = Math.abs(tilt);
      const arm = a.t - tO;
      const value = arm * this.force(a).fy * Lm;
      const cos = trigCoef(EXACT_COS, at);
      const cosSym = at === 0 ? '' : `\\cos${angleTex(at)}`;
      const cosNum = at === 0 ? '' : `\\times ${coefTex(cos)}`;

      const out = { name, value, zeroReason: null, coef: { r: [0, 1], s: 1, v: 0 } };
      out.fy = this._compTerm(P, up ? 1 : -1, cos, cosSym, a.P);
      out.fx = this._compTerm(P, tilt >= 0 ? 1 : -1, trigCoef(EXACT_SIN, at),
        at === 0 ? '' : `\\sin${angleTex(at)}`, a.P, at === 0);

      if (at === 90) {
        out.zeroReason = '荷重が棒に沿っていて、作用線が O を通る';
      } else if (Math.abs(arm) < 1e-9) {
        out.zeroReason = '荷重が O に作用している（腕の長さが 0）';
      }

      if (notation === 'x') {
        // x 座標で書くと腕の符号は (x_i − x_O) が勝手に受け持つので、
        // 式の符号は「上向き +／下向き −」だけで決まる
        out.sym = `${SIGN(up)}${P}${cosSym}\\,(x_{${i}} - x_{O})`;
        out.simp = null;
        out.subst = `${SIGN(up)}${fmt(a.P)}${cosNum}\\times(${fmt(a.t * Lm)} - ${fmt(tO * Lm)})`;
      } else {
        // L 表記は「O からの距離」と「回す向き」を自分で判断する書き方
        const ccw = arm * (up ? 1 : -1) > 0;
        const armC = coefOf(Math.abs(arm));
        out.sym = `${SIGN(ccw)}${P}${cosSym}\\times ${coefTex(armC, 'L')}`;
        const c = mulCoef(cos, armC);
        const simp = `${SIGN(ccw)}${coefTex(c, `${P}L`)}`;
        out.simp = simp !== out.sym ? simp : null;
        out.coef = { ...c, neg: !ccw };
        out.subst = `${SIGN(ccw)}${fmt(a.P)}${cosNum}\\times ${fmt(Math.abs(arm))}\\times ${fmt(Lm)}`;
      }
      if (out.zeroReason) { out.coef = { r: [0, 1], s: 1, v: 0 }; }
      return out;
    },
    /** 力の成分の式の部品（ΣFx, ΣFy 用） */
    _compTerm(P, sgn, c, trigSym, mag, zero = false) {
      const v = zero ? 0 : sgn * c.v * mag;
      if (zero || (c.r && c.r[0] === 0)) return { sym: null, subst: null, v: 0 };
      return {
        sym: `${sgn > 0 ? '+' : '-'}${P}${trigSym}`,
        subst: `${sgn > 0 ? '+' : '-'}${fmt(mag)}${trigSym ? '\\times ' + coefTex(c) : ''}`,
        v,
      };
    },
  },
  // couple: { label: '集中モーメント', ... }  … force = 0、momentAbout = 一定値（O によらない）
  // udl:    { label: '分布荷重', ... }        … 合力 w·(t2−t1)、作用点は区間の中央
};

export function actionType(a) {
  return ACTION_TYPES[a.type];
}

/** 記号の番号は種類ごとに 1 から振る（P_1, P_2, …／将来 M_1, w_1 …） */
export function symbolIndex(actions, k) {
  const type = actions[k].type;
  let n = 0;
  for (let j = 0; j <= k; j++) if (actions[j].type === type) n++;
  return n;
}

// ---------------------------------------------------------------- 合計

/**
 * 全体の量を計算する。
 * mode: 'pin'（O で回転だけ許して支える）| 'free'（自由体）
 * 返り値 { terms[], MO, MG, Fx, Fy }（MO, MG は kN·m、F は kN）
 */
export function analyze(state) {
  const { actions, tO, Lm, notation } = state;
  const terms = actions.map((a, k) => {
    const T = actionType(a);
    return T.terms(a, { i: symbolIndex(actions, k), tO, Lm, notation });
  });
  let MO = 0, MG = 0, Fx = 0, Fy = 0;
  actions.forEach((a) => {
    const T = actionType(a);
    const f = T.force(a);
    Fx += f.fx; Fy += f.fy;
    MO += T.momentAbout(a, tO) * Lm;
    MG += T.momentAbout(a, 0.5) * Lm;
  });
  return { terms, MO, MG, Fx, Fy };
}

/** 合計の式（TeX の行の配列）を組み立てる */
export function sumLines(state, res) {
  const { terms, MO, Fx, Fy } = res;
  const lines = [];
  const names = terms.map((t) => t.name);
  if (!terms.length) {
    lines.push('M_{O} = 0');
    return { moment: lines, force: [] };
  }

  // M_O = M_1 + M_2 + …
  let l1 = `M_{O} = ${names.join(' + ')}`;
  if (state.notation === 'x') {
    const syms = terms.filter((t) => !t.zeroReason).map((t) => t.sym);
    if (syms.length) l1 += ` = ${stripPlus(syms.join(' '))}`;
  } else {
    const parts = terms
      .filter((t) => !t.zeroReason && t.coef.v !== 0)
      .map((t, _, arr) => {
        const i = t.name.match(/\{(\d+)\}/)[1];
        return `${t.coef.neg ? '-' : '+'}${coefTex(t.coef, `P_{${i}}`)}`;
      });
    if (parts.length === 1) l1 += ` = ${stripPlus(parts[0])}L`;
    else if (parts.length > 1) l1 += ` = \\left(${stripPlus(parts.join(' '))}\\right)L`;
  }
  lines.push(l1);
  const vals = terms.map((t) => `(${signed(t.value)})`);
  lines.push(`\\phantom{M_{O}} = ${vals.join(' + ')} = ${signedTex(MO)}\\ \\mathrm{kN\\cdot m}`);

  const force = [];
  if (state.mode === 'free') {
    for (const [key, total, label] of [['fx', Fx, 'x'], ['fy', Fy, 'y']]) {
      const ps = terms.map((t) => t[key]).filter((p) => p.sym);
      if (!ps.length) { force.push(`F_{${label}} = 0`); continue; }
      const sym = stripPlus(ps.map((p) => p.sym).join(' '));
      const sub = stripPlus(ps.map((p) => p.subst).join(' '));
      force.push(`F_{${label}} = ${sym} = ${sub} = ${signedTex(total)}\\ \\mathrm{kN}`);
    }
  }
  return { moment: lines, force };
}

function stripPlus(s) {
  return s.replace(/^\+/, '');
}

function signedTex(x) {
  return signed(x).replace(/^\+/, '+');
}

/** 回す向きの日本語 */
export function senseText(M, eps = 1e-9) {
  if (Math.abs(M) < eps) return '0（回さない）';
  return M > 0 ? '反時計まわり' : '時計まわり';
}

// ---------------------------------------------------------------- 運動（アニメーション）
//
// 見た目用の簡単な剛体の運動。長さは L 単位、質量 m は「F = 10 kN で T 秒後に 0.2L 動く」
// ように決めてある（荷重の大きさと動きの速さの対応が荷重の増減で伝わるように、
// 可視化の都合で固定した値。物理的な質量ではない）。
// 動き始めの加速度のまま動かす（回っても荷重の向き・大きさは変えない）。

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
