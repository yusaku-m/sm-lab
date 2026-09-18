// 丸棒（中実円形断面）に生じる応力状態の計算。
//
// 座標系（円筒座標）:
//   x : 棒の軸方向（棒は x 軸に沿って置かれる）
//   θ : 周方向（断面内の接線方向）
//   r : 半径方向
// 断面内の直交座標は (y, z) で、y が「曲げの中立軸から測る高さ」。
// 断面上の点は (r, a) で表し、y = r cos(a), z = r sin(a)（a は +y 軸からの角度）。
//
// 荷重（すべて棒全長にわたって一定）:
//   N : 軸力 [kN]（引張が正）
//   M : 両端に加わる曲げモーメント [N·m]（z 軸まわり = 純曲げ）
//   T : ねじりモーメント [N·m]（x 軸まわり、右ねじが正）
//
// 応力（単位はすべて MPa = N/mm^2）:
//   σx  = N/A + M·y/I
//   τxθ = T·r/Ip
//   σθ = σr = τxr = τθr = 0
//     （内圧などが無いので周方向・半径方向の垂直応力は恒等的に 0。
//       これ自体が「一軸引張＋せん断」という応力状態の理解につながるので
//       コンターの選択肢としては残してある。）

/** 中実円断面の断面諸量。d は直径 [mm]。 */
export function sectionProps(d) {
  return {
    R: d / 2,
    A: (Math.PI * d * d) / 4,
    I: (Math.PI * Math.pow(d, 4)) / 64,
    Ip: (Math.PI * Math.pow(d, 4)) / 32,
  };
}

/**
 * 断面内の点 (r, a) における応力成分を返す。
 * loads: {N[kN], M[N·m], T[N·m]}, sec: sectionProps() の戻り値。
 * x は現状どこでも同じ結果になるが、将来 x 方向に変化する荷重を入れられるよう引数に残す。
 */
export function stressAt(loads, sec, r, a, _x) {
  const y = r * Math.cos(a);
  return {
    sx: (loads.N * 1000) / sec.A + (loads.M * 1000 * y) / sec.I, // σx
    sy: 0, // σθ
    sz: 0, // σr
    txy: (loads.T * 1000 * r) / sec.Ip, // τxθ
  };
}

/**
 * 応力成分 {sx, sy, sz, txy} から主応力などを求める。
 * τxr = τθr = 0 なので r 方向はそのまま主方向であり、
 * x–θ 面の 2 次元問題として解ける。
 */
export function analyze(c) {
  const cen = (c.sx + c.sy) / 2;
  const rad = Math.hypot((c.sx - c.sy) / 2, c.txy);
  const ps = [cen + rad, cen - rad, c.sz].sort((p, q) => q - p);
  const [s1, s2, s3] = ps;
  const vm = Math.sqrt(
    ((s1 - s2) ** 2 + (s2 - s3) ** 2 + (s3 - s1) ** 2) / 2
  );
  return {
    ...c,
    center: cen,
    radius: rad,
    s1, s2, s3,
    tmax: (s1 - s3) / 2, // 3次元での最大せん断応力
    tmaxIn: rad, // x–θ 面内の最大せん断応力
    vm,
  };
}

/** 主軸の向き（x 軸から反時計まわり）。σ が最大になる面の角度 [rad]。 */
export function principalAngle(c) {
  return 0.5 * Math.atan2(2 * c.txy, c.sx - c.sy);
}

/**
 * コンター描画用の高速パス。σx と τxθ だけからコンター量を求める
 * （σθ = σr = 0 を前提。1 フレームで 1 万点以上評価するのでオブジェクトを作らない）。
 */
export function rawFieldValue(sx, txy, key) {
  switch (key) {
    case 'sx': return sx;
    case 'sy':
    case 'sz': return 0;
    case 'txy': return txy;
    default: {
      const cen = sx / 2;
      const rad = Math.hypot(sx / 2, txy);
      const pa = cen + rad;
      const pb = cen - rad;
      const s1 = pa > 0 ? pa : 0;
      const s3 = pb < 0 ? pb : 0;
      if (key === 's1') return s1;
      const s2 = pa + pb - s1 - s3; // 3 つのうち残りひとつ（0 を含む）
      if (key === 'tmax') return (s1 - s3) / 2;
      return Math.sqrt(((s1 - s2) ** 2 + (s2 - s3) ** 2 + (s3 - s1) ** 2) / 2);
    }
  }
}

/** φ [rad] だけ反時計まわりに回した面の応力（x–θ 面内）。 */
export function rotated(c, phi) {
  const half = (c.sx - c.sy) / 2;
  const cen = (c.sx + c.sy) / 2;
  const c2 = Math.cos(2 * phi);
  const s2 = Math.sin(2 * phi);
  return {
    sn: cen + half * c2 + c.txy * s2, // その面の垂直応力
    sn90: cen - half * c2 - c.txy * s2, // 90°ずれた面の垂直応力
    tau: -half * s2 + c.txy * c2, // せん断応力
  };
}

// ---------------------------------------------------------------- コンター量

export const FIELDS = [
  { key: 'sx', label: 'σx  軸方向の垂直応力', tex: '\\sigma_x', diverging: true, get: (a) => a.sx },
  { key: 'sy', label: 'σθ  周方向の垂直応力', tex: '\\sigma_\\theta', diverging: true, get: (a) => a.sy },
  { key: 'sz', label: 'σr  半径方向の垂直応力', tex: '\\sigma_r', diverging: true, get: (a) => a.sz },
  { key: 'txy', label: 'τxθ  せん断応力', tex: '\\tau_{x\\theta}', diverging: true, get: (a) => a.txy },
  { key: 's1', label: 'σ1  最大主応力', tex: '\\sigma_1', diverging: true, get: (a) => a.s1 },
  { key: 'tmax', label: 'τmax  最大せん断応力', tex: '\\tau_{\\max}', diverging: false, get: (a) => a.tmax },
  { key: 'vm', label: 'σeq  相当応力（von Mises）', tex: '\\sigma_{\\mathrm{eq}}', diverging: false, get: (a) => a.vm },
];

export function fieldByKey(key) {
  return FIELDS.find((f) => f.key === key) || FIELDS[0];
}

// ---------------------------------------------------------------- カラーマップ

const DIVERGING = [
  [0.0, [0x12, 0x44, 0x6e]],
  [0.25, [0x5b, 0x95, 0xc4]],
  [0.5, [0xf2, 0xed, 0xe1]],
  [0.75, [0xf0, 0x9a, 0x63]],
  [1.0, [0xa8, 0x32, 0x1a]],
];

const SEQUENTIAL = [
  [0.0, [0xf6, 0xf2, 0xe9]],
  [0.35, [0xf3, 0xc0, 0x8a]],
  [0.7, [0xef, 0x6a, 0x4b]],
  [1.0, [0x7d, 0x24, 0x13]],
];

function ramp(stops, u) {
  const t = Math.min(1, Math.max(0, u));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const k = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
      return [
        c0[0] + (c1[0] - c0[0]) * k,
        c0[1] + (c1[1] - c0[1]) * k,
        c0[2] + (c1[2] - c0[2]) * k,
      ];
    }
  }
  return stops[stops.length - 1][1].slice();
}

/** u（0..1）を [r,g,b]（0..1）に。diverging=true なら発散系、false なら連続系。 */
export function colorAt(u, diverging) {
  const rgb = ramp(diverging ? DIVERGING : SEQUENTIAL, u);
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

export function cssColorAt(u, diverging) {
  const rgb = ramp(diverging ? DIVERGING : SEQUENTIAL, u);
  return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
}

/** カラーバー用の CSS グラデーション文字列。 */
export function gradientCss(diverging, steps = 24) {
  const parts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    parts.push(`${cssColorAt(u, diverging)} ${(u * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

// ---------------------------------------------------------------- 数値整形

export function fmt(v, digits = 1) {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) < 5e-3) return '0.0';
  return v.toFixed(digits);
}
