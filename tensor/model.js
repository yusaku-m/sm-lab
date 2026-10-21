// 応力テンソルの計算（純粋関数のみ、DOM 非依存）。
//
// 対象は弾性力学テキスト（5ME）の演習 1.2: 直径 D・長さ L の丸棒の一端（x = L）を固定し、
// 自由端の断面中心を原点、軸方向を x にとった右手系 xyz。自由端に
//   P: x 方向の引張荷重（s = -1 で圧縮）
//   T: x 軸まわりのねじりモーメント（s = +1 で +x まわり＝右ねじ）
//   M: z 軸まわりの曲げモーメント（s = +1 で +z まわり）
//   F: y 軸の負の向きの横荷重（s = -1 で +y 向き）
// が作用する。点 (x, y, z) は x = ξL, y = η·D/2, z = ζ·D/2 で表す。
//
// 応力は「切断面より自由端側（0 ≤ x' ≤ x）の自由体」のつり合いから決める。正の面（外向き法線 +x）の
// 断面力は N = P, V_y = F, M_z = -(M + F x), M_x = -T（いずれも s を含む）で、
//   σxx = N/A − M_z y / I,  σxy = −M_x z / Ip + V_y (R² − y²)/(3I),  σxz = M_x y / Ip
// （横荷重のせん断応力は材料力学の近似＝弦の上で一様。中立軸で 4F/3A）。
// テキストの解答例（1.2.1〜1.2.12）と符号が一致することは app.js の PRESETS で確かめている。
//
// 単位: D, L は mm、P, F は kN、T, M は N·m。応力は MPa。

export const LOAD_KEYS = ['P', 'T', 'M', 'F'];
export const COMP = ['xx', 'xy', 'xz', 'yx', 'yy', 'yz', 'zx', 'zy', 'zz'];
export const AX = ['x', 'y', 'z'];

// ---------------------------------------------------------------- 記号の基底
// 応力成分は「係数 × 基底」の和で表す。基底は (記号, 分母の D の次数) ごとに 1 つ。
// 自由入力のテンソルでは σ_ij そのものを基底にする。
export function loadBases(geom, loads) {
  const { D, L } = geom;
  const k = (q) => q / Math.PI;
  return {
    P2: { num: 'P', den: '\\pi D^2', value: k(loads.P.mag * 1e3 / D ** 2) },
    T3: { num: 'T', den: '\\pi D^3', value: k(loads.T.mag * 1e3 / D ** 3) },
    M3: { num: 'M', den: '\\pi D^3', value: k(loads.M.mag * 1e3 / D ** 3) },
    F2: { num: 'F', den: '\\pi D^2', value: k(loads.F.mag * 1e3 / D ** 2) },
    FL3: { num: 'FL', den: '\\pi D^3', value: k(loads.F.mag * 1e3 * L / D ** 3) },
  };
}

export function customBases(vals, sym = '\\sigma') {
  const out = {};
  for (const c of COMP) out['s' + c] = { sym: `${sym}_{${c}}`, value: vals[c] };
  return out;
}

// ---------------------------------------------------------------- フックの法則（等方性・線形弾性）
// テキスト 1.4 の式: ε_ij = (1+ν)/E σ_ij − ν/E σ_kk δ_ij、σ_ij = E/(1+ν) (ε_ij + ν/(1−2ν) ε_kk δ_ij)。
// E と σ は同じ単位（MPa）で渡す。ε は無次元（画面では ×10⁻⁶ で表示する）。
export function hooke(S, E, nu) {
  const tr = S[0][0] + S[1][1] + S[2][2];
  return S.map((r, i) => r.map((v, j) => (1 + nu) / E * v - (i === j ? nu / E * tr : 0)));
}

export function invHooke(Eps, E, nu) {
  const tr = Eps[0][0] + Eps[1][1] + Eps[2][2];
  return Eps.map((r, i) => r.map((v, j) => E / (1 + nu) * (v + (i === j ? nu / (1 - 2 * nu) * tr : 0))));
}

// 丸棒の応力（σyy = σzz = σyz = 0）からひずみの記号表現を作る。テキストの解答例と同じ形
// （ε_xx = σ_xx/E、ε_yy = ε_zz = −νσ_xx/E、ε_xy = (1+ν)σ_xy/E）にするため、基底の分子・分母に
// E・ν・(1+ν) を書き足した基底を作る。value は ×10⁻⁶ 単位（E は MPa）。
export function strainOfRod(terms, bases, E, nu) {
  const eb = {};
  const mk = (b, kind) => {
    const k = `${b}_${kind}`;
    if (!eb[k]) {
      const B = bases[b];
      const num = kind === 'E' ? B.num : kind === 'nu' ? `\\nu ${B.num}` : `${B.num}(1+\\nu)`;
      const f = kind === 'E' ? 1 : kind === 'nu' ? nu : 1 + nu;
      eb[k] = { num, den: B.den.replace('\\pi ', '\\pi E '), value: B.value * f / E * 1e6 };
    }
    return k;
  };
  const et = {};
  for (const c of COMP) et[c] = [];
  et.xx = terms.xx.map((t) => ({ b: mk(t.b, 'E'), c: t.c }));
  et.yy = terms.xx.map((t) => ({ b: mk(t.b, 'nu'), c: -t.c }));
  et.zz = et.yy.slice();
  for (const c of ['xy', 'xz', 'yz']) et[c] = terms[c].map((t) => ({ b: mk(t.b, '1nu'), c: t.c }));
  et.yx = et.xy.slice(); et.zx = et.xz.slice(); et.zy = et.yz.slice();
  return { terms: et, bases: eb };
}

// 成分ごとの項のリスト {b: 基底のキー, c: 係数}
export function loadTerms(loads, pt) {
  const { xi, eta, zeta } = pt;
  const t = {};
  for (const c of COMP) t[c] = [];
  const add = (c, b, v) => { if (Math.abs(v) > 1e-12) t[c].push({ b, c: v }); };
  const on = (k) => loads[k].on && loads[k].mag !== 0;
  if (on('P')) add('xx', 'P2', 4 * loads.P.s);
  if (on('M')) add('xx', 'M3', 32 * eta * loads.M.s);
  if (on('F')) add('xx', 'FL3', 32 * xi * eta * loads.F.s);
  if (on('T')) add('xy', 'T3', 16 * zeta * loads.T.s);
  if (on('F')) add('xy', 'F2', 16 * (1 - eta * eta) / 3 * loads.F.s);
  if (on('T')) add('xz', 'T3', -16 * eta * loads.T.s);
  t.yx = t.xy.slice();
  t.zx = t.xz.slice();
  return t;
}

export function customTerms(vals) {
  const t = {};
  for (const c of COMP) t[c] = vals[c] !== 0 ? [{ b: 's' + c, c: 1 }] : [];
  return t;
}

export function evalTerms(terms, bases) {
  return terms.reduce((s, x) => s + x.c * bases[x.b].value, 0);
}

export function toMatrix(terms, bases) {
  return AX.map((i) => AX.map((j) => evalTerms(terms[i + j], bases)));
}

// ---------------------------------------------------------------- 回転
// Q の列 = 新しい座標系の単位ベクトル（旧座標で表したもの）。テキストの R は Q の転置（行が単位ベクトル）。
export function rotAxis(axis, th) {
  const c = Math.cos(th), s = Math.sin(th);
  if (axis === 'x') return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 'y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

export function mul(A, B) {
  return A.map((r) => B[0].map((_, j) => r.reduce((s, a, k) => s + a * B[k][j], 0)));
}
export function tr(A) { return A[0].map((_, j) => A.map((r) => r[j])); }

// Q = Rz(α) Ry(β) Rx(γ)（z → 新しい y → さらに新しい x の順に回す）
export function rotEuler(a, b, g) {
  return mul(mul(rotAxis('z', a), rotAxis('y', b)), rotAxis('x', g));
}

export function eulerFromQ(Q) {
  const b = Math.asin(Math.max(-1, Math.min(1, -Q[2][0])));
  let a, g;
  if (Math.abs(Math.cos(b)) > 1e-9) {
    a = Math.atan2(Q[1][0], Q[0][0]);
    g = Math.atan2(Q[2][1], Q[2][2]);
  } else {
    a = Math.atan2(-Q[0][1], Q[1][1]);
    g = 0;
  }
  return [a, b, g];
}

// 微小な回転を足したあと、数値誤差で直交からずれないように直す（Gram-Schmidt）
export function orthonormalize(Q) {
  const cols = [0, 1, 2].map((j) => Q.map((r) => r[j]));
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const nrm = (u) => { const n = Math.hypot(...u); return u.map((x) => x / n); };
  const a = nrm(cols[0]);
  let b = cols[1].map((x, i) => x - dot(cols[1], a) * a[i]);
  b = nrm(b);
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return [0, 1, 2].map((i) => [a[i], b[i], c[i]]);
}

export function axisAngleQ(axis, ang) {
  const [x, y, z] = axis; const n = Math.hypot(x, y, z) || 1;
  const u = [x / n, y / n, z / n], c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  return [
    [c + u[0] * u[0] * C, u[0] * u[1] * C - u[2] * s, u[0] * u[2] * C + u[1] * s],
    [u[1] * u[0] * C + u[2] * s, c + u[1] * u[1] * C, u[1] * u[2] * C - u[0] * s],
    [u[2] * u[0] * C - u[1] * s, u[2] * u[1] * C + u[0] * s, c + u[2] * u[2] * C],
  ];
}

// σ' = R σ Rᵀ（R = Qᵀ）
export function rotateTensor(S, Q) { const R = tr(Q); return mul(mul(R, S), Q); }

// 軸まわりの回転の成分ごとの式。三角関数の基底 [1, cos2θ, sin2θ, cosθ, sinθ] の係数で表す。
// 回転軸 k に対して (i, j) は巡回順（x: y,z / y: z,x / z: x,y）。
export const TRIG = ['', '\\cos 2\\theta', '\\sin 2\\theta', '\\cos\\theta', '\\sin\\theta'];
export const CYC = { x: ['y', 'z', 'x'], y: ['z', 'x', 'y'], z: ['x', 'y', 'z'] };
const key = (a, b) => (AX.indexOf(a) <= AX.indexOf(b) ? a + b : b + a);

export function axisWeights(axis) {
  const [i, j, k] = CYC[axis];
  const w = {}; // w[出力成分][入力成分] = [5 係数]
  const set = (o, inp, v) => { (w[o] ||= {})[key(inp[0], inp[1])] = v; };
  set(key(i, i), i + i, [0.5, 0.5, 0, 0, 0]); set(key(i, i), j + j, [0.5, -0.5, 0, 0, 0]); set(key(i, i), i + j, [0, 0, 1, 0, 0]);
  set(key(j, j), i + i, [0.5, -0.5, 0, 0, 0]); set(key(j, j), j + j, [0.5, 0.5, 0, 0, 0]); set(key(j, j), i + j, [0, 0, -1, 0, 0]);
  set(key(i, j), i + i, [0, 0, -0.5, 0, 0]); set(key(i, j), j + j, [0, 0, 0.5, 0, 0]); set(key(i, j), i + j, [0, 1, 0, 0, 0]);
  set(key(i, k), i + k, [0, 0, 0, 1, 0]); set(key(i, k), j + k, [0, 0, 0, 0, 1]);
  set(key(j, k), i + k, [0, 0, 0, 0, -1]); set(key(j, k), j + k, [0, 0, 0, 1, 0]);
  set(key(k, k), k + k, [1, 0, 0, 0, 0]);
  return { w, order: [key(i, i), key(j, j), key(k, k), key(i, j), key(j, k), key(i, k)], ijk: [i, j, k] };
}

// 記号の成分（基底の線形結合）に三角関数の重みを掛けて、出力成分ごとに 基底 → 三角関数係数 を集める
export function rotateSymbolic(terms, axis) {
  const { w, order, ijk } = axisWeights(axis);
  const out = {};
  for (const o of order) {
    const acc = {};
    for (const [inp, wt] of Object.entries(w[o] || {})) {
      for (const t of terms[inp]) {
        const v = (acc[t.b] ||= [0, 0, 0, 0, 0]);
        wt.forEach((x, n) => { v[n] += x * t.c; });
      }
    }
    for (const b of Object.keys(acc)) if (acc[b].every((x) => Math.abs(x) < 1e-12)) delete acc[b];
    out[o] = acc;
  }
  return { out, order, ijk };
}

// ---------------------------------------------------------------- 固有値（対称 3×3、Jacobi 法）
export function eigSym(S) {
  const a = S.map((r) => r.slice());
  let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
      const c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  const vals = idx.map((i) => a[i][i]);
  const vecs = idx.map((i) => V.map((r) => r[i]));
  return { vals, vecs };
}

// 主軸を列に並べた回転行列（det = +1 にそろえる）
export function principalQ(S) {
  const { vecs } = eigSym(S);
  const [a, b] = vecs;
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return [0, 1, 2].map((i) => [a[i], b[i], c[i]]);
}

export function invariants(S) {
  const I1 = S[0][0] + S[1][1] + S[2][2];
  const I2 = S[0][0] * S[1][1] + S[1][1] * S[2][2] + S[2][2] * S[0][0]
    - S[0][1] * S[1][0] - S[1][2] * S[2][1] - S[2][0] * S[0][2];
  const I3 = S[0][0] * (S[1][1] * S[2][2] - S[1][2] * S[2][1])
    - S[0][1] * (S[1][0] * S[2][2] - S[1][2] * S[2][0])
    + S[0][2] * (S[1][0] * S[2][1] - S[1][1] * S[2][0]);
  return { I1, I2, I3 };
}

export function isSymmetric(S, tol = 1e-9) {
  const m = Math.max(1, ...S.flat().map(Math.abs));
  return Math.abs(S[0][1] - S[1][0]) <= tol * m && Math.abs(S[0][2] - S[2][0]) <= tol * m
    && Math.abs(S[1][2] - S[2][1]) <= tol * m;
}

// ---------------------------------------------------------------- 数値・分数の書式
export function rat(x, maxDen = 48) {
  if (!Number.isFinite(x)) return null;
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(x * d);
    if (Math.abs(x - n / d) < 1e-9 * Math.max(1, Math.abs(x))) return [n, d];
  }
  return null;
}

export function fmt(x, digits = 4) {
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x) < 5e-10) return '0';
  const a = Math.abs(x);
  let s;
  if (a >= 1e5 || a < 1e-3) s = x.toExponential(digits - 1);
  else s = x.toPrecision(digits);
  if (s.includes('.') && !s.includes('e')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

// 係数 c × 基底 b の TeX。first = 式の先頭か（先頭なら + を付けない）
export function termTex(c, base, first) {
  const sign = c < 0 ? '-' : (first ? '' : '+');
  const a = Math.abs(c);
  const r = rat(a);
  if (base.sym) { // 自由入力（σ_ij そのもの）
    if (r && r[1] === 1) return `${sign}${r[0] === 1 ? '' : r[0]}${base.sym}`;
    if (r) return `${sign}\\frac{${r[0]}}{${r[1]}}${base.sym}`;
    return `${sign}${fmt(a)}\\,${base.sym}`;
  }
  if (r) {
    const num = `${r[0] === 1 ? '' : r[0]}${base.num}`;
    const den = `${r[1] === 1 ? '' : r[1]}${base.den}`;
    return `${sign}\\frac{${num}}{${den}}`;
  }
  return `${sign}${fmt(a)}\\frac{${base.num}}{${base.den}}`;
}

export function sumTex(terms, bases) {
  if (!terms.length) return '0';
  return terms.map((t, n) => termTex(t.c, bases[t.b], n === 0)).join('');
}

// 三角関数の多項式（係数ベクトル）の TeX
export function trigTex(v, first = true) {
  let s = '';
  v.forEach((c, n) => {
    if (Math.abs(c) < 1e-12) return;
    const isFirst = s === '' && first;
    const sign = c < 0 ? '-' : (isFirst ? '' : '+');
    const a = Math.abs(c); const r = rat(a);
    let co;
    if (r && r[1] === 1) co = (r[0] === 1 && n > 0) ? '' : String(r[0]);
    else if (r) co = `\\frac{${r[0]}}{${r[1]}}`;
    else co = fmt(a);
    s += `${sign}${co}${n > 0 && co ? '\\,' : ''}${TRIG[n]}`;
  });
  return s || '0';
}

// 基底 × 三角関数の多項式（rotateSymbolic の 1 成分）の TeX
export function rotatedTex(acc, bases) {
  const parts = Object.entries(acc);
  if (!parts.length) return '0';
  return parts.map(([b, v], n) => {
    const nz = v.map((c, i) => [c, i]).filter(([c]) => Math.abs(c) > 1e-12);
    if (nz.length === 1) {
      const [c, i] = nz[0];
      return termTex(c, bases[b], n === 0) + (i > 0 ? TRIG[i] : '');
    }
    const k = Math.abs(nz[0][0]) * Math.sign(nz[0][0]);
    const inner = v.map((c) => c / k);
    return termTex(k, bases[b], n === 0) + `\\left(${trigTex(inner)}\\right)`;
  }).join('');
}
