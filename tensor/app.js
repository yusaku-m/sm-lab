// 応力テンソルと座標変換（弾性力学テキスト 演習 1.2）。状態・UI・描画・式の組み立て。
import * as Mdl from './model.js';
import { Camera, Panel, COLORS, circle, add, sc } from './view3d.js';

const DEF_MAG = { P: 10, T: 50, M: 50, F: 1 };
const UNIT = { P: 'kN', T: 'N·m', M: 'N·m', F: 'kN' };
const DIRS = {
  P: ['引張', '圧縮'],
  T: ['+x まわり', '−x まわり'],
  M: ['+z まわり', '−z まわり'],
  F: ['−y 向き', '+y 向き'],
};
const LOAD_NAME = { P: '軸荷重', T: 'ねじり', M: '曲げ', F: '横荷重' };
const LOAD_COLOR = { P: COLORS.load, T: COLORS.moment, M: COLORS.moment, F: COLORS.load };

// ---------------------------------------------------------------- 状態
const zeroCustom = () => Object.fromEntries(Mdl.COMP.map((c) => [c, 0]));
// 演習 1.2 の各問は専用の選択肢を持たず、URL ハッシュ（ld/pt/c/th など）だけで再現する。
// 既定（ハッシュが空）は曲げ M による点 (L/2, D/2, 0)。ハッシュで省略したキーはここへ戻す。
const defaultState = () => ({
  mode: 'load',
  tn: 's', // 's' = 応力、'e' = ひずみ（演習 1.4。フックの法則で σ ↔ ε）
  mat: { E: 206, nu: 0.3 }, // E [GPa]

  geom: { D: 20, L: 200 },
  loads: Object.fromEntries(Mdl.LOAD_KEYS.map((k) => [k, { on: k === 'M', mag: DEF_MAG[k], s: 1 }])),
  pt: { xi: 0.5, eta: 1, zeta: 0 },
  custom: zeroCustom(),
  customSym: true,
  rot: { mode: 'axis', axis: 'z', th: 0, eu: [0, 0, 0], sweep: 0 },
});
const state = defaultState();
const camera = new Camera();
let playing = false, playLast = 0, tween = null, hashTimer = 0, lastHash = '', formulaTimer = 0;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- TeX ヘルパー
const K = () => window.katex;
function tx(tex, display = false) {
  return K() ? K().renderToString(tex, { displayMode: display, throwOnError: false }) : tex;
}
const eq = (tex) => `<div class="eq">${tx(tex, true)}</div>`;
const matTex = (rows) => `\\begin{bmatrix}${rows.map((r) => r.join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;
const numMat = (S, d = 4) => matTex(S.map((r) => r.map((v) => Mdl.fmt(v, d))));

function coordTex(v, sym, half = false) {
  const x = half ? v / 2 : v;
  if (Math.abs(x) < 1e-12) return '0';
  const r = Mdl.rat(Math.abs(x), 20);
  const sg = x < 0 ? '-' : '';
  if (!r) return `${Mdl.fmt(x, 3)}${sym}`;
  const [n, d] = r;
  if (d === 1) return `${sg}${n === 1 ? '' : n}${sym}`;
  return `${sg}\\frac{${n === 1 ? '' : n}${sym}}{${d}}`;
}

// ---------------------------------------------------------------- 計算
// 画面に出すテンソル（S, Sp）は、応力モードでは σ [MPa]、ひずみモードでは ε [×10⁻⁶]。
// ひずみモードでは、荷重から求めた σ をフックの法則で ε に直す（直接入力では ε を入力して σ を求める）。
function current() {
  const strain = state.tn === 'e';
  const E = state.mat.E * 1e3, nu = state.mat.nu; // E [MPa]
  const scale = (A, k) => A.map((r) => r.map((v) => v * k));
  let terms, bases, Ssig, Seps, eterms = null, ebases = null;
  if (state.mode === 'custom') {
    bases = Mdl.customBases(state.custom, strain ? '\\varepsilon' : '\\sigma');
    terms = Mdl.customTerms(state.custom);
    const M = Mdl.toMatrix(terms, bases);
    if (strain) { Seps = M; Ssig = Mdl.invHooke(scale(M, 1e-6), E, nu); }
    else { Ssig = M; Seps = scale(Mdl.hooke(M, E, nu), 1e6); }
  } else {
    bases = Mdl.loadBases(state.geom, state.loads); terms = Mdl.loadTerms(state.loads, state.pt);
    Ssig = Mdl.toMatrix(terms, bases);
    Seps = scale(Mdl.hooke(Ssig, E, nu), 1e6);
    ({ terms: eterms, bases: ebases } = Mdl.strainOfRod(terms, bases, E, nu));
  }
  const S = strain ? Seps : Ssig;
  const Qm = rotQ();
  const Sp = Mdl.rotateTensor(S, Qm);
  const sym = Mdl.isSymmetric(S);
  return { terms, bases, eterms, ebases, S, Ssig, Seps, Q: Qm, Sp, sym, strain, E, nu };
}

// ひずみモードでは記号 σ → ε・語を置き換える（TeX は描画の前に置き換える）
const isE = () => state.tn === 'e';
const SY = () => (isE() ? '\\varepsilon' : '\\sigma');
const ts = (t) => (isE() ? t.replace(/\\sigma/g, '\\varepsilon') : t);
const js = (h) => (isE() ? h.replace(/主応力/g, '主ひずみ').replace(/応力円/g, 'ひずみ円') : h);
const UNIT_T = () => (isE() ? '\\times 10^{-6}' : '\\mathrm{MPa}');

function rotQ() {
  const r = state.rot;
  if (r.mode === 'axis') return Mdl.rotAxis(r.axis, r.th * Math.PI / 180);
  return Mdl.rotEuler(...r.eu.map((a) => a * Math.PI / 180));
}

// ---------------------------------------------------------------- UI の組み立て
const modeSel = $('mode');
modeSel.innerHTML = '<option value="load">丸棒と荷重</option><option value="custom">応力テンソルを直接入力</option>';

for (const el of document.querySelectorAll('.tex[data-tex]')) {
  if (K()) K().render(el.dataset.tex, el, { throwOnError: false });
}

const loadRows = {};
for (const k of Mdl.LOAD_KEYS) {
  const row = document.createElement('div');
  row.className = 'load-row';
  row.style.setProperty('--c', LOAD_COLOR[k]);
  row.innerHTML = `
    <label class="check"><input type="checkbox" class="on"><span class="sym">${tx(k)}</span><span class="kind">${LOAD_NAME[k]}</span></label>
    <label class="lf"><input type="number" class="mag" min="0" step="any"><span class="u">${UNIT[k]}</span></label>
    <label class="lf"><select class="dir"><option value="1">${DIRS[k][0]}</option><option value="-1">${DIRS[k][1]}</option></select></label>
    <span class="val"></span>`;
  $('loads').appendChild(row);
  loadRows[k] = row;
  row.querySelector('.on').addEventListener('change', (e) => { state.loads[k].on = e.target.checked; userEdit(); });
  row.querySelector('.mag').addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0) { state.loads[k].mag = v; userEdit(false); } });
  row.querySelector('.dir').addEventListener('change', (e) => { state.loads[k].s = +e.target.value; userEdit(); });
}

for (const k of ['xi', 'eta', 'zeta']) {
  $(k).addEventListener('input', (e) => {
    state.pt[k] = +e.target.value;
    // 断面の外に出たら、動かしていない方の座標を縮めて円の中に収める
    if (k !== 'xi') {
      const o = k === 'eta' ? 'zeta' : 'eta';
      const lim = Math.sqrt(Math.max(0, 1 - state.pt[k] ** 2));
      if (Math.abs(state.pt[o]) > lim) state.pt[o] = Math.sign(state.pt[o]) * Math.floor(lim * 20) / 20;
    }
    userEdit();
  });
}
for (const k of ['D', 'L']) {
  $(k).addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (v > 0) { state.geom[k] = v; userEdit(false); } });
}

const custInputs = {};
for (const c of Mdl.COMP) {
  const inp = document.createElement('input');
  inp.type = 'number'; inp.step = 'any';
  inp.setAttribute('aria-label', `σ${c}`);
  if (c[0] === c[1]) inp.classList.add('diag');
  inp.title = `σ_${c}`;
  inp.addEventListener('input', () => {
    const v = parseFloat(inp.value);
    if (!Number.isFinite(v)) return;
    state.custom[c] = v;
    if (state.customSym && c[0] !== c[1]) { state.custom[c[1] + c[0]] = v; custInputs[c[1] + c[0]].value = v; }
    userEdit(false);
  });
  $('cust').appendChild(inp);
  custInputs[c] = inp;
}
$('cust-sym').addEventListener('change', (e) => {
  state.customSym = e.target.checked;
  if (state.customSym) { // 右上に合わせる
    for (const [a, b] of [['xy', 'yx'], ['xz', 'zx'], ['yz', 'zy']]) state.custom[b] = state.custom[a];
  }
  userEdit();
});

modeSel.addEventListener('change', () => {
  state.mode = modeSel.value;
  render();
});
$('tn').addEventListener('change', (e) => { state.tn = e.target.value; render(); });
$('E').addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (v > 0) { state.mat.E = v; userEdit(false); } });
$('nu').addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (v >= 0 && v < 0.5) { state.mat.nu = v; userEdit(false); } });

$('rmode').addEventListener('change', (e) => {
  const Qm = rotQ();
  state.rot.mode = e.target.value;
  if (state.rot.mode === 'euler') state.rot.eu = Mdl.eulerFromQ(Qm).map((a) => a * 180 / Math.PI);
  render();
});
$('axis').addEventListener('change', (e) => { state.rot.axis = e.target.value; render(); });
const bindAngle = (rid, nid, get, set) => {
  $(rid).addEventListener('input', (e) => { set(+e.target.value); stopAnim(); render(); });
  $(nid).addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { set(v); stopAnim(); render({ keepNum: nid }); } });
};
bindAngle('th', 'th-n', () => state.rot.th, (v) => { state.rot.th = v; });
[0, 1, 2].forEach((i) => bindAngle(`eu${i}`, `eu${i}-n`, () => state.rot.eu[i], (v) => { state.rot.eu[i] = v; state.rot.sweep = i; }));

$('reset-rot').addEventListener('click', () => { stopAnim(); state.rot.th = 0; state.rot.eu = [0, 0, 0]; render(); });
$('to-principal').addEventListener('click', toPrincipal);
$('play').addEventListener('click', () => {
  playing = !playing; tween = null;
  $('play').setAttribute('aria-pressed', playing);
  $('play').querySelector('.lbl').textContent = playing ? '止める' : '回す';
  if (playing) { playLast = performance.now(); requestAnimationFrame(tick); } else render();
});

function stopAnim() {
  tween = null;
  if (!playing) return;
  playing = false;
  $('play').setAttribute('aria-pressed', 'false');
  $('play').querySelector('.lbl').textContent = '回す';
}

const wrap180 = (a) => ((a + 180) % 360 + 360) % 360 - 180;
function tick(now) {
  if (!playing && !tween) return;
  const dt = Math.min(0.1, (now - playLast) / 1000); playLast = now;
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / tween.dur);
    const e = 0.5 - 0.5 * Math.cos(Math.PI * tween.t);
    if (tween.kind === 'axis') state.rot.th = tween.from + (tween.to - tween.from) * e;
    else state.rot.eu = tween.from.map((a, i) => a + (tween.to[i] - a) * e);
    if (tween.t >= 1) tween = null;
  } else if (state.rot.mode === 'axis') {
    state.rot.th = wrap180(state.rot.th + 40 * dt);
  } else {
    const i = state.rot.sweep;
    if (i === 1) { // β は ±90° の範囲を往復
      state.rot.dir1 = state.rot.dir1 || 1;
      let b = state.rot.eu[1] + 30 * dt * state.rot.dir1;
      if (b > 90) { b = 90; state.rot.dir1 = -1; } else if (b < -90) { b = -90; state.rot.dir1 = 1; }
      state.rot.eu[1] = b;
    } else state.rot.eu[i] = wrap180(state.rot.eu[i] + 40 * dt);
  }
  if (!playing && !tween) { render(); return; }
  render({ light: true });
  requestAnimationFrame(tick);
}

// 主軸へ回す。軸まわりの回転で済む（回転軸が主軸の 1 本）なら θ だけ動かす
function toPrincipal() {
  stopAnim();
  const { S, sym } = current();
  if (!sym) return;
  const r = state.rot;
  if (r.mode === 'axis') {
    // 今の軸、だめならほかの座標軸のまわりに回すだけで主軸に合うか（回転軸が主軸の 1 本か）
    const ref = Math.max(1e-12, ...S.flat().map(Math.abs));
    const axes = [r.axis, ...Mdl.AX.filter((a) => a !== r.axis)];
    for (const ax of axes) {
      const [i, j, k] = Mdl.CYC[ax].map((a) => Mdl.AX.indexOf(a));
      if (Math.abs(S[i][k]) >= 1e-9 * ref || Math.abs(S[j][k]) >= 1e-9 * ref) continue;
      const from = ax === r.axis ? r.th : 0;
      let tp = 0.5 * Math.atan2(2 * S[i][j], S[i][i] - S[j][j]) * 180 / Math.PI;
      // 今の角度から近い方（90° ずつ同値）へ
      while (tp - from > 45) tp -= 90;
      while (tp - from < -45) tp += 90;
      r.axis = ax; r.th = from;
      tween = { kind: 'axis', from, to: tp, t: 0, dur: 0.8 };
      playLast = performance.now(); requestAnimationFrame(tick);
      return;
    }
    r.eu = Mdl.eulerFromQ(rotQ()).map((a) => a * 180 / Math.PI);
    r.mode = 'euler';
  }
  const target = Mdl.eulerFromQ(Mdl.principalQ(S)).map((a) => a * 180 / Math.PI);
  const from = r.eu.slice();
  const to = target.map((a, n) => (n === 1 ? a : from[n] + wrap180(a - from[n])));
  tween = { kind: 'euler', from, to, t: 0, dur: 1.0 };
  playLast = performance.now(); requestAnimationFrame(tick);
}

function userEdit(full = true) {
  render({ keepInputs: !full });
}

// ---------------------------------------------------------------- 描画: UI の値
function syncInputs(opts = {}) {
  const tname = isE() ? 'ひずみテンソル' : '応力テンソル';
  modeSel.options[1].textContent = `${tname}を直接入力`;
  modeSel.value = state.mode;
  for (const el of document.querySelectorAll('[data-mode]')) el.hidden = el.dataset.mode !== state.mode;
  $('rod-title').textContent = state.mode === 'custom' ? `${tname}（直接入力）` : '丸棒と荷重';
  $('tn').value = state.tn;
  $('mat-row').hidden = !isE();
  if (!opts.keepInputs) { $('E').value = state.mat.E; $('nu').value = state.mat.nu; }
  $('G-o').innerHTML = tx(`G=\\frac{E}{2(1+\\nu)}=${Mdl.fmt(state.mat.E / (2 * (1 + state.mat.nu)), 4)}\\ \\mathrm{GPa}`);
  $('cust-sub').textContent = isE()
    ? '成分を直接入力します（単位 ×10⁻⁶）。ひずみテンソルは定義から対称行列になるので、対称でないときは注意を出します。せん断の成分は工学ひずみ γ の半分（ε_xy = γ_xy / 2）です。'
    : '成分を直接入力します（単位 MPa）。応力テンソルは対称行列になるはずなので、対称でないときは注意を出します。';

  for (const k of Mdl.LOAD_KEYS) {
    const row = loadRows[k], L = state.loads[k];
    row.classList.toggle('off', !L.on);
    row.querySelector('.on').checked = L.on;
    if (!opts.keepInputs) row.querySelector('.mag').value = L.mag;
    row.querySelector('.dir').value = String(L.s);
  }
  for (const k of ['xi', 'eta', 'zeta']) { $(k).value = state.pt[k]; $(k + '-o').textContent = Mdl.fmt(state.pt[k], 3); }
  if (!opts.keepInputs) { $('D').value = state.geom.D; $('L').value = state.geom.L; }
  $('pt-tex').innerHTML = tx(`(x,y,z)=\\left(${coordTex(state.pt.xi, 'L')},\\ ${coordTex(state.pt.eta, 'D', true)},\\ ${coordTex(state.pt.zeta, 'D', true)}\\right)`);

  for (const c of Mdl.COMP) {
    if (document.activeElement !== custInputs[c]) custInputs[c].value = state.custom[c];
    custInputs[c].disabled = state.customSym && ['yx', 'zx', 'zy'].includes(c);
    custInputs[c].title = `${isE() ? 'ε' : 'σ'}_${c}`;
    custInputs[c].setAttribute('aria-label', `${isE() ? 'ε' : 'σ'}${c}`);
  }
  $('cust-sym').checked = state.customSym;
  // 対称でない組を入力欄のそばで知らせる（式の欄の判定だけだと下まで読まないと気づかない）
  const bad = [['xy', 'yx'], ['yz', 'zy'], ['zx', 'xz']].filter(([a, b]) => {
    const m = Math.max(1, ...Mdl.COMP.map((c) => Math.abs(state.custom[c])));
    return Math.abs(state.custom[a] - state.custom[b]) > 1e-9 * m;
  });
  for (const c of Mdl.COMP) custInputs[c].classList.toggle('bad', bad.some((pr) => pr.includes(c)));
  const warn = $('cust-warn');
  warn.hidden = state.mode !== 'custom' || !bad.length;
  warn.innerHTML = !bad.length ? '' : isE()
    ? `対称ではありません（${bad.map(([a, b]) => tx(`\\varepsilon_{${a}}\\ne\\varepsilon_{${b}}`)).join('，')}）。ひずみ成分は ${tx('\\varepsilon_{ij}=\\frac12\\left(\\frac{\\partial u_i}{\\partial x_j}+\\frac{\\partial u_j}{\\partial x_i}\\right)')} と定義するので必ず対称で、この行列はひずみテンソルになり得ません。主ひずみ・ひずみ円は求めません。`
    : `対称ではありません（${bad.map(([a, b]) => tx(`\\sigma_{${a}}\\ne\\sigma_{${b}}`)).join('，')}）。微小直方体のモーメントのつり合いから ${tx('\\sigma_{ij}=\\sigma_{ji}')} が必要なので、この行列は応力テンソルになり得ません。主応力・応力円は求めません。`;
  const canPrincipal = state.mode !== 'custom' || !bad.length;
  $('to-principal').disabled = !canPrincipal;
  $('to-principal').title = canPrincipal ? '' : '対称でない行列には主軸がありません';

  const r = state.rot;
  $('rmode').value = r.mode;
  $('axis').hidden = r.mode !== 'axis';
  $('axis').value = r.axis;
  for (const el of document.querySelectorAll('[data-r]')) el.hidden = el.dataset.r !== r.mode;
  $('th').value = r.th;
  if (opts.keepNum !== 'th-n') $('th-n').value = +r.th.toFixed(6);
  r.eu.forEach((a, i) => { $(`eu${i}`).value = a; if (opts.keepNum !== `eu${i}-n`) $(`eu${i}-n`).value = +a.toFixed(6); });
}

// ---------------------------------------------------------------- 描画: 丸棒
const rodPanel = new Panel($('rod'), camera);
const elemPanels = [new Panel($('elem0'), camera), new Panel($('elem1'), camera)];

function renderRod(cur) {
  const P = rodPanel; P.begin();
  const Ld = 4;
  const Rd = Math.min(0.6, Math.max(0.22, Ld * (state.geom.D / 2) / state.geom.L));
  const ex = [1, 0, 0], ey = [0, 1, 0], ez = [0, 0, 1];
  // 固定端の壁（固定端側から見ているときは棒より手前に描く）
  const W = Rd * 1.9;
  const drawWall = () => {
    P.poly([[Ld, -W, -W], [Ld, W, -W], [Ld, W, W], [Ld, -W, W]], { fill: '#d9d1c1', fillOpacity: 0.7, stroke: COLORS.muted, width: 1 });
    for (let i = -4; i <= 4; i++) {
      const t = i / 4 * W;
      P.line([Ld, t - W * 0.25, W], [Ld, t + W * 0.25, W + 0.0001], { color: COLORS.muted, width: 0.8 });
    }
  };
  const wallFront = P.proj([1, 0, 0])[2] > 0;
  if (!wallFront) drawWall();
  // 円柱（両端の円の凸包）
  const c0 = circle([0, 0, 0], ey, ez, Rd, 0, 2 * Math.PI, 48);
  const c1 = circle([Ld, 0, 0], ey, ez, Rd, 0, 2 * Math.PI, 48);
  P.hull([...c0, ...c1], { fill: '#efe7d6', fillOpacity: 0.92, stroke: COLORS.ink, width: 1.3 });
  const endVisible = P.proj([-1, 0, 0])[2] > 0;
  P.poly(c0, { fill: endVisible ? '#e4d9c2' : 'none', stroke: COLORS.ink, width: 1.1, dash: !endVisible });
  if (wallFront) drawWall();
  // 断面と点
  const xs = state.pt.xi * Ld;
  P.path3(circle([xs, 0, 0], ey, ez, Rd, 0, 2 * Math.PI, 48), { color: COLORS.muted, width: 1, dash: true });
  const pt = [xs, state.pt.eta * Rd, state.pt.zeta * Rd];
  // 点の微小要素（回転後の向き）
  const q = [0, 1, 2].map((a) => [cur.Q[0][a], cur.Q[1][a], cur.Q[2][a]]);
  const h = 0.11;
  cubeEdges(pt, q, h).forEach(([a, b]) => P.line(a, b, { color: COLORS.axisXp, width: 1.4 }));
  P.dot(pt, 2.6, { fill: COLORS.axisXp });
  // 座標軸（原点＝自由端の断面中心）
  const al = Rd + 0.55;
  P.arrow([0, 0, 0], [1.1, 0, 0], { color: COLORS.axisX, width: 1.2, opacity: 0.9 });
  P.arrow([0, 0, 0], [0, al, 0], { color: COLORS.axisY, width: 1.2 });
  P.arrow([0, 0, 0], [0, 0, al], { color: COLORS.axisZ, width: 1.2 });
  P.label([1.22, 0, 0], 'x', { color: COLORS.axisX });
  P.label([0, al + 0.14, 0], 'y', { color: COLORS.axisY });
  P.label([0, 0, al + 0.14], 'z', { color: COLORS.axisZ });
  P.label([0.06, -0.12, 0], '\\mathrm{O}', { cls: 'small' });
  P.label([Ld + 0.1, -W - 0.2, 0], '\\text{固定}', { cls: 'small muted' });
  P.label(add(pt, [0, 0.28, 0]), '\\mathrm{A}', { color: COLORS.axisXp, cls: 'small' });

  if (state.mode !== 'load') return P.end({ aspect: 2 });
  const Ls = state.loads;
  if (Ls.P.on) {
    const a = [-0.12, 0, 0], b = [-1.15, 0, 0];
    if (Ls.P.s > 0) P.arrow(a, b, { color: COLORS.load, width: 2.2, headScale: 1.2 });
    else P.arrow(b, a, { color: COLORS.load, width: 2.2, headScale: 1.2 });
    P.label([-1.3, 0.12, 0], 'P', { color: COLORS.load });
  }
  if (Ls.F.on) {
    // 座標軸 y と重ならないよう、自由端の少し内側に描く
    const fx = 0.16;
    const top = [fx, Rd + 0.04, 0], far = [fx, Rd + 0.95, 0];
    const bot = [fx, -Rd - 0.04, 0], farb = [fx, -Rd - 0.95, 0];
    if (Ls.F.s > 0) P.arrow(far, top, { color: COLORS.load, width: 2.2, headScale: 1.2 });
    else P.arrow(farb, bot, { color: COLORS.load, width: 2.2, headScale: 1.2 });
    P.label(Ls.F.s > 0 ? [fx + 0.2, Rd + 0.9, 0] : [fx + 0.2, -Rd - 0.9, 0], 'F', { color: COLORS.load });
  }
  if (Ls.T.on) { // x 軸まわりの円弧（右ねじ）
    const rr = Rd + 0.28;
    let arc = circle([-0.42, 0, 0], ey, ez, rr, 0.35, 0.35 + 1.55 * Math.PI, 40);
    if (Ls.T.s < 0) arc = arc.reverse();
    P.path3(arc, { color: COLORS.moment, width: 2.2, head: true, headScale: 1.2 });
    P.label(add([-0.42, 0, 0], sc(ez, -rr - 0.2)), 'T', { color: COLORS.moment });
  }
  if (Ls.M.on) { // z 軸まわりの円弧（xy 面内、棒の左側）
    const rr = Rd + 0.75;
    let arc = circle([0, 0, 0], ex, ey, rr, 0.62 * Math.PI, 1.38 * Math.PI, 40);
    if (Ls.M.s < 0) arc = arc.reverse();
    P.path3(arc, { color: COLORS.moment, width: 2.2, head: true, headScale: 1.2 });
    P.label([-rr - 0.22, 0, 0.0], 'M', { color: COLORS.moment });
  }
  P.end({ aspect: 2 });
}

function cubeEdges(c, q, h) {
  const v = (a, b, d) => add(c, add(sc(q[0], a * h), add(sc(q[1], b * h), sc(q[2], d * h))));
  const out = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    out.push([v(-1, a, b), v(1, a, b)], [v(a, -1, b), v(a, 1, b)], [v(a, b, -1), v(a, b, 1)]);
  }
  return out;
}

// ---------------------------------------------------------------- 描画: 微小要素
function renderElement(P, Sp, Qm, primed, ref, showRef) {
  P.begin();
  const h = 1, g = 0.05, Lmax = 1.05;
  const q = [0, 1, 2].map((a) => [Qm[0][a], Qm[1][a], Qm[2][a]]);
  const nm = primed ? ["x'", "y'", "z'"] : ['x', 'y', 'z'];
  const sub = (a, b) => (primed ? `\\sigma'_{${Mdl.AX[a]}${Mdl.AX[b]}}` : `\\sigma_{${Mdl.AX[a]}${Mdl.AX[b]}}`);
  if (showRef) cubeEdges([0, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], h).forEach(([a, b]) => P.line(a, b, { color: COLORS.muted, width: 0.9, dash: true, opacity: 0.55 }));

  const faces = [];
  for (let a = 0; a < 3; a++) for (const sg of [1, -1]) {
    const n = sc(q[a], sg), c = sc(n, h);
    const [b, d] = [(a + 1) % 3, (a + 2) % 3];
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([u, w]) => add(c, add(sc(q[b], u * h), sc(q[d], w * h))));
    faces.push({ a, sg, n, c, corners, vis: P.proj(n)[2] > 1e-9, depth: P.proj(c)[2] });
  }
  const arrowsOf = (f, vis) => {
    for (let b = 0; b < 3; b++) {
      const v = Sp[f.a][b];
      if (!(ref > 0) || Math.abs(v) < ref * 1e-6) continue;
      const len = Math.max(0.12, Lmax * Math.abs(v) / ref);
      const style = { width: vis ? 2.4 : 1.6, dash: !vis, opacity: vis ? 1 : 0.5, headScale: vis ? 1.1 : 0.85 };
      let from, to, color;
      if (b === f.a) {
        color = v > 0 ? COLORS.tension : COLORS.compress;
        const o = sc(f.n, g), e = sc(f.n, g + len);
        [from, to] = v > 0 ? [add(f.c, o), add(f.c, e)] : [add(f.c, e), add(f.c, o)];
      } else {
        color = COLORS.shear;
        from = f.c; to = add(f.c, sc(q[b], f.sg * Math.sign(v) * len));
      }
      P.arrow(from, to, { ...style, color });
      if (vis) {
        const lp = b === f.a ? add(v > 0 ? to : from, sc(f.n, 0.2)) : add(to, sc(q[b], f.sg * Math.sign(v) * 0.22));
        P.label(lp, sub(f.a, b), { color, cls: 'small' });
      }
    }
  };
  faces.filter((f) => !f.vis).forEach((f) => arrowsOf(f, false));
  faces.filter((f) => !f.vis).forEach((f) => P.poly(f.corners, { stroke: COLORS.muted, width: 0.9, dash: true }));
  faces.filter((f) => f.vis).sort((x, y) => x.depth - y.depth)
    .forEach((f) => P.poly(f.corners, { fill: primed ? '#efe9f6' : '#f3ead8', fillOpacity: 0.88, stroke: COLORS.ink, width: 1.3 }));
  faces.filter((f) => f.vis).forEach((f) => arrowsOf(f, true));

  drawElemAxes(P, q, primed);
  if (!(ref > 0)) P.label([0, 0, 0], '\\text{応力 }0', { cls: 'muted' });
  P.end({ fixed: true });
}

// ひずみモード: 矢印の代わりに、変形した要素（ひずみを誇張）を描く。要素の向きの局所座標で
// 点 l は l + k·ε′l へ動く（剛体回転を含まない純粋な変形）。点線は変形前の要素。
function renderStrainElement(P, Ep, Qm, primed, ref, showRef) {
  P.begin();
  const h = 1;
  const q = [0, 1, 2].map((a) => [Qm[0][a], Qm[1][a], Qm[2][a]]);
  const k = ref > 0 ? 0.3 / ref : 0; // ε（×10⁻⁶）→ 図の上の変位
  if (showRef) cubeEdges([0, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], h).forEach(([a, b]) => P.line(a, b, { color: COLORS.muted, width: 0.9, dash: true, opacity: 0.35 }));
  cubeEdges([0, 0, 0], q, h).forEach(([a, b]) => P.line(a, b, { color: COLORS.muted, width: 1, dash: true, opacity: 0.8 }));
  const vtx = (l) => {
    const d = [0, 1, 2].map((i) => l[i] + k * (Ep[i][0] * l[0] + Ep[i][1] * l[1] + Ep[i][2] * l[2]));
    return add(sc(q[0], d[0]), add(sc(q[1], d[1]), sc(q[2], d[2])));
  };
  const faces = [];
  for (let a = 0; a < 3; a++) for (const sg of [1, -1]) {
    const [b, d] = [(a + 1) % 3, (a + 2) % 3];
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([u, w]) => {
      const l = [0, 0, 0]; l[a] = sg * h; l[b] = u * h; l[d] = w * h; return vtx(l);
    });
    const n = sc(q[a], sg);
    faces.push({ corners, vis: P.proj(n)[2] > 1e-9, depth: P.proj(sc(n, h))[2] });
  }
  faces.filter((f) => !f.vis).forEach((f) => P.poly(f.corners, { stroke: COLORS.ink, width: 0.9, dash: true, opacity: 0.5 }));
  faces.filter((f) => f.vis).sort((x, y) => x.depth - y.depth)
    .forEach((f) => P.poly(f.corners, { fill: primed ? '#efe9f6' : '#f3ead8', fillOpacity: 0.8, stroke: COLORS.ink, width: 1.4 }));
  drawElemAxes(P, q, primed);
  if (ref > 0) P.label([0, -2.45, 0], `\\text{変形を }${Number((k * 1e6).toPrecision(2)).toLocaleString('ja-JP')}\\text{ 倍に誇張}`, { cls: 'small muted' });
  else P.label([0, 0, 0], '\\text{ひずみ }0', { cls: 'muted' });
  P.end({ fixed: true });
}

function drawElemAxes(P, q, primed) {
  const nm = primed ? ["x'", "y'", "z'"] : ['x', 'y', 'z'];
  // 座標軸（左下）
  const ax = camera.screenAxes();
  const o = add(sc(ax.right, -2.15), sc(ax.up, -2.05));
  const cols = primed ? [COLORS.axisXp, COLORS.axisYp, COLORS.axisZp] : [COLORS.axisX, COLORS.axisY, COLORS.axisZ];
  if (primed) [0, 1, 2].forEach((a) => P.line(o, add(o, sc([[1, 0, 0], [0, 1, 0], [0, 0, 1]][a], 0.5)), { color: COLORS.muted, width: 0.9, dash: true }));
  q.forEach((v, a) => {
    P.arrow(o, add(o, sc(v, 0.6)), { color: cols[a], width: 1.5, headScale: 0.9 });
    P.label(add(o, sc(v, 0.8)), nm[a], { color: cols[a], cls: 'small' });
  });
}

// Panel.end に固定の範囲を足す（立方体＋矢印が入る大きさ）
const _end = Panel.prototype.end;
Panel.prototype.end = function (opts = {}) {
  if (opts.fixed) {
    const r = 2.75;
    this.pts.push([-r, -r, 0], [r, r, 0]);
    this.pts = this.pts.filter((p) => Math.abs(p[0]) <= r && Math.abs(p[1]) <= r);
    return _end.call(this, { pad: 0 });
  }
  return _end.call(this, opts);
};

// ---------------------------------------------------------------- 描画: 成分の表

function heat(v, ref) {
  if (!(ref > 0)) return 'transparent';
  const t = Math.max(-1, Math.min(1, v / ref));
  const a = Math.abs(t) * 0.55;
  return t >= 0 ? `rgba(208,71,59,${a})` : `rgba(36,91,141,${a})`;
}
function renderMatrix(host, S, primed, ref, title) {
  const rows = Mdl.AX.map((i, a) => `<tr>${Mdl.AX.map((j, b) => `<td style="background:${heat(S[a][b], ref)}"><small>${tx(SY() + (primed ? "'" : '') + `_{${i}${j}}`)}</small>${Mdl.fmt(S[a][b], 3)}</td>`).join('')}</tr>`).join('');
  host.innerHTML = `<div class="cap">${title}</div><table>${rows}</table>`;
}

// ---------------------------------------------------------------- SVG
const NS = 'http://www.w3.org/2000/svg';
const sv = (name, attrs, parent) => { const e = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };

// ---------------------------------------------------------------- 描画: モールの応力円
// モールの円のラベル: ひずみでは σ → ε、τ → γ/2（テンソル成分 ε_xy = γ_xy/2 が縦軸）
const txm = (t, d) => tx(isE() ? ts(t).replace(/\\tau/g, '\\gamma/2') : t, d);
function renderMohr(cur) {
  const host = $('mohr');
  const W = 640, H = 360;
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}` });
  if (!cur.sym) {
    host.replaceChildren(svg);
    sv('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', 'font-size': 15, fill: '#bd442c' }, svg).textContent = js('対称でない行列なので、主応力・応力円は描けません');
    $('mohr-sub').textContent = '';
    return;
  }
  const { vals } = Mdl.eigSym(cur.S);
  const [s1, s2, s3] = vals;
  const r = state.rot;
  const axisMode = r.mode === 'axis';
  let cMin = Math.min(s3, 0), cMax = Math.max(s1, 0);
  const R13 = (s1 - s3) / 2;
  let span = Math.max(cMax - cMin, 2 * R13, 1e-9);
  if (span < 1e-9) span = 1;
  const k = Math.min((W - 80) / span, (H - 60) / (2 * Math.max(R13, span * 0.25)));
  const cx = (cMin + cMax) / 2;
  const X = (s) => W / 2 + (s - cx) * k;
  const yAxis = axisMode ? H / 2 : H - 34;
  const kk = axisMode ? k : Math.min(k, (H - 60) / Math.max(R13, 1e-9));
  const Y = (t) => yAxis + t * kk; // 下向き正
  // 軸
  sv('line', { x1: 14, x2: W - 14, y1: yAxis, y2: yAxis, stroke: '#1d293299' }, svg);
  sv('line', { x1: X(0), x2: X(0), y1: 10, y2: H - 10, stroke: '#1d293255' }, svg);
  sv('text', { x: W - 16, y: yAxis - 6, 'text-anchor': 'end', 'font-size': 13, fill: '#1d2932' }, svg).textContent = isE() ? 'ε' : 'σ';
  sv('text', { x: X(0) + 6, y: axisMode ? H - 14 : 22, 'font-size': 13, fill: '#1d2932' }, svg).textContent = isE() ? (axisMode ? 'γ/2（下向き正）' : '|γ|/2') : (axisMode ? 'τ（下向き正）' : '|τ|');
  // 主応力の 3 つの円
  const circ = (a, b, style) => {
    const c = (a + b) / 2, rr = Math.abs(a - b) / 2;
    if (axisMode) sv('circle', { cx: X(c), cy: yAxis, r: rr * kk, fill: 'none', ...style }, svg);
    else sv('path', { d: `M ${X(c - rr)} ${yAxis} A ${rr * kk} ${rr * kk} 0 0 1 ${X(c + rr)} ${yAxis}`, fill: 'none', ...style }, svg);
  };
  circ(s1, s3, { stroke: '#1d293255', 'stroke-width': 1.2, 'stroke-dasharray': '4 3' });
  circ(s1, s2, { stroke: '#1d293255', 'stroke-width': 1.2, 'stroke-dasharray': '4 3' });
  circ(s2, s3, { stroke: '#1d293255', 'stroke-width': 1.2, 'stroke-dasharray': '4 3' });
  [[s1, 1], [s2, 2], [s3, 3]].map(([v, n]) => [v, (isE() ? 'ε' : 'σ') + n]).forEach(([s, n], idx) => {
    sv('circle', { cx: X(s), cy: yAxis, r: 3, fill: '#1d2932' }, svg);
    sv('text', { x: X(s), y: yAxis + 16 + (idx === 1 ? 12 : 0), 'text-anchor': 'middle', 'font-size': 11, fill: '#627078' }, svg).textContent = n;
  });

  const S = cur.S, Sp = cur.Sp;
  if (axisMode) {
    const [i, j] = Mdl.CYC[r.axis].map((a) => Mdl.AX.indexOf(a));
    const ni = Mdl.AX[i], nj = Mdl.AX[j];
    const c = (S[i][i] + S[j][j]) / 2, rr = Math.hypot((S[i][i] - S[j][j]) / 2, S[i][j]);
    sv('circle', { cx: X(c), cy: yAxis, r: rr * kk, fill: '#ef6a4b10', stroke: '#ef6a4b', 'stroke-width': 2 }, svg);
    // 回転前の点（x 面）→ 回転後（x' 面）、2θ の弧
    const p0 = [X(S[i][i]), Y(S[i][j])], p1 = [X(Sp[i][i]), Y(Sp[i][j])], q1 = [X(Sp[j][j]), Y(-Sp[i][j])];
    if (rr > 1e-12 && Math.abs(r.th) > 0.05) {
      const a0 = Math.atan2(p0[1] - yAxis, p0[0] - X(c)), ar = rr * kk * 0.42;
      const steps = 40, pts = [];
      for (let n = 0; n <= steps; n++) {
        // (σ, τ) 平面で x 面の点の偏角 φ0 は φ0 − 2θ へ動く（τ 下向き正の画面では反時計まわり）
        const a = a0 - (2 * r.th * Math.PI / 180) * n / steps;
        pts.push(`${X(c) + ar * Math.cos(a)},${yAxis + ar * Math.sin(a)}`);
      }
      sv('polyline', { points: pts.join(' '), fill: 'none', stroke: '#8a4fbf', 'stroke-width': 1.5 }, svg);
      sv('line', { x1: X(c), y1: yAxis, x2: p0[0], y2: p0[1], stroke: '#8a4fbf66', 'stroke-dasharray': '3 3' }, svg);
    }
    sv('line', { x1: p1[0], y1: p1[1], x2: q1[0], y2: q1[1], stroke: '#ef6a4b', 'stroke-width': 1.2 }, svg);
    sv('circle', { cx: p0[0], cy: p0[1], r: 4, fill: '#fff', stroke: '#627078', 'stroke-width': 1.5 }, svg);
    sv('text', { x: p0[0] + 7, y: p0[1] - 7, 'font-size': 12, fill: '#627078' }, svg).textContent = `${ni} 面`;
    sv('circle', { cx: p1[0], cy: p1[1], r: 5, fill: '#8a4fbf' }, svg);
    sv('text', { x: p1[0] + 8, y: p1[1] + 14, 'font-size': 13, fill: '#8a4fbf' }, svg).textContent = `${ni}′ 面`;
    sv('circle', { cx: q1[0], cy: q1[1], r: 5, fill: '#c08a1e' }, svg);
    sv('text', { x: q1[0] + 8, y: q1[1] + 14, 'font-size': 13, fill: '#c08a1e' }, svg).textContent = `${nj}′ 面`;
    $('mohr-sub').innerHTML = js(`赤い円は ${ni}${nj} 面内のモールの応力円（中心 ${txm(`\\frac{\\sigma_{${ni}${ni}}+\\sigma_{${nj}${nj}}}{2}`)}）。紫の点 ${txm(`(\\sigma'_{${ni}${ni}},\\ \\sigma'_{${ni}${nj}})`)} は、要素を ${txm('\\theta')} 回すと円の上を ${txm('2\\theta')} 回ります（${txm('\\tau')} を下向き正にとると回る向きも同じ）。点線は 3 つの主応力 ${txm('\\sigma_1\\ge\\sigma_2\\ge\\sigma_3')} の円です。`);
  } else {
    const names = ["x′", "y′", "z′"], cols = [COLORS.axisXp, COLORS.axisYp, COLORS.axisZp];
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, d = (a + 2) % 3;
      const t = Math.hypot(Sp[a][b], Sp[a][d]);
      const px = X(Sp[a][a]), py = yAxis - t * kk;
      sv('circle', { cx: px, cy: py, r: 5, fill: cols[a] }, svg);
      sv('text', { x: px + 8, y: py - 6, 'font-size': 13, fill: cols[a] }, svg).textContent = `${names[a]} 面`;
    }
    $('mohr-sub').innerHTML = js(`点線は 3 つの主応力 ${txm('\\sigma_1\\ge\\sigma_2\\ge\\sigma_3')} の円。点は回転後の各面の（${isE() ? '垂直ひずみ，せん断ひずみの大きさ' : '垂直応力，せん断応力の大きさ'} ${txm('\\sqrt{\\sigma\'^2_{ij}+\\sigma\'^2_{ik}}')}）で、どう回しても必ず大きい円の内側・小さい円の外側に入ります。主軸へ回すと 3 点が ${txm('\\sigma_1,\\sigma_2,\\sigma_3')} に重なります。`);
  }
  host.replaceChildren(svg);
}

// ---------------------------------------------------------------- 式
// ひずみモードでは、1. で荷重から応力を求めたあとフックの法則でひずみに直し（1′.）、2.・3. は ε で書く。
// 2.・3. の TeX は ts()（σ → ε）を通してから描く。
function renderFormulas(cur) {
  const { S, Sp, sym } = cur;
  const ld = state.loads;
  const vals = (k) => `${k}=${Mdl.fmt(ld[k].mag, 4)}\\ \\mathrm{${UNIT[k].replace('·', '\\cdot ')}}`;
  const matE = () => tx(`E=${Mdl.fmt(state.mat.E, 4)}\\ \\mathrm{GPa},\\ \\nu=${Mdl.fmt(state.mat.nu, 3)}`);

  // --- 1. 応力テンソル（ひずみモードは 1′. でひずみへ）
  let h = '<h3>1. 応力テンソル</h3>';
  if (state.mode === 'load') {
    const { terms, bases } = cur;
    const on = Mdl.LOAD_KEYS.filter((k) => ld[k].on && ld[k].mag !== 0);
    h += '<div class="step">STEP 1　断面の諸量</div>';
    h += eq('A=\\frac{\\pi D^2}{4},\\qquad I=\\frac{\\pi D^4}{64},\\qquad I_p=\\frac{\\pi D^4}{32}');
    h += '<div class="step">STEP 2　各荷重による応力（断面 x の点 (y, z) の式）</div>';
    h += '<p>自由端から断面 <i>x</i> までを切り出した自由体のつり合いから、正の面（外向き法線が <i>+x</i>）に働く断面力を決め、材料力学の式で応力にします。荷重の向きを逆にすると符号が反転します。</p>';
    if (!on.length) h += '<p>荷重がありません。</p>';
    const sg = (k, neg = false) => ((ld[k].s > 0) !== neg ? '' : '-');
    if (on.includes('P')) h += eq(`\\text{引張：}\\ \\sigma_{xx}=${sg('P')}\\frac{P}{A}=${sg('P')}\\frac{4P}{\\pi D^2}`);
    if (on.includes('T')) h += eq(`\\text{ねじり：}\\ \\sigma_{xy}=${sg('T')}\\frac{T z}{I_p}=${sg('T')}\\frac{32T z}{\\pi D^4},\\qquad \\sigma_{xz}=${sg('T', true)}\\frac{T y}{I_p}=${sg('T', true)}\\frac{32T y}{\\pi D^4}`);
    if (on.includes('M')) h += eq(`\\text{曲げ：}\\ \\sigma_{xx}=${sg('M')}\\frac{M y}{I}=${sg('M')}\\frac{64M y}{\\pi D^4}`);
    if (on.includes('F')) h += eq(`\\text{横荷重：}\\ \\sigma_{xx}=${sg('F')}\\frac{(Fx)\\,y}{I}=${sg('F')}\\frac{64F x y}{\\pi D^4},\\qquad \\sigma_{xy}=${sg('F')}\\frac{F}{3I}\\left(\\frac{D^2}{4}-y^2\\right)`);
    if (on.includes('F')) h += '<p>横荷重のせん断応力は材料力学の近似（同じ高さ <i>y</i> の弦の上で一様）。中立軸 <i>y</i> = 0 で最大の 4F/3A、表面で 0 です。</p>';
    h += '<p>そのほかの成分（σ<sub>yy</sub>, σ<sub>zz</sub>, σ<sub>yz</sub>）は 0、せん断応力は対称（σ<sub>yx</sub> = σ<sub>xy</sub> など）です。</p>';
    const ptT = `\\left(${coordTex(state.pt.xi, 'L')},\\ ${coordTex(state.pt.eta, 'D', true)},\\ ${coordTex(state.pt.zeta, 'D', true)}\\right)`;
    h += `<div class="step">STEP 3　点 ${tx('(x,y,z)=' + ptT)} を代入</div>`;
    const symRows = Mdl.AX.map((i) => Mdl.AX.map((j) => Mdl.sumTex(terms[i + j], bases)));
    h += eq(`\\bm\\sigma=${matTex(symRows)}`);
    h += `<div class="step">STEP 4　数値を代入（${tx(`D=${state.geom.D}\\ \\mathrm{mm},\\ L=${state.geom.L}\\ \\mathrm{mm}` + (on.length ? ',\\ ' + on.map(vals).join(',\\ ') : ''))}）</div>`;
    h += eq(`\\bm\\sigma=${numMat(cur.Ssig)}\\ \\mathrm{MPa}`);
    if (cur.strain) {
      h += '<h3>1′. ひずみテンソル（フックの法則）</h3>';
      h += '<div class="step">STEP 5　応力テンソルの各成分にフックの法則を適用</div>';
      h += eq('\\varepsilon_{ij}=\\frac{1+\\nu}{E}\\sigma_{ij}-\\frac{\\nu}{E}\\sigma_{kk}\\delta_{ij}');
      h += '<p>この丸棒では σ<sub>yy</sub> = σ<sub>zz</sub> = σ<sub>yz</sub> = 0 なので、</p>';
      h += eq('\\varepsilon_{xx}=\\frac{\\sigma_{xx}}{E},\\quad \\varepsilon_{yy}=\\varepsilon_{zz}=-\\frac{\\nu\\sigma_{xx}}{E},\\quad \\varepsilon_{xy}=\\frac{1+\\nu}{E}\\sigma_{xy},\\quad \\varepsilon_{xz}=\\frac{1+\\nu}{E}\\sigma_{xz}');
      h += eq(`\\bm\\varepsilon=${matTex(Mdl.AX.map((i) => Mdl.AX.map((j) => Mdl.sumTex(cur.eterms[i + j], cur.ebases))))}`);
      h += `<div class="step">STEP 6　数値を代入（${matE()}）</div>`;
      h += eq(`\\bm\\varepsilon=${numMat(S)}\\times 10^{-6}`);
      h += `<p>せん断ひずみ（角度の変化）は ${tx('\\gamma_{ij}=2\\varepsilon_{ij}')}。体積ひずみは ${tx(`\\varepsilon_{kk}=\\frac{1-2\\nu}{E}\\sigma_{kk}=${Mdl.fmt(S[0][0] + S[1][1] + S[2][2], 4)}\\times 10^{-6}`)}。</p>`;
    }
  } else if (!cur.strain) {
    h += eq(`\\bm\\sigma=${numMat(S)}\\ \\mathrm{MPa}`);
    h += sym
      ? '<p class="ok">対称行列（σ<sub>ij</sub> = σ<sub>ji</sub>）なので、応力テンソルになり得ます。対角成分の負の値は圧縮を表すだけです。</p>'
      : '<p class="ng">対称でありません。微小直方体のモーメントのつり合いから σ<sub>xy</sub> = σ<sub>yx</sub>, σ<sub>yz</sub> = σ<sub>zy</sub>, σ<sub>zx</sub> = σ<sub>xz</sub> が必要なので、応力テンソルにはなり得ません。</p>';
  } else {
    h = '<h3>1. ひずみテンソル → 応力テンソル</h3>';
    h += eq(`\\bm\\varepsilon=${numMat(S)}\\times 10^{-6}`);
    if (!sym) {
      h += '<p class="ng">対称でありません。ひずみ成分は ε<sub>ij</sub> = (∂u<sub>i</sub>/∂x<sub>j</sub> + ∂u<sub>j</sub>/∂x<sub>i</sub>)/2 と定義するので必ず対称で、ひずみテンソルにはなり得ません。</p>';
    } else {
      const E = cur.E, nu = cur.nu, ekk = S[0][0] + S[1][1] + S[2][2];
      h += '<p class="ok">対称行列（ε<sub>ij</sub> = ε<sub>ji</sub>）なので、ひずみテンソルになり得ます。せん断ひずみ（角度の変化）は γ<sub>ij</sub> = 2ε<sub>ij</sub> です。</p>';
      h += `<div class="step">STEP 1　フックの法則で応力へ（${matE()}）</div>`;
      h += eq('\\sigma_{ij}=\\frac{E}{1+\\nu}\\left(\\varepsilon_{ij}+\\frac{\\nu}{1-2\\nu}\\varepsilon_{kk}\\delta_{ij}\\right)');
      h += eq(`\\varepsilon_{kk}=${Mdl.fmt(ekk, 4)}\\times10^{-6},\\quad \\frac{E}{1+\\nu}=${Mdl.fmt(E / (1 + nu), 4)}\\ \\mathrm{MPa},\\quad \\frac{\\nu}{1-2\\nu}=${Mdl.fmt(nu / (1 - 2 * nu), 4)}`);
      h += eq(`\\bm\\sigma=${numMat(cur.Ssig)}\\ \\mathrm{MPa}`);
      const free = [0, 1, 2].filter((i) => Math.abs(S[i][i]) < 1e-9 && Math.abs(cur.Ssig[i][i]) > 1e-6);
      for (const i of free) {
        const a = Mdl.AX[i], [b, c] = Mdl.AX.filter((x) => x !== a);
        h += `<p>${tx(`\\varepsilon_{${a}${a}}=0`)} でも ${tx(`\\sigma_{${a}${a}}\\ne0`)}：${b}, ${c} 方向の応力によるポアソン効果で ${a} 方向に伸び縮みしようとするのを拘束しているので、拘束する応力 ${tx(`\\sigma_{${a}${a}}=\\nu(\\sigma_{${b}${b}}+\\sigma_{${c}${c}})`)} が要ります（平面ひずみ状態）。</p>`;
      }
    }
  }
  $('f-tensor').innerHTML = h;

  // --- 2. 座標変換（ひずみも同じ式で回る）
  const T = (t, d) => tx(ts(t), d);
  const Q = (t) => eq(ts(t));
  const unit = cur.strain ? '\\times 10^{-6}' : '\\ \\mathrm{MPa}';
  const r = state.rot;
  h = `<h3>2. 座標変換 ${T("\\bm\\sigma'=\\bm R\\,\\bm\\sigma\\,\\bm R^{\\mathsf T}")}</h3>`;
  h += `<p>${tx('\\bm R')} の各行は、新しい座標系の単位ベクトル ${tx("\\bm e'_x,\\ \\bm e'_y,\\ \\bm e'_z")} を元の ${tx('xyz')} で表したものです。</p>`;
  if (cur.strain) h += `<p>ひずみテンソルは応力テンソルと同じ式で回ります（${tx('\\varepsilon_{ij}')} を ${tx('\\frac12')} を掛けた平均で定義したのはこのため）。工学ひずみ ${tx('\\gamma_{ij}')} のままでは、この式に当てはまりません。</p>`;
  const deg = (a) => `${Mdl.fmt(a, 4)}^\\circ`;
  const loadSym = state.mode === 'load' && sym;
  if (r.mode === 'axis') {
    const RT = {
      x: [['1', '0', '0'], ['0', '\\cos\\theta', '\\sin\\theta'], ['0', '-\\sin\\theta', '\\cos\\theta']],
      y: [['\\cos\\theta', '0', '-\\sin\\theta'], ['0', '1', '0'], ['\\sin\\theta', '0', '\\cos\\theta']],
      z: [['\\cos\\theta', '\\sin\\theta', '0'], ['-\\sin\\theta', '\\cos\\theta', '0'], ['0', '0', '1']],
    }[r.axis];
    h += `<div class="step">STEP 1　${r.axis} 軸まわりに θ 回す回転行列</div>`;
    h += eq(`\\bm R=${matTex(RT)}`);
    h += '<div class="step">STEP 2　成分ごとに計算し、倍角の公式で整理（一般の式）</div>';
    const [ci, cj, ck] = Mdl.CYC[r.axis];
    const sg = (a, b) => `\\sigma_{${Mdl.AX.indexOf(a) <= Mdl.AX.indexOf(b) ? a + b : b + a}}`;
    const sp = (a, b) => `\\sigma'_{${Mdl.AX.indexOf(a) <= Mdl.AX.indexOf(b) ? a + b : b + a}}`;
    const lines = {
      [ci + ci]: `${sp(ci, ci)}&=\\frac{${sg(ci, ci)}+${sg(cj, cj)}}{2}+\\frac{${sg(ci, ci)}-${sg(cj, cj)}}{2}\\cos 2\\theta+${sg(ci, cj)}\\sin 2\\theta`,
      [cj + cj]: `${sp(cj, cj)}&=\\frac{${sg(ci, ci)}+${sg(cj, cj)}}{2}-\\frac{${sg(ci, ci)}-${sg(cj, cj)}}{2}\\cos 2\\theta-${sg(ci, cj)}\\sin 2\\theta`,
      [ck + ck]: `${sp(ck, ck)}&=${sg(ck, ck)}`,
      ij: `${sp(ci, cj)}&=-\\frac{${sg(ci, ci)}-${sg(cj, cj)}}{2}\\sin 2\\theta+${sg(ci, cj)}\\cos 2\\theta`,
      ik: `${sp(ci, ck)}&=${sg(ci, ck)}\\cos\\theta+${sg(cj, ck)}\\sin\\theta`,
      jk: `${sp(cj, ck)}&=-${sg(ci, ck)}\\sin\\theta+${sg(cj, ck)}\\cos\\theta`,
    };
    h += Q(`\\begin{aligned}${[lines[ci + ci], lines[cj + cj], lines[ck + ck], lines.ij, lines.jk, lines.ik].join('\\\\')}\\end{aligned}`);
    if (r.axis === 'z') {
      h += cur.strain
        ? '<p>上の 3 行は、4 年の材料力学の「任意方向の面に働く応力」の式の σ を ε に、τ を γ/2 に置き換えたものです（モールのひずみ円）。</p>'
        : '<p>上の 3 行は 4 年の材料力学の「任意方向の面に働く応力」（モールの応力円）の式そのものです（演習 1.2.11）。</p>';
    }
    if (loadSym) {
      h += '<div class="step">STEP 3　この問題の成分（1. の STEP 3）を代入</div>';
      const [tm, bs] = cur.strain ? [cur.eterms, cur.ebases] : [cur.terms, cur.bases];
      const s3 = Mdl.rotateSymbolic(tm, r.axis);
      h += Q(`\\begin{aligned}${['xx', 'yy', 'zz', 'xy', 'yz', 'xz'].map((c) => `\\sigma'_{${c}}&=${Mdl.rotatedTex(s3.out[c], bs)}`).join('\\\\')}\\end{aligned}`);
    }
    h += `<div class="step">STEP ${loadSym ? 4 : 3}　${tx(`\\theta=${deg(r.th)}`)} と数値を代入</div>`;
    h += Q(`\\bm R=${numMat(Mdl.tr(cur.Q))},\\qquad \\bm\\sigma'=${numMat(Sp)}${unit}`);
  } else {
    h += '<div class="step">STEP 1　z 軸まわりに α、新しい y′ 軸まわりに β、さらに新しい x″ 軸まわりに γ 回す</div>';
    h += eq('\\bm R=\\bm R_x(\\gamma)\\,\\bm R_y(\\beta)\\,\\bm R_z(\\alpha)');
    h += eq(`=${matTex([['1', '0', '0'], ['0', '\\cos\\gamma', '\\sin\\gamma'], ['0', '-\\sin\\gamma', '\\cos\\gamma']])}${matTex([['\\cos\\beta', '0', '-\\sin\\beta'], ['0', '1', '0'], ['\\sin\\beta', '0', '\\cos\\beta']])}${matTex([['\\cos\\alpha', '\\sin\\alpha', '0'], ['-\\sin\\alpha', '\\cos\\alpha', '0'], ['0', '0', '1']])}`);
    h += '<p>（右から順に掛かる。どれも「その軸まわりに回した座標系の単位ベクトルを行に並べた行列」）</p>';
    h += '<div class="step">STEP 2　成分ごとの式</div>';
    h += Q("\\sigma'_{ij}=\\sum_{k}\\sum_{l}R_{ik}R_{jl}\\,\\sigma_{kl}\\qquad(i,j,k,l=x,y,z)");
    h += `<div class="step">STEP 3　${tx(`\\alpha=${deg(r.eu[0])},\\ \\beta=${deg(r.eu[1])},\\ \\gamma=${deg(r.eu[2])}`)} を代入</div>`;
    h += Q(`\\bm R=${numMat(Mdl.tr(cur.Q))},\\qquad \\bm\\sigma'=${numMat(Sp)}${unit}`);
  }
  if (sym) {
    const a = Mdl.invariants(S), b = Mdl.invariants(Sp);
    h += `<p>回しても変わらない量（不変量）: ${tx(`I_1=${Mdl.fmt(a.I1)}\\to${Mdl.fmt(b.I1)},\\ I_2=${Mdl.fmt(a.I2)}\\to${Mdl.fmt(b.I2)},\\ I_3=${Mdl.fmt(a.I3)}\\to${Mdl.fmt(b.I3)}`)}</p>`;
  }
  $('f-rot').innerHTML = h;

  // --- 3. 固有値
  h = js('<h3>3. 主応力と主軸（固有値問題）</h3>');
  if (!sym) { $('f-eig').innerHTML = h + `<p class="ng">対称でないので扱いません（${cur.strain ? 'ひずみ' : '応力'}テンソルではない）。</p>`; return; }
  h += cur.strain
    ? `<p>主軸の方向では、せん断ひずみが 0 になり、要素は直角を保ったまま伸び縮みするだけになります（${tx('\\bm\\varepsilon\\bm n=\\lambda\\bm n')}）。${tx('\\bm n\\neq\\bm 0')} の解をもつ条件から</p>`
    : `<p>主面では応力ベクトルが法線と平行（${tx('\\bm\\sigma\\bm n=\\lambda\\bm n')}）。${tx('\\bm n\\neq\\bm 0')} の解をもつ条件から</p>`;
  h += Q('\\det(\\bm\\sigma-\\lambda\\bm I)=0\\ \\Longleftrightarrow\\ \\lambda^3-I_1\\lambda^2+I_2\\lambda-I_3=0');
  h += Q('\\begin{aligned}I_1&=\\sigma_{xx}+\\sigma_{yy}+\\sigma_{zz}\\\\I_2&=\\sigma_{xx}\\sigma_{yy}+\\sigma_{yy}\\sigma_{zz}+\\sigma_{zz}\\sigma_{xx}-\\sigma_{xy}^2-\\sigma_{yz}^2-\\sigma_{zx}^2\\\\I_3&=\\det\\bm\\sigma\\end{aligned}');
  const { vals: ev, vecs } = Mdl.eigSym(S);
  if (state.mode === 'load' && !cur.strain) {
    const { terms, bases } = cur;
    h += '<div class="step">STEP 1　この丸棒では σ<sub>yy</sub> = σ<sub>zz</sub> = σ<sub>yz</sub> = 0</div>';
    h += eq('I_1=\\sigma_{xx},\\quad I_2=-(\\sigma_{xy}^2+\\sigma_{xz}^2),\\quad I_3=0');
    h += eq('\\lambda\\left\\{\\lambda^2-\\sigma_{xx}\\lambda-(\\sigma_{xy}^2+\\sigma_{xz}^2)\\right\\}=0\\ \\Longrightarrow\\ \\lambda=\\frac{\\sigma_{xx}}{2}\\pm\\sqrt{\\left(\\frac{\\sigma_{xx}}{2}\\right)^2+\\sigma_{xy}^2+\\sigma_{xz}^2},\\quad 0');
    h += '<div class="step">STEP 2　成分（1. の STEP 3）を代入</div>';
    const half = terms.xx.map((t) => ({ ...t, c: t.c / 2 }));
    const H = Mdl.sumTex(half, bases);
    const wrapP = (tl) => (tl.length > 1 || (tl[0] && tl[0].c < 0) ? `\\left(${Mdl.sumTex(tl, bases)}\\right)` : Mdl.sumTex(tl, bases));
    const sq = [half, terms.xy, terms.xz].filter((tl) => tl.length).map((tl) => `${wrapP(tl)}^2`);
    if (!terms.xy.length && !terms.xz.length) {
      h += eq(`\\lambda=\\sigma_{xx}=${Mdl.sumTex(terms.xx, bases)},\\quad 0,\\quad 0`);
      h += '<p>せん断成分が無いので、はじめから x, y, z が主軸です。</p>';
    } else if (!terms.xx.length) {
      h += eq(`\\lambda=\\pm\\sqrt{${sq.join('+')}},\\quad 0`);
    } else {
      h += eq(`\\lambda=${H}\\pm\\sqrt{${sq.join('+')}},\\quad 0`);
    }
    h += `<p>主軸の向き: ${tx('\\lambda\\neq0')} なら ${tx('\\bm n\\propto(\\lambda,\\ \\sigma_{xy},\\ \\sigma_{xz})')}、${tx('\\lambda=0')} なら ${tx('\\bm n\\propto(0,\\ \\sigma_{xz},\\ -\\sigma_{xy})')}（${tx('(\\bm\\sigma-\\lambda\\bm I)\\bm n=\\bm 0')} の 2・3 行目から）。</p>`;
    h += '<div class="step">STEP 3　数値を代入</div>';
  } else {
    const a = Mdl.invariants(S);
    h += '<div class="step">STEP 1　数値を代入</div>';
    h += eq(`I_1=${Mdl.fmt(a.I1)},\\quad I_2=${Mdl.fmt(a.I2)},\\quad I_3=${Mdl.fmt(a.I3)}`);
    h += eq(`\\lambda^3-(${Mdl.fmt(a.I1)})\\lambda^2+(${Mdl.fmt(a.I2)})\\lambda-(${Mdl.fmt(a.I3)})=0`);
    h += '<div class="step">STEP 2　3 次方程式を解く（数値解）</div>';
  }
  h += Q(`\\sigma_1=${Mdl.fmt(ev[0])},\\quad \\sigma_2=${Mdl.fmt(ev[1])},\\quad \\sigma_3=${Mdl.fmt(ev[2])}${unit}`);
  const vtex = (v) => {
    const s = v.find((x) => Math.abs(x) > 1e-9) < 0 ? -1 : 1; // 最初の非ゼロ成分を正に
    return `\\left(${v.map((x) => Mdl.fmt(s * x, 3)).join(',\\ ')}\\right)`;
  };
  h += eq(`\\bm n_1=${vtex(vecs[0])},\\quad \\bm n_2=${vtex(vecs[1])},\\quad \\bm n_3=${vtex(vecs[2])}`);
  if (cur.strain) {
    h += '<p>等方性の材料では、主ひずみの方向（主軸）は主応力の方向と一致します（フックの法則で、せん断応力が 0 ならせん断ひずみも 0）。</p>';
  }
  h += '<p>「主軸へ回す」を押すと、要素の軸を主軸に合わせ、せん断成分が 0 になるのを確かめられます。</p>';
  $('f-eig').innerHTML = h;
}


// ---------------------------------------------------------------- URL ハッシュ
function buildHash() {
  const p = new URLSearchParams();
  if (state.tn === 'e') {
    p.set('tn', 'e');
    if (state.mat.E !== 206) p.set('E', state.mat.E);
    if (state.mat.nu !== 0.3) p.set('nu', state.mat.nu);
  }
  if (state.mode === 'custom') {
    p.set('m', 'c');
    p.set('c', Mdl.COMP.map((c) => +state.custom[c].toFixed(4)).join(','));
    if (!state.customSym) p.set('cs', '0');
  } else {
    const ld = Mdl.LOAD_KEYS.filter((k) => state.loads[k].on).map((k) => `${k}${state.loads[k].s < 0 ? '-' : ''}${state.loads[k].mag}`);
    if (ld.length) p.set('ld', ld.join(','));
    p.set('pt', [state.pt.xi, state.pt.eta, state.pt.zeta].map((v) => +v.toFixed(3)).join(','));
    if (state.geom.D !== 20) p.set('D', state.geom.D);
    if (state.geom.L !== 200) p.set('L', state.geom.L);
  }
  const r = state.rot;
  if (r.mode === 'axis') {
    if (r.axis !== 'z') p.set('ax', r.axis);
    p.set('th', +r.th.toFixed(6));
  } else p.set('eu', r.eu.map((a) => +a.toFixed(6)).join(','));
  return p.toString().replace(/%2C/g, ',');
}

function applyHash(h) {
  const p = new URLSearchParams(h);
  Object.assign(state, defaultState());
  if (p.get('tn') === 'e') state.tn = 'e';
  if (+p.get('E') > 0) state.mat.E = +p.get('E');
  if (p.has('nu') && +p.get('nu') >= 0 && +p.get('nu') < 0.5) state.mat.nu = +p.get('nu');
  if (p.get('m') === 'c') {
    state.mode = 'custom';
    const v = (p.get('c') || '').split(',').map(Number);
    Mdl.COMP.forEach((c, i) => { state.custom[c] = Number.isFinite(v[i]) ? v[i] : 0; });
    state.customSym = p.get('cs') !== '0';
  } else if (p.has('ld') || p.has('pt')) {
    for (const k of Mdl.LOAD_KEYS) state.loads[k] = { on: false, mag: DEF_MAG[k], s: 1 };
    for (const tok of (p.get('ld') || '').split(',')) {
      const m = tok.match(/^([PTMF])(-?)([\d.]+)$/);
      if (m) state.loads[m[1]] = { on: true, s: m[2] ? -1 : 1, mag: Math.max(0, +m[3]) };
    }
    const v = (p.get('pt') || '').split(',').map(Number);
    if (v.length === 3 && v.every(Number.isFinite)) {
      state.pt.xi = Math.max(0, Math.min(1, v[0]));
      state.pt.eta = Math.max(-1, Math.min(1, v[1]));
      state.pt.zeta = Math.max(-1, Math.min(1, v[2]));
    }
    if (+p.get('D') > 0) state.geom.D = +p.get('D');
    if (+p.get('L') > 0) state.geom.L = +p.get('L');
  }
  if (p.has('eu')) {
    const v = p.get('eu').split(',').map(Number);
    if (v.length === 3 && v.every(Number.isFinite)) { state.rot.mode = 'euler'; state.rot.eu = v.map(wrap180); state.rot.eu[1] = Math.max(-90, Math.min(90, v[1])); }
  } else if (p.has('th') || p.has('ax')) {
    state.rot.mode = 'axis';
    if (['x', 'y', 'z'].includes(p.get('ax'))) state.rot.axis = p.get('ax');
    if (p.has('th') && Number.isFinite(+p.get('th'))) state.rot.th = wrap180(+p.get('th'));
  }
}

function scheduleHash() {
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    const h = buildHash();
    if (h !== lastHash) { lastHash = h; history.replaceState(null, '', '#' + h); }
    $('share-url').value = location.origin + location.pathname + '#' + h;
  }, 250);
}
window.addEventListener('hashchange', () => {
  const h = location.hash.replace(/^#/, '');
  if (h === lastHash) return;
  lastHash = h; applyHash(h); render();
});
$('share-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('share-url').value); $('share-copy').textContent = 'コピーしました'; } catch { $('share-url').select(); }
  setTimeout(() => { $('share-copy').textContent = 'URL をコピー'; }, 1500);
});

// ---------------------------------------------------------------- ドラッグ（回転前・丸棒＝視点、回転後＝要素そのもの）
function bindDrag(panel, isElem) {
  panel.svg.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    panel.svg.setPointerCapture(e.pointerId);
    panel.host.classList.add('dragging');
    let lx = e.clientX, ly = e.clientY;
    const move = (ev) => {
      const dx = ev.clientX - lx, dy = ev.clientY - ly; lx = ev.clientX; ly = ev.clientY;
      if (isElem) {
        stopAnim();
        const ax = camera.screenAxes(), k = 0.012;
        let Qm = rotQ();
        Qm = Mdl.mul(Mdl.axisAngleQ(ax.up, dx * k), Qm);
        Qm = Mdl.mul(Mdl.axisAngleQ(ax.right, dy * k), Qm);
        Qm = Mdl.orthonormalize(Qm);
        state.rot.mode = 'euler';
        state.rot.eu = Mdl.eulerFromQ(Qm).map((a) => a * 180 / Math.PI);
      } else {
        camera.yaw = wrap180(camera.yaw - dx * 0.45);
        camera.pitch = Math.max(-89, Math.min(89, camera.pitch + dy * 0.45));
      }
      render({ light: true });
    };
    const up = () => {
      panel.host.classList.remove('dragging');
      panel.svg.removeEventListener('pointermove', move);
      panel.svg.removeEventListener('pointerup', up);
      panel.svg.removeEventListener('pointercancel', up);
      scheduleHash();
    };
    panel.svg.addEventListener('pointermove', move);
    panel.svg.addEventListener('pointerup', up);
    panel.svg.addEventListener('pointercancel', up);
  });
}
bindDrag(rodPanel, false);
bindDrag(elemPanels[0], false);
bindDrag(elemPanels[1], true);

// ---------------------------------------------------------------- まとめて描く
function render(opts = {}) {
  const cur = current();
  syncInputs(opts);
  let ref = 0;
  if (cur.sym) ref = Math.max(...Mdl.eigSym(cur.S).vals.map(Math.abs));
  else ref = Math.max(...cur.S.flat().map(Math.abs));
  // 対称でない行列は応力テンソルではないので、微小要素の図の上に大きく注意を重ねる
  // （図は説明に使うのでそのまま表示し、ドラッグもできる）
  $('elem-warn').hidden = cur.sym;
  if (!cur.sym) {
    $('elem-warn').innerHTML = cur.strain
      ? `<b>ひずみテンソルではありません</b><span>行列が対称でない（${tx('\\varepsilon_{ij}\\ne\\varepsilon_{ji}')}）。ひずみ成分は定義から必ず対称です。図は行列をそのまま描いたものです。</span>`
      : `<b>応力テンソルではありません</b><span>行列が対称でない（${tx('\\sigma_{ij}\\ne\\sigma_{ji}')}）ので、モーメントのつり合いを満たす微小要素は存在しません。図は行列をそのまま描いたものです。</span>`;
  }
  $('elem-hint').textContent = cur.strain
    ? '実線が変形後の要素、点線が変形前の要素です（ひずみは小さいので誇張して描いています）。垂直ひずみで辺が伸び縮みし、せん断ひずみで直角がずれます。主軸へ回すと、直角を保ったまま伸び縮みするだけになります。'
    : '実線の矢印は正の面（外向き法線が軸の正の向き）、点線は負の面の応力。赤は引張・青は圧縮・緑はせん断で、長さは応力の大きさに比例します（回転前後で同じ縮尺）。';
  $('mohr-title').textContent = cur.strain ? 'モールのひずみ円' : 'モールの応力円';
  renderRod(cur);
  const drawElem = cur.strain ? renderStrainElement : renderElement;
  drawElem(elemPanels[0], cur.S, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], false, ref, false);
  drawElem(elemPanels[1], cur.Sp, cur.Q, true, ref, true);
  const u = cur.strain ? '×10⁻⁶' : 'MPa';
  renderMatrix($('mat0'), cur.S, false, ref, `回転前 ${tx(`\\bm{${SY()}}`)} [${u}]`);
  renderMatrix($('mat1'), cur.Sp, true, ref, `回転後 ${tx(`\\bm{${SY()}}'`)} [${u}]`);
  renderMohr(cur);
  // 式（KaTeX）は重いので、ドラッグ・アニメーション中は間引く
  clearTimeout(formulaTimer);
  if (opts.light) formulaTimer = window.setTimeout(() => renderFormulas(current()), 180);
  else renderFormulas(cur);
  scheduleHash();
}

// KaTeX（defer）の読み込みを待ってから最初の描画
function boot() {
  applyHash(location.hash.replace(/^#/, ''));
  lastHash = location.hash.replace(/^#/, '');
  for (const el of document.querySelectorAll('.tex[data-tex]')) K().render(el.dataset.tex, el, { throwOnError: false });
  for (const k of Mdl.LOAD_KEYS) loadRows[k].querySelector('.sym').innerHTML = tx(k);
  render();
}
if (window.katex) boot(); else window.addEventListener('load', boot);
