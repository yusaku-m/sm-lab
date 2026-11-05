// エアリーの応力関数 — サンブナンの原理（弾性力学テキスト 1.1）。状態・UI・描画・式。
// 計算は model.js（フーリエ余弦級数の各項を応力関数で解いて足す。N = ∞ は閉じた形の和）。
import * as Mdl from './model.js';

const XI_MAX = 2.5;      // 図に描く板の長さ（b を単位に）
const N_MAX = 80;        // スライダーの上限
const TOL = 0.05;        // 「一様になった」とみなすずれ（P/b に対して）
const COMP_TEX = ['\\sigma_{xx}', '\\sigma_{yy}', '\\sigma_{xy}'];
const COMP_KEY = ['xx', 'yy', 'xy'];

// ---------------------------------------------------------------- 状態
const defaultState = () => ({ ld: 'pt', a: 0.5, N: 10, lz: false, comp: 0, xc: 0.25 });
const state = defaultState();
let lastN = 10; // 「無限項」を外したときに戻す N
let playing = false, playTimer = 0, hashTimer = 0, lastHash = '', heavyTimer = 0;

const $ = (id) => document.getElementById(id);
const K = () => window.katex;
const tx = (tex, display = false) => (K() ? K().renderToString(tex, { displayMode: display, throwOnError: false }) : tex);
const fmt = (v, d = 3) => {
  if (!Number.isFinite(v)) return '∞';
  if (Math.abs(v) < 0.5 * 10 ** -d) return '0';
  return (+v.toFixed(d)).toString().replace('-', '−');
};
const field = () => Mdl.makeField(state);

// ---------------------------------------------------------------- UI
for (const [k, v] of Object.entries(Mdl.LOADS)) $('ld').add(new Option(v.name, k));
$('N').max = N_MAX;

function syncInputs() {
  $('ld').value = state.ld;
  $('comp').value = String(state.comp);
  const inf = !Number.isFinite(state.N);
  $('inf').checked = inf;
  $('N').value = inf ? N_MAX : state.N;
  $('N-o').textContent = inf ? '∞' : String(state.N);
  $('N').closest('.lf').classList.toggle('off', inf);
  $('lz').checked = state.lz;
  $('lz').disabled = inf;
  $('lz').closest('.check').style.opacity = inf ? 0.45 : 1;
  $('a').value = state.a;
  $('a-o').textContent = fmt(state.a, 2);
  $('a-row').hidden = !Mdl.LOADS[state.ld].usesA;
  $('xc').max = XI_MAX;
  $('xc').value = state.xc;
  $('xc-o').textContent = fmt(state.xc, 2);
}

$('ld').addEventListener('change', () => { state.ld = $('ld').value; render(); });
$('comp').addEventListener('change', () => { state.comp = +$('comp').value; render(); });
$('N').addEventListener('input', () => { stopPlay(); state.N = +$('N').value; lastN = state.N; render(); });
$('inf').addEventListener('change', () => {
  stopPlay();
  if ($('inf').checked) { if (Number.isFinite(state.N)) lastN = state.N; state.N = Infinity; } else state.N = lastN;
  render();
});
$('lz').addEventListener('change', () => { state.lz = $('lz').checked; render(); });
$('a').addEventListener('input', () => { state.a = +$('a').value; render(); });
$('xc').addEventListener('input', () => { state.xc = +$('xc').value; render({ light: true }); });

// 波を 1 つずつ重ねる（N = 0 → 40）
function stopPlay() {
  if (!playing) return;
  playing = false; clearTimeout(playTimer);
  $('play').setAttribute('aria-pressed', 'false');
  $('play').querySelector('.lbl').textContent = '波を重ねる';
}
$('play').addEventListener('click', () => {
  if (playing) { stopPlay(); return; }
  playing = true;
  $('play').setAttribute('aria-pressed', 'true');
  $('play').querySelector('.lbl').textContent = '止める';
  state.N = 0; render();
  const step = () => {
    if (!playing) return;
    if (state.N >= 40) { stopPlay(); return; }
    state.N += 1; lastN = state.N; render();
    playTimer = window.setTimeout(step, state.N < 8 ? 650 : 260);
  };
  playTimer = window.setTimeout(step, 650);
});

// ---------------------------------------------------------------- 板の図（viewBox 1040×360）
const VW = 1040, VH = 360, S = 280, X0 = 230, Y0 = 40; // 板の左上 (X0, Y0)、b = S px
const X1 = X0 + XI_MAX * S, Y1 = Y0 + S;
const px = (xi) => X0 + xi * S, py = (eta) => Y0 + (eta + 0.5) * S; // y は下向き（テキストと同じ）

// 色：応力 0 を白、CMAX を赤。負の値は同じ目盛りで青。目盛りは成分ごとに固定（荷重の種類・項数 N で変えない。
// 変えると、波を重ねて荷重点の山が高くなるほど一様な部分が淡くなり、応力が下がったように見える）。
// σxx は一様な値 P/b が半分の濃さになる 2P/b。集中荷重は荷重点で無限大になるので、そこは赤で飽和する。
const C_NEG = [36, 91, 141], C_MID = [255, 255, 255], C_POS = [200, 30, 30];
function color(v) {
  const t = Math.max(-1, Math.min(1, v)), a = Math.abs(t), c = t >= 0 ? C_POS : C_NEG;
  return [C_MID[0] + (c[0] - C_MID[0]) * a, C_MID[1] + (c[1] - C_MID[1]) * a, C_MID[2] + (c[2] - C_MID[2]) * a];
}
const refOf = (comp) => (comp === 0 ? 1 : 0); // 断面の分布の基準線（一様な値）
const CMAX = [2, 1, 1]; // σxx・σyy・σxy の赤になる値（P/b を単位に）

const NX = 300, NY = 120;
const off = document.createElement('canvas'); off.width = NX; off.height = NY;
function drawContour(f) {
  const ctx = off.getContext('2d'), img = ctx.createImageData(NX, NY);
  const vals = new Float64Array(NX * NY);
  for (let j = 0; j < NY; j++) {
    const eta = -0.5 + (j + 0.5) / NY;
    for (let i = 0; i < NX; i++) {
      const xi = ((i + 0.5) / NX) * XI_MAX;
      const v = f.at(xi, eta)[state.comp];
      vals[j * NX + i] = Number.isFinite(v) ? v : 0;
    }
  }
  const cmax = CMAX[state.comp];
  for (let k = 0; k < vals.length; k++) {
    const [r, g, b] = color(vals[k] / cmax);
    img.data[4 * k] = r; img.data[4 * k + 1] = g; img.data[4 * k + 2] = b; img.data[4 * k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const cv = $('plate-cv'), wrap = $('plate-wrap'), dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'), k = Math.min(cv.width / VW, cv.height / VH);
  const ox = (cv.width - VW * k) / 2, oy = (cv.height - VH * k) / 2;
  g.clearRect(0, 0, cv.width, cv.height);
  g.imageSmoothingEnabled = true;
  g.drawImage(off, ox + X0 * k, oy + Y0 * k, (X1 - X0) * k, (Y1 - Y0) * k);
}

function drawColorbar() {
  const cv = $('cbar'), g = cv.getContext('2d'), cmax = CMAX[state.comp];
  for (let i = 0; i < cv.width; i++) {
    const [r, gg, b] = color(-1 + (2 * i) / (cv.width - 1));
    g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`; g.fillRect(i, 0, 1, cv.height);
  }
  const u = tx('P/b');
  $('cbar-ticks').innerHTML = [-1, -0.5, 0, 0.5, 1]
    .map((t, i) => `<span>${i === 0 ? '≤ ' : i === 4 ? '≥ ' : ''}${fmt(t * cmax, 1)}${t === 0 ? ' ' + u : ''}</span>`).join('');
}

const arrowSvg = (x1, y1, x2, y2, c, w = 2, head = 9) => {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  if (L < 1) return '';
  const hl = Math.min(head, L * 0.6), ux = dx / L, uy = dy / L, bx = x2 - ux * hl, by = y2 - uy * hl, hw = hl * 0.45;
  return `<line x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}" stroke="${c}" stroke-width="${w}"/>` +
    `<polygon points="${x2},${y2} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}" fill="${c}"/>`;
};

// 端面の荷重の図。左向き（引張）の矢印。長さは q/(P/b) に比例（大きすぎれば縮める）
function loadSvg(f) {
  const INK = '#1d2932', LC = '#bd442c';
  let s = '', peak = 1;
  const labels = [];
  const MAXLEN = 190;
  if (f.exact) {
    const ld = state.ld, a = state.a;
    if (ld === 'u') {
      const L = 60;
      for (let k = 0; k <= 10; k++) { const y = py(-0.5 + k / 10); s += arrowSvg(X0, y, X0 - L, y, LC); }
      s += `<line x1="${X0 - L}" y1="${py(-0.5)}" x2="${X0 - L}" y2="${py(0.5)}" stroke="${LC}" stroke-width="1.5"/>`;
      labels.push([X0 - L - 26, py(0), tx('\\dfrac{P}{b}')]);
    } else if (ld === 'pa') {
      const L = Math.min(MAXLEN, 60 / a);
      const m = Math.max(2, Math.round(10 * a));
      for (let k = 0; k <= m; k++) { const y = py(-a / 2 + (a * k) / m); s += arrowSvg(X0, y, X0 - L, y, LC); }
      s += `<line x1="${X0 - L}" y1="${py(-a / 2)}" x2="${X0 - L}" y2="${py(a / 2)}" stroke="${LC}" stroke-width="1.5"/>`;
      labels.push([X0 - L - 28, py(0), tx('\\dfrac{P}{a}')]);
    } else if (ld === 'p2') {
      for (const e of [-a / 2, a / 2]) s += arrowSvg(X0, py(e), X0 - 110, py(e), LC, 3, 13);
      labels.push([X0 - 136, py(-a / 2), tx('\\dfrac{P}{2}')], [X0 - 136, py(a / 2), tx('\\dfrac{P}{2}')]);
    } else {
      s += arrowSvg(X0, py(0), X0 - 170, py(0), LC, 3.5, 15);
      labels.push([X0 - 190, py(0), tx('P')]);
    }
    return { s, labels };
  }
  // N 項で打ち切った分布：曲線と矢印
  const M = 200, q = [];
  for (let j = 0; j <= M; j++) { const eta = -0.5 + j / M; q.push([eta, f.load(eta)]); }
  peak = Math.max(...q.map((p) => Math.abs(p[1])));
  const k = Math.min(60, MAXLEN / peak);
  const pts = q.map(([eta, v]) => `${(X0 - v * k).toFixed(1)},${py(eta).toFixed(1)}`);
  s += `<polygon points="${X0},${py(-0.5)} ${pts.join(' ')} ${X0},${py(0.5)}" fill="${LC}" fill-opacity="0.13" stroke="none"/>`;
  s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${LC}" stroke-width="1.8"/>`;
  for (let j = 0; j <= 20; j++) {
    const eta = -0.5 + j / 20, v = f.load(eta);
    if (Math.abs(v * k) > 6) s += arrowSvg(X0, py(eta), X0 - v * k, py(eta), LC, 1.2, 6);
  }
  // 基準（一様な P/b）の位置
  s += `<line x1="${X0 - k}" y1="${py(-0.5)}" x2="${X0 - k}" y2="${py(0.5)}" stroke="${INK}" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>`;
  labels.push([X0 - k, Y1 + 20, tx('\\tfrac{P}{b}')]);
  labels.push([96, Y0 + 6, `<small>最大 ${fmt(peak, 1)}${tx('\\,P/b')}</small>`]);
  return { s, labels };
}

function renderPlate(f) {
  drawContour(f);
  const INK = '#1d2932';
  const ld = loadSvg(f);
  let s = ld.s;
  s += `<rect x="${X0}" y="${Y0}" width="${X1 - X0}" height="${S}" fill="none" stroke="${INK}" stroke-width="2"/>`;
  // 奥（右端）は描かずに続くことを示す
  s += `<line x1="${X1}" y1="${Y0}" x2="${X1 + 40}" y2="${Y0}" stroke="${INK}" stroke-width="2" stroke-dasharray="6 5"/>`;
  s += `<line x1="${X1}" y1="${Y1}" x2="${X1 + 40}" y2="${Y1}" stroke="${INK}" stroke-width="2" stroke-dasharray="6 5"/>`;
  // 壁（滑らかな壁＝ローラー）を上下に
  for (const y of [Y0, Y1]) {
    const d = y === Y0 ? -1 : 1;
    for (let x = X0 + 10; x < X1 + 30; x += 26) s += `<circle cx="${x}" cy="${y + d * 5}" r="4" fill="#fffdf7" stroke="${INK}" stroke-width="1"/>`;
    s += `<line x1="${X0}" y1="${y + d * 10}" x2="${X1 + 40}" y2="${y + d * 10}" stroke="${INK}" stroke-width="1.2"/>`;
    for (let x = X0 + 4; x < X1 + 40; x += 12) s += `<line x1="${x}" y1="${y + d * 10}" x2="${x + 8}" y2="${y + d * 17}" stroke="${INK}" stroke-width="0.8" opacity="0.7"/>`;
  }
  // 一様になる距離
  const xs = Mdl.settleDistance(f, TOL, state.comp);
  if (xs > 0 && xs < XI_MAX) {
    s += `<line x1="${px(xs)}" y1="${Y0}" x2="${px(xs)}" y2="${Y1}" stroke="${INK}" stroke-width="1.4" stroke-dasharray="5 4" opacity="0.85"/>`;
  }
  // 断面
  s += `<line x1="${px(state.xc)}" y1="${Y0 - 22}" x2="${px(state.xc)}" y2="${Y1 + 22}" stroke="#7d5ba6" stroke-width="2.2"/>`;
  s += `<circle cx="${px(state.xc)}" cy="${Y0 - 22}" r="6" fill="#7d5ba6"/>`;
  // 座標軸
  s += arrowSvg(X0, py(0), X0 + 70, py(0), INK, 1.4, 8);
  s += arrowSvg(X0, py(0), X0, py(0) + 70, INK, 1.4, 8);
  s += `<circle cx="${X0}" cy="${py(0)}" r="3" fill="${INK}"/>`;
  const svg = $('plate-svg');
  svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
  svg.innerHTML = s;

  const L = [...ld.labels,
    [X0 + 82, py(0) - 2, tx('x')], [X0 + 12, py(0) + 84, tx('y')],
    [px(state.xc) + 4, Y1 + 34, tx(`x=${fmt(state.xc, 2)}b`)],
  ];
  if (xs > 0 && xs < XI_MAX) L.push([px(xs), Y0 + 16, `<small>ずれ ${TOL * 100}% 以内 → ${tx(`x\\ge${fmt(xs, 2)}b`)}</small>`]);
  L.push([X1 + 50, py(0), `<small>${tx(state.comp === 0 ? '\\to\\ \\tfrac{P}{b}' : '\\to\\ 0')}</small>`]);
  $('plate-lbl').innerHTML = L.map(([x, y, h]) => `<span style="left:${(x / VW) * 100}%;top:${(y / VH) * 100}%">${h}</span>`).join('');
  return xs;
}

// 図をドラッグして断面を動かす
{
  const wrap = $('plate-wrap');
  const setFrom = (e) => {
    const r = wrap.getBoundingClientRect(), k = Math.min(r.width / VW, r.height / VH);
    const ox = (r.width - VW * k) / 2;
    const xi = ((e.clientX - r.left - ox) / k - X0) / S;
    state.xc = Math.round(Math.max(0.01, Math.min(XI_MAX, xi)) * 100) / 100;
    render({ light: true });
  };
  wrap.addEventListener('pointerdown', (e) => {
    e.preventDefault(); wrap.setPointerCapture(e.pointerId); setFrom(e);
    const mv = (ev) => setFrom(ev);
    const up = () => { wrap.removeEventListener('pointermove', mv); wrap.removeEventListener('pointerup', up); wrap.removeEventListener('pointercancel', up); render(); };
    wrap.addEventListener('pointermove', mv); wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
  });
}

// ---------------------------------------------------------------- 断面の分布（横軸＝応力、縦軸＝y。板と同じ向き）
function renderSection(f) {
  const W = 420, H = 300, ml = 46, mr = 16, mt = 14, mb = 36;
  const M = 241, pts = [];
  for (let j = 0; j < M; j++) { const eta = -0.5 + j / (M - 1); pts.push([eta, f.at(state.xc, eta)[state.comp]]); }
  const ref = refOf(state.comp);
  let lo = Math.min(ref - 0.25, ...pts.map((p) => p[1])), hi = Math.max(ref + 0.25, ...pts.map((p) => p[1]));
  if (state.comp === 0) lo = Math.min(lo, 0);
  const CAP = 6; lo = Math.max(lo, ref - CAP); hi = Math.min(hi, ref + CAP);
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const X = (v) => ml + ((v - lo) / (hi - lo)) * (W - ml - mr), Y = (eta) => mt + (eta + 0.5) * (H - mt - mb);
  const step = niceStep((hi - lo) / 5);
  let s = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    s += `<line x1="${X(v)}" y1="${mt}" x2="${X(v)}" y2="${H - mb}" stroke="#1d293218"/>` +
      `<text x="${X(v)}" y="${H - mb + 16}" font-size="11" fill="#627078" text-anchor="middle">${fmt(v, 2)}</text>`;
  }
  for (const e of [-0.5, -0.25, 0, 0.25, 0.5]) {
    s += `<line x1="${ml}" y1="${Y(e)}" x2="${W - mr}" y2="${Y(e)}" stroke="#1d293214"/>` +
      `<text x="${ml - 6}" y="${Y(e) + 4}" font-size="11" fill="#627078" text-anchor="end">${fmt(e, 2)}</text>`;
  }
  s += `<line x1="${X(ref)}" y1="${mt}" x2="${X(ref)}" y2="${H - mb}" stroke="#1d2932" stroke-dasharray="5 4" stroke-width="1.2"/>`;
  if (lo < 0 && hi > 0 && ref !== 0) s += `<line x1="${X(0)}" y1="${mt}" x2="${X(0)}" y2="${H - mb}" stroke="#1d2932" stroke-width="1"/>`;
  const clip = (v) => Math.max(lo, Math.min(hi, v));
  const poly = pts.map(([e, v]) => `${X(clip(v)).toFixed(1)},${Y(e).toFixed(1)}`).join(' ');
  s += `<polygon points="${X(ref)},${Y(-0.5)} ${poly} ${X(ref)},${Y(0.5)}" fill="#7d5ba6" fill-opacity="0.12"/>`;
  s += `<polyline points="${poly}" fill="none" stroke="#7d5ba6" stroke-width="2.2"/>`;
  s += `<text x="${(ml + W - mr) / 2}" y="${H - 4}" font-size="12" fill="#1d2932" text-anchor="middle">応力 ÷ (P/b)</text>`;
  s += `<text x="12" y="${(mt + H - mb) / 2}" font-size="12" fill="#1d2932" text-anchor="middle" transform="rotate(-90 12 ${(mt + H - mb) / 2})">y / b</text>`;
  $('sec-plot').innerHTML = `<svg viewBox="0 0 ${W} ${H}">${s}</svg>`;

  const vals = pts.map((p) => p[1]);
  const mx = Math.max(...vals), mn = Math.min(...vals);
  $('sec-title').innerHTML = `断面 ${tx(`x=${fmt(state.xc, 2)}b`)} の ${tx(COMP_TEX[state.comp])} の分布`;
  const dev = Math.max(Math.abs(mx - ref), Math.abs(mn - ref));
  $('sec-sub').innerHTML = `最大 ${tx(`${fmt(mx)}\\,P/b`)}・最小 ${tx(`${fmt(mn)}\\,P/b`)}。` +
    `${state.comp === 0 ? '一様な値 ' + tx('P/b') : '0'} からのずれは最大 ${tx(`${fmt(dev * 100, 1)}\\%`)}（破線が材料力学の一様な分布）。` +
    (dev > CAP ? '端面に近く値が大きいので、図は途中で切っています。' : '');
}
function niceStep(r) {
  const p = 10 ** Math.floor(Math.log10(r)), m = r / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

// ---------------------------------------------------------------- 減衰のグラフ（片対数）
function renderDecay(f) {
  const W = 420, H = 240, ml = 46, mr = 14, mt = 12, mb = 36, LMIN = -4, LMAX = 1;
  const X = (xi) => ml + (xi / XI_MAX) * (W - ml - mr);
  const Y = (v) => { const l = Math.max(LMIN, Math.min(LMAX, Math.log10(Math.max(v, 1e-12)))); return mt + ((LMAX - l) / (LMAX - LMIN)) * (H - mt - mb); };
  let s = '';
  for (let l = LMIN; l <= LMAX; l++) {
    s += `<line x1="${ml}" y1="${Y(10 ** l)}" x2="${W - mr}" y2="${Y(10 ** l)}" stroke="#1d293218"/>` +
      `<text x="${ml - 6}" y="${Y(10 ** l) + 4}" font-size="11" fill="#627078" text-anchor="end">10${sup(l)}</text>`;
  }
  for (let x = 0; x <= XI_MAX + 1e-9; x += 0.5) {
    s += `<line x1="${X(x)}" y1="${mt}" x2="${X(x)}" y2="${H - mb}" stroke="#1d293214"/>` +
      `<text x="${X(x)}" y="${H - mb + 16}" font-size="11" fill="#627078" text-anchor="middle">${fmt(x, 1)}</text>`;
  }
  // 各波の大きさ（第 1〜6 項）
  const g = [(ax) => 1 + ax, (ax) => Math.abs(1 - ax), (ax) => ax][state.comp];
  const nShow = Number.isFinite(state.N) ? Math.min(6, state.N) : 6;
  const w = Number.isFinite(state.N) ? f.w : null;
  for (let n = 1; n <= nShow; n++) {
    const qn = Math.abs(w ? w[n] : Mdl.coef(state.ld, n, state.a));
    if (qn < 1e-9) continue;
    const p = [];
    for (let i = 0; i <= 120; i++) { const xi = (i / 120) * XI_MAX, ax = Mdl.TAU * n * xi; p.push(`${X(xi).toFixed(1)},${Y(qn * g(ax) * Math.exp(-ax)).toFixed(1)}`); }
    s += `<polyline points="${p.join(' ')}" fill="none" stroke="#245b8d" stroke-width="1" opacity="${0.75 - n * 0.08}"/>`;
    const xl = Math.min(XI_MAX * 0.9, 1.1 / n);
    const al = Mdl.TAU * n * xl, yl = qn * g(al) * Math.exp(-al);
    if (n <= 3 && Math.log10(yl) > LMIN + 0.3) s += `<text x="${X(xl) + 3}" y="${Y(yl) - 3}" font-size="10" fill="#245b8d">n=${n}</text>`;
  }
  // 全体のずれ
  const p = [];
  for (let i = 0; i <= 100; i++) { const xi = Math.max(0.005, (i / 100) * XI_MAX); p.push(`${X(xi).toFixed(1)},${Y(Mdl.deviation(f, xi, state.comp, 61)).toFixed(1)}`); }
  s += `<polyline points="${p.join(' ')}" fill="none" stroke="#7d5ba6" stroke-width="2.4"/>`;
  s += `<line x1="${ml}" y1="${Y(TOL)}" x2="${W - mr}" y2="${Y(TOL)}" stroke="#1d2932" stroke-dasharray="5 4"/>` +
    `<text x="${W - mr - 2}" y="${Y(TOL) - 4}" font-size="10" fill="#1d2932" text-anchor="end">${TOL * 100}%</text>`;
  s += `<line x1="${X(state.xc)}" y1="${mt}" x2="${X(state.xc)}" y2="${H - mb}" stroke="#7d5ba6" stroke-width="1.2" opacity="0.6"/>`;
  s += `<text x="${(ml + W - mr) / 2}" y="${H - 4}" font-size="12" fill="#1d2932" text-anchor="middle">端面からの距離 x / b</text>`;
  s += `<text x="12" y="${(mt + H - mb) / 2}" font-size="12" fill="#1d2932" text-anchor="middle" transform="rotate(-90 12 ${(mt + H - mb) / 2})">ずれ ÷ (P/b)</text>`;
  $('dec-plot').innerHTML = `<svg viewBox="0 0 ${W} ${H}">${s}</svg>`;
}
const sup = (l) => String(l).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);

// ---------------------------------------------------------------- 式
function qnTex() {
  switch (state.ld) {
    case 'pt': return 'q_n=\\frac{2P}{b}';
    case 'u': return 'q_n=0\\quad(n\\ge1)';
    case 'pa': return 'q_n=\\frac{2}{b}\\int_{-a/2}^{a/2}\\frac{P}{a}\\cos\\alpha_n y\\,\\mathrm{d}y=\\frac{2P}{b}\\cdot\\frac{\\sin(n\\pi a/b)}{n\\pi a/b}';
    case 'p2': return 'q_n=\\frac{2}{b}\\cdot\\frac{P}{2}\\cdot 2\\cos\\frac{\\alpha_n a}{2}=\\frac{2P}{b}\\cos\\frac{n\\pi a}{b}';
    default: return '';
  }
}
function renderFormulas(f, xs) {
  const D = (t) => `<div class="eq">${tx(t, true)}</div>`;
  const inf = !Number.isFinite(state.N);
  let h = '';
  h += `<p class="step">STEP 1　応力関数</p>`;
  h += `<p>体積力が無い 2 次元の問題では、応力をエアリーの応力関数 ${tx('\\phi(x,y)')} の 2 階微分で表すと、つり合い式は自動的に満たされます。適合条件は ${tx('\\phi')} の重調和方程式になります。</p>`;
  h += D('\\sigma_{xx}=\\frac{\\partial^2\\phi}{\\partial y^2},\\quad \\sigma_{yy}=\\frac{\\partial^2\\phi}{\\partial x^2},\\quad \\sigma_{xy}=-\\frac{\\partial^2\\phi}{\\partial x\\,\\partial y},\\qquad \\nabla^4\\phi=0');

  h += `<p class="step">STEP 2　端面の荷重を余弦波に分ける</p>`;
  h += `<p>端面 ${tx('x=0')} の荷重 ${tx('q(y)')}（${Mdl.LOADS[state.ld].name}）を、周期 ${tx('b')} のフーリエ余弦級数で表します。第 0 項は合力を幅で割った一様な ${tx('P/b')} です。</p>`;
  h += D('q(y)=\\frac{P}{b}+\\sum_{n=1}^{N} q_n\\cos\\alpha_n y,\\qquad \\alpha_n=\\frac{2\\pi n}{b}');
  h += D(qnTex());
  if (!inf && state.lz) h += `<p>ランチョスの因子 ${tx('\\sigma_n=\\dfrac{\\sin\\left(n\\pi/(N+1)\\right)}{n\\pi/(N+1)}')} を ${tx('q_n')} に掛けています（打ち切りによるギブスの振動を抑える。合力は変わらない）。</p>`;

  h += `<p class="step">STEP 3　1 つの波を応力関数で解く</p>`;
  h += `<p>${tx('\\phi=f(x)\\cos\\alpha y')} を ${tx('\\nabla^4\\phi=0')} に入れると ${tx('f\'\'\'\'-2\\alpha^2f\'\'+\\alpha^4f=0')}、解は ${tx('(A+Bx)e^{-\\alpha x}+(C+Dx)e^{\\alpha x}')}。奥（${tx('x\\to\\infty')}）で応力が無限大にならないよう ${tx('C=D=0')} とし、端面で ${tx('\\sigma_{xx}=q_n\\cos\\alpha_n y')}・${tx('\\sigma_{xy}=0')} になるように ${tx('A,B')} を決めると:</p>`;
  h += D('\\phi_0=\\frac{P}{b}\\cdot\\frac{y^2}{2},\\qquad \\phi_n=-\\frac{q_n}{\\alpha_n^{2}}\\left(1+\\alpha_n x\\right)e^{-\\alpha_n x}\\cos\\alpha_n y');

  h += `<p class="step">STEP 4　重ね合わせた応力</p>`;
  h += D('\\begin{aligned}\\sigma_{xx}&=\\frac{P}{b}+\\sum_{n} q_n\\left(1+\\alpha_n x\\right)e^{-\\alpha_n x}\\cos\\alpha_n y\\\\ \\sigma_{yy}&=\\sum_{n} q_n\\left(1-\\alpha_n x\\right)e^{-\\alpha_n x}\\cos\\alpha_n y\\\\ \\sigma_{xy}&=\\sum_{n} q_n\\,\\alpha_n x\\,e^{-\\alpha_n x}\\sin\\alpha_n y\\end{aligned}');
  if (inf) {
    h += `<p>${tx('N\\to\\infty')} の和は、${tx('z=e^{-\\alpha_1(x-\\mathrm{i}y)}')} とおくと等比級数 ${tx('\\sum z^n=\\dfrac{z}{1-z}')}・${tx('\\sum nz^n=\\dfrac{z}{(1-z)^2}')} で閉じた形になります（中央の集中荷重なら ${tx('\\sigma_{xx}=\\dfrac{P}{b}\\left[1+2\\,\\mathrm{Re}\\dfrac{z}{1-z}+2\\alpha_1x\\,\\mathrm{Re}\\dfrac{z}{(1-z)^2}\\right]')}）。2 点・部分一様は、これを ${tx('y')} 方向にずらして足す・積分するだけです。</p>`;
  }

  h += `<p class="step">STEP 5　端面から離れると消える</p>`;
  h += `<p>第 ${tx('n')} 項は ${tx('e^{-2\\pi n x/b}')} で小さくなります。波長 ${tx('b/n')} が短いほど速く消えるので、荷重を集中荷重に近づけるために足した細かい波は、端面のごく近くしか変えません。いまの荷重では、ずれが ${TOL * 100}% に収まるのは ${xs === 0 ? '端面から（最初から一様）' : Number.isFinite(xs) ? tx(`x\\ge ${fmt(xs, 2)}\\,b`) : `${tx(`x>${XI_MAX}b`)}`} です。断面 ${tx(`x=${fmt(state.xc, 2)}b`)} での各項の大きさ:</p>`;
  const rows = [];
  for (let n = 1; n <= 5; n++) {
    const qn = inf ? Mdl.coef(state.ld, n, state.a) : (n <= state.N ? f.w[n] : 0);
    const ax = Mdl.TAU * n * state.xc;
    rows.push(`<tr><td>${n}</td><td>${fmt(qn, 3)}</td><td>${fmt((1 + ax) * Math.exp(-ax), 4)}</td><td>${fmt(qn * (1 + ax) * Math.exp(-ax), 4)}</td></tr>`);
  }
  h += `<table><tr><th>${tx('n')}</th><th>${tx('q_n\\,/\\,(P/b)')}</th><th>${tx('(1+\\alpha_n x)e^{-\\alpha_n x}')}</th><th>${tx('\\sigma_{xx}')} への寄与の振幅</th></tr>${rows.join('')}</table>`;

  h += `<p class="step">注意　側面の条件</p>`;
  const wall = f.at(state.xc, 0.5)[1];
  h += `<p class="note">${tx('y=\\pm b/2')} では ${tx('\\sin\\alpha_n y=\\sin n\\pi=0')} なので ${tx('\\sigma_{xy}=0')}、幅方向の変位 ${tx('u_y')} も 0 です。つまりこの解は、上下を<strong>滑らかな壁ではさんだ板</strong>（図の上下のローラー）の厳密解です。壁は ${tx('\\sigma_{yy}')} を受け持ちます（いまの断面の壁の上で ${tx(`\\sigma_{yy}=${fmt(wall)}\\,P/b`)}）。テキストの図1.1 のように側面が自由（${tx('\\sigma_{yy}=\\sigma_{xy}=0')}）な板は、${tx('\\cos\\alpha y')} の形では両方の条件を同時に満たせず、別の解き方（パプコビッチ–ファドルの固有関数）が必要になりますが、端面から幅程度で一様になる、という結論は同じです。</p>`;
  $('f-main').innerHTML = h;
}

// ---------------------------------------------------------------- URL ハッシュ
// 例: #k=sv&ld=pt&N=20  （k は将来この単元に他のページ（多項式の応力関数など）を足すときの切り替え）
function buildHash() {
  const p = new URLSearchParams();
  p.set('k', 'sv');
  if (state.ld !== 'pt') p.set('ld', state.ld);
  if (Mdl.LOADS[state.ld].usesA) p.set('a', state.a);
  p.set('N', Number.isFinite(state.N) ? state.N : 'inf');
  if (state.lz) p.set('lz', '1');
  if (state.comp) p.set('c', COMP_KEY[state.comp]);
  p.set('xc', state.xc);
  return p.toString();
}
function applyHash(h) {
  const p = new URLSearchParams(h);
  Object.assign(state, defaultState());
  if (Mdl.LOADS[p.get('ld')]) state.ld = p.get('ld');
  if (p.has('a') && +p.get('a') > 0 && +p.get('a') < 1) state.a = +p.get('a');
  if (p.get('N') === 'inf') state.N = Infinity;
  else if (p.has('N') && Number.isFinite(+p.get('N'))) state.N = Math.max(0, Math.min(N_MAX, Math.round(+p.get('N'))));
  if (Number.isFinite(state.N)) lastN = state.N;
  state.lz = p.get('lz') === '1';
  if (COMP_KEY.includes(p.get('c'))) state.comp = COMP_KEY.indexOf(p.get('c'));
  if (p.has('xc') && Number.isFinite(+p.get('xc'))) state.xc = Math.max(0.01, Math.min(XI_MAX, +p.get('xc')));
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

// ---------------------------------------------------------------- まとめて描く
let lastXs = 0;
function render(opts = {}) {
  syncInputs();
  const f = field();
  lastXs = renderPlate(f);
  drawColorbar();
  renderSection(f);
  renderDecay(f);
  clearTimeout(heavyTimer);
  if (opts.light) heavyTimer = window.setTimeout(() => renderFormulas(field(), lastXs), 150);
  else renderFormulas(f, lastXs);
  scheduleHash();
}
window.addEventListener('resize', () => render());

function boot() {
  applyHash(location.hash.replace(/^#/, ''));
  lastHash = location.hash.replace(/^#/, '');
  for (const el of document.querySelectorAll('.tex[data-tex]')) K().render(el.dataset.tex, el, { throwOnError: false });
  render();
}
if (window.katex) boot(); else window.addEventListener('load', boot);
