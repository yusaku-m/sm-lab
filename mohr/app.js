// mohr/ 単元のエントリポイント。
// UI の状態を持ち、3D 表示（rod3d.js）とモールの応力円（mohr2d.js）へ配る。
// 計算はすべて stress.js の閉じた式（Pyodide は使わない）。

import { RodScene } from './rod3d.js';
import { VesselScene } from './vessel3d.js';
import { renderPlate } from './plate2d.js';
import {
  renderCircles, renderElement, PLANES, planeByKey, planeComps, planeAxisNames, setOutOfPlaneAxis,
} from './mohr2d.js';
import {
  FIELDS, fieldByKey, sectionProps, stressAt, analyze, rotated,
  principalAngle, gradientCss, fmt, vesselStress,
  shearModulus, strainFromStress, stressFromStrain, strainAlong, thicknessStrain,
} from './stress.js';

const RANGES = { N: 120, M: 600, T: 600 };
// 薄肉容器の入力範囲。p [MPa]（負は外圧）、r = 内半径 [mm]、t = 肉厚 [mm]
const V_RANGES = { p: [-20, 20], r: [20, 3000], t: [0.5, 100] };
// 微小平板の入力範囲。応力 [MPa]、ひずみ [×10⁻⁶]、E [GPa]
const P_RANGES = { s: 300, e: 2000, g: 4000, E: [1, 300], nu: [0, 0.49] };
const MODELS = ['rod', 'sph', 'cyl', 'plate'];
const isVessel = () => state.model === 'sph' || state.model === 'cyl';
const isPlate = () => state.model === 'plate';
/** data-model 属性の値（rod / vessel / plate）。 */
const modelGroup = () => (isPlate() ? 'plate' : isVessel() ? 'vessel' : 'rod');

const state = {
  // 左上のパネルに出す対象。'rod' = 丸棒、'sph' = 薄肉球殻、'cyl' = 薄肉円筒殻
  model: 'rod',
  vessel: { p: 2, r: 500, t: 10 },
  // 微小平板。mode = 's'（応力を与える）/ 'e'（ひずみを与える）。与えていない側は plateSync() で計算する
  plate: {
    mode: 'e',
    s: { sx: 0, sy: 0, txy: 0 },
    e: { ex: 400, ey: -100, gxy: 400 }, // εp = 350（演習のロゼットの読みの形）
    mat: { E: 206, nu: 0.3 }, // 軟鋼（Grading の Material.Steel）
  },
  // URL から渡された薄肉容器の探触点（URL の単位のまま。シーン生成後に流し込む）
  vprobe: null,
  loads: { N: 40, M: 260, T: 300 },
  geom: { d: 50, L: 250 },
  field: 'sx',
  planes: { xy: true, yr: false, rx: false },
  // 直径を回して見せる面（応力円で選んだ円）。実線で描き、φ・応力要素・3D の回した軸はこの面で考える
  plane: 'xy',
  phi: 0, // deg
  sectionT: 0.3,
  probe: { r: 25, a: 0 }, // 探触点（r [mm], a [deg]）。初期値は setGeomDefaults で直径に合わせる
  // 応力円の軸範囲。'auto' は円に合わせて自動、'fixed' は下の値に固定する。
  // 固定すると荷重を変えても目盛りが動かないので、符号が変わる/大きさが変わる
  // ときの円の動きがそのまま見える（自動だと円の見かけの大きさが変わらない）。
  axis: { mode: 'auto', sMin: -60, sMax: 120, tMax: 60 },
};

// ---------------------------------------------------------------- URL 状態

// 設定は URL のハッシュに載せる（例 #n=40&m=260&t=300&d=50&l=250&s=30&f=sx&p=xy&q=0&pr=25&pa=0）。
// サーバー不要でそのまま共有・QR化できるので、クエリではなくハッシュを使う。
const PLANE_KEYS = PLANES.map((p) => p.key);

// 薄肉容器は k=sph|cyl と vp/vr/vt（p, r, t）、探触点 vu/vv を載せ、丸棒のキーは書かない
// （k が無ければ丸棒。以前からある丸棒の URL はそのまま読める）。
// 探触点の単位: 円筒殻は vu = 軸方向の位置 [%]（中央 0、端 ±100）・vv = 周方向の角度 a [deg]、
//              球殻は vu = 緯度 [deg]・vv = 経度 [deg]。
function buildHash() {
  const q = new URLSearchParams();
  if (isPlate()) {
    // 微小平板: k=plate、pm=s|e（与える量）、与えている側の 3 成分（ps=σx,σy,τxy または pe=εx,εy,γxy）、pE/pn
    const P = state.plate;
    q.set('k', 'plate');
    q.set('pm', P.mode);
    if (P.mode === 's') q.set('ps', [P.s.sx, P.s.sy, P.s.txy].map((v) => round(v, 1)).join(','));
    else q.set('pe', [P.e.ex, P.e.ey, P.e.gxy].map((v) => round(v, 0)).join(','));
    q.set('pE', String(round(P.mat.E, 1)));
    q.set('pn', String(round(P.mat.nu, 3)));
  } else if (isVessel()) {
    q.set('k', state.model);
    q.set('vp', String(round(state.vessel.p, 2)));
    q.set('vr', String(round(state.vessel.r, 1)));
    q.set('vt', String(round(state.vessel.t, 2)));
    const vp = vesselProbeUrl();
    if (vp) {
      q.set('vu', String(round(vp.u, 1)));
      q.set('vv', String(round(vp.v, 1)));
    }
  } else {
    q.set('n', String(round(state.loads.N, 1)));
    q.set('m', String(round(state.loads.M, 1)));
    q.set('t', String(round(state.loads.T, 1)));
    q.set('d', String(round(state.geom.d, 1)));
    q.set('l', String(round(state.geom.L, 1)));
    q.set('s', String(round(state.sectionT * 100, 1)));
  }
  q.set('f', state.field);
  q.set('p', PLANE_KEYS.filter((k) => state.planes[k]).join('.') || '-');
  q.set('q', String(round(state.phi, 1)));
  if (state.plane !== 'xy') q.set('c', state.plane); // 選んでいる円（既定の x–y 面なら書かない）
  if (state.model === 'rod') {
    const pr = rod && rod.probe ? rod.probe.r : state.probe.r;
    const pa = rod && rod.probe ? (rod.probe.a * 180) / Math.PI : state.probe.a;
    q.set('pr', String(round(pr, 1)));
    q.set('pa', String(round(pa, 1)));
  }
  if (state.axis.mode === 'fixed') {
    const a = state.axis;
    q.set('ax', [round(a.sMin, 1), round(a.sMax, 1), round(a.tMax, 1)].join(','));
  }
  return q.toString();
}

/** 薄肉容器の探触点を URL の単位で返す。 */
function vesselProbeUrl() {
  if (!vessel) return state.vprobe;
  const q = vessel.probe;
  const deg = (r) => (r * 180) / Math.PI;
  return state.model === 'cyl' ? { u: q.u * 100, v: deg(q.v) } : { u: deg(q.u), v: deg(q.v) };
}

/** URL の単位の探触点を薄肉容器のシーンへ流し込む。 */
function applyVesselProbe() {
  if (!vessel || !state.vprobe || !isVessel()) return;
  const { u, v } = state.vprobe;
  const rad = (d) => (d * Math.PI) / 180;
  if (state.model === 'cyl') vessel.setProbe(u / 100, rad(v), 'cyl');
  else vessel.setProbe(rad(u), rad(v), 'sph');
}

function round(v, digits) {
  const k = Math.pow(10, digits);
  return Math.round(v * k) / k;
}

/** ハッシュ文字列を state に流し込む。値が壊れていても既定値のまま進む。 */
function applyHash(hash) {
  if (!hash) return false;
  const q = new URLSearchParams(hash);
  const num = (key, lo, hi, cur) => {
    const v = parseFloat(q.get(key));
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : cur;
  };
  // k が無い（＝以前からの丸棒の URL）なら丸棒に戻す
  state.model = MODELS.includes(q.get('k')) ? q.get('k') : 'rod';
  state.vessel.p = num('vp', V_RANGES.p[0], V_RANGES.p[1], state.vessel.p);
  state.vessel.r = num('vr', V_RANGES.r[0], V_RANGES.r[1], state.vessel.r);
  state.vessel.t = num('vt', V_RANGES.t[0], V_RANGES.t[1], state.vessel.t);
  const vu = parseFloat(q.get('vu'));
  const vv = parseFloat(q.get('vv'));
  const uMax = state.model === 'cyl' ? 100 : 90;
  state.vprobe = Number.isFinite(vu) && Number.isFinite(vv)
    ? { u: Math.min(uMax, Math.max(-uMax, vu)), v: vv }
    : null;
  const P = state.plate;
  P.mode = q.get('pm') === 's' ? 's' : 'e';
  const triple = (key, lim) => {
    const v = (q.get(key) || '').split(',').map(parseFloat);
    return v.length === 3 && v.every(Number.isFinite) ? v.map((x) => Math.min(lim, Math.max(-lim, x))) : null;
  };
  const ps = triple('ps', P_RANGES.s);
  if (ps) P.s = { sx: ps[0], sy: ps[1], txy: ps[2] };
  const pe = triple('pe', P_RANGES.g);
  if (pe) P.e = { ex: pe[0], ey: pe[1], gxy: pe[2] };
  P.mat.E = num('pE', P_RANGES.E[0], P_RANGES.E[1], P.mat.E);
  P.mat.nu = num('pn', P_RANGES.nu[0], P_RANGES.nu[1], P.mat.nu);
  state.loads.N = num('n', -RANGES.N, RANGES.N, state.loads.N);
  state.loads.M = num('m', -RANGES.M, RANGES.M, state.loads.M);
  state.loads.T = num('t', -RANGES.T, RANGES.T, state.loads.T);
  state.geom.d = num('d', 10, 120, state.geom.d);
  state.geom.L = num('l', 120, 800, state.geom.L);
  state.sectionT = num('s', 4, 88, state.sectionT * 100) / 100;
  state.phi = num('q', -180, 180, state.phi);
  state.plane = PLANE_KEYS.includes(q.get('c')) ? q.get('c') : 'xy';
  if (q.has('f') && FIELDS.some((f) => f.key === q.get('f'))) state.field = q.get('f');
  if (q.has('p')) {
    const on = q.get('p').split('.');
    for (const k of PLANE_KEYS) state.planes[k] = on.includes(k);
  }
  state.probe.r = num('pr', 0, state.geom.d / 2, state.geom.d / 2);
  state.probe.a = num('pa', -360, 360, state.probe.a);
  if (!state.planes[state.plane]) state.planes[state.plane] = true; // 選んでいる円は必ず表示する
  // ax が無いハッシュは「自動」を意味する（付いていた設定を持ち越さない）
  state.axis = { ...state.axis, mode: 'auto' };
  if (q.has('ax')) {
    const v = q.get('ax').split(',').map(parseFloat);
    if (v.length === 3 && v.every(Number.isFinite)) {
      state.axis = { mode: 'fixed', sMin: v[0], sMax: v[1], tMax: v[2] };
    }
  }
  return true;
}

const restored = applyHash(location.hash.replace(/^#/, ''));
if (!restored) state.probe.r = state.geom.d / 2;

const $ = (id) => document.getElementById(id);

// スマホ表示（style.css の @media (max-width: 760px) と同じ境界）
const compactMq = window.matchMedia('(max-width: 760px)');
const isCompact = () => compactMq.matches;
compactMq.addEventListener('change', () => {
  if (rod) rod.fitMargin = isCompact() ? 1.26 : 1.06;
  fitVesselToLayout();
  for (const sc of [rod, vessel]) if (sc) sc.resetView();
  update();
});

// ---------------------------------------------------------------- 入力行

const LOAD_SPEC = [
  { key: 'N', tex: 'P', name: '荷重（引張が正）', unit: 'kN', min: -RANGES.N, max: RANGES.N, step: 1 },
  { key: 'M', tex: 'M', name: '曲げモーメント（両端）', unit: 'N·m', min: -RANGES.M, max: RANGES.M, step: 5 },
  { key: 'T', tex: 'T', name: 'ねじりモーメント', unit: 'N·m', min: -RANGES.T, max: RANGES.T, step: 5 },
];

const VESSEL_SPEC = [
  { key: 'p', tex: 'p', name: '内圧（ゲージ圧、負は外圧）', unit: 'MPa', min: V_RANGES.p[0], max: V_RANGES.p[1], step: 0.1 },
  { key: 'r', tex: 'r', name: '内半径', unit: 'mm', min: V_RANGES.r[0], max: V_RANGES.r[1], step: 10 },
  { key: 't', tex: 't', name: '肉厚', unit: 'mm', min: V_RANGES.t[0], max: V_RANGES.t[1], step: 0.5 },
];

const GEOM_SPEC = [
  { key: 'd', tex: 'd', name: '直径', unit: 'mm', min: 10, max: 120, step: 1 },
  { key: 'L', tex: 'L', name: '長さ', unit: 'mm', min: 120, max: 800, step: 10 },
  { key: 'sec', tex: 'x', name: '輪切りの位置', unit: '% of L', min: 4, max: 88, step: 1 },
];

function makeRow(spec, get, set) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.innerHTML =
    `<div class="field-head">` +
    `<span class="name"><span class="tex" data-tex="${spec.tex}"></span>${spec.name}</span>` +
    `<span class="unit">${spec.unit}</span></div>` +
    `<div class="field-inputs">` +
    `<input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}">` +
    `<input type="number" min="${spec.min}" max="${spec.max}" step="${spec.step}"></div>`;
  const range = row.querySelector('input[type=range]');
  const num = row.querySelector('input[type=number]');

  const clamp = (v) => Math.min(spec.max, Math.max(spec.min, v));
  const push = (v) => {
    const c = clamp(v);
    set(c);
    range.value = c;
    update();
  };
  range.addEventListener('input', () => push(parseFloat(range.value)));
  num.addEventListener('input', () => {
    const v = parseFloat(num.value);
    if (!Number.isFinite(v)) return;
    const c = clamp(v);
    set(c);
    range.value = c;
    update();
  });
  num.addEventListener('blur', () => {
    num.value = String(clamp(parseFloat(num.value) || 0));
  });

  return {
    el: row,
    sync() {
      const v = get();
      range.value = v;
      if (document.activeElement !== num) num.value = String(Math.round(v * 100) / 100);
    },
  };
}

const rows = [];

for (const spec of LOAD_SPEC) {
  const r = makeRow(spec, () => state.loads[spec.key], (v) => { state.loads[spec.key] = v; });
  rows.push(r);
  $('load-fields').appendChild(r.el);
}
for (const spec of GEOM_SPEC) {
  const r =
    spec.key === 'sec'
      ? makeRow(spec, () => state.sectionT * 100, (v) => { state.sectionT = v / 100; })
      : makeRow(spec, () => state.geom[spec.key], (v) => { state.geom[spec.key] = v; });
  rows.push(r);
  $('geom-fields').appendChild(r.el);
}
for (const spec of VESSEL_SPEC) {
  const r = makeRow(spec, () => state.vessel[spec.key], (v) => { state.vessel[spec.key] = v; });
  rows.push(r);
  $('vessel-fields').appendChild(r.el);
}

// --- 微小平板
const P_STRESS_SPEC = [
  { key: 'sx', tex: '\\sigma_x', name: '垂直応力', unit: 'MPa', min: -P_RANGES.s, max: P_RANGES.s, step: 1 },
  { key: 'sy', tex: '\\sigma_y', name: '垂直応力', unit: 'MPa', min: -P_RANGES.s, max: P_RANGES.s, step: 1 },
  { key: 'txy', tex: '\\tau_{xy}', name: 'せん断応力', unit: 'MPa', min: -P_RANGES.s, max: P_RANGES.s, step: 1 },
];
const MU = '×10⁻⁶';
const P_STRAIN_SPEC = [
  { key: 'ex', tex: '\\varepsilon_x', name: '0° ゲージの読み', unit: MU, min: -P_RANGES.e, max: P_RANGES.e, step: 10 },
  { key: 'ep', tex: '\\varepsilon_p', name: '45° ゲージの読み', unit: MU, min: -P_RANGES.e, max: P_RANGES.e, step: 10 },
  { key: 'ey', tex: '\\varepsilon_y', name: '90° ゲージの読み', unit: MU, min: -P_RANGES.e, max: P_RANGES.e, step: 10 },
  { key: 'gxy', tex: '\\gamma_{xy}', name: 'せん断ひずみ（= 2εp − (εx + εy)）', unit: MU, min: -P_RANGES.g, max: P_RANGES.g, step: 10 },
];
const P_MAT_SPEC = [
  { key: 'E', tex: 'E', name: '縦弾性係数', unit: 'GPa', min: P_RANGES.E[0], max: P_RANGES.E[1], step: 1 },
  { key: 'nu', tex: '\\nu', name: 'ポアソン比', unit: '-', min: P_RANGES.nu[0], max: P_RANGES.nu[1], step: 0.01 },
];
// Grading の packages/quiz/Material.py と同じ値
const MATERIALS = [
  { name: '軟鋼', E: 206, nu: 0.3 },
  { name: '鋳鉄', E: 98, nu: 0.3 },
  { name: 'アルミ', E: 69, nu: 0.33 },
  { name: '銅', E: 126, nu: 0.33 },
  { name: 'コンクリート', E: 20, nu: 0.2 },
];

/** 与えていない側を、与えている側からフックの法則で計算し直す。 */
function plateSync() {
  const P = state.plate;
  if (P.mode === 's') P.e = strainFromStress(P.s, P.mat);
  else P.s = stressFromStrain(P.e, P.mat);
}

const ep45 = () => (state.plate.e.ex + state.plate.e.ey + state.plate.e.gxy) / 2;

for (const spec of P_STRESS_SPEC) {
  const r = makeRow(spec, () => state.plate.s[spec.key], (v) => { state.plate.s[spec.key] = v; });
  rows.push(r);
  $('plate-stress-fields').appendChild(r.el);
}
for (const spec of P_STRAIN_SPEC) {
  const clampG = (v) => Math.min(P_RANGES.g, Math.max(-P_RANGES.g, v));
  // εp を動かしたときは εx・εy をそのままに γxy を決め直す（εx・εy を動かしたときは γxy を保つ）
  const r = spec.key === 'ep'
    ? makeRow(spec, ep45, (v) => { const e = state.plate.e; e.gxy = clampG(2 * v - (e.ex + e.ey)); })
    : makeRow(spec, () => state.plate.e[spec.key], (v) => { state.plate.e[spec.key] = v; });
  rows.push(r);
  $('plate-strain-fields').appendChild(r.el);
}
for (const spec of P_MAT_SPEC) {
  const r = makeRow(spec, () => state.plate.mat[spec.key], (v) => { state.plate.mat[spec.key] = v; });
  rows.push(r);
  $('plate-mat-fields').appendChild(r.el);
}

$('plate-mat').replaceChildren(
  ...MATERIALS.map((m, i) => new Option(`${m.name}（E = ${m.E} GPa, ν = ${m.nu}）`, String(i))),
  new Option('任意（下の値）', 'custom')
);
$('plate-mat').addEventListener('change', () => {
  const m = MATERIALS[Number($('plate-mat').value)];
  if (m) state.plate.mat = { E: m.E, nu: m.nu };
  update();
});

for (const b of document.querySelectorAll('[data-pmode]')) {
  b.addEventListener('click', () => {
    state.plate.mode = b.dataset.pmode;
    update();
  });
}

/** 与える側のトグル・入力欄の有効/無効・材料のセレクトを状態に合わせる。 */
function syncPlateUI() {
  const P = state.plate;
  for (const b of document.querySelectorAll('[data-pmode]')) {
    b.setAttribute('aria-pressed', b.dataset.pmode === P.mode ? 'true' : 'false');
  }
  for (const [id, on] of [['plate-stress-group', P.mode === 's'], ['plate-strain-group', P.mode === 'e']]) {
    const g = $(id);
    g.classList.toggle('derived', !on);
    for (const inp of g.querySelectorAll('input')) inp.disabled = !on;
  }
  const i = MATERIALS.findIndex((m) => Math.abs(m.E - P.mat.E) < 1e-9 && Math.abs(m.nu - P.mat.nu) < 1e-9);
  $('plate-mat').value = i >= 0 ? String(i) : 'custom';
}

// 典型的な応力状態。与えているのがひずみでも、応力で決めてからひずみに直す
const PLATE_PRESETS = [
  { label: '単軸引張', short: '単軸', s: { sx: 100, sy: 0, txy: 0 } },
  { label: '等二軸引張', short: '等二軸', s: { sx: 100, sy: 100, txy: 0 } },
  { label: '純せん断', short: 'せん断', s: { sx: 0, sy: 0, txy: 80 } },
];
for (const pr of PLATE_PRESETS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.innerHTML = `<span class="long">${pr.label}</span><span class="short">${pr.short}</span>`;
  b.addEventListener('click', () => {
    state.plate.s = { ...pr.s };
    state.plate.e = strainFromStress(state.plate.s, state.plate.mat);
    update();
  });
  $('plate-actions').appendChild(b);
}

// ---------------------------------------------------------------- コンター選択

// σx・σy の呼び名は対象ごとに変える（円筒殻は x = z、球殻は x = φ。講義資料の表記）
const FIELD_LABELS = {
  rod: {},
  plate: {},
  cyl: { sx: 'σx  軸方向（z）の垂直応力', sy: 'σy  周方向（θ）の垂直応力' },
  sph: { sx: 'σx  経線方向（φ）の垂直応力', sy: 'σy  周方向（θ）の垂直応力' },
};
const fieldLabel = (f) => FIELD_LABELS[state.model][f.key] || f.label;

function renderFieldOptions() {
  $('field').replaceChildren(
    ...FIELDS.map((f) => {
      const o = document.createElement('option');
      o.value = f.key;
      o.textContent = fieldLabel(f);
      return o;
    })
  );
  $('field').value = state.field;
}
renderFieldOptions();
$('field').addEventListener('change', () => {
  state.field = $('field').value;
  update();
});

// ---------------------------------------------------------------- 平面チェック

const planeInputs = {};

for (const p of PLANES) {
  const lab = document.createElement('label');
  lab.className = 'check';
  lab.innerHTML =
    `<input type="checkbox"${state.planes[p.key] ? ' checked' : ''}>` +
    `<span class="swatch" style="background:${p.color}"></span>` +
    `<span class="long">${p.label}</span><span class="short">${p.short} 面</span>`;
  const input = lab.querySelector('input');
  planeInputs[p.key] = input;
  input.addEventListener('change', (e) => {
    state.planes[p.key] = e.target.checked;
    // 選んでいる円を消したら、残っている円のうち最初のものを選び直す
    if (!e.target.checked && state.plane === p.key) {
      state.plane = PLANE_KEYS.find((k) => state.planes[k]) || state.plane;
    }
    update();
  });
  $('plane-checks').appendChild(lab);
}

// ---------------------------------------------------------------- プリセット

// 「単純◯◯」= 指定の荷重だけ残して他を 0 にする。
// 残す側が 0 のときだけ既定値を入れる（ユーザーが決めた大きさを勝手に変えないため）。
const PRESETS = [
  { key: 'N', label: '単純引張', short: '引張', fallback: 40 },
  { key: 'M', label: '単純曲げ', short: '曲げ', fallback: 260 },
  { key: 'T', label: '単純ねじり', short: 'ねじり', fallback: 300 },
];

function applyPreset(preset) {
  for (const q of PRESETS) state.loads[q.key] = q.key === preset.key ? state.loads[q.key] : 0;
  if (!state.loads[preset.key]) state.loads[preset.key] = preset.fallback;
  update();
}

function addPresetButtons(host, keys, extraClass) {
  const frag = document.createDocumentFragment();
  for (const preset of PRESETS) {
    if (keys && !keys.includes(preset.key)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (extraClass ? ' ' + extraClass : '');
    // スマホでは短いラベルに切り替えて1行に収める（CSSで出し分け）
    b.innerHTML = `<span class="long">${preset.label}</span><span class="short">${preset.short}</span>`;
    b.addEventListener('click', () => applyPreset(preset));
    frag.appendChild(b);
  }
  // 「応力円が最大の点へ」より前に入れたいので先頭へ差し込む
  host.insertBefore(frag, host.firstChild);
}

addPresetButtons($('presets'), null);
// 丸棒パネルにも置く（スマホでは荷重パネルが画面外なので、よく使う2つだけ手元に）
addPresetButtons($('rod-actions'), null, 'preset-mobile');

// ------------------------------------------------------------ 軸の範囲

const axisInputs = {
  sMin: $('axis-smin'),
  sMax: $('axis-smax'),
  tMax: $('axis-tmax'),
};

function syncAxisUI() {
  $('axis-mode').value = state.axis.mode;
  $('axis-fields').hidden = state.axis.mode !== 'fixed';
  for (const k in axisInputs) {
    if (document.activeElement !== axisInputs[k]) {
      axisInputs[k].value = String(round(state.axis[k], 1));
    }
  }
}

$('axis-mode').addEventListener('change', () => {
  if ($('axis-mode').value === 'fixed') {
    // 自動から切り替えた瞬間は「いま見えている範囲」を初期値にする
    state.axis = { mode: 'fixed', ...roundAxis(shownAxis) };
  } else {
    state.axis = { ...state.axis, mode: 'auto' };
  }
  syncAxisUI();
  update();
});

for (const k in axisInputs) {
  axisInputs[k].addEventListener('input', () => {
    const v = parseFloat(axisInputs[k].value);
    if (!Number.isFinite(v)) return;
    state.axis[k] = v;
    state.axis.mode = 'fixed';
    update();
  });
}

$('axis-grab').addEventListener('click', () => {
  state.axis = { mode: 'fixed', ...roundAxis(shownAxis) };
  syncAxisUI();
  update();
});

function roundAxis(a) {
  // 目盛りが読みやすい刻みに丸める
  const step = (span) => {
    const raw = span / 6;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  };
  const st = step(a.sMax - a.sMin);
  return {
    sMin: Math.floor(a.sMin / st) * st,
    sMax: Math.ceil(a.sMax / st) * st,
    tMax: Math.ceil(a.tMax / st) * st,
  };
}

// ---------------------------------------------------------------- φ

const phiRange = $('phi');
const phiNum = $('phi-num');
function setPhi(deg) {
  state.phi = Math.min(180, Math.max(-180, deg));
  phiRange.value = state.phi;
  phiNum.value = String(Math.round(state.phi * 10) / 10);
  update({ skipRod: true }); // φ は 3D 図に影響しないので作り直さない
}
phiRange.addEventListener('input', () => setPhi(parseFloat(phiRange.value)));
phiNum.addEventListener('input', () => {
  const v = parseFloat(phiNum.value);
  if (Number.isFinite(v)) {
    state.phi = Math.min(180, Math.max(-180, v));
    if (state.phi !== v) phiNum.value = String(state.phi); // 範囲外の入力（例: 200）を実際の値に戻す
    phiRange.value = state.phi;
    update({ skipRod: true });
  }
});
// --- 応力円の直径を掴んで回す
// SVG は update のたびに作り直されるので、掴んだ時点の要素ではなく
// mohrDrag（円の中心・半径・基準角）を見て角度を計算する。
function svgUserPoint(ev) {
  const svg = $('mohr-plot').querySelector('svg');
  if (!svg) return null;
  const m = svg.getScreenCTM();
  if (!m) return null;
  const p = new DOMPoint(ev.clientX, ev.clientY);
  return p.matrixTransform(m.inverse());
}

// クリックした位置の円（PLANES のキー）。円周に近いものを優先し、無ければ点を含む円のうち最も小さいもの
// （円筒殻のように大きな円の中に小さな円がある場合、内側をクリックすると小さい方を選ぶ）。
function circleAt(q) {
  let best = null;
  let bestD = Infinity;
  for (const c of mohrHit) {
    // 選んでいる円を優先（円筒殻の円は σ1 などの点で接しているので、そこを掴んでも今の円を回せるように）
    const d = Math.abs(Math.hypot(q.x - c.cx, q.y - c.cy) - c.r) - (c.key === state.plane ? 6 : 0);
    if (d < 9 && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  if (best) return best.key;
  const inside = mohrHit
    .filter((c) => Math.hypot(q.x - c.cx, q.y - c.cy) <= c.r)
    .sort((a, b) => a.r - b.r);
  return inside.length ? inside[0].key : null;
}

// 円を選んでいる面にする（φ はその面で測り直すので 0 に戻す）
function selectPlane(key) {
  if (!key || key === state.plane) return;
  state.plane = key;
  setPhi(0);
}

let suppressClick = false;

$('mohr-plot').addEventListener('pointerdown', (ev) => {
  suppressClick = false;
  // スマホは画面スクロールを邪魔しないよう対象外（φ はスライダーで変えられる。円の選択は click で）
  if (!mohrDrag || (ev.pointerType === 'touch' && isCompact())) return;
  const q = svgUserPoint(ev);
  if (!q) return;
  // 別の円の円周・内側を押したときは回さない（click で選び直す）
  const target = circleAt(q);
  if (target && target !== state.plane) return;
  const dist = Math.hypot(q.x - mohrDrag.cx, q.y - mohrDrag.cy);
  // 円周のまわりに十分な掴み代をとる（小さい円でも掴めるように下限を設ける）
  if (Math.abs(dist - mohrDrag.r) > Math.max(22, mohrDrag.r * 0.45)) return;
  suppressClick = true;
  ev.preventDefault();
  $('mohr-plot').classList.add('grabbing');

  const toPhi = (e) => {
    const t = svgUserPoint(e);
    if (!t) return;
    const a = Math.atan2(t.y - mohrDrag.cy, t.x - mohrDrag.cx);
    setPhi(wrap90(((mohrDrag.alpha0 - a) * 180) / Math.PI / 2));
  };
  toPhi(ev);
  const up = () => {
    $('mohr-plot').classList.remove('grabbing');
    window.removeEventListener('pointermove', toPhi);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', toPhi);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
});

$('mohr-plot').addEventListener('click', (ev) => {
  if (suppressClick) {
    suppressClick = false; // 直径を回したあとの click では選び直さない
    return;
  }
  const q = svgUserPoint(ev);
  if (q) selectPlane(circleAt(q));
});

/** 選んでいる面の主軸の向き [deg]。 */
const planeThetaP = () => (principalAngle(planeComps(currentComps(), planeByKey(state.plane))) * 180) / Math.PI;
$('phi-zero').addEventListener('click', () => setPhi(0));
$('phi-principal').addEventListener('click', () => setPhi(wrap90(planeThetaP())));
$('phi-tmax').addEventListener('click', () => setPhi(wrap90(planeThetaP() + 45)));

function wrap90(deg) {
  let d = deg;
  while (d > 90) d -= 180;
  while (d < -90) d += 180;
  return d;
}

// --- 微小平板の紫のゲージ（φ の向き）を掴んで回す。ゲージは向きの無い線なので φ は ±90° に畳む。
// 中心の反対側（φ+180°）に描いているが、どちら側を掴んでも同じ向きになる。
$('plate-view').addEventListener('pointerdown', (ev) => {
  if (!plateDrag || (ev.pointerType === 'touch' && isCompact())) return;
  const svg = $('plate-view').querySelector('svg');
  const m = svg && svg.getScreenCTM();
  if (!m) return;
  const toUser = (e) => new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  const q = toUser(ev);
  const d = Math.hypot(q.x - plateDrag.cx, q.y - plateDrag.cy);
  if (d < 8 || d > 110) return; // 板の外（応力の矢印のあたり）は対象外
  ev.preventDefault();
  if (state.plane !== 'xy') {
    // φ は x–y 面で測る（他の面を選んでいたら x–y 面に戻す）
    state.plane = 'xy';
    state.planes.xy = true;
    planeInputs.xy.checked = true;
  }
  $('plate-view').classList.add('grabbing');
  const toPhi = (e) => {
    const t = toUser(e);
    const a = Math.atan2(-(t.y - plateDrag.cy), t.x - plateDrag.cx);
    setPhi(wrap90((a * 180) / Math.PI - 180));
  };
  toPhi(ev);
  const up = () => {
    $('plate-view').classList.remove('grabbing');
    window.removeEventListener('pointermove', toPhi);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', toPhi);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
});

// ---------------------------------------------------------------- 対象の切り替え

const VESSEL_SUB = (xName) =>
  '外面をドラッグすると探触点が動きます（膜応力は殻のどこでも同じなので、変わるのは局所座標の向きだけです）。' +
  '赤い矢印＝内圧 <span class="tex" data-tex="p"></span>。<b>容器の内側（内面・切り口・矢印）を上下にドラッグ</b>すると内圧が変わります（上で増加）。' +
  `<span class="tex" data-tex="x"></span> = ${xName}、` +
  '<span class="tex" data-tex="y"></span> = 周方向 <span class="tex" data-tex="\\theta"></span>、' +
  '<span class="tex" data-tex="r"></span> = 半径方向。';

const MODEL_TEXT = {
  plate: {
    table: { sx: 'σx', sy: 'σy' },
  },
  rod: {
    table: { sx: 'σx 軸方向', sy: 'σy 周方向' },
  },
  cyl: {
    table: { sx: 'σx 軸方向 z', sy: 'σy 周方向 θ' },
    sub: VESSEL_SUB('軸方向 <span class="tex" data-tex="z"></span>'),
  },
  sph: {
    table: { sx: 'σx 経線方向 φ', sy: 'σy 周方向 θ' },
    sub: VESSEL_SUB('経線方向 <span class="tex" data-tex="\\phi"></span>'),
  },
};

const HINT = {
  rod:
    'ドラッグ: <b>棒</b>＝探触点 ／ <b>背景</b>＝視点回転' +
    '<span class="hint-more"> ／ <b>矢印・円弧</b>＝荷重 ／ <b>黒いリング</b>＝断面位置</span>',
  vessel:
    'ドラッグ: <b>外面</b>＝探触点 ／ <b>背景</b>＝視点回転' +
    '<span class="hint-more"> ／ <b>内側を上下</b>＝内圧 p</span>',
};

/**
 * 表示する対象を切り替える。fromUser（見出しのセレクトで選んだとき）で薄肉容器にしたときは
 * 3 つの面の円を全部出す（球殻は x–y 面の円が点に潰れるので、1 つだけだと何も見えないため。
 * 資料も「3 つの主応力に対するモールの応力円」で締めくくっている）。
 */
function setModel(model, opts = {}) {
  state.model = model;
  $('model').value = model;
  const vesselOn = isVessel();
  const plateOn = isPlate();
  const group = modelGroup();
  for (const el of document.querySelectorAll('[data-model]')) {
    el.hidden = !el.dataset.model.split(' ').includes(group);
  }
  $('model-suffix').textContent = plateOn ? 'の応力状態' : 'の応力分布';
  // 3 本目の主方向は、微小平板では板厚方向 z、それ以外は半径方向 r
  setOutOfPlaneAxis(plateOn ? 'z' : 'r');
  for (const p of PLANES) {
    const lab = planeInputs[p.key].parentElement;
    lab.querySelector('.long').textContent = p.label;
    lab.querySelector('.short').textContent = `${p.short} 面`;
  }
  if (opts.fromUser && (vesselOn || plateOn)) {
    for (const k of PLANE_KEYS) {
      state.planes[k] = true;
      planeInputs[k].checked = true;
    }
  }
  const txt = MODEL_TEXT[model];
  if (vesselOn) {
    $('vessel-sub').innerHTML = txt.sub;
    renderTexSpans($('vessel-sub'));
  }
  renderFieldOptions();
  renderModelFormulas();
  if (rod) rod.setActive(group === 'rod');
  if (vessel) {
    if (vesselOn) vessel.set({ kind: model, vessel: state.vessel, field: state.field });
    vessel.setActive(vesselOn);
  }
  if (vesselOn ? vessel : rod) $('hint').innerHTML = HINT[vesselOn ? 'vessel' : 'rod'];
  update();
}

$('model').addEventListener('change', () => setModel($('model').value, { fromUser: true }));

// update() は関数宣言なので巻き上げられるが、let は巻き上がらない。
// RodScene の生成直後に setProbe → onPick → update() が走るため、
// update() が触る変数はすべてここで先に宣言しておく
// （順序を戻すと "Cannot access 'X' before initialization" になる）。
let updating = false;
let hashTimer = 0;
let lastHash = '';
// 直前に実際に描いた軸範囲（「いまの範囲を取り込む」で使う）
let shownAxis = { sMin: -60, sMax: 120, tMax: 60 };
// 直前に描いた応力円の幾何（直径を掴んで回すのに使う）
let mohrDrag = null;
// 直前に描いた円の位置（クリックで選ぶのに使う）
let mohrHit = [];
// 薄肉容器の 3D シーン（丸棒の生成中に update() から参照されるので、ここで先に宣言する）
let vessel = null;
// 直前に描いた微小平板の図の中心（回転ゲージを掴んで回すのに使う）
let plateDrag = null;

// ---------------------------------------------------------------- 3D シーン

let rod = null;
try {
  rod = new RodScene($('viewport'), {
    ranges: RANGES,
    onLoadsChange(loads) {
      state.loads = { ...loads };
      update({ fromScene: true });
    },
    onSectionChange(t) {
      state.sectionT = t;
      update({ fromScene: true });
    },
    onPick() {
      update({ fromScene: true });
    },
  });
} catch (e) {
  $('err').hidden = false;
  $('err').textContent =
    '3D 表示を初期化できませんでした（WebGL が使えない環境かもしれません）。\n' +
    (e && e.stack ? e.stack : e);
  $('hint').textContent = '3D 表示を利用できません';
}

// 生成後の初期化は try の外で行う。ここでのバグが
// 「WebGL が使えない」という誤ったメッセージに化けるのを防ぐため。
if (rod) {
  rod.set({ geom: state.geom, loads: state.loads, field: state.field, sectionT: state.sectionT });
  rod.fitMargin = isCompact() ? 1.26 : 1.06;
  rod.fitCamera(true);
  rod.setProbe(state.probe.r, (state.probe.a * Math.PI) / 180);
  $('hint').innerHTML = HINT.rod;
}

// 薄肉容器のシーン。同じ #viewport に 2 つ目の canvas を置き、表示する方だけ動かす
if (rod) {
  try {
    vessel = new VesselScene($('viewport'), {
      pRange: V_RANGES.p,
      onPick() {
        update({ fromScene: true });
      },
      onPressureChange(p) {
        state.vessel.p = p;
        update({ fromScene: true });
      },
    });
  } catch (e) {
    $('err').hidden = false;
    $('err').textContent = '薄肉容器の 3D 表示を初期化できませんでした。\n' + (e && e.stack ? e.stack : e);
  }
}
/** 薄肉容器は縦横比が 1 に近く、スマホではカラーバー（図の下側）に被るので小さめにして上へ寄せる。 */
function fitVesselToLayout() {
  if (!vessel) return;
  vessel.fitMargin = isCompact() ? 1.32 : 1.06;
  vessel.lift = isCompact() ? 0.16 : 0;
}

if (vessel) {
  fitVesselToLayout();
  applyVesselProbe();
}

$('reset-view').addEventListener('click', () => {
  const sc = isVessel() ? vessel : rod;
  if (sc) sc.resetView();
});

// 3つのモールの円のうち一番大きいもの（直径 σ1-σ3 = 2τmax）が最大になる点を探して探触点にする。
// σx = kN + kM·r·cos a, τ = kT·r という素直な形なので最大は必ず r = R・a = 0 か π に来るが、
// 将来 x 方向に変化する応力を入れても壊れないよう、素朴に走査して選ぶ（数万回程度で一瞬）。
function maxCirclePoint() {
  const sec = sectionProps(state.geom.d);
  let best = { v: -Infinity, s1: -Infinity, r: sec.R, a: 0 };
  for (let i = 0; i <= 24; i++) {
    const r = (i / 24) * sec.R;
    for (let j = 0; j < 360; j++) {
      const a = (j / 360) * Math.PI * 2;
      const an = analyze(stressAt(state.loads, sec, r, a, 0));
      const v = an.s1 - an.s3;
      // 同じ大きさの円になる点が複数あるとき（純曲げの上下など）は引張側を選ぶ。
      // 単に先に見つかったほうを採ると圧縮側に着地してしまう。
      if (v > best.v + 1e-9 || (v > best.v - 1e-9 && an.s1 > best.s1 + 1e-9)) {
        best = { v, s1: an.s1, r, a };
      }
    }
  }
  return best;
}

$('pick-max').addEventListener('click', () => {
  if (!rod) return;
  const best = maxCirclePoint();
  rod.setProbe(best.r, best.a);
});

// ---------------------------------------------------------------- 更新

function currentProbe() {
  const sec = sectionProps(state.geom.d);
  if (rod && rod.probe) return rod.probe;
  return { x: 0, r: sec.R, a: 0, onSurface: true };
}

function currentComps() {
  let c;
  if (isPlate()) {
    const s = state.plate.s;
    c = { sx: s.sx, sy: s.sy, sr: 0, txy: s.txy }; // sr は板厚方向 σz（平面応力なので 0）
  } else if (isVessel()) {
    c = vesselStress(state.model, state.vessel);
  } else {
    const sec = sectionProps(state.geom.d);
    const p = currentProbe();
    c = stressAt(state.loads, sec, p.r, p.a, p.x);
  }
  c.thetaP = principalAngle(c);
  return c;
}

function update(opts = {}) {
  if (updating) return;
  updating = true;
  try {
    const vesselOn = isVessel();
    const plateOn = isPlate();
    plateSync();
    if (!opts.fromScene && !opts.skipRod) {
      if (rod && state.model === 'rod') {
        rod.set({
          geom: state.geom,
          loads: state.loads,
          field: state.field,
          sectionT: state.sectionT,
        });
      }
      if (vessel && vesselOn) vessel.set({ kind: state.model, vessel: state.vessel, field: state.field });
    }
    for (const r of rows) r.sync();

    const sec = sectionProps(state.geom.d);
    const p = currentProbe();
    const comps = currentComps();
    const an = analyze(comps);
    const phi = (state.phi * Math.PI) / 180;
    // 3D図の頂点は動かさず、探触点の回した軸だけ更新（重くない）
    const scene = plateOn ? null : vesselOn ? vessel : rod;
    if (scene) scene.setPhi(phi, state.plane, principalAngle(comps));

    const drawn = renderCircles($('mohr-plot'), comps, an, state.planes, phi, {
      fontScale: isCompact() ? 1.45 : 1,
      axis: state.axis,
      active: state.plane,
    });
    shownAxis = drawn;
    mohrDrag = drawn.drag;
    mohrHit = drawn.hit;
    // φ のスライダーも選んでいる円の色にする（どの面を回しているか分かるように）
    phiRange.style.accentColor = planeByKey(state.plane).color;
    renderElement($('element-plot'), comps, an, phi, {
      fontScale: isCompact() ? 2.1 : 1,
      plane: state.plane,
    });
    renderTable(comps, an, phi);
    if (plateOn) {
      syncPlateUI();
      plateDrag = renderPlate($('plate-view'), state.plate.s, state.plate.e, phi, {
        showRot: state.plane === 'xy',
        fontScale: isCompact() ? 1.5 : 1,
      });
      renderPlateProbe(phi);
      renderPlateCurrent();
    } else if (vesselOn) {
      renderColorbar();
      renderVesselProbe();
      renderVesselCurrent(comps, an);
      renderVesselWarn();
    } else {
      renderColorbar();
      renderProbe(p, sec);
      renderCurrent(sec, p, comps);
    }
    syncHash();
  } finally {
    updating = false;
  }
}

// ---------------------------------------------------------------- 共有 UI

/** アドレスバーのハッシュを現在の設定に合わせる（履歴を汚さないよう replaceState）。 */
function syncHash() {
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    const h = buildHash();
    if (h === lastHash) return;
    lastHash = h;
    try {
      history.replaceState(null, '', '#' + h);
    } catch (e) {
      /* file:// などで失敗しても致命的ではないので無視 */
    }
    if (!$('share-body').hidden) renderShare();
  }, 350);
}

function shareUrl() {
  return location.origin + location.pathname + '#' + buildHash();
}

const QR_PX = 224; // 表示サイズ
const QR_SCALE = 3; // コピー・保存用に 3 倍の解像度で焼く（スライドに貼っても粗くならない）

/** SVG 文字列を PNG の data URL に変換する。 */
function svgToPngDataUrl(svgText, px) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = px;
      cv.height = px;
      const g = cv.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, px, px);
      g.imageSmoothingEnabled = false;
      g.drawImage(im, 0, 0, px, px);
      resolve(cv.toDataURL('image/png'));
    };
    im.onerror = () => reject(new Error('SVG を画像として読めませんでした'));
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  });
}

async function renderShare() {
  const url = shareUrl();
  $('share-url').value = url;
  const host = $('share-qr');
  if (typeof QRCode === 'undefined') {
    host.textContent = 'QR コードを生成できませんでした（ライブラリの読み込み失敗）';
    return;
  }
  // padding はモジュール単位のクワイエットゾーン。QR 規格は 4 モジュール必要で、
  // ここを詰めるとカメラを向けても読めない（2026-09-18 に実機で読めず判明）。
  // 白地・黒でコントラストも最大にしておく。
  const svg = new QRCode({
    content: url,
    padding: 4,
    width: QR_PX,
    height: QR_PX,
    color: '#000000',
    background: '#ffffff',
    ecl: 'M',
    join: true,
  }).svg();

  // インライン SVG だと右クリックでブラウザの画像メニュー（画像をコピー/保存）が
  // 出ないので、PNG に焼いて <img> として置く。
  try {
    const src = await svgToPngDataUrl(svg, QR_PX * QR_SCALE);
    const img = document.createElement('img');
    img.src = src;
    img.width = QR_PX;
    img.height = QR_PX;
    img.alt = 'この設定を開く QR コード';
    img.title = '右クリック（スマホは長押し）でコピー・保存できます';
    host.replaceChildren(img);
  } catch (e) {
    host.innerHTML = svg; // 変換できない環境では SVG をそのまま出す
  }
}

$('share-toggle').addEventListener('click', () => {
  const body = $('share-body');
  body.hidden = !body.hidden;
  // ラベルは「現状QR」のまま。開いているかは aria-expanded と見た目（.btn[aria-expanded]）で示す
  $('share-toggle').setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
  if (!body.hidden) {
    renderShare();
    body.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
});

$('share-copy').addEventListener('click', async () => {
  const url = shareUrl();
  let ok = true;
  try {
    await navigator.clipboard.writeText(url);
  } catch (e) {
    // クリップボード API が使えない環境（http や古いブラウザ）向けの保険
    try {
      const el = $('share-url');
      el.select();
      ok = document.execCommand('copy');
    } catch (e2) {
      ok = false;
    }
  }
  const b = $('share-copy');
  b.textContent = ok ? 'コピーしました' : '選択してコピーしてください';
  window.setTimeout(() => { b.textContent = 'コピー'; }, 1600);
});

// 戻る/進む や URL 直貼りで設定が変わったときに追従する
window.addEventListener('hashchange', () => {
  const h = location.hash.replace(/^#/, '');
  if (!h || h === lastHash) return;
  lastHash = h;
  const prevModel = state.model;
  applyHash(h);
  $('field').value = state.field;
  syncAxisUI();
  for (const k in planeInputs) planeInputs[k].checked = !!state.planes[k];
  phiRange.value = state.phi;
  phiNum.value = String(round(state.phi, 1));
  if (rod) {
    rod.set({
      geom: state.geom, loads: state.loads, field: state.field, sectionT: state.sectionT,
    });
    rod.setProbe(state.probe.r, (state.probe.a * Math.PI) / 180);
  }
  applyVesselProbe();
  if (state.model !== prevModel) setModel(state.model);
  else update();
});

// ---------------------------------------------------------------- 表示

function renderColorbar() {
  const f = fieldByKey(state.field);
  const sc = isVessel() ? vessel : rod;
  const r = sc ? sc.range : { min: 0, max: 1 };
  // 「単純ねじり」で σx を見ているときのように、場が全域 0 だと図が一様になる。
  // 壊れているように見えるので、その旨を書いておく。
  const flat = Math.abs(r.max - r.min) < 5e-3;
  // 薄肉容器は殻全体で一様（色の基準は最大の主応力の大きさ。vessel3d.js の _updateColor）
  const note = flat
    ? '　— この荷重では全域 0'
    : isVessel() && vessel
      // スマホは見出しが 2 行になって図に被るので短く
      ? isCompact() ? `　一定 ${fmt(vessel.value)}` : `　— 殻全体で一定（${fmt(vessel.value)}）`
      : '';
  $('cb-title').textContent = `${fieldLabel(f)}　[MPa]` + note;
  $('cb-bar').style.background = gradientCss(f.diverging);
  $('cb-lo').textContent = fmt(r.min);
  $('cb-mid').textContent = fmt((r.min + r.max) / 2);
  $('cb-hi').textContent = fmt(r.max);
}

function renderProbe(p, sec) {
  const deg = ((p.a * 180) / Math.PI).toFixed(0);
  const where = p.r >= sec.R * 0.995 ? '外周面' : '内部';
  if (isCompact()) {
    $('probe').innerHTML =
      `<b>探触点</b> ${where}　` +
      `r = <span class="val">${p.r.toFixed(1)}</span>/${sec.R.toFixed(1)} mm　` +
      `a = <span class="val">${deg}</span>°　` +
      `x = <span class="val">${p.x.toFixed(0)}</span> mm`;
    return;
  }
  $('probe').innerHTML =
    `<b>探触点</b>（${where}）　` +
    `x = <span class="val">${p.x.toFixed(1)}</span> mm ／ ` +
    `r = <span class="val">${p.r.toFixed(1)}</span> mm（R = ${sec.R.toFixed(1)} mm）／ ` +
    `a = <span class="val">${deg}</span>°　` +
    `<span class="note" style="opacity:.75">(a は断面の上側 +y から測った角度)</span>`;
}

function renderTable(comps, an, phi) {
  const plane = planeByKey(state.plane);
  const pc = planeComps(comps, plane);
  const nm = planeAxisNames(plane);
  const rot = rotated(pc, phi);
  const row = (name, v, note) =>
    `<tr><th>${name}</th><td>${fmt(v)}<span class="u">MPa</span>${note ? `<span class="u">${note}</span>` : ''}</td></tr>`;
  const names = MODEL_TEXT[state.model].table;
  $('stress-table').innerHTML =
    row(names.sx, comps.sx) +
    row(names.sy, comps.sy) +
    row(isPlate() ? 'σz 板厚方向' : 'σr 半径方向', comps.sr) +
    row('τxy せん断', comps.txy) +
    `<tr><th colspan="2" style="padding-top:10px"></th></tr>` +
    row('σ₁ 最大主応力', an.s1) +
    row('σ₂', an.s2) +
    row('σ₃ 最小主応力', an.s3) +
    row('τmax 最大せん断', an.tmax) +
    row('σeq von Mises', an.vm) +
    `<tr><th>主軸の向き θp（${plane.short} 面）</th><td>${((principalAngle(pc) * 180) / Math.PI).toFixed(1)}<span class="u">deg</span></td></tr>` +
    `<tr><th colspan="2" style="padding-top:10px"></th></tr>` +
    row(`σ${nm.A}（φ=${state.phi.toFixed(0)}°）`, rot.sn) +
    row(`τ${nm.A}${nm.B}（φ=${state.phi.toFixed(0)}°）`, rot.tau);
}

function renderVesselProbe() {
  const q = vesselProbeUrl() || { u: 0, v: 0 };
  const val = (v) => `<span class="val">${v.toFixed(0)}</span>`;
  const where =
    state.model === 'cyl'
      ? `軸方向の位置 ${val(q.u)} %（中央 0、端 ±100）／ 周方向の角度 a = ${val(q.v)}°`
      : `緯度 ${val(q.u)}° ／ 経度 ${val(q.v)}°`;
  $('probe').innerHTML =
    `<b>探触点</b>（外表面）　${where}` +
    `　<span class="note" style="opacity:.75">（膜応力は殻のどこでも同じ）</span>`;
}

/** r ≫ t の仮定が怪しいときに注意を出す（式そのものは変えない）。 */
function renderVesselWarn() {
  const ratio = state.vessel.r / state.vessel.t;
  const w = $('vessel-warn');
  w.hidden = ratio >= 10;
  if (!w.hidden) {
    w.textContent =
      `r / t = ${ratio.toFixed(1)} と肉厚が厚く、薄肉の仮定（r ≫ t、目安は r / t ≥ 10）が成り立ちにくい範囲です。` +
      '値は薄肉の式のまま出しています。';
  }
}

/**
 * ひずみ [×10⁻⁶] の表示（3 桁以上は整数、それ未満は小数 1 桁）。
 * RodScene の生成中に update() から呼ばれるので、const ではなく関数宣言にしておく（巻き上げのため）。
 */
function mu(v) {
  return Math.abs(v) < 0.05 ? '0' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

function renderPlateProbe(phi) {
  const { e, s, mat } = state.plate;
  const val = (v) => `<span class="val">${mu(v)}</span>`;
  const ez = thicknessStrain(s, mat);
  const rot = state.plane === 'xy'
    ? `　／ ε<sub>X</sub>（φ = ${state.phi.toFixed(0)}°） = ${val(strainAlong(e, phi))}`
    : '';
  if (isCompact()) {
    $('probe').innerHTML =
      `<b>ゲージ</b> εx ${val(e.ex)}　εp ${val(ep45())}　εy ${val(e.ey)}　γxy ${val(e.gxy)}` +
      (rot ? `　εX ${val(strainAlong(e, phi))}` : '') + `　[×10⁻⁶]`;
    return;
  }
  $('probe').innerHTML =
    `<b>ゲージの読み</b>　εx = ${val(e.ex)} ／ εp（45°） = ${val(ep45())} ／ εy = ${val(e.ey)}` +
    `　→　γxy = 2εp − (εx + εy) = ${val(e.gxy)}${rot}` +
    `　／ 板厚方向 εz = ${val(ez)}　<span class="note" style="opacity:.75">[×10⁻⁶]</span>`;
}

/** 微小平板の「現在の値」。与えている側から、もう一方を計算する式を数値入りで書く。 */
function renderPlateCurrent() {
  const { e, s, mat, mode } = state.plate;
  const G = shearModulus(mat);
  const r = (v, d = 3) => String(round(v, d));
  const par = (t) => (t.startsWith('-') ? `(${t})` : t); // 負の数はかっこでくくる
  const E3 = `${r(mat.E, 1)}\\times10^{3}`;
  const G3 = `${r(G, 1)}\\times10^{3}`;
  const U = '\\ \\mathrm{MPa}';
  const M6 = '\\times10^{-6}';
  const ez = thicknessStrain(s, mat);
  const ezLine =
    `\\varepsilon_z&=-\\frac{\\nu}{E}(\\sigma_x+\\sigma_y)=-\\frac{${r(mat.nu)}}{${E3}}\\times\\{${fmt(s.sx)}+${par(fmt(s.sy))}\\}=${mu(ez)}${M6}`;
  const gLine = `G&=\\frac{E}{2(1+\\nu)}=\\frac{${E3}}{2(1+${r(mat.nu)})}=${G3}${U}\\\\[2pt]`;
  let tex;
  if (mode === 'e') {
    const coef = `\\frac{${E3}}{1-${r(mat.nu)}^2}`;
    tex =
      `\\begin{aligned}` + gLine +
      `\\gamma_{xy}&=2\\varepsilon_p-(\\varepsilon_x+\\varepsilon_y)=\\{2\\times${par(mu(ep45()))}-(${mu(e.ex)}+${par(mu(e.ey))})\\}${M6}=${mu(e.gxy)}${M6}\\\\[2pt]` +
      `\\sigma_x&=\\frac{E}{1-\\nu^2}(\\varepsilon_x+\\nu\\varepsilon_y)=${coef}\\times\\{${mu(e.ex)}+${r(mat.nu)}\\times${par(mu(e.ey))}\\}${M6}=${fmt(s.sx)}${U}\\\\[2pt]` +
      `\\sigma_y&=\\frac{E}{1-\\nu^2}(\\varepsilon_y+\\nu\\varepsilon_x)=${coef}\\times\\{${mu(e.ey)}+${r(mat.nu)}\\times${par(mu(e.ex))}\\}${M6}=${fmt(s.sy)}${U}\\\\[2pt]` +
      `\\tau_{xy}&=G\\gamma_{xy}=${G3}\\times${par(mu(e.gxy))}${M6}=${fmt(s.txy)}${U}\\\\[2pt]` +
      ezLine +
      `\\end{aligned}`;
  } else {
    tex =
      `\\begin{aligned}` + gLine +
      `\\varepsilon_x&=\\frac{\\sigma_x-\\nu\\sigma_y}{E}=\\frac{${fmt(s.sx)}-${r(mat.nu)}\\times${par(fmt(s.sy))}}{${E3}}=${mu(e.ex)}${M6}\\\\[2pt]` +
      `\\varepsilon_y&=\\frac{\\sigma_y-\\nu\\sigma_x}{E}=\\frac{${fmt(s.sy)}-${r(mat.nu)}\\times${par(fmt(s.sx))}}{${E3}}=${mu(e.ey)}${M6}\\\\[2pt]` +
      `\\gamma_{xy}&=\\frac{\\tau_{xy}}{G}=\\frac{${fmt(s.txy)}}{${G3}}=${mu(e.gxy)}${M6}\\\\[2pt]` +
      `\\varepsilon_p&=\\frac{\\varepsilon_x+\\varepsilon_y+\\gamma_{xy}}{2}=${mu(ep45())}${M6}\\quad\\text{（45° のゲージの読み）}\\\\[2pt]` +
      ezLine +
      `\\end{aligned}`;
  }
  katexInto('f-current', tex);
}

// ---------------------------------------------------------------- 数式

function katexInto(id, tex) {
  const el = $(id);
  if (!el) return;
  if (typeof katex === 'undefined') {
    el.textContent = tex;
    return;
  }
  katex.render(tex, el, { displayMode: true, throwOnError: false });
}

function renderCurrent(sec, p, comps) {
  const hb = p.r * Math.cos(p.a); // 中立軸からの高さ r cos a
  const n = (v, d = 0) => v.toFixed(d);
  const tex =
    `\\begin{aligned}` +
    `\\sigma_x&=\\frac{${n(state.loads.N * 1000)}}{${n(sec.A, 1)}}` +
    `-\\frac{${n(state.loads.M * 1000)}\\times ${n(hb, 1)}}{${n(sec.I, 0)}}` +
    `=${fmt(comps.sx)}\\ \\mathrm{MPa}\\\\[2pt]` +
    `\\tau_{xy}&=\\frac{${n(state.loads.T * 1000)}\\times ${n(p.r, 1)}}{${n(sec.Ip, 0)}}` +
    `=${fmt(comps.txy)}\\ \\mathrm{MPa}` +
    `\\end{aligned}`;
  katexInto('f-current', tex);
}

function renderVesselCurrent(comps, an) {
  const { p, r, t } = state.vessel;
  const n = (v) => String(round(v, 2));
  const half = `\\frac{pr}{2t}=\\frac{${n(p)}\\times ${n(r)}}{2\\times ${n(t)}}=${fmt(comps.sx)}`;
  const full = `\\frac{pr}{t}=\\frac{${n(p)}\\times ${n(r)}}{${n(t)}}=${fmt(comps.sy)}`;
  const U = '\\ \\mathrm{MPa}';
  const tex =
    state.model === 'sph'
      ? `\\begin{aligned}\\sigma_x&=\\sigma_y=${half}${U}\\\\[2pt]` +
        `\\sigma_1&=\\sigma_2=${fmt(an.s1)}${U},\\quad \\sigma_3=${fmt(an.s3)}${U},\\quad \\tau_{\\max}=${fmt(an.tmax)}${U}\\end{aligned}`
      : `\\begin{aligned}\\sigma_x&=${half}${U}\\\\[2pt]\\sigma_y&=${full}${U}\\\\[2pt]` +
        `\\sigma_1&=${fmt(an.s1)}${U},\\quad \\sigma_2=${fmt(an.s2)}${U},\\quad \\sigma_3=${fmt(an.s3)}${U},\\quad \\tau_{\\max}=${fmt(an.tmax)}${U}\\end{aligned}`;
  katexInto('f-current', tex);
}

/** 薄肉容器の式（対象を切り替えたときだけ描き直す）。 */
function renderModelFormulas() {
  if (state.model === 'sph') {
    $('v-eq-cap').textContent = '球殻を中心を通る面で半分に切ったときの力のつり合い（内半径 r、肉厚 t、内圧 p、r ≫ t）';
    katexInto('f-v-eq', `\\sigma_\\theta\\cdot 2\\pi r t=p\\cdot\\pi r^{2}\\quad\\Longrightarrow\\quad \\sigma_\\theta=\\sigma_\\phi=\\frac{pr}{2t}`);
    $('v-stress-cap').textContent = '局所座標（x = 経線方向 φ、y = 周方向 θ、r = 半径方向）での応力成分と主応力';
    katexInto(
      'f-v-stress',
      `\\begin{aligned}&\\sigma_x=\\sigma_\\phi=\\frac{pr}{2t},\\quad \\sigma_y=\\sigma_\\theta=\\frac{pr}{2t},\\quad \\tau_{xy}=0,\\quad \\sigma_r\\approx 0\\\\[2pt]` +
        `&\\sigma_1=\\sigma_2=\\frac{pr}{2t},\\quad \\sigma_3=0,\\quad \\tau_{\\max}=\\frac{\\sigma_1-\\sigma_3}{2}=\\frac{pr}{4t}\\end{aligned}`
    );
    $('v-note').innerHTML =
      '球殻の表面（x–y 面）では、どの向きに回しても同じ大きさの垂直応力しか生じず、x–y 面の応力円は<b>点</b>になります' +
      '（面内の最大せん断応力は 0）。半径方向（<span class="tex" data-tex="\\sigma_r = 0"></span>）を含めた 3 つの円で見ると、' +
      'y′–r 面・r–x′ 面の円の半径 <span class="tex" data-tex="\\dfrac{pr}{4t}"></span> が最大せん断応力になります' +
      '（σx = σy なので主方向は決まらず、x′ = x、y′ = y としています）。';
  } else if (state.model === 'cyl') {
    $('v-eq-cap').textContent = '円筒殻の力のつり合い（内半径 r、肉厚 t、内圧 p、容器の長さ h、r ≫ t）';
    katexInto(
      'f-v-eq',
      `\\begin{aligned}\\sigma_z\\cdot 2\\pi r t&=p\\cdot\\pi r^{2}&&\\Longrightarrow\\quad \\sigma_z=\\frac{pr}{2t}\\\\[2pt]` +
        `\\sigma_\\theta\\cdot 2th&=p\\cdot 2rh&&\\Longrightarrow\\quad \\sigma_\\theta=\\frac{pr}{t}\\end{aligned}`
    );
    $('v-stress-cap').textContent = '局所座標（x = 軸方向 z、y = 周方向 θ、r = 半径方向）での応力成分と主応力';
    katexInto(
      'f-v-stress',
      `\\begin{aligned}&\\sigma_x=\\sigma_z=\\frac{pr}{2t},\\quad \\sigma_y=\\sigma_\\theta=\\frac{pr}{t},\\quad \\tau_{xy}=0,\\quad \\sigma_r\\approx 0\\\\[2pt]` +
        `&\\sigma_1=\\frac{pr}{t},\\quad \\sigma_2=\\frac{pr}{2t},\\quad \\sigma_3=0\\\\[2pt]` +
        `&\\text{x–y 面内の最大せん断応力 }\\frac{\\sigma_1-\\sigma_2}{2}=\\frac{pr}{4t},\\qquad \\tau_{\\max}=\\frac{\\sigma_1-\\sigma_3}{2}=\\frac{pr}{2t}\\end{aligned}`
    );
    $('v-note').innerHTML =
      '円筒殻は周方向の応力が軸方向の 2 倍なので、x–y 面（z–θ 面）の応力円は直径をもちます。' +
      'ただし <span class="tex" data-tex="\\sigma_1"></span>、<span class="tex" data-tex="\\sigma_2"></span> が同じ符号なので、' +
      '奥行き方向（<span class="tex" data-tex="\\sigma_r = 0"></span>）を考えた r–x′ 面（x′ = 周方向 θ なので r–θ 面）の円がいちばん大きく、' +
      '最大せん断応力は <span class="tex" data-tex="\\tau_{\\max} = \\dfrac{pr}{2t}"></span> になります。';
  } else {
    return;
  }
  renderTexSpans($('v-note'));
}

function renderStaticFormulas() {
  katexInto(
    'f-p-hooke',
    `\\varepsilon_x=\\frac{\\sigma_x-\\nu\\sigma_y}{E},\\qquad ` +
      `\\varepsilon_y=\\frac{\\sigma_y-\\nu\\sigma_x}{E},\\qquad ` +
      `\\gamma_{xy}=\\frac{\\tau_{xy}}{G},\\qquad G=\\frac{E}{2(1+\\nu)},\\qquad ` +
      `\\varepsilon_z=-\\frac{\\nu}{E}(\\sigma_x+\\sigma_y)`
  );
  katexInto(
    'f-p-inv',
    `\\sigma_x=\\frac{E}{1-\\nu^{2}}(\\varepsilon_x+\\nu\\varepsilon_y),\\qquad ` +
      `\\sigma_y=\\frac{E}{1-\\nu^{2}}(\\varepsilon_y+\\nu\\varepsilon_x),\\qquad ` +
      `\\tau_{xy}=G\\gamma_{xy}`
  );
  katexInto(
    'f-p-rosette',
    `\\begin{aligned}` +
      `\\varepsilon(\\phi)&=\\frac{\\varepsilon_x+\\varepsilon_y}{2}+\\frac{\\varepsilon_x-\\varepsilon_y}{2}\\cos 2\\phi+\\frac{\\gamma_{xy}}{2}\\sin 2\\phi\\\\[2pt]` +
      `\\phi=45^\\circ:\\ \\varepsilon_p&=\\frac{\\varepsilon_x+\\varepsilon_y}{2}+\\frac{\\gamma_{xy}}{2}` +
      `\\quad\\Longrightarrow\\quad \\gamma_{xy}=2\\varepsilon_p-(\\varepsilon_x+\\varepsilon_y)` +
      `\\end{aligned}`
  );
  katexInto('f-section', `A=\\frac{\\pi d^{2}}{4},\\qquad I=\\frac{\\pi d^{4}}{64},\\qquad I_p=\\frac{\\pi d^{4}}{32}`);
  katexInto(
    'f-stress',
    `\\sigma_x=\\frac{P}{A}-\\frac{M\\,r\\cos a}{I},\\qquad ` +
      `\\tau_{xy}=\\frac{T\\,r}{I_p},\\qquad \\sigma_y=\\sigma_r=0`
  );
  katexInto(
    'f-rot',
    `\\begin{aligned}` +
      `\\sigma(\\phi)&=\\frac{\\sigma_x+\\sigma_y}{2}` +
      `+\\frac{\\sigma_x-\\sigma_y}{2}\\cos 2\\phi+\\tau_{xy}\\sin 2\\phi\\\\[2pt]` +
      `\\tau(\\phi)&=-\\frac{\\sigma_x-\\sigma_y}{2}\\sin 2\\phi+\\tau_{xy}\\cos 2\\phi\\\\[2pt]` +
      `\\sigma_{1,2}&=\\frac{\\sigma_x+\\sigma_y}{2}\\pm\\sqrt{\\left(\\frac{\\sigma_x-\\sigma_y}{2}\\right)^{2}+\\tau_{xy}^{2}}` +
      `\\end{aligned}`
  );
}

// ブラウザの console からの調査用（荷重や探触点の現在値を触れるようにしておく）。
window.__mohr = { state, get rod() { return rod; }, get vessel() { return vessel; }, update };

// ---------------------------------------------------------------- 起動

/** 地の文・ラベル中の [data-tex] を KaTeX で描く（記号の形を数式カードと揃えるため）。 */
function renderTexSpans(root = document) {
  if (typeof katex === 'undefined') return;
  for (const el of root.querySelectorAll('.tex[data-tex]')) {
    katex.render(el.dataset.tex, el, { throwOnError: false, displayMode: false });
  }
}

function boot() {
  syncAxisUI();
  // φ の入力欄は HTML に value="0" が入っているので、URL から復元した値を反映させる
  phiRange.value = state.phi;
  phiNum.value = String(round(state.phi, 1));
  renderTexSpans();
  renderStaticFormulas();
  setModel(state.model); // 中で update() する
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
