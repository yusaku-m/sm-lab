// SFD・BMD — 状態と配線
import {
  solveReactions, forceItems, sectionAt, diagram, sectionFormulas, intervalTex, loadNames,
  fmt, posTex, signed, DIST_SHAPES,
} from './model.js';
import { toRational } from '../equilibrium/model.js';
import { BeamFigure, DiagramPlot, COLORS, P_MAX, C_MAX, W_MAX, V_COLOR, M_COLOR } from './figure.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- 状態

const PRESETS = [
  {
    label: '単純支持・集中荷重',
    make: () => ({
      supports: [{ type: 'pin', t: 0 }, { type: 'roller', t: 1 }],
      loads: [{ type: 'point', t: 1 / 3, P: 6, up: false }],
    }),
  },
  {
    label: '単純支持・等分布荷重',
    make: () => ({
      supports: [{ type: 'pin', t: 0 }, { type: 'roller', t: 1 }],
      loads: [{ type: 'dist', t1: 0, t2: 1, w: 8, shape: 'u', up: false }],
    }),
  },
  {
    label: '単純支持・集中モーメント',
    make: () => ({
      supports: [{ type: 'pin', t: 0 }, { type: 'roller', t: 1 }],
      loads: [{ type: 'moment', t: 1 / 2, C: 6 }],
    }),
  },
  {
    label: '片持ち・集中荷重',
    make: () => ({
      supports: [{ type: 'fixed', t: 0 }],
      loads: [{ type: 'point', t: 1, P: 5, up: false }],
    }),
  },
  {
    label: '片持ち・等分布荷重',
    make: () => ({
      supports: [{ type: 'fixed', t: 0 }],
      loads: [{ type: 'dist', t1: 0, t2: 1, w: 6, shape: 'u', up: false }],
    }),
  },
  {
    label: '三角形分布（単純支持）',
    make: () => ({
      supports: [{ type: 'pin', t: 0 }, { type: 'roller', t: 1 }],
      loads: [{ type: 'dist', t1: 0, t2: 1, w: 12, shape: 'r', up: false }],
    }),
  },
  {
    label: '張り出し梁',
    make: () => ({
      supports: [{ type: 'pin', t: 0 }, { type: 'roller', t: 3 / 4 }],
      loads: [{ type: 'dist', t1: 0, t2: 3 / 4, w: 6, shape: 'u', up: false }, { type: 'point', t: 1, P: 4, up: false }],
    }),
  },
];

const DEFAULT = () => ({
  Lmm: 2000,
  ...PRESETS[0].make(),
  xs: 0.4,
  showGhost: true,
  showValues: false,
});

// URL の荷重・支点の略号（applyHash() が起動直後に使うのでここで宣言する）
const SUP_KEY = { pin: 'p', roller: 'r', fixed: 'f' };
const KEY_SUP = { p: 'pin', r: 'roller', f: 'fixed' };
const LOAD_KEY = { point: 'p', moment: 'c', dist: 'd' };
const KEY_LOAD = { p: 'point', c: 'moment', d: 'dist' };
const MAX_LOADS = COLORS.length;

let state = DEFAULT();
state.sel = { kind: 'load', k: 0 };
let ctx = null;         // { sol, items, dia, sec, names }
let hashTimer = 0;
let lastHash = '';
let anim = null;

applyHash(location.hash.replace(/^#/, ''));

const beam = new BeamFigure($('beam'), {
  onChange: (ch) => {
    if (!ch) { draw(); return; }
    if (ch.load) state.loads[ch.load.k] = ch.load.value;
    if (ch.support) state.supports[ch.support.k] = ch.support.value;
    update();
  },
  onSelect: (sel) => { state.sel = sel; syncLists(); },
  onCut: (t) => { stopAnim(); setCut(t); },
});
const plotOpts = (key) => ({
  onCut: (t) => {
    if (t === null) return;
    stopAnim();
    setCut(t);
  },
  key,
});
const sfd = new DiagramPlot($('sfd'), { ...plotOpts('V'), color: V_COLOR, unit: 'kN', title: 'せん断力図' });
const bmd = new DiagramPlot($('bmd'), { ...plotOpts('M'), color: M_COLOR, unit: 'kN\\cdot m', title: '曲げモーメント図' });

// ---------------------------------------------------------------- 更新

function Lm() { return state.Lmm / 1000; }
function modelState() { return { supports: state.supports, loads: state.loads, Lm: Lm() }; }

function update() {
  const ms = modelState();
  const sol = solveReactions(ms);
  const items = forceItems(ms, sol);
  const dia = diagram(ms, items);
  ctx = { sol, items, dia, names: loadNames(state.loads) };
  syncLists();
  draw();
  syncHash();
}

/** 断面の位置だけが変わったとき（アニメーション中も毎フレームこれ） */
function draw() {
  if (!ctx) return;
  const ok = ctx.sol.status === 'solved';
  ctx.sec = ok ? sectionAt(ctx.items, state.xs, Lm()) : null;
  const view = { ...state, showCut: ok };
  beam.render(view, ctx);
  const opt = { ghost: state.showGhost, showCut: ok };
  if (ok) {
    sfd.render(ctx.dia, state.xs, ctx.sec, opt);
    bmd.render(ctx.dia, state.xs, ctx.sec, opt);
  } else {
    const empty = { pts: [{ x: 0, V: 0, M: 0 }, { x: 1, V: 0, M: 0 }], extremes: {}, bps: [0, 1] };
    sfd.render(empty, 0, null, opt);
    bmd.render(empty, 0, null, opt);
  }
  $('sfd').classList.toggle('dim', !ok);
  $('bmd').classList.toggle('dim', !ok);
  setIfIdle($('xs'), String(state.xs));
  $('cut-pos').innerHTML = tex(`x = ${posShort(state.xs)}`) + `（${fmt(state.xs * state.Lmm, 0)} mm）`;
  renderStatus();
  renderFormulas();
}

function setCut(t) {
  state.xs = Math.min(1, Math.max(0, t));
  draw();
  syncHash();
}

/** 断面の位置の短い表記（分数に直せるなら \frac{1}{3}L、でなければ 0.42L） */
function posShort(t) {
  const r = toRational(t, 60);
  if (r && r[1] <= 12) return posTex(t, 'L');
  return `${fmt(t, 2)}L`;
}

// ---------------------------------------------------------------- 一覧（支点・荷重）

function setIfIdle(el, v) {
  if (el && document.activeElement !== el && el.value !== v) el.value = v;
}

const posField = (f, label = '位置') => `<label class="lf"><span>${label}</span>
  <input data-f="${f}" type="text" autocomplete="off" spellcheck="false" aria-label="${label}（例: 2L/3, 0.4L, 250）">
  <span class="pos-mm" data-mm="${f}"></span></label>`;
const POS_KEY = { pos: 't', t1: 't1', t2: 't2' };

const LOAD_FIELDS = {
  point: () => `${posField('pos')}
    <label class="lf"><span>大きさ</span><input data-f="P" type="number" min="0" max="${P_MAX}" step="0.5"><span class="u">kN</span></label>
    <label class="lf"><span>向き</span><select data-f="up"><option value="down">下向き</option><option value="up">上向き</option></select></label>`,
  moment: () => `${posField('pos')}
    <label class="lf"><span>大きさ</span><input data-f="C" type="number" min="0" max="${C_MAX}" step="0.5"><span class="u">kN·m</span></label>
    <label class="lf"><span>向き</span><select data-f="sense"><option value="ccw">反時計まわり</option><option value="cw">時計まわり</option></select></label>`,
  dist: () => `${posField('t1', '始点')}${posField('t2', '終点')}
    <label class="lf"><span>強さ</span><input data-f="w" type="number" min="0" max="${W_MAX}" step="0.5"><span class="u">kN/m</span></label>
    <label class="lf"><span>形</span><select data-f="shape">${Object.entries(DIST_SHAPES).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}</select></label>
    <label class="lf"><span>向き</span><select data-f="up"><option value="down">下向き</option><option value="up">上向き</option></select></label>`,
};
const LOAD_LABEL = { point: '集中荷重', moment: '集中モーメント', dist: '分布荷重' };
const SUP_LABEL = { pin: 'ピン', roller: 'ローラー', fixed: '固定' };

function syncLists() {
  const sl = $('support-list'), ll = $('load-list');
  const sig = state.supports.map((s) => s.type).join(',') + '|' + state.loads.map((a) => a.type).join(',');
  if (sl.dataset.sig !== sig || ll.children.length !== state.loads.length) buildLists(sig);
  const reacts = ctx ? ctx.sol.reactions : [];
  state.supports.forEach((sp, i) => {
    const row = sl.children[i];
    row.classList.toggle('selected', state.sel.kind === 'support' && state.sel.k === i);
    setIfIdle(row.querySelector('[data-f="type"]'), sp.type);
    setIfIdle(row.querySelector('[data-f="pos"]'), posText(sp.t));
    row.querySelector('[data-f="pos"]').disabled = sp.type === 'fixed';
    row.querySelector('.pos-mm').textContent = `= ${fmt(sp.t * state.Lmm, 1)} mm`;
    const mine = reacts.filter((r) => r.support === i);
    row.querySelector('.solved').innerHTML = ctx && ctx.sol.status === 'solved'
      ? tex(mine.map((r) => `${r.sym} = ${signed(r.value)}\\,\\mathrm{${r.kind === 'R' ? 'kN' : 'kN\\cdot m'}}`).join(',\\ '))
      : '';
  });
  state.loads.forEach((a, k) => {
    const row = ll.children[k];
    const q = (f) => row.querySelector(`[data-f="${f}"]`);
    row.classList.toggle('selected', state.sel.kind === 'load' && state.sel.k === k);
    for (const [f, key] of Object.entries(POS_KEY)) {
      if (!q(f)) continue;
      setIfIdle(q(f), posText(a[key]));
      row.querySelector(`.pos-mm[data-mm="${f}"]`).textContent = `= ${fmt(a[key] * state.Lmm, 1)} mm`;
    }
    if (a.type === 'point') { setIfIdle(q('P'), String(fmt(a.P, 2))); setIfIdle(q('up'), a.up ? 'up' : 'down'); }
    if (a.type === 'moment') { setIfIdle(q('C'), String(fmt(Math.abs(a.C), 2))); setIfIdle(q('sense'), a.C >= 0 ? 'ccw' : 'cw'); }
    if (a.type === 'dist') {
      setIfIdle(q('w'), String(fmt(a.w, 2)));
      setIfIdle(q('shape'), a.shape);
      setIfIdle(q('up'), a.up ? 'up' : 'down');
    }
  });
  for (const b of document.querySelectorAll('.add-load')) b.disabled = state.loads.length >= MAX_LOADS;
  for (const b of document.querySelectorAll('.add-sup')) b.disabled = state.supports.length >= 4;
  setIfIdle($('Lmm'), String(state.Lmm));
  $('show-ghost').checked = state.showGhost;
  $('show-values').checked = state.showValues;
}

function buildLists(sig) {
  const sl = $('support-list'), ll = $('load-list');
  sl.dataset.sig = sig;
  sl.replaceChildren();
  ll.replaceChildren();
  const commit = () => { stopAnim(); update(); };

  state.supports.forEach((sp, i) => {
    const row = document.createElement('div');
    row.className = 'load-row type-support';
    row.style.setProperty('--c', '#2f8f6f');
    row.innerHTML = `
      <label class="lf"><span>種類</span><select data-f="type">${Object.entries(SUP_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      ${posField('pos')}
      <span class="lf solved"></span>
      <button class="btn del" type="button" data-f="del" aria-label="消す">×</button>`;
    sl.append(row);
    const q = (f) => row.querySelector(`[data-f="${f}"]`);
    row.addEventListener('focusin', () => { state.sel = { kind: 'support', k: i }; syncLists(); draw(); });
    q('type').addEventListener('change', (e) => {
      const s2 = state.supports[i];
      s2.type = e.target.value;
      if (s2.type === 'fixed') s2.t = s2.t < 0.5 ? 0 : 1; // 固定は端だけ
      commit();
    });
    q('pos').addEventListener('change', (e) => {
      const t = parsePos(e.target.value);
      if (t !== null) state.supports[i].t = t;
      e.target.value = posText(state.supports[i].t);
      commit();
    });
    q('del').addEventListener('click', () => { state.supports.splice(i, 1); sl.dataset.sig = ''; commit(); });
  });

  state.loads.forEach((a, k) => {
    const nm = loadNames(state.loads)[k];
    const row = document.createElement('div');
    row.className = `load-row type-${a.type}`;
    row.style.setProperty('--c', COLORS[k % COLORS.length]);
    row.innerHTML = `
      <button class="chip" type="button" data-f="sel" title="${LOAD_LABEL[a.type]}"><span class="tex" data-tex="${nm.sym}"></span></button>
      <span class="kind">${LOAD_LABEL[a.type]}</span>
      ${LOAD_FIELDS[a.type]()}
      <button class="btn del" type="button" data-f="del" aria-label="消す">×</button>`;
    ll.append(row);
    renderTex(row);
    const q = (f) => row.querySelector(`[data-f="${f}"]`);
    const on = (f, ev, fn) => { const el = q(f); if (el) el.addEventListener(ev, fn); };
    row.addEventListener('focusin', () => { state.sel = { kind: 'load', k }; syncLists(); draw(); });
    on('sel', 'click', () => { state.sel = { kind: 'load', k }; syncLists(); draw(); });
    for (const [f, key] of Object.entries(POS_KEY)) {
      on(f, 'change', (e) => {
        const a2 = state.loads[k];
        const t = parsePos(e.target.value);
        if (t !== null) a2[key] = t;
        if (a2.type === 'dist' && a2.t1 > a2.t2) [a2.t1, a2.t2] = [a2.t2, a2.t1];
        e.target.value = posText(a2[key]);
        commit();
      });
    }
    const num = (f, key, max) => on(f, 'input', (e) => {
      const v = parseFloat(e.target.value);
      if (!isFinite(v)) return;
      state.loads[k][key] = Math.min(max, Math.max(0, v));
      commit();
    });
    num('P', 'P', P_MAX);
    num('w', 'w', W_MAX);
    on('up', 'change', (e) => { state.loads[k].up = e.target.value === 'up'; commit(); });
    on('shape', 'change', (e) => { state.loads[k].shape = e.target.value; commit(); });
    const setC = () => {
      let v = parseFloat(q('C').value);
      if (!isFinite(v)) v = Math.abs(state.loads[k].C);
      state.loads[k].C = (q('sense').value === 'ccw' ? 1 : -1) * Math.min(C_MAX, Math.max(0, v));
      commit();
    };
    on('C', 'input', setC);
    on('sense', 'change', setC);
    on('del', 'click', () => {
      state.loads.splice(k, 1);
      if (state.sel.kind === 'load' && state.sel.k >= state.loads.length) state.sel = { kind: 'load', k: state.loads.length - 1 };
      sl.dataset.sig = '';
      commit();
    });
  });
}

function posText(t) {
  const r = toRational(Math.abs(t));
  if (!r) return `${fmt(t, 3)}L`;
  const [n, d] = r;
  if (n === 0) return '0';
  const head = n === 1 ? 'L' : `${n}L`;
  return d === 1 ? head : `${head}/${d}`;
}

/** 位置の入力を読む。"2L/3"・"L/2"・"0.4L"・"2/3L" は長さの分数、数字だけは mm。 */
function parsePos(str) {
  const s = String(str).replace(/\s+/g, '').replace(/ｌ|Ｌ/g, 'L').replace(/／/g, '/');
  let m;
  const c01 = (v) => Math.min(1, Math.max(0, v));
  if ((m = s.match(/^(\d*\.?\d*)L(?:\/(\d+))?$/i))) {
    const n = m[1] === '' ? 1 : parseFloat(m[1]);
    const d = m[2] ? parseInt(m[2], 10) : 1;
    return isFinite(n) && d > 0 ? c01(n / d) : null;
  }
  if ((m = s.match(/^(\d+)\/(\d+)L$/i))) return c01(+m[1] / +m[2]);
  const v = parseFloat(s);
  return isFinite(v) ? c01(v / state.Lmm) : null;
}

function addLoad(type) {
  if (state.loads.length >= MAX_LOADS) return;
  const free = (c) => !state.loads.some((a) => Math.abs((a.t ?? -1) - c) < 1e-6);
  const t = [1 / 2, 1 / 4, 3 / 4, 1 / 3, 2 / 3, 1].find(free) ?? 0.5;
  if (type === 'point') state.loads.push({ type, t, P: 5, up: false });
  if (type === 'moment') state.loads.push({ type, t, C: 4 });
  if (type === 'dist') state.loads.push({ type, t1: 0, t2: 1, w: 4, shape: 'u', up: false });
  state.sel = { kind: 'load', k: state.loads.length - 1 };
}

function addSupport(type) {
  if (state.supports.length >= 4) return;
  const used = (t) => state.supports.some((s) => Math.abs(s.t - t) < 1e-6);
  let t;
  if (type === 'fixed') t = used(0) ? 1 : 0;
  else t = [0, 1, 1 / 2, 3 / 4, 1 / 4].find((c) => !used(c)) ?? 0.5;
  state.supports.push({ type, t });
  state.sel = { kind: 'support', k: state.supports.length - 1 };
}

// ---------------------------------------------------------------- 式

function tex(s) {
  if (typeof katex === 'undefined') return s;
  return katex.renderToString(s, { throwOnError: false, displayMode: false });
}
function texD(s) {
  if (typeof katex === 'undefined') return `<div class="eq">${s}</div>`;
  return `<div class="eq">${katex.renderToString(s, { throwOnError: false, displayMode: true })}</div>`;
}
function renderTex(root = document) {
  if (typeof katex === 'undefined') return;
  for (const el of root.querySelectorAll('.tex[data-tex]')) katex.render(el.dataset.tex, el, { throwOnError: false });
}

function statusMessage() {
  const st = ctx.sol.status;
  if (st === 'none') return '支点がありません。「＋ ピン」「＋ ローラー」「＋ 固定」で支点を置いてください。';
  if (st === 'under') return '反力が決まりません（不静定梁か、支点の組み合わせが足りない）。この単元は静定梁だけを扱います。';
  if (st === 'inconsistent') return 'この支え方では梁がつり合えません（不安定）。支点を足すか、種類を変えてください。';
  return '';
}

function renderStatus() {
  const st = $('status');
  if (ctx.sol.status !== 'solved') { st.innerHTML = `<span class="sense">${statusMessage()}</span>`; return; }
  const { V, M } = ctx.sec;
  st.innerHTML = `<span class="val-v">${tex(`V = ${signed(V)}\\ \\mathrm{kN}`)}</span>`
    + `<span class="val-m">${tex(`M = ${signed(M)}\\ \\mathrm{kN\\cdot m}`)}</span>`
    + `<span class="fsum">${tex(`x = ${posShort(state.xs)}`)}</span>`;
}

function renderFormulas() {
  const secBox = $('section-box'), rBox = $('reaction-box'), mBox = $('max-box');
  if (ctx.sol.status !== 'solved') {
    secBox.innerHTML = `<p class="why ng">${statusMessage()}</p>`;
    rBox.hidden = true; mBox.hidden = true;
    return;
  }
  rBox.hidden = false; mBox.hidden = false;
  const f = sectionFormulas(modelState(), ctx.items, state.xs);
  const { V, M } = ctx.sec;
  secBox.innerHTML = `<div class="cap">仮想断面を ${tex(intervalTex(f.interval))} にとったとき（いま ${tex(`x = ${posShort(state.xs)}`)}）</div>`
    + '<p class="why">力のつり合い（上向き正）から：</p>'
    + texD(`V = ${f.V}`)
    + texD(`\\phantom{V} = ${signed(V)}\\ \\mathrm{kN}`)
    + '<p class="why">断面まわりのモーメントのつり合いから：</p>'
    + texD(`M = ${f.M}`)
    + texD(`\\phantom{M} = ${signed(M)}\\ \\mathrm{kN\\cdot m}`)
    + '<p class="why">区間の境目（荷重・支点・分布荷重の端）を越えると式の形が変わります。通り過ぎた分布荷重は合力に置きかえています。</p>';

  const lines = ctx.sol.lines;
  rBox.innerHTML = `<div class="cap">反力（梁全体のつり合い。上向き・反時計まわりを仮定。${tex('M_{O}')} は左端 O まわりのモーメント）</div>`
    + lines.equil.map(texD).join('')
    + '<p class="why">これを解くと：</p>'
    + lines.solution.map(texD).join('')
    + (ctx.sol.reactions.some((r) => r.value < -1e-9) ? '<p class="why">負の値は、仮定と逆向きということ。</p>' : '');

  const e = ctx.dia.extremes;
  const at = (x) => posShort(x);
  const absMax = (a, b) => (!a ? b : !b ? a : Math.abs(a.v) >= Math.abs(b.v) ? a : b);
  const vm = absMax(e.Vmax, e.Vmin), mm = absMax(e.Mmax, e.Mmin);
  mBox.innerHTML = '<div class="cap">最大値（絶対値）</div>'
    + (vm ? texD(`|V|_{\\max} = ${fmt(Math.abs(vm.v))}\\ \\mathrm{kN}\\quad (x = ${at(vm.x)})`) : '')
    + (mm ? texD(`|M|_{\\max} = ${fmt(Math.abs(mm.v))}\\ \\mathrm{kN\\cdot m}\\quad (x = ${at(mm.x)})`) : '');
}

// ---------------------------------------------------------------- アニメーション
//
// 断面を左端から右端へ一定の速さで動かす。右端に着いたら少し止めてから左端へ戻る。

const playBtn = $('play');
const ANIM_SEC = 6;
const HOLD_SEC = 1.2;

function startAnim() {
  if (!ctx || ctx.sol.status !== 'solved') return;
  const t0 = state.xs >= 0.999 ? 0 : state.xs;
  anim = { start: performance.now() - (t0 * ANIM_SEC * 1000) };
  playBtn.setAttribute('aria-pressed', 'true');
  playBtn.querySelector('.lbl').textContent = '止める';
  requestAnimationFrame(tick);
}

function stopAnim() {
  if (!anim) return;
  anim = null;
  playBtn.setAttribute('aria-pressed', 'false');
  playBtn.querySelector('.lbl').textContent = '断面を動かす';
  syncHash();
}

function tick(now) {
  if (!anim) return;
  let s = (now - anim.start) / 1000;
  if (s > ANIM_SEC + HOLD_SEC) { anim.start = now; s = 0; }
  state.xs = Math.min(1, s / ANIM_SEC);
  draw();
  requestAnimationFrame(tick);
}

playBtn.addEventListener('click', () => (anim ? stopAnim() : startAnim()));

// ---------------------------------------------------------------- 操作パネル

$('xs').addEventListener('input', (e) => { stopAnim(); setCut(parseFloat(e.target.value)); });
for (const b of document.querySelectorAll('.add-load')) b.addEventListener('click', () => { stopAnim(); addLoad(b.dataset.type); update(); });
for (const b of document.querySelectorAll('.add-sup')) b.addEventListener('click', () => { stopAnim(); addSupport(b.dataset.type); update(); });
$('Lmm').addEventListener('change', (e) => {
  const v = parseFloat(e.target.value);
  if (isFinite(v) && v > 0) state.Lmm = Math.min(100000, v);
  e.target.value = String(state.Lmm);
  update();
});
$('show-ghost').addEventListener('change', (e) => { state.showGhost = e.target.checked; draw(); });
$('show-values').addEventListener('change', (e) => { state.showValues = e.target.checked; update(); });

for (const p of PRESETS) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.type = 'button';
  b.textContent = p.label;
  b.addEventListener('click', () => {
    stopAnim();
    Object.assign(state, p.make());
    state.sel = { kind: 'load', k: 0 };
    update();
  });
  $('presets').append(b);
}

// ---------------------------------------------------------------- URL ハッシュ
//
// 例: #L=2000&s=p,0;r,1&a=p,0.333333,6,-1;c,0.5,6;d,0,1,8,u,-1&x=0.4&g=1&v=0
//   s … 支点（p ピン・r ローラー・f 固定, 位置）
//   a … 集中荷重 p,t,P,向き（1 上・-1 下）／集中モーメント c,t,C（反時計まわり正）
//       ／分布荷重 d,t1,t2,w,形（u|r|l）,向き

function buildHash() {
  const s = state.supports.map((x) => `${SUP_KEY[x.type]},${fmt(x.t, 6)}`).join(';');
  const a = state.loads.map((x) => {
    const k = LOAD_KEY[x.type];
    if (x.type === 'point') return [k, fmt(x.t, 6), fmt(x.P, 3), x.up ? 1 : -1].join(',');
    if (x.type === 'moment') return [k, fmt(x.t, 6), fmt(x.C, 3)].join(',');
    return [k, fmt(x.t1, 6), fmt(x.t2, 6), fmt(x.w, 3), x.shape, x.up ? 1 : -1].join(',');
  }).join(';');
  return [`L=${fmt(state.Lmm, 3)}`, `s=${s || '-'}`, `a=${a || '-'}`, `x=${fmt(state.xs, 4)}`,
    `g=${state.showGhost ? 1 : 0}`, `v=${state.showValues ? 1 : 0}`].join('&');
}

function exactFrac(t) {
  for (let d = 1; d <= 60; d++) {
    const n = Math.round(t * d);
    if (Math.abs(t - n / d) < 2e-6) return n / d;
  }
  return t;
}

function applyHash(h) {
  const d = DEFAULT();
  const q = new URLSearchParams(h);
  const c01 = (v) => exactFrac(Math.min(1, Math.max(0, +v || 0)));
  const L = parseFloat(q.get('L'));
  state.Lmm = isFinite(L) && L > 0 ? Math.min(100000, L) : d.Lmm;
  const xs = parseFloat(q.get('x'));
  state.xs = isFinite(xs) ? Math.min(1, Math.max(0, xs)) : d.xs;
  state.showGhost = q.get('g') !== '0';
  state.showValues = q.get('v') === '1';
  const s = q.get('s');
  if (s === null) state.supports = d.supports;
  else if (s === '-' || s === '') state.supports = [];
  else {
    state.supports = s.split(';').map((e) => {
      const f = e.split(',');
      const type = KEY_SUP[f[0]];
      if (!type) return null;
      const t = c01(f[1]);
      return { type, t: type === 'fixed' ? (t < 0.5 ? 0 : 1) : t };
    }).filter(Boolean).slice(0, 4);
  }
  const a = q.get('a');
  if (a === null) state.loads = d.loads;
  else if (a === '-' || a === '') state.loads = [];
  else {
    state.loads = a.split(';').map((e) => {
      const f = e.split(',');
      const type = KEY_LOAD[f[0]];
      if (type === 'point') return { type, t: c01(f[1]), P: Math.min(P_MAX, Math.max(0, +f[2] || 0)), up: +f[3] > 0 };
      if (type === 'moment') return { type, t: c01(f[1]), C: Math.max(-C_MAX, Math.min(C_MAX, +f[2] || 0)) };
      if (type === 'dist') {
        const t1 = c01(f[1]), t2 = c01(f[2]);
        return {
          type, t1: Math.min(t1, t2), t2: Math.max(t1, t2), w: Math.min(W_MAX, Math.max(0, +f[3] || 0)),
          shape: DIST_SHAPES[f[4]] ? f[4] : 'u', up: +f[5] > 0,
        };
      }
      return null;
    }).filter(Boolean).slice(0, MAX_LOADS);
  }
  state.sel = { kind: 'load', k: 0 };
}

function syncHash() {
  if (anim) return; // アニメーション中は履歴を書き換えない（止めたときに書く）
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    const h = buildHash();
    if (h === lastHash) return;
    lastHash = h;
    try { history.replaceState(null, '', '#' + h); } catch (e) { /* file:// など */ }
    if (!$('share-body').hidden) renderShare();
  }, 350);
}

window.addEventListener('hashchange', () => {
  const h = location.hash.replace(/^#/, '');
  if (!h || h === lastHash) return;
  lastHash = h;
  stopAnim();
  applyHash(h);
  $('support-list').dataset.sig = '';
  update();
});

// ---------------------------------------------------------------- 共有（URL / QR）。mohr/・equilibrium/ と同じ実装

function shareUrl() { return location.origin + location.pathname + '#' + buildHash(); }
const QR_PX = 224;
const QR_SCALE = 3;

function svgToPngDataUrl(svgText, px) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = px; cv.height = px;
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
  if (typeof QRCode === 'undefined') { host.textContent = 'QR コードを生成できませんでした（ライブラリの読み込み失敗）'; return; }
  // padding（クワイエットゾーン）は 4 以上。詰めると読めない（mohr/ で実機確認）
  const svg = new QRCode({ content: url, padding: 4, width: QR_PX, height: QR_PX, color: '#000000', background: '#ffffff', ecl: 'M', join: true }).svg();
  try {
    const img = document.createElement('img');
    img.src = await svgToPngDataUrl(svg, QR_PX * QR_SCALE);
    img.width = QR_PX; img.height = QR_PX;
    img.alt = 'この設定を開く QR コード';
    img.title = '右クリック（スマホは長押し）でコピー・保存できます';
    host.replaceChildren(img);
  } catch (e) {
    host.innerHTML = svg;
  }
}

$('share-toggle').addEventListener('click', () => {
  const body = $('share-body');
  body.hidden = !body.hidden;
  $('share-toggle').setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
  if (!body.hidden) { renderShare(); body.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
});

$('share-copy').addEventListener('click', async () => {
  const url = shareUrl();
  let ok = true;
  try { await navigator.clipboard.writeText(url); } catch (e) {
    try { $('share-url').select(); ok = document.execCommand('copy'); } catch (e2) { ok = false; }
  }
  const b = $('share-copy');
  b.textContent = ok ? 'コピーしました' : '選択してコピーしてください';
  window.setTimeout(() => { b.textContent = 'コピー'; }, 1600);
});

// ---------------------------------------------------------------- 起動

function boot() {
  renderTex();
  update();
}

window.__sfd = { state, update, get ctx() { return ctx; }, beam, sfd, bmd };

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();
