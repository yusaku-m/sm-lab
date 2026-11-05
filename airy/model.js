// エアリーの応力関数（弾性力学 3.3〜）。いまはサンブナンの原理（1.1）の可視化だけ。純粋関数のみ、DOM 非依存。
//
// 幅 b・単位厚さの板。x = 棒の軸方向（端面 x = 0 から奥へ）、y = 幅方向（|y| ≤ b/2、テキストの図1.1と同じ）。
// 端面に合力 P の引張荷重 q(y) を与える。荷重は y = 0 について対称なものだけ扱う。
//
// 端面の荷重を周期 b のフーリエ余弦級数に展開する:
//   q(y) = P/b + Σ q_n cos α_n y,  α_n = 2πn/b
// 各項の応力関数（半無限板 x ≥ 0 で ∇⁴φ = 0、x → ∞ で消える）:
//   φ_0 = (P/b) y²/2,   φ_n = −(q_n/α_n²)(1 + α_n x) e^{−α_n x} cos α_n y
// σxx = ∂²φ/∂y²,  σyy = ∂²φ/∂x²,  σxy = −∂²φ/∂x∂y から
//   σxx = P/b + Σ q_n (1 + α_n x) e^{−α_n x} cos α_n y
//   σyy =       Σ q_n (1 − α_n x) e^{−α_n x} cos α_n y
//   σxy =       Σ q_n  α_n x      e^{−α_n x} sin α_n y
// y = ±b/2 では sin α_n y = sin nπ = 0 なので σxy = 0、変位 u_y も 0（対称面）。
// つまり「滑らかな壁ではさんだ幅 b の板」の厳密解になる（側面が自由な板とは σyy ≠ 0 の点で違う）。
//
// 座標と応力はすべて無次元: ξ = x/b, η = y/b, 応力は P/b で割った値。

export const TAU = 2 * Math.PI;

export const LOADS = {
  pt: { name: '集中荷重（中央）', short: '集中', usesA: false },
  u: { name: '一様分布（全幅）', short: '一様', usesA: false },
  pa: { name: '部分一様分布（中央の幅 a）', short: '部分一様', usesA: true },
  p2: { name: '2 点の集中荷重（y = ±a/2 に P/2 ずつ）', short: '2 点', usesA: true },
};

const sinc = (t) => (Math.abs(t) < 1e-12 ? 1 : Math.sin(t) / t);

// q_n / (P/b)。n ≥ 1。a は a/b
export function coef(ld, n, a) {
  switch (ld) {
    case 'pt': return 2;
    case 'u': return 0;
    case 'pa': return 2 * sinc(Math.PI * n * a);
    case 'p2': return 2 * Math.cos(Math.PI * n * a);
    default: return 0;
  }
}

// ランチョスの σ 因子（ギブスの振動を抑える）
export const lanczos = (n, N) => sinc(Math.PI * n / (N + 1));

// 第 n 項に掛ける重み（係数 × 必要ならランチョス因子）
export function weights(ld, N, a, lz) {
  const w = new Float64Array(N + 1);
  for (let n = 1; n <= N; n++) w[n] = coef(ld, n, a) * (lz ? lanczos(n, N) : 1);
  return w;
}

// 端面の荷重 q(η)/(P/b)（N 項で打ち切ったもの）
export function loadSeries(w, eta) {
  let s = 1;
  for (let n = 1; n < w.length; n++) s += w[n] * Math.cos(TAU * n * eta);
  return s;
}

// N 項で打ち切った応力。z^n = e^{−2πnξ}(cos 2πnη + i sin 2πnη) を漸化式で回す
export function stressSeries(w, xi, eta) {
  const r = Math.exp(-TAU * xi), c = Math.cos(TAU * eta), s = Math.sin(TAU * eta);
  const zr = r * c, zi = r * s;
  let pr = 1, pi = 0, sxx = 1, syy = 0, sxy = 0;
  for (let n = 1; n < w.length; n++) {
    const t = pr * zr - pi * zi; pi = pr * zi + pi * zr; pr = t;
    if (r ** n < 1e-14) break;
    const ax = TAU * n * xi, k = w[n];
    sxx += k * (1 + ax) * pr;
    syy += k * (1 - ax) * pr;
    sxy += k * ax * pi;
  }
  return [sxx, syy, sxy];
}

// ---------------------------------------------------------------- N = ∞ の厳密和
// z = e^{−2π(ξ − iη)} とすると
//   Σ_{n≥1} z^n = z/(1−z),  Σ n z^n = z/(1−z)²
// 中央の集中荷重（q_n = 2P/b）は
//   σxx = 1 + 2(A + 2πξ B),  σyy = 2(A − 2πξ B),  σxy = 2·2πξ C
//   A = Re z/(1−z),  B = Re z/(1−z)²,  C = Im z/(1−z)²
// 2 点・部分一様は、集中荷重の解を y 方向にずらして足す（積分する）だけ。
// 積分は dz/dη = 2πi z から  ∫A dη = −arg(1−z)/2π,  ∫B dη = Im 1/(1−z) /2π,  ∫C dη = −Re 1/(1−z) /2π。
function zOf(xi, eta) {
  const r = Math.exp(-TAU * xi);
  return [r * Math.cos(TAU * eta), r * Math.sin(TAU * eta)];
}
function pointABC(xi, eta) {
  const [zr, zi] = zOf(xi, eta);
  const dr = 1 - zr, di = -zi, d2 = dr * dr + di * di;
  // z/(1−z)
  const qr = (zr * dr + zi * di) / d2, qi = (zi * dr - zr * di) / d2;
  // z/(1−z)² = (z/(1−z)) / (1−z)
  const Br = (qr * dr + qi * di) / d2, Bi = (qi * dr - qr * di) / d2;
  return [qr, Br, Bi];
}
function pointStress(xi, eta) {
  const [A, B, C] = pointABC(xi, eta), k = TAU * xi;
  return [1 + 2 * (A + k * B), 2 * (A - k * B), 2 * k * C];
}
// η についての原始関数（A, B, C の順）
function pointPrim(xi, eta) {
  const [zr, zi] = zOf(xi, eta);
  const dr = 1 - zr, di = -zi, d2 = dr * dr + di * di;
  const arg = Math.atan2(di, dr); // 1 − z の実部は正（ξ > 0）なので連続
  const ir = dr / d2, ii = -di / d2; // 1/(1−z)
  return [-arg / TAU, ii / TAU, -ir / TAU];
}

export const XI_MIN = 1e-4; // 端面そのもの（ξ = 0）は集中荷重で発散するので少しだけ内側で評価する

export function stressExact(ld, a, xi, eta) {
  xi = Math.max(xi, XI_MIN);
  const k = TAU * xi;
  switch (ld) {
    case 'u': return [1, 0, 0];
    case 'pt': return pointStress(xi, eta);
    case 'p2': {
      const p = pointStress(xi, eta - a / 2), q = pointStress(xi, eta + a / 2);
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    }
    case 'pa': {
      const hi = pointPrim(xi, eta + a / 2), lo = pointPrim(xi, eta - a / 2);
      const dA = hi[0] - lo[0], dB = hi[1] - lo[1], dC = hi[2] - lo[2];
      return [1 + (2 / a) * (dA + k * dB), (2 / a) * (dA - k * dB), (2 / a) * k * dC];
    }
    default: return [1, 0, 0];
  }
}

// 状態から応力関数を作る: N = Infinity なら厳密和
export function makeField({ ld, a, N, lz }) {
  if (!Number.isFinite(N)) return { exact: true, at: (xi, eta) => stressExact(ld, a, xi, eta), load: null };
  const w = weights(ld, N, a, lz);
  return { exact: false, w, at: (xi, eta) => stressSeries(w, Math.max(xi, 0), eta), load: (eta) => loadSeries(w, eta) };
}

// 一様な状態（σxx = P/b、他は 0）からのずれの最大値（断面 ξ で η を走査）
export function deviation(field, xi, comp, M = 81) {
  let m = 0;
  for (let j = 0; j < M; j++) {
    const eta = -0.5 + j / (M - 1);
    const s = field.at(xi, eta);
    const v = comp === 0 ? s[0] - 1 : s[comp];
    if (Math.abs(v) > m) m = Math.abs(v);
  }
  return m;
}

// ずれが tol 以下になる最初の ξ（ξ が増えると単調に減るとみなして二分法）
export function settleDistance(field, tol = 0.05, comp = 0) {
  let lo = 0.002, hi = 3;
  if (deviation(field, lo, comp) <= tol) return 0;
  if (deviation(field, hi, comp) > tol) return Infinity;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (deviation(field, mid, comp) > tol) lo = mid; else hi = mid;
  }
  return hi;
}
