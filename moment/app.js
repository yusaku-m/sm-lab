// モーメントのつり合い — 状態と配線
import {
  ACTION_TYPES, actionType, analyze, sumLines, decompose, compose, posText, fmt, namesOf,
  senseText, accelerations, clamp01, snapTilt, ANIM_T, posTex, angleTex, lengthSym, signed,
} from './model.js';
import { MomentFigure, COLORS, P_MAX, C_MAX } from './figure.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- 状態

const DEFAULT = () => ({
  mode: 'pin',       // 'pin'（O で回転だけ許して支える）| 'free'（自由体）
  notation: 'L',     // 長さの記号: 'L'（棒全体）| 'x'（切り取った自由体の長さ）
  Lmm: 1000,
  tO: 0,
  actions: [
    { type: 'point', t: 0.5, P: 6, dir: -90 },
    { type: 'point', t: 1, P: 4, dir: 90 },
  ],
  showEach: true,
  showValues: false,
});

const PRESETS = [
  {
    label: '左端が O（資料の図）',
    make: () => ({ mode: 'pin', tO: 0, actions: [
      { type: 'point', t: 1, P: 5, dir: 90 },
      { type: 'point', t: 0.5, P: 8, dir: compose(false, 30) },
    ] }),
  },
  {
    label: '回らない力を求める',
    make: () => ({ mode: 'pin', tO: 0, actions: [
      { type: 'point', t: 0.5, P: 6, dir: compose(false, 30) },
      { type: 'reaction', t: 1, dir: 90 },
    ] }),
  },
  {
    label: 'てこのつり合い',
    make: () => ({ mode: 'pin', tO: 1 / 3, actions: [
      { type: 'point', t: 0, P: 6, dir: -90 },
      { type: 'point', t: 1, P: 3, dir: -90 },
    ] }),
  },
  {
    label: '単純支持の反力（自由体）',
    make: () => ({ mode: 'free', tO: 0, actions: [
      { type: 'reaction', t: 0, dir: 90 },
      { type: 'reaction', t: 1, dir: 90 },
      { type: 'point', t: 1 / 3, P: 9, dir: -90 },
    ] }),
  },
  {
    label: '片持ちの反力（自由体）',
    make: () => ({ mode: 'free', tO: 0, actions: [
      { type: 'reaction', t: 0, dir: 90 },
      { type: 'rmoment', t: 0, sgn: 1 },
      { type: 'point', t: 1, P: 4, dir: -90 },
      { type: 'moment', t: 0.5, C: 2 },
    ] }),
  },
  {
    label: '偶力（自由体）',
    make: () => ({ mode: 'free', tO: 0.5, actions: [
      { type: 'point', t: 0.2, P: 6, dir: 90 },
      { type: 'point', t: 0.8, P: 6, dir: -90 },
    ] }),
  },
];

// URL ハッシュでの荷重の種類の略号（applyHash() が起動直後に使うのでここで宣言する）
const TYPE_KEY = { point: 'p', reaction: 'r', moment: 'c', rmoment: 'm' };
const KEY_TYPE = { p: 'point', r: 'reaction', c: 'moment', m: 'rmoment' };

// update() が触る let はシーン生成より前に宣言しておく（mohr/ と同じ理由）
let state = DEFAULT();
state.sel = 0;
state.animating = false;
let res = null;
let hashTimer = 0;
let lastHash = '';
let anim = null;

applyHash(location.hash.replace(/^#/, ''));

const fig = new MomentFigure($('figure'), {
  onChange: (ch) => {
    if (!ch) { draw(); return; }
    stopAnim();
    if ('tO' in ch) state.tO = ch.tO;
    if (ch.action) state.actions[ch.action.k] = ch.action.value;
    if (ch.add) addAction(ch.add.type, ch.add.t);
    update();
  },
  onSelect: (k) => { state.sel = k; syncList(); },
});

// ---------------------------------------------------------------- 更新

function update() {
  if (state.sel >= state.actions.length) state.sel = state.actions.length - 1;
  res = analyze(ctxState());
  draw();
  syncList();
  renderFormulas();
  renderStatus();
  syncHash();
}

function ctxState() {
  return { ...state, Lm: state.Lmm / 1000 };
}

function draw() {
  if (!res) return;
  fig.render({ ...ctxState(), animating: !!anim }, res, anim ? anim.frame : null);
}

function addAction(type = 'point', t = null) {
  if (state.actions.length >= COLORS.length) return;
  if (t === null) {
    // 空いている位置（既存の荷重と重ならないところ）を探す
    const cands = type === 'point' || type === 'moment'
      ? [0.5, 1, 0.25, 0.75, 1 / 3, 2 / 3, 0, 0.1, 0.9]
      : [0, 1, 0.5, 0.25, 0.75];
    t = cands.find((c) => !state.actions.some((a) => Math.abs(a.t - c) < 1e-6)) ?? 0.5;
  }
  state.actions.push(ACTION_TYPES[type].create(t));
  state.sel = state.actions.length - 1;
}

// ---------------------------------------------------------------- 荷重の一覧

const list = $('load-list');
const lsymNow = () => lengthSym(state);

/** 種類ごとの入力欄 */
const ROW_FIELDS = {
  point: () => `
    ${posField()}
    <label class="lf"><span>大きさ</span>
      <input data-f="P" type="number" min="0" max="${P_MAX}" step="0.5"><span class="u">kN</span></label>
    ${dirFields('向き')}`,
  reaction: () => `
    ${posField()}
    ${dirFields('仮定の向き')}
    <span class="lf solved" data-f="val"></span>`,
  moment: () => `
    ${posField()}
    <label class="lf"><span>大きさ</span>
      <input data-f="C" type="number" min="0" max="${C_MAX}" step="0.5"><span class="u">kN·m</span></label>
    ${senseField('向き')}`,
  rmoment: () => `
    ${posField()}
    ${senseField('仮定の向き')}
    <span class="lf solved" data-f="val"></span>`,
};
const posField = () => `<label class="lf"><span>位置</span>
  <input data-f="pos" type="text" inputmode="text" autocomplete="off" spellcheck="false" aria-label="位置（例: 2L/3, 0.4L, 250）">
  <span class="pos-mm"></span></label>`;
const dirFields = (label) => `<label class="lf"><span>${label}</span>
  <select data-f="up"><option value="up">上向き</option><option value="down">下向き</option></select></label>
  <label class="lf"><span>傾き</span>
  <input data-f="tilt" type="number" min="-90" max="90" step="1"><span class="u">°</span></label>`;
const senseField = (label) => `<label class="lf"><span>${label}</span>
  <select data-f="sense"><option value="ccw">反時計まわり</option><option value="cw">時計まわり</option></select></label>`;

function syncList() {
  const rows = list.querySelectorAll('.load-row');
  const sig = state.actions.map((a) => a.type).join(',') + '|' + state.notation;
  if (rows.length !== state.actions.length || list.dataset.sig !== sig) buildList();
  state.actions.forEach((a, k) => {
    const row = list.children[k];
    const q = (f) => row.querySelector(`[data-f="${f}"]`);
    row.classList.toggle('selected', k === state.sel);
    setIfIdle(q('pos'), posText(a.t, lsymNow()));
    row.querySelector('.pos-mm').textContent = `= ${fmt(a.t * state.Lmm, 1)} mm`;
    if (a.dir !== undefined) {
      const { up, tilt } = decompose(a.dir);
      setIfIdle(q('up'), up ? 'up' : 'down');
      setIfIdle(q('tilt'), String(fmt(tilt, 1)));
    }
    if (a.type === 'point') setIfIdle(q('P'), String(fmt(a.P, 2)));
    if (a.type === 'moment') {
      setIfIdle(q('C'), String(fmt(Math.abs(a.C), 2)));
      setIfIdle(q('sense'), a.C >= 0 ? 'ccw' : 'cw');
    }
    if (a.type === 'rmoment') setIfIdle(q('sense'), a.sgn > 0 ? 'ccw' : 'cw');
    if (q('val')) {
      const u = res && res.unknowns.find((x) => x.k === k);
      q('val').innerHTML = u && u.value !== null
        ? tex(`= ${signed(u.value)}\\,\\mathrm{${u.unit === 'kN' ? 'kN' : 'kN\\cdot m'}}`)
        : '<span class="muted-note">（つり合いの式から求める）</span>';
    }
  });
  for (const b of document.querySelectorAll('.add-btn')) b.disabled = state.actions.length >= COLORS.length;
  $('mode').value = state.mode;
  $('notation').value = state.notation;
  setIfIdle($('Lmm'), String(state.Lmm));
  $('len-sym').dataset.tex = lsymNow();
  renderTex($('len-sym').parentElement);
  $('show-each').checked = state.showEach;
  $('show-values').checked = state.showValues;
}

function setIfIdle(el, v) {
  if (el && document.activeElement !== el && el.value !== v) el.value = v;
}

function buildList() {
  list.replaceChildren();
  list.dataset.sig = state.actions.map((a) => a.type).join(',') + '|' + state.notation;
  state.actions.forEach((a, k) => {
    const nm = namesOf(state.actions, k);
    const color = COLORS[k % COLORS.length];
    const row = document.createElement('div');
    row.className = `load-row type-${a.type}`;
    row.style.setProperty('--c', color);
    row.innerHTML = `
      <button class="chip" type="button" data-f="sel" title="${actionType(a).label}"><span class="tex" data-tex="${nm.sym}"></span></button>
      <span class="kind">${actionType(a).label}</span>
      ${ROW_FIELDS[a.type]()}
      <button class="btn del" type="button" data-f="del" aria-label="消す">×</button>`;
    list.append(row);
    renderTex(row);

    const q = (f) => row.querySelector(`[data-f="${f}"]`);
    const on = (f, ev, fn) => { const el = q(f); if (el) el.addEventListener(ev, fn); };
    const pick = () => { state.sel = k; syncList(); draw(); };
    const commit = () => { stopAnim(); update(); };
    row.addEventListener('focusin', pick);
    on('sel', 'click', pick);
    on('pos', 'change', (e) => {
      const t = parsePos(e.target.value);
      if (t !== null) state.actions[k].t = t;
      e.target.value = posText(state.actions[k].t, lsymNow());
      commit();
    });
    on('P', 'input', (e) => {
      const v = parseFloat(e.target.value);
      if (!isFinite(v)) return;
      state.actions[k].P = Math.min(P_MAX, Math.max(0, v));
      commit();
    });
    const setDir = () => {
      const up = q('up').value === 'up';
      let tilt = parseFloat(q('tilt').value);
      if (!isFinite(tilt)) tilt = 0;
      state.actions[k].dir = compose(up, Math.max(-90, Math.min(90, tilt)));
      commit();
    };
    on('up', 'change', setDir);
    on('tilt', 'input', setDir);
    const setMoment = () => {
      const ccw = q('sense').value === 'ccw';
      const a2 = state.actions[k];
      if (a2.type === 'rmoment') a2.sgn = ccw ? 1 : -1;
      else {
        let v = parseFloat(q('C').value);
        if (!isFinite(v)) v = Math.abs(a2.C);
        a2.C = (ccw ? 1 : -1) * Math.min(C_MAX, Math.max(0, v));
      }
      commit();
    };
    on('sense', 'change', setMoment);
    on('C', 'input', setMoment);
    on('del', 'click', () => {
      state.actions.splice(k, 1);
      stopAnim(); buildList(); update();
    });
  });
}

/** 位置の入力を読む。"2L/3"・"L/2"・"0.4L"・"2/3L"（x も同じ）は長さの分数、数字だけは mm。 */
function parsePos(str) {
  const s = String(str).replace(/\s+/g, '').replace(/ｌ|Ｌ/g, 'L').replace(/ｘ/g, 'x').replace(/／/g, '/');
  let m;
  if ((m = s.match(/^(\d*\.?\d*)[Lx](?:\/(\d+))?$/i))) {
    const n = m[1] === '' ? 1 : parseFloat(m[1]);
    const d = m[2] ? parseInt(m[2], 10) : 1;
    return isFinite(n) && d > 0 ? clamp01(n / d) : null;
  }
  if ((m = s.match(/^(\d+)\/(\d+)[Lx]$/i))) return clamp01(+m[1] / +m[2]);
  const v = parseFloat(s);
  return isFinite(v) ? clamp01(v / state.Lmm) : null;
}

// ---------------------------------------------------------------- 式

function captionOf(a, k) {
  const nm = namesOf(state.actions, k);
  const T = actionType(a);
  const lsym = lsymNow();
  const where = Math.abs(a.t - state.tO) < 1e-9 ? 'O の位置' : `O から ${tex(posTex(a.t - state.tO, lsym))}`;
  if (a.type === 'point' || a.type === 'reaction') {
    const { up, tilt } = decompose(a.dir);
    const head = a.type === 'point'
      ? `<b>${tex(`${nm.sym} = ${fmt(a.P, 2)}\\,\\mathrm{kN}`)}</b>`
      : `<b>${tex(nm.sym)}</b>（大きさ未知）`;
    const dirTxt = (a.type === 'reaction' ? '仮定の向き：' : '') + (up ? '上向き' : '下向き');
    const tiltTxt = Math.abs(tilt) > 0.5
      ? `（鉛直から${tilt > 0 ? '右' : '左'}へ ${tex(`${nm.theta} = ${angleTex(tilt)}`)}）` : '';
    return `${T.label} ${head}、${where}、${dirTxt}${tiltTxt}`;
  }
  if (a.type === 'moment') {
    return `${T.label} <b>${tex(`${nm.sym} = ${fmt(Math.abs(a.C), 2)}\\,\\mathrm{kN\\cdot m}`)}</b>、${a.C >= 0 ? '反時計まわり' : '時計まわり'}`;
  }
  return `${T.label} <b>${tex(nm.sym)}</b>（大きさ未知）、仮定の向き：${a.sgn > 0 ? '反時計まわり' : '時計まわり'}`;
}

function renderFormulas() {
  const host = $('terms');
  const parts = [];
  res.terms.forEach((t, k) => {
    const a = state.actions[k];
    const color = COLORS[k % COLORS.length];
    const unknown = actionType(a).unknown;
    let body;
    if (t.zeroReason) {
      body = texD(`${t.lhs} = 0`) + `<p class="why">${t.zeroReason}ので、O まわりには回さない。</p>`;
    } else {
      let l = `${t.lhs} = ${t.sym.replace(/^\+/, '')}`;
      if (t.simp) l += ` = ${t.simp.replace(/^\+/, '')}`;
      body = texD(l);
      if (t.subst) {
        body += texD(`\\phantom{${t.lhs}} = ${t.subst.replace(/^\+/, '')} = ${signed(t.value)}\\ \\mathrm{kN\\cdot m}`);
      }
      let why = '';
      if (t.couple) why = 'モーメント（集中・反力）は、O をどこにとっても同じ大きさで効く。';
      if (unknown && !t.subst) why += `${tex(t.nm.sym)} が決まれば値が出る。`;
      else why += senseText(t.value);
      body += `<p class="why">${why}</p>`;
    }
    parts.push(`<div class="term" style="--c:${color}"><div class="cap">${captionOf(a, k)}</div>${body}</div>`);
  });
  host.innerHTML = parts.join('') || '<p class="why">荷重がありません。下のボタンか、図の棒をダブルクリックして足してください。</p>';

  const sums = sumLines(ctxState(), res);
  const hasUnk = res.unknowns.length > 0;
  const determined = !hasUnk || res.status === 'solved';
  $('sum').innerHTML = sums.moment.map(texD).join('')
    + (determined ? `<p class="why">合計 ${tex('M_{O}')} は <b>${senseText(res.MO, 5e-7)}</b></p>` : '');
  $('forces').hidden = state.mode !== 'free';
  $('forces-body').innerHTML = sums.force.map(texD).join('');

  $('equil').hidden = !hasUnk;
  if (hasUnk) {
    const eqNames = state.mode === 'free'
      ? `${tex('F_x = 0')}・${tex('F_y = 0')}・${tex('M_{O} = 0')}` : tex('M_{O} = 0');
    let html = `<p class="why">つり合いの条件 ${eqNames} に未知量を含めて立てると：</p>`;
    html += sums.equil.map(texD).join('') || texD('0 = 0');
    if (res.status === 'solved') {
      html += '<p class="why">これを解くと：</p>' + sums.solution.map(texD).join('');
      if (res.unknowns.some((u) => u.value < -1e-9)) {
        html += '<p class="why">負の値は、<b>仮定した向きと逆向き</b>だったということ。</p>';
      }
    } else if (res.status === 'under') {
      html += `<p class="why ng">未知量が決まらない：式の数（${state.mode === 'free' ? 3 : 1} つ）より未知量が多いか、`
        + `未知量が式に現れない（例: O を通る力は ${tex('M_{O}')} に出てこない）。`
        + (state.mode === 'pin' ? 'O の位置を変えるか、自由体にして力のつり合いも使う。' : '') + '</p>';
    } else if (res.status === 'inconsistent') {
      html += '<p class="why ng">未知量をどう選んでもつり合わない（例: 横向きの力を受け持つ反力が無い）。'
        + '反力を足すか、仮定の向き（傾き）を変えてみよう。</p>';
    }
    $('equil-body').innerHTML = html;
  }
  $('verdict').innerHTML = verdictHtml();
}

function verdictHtml() {
  if (res.unknowns.length && res.status !== 'solved') {
    return '<b class="ng">判定できない</b>：未知量が決まらないので、つり合うかどうかも決まらない。';
  }
  const withR = res.unknowns.length ? '（未知量を上で求めた値にとれば）' : '';
  const zM = Math.abs(res.MO) < 5e-7;
  const zF = Math.abs(res.Fx) < 5e-7 && Math.abs(res.Fy) < 5e-7;
  if (state.mode === 'pin') {
    return zM
      ? `<b class="ok">つり合っている</b>${withR}：${tex('M_{O} = 0')} なので棒は回らない（力の合力は O の反力が受け持つ）。`
      : `<b class="ng">つり合っていない</b>：${tex('M_{O} \\neq 0')} なので、棒は O を中心に<b>${senseText(res.MO)}</b>に回り始める。`;
  }
  if (zM && zF) {
    return `<b class="ok">つり合っている</b>${withR}：${tex('F_x = F_y = 0')} かつ ${tex('M_{O} = 0')}。この場合、O をどこに動かしても ${tex('M_{O} = 0')} のまま。`;
  }
  const why = [];
  if (!zF) why.push(`${tex('F \\neq 0')} なので並進する`);
  if (!zM) why.push(`${tex('M_{O} \\neq 0')} なので回る`);
  const extra = zF
    ? `合力が 0 なので、<b>O をどこに動かしても ${tex('M_{O}')} は変わらない</b>（偶力）。`
    : `合力が 0 でないので、${tex('M_{O}')} は O の位置によって変わる。O を動かして確かめてみよう。`;
  return `<b class="ng">つり合っていない</b>：${why.join('、')}。${extra}`;
}

function renderStatus() {
  const st = $('status');
  if (res.unknowns.length) {
    const vals = res.unknowns.map((u) => (u.value === null
      ? `${u.sym} = ?`
      : `${u.sym} = ${signed(u.value)}\\,\\mathrm{${u.unit === 'kN' ? 'kN' : 'kN\\cdot m'}}`));
    st.innerHTML = tex(vals.join(',\\ ')) + `<span class="sense">${res.status === 'solved' ? 'つり合いの式から' : '決まらない'}</span>`;
    return;
  }
  st.innerHTML = `${tex(`M_{O} = ${signed(res.MO)}\\ \\mathrm{kN\\cdot m}`)}`
    + `<span class="sense">${senseText(res.MO, 5e-7)}</span>`
    + (state.mode === 'free'
      ? `<span class="fsum">${tex(`F_x = ${signed(res.Fx)},\\ F_y = ${signed(res.Fy)}\\ \\mathrm{kN}`)}</span>`
      : '');
}

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
  for (const el of root.querySelectorAll('.tex[data-tex]')) {
    katex.render(el.dataset.tex, el, { throwOnError: false, displayMode: false });
  }
}

// ---------------------------------------------------------------- アニメーション
//
// 動き始めの加速度のまま、棒が回る（ピンなら O まわり、自由体なら G まわり＋並進）。
// 未知量は解いた値を入れる（解ければつり合うので動かない）。
// 回転角・移動量が図に収まる上限に達したら止め、0.8 秒止めてから繰り返す。

const playBtn = $('play');

function startAnim() {
  const acc = accelerations(ctxState(), res);
  const still = Math.abs(acc.alpha) < 1e-7 && Math.hypot(acc.ax, acc.ay) < 1e-9;
  anim = { acc, t0: performance.now(), still, frame: { theta: 0, dx: 0, dy: 0, pivot: acc.pivot } };
  playBtn.setAttribute('aria-pressed', 'true');
  playBtn.querySelector('.lbl').textContent = '止める';
  $('figure').classList.add('animating');
  if (still) $('status').classList.add('still');
  requestAnimationFrame(tick);
}

function stopAnim() {
  if (!anim) return;
  anim = null;
  playBtn.setAttribute('aria-pressed', 'false');
  playBtn.querySelector('.lbl').textContent = '動かしてみる';
  $('figure').classList.remove('animating');
  $('status').classList.remove('still');
  draw();
}

function tick(now) {
  if (!anim) return;
  const { acc } = anim;
  const T_MAX = ANIM_T * 1.6, HOLD = 0.8;
  let t = (now - anim.t0) / 1000;
  const lim = fig.animLimits(acc.pivot);
  const reach = (limit, a) => (Math.abs(a) > 1e-9 ? Math.sqrt((2 * limit) / Math.abs(a)) : Infinity);
  const tEnd = Math.min(T_MAX, reach(lim.theta, acc.alpha), reach(lim.dx, acc.ax), reach(lim.dy, acc.ay));
  if (t > tEnd + HOLD) { anim.t0 = now; t = 0; }
  const tt = Math.min(t, tEnd);
  anim.frame = {
    theta: 0.5 * acc.alpha * tt * tt,
    dx: 0.5 * acc.ax * tt * tt,
    dy: 0.5 * acc.ay * tt * tt,
    pivot: acc.pivot,
  };
  draw();
  requestAnimationFrame(tick);
}

playBtn.addEventListener('click', () => (anim ? stopAnim() : startAnim()));

// ---------------------------------------------------------------- 操作パネル

for (const b of document.querySelectorAll('.add-btn')) {
  b.addEventListener('click', () => {
    stopAnim();
    addAction(b.dataset.type);
    update();
  });
}
$('mode').addEventListener('change', (e) => { stopAnim(); state.mode = e.target.value; update(); });
$('notation').addEventListener('change', (e) => { state.notation = e.target.value; update(); });
$('Lmm').addEventListener('change', (e) => {
  const v = parseFloat(e.target.value);
  if (isFinite(v) && v > 0) state.Lmm = Math.min(100000, v);
  e.target.value = String(state.Lmm);
  update();
});
$('show-each').addEventListener('change', (e) => { state.showEach = e.target.checked; update(); });
$('show-values').addEventListener('change', (e) => { state.showValues = e.target.checked; update(); });

const presetHost = $('presets');
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.type = 'button';
  b.textContent = p.label;
  b.addEventListener('click', () => {
    stopAnim();
    Object.assign(state, p.make());
    state.sel = 0;
    buildList();
    update();
  });
  presetHost.append(b);
}

// ---------------------------------------------------------------- URL ハッシュ
//
// 例: #m=pin&n=L&L=1000&o=0&a=p,0.5,6,-90;r,1,90;c,0.5,4;m,0,1&e=1&v=0
//   a の各要素: 集中荷重 p,t,P,dir ／ 未知反力 r,t,dir ／ 集中モーメント c,t,C（反時計まわり正）
//               ／ 反力モーメント m,t,sgn（仮定の向き ±1）

function buildHash() {
  const a = state.actions.map((x) => {
    const key = TYPE_KEY[x.type];
    if (x.type === 'point') return [key, fmt(x.t, 6), fmt(x.P, 3), fmt(x.dir, 3)].join(',');
    if (x.type === 'reaction') return [key, fmt(x.t, 6), fmt(x.dir, 3)].join(',');
    if (x.type === 'moment') return [key, fmt(x.t, 6), fmt(x.C, 3)].join(',');
    return [key, fmt(x.t, 6), x.sgn > 0 ? 1 : -1].join(',');
  }).join(';');
  return [
    `m=${state.mode}`, `n=${state.notation}`, `L=${fmt(state.Lmm, 3)}`,
    `o=${fmt(state.tO, 6)}`, `a=${a || '-'}`,
    `e=${state.showEach ? 1 : 0}`, `v=${state.showValues ? 1 : 0}`,
  ].join('&');
}

function snapDir(dir) {
  const { up, tilt } = decompose(+dir || 0);
  return compose(up, snapTilt(tilt, 0.01));
}

function applyHash(h) {
  const d = DEFAULT();
  const q = new URLSearchParams(h);
  // 省略されたキーは既定に戻す（mohr/ で踏んだ罠）
  state.mode = q.get('m') === 'free' ? 'free' : 'pin';
  state.notation = q.get('n') === 'x' ? 'x' : 'L';
  const L = parseFloat(q.get('L'));
  state.Lmm = isFinite(L) && L > 0 ? Math.min(100000, L) : d.Lmm;
  const o = parseFloat(q.get('o'));
  state.tO = isFinite(o) ? exactFrac(clamp01(o)) : d.tO;
  state.showEach = q.get('e') !== '0';
  state.showValues = q.get('v') === '1';
  const a = q.get('a');
  if (a === null) state.actions = d.actions;
  else if (a === '-' || a === '') state.actions = [];
  else {
    state.actions = a.split(';').map((s) => {
      const f = s.split(',');
      const type = KEY_TYPE[f[0]];
      if (!type) return null;
      const t = exactFrac(clamp01(+f[1] || 0));
      if (type === 'point') return { type, t, P: Math.min(P_MAX, Math.max(0, +f[2] || 0)), dir: snapDir(f[3]) };
      if (type === 'reaction') return { type, t, dir: snapDir(f[2]) };
      if (type === 'moment') return { type, t, C: Math.max(-C_MAX, Math.min(C_MAX, +f[2] || 0)) };
      return { type, t, sgn: +f[2] < 0 ? -1 : 1 };
    }).filter(Boolean).slice(0, COLORS.length);
  }
  state.sel = 0;
}

/** URL の小数（0.333333 など）を分数の位置に戻す。分母は吸着の最小公倍数 60 まで。 */
function exactFrac(t) {
  for (let d = 1; d <= 60; d++) {
    const n = Math.round(t * d);
    if (Math.abs(t - n / d) < 2e-6) return n / d;
  }
  return t;
}

function syncHash() {
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
  buildList();
  update();
});

// ---------------------------------------------------------------- 共有（URL / QR）。mohr/ と同じ実装

function shareUrl() {
  return location.origin + location.pathname + '#' + buildHash();
}
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
  if (typeof QRCode === 'undefined') {
    host.textContent = 'QR コードを生成できませんでした（ライブラリの読み込み失敗）';
    return;
  }
  // padding（クワイエットゾーン）は 4 以上。詰めると読めない（mohr/ で実機確認）
  const svg = new QRCode({
    content: url, padding: 4, width: QR_PX, height: QR_PX,
    color: '#000000', background: '#ffffff', ecl: 'M', join: true,
  }).svg();
  try {
    const src = await svgToPngDataUrl(svg, QR_PX * QR_SCALE);
    const img = document.createElement('img');
    img.src = src; img.width = QR_PX; img.height = QR_PX;
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
    try { $('share-url').select(); ok = document.execCommand('copy'); } catch (e2) { ok = false; }
  }
  const b = $('share-copy');
  b.textContent = ok ? 'コピーしました' : '選択してコピーしてください';
  window.setTimeout(() => { b.textContent = 'コピー'; }, 1600);
});

// ---------------------------------------------------------------- 起動

function boot() {
  renderTex();
  buildList();
  update();
}

window.__moment = { state, update, fig, get res() { return res; } };

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();
