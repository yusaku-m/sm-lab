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
  planes: { xy: true, yr: false, rx: false },
  phi: 0, // deg
  sectionT: 0.3,
  probe: { r: 25, a: 0 }, // 探触点（r [mm], a [deg]）。初期値は setGeomDefaults で直径に合わせる
};

// ---------------------------------------------------------------- URL 状態

// 設定は URL のハッシュに載せる（例 #n=40&m=260&t=300&d=50&l=250&s=30&f=sx&p=xy&q=0&pr=25&pa=0）。
// サーバー不要でそのまま共有・QR化できるので、クエリではなくハッシュを使う。
const PLANE_KEYS = PLANES.map((p) => p.key);

function buildHash() {
  const q = new URLSearchParams();
  q.set('n', String(round(state.loads.N, 1)));
  q.set('m', String(round(state.loads.M, 1)));
  q.set('t', String(round(state.loads.T, 1)));
  q.set('d', String(round(state.geom.d, 1)));
  q.set('l', String(round(state.geom.L, 1)));
  q.set('s', String(round(state.sectionT * 100, 1)));
  q.set('f', state.field);
  q.set('p', PLANE_KEYS.filter((k) => state.planes[k]).join('.') || '-');
  q.set('q', String(round(state.phi, 1)));
  const pr = rod && rod.probe ? rod.probe.r : state.probe.r;
  const pa = rod && rod.probe ? (rod.probe.a * 180) / Math.PI : state.probe.a;
  q.set('pr', String(round(pr, 1)));
  q.set('pa', String(round(pa, 1)));
  return q.toString();
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
  state.loads.N = num('n', -RANGES.N, RANGES.N, state.loads.N);
  state.loads.M = num('m', -RANGES.M, RANGES.M, state.loads.M);
  state.loads.T = num('t', -RANGES.T, RANGES.T, state.loads.T);
  state.geom.d = num('d', 10, 120, state.geom.d);
  state.geom.L = num('l', 120, 800, state.geom.L);
  state.sectionT = num('s', 4, 88, state.sectionT * 100) / 100;
  state.phi = num('q', -90, 90, state.phi);
  if (q.has('f') && FIELDS.some((f) => f.key === q.get('f'))) state.field = q.get('f');
  if (q.has('p')) {
    const on = q.get('p').split('.');
    for (const k of PLANE_KEYS) state.planes[k] = on.includes(k);
  }
  state.probe.r = num('pr', 0, state.geom.d / 2, state.geom.d / 2);
  state.probe.a = num('pa', -360, 360, state.probe.a);
  return true;
}

const restored = applyHash(location.hash.replace(/^#/, ''));
if (!restored) state.probe.r = state.geom.d / 2;

const $ = (id) => document.getElementById(id);

// スマホ表示（style.css の @media (max-width: 760px) と同じ境界）
const compactMq = window.matchMedia('(max-width: 760px)');
const isCompact = () => compactMq.matches;
compactMq.addEventListener('change', () => {
  if (rod) {
    rod.fitMargin = isCompact() ? 1.26 : 1.06;
    rod.resetView();
  }
  update();
});

// ---------------------------------------------------------------- 入力行

const LOAD_SPEC = [
  { key: 'N', tex: 'N', name: '軸力（引張が正）', unit: 'kN', min: -RANGES.N, max: RANGES.N, step: 1 },
  { key: 'M', tex: 'M', name: '曲げモーメント（両端）', unit: 'N·m', min: -RANGES.M, max: RANGES.M, step: 5 },
  { key: 'T', tex: 'T', name: 'ねじりモーメント', unit: 'N·m', min: -RANGES.T, max: RANGES.T, step: 5 },
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
// RodScene の生成直後に setProbe → onPick → update() が走るため、
// update() が触る変数はすべてここで先に宣言しておく
// （順序を戻すと "Cannot access 'X' before initialization" になる）。
let updating = false;
let hashTimer = 0;
let lastHash = '';

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
  $('hint').innerHTML =
    'ドラッグ: <b>棒</b>＝探触点 ／ <b>背景</b>＝視点回転' +
    '<span class="hint-more"> ／ <b>矢印・円弧</b>＝荷重 ／ <b>黒いリング</b>＝断面位置</span>';
}

$('reset-view').addEventListener('click', () => rod && rod.resetView());

// 3つのモールの円のうち一番大きいもの（直径 σ1-σ3 = 2τmax）が最大になる点を探して探触点にする。
// σx = kN + kM·r·cos a, τ = kT·r という素直な形なので最大は必ず r = R・a = 0 か π に来るが、
// 将来 x 方向に変化する応力を入れても壊れないよう、素朴に走査して選ぶ（数万回程度で一瞬）。
function maxCirclePoint() {
  const sec = sectionProps(state.geom.d);
  let best = { v: -Infinity, r: sec.R, a: 0 };
  for (let i = 0; i <= 24; i++) {
    const r = (i / 24) * sec.R;
    for (let j = 0; j < 360; j++) {
      const a = (j / 360) * Math.PI * 2;
      const an = analyze(stressAt(state.loads, sec, r, a, 0));
      const v = an.s1 - an.s3;
      if (v > best.v + 1e-9) best = { v, r, a };
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

    renderCircles($('mohr-plot'), comps, an, state.planes, phi, {
      fontScale: isCompact() ? 1.45 : 1,
    });
    renderElement($('element-plot'), comps, an, phi, {
      fontScale: isCompact() ? 2.1 : 1,
    });
    renderTable(comps, an, phi);
    renderColorbar();
    renderProbe(p, sec);
    renderCurrent(sec, p, comps);
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

function renderShare() {
  const url = shareUrl();
  $('share-url').value = url;
  const host = $('share-qr');
  if (typeof QRCode === 'undefined') {
    host.textContent = 'QR コードを生成できませんでした（ライブラリの読み込み失敗）';
    return;
  }
  host.innerHTML = new QRCode({
    content: url,
    padding: 1,
    width: 164,
    height: 164,
    color: '#1d2932',
    background: '#fffdf7',
    ecl: 'M',
    join: true,
  }).svg();
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
  applyHash(h);
  $('field').value = state.field;
  for (const k in planeInputs) planeInputs[k].checked = !!state.planes[k];
  phiRange.value = state.phi;
  phiNum.value = String(round(state.phi, 1));
  if (rod) {
    rod.set({
      geom: state.geom, loads: state.loads, field: state.field, sectionT: state.sectionT,
    });
    rod.setProbe(state.probe.r, (state.probe.a * Math.PI) / 180);
  }
  update();
});

// ---------------------------------------------------------------- 表示

function renderColorbar() {
  const f = fieldByKey(state.field);
  const r = rod ? rod.range : { min: 0, max: 1 };
  // 「単純ねじり」で σx を見ているときのように、場が全域 0 だと図が一様になる。
  // 壊れているように見えるので、その旨を書いておく。
  const flat = Math.abs(r.max - r.min) < 5e-3;
  $('cb-title').textContent = `${f.label}　[MPa]` + (flat ? '　— この荷重では全域 0' : '');
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
    `<span class="note" style="opacity:.75">(a は曲げの引張側から測った角度)</span>`;
}

function renderTable(comps, an, phi) {
  const rot = rotated(comps, phi);
  const row = (name, v, note) =>
    `<tr><th>${name}</th><td>${fmt(v)}<span class="u">MPa</span>${note ? `<span class="u">${note}</span>` : ''}</td></tr>`;
  $('stress-table').innerHTML =
    row('σx 軸方向', comps.sx) +
    row('σy 周方向', comps.sy) +
    row('σr 半径方向', comps.sr) +
    row('τxy せん断', comps.txy) +
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
  const hb = p.r * Math.cos(p.a); // 中立軸からの高さ r cos a
  const n = (v, d = 0) => v.toFixed(d);
  const tex =
    `\\begin{aligned}` +
    `\\sigma_x&=\\frac{${n(state.loads.N * 1000)}}{${n(sec.A, 1)}}` +
    `+\\frac{${n(state.loads.M * 1000)}\\times ${n(hb, 1)}}{${n(sec.I, 0)}}` +
    `=${fmt(comps.sx)}\\ \\mathrm{MPa}\\\\[2pt]` +
    `\\tau_{xy}&=\\frac{${n(state.loads.T * 1000)}\\times ${n(p.r, 1)}}{${n(sec.Ip, 0)}}` +
    `=${fmt(comps.txy)}\\ \\mathrm{MPa}` +
    `\\end{aligned}`;
  katexInto('f-current', tex);
}

function renderStaticFormulas() {
  katexInto('f-section', `A=\\frac{\\pi d^{2}}{4},\\qquad I=\\frac{\\pi d^{4}}{64},\\qquad I_p=\\frac{\\pi d^{4}}{32}`);
  katexInto(
    'f-stress',
    `\\sigma_x=\\frac{N}{A}+\\frac{M\\,r\\cos a}{I},\\qquad ` +
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
window.__mohr = { state, get rod() { return rod; }, update };

// ---------------------------------------------------------------- 起動

/** 地の文・ラベル中の [data-tex] を KaTeX で描く（記号の形を数式カードと揃えるため）。 */
function renderTexSpans() {
  if (typeof katex === 'undefined') return;
  for (const el of document.querySelectorAll('.tex[data-tex]')) {
    katex.render(el.dataset.tex, el, { throwOnError: false, displayMode: false });
  }
}

function boot() {
  // φ の入力欄は HTML に value="0" が入っているので、URL から復元した値を反映させる
  phiRange.value = state.phi;
  phiNum.value = String(round(state.phi, 1));
  renderTexSpans();
  renderStaticFormulas();
  update();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
