// モーメントのつり合い — 状態と配線
import {
  ACTION_TYPES, actionType, analyze, sumLines, decompose, compose, posText, fmt, symbolIndex,
  senseText, accelerations, clamp01, snapTilt, ANIM_T, posTex, angleTex,
} from './model.js';
import { MomentFigure, COLORS, P_MAX } from './figure.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- 状態

const DEFAULT = () => ({
  mode: 'pin',       // 'pin'（O で回転だけ許して支える）| 'free'（自由体）
  notation: 'L',     // 'L'（L の分数で書く）| 'x'（左端からの x 座標で書く）
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
    id: 'lecture', label: '左端が O（資料の図）',
    make: () => ({ mode: 'pin', tO: 0, actions: [
      { type: 'point', t: 1, P: 5, dir: 90 },
      { type: 'point', t: 0.5, P: 8, dir: compose(false, 30) },
    ] }),
  },
  {
    id: 'lever', label: 'てこのつり合い',
    make: () => ({ mode: 'pin', tO: 1 / 3, actions: [
      { type: 'point', t: 0, P: 6, dir: -90 },
      { type: 'point', t: 1, P: 3, dir: -90 },
    ] }),
  },
  {
    id: 'couple', label: '偶力（自由体）',
    make: () => ({ mode: 'free', tO: 0.5, actions: [
      { type: 'point', t: 0.2, P: 6, dir: 90 },
      { type: 'point', t: 0.8, P: 6, dir: -90 },
    ] }),
  },
  {
    id: 'balanced', label: 'つり合った自由体',
    make: () => ({ mode: 'free', tO: 0.25, actions: [
      { type: 'point', t: 0, P: 4, dir: 90 },
      { type: 'point', t: 0.6, P: 10, dir: -90 },
      { type: 'point', t: 1, P: 6, dir: 90 },
    ] }),
  },
];

// URL ハッシュでの荷重の種類の略号（applyHash() が起動直後に使うのでここで宣言する）
const TYPE_KEY = { point: 'p' };
const KEY_TYPE = { p: 'point' };

// update() が触る let はシーン生成より前に宣言しておく（mohr/ と同じ理由）
let state = DEFAULT();
state.sel = 0;
state.animating = false;
let res = null;
let hashTimer = 0;
let lastHash = '';
let anim = null;
let dragging = false;

applyHash(location.hash.replace(/^#/, ''));

const fig = new MomentFigure($('figure'), {
  onChange: (ch) => {
    if (!ch) { draw(); return; }
    stopAnim();
    if ('tO' in ch) state.tO = ch.tO;
    if (ch.action) state.actions[ch.action.k] = ch.action.value;
    if ('add' in ch) addAction(ch.add);
    update();
  },
  onSelect: (k) => { state.sel = k; syncList(); },
  onDragState: (d) => { dragging = d; },
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

function addAction(t = 0.5) {
  if (state.actions.length >= COLORS.length) return;
  const a = ACTION_TYPES.point.create(t);
  state.actions.push(a);
  state.sel = state.actions.length - 1;
}

// ---------------------------------------------------------------- 荷重の一覧

const list = $('load-list');

function syncList() {
  const rows = list.querySelectorAll('.load-row');
  if (rows.length !== state.actions.length) buildList();
  state.actions.forEach((a, k) => {
    const row = list.children[k];
    row.classList.toggle('selected', k === state.sel);
    const { up, tilt } = decompose(a.dir);
    setIfIdle(row.querySelector('[data-f="pos"]'), posText(a.t));
    row.querySelector('.pos-mm').textContent = `= ${fmt(a.t * state.Lmm, 1)} mm`;
    setIfIdle(row.querySelector('[data-f="P"]'), String(fmt(a.P, 2)));
    setIfIdle(row.querySelector('[data-f="up"]'), up ? 'up' : 'down');
    setIfIdle(row.querySelector('[data-f="tilt"]'), String(fmt(tilt, 1)));
  });
  $('add-load').disabled = state.actions.length >= COLORS.length;
  $('mode').value = state.mode;
  $('notation').value = state.notation;
  setIfIdle($('Lmm'), String(state.Lmm));
  $('show-each').checked = state.showEach;
  $('show-values').checked = state.showValues;
}

function setIfIdle(el, v) {
  if (el && document.activeElement !== el && el.value !== v) el.value = v;
}

function buildList() {
  list.replaceChildren();
  state.actions.forEach((a, k) => {
    const i = symbolIndex(state.actions, k);
    const color = COLORS[k % COLORS.length];
    const row = document.createElement('div');
    row.className = 'load-row';
    row.style.setProperty('--c', color);
    row.innerHTML = `
      <button class="chip" type="button" data-f="sel" title="図で選ぶ"><span class="tex" data-tex="${actionType(a).symbol(i)}"></span></button>
      <label class="lf"><span>位置</span>
        <input data-f="pos" type="text" inputmode="text" autocomplete="off" spellcheck="false" aria-label="位置（例: 2L/3, 0.4L, 250）">
        <span class="pos-mm"></span></label>
      <label class="lf"><span>大きさ</span>
        <input data-f="P" type="number" min="0" max="${P_MAX}" step="0.5"><span class="u">kN</span></label>
      <label class="lf"><span>向き</span>
        <select data-f="up"><option value="up">上向き</option><option value="down">下向き</option></select></label>
      <label class="lf"><span>傾き</span>
        <input data-f="tilt" type="number" min="-90" max="90" step="1"><span class="u">°</span></label>
      <button class="btn del" type="button" data-f="del" aria-label="この荷重を消す">×</button>`;
    list.append(row);
    renderTex(row);

    const on = (f, ev, fn) => row.querySelector(`[data-f="${f}"]`).addEventListener(ev, fn);
    const pick = () => { state.sel = k; syncList(); draw(); };
    row.addEventListener('focusin', pick);
    on('sel', 'click', pick);
    on('pos', 'change', (e) => {
      const t = parsePos(e.target.value);
      if (t !== null) state.actions[k].t = t;
      e.target.value = posText(state.actions[k].t);
      stopAnim(); update();
    });
    on('P', 'input', (e) => {
      const v = parseFloat(e.target.value);
      if (!isFinite(v)) return;
      state.actions[k].P = Math.min(P_MAX, Math.max(0, v));
      stopAnim(); update();
    });
    const setDir = () => {
      const up = row.querySelector('[data-f="up"]').value === 'up';
      let tilt = parseFloat(row.querySelector('[data-f="tilt"]').value);
      if (!isFinite(tilt)) tilt = 0;
      tilt = Math.max(-90, Math.min(90, tilt));
      state.actions[k].dir = compose(up, tilt);
      stopAnim(); update();
    };
    on('up', 'change', setDir);
    on('tilt', 'input', setDir);
    on('del', 'click', () => {
      state.actions.splice(k, 1);
      stopAnim(); buildList(); update();
    });
  });
}

/** 位置の入力を読む。"2L/3"・"L/2"・"0.4L"・"2/3L"・"L" は L の分数、数字だけは mm。 */
function parsePos(str) {
  const s = String(str).replace(/\s+/g, '').replace(/ｌ|Ｌ/g, 'L').replace(/／/g, '/');
  let m;
  if ((m = s.match(/^(\d*\.?\d*)L(?:\/(\d+))?$/i))) {
    const n = m[1] === '' ? 1 : parseFloat(m[1]);
    const d = m[2] ? parseInt(m[2], 10) : 1;
    return isFinite(n) && d > 0 ? clamp01(n / d) : null;
  }
  if ((m = s.match(/^(\d+)\/(\d+)L$/i))) return clamp01(+m[1] / +m[2]);
  const v = parseFloat(s);
  return isFinite(v) ? clamp01(v / state.Lmm) : null;
}

// ---------------------------------------------------------------- 式

function renderFormulas() {
  const host = $('terms');
  const st = ctxState();
  const parts = [];
  res.terms.forEach((t, k) => {
    const a = state.actions[k];
    const i = symbolIndex(state.actions, k);
    const { up, tilt } = decompose(a.dir);
    const color = COLORS[k % COLORS.length];
    const where = state.notation === 'x'
      ? `x_{${i}} = ${fmt(a.t * st.Lm)}\\,\\mathrm{m}`
      : `O\\text{ から }${posTex(a.t - state.tO)}`;
    const cap = `${actionType(a).label} <b>${tex(`P_{${i}} = ${fmt(a.P, 2)}\\,\\mathrm{kN}`)}</b>、`
      + `${tex(where)}、${up ? '上向き' : '下向き'}`
      + (Math.abs(tilt) > 0.5 ? `（鉛直から${tilt > 0 ? '右' : '左'}へ ${tex(`\\theta_{${i}} = ${angleTex(tilt)}`)}）` : '');
    let body;
    if (t.zeroReason) {
      body = texD(`${t.name} = 0`) + `<p class="why">${t.zeroReason}ので、O まわりには回さない。</p>`;
    } else {
      let l = `${t.name} = ${t.sym.replace(/^\+/, '')}`;
      if (t.simp) l += ` = ${t.simp.replace(/^\+/, '')}`;
      const l2 = `\\phantom{${t.name}} = ${t.subst.replace(/^\+/, '')} = ${signedNum(t.value)}\\ \\mathrm{kN\\cdot m}`;
      body = texD(l) + texD(l2) + `<p class="why">${senseText(t.value)}</p>`;
    }
    parts.push(`<div class="term" style="--c:${color}"><div class="cap">${cap}</div>${body}</div>`);
  });
  host.innerHTML = parts.join('') || '<p class="why">荷重がありません。「荷重を足す」か、図の棒をダブルクリックしてください。</p>';

  const sums = sumLines(st, res);
  $('sum').innerHTML = sums.moment.map(texD).join('')
    + `<p class="why">合計 ${tex('M_{O}')} は <b>${senseText(res.MO, 5e-7)}</b></p>`;
  $('forces').hidden = state.mode !== 'free';
  $('forces-body').innerHTML = sums.force.map(texD).join('');
  $('verdict').innerHTML = verdictHtml();

  $('x-note').hidden = state.notation !== 'x';
  $('l-note').hidden = state.notation !== 'L';
}

function verdictHtml() {
  const zM = Math.abs(res.MO) < 5e-7;
  const zF = Math.abs(res.Fx) < 5e-7 && Math.abs(res.Fy) < 5e-7;
  if (state.mode === 'pin') {
    return zM
      ? `<b class="ok">つり合っている</b>：${tex('M_{O} = 0')} なので棒は回らない（荷重の合力は O の反力が受け持つ）。`
      : `<b class="ng">つり合っていない</b>：${tex('M_{O} \\neq 0')} なので、棒は O を中心に<b>${senseText(res.MO)}</b>に回り始める。`;
  }
  if (zM && zF) {
    return `<b class="ok">つり合っている</b>：${tex('F_x = F_y = 0')} かつ ${tex('M_{O} = 0')}。この場合、O をどこに動かしても ${tex('M_{O} = 0')} のまま。`;
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
  st.innerHTML = `${tex(`M_{O} = ${signedNum(res.MO)}\\ \\mathrm{kN\\cdot m}`)}`
    + `<span class="sense">${senseText(res.MO, 5e-7)}</span>`
    + (state.mode === 'free'
      ? `<span class="fsum">${tex(`F_x = ${signedNum(res.Fx)},\\ F_y = ${signedNum(res.Fy)}\\ \\mathrm{kN}`)}</span>`
      : '');
}

function signedNum(x) {
  const s = fmt(x, 3);
  if (s === '0') return '0';
  return x > 0 ? '+' + s : s;
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
// 止まる条件: 回転角 70° か 移動量 0.45L か 2.2 秒。0.8 秒止めてから繰り返す。

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
  // 動きの終わりの時刻（回転角・移動量が図に収まる上限に達したところで止める）
  const lim = fig.animLimits(acc.pivot);
  let tEnd = T_MAX;
  const reach = (limit, a) => (Math.abs(a) > 1e-9 ? Math.sqrt((2 * limit) / Math.abs(a)) : Infinity);
  tEnd = Math.min(tEnd, reach(lim.theta, acc.alpha), reach(lim.dx, acc.ax), reach(lim.dy, acc.ay));
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

$('add-load').addEventListener('click', () => {
  stopAnim();
  // 空いている位置（既存の荷重と重ならないところ）を探す
  const cands = [0.5, 1, 0.25, 0.75, 0, 1 / 3, 2 / 3, 0.1, 0.9];
  const t = cands.find((c) => !state.actions.some((a) => Math.abs(a.t - c) < 1e-6)) ?? 0.5;
  addAction(t);
  update();
});
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
// 例: #m=pin&n=L&L=1000&o=0&a=p,0.5,6,-90;p,1,4,90&e=1&v=0
//   a の各要素は「種類,位置 t,大きさ,向き dir」。種類 p = 集中荷重（将来 c = 集中モーメント等）


function buildHash() {
  const a = state.actions
    .map((x) => [TYPE_KEY[x.type], fmt(x.t, 6), fmt(x.P, 3), fmt(x.dir, 3)].join(','))
    .join(';');
  return [
    `m=${state.mode}`, `n=${state.notation}`, `L=${fmt(state.Lmm, 3)}`,
    `o=${fmt(state.tO, 6)}`, `a=${a || '-'}`,
    `e=${state.showEach ? 1 : 0}`, `v=${state.showValues ? 1 : 0}`,
  ].join('&');
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
      const [k, t, P, dir] = s.split(',');
      const type = KEY_TYPE[k];
      if (!type) return null;
      const v = { type, t: exactFrac(clamp01(+t || 0)), P: Math.min(P_MAX, Math.max(0, +P || 0)), dir: +dir || 0 };
      const { up, tilt } = decompose(v.dir);
      v.dir = compose(up, snapTilt(tilt, 0.01));
      return v;
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
