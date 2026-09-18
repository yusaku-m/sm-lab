// mohr/ 単元のエントリポイント。
// UI の状態を持ち、3D 表示（rod3d.js）とモールの応力円（mohr2d.js）へ配る。
// 計算はすべて stress.js の閉じた式（Pyodide は使わない）。

import { RodScene } from './rod3d.js';
import { renderCircles, renderElement, PLANES } from './mohr2d.js';
import {
  FIELDS, fieldByKey, sectionProps, stressAt, analyze, rotated,
  principalAngle, gradientCss, fmt,
} from './stress.js';

const RANGES = { N: 120, M: 600, T: 600 };

const state = {
  loads: { N: 40, M: 260, T: 300 },
  geom: { d: 50, L: 250 },
  field: 'sx',
  planes: { xy: true, yz: false, zx: false },
  phi: 0, // deg
  sectionT: 0.3,
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- 入力行

const LOAD_SPEC = [
  { key: 'N', sym: 'N', name: '軸力（引張が正）', unit: 'kN', min: -RANGES.N, max: RANGES.N, step: 1 },
  { key: 'M', sym: 'M', name: '曲げモーメント（両端）', unit: 'N·m', min: -RANGES.M, max: RANGES.M, step: 5 },
  { key: 'T', sym: 'T', name: 'ねじりモーメント', unit: 'N·m', min: -RANGES.T, max: RANGES.T, step: 5 },
];

const GEOM_SPEC = [
  { key: 'd', sym: 'd', name: '直径', unit: 'mm', min: 10, max: 120, step: 1 },
  { key: 'L', sym: 'L', name: '長さ', unit: 'mm', min: 120, max: 800, step: 10 },
  { key: 'sec', sym: 'x', name: '輪切りの位置', unit: '% of L', min: 4, max: 88, step: 1 },
];

function makeRow(spec, get, set) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.innerHTML =
    `<div class="field-head">` +
    `<span class="name"><em>${spec.sym}</em>${spec.name}</span>` +
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

// ---------------------------------------------------------------- コンター選択

for (const f of FIELDS) {
  const o = document.createElement('option');
  o.value = f.key;
  o.textContent = f.label;
  $('field').appendChild(o);
}
$('field').value = state.field;
$('field').addEventListener('change', () => {
  state.field = $('field').value;
  update();
});

// ---------------------------------------------------------------- 平面チェック

for (const p of PLANES) {
  const lab = document.createElement('label');
  lab.className = 'check';
  lab.innerHTML =
    `<input type="checkbox"${state.planes[p.key] ? ' checked' : ''}>` +
    `<span class="swatch" style="background:${p.color}"></span><span>${p.label}</span>`;
  lab.querySelector('input').addEventListener('change', (e) => {
    state.planes[p.key] = e.target.checked;
    update();
  });
  $('plane-checks').appendChild(lab);
}

// ---------------------------------------------------------------- φ

const phiRange = $('phi');
const phiNum = $('phi-num');
function setPhi(deg) {
  state.phi = Math.min(90, Math.max(-90, deg));
  phiRange.value = state.phi;
  phiNum.value = String(Math.round(state.phi * 10) / 10);
  update();
}
phiRange.addEventListener('input', () => setPhi(parseFloat(phiRange.value)));
phiNum.addEventListener('input', () => {
  const v = parseFloat(phiNum.value);
  if (Number.isFinite(v)) {
    state.phi = Math.min(90, Math.max(-90, v));
    phiRange.value = state.phi;
    update();
  }
});
$('phi-zero').addEventListener('click', () => setPhi(0));
$('phi-principal').addEventListener('click', () => setPhi(wrap90((currentComps().thetaP * 180) / Math.PI)));
$('phi-tmax').addEventListener('click', () => setPhi(wrap90((currentComps().thetaP * 180) / Math.PI + 45)));

function wrap90(deg) {
  let d = deg;
  while (d > 90) d -= 180;
  while (d < -90) d += 180;
  return d;
}

// update() は関数宣言なので巻き上げられるが、let は巻き上がらない。
// RodScene の生成中に onPick → update() が走るため、ここで先に宣言しておく。
let updating = false;

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
  rod.set({ geom: state.geom, loads: state.loads, field: state.field, sectionT: state.sectionT });
  rod.fitCamera(true);
  rod.setProbe(state.geom.d / 2, 0); // 既定は断面の上端（曲げ引張側の表面）
  $('hint').innerHTML = 'ドラッグ: <b>棒の上</b>＝探触点 ／ <b>背景</b>＝視点回転 ／ <b>矢印・円弧</b>＝荷重 ／ <b>黒いリング</b>＝断面位置';
} catch (e) {
  $('err').hidden = false;
  $('err').textContent =
    'WebGL を初期化できませんでした（3D 表示のみ利用できません）。\n' + (e && e.message ? e.message : e);
  $('hint').textContent = '3D 表示を利用できません';
}

$('reset-view').addEventListener('click', () => rod && rod.resetView());

// ---------------------------------------------------------------- 更新

function currentProbe() {
  const sec = sectionProps(state.geom.d);
  if (rod && rod.probe) return rod.probe;
  return { x: 0, r: sec.R, a: 0, onSurface: true };
}

function currentComps() {
  const sec = sectionProps(state.geom.d);
  const p = currentProbe();
  const c = stressAt(state.loads, sec, p.r, p.a, p.x);
  c.thetaP = principalAngle(c);
  return c;
}

function update(opts = {}) {
  if (updating) return;
  updating = true;
  try {
    if (rod && !opts.fromScene) {
      rod.set({
        geom: state.geom,
        loads: state.loads,
        field: state.field,
        sectionT: state.sectionT,
      });
    }
    for (const r of rows) r.sync();

    const sec = sectionProps(state.geom.d);
    const p = currentProbe();
    const comps = stressAt(state.loads, sec, p.r, p.a, p.x);
    const an = analyze(comps);
    const phi = (state.phi * Math.PI) / 180;

    renderCircles($('mohr-plot'), comps, an, state.planes, phi);
    renderElement($('element-plot'), comps, an, phi);
    renderTable(comps, an, phi);
    renderColorbar();
    renderProbe(p, sec);
    renderCurrent(sec, p, comps);
  } finally {
    updating = false;
  }
}

// ---------------------------------------------------------------- 表示

function renderColorbar() {
  const f = fieldByKey(state.field);
  $('cb-title').textContent = `${f.label}　[MPa]`;
  $('cb-bar').style.background = gradientCss(f.diverging);
  const r = rod ? rod.range : { min: 0, max: 1 };
  $('cb-lo').textContent = fmt(r.min);
  $('cb-mid').textContent = fmt((r.min + r.max) / 2);
  $('cb-hi').textContent = fmt(r.max);
}

function renderProbe(p, sec) {
  const deg = ((p.a * 180) / Math.PI).toFixed(0);
  const where = p.r >= sec.R * 0.995 ? '外周面' : '内部';
  $('probe').innerHTML =
    `<b>探触点</b>（${where}）　` +
    `x = <span class="val">${p.x.toFixed(1)}</span> mm ／ ` +
    `r = <span class="val">${p.r.toFixed(1)}</span> mm（R = ${sec.R.toFixed(1)} mm）／ ` +
    `a = <span class="val">${deg}</span>°　` +
    `<span style="opacity:.75">(a は曲げの引張側 +y から測った角度。y = r cos a)</span>`;
}

function renderTable(comps, an, phi) {
  const rot = rotated(comps, phi);
  const row = (name, v, note) =>
    `<tr><th>${name}</th><td>${fmt(v)}<span class="u">MPa</span>${note ? `<span class="u">${note}</span>` : ''}</td></tr>`;
  $('stress-table').innerHTML =
    row('σx 軸方向', comps.sx) +
    row('σθ 周方向', comps.sy) +
    row('σr 半径方向', comps.sz) +
    row('τxθ せん断', comps.txy) +
    `<tr><th colspan="2" style="padding-top:10px"></th></tr>` +
    row('σ₁ 最大主応力', an.s1) +
    row('σ₂', an.s2) +
    row('σ₃ 最小主応力', an.s3) +
    row('τmax 最大せん断', an.tmax) +
    row('σeq von Mises', an.vm) +
    `<tr><th>主軸の向き θp</th><td>${((principalAngle(comps) * 180) / Math.PI).toFixed(1)}<span class="u">deg</span></td></tr>` +
    `<tr><th colspan="2" style="padding-top:10px"></th></tr>` +
    row(`σ(φ=${state.phi.toFixed(0)}°)`, rot.sn) +
    row(`τ(φ=${state.phi.toFixed(0)}°)`, rot.tau);
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
  const y = p.r * Math.cos(p.a);
  const n = (v, d = 0) => v.toFixed(d);
  const tex =
    `\\begin{aligned}` +
    `\\sigma_x&=\\frac{${n(state.loads.N * 1000)}}{${n(sec.A, 1)}}` +
    `+\\frac{${n(state.loads.M * 1000)}\\times ${n(y, 1)}}{${n(sec.I, 0)}}` +
    `=${fmt(comps.sx)}\\ \\mathrm{MPa}\\\\[2pt]` +
    `\\tau_{x\\theta}&=\\frac{${n(state.loads.T * 1000)}\\times ${n(p.r, 1)}}{${n(sec.Ip, 0)}}` +
    `=${fmt(comps.txy)}\\ \\mathrm{MPa}` +
    `\\end{aligned}`;
  katexInto('f-current', tex);
}

function renderStaticFormulas() {
  katexInto('f-section', `A=\\frac{\\pi d^{2}}{4},\\qquad I=\\frac{\\pi d^{4}}{64},\\qquad I_p=\\frac{\\pi d^{4}}{32}`);
  katexInto(
    'f-stress',
    `\\sigma_x=\\frac{N}{A}+\\frac{M\\,y}{I},\\qquad ` +
      `\\tau_{x\\theta}=\\frac{T\\,r}{I_p},\\qquad \\sigma_\\theta=\\sigma_r=0`
  );
  katexInto(
    'f-rot',
    `\\begin{aligned}` +
      `\\sigma(\\phi)&=\\frac{\\sigma_x+\\sigma_\\theta}{2}` +
      `+\\frac{\\sigma_x-\\sigma_\\theta}{2}\\cos 2\\phi+\\tau_{x\\theta}\\sin 2\\phi\\\\[2pt]` +
      `\\tau(\\phi)&=-\\frac{\\sigma_x-\\sigma_\\theta}{2}\\sin 2\\phi+\\tau_{x\\theta}\\cos 2\\phi\\\\[2pt]` +
      `\\sigma_{1,2}&=\\frac{\\sigma_x+\\sigma_\\theta}{2}\\pm\\sqrt{\\left(\\frac{\\sigma_x-\\sigma_\\theta}{2}\\right)^{2}+\\tau_{x\\theta}^{2}}` +
      `\\end{aligned}`
  );
}

// ブラウザの console からの調査用（荷重や探触点の現在値を触れるようにしておく）。
window.__mohr = { state, get rod() { return rod; }, update };

// ---------------------------------------------------------------- 起動

function boot() {
  renderStaticFormulas();
  update();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
