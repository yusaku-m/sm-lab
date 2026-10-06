// 微小平板（平面応力）の図。応力 3 成分の矢印・ひずみによる変形（誇張）・
// 0°・45°・90° のロゼットゲージ、それに φ の向きに回せる「回転ゲージ」を描く。
// 図の表記は Grading の 4ME 後期 week3.py（rosette_figure / plate_figure）に合わせた。

import { fmt } from './stress.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'Inter, "Noto Sans JP", sans-serif';
const INK = '#1d2932';
const MUTED = '#627078';
const C_SX = '#bd442c'; // σx（応力要素の図と同じ色）
const C_SY = '#245b8d'; // σy
const C_T = '#2f8f6f'; // τxy
const C_ROT = '#7d5ba6'; // 回転ゲージ・回した X 軸（3D の回した軸と同じ紫）
const C_ROT2 = '#b8860b'; // 回した Y 軸（3D と同じ金）

function el(tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
  if (text !== undefined) n.textContent = text;
  return n;
}

/** 応力の矢印（線＋塗りつぶした三角の矢じり）。 */
function arrow(g, x1, y1, x2, y2, color, width = 2, head = 7) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 0.5) return;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const hd = Math.min(head, len * 0.6);
  const bx = x2 - ux * hd;
  const by = y2 - uy * hd;
  g.appendChild(el('line', { x1, y1, x2: bx, y2: by, stroke: color, 'stroke-width': width }));
  const h = hd * 0.5;
  g.appendChild(el('polygon', { points: `${x2},${y2} ${bx - uy * h},${by + ux * h} ${bx + uy * h},${by - ux * h}`, fill: color }));
}

/** 座標軸の細い矢印（線の矢じり）。 */
function axisArrow(g, x1, y1, x2, y2) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  g.appendChild(el('line', { x1, y1, x2, y2, stroke: INK, 'stroke-width': 1 }));
  for (const s of [1, -1]) {
    g.appendChild(el('line', { x1: x2, y1: y2, x2: x2 - ux * 6 - uy * 3 * s, y2: y2 - uy * 6 + ux * 3 * s, stroke: INK, 'stroke-width': 1 }));
  }
}

/**
 * ひずみゲージ（格子の入った細長い長方形）。中心 (cx, cy) から角度 deg（数学の向き、反時計まわり）の
 * 向きへ off 離して置き、先端の座標を返す。
 */
function gauge(g, cx, cy, deg, off, len, w, opts = {}) {
  const a = (deg * Math.PI) / 180;
  const u = [Math.cos(a), -Math.sin(a)]; // SVG は y 下向き
  const n = [Math.sin(a), Math.cos(a)];
  const p0 = [cx + u[0] * off, cy + u[1] * off];
  const p1 = [p0[0] + u[0] * len, p0[1] + u[1] * len];
  const pt = (p, s) => `${p[0] + n[0] * s},${p[1] + n[1] * s}`;
  g.appendChild(
    el('polygon', {
      points: [pt(p0, w / 2), pt(p1, w / 2), pt(p1, -w / 2), pt(p0, -w / 2)].join(' '),
      fill: opts.fill || '#fdebd0', stroke: opts.stroke || INK, 'stroke-width': 0.9,
    })
  );
  for (let k = 1; k < 5; k++) {
    const s = -w / 2 + (w * k) / 5;
    g.appendChild(
      el('line', {
        x1: p0[0] + u[0] * 3 + n[0] * s, y1: p0[1] + u[1] * 3 + n[1] * s,
        x2: p1[0] - u[0] * 3 + n[0] * s, y2: p1[1] - u[1] * 3 + n[1] * s,
        stroke: opts.stroke || INK, 'stroke-width': 0.45,
      })
    );
  }
  return p1;
}

function label(g, x, y, text, color, anchor = 'middle', size = 12, extra = {}) {
  g.appendChild(el('text', { x, y, 'text-anchor': anchor, 'font-size': size, fill: color, 'font-family': FONT, ...extra }, text));
}

/** 誇張倍率をキリのよい数（1, 2, 5 × 10ⁿ）に丸める。 */
function niceScale(v) {
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  return (n < 2 ? 1 : n < 5 ? 2 : 5) * mag;
}

/**
 * 微小平板の図を描く。
 *   s   : 応力 {sx, sy, txy} [MPa]
 *   e   : ひずみ {ex, ey, gxy} [×10⁻⁶]
 *   phi : 回転ゲージ／回した X–Y 軸の角度 [rad]
 *   opts.showRot   : 回転ゲージ（または X–Y 軸）を描くか（φ を x–y 面で測っているときだけ）
 *   opts.rosette   : ロゼットを描くか。描かないときは中心に回した X–Y 軸を描く
 *   opts.editable  : 応力の矢印に持ち手（[data-grab]）を付けるか（応力が既知のとき）
 *   opts.ref       : 矢印の長さの基準 [MPa]。ドラッグ中は固定して渡す（省略時は最大の成分から決める）
 *   opts.fontScale : スマホで文字だけ大きくする倍率
 * 戻り値: ドラッグに使う幾何（SVG のユーザー座標）と、使った ref
 */
export function renderPlate(host, s, e, phi, opts = {}) {
  const fs = opts.fontScale || 1;
  const F = (v) => +(v * fs).toFixed(2);
  // 矢印の先端（中心から 76+12+16+44×1.9 ≒ 188）とラベルが収まる幅
  const W = 400;
  const H = 330;
  const cx = W / 2;
  const cy = H / 2 + 4;
  const h = 76; // 板の半辺

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '微小平板' });

  // --- 座標軸（左下）
  const ax = el('g', {});
  const ox = 22;
  const oy = H - 18;
  axisArrow(ax, ox, oy, ox + 34, oy);
  axisArrow(ax, ox, oy, ox, oy - 34);
  label(ax, ox + 40, oy + 4, 'x', INK, 'start', F(12), { 'font-style': 'italic' });
  label(ax, ox, oy - 40, 'y', INK, 'middle', F(12), { 'font-style': 'italic' });
  svg.appendChild(ax);

  // --- 板と変形後の形（誇張）
  // 変位 u = εx·X + (γ/2)·Y, v = (γ/2)·X + εy·Y（剛体回転を除いた対称な形）。
  // 誇張の倍率は基本 MAG（500 倍）で固定し、変形後の角が図の枠をはみ出すときだけ（キリのよい数へ）下げる
  // （2026-10-06、ユーザーの指示。倍率が一定なら、荷重を変えたときの変形の大きさの違いがそのまま見える）。
  // 縮む側も、板の半分以上が潰れて形が分からなくなる（角が中心を越える）手前で止める。
  const g2 = e.gxy / 2;
  const px = (Math.abs(e.ex) + Math.abs(g2)) * 1e-6; // 角の x 方向の変位の最大（板の半辺あたり）
  const py = (Math.abs(e.ey) + Math.abs(g2)) * 1e-6;
  const peak = Math.max(px, py);
  let mag = 0;
  if (peak > 1e-9) {
    const room = Math.min(
      px > 0 ? ((W / 2 - 8) / h - 1) / px : Infinity, // 左右の枠
      py > 0 ? (Math.min(cy, H - cy) - 8) / h / py - 1 / py : Infinity, // 上下の枠
      0.8 / peak // 潰れすぎない
    );
    mag = room >= MAG ? MAG : niceScale(room);
  }
  svg.appendChild(
    el('rect', { x: cx - h, y: cy - h, width: 2 * h, height: 2 * h, fill: '#f3ede0', stroke: INK, 'stroke-width': 1.6 })
  );
  if (mag) {
    const corner = (X, Y) => {
      const u = (e.ex * X + g2 * Y) * 1e-6 * mag;
      const v = (g2 * X + e.ey * Y) * 1e-6 * mag;
      return `${cx + (X + u) * h},${cy - (Y + v) * h}`;
    };
    svg.appendChild(
      el('polygon', {
        points: [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)].join(' '),
        fill: 'none', stroke: '#ef6a4b', 'stroke-width': 1.5, 'stroke-dasharray': '6 4',
      })
    );
    label(svg, W - 8, H - 10, `破線: 変形後（×${mag.toLocaleString('en-US')} に誇張）`, '#bd442c', 'end', F(10.5));
  }

  // --- 応力の矢印（符号どおりの向き。長さは応力に比例し、ref のとき NLEN・TLEN）
  // 最小の長さを設けないのは、ドラッグで引張⇄圧縮をまたぐとき矢印が 0 まで縮んでから反対向きに伸びる
  // （跳ばない）ようにするため。ref は最大の成分（下限 50 MPa）。ドラッグ中は app.js が固定して渡す。
  const ref = opts.ref || Math.max(Math.abs(s.sx), Math.abs(s.sy), Math.abs(s.txy), 50);
  const gap = 12;
  const len = (v) => Math.min(NMAX, NLEN * (Math.abs(v) / ref)); // 垂直応力の矢印の長さ
  const tlen = (v) => Math.min(h - 8, TLEN * (Math.abs(v) / ref)); // せん断の矢印の半分の長さ
  const zero = (v) => Math.abs(v) < 0.05;
  const ga = el('g', {});
  // 当たり判定（見えない太い線）。矢印そのものに重ね、0 のときも面のそばを掴めるよう最小の長さを持たせる。
  // data-dir は「その向きに動かすと値が増える」向き（SVG の座標、y 下向き）
  const grabs = el('g', {});
  const hit = (key, dir, x1, y1, x2, y2) => {
    if (!opts.editable) return;
    grabs.appendChild(el('line', {
      x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': 18, 'stroke-linecap': 'butt', // round だと端が膨らんで隣の矢印の判定を覆う
      'data-grab': key, 'data-dir': dir.join(','),
    }));
  };
  const nGrab = []; // 垂直応力の当たり判定はせん断より前面に置く（交わるところでは垂直応力を優先）
  {
    const L = len(s.sx);
    for (const sg of [1, -1]) {
      const a = cx + sg * (h + gap);
      const b = cx + sg * (h + gap + L);
      if (!zero(s.sx)) {
        if (s.sx > 0) arrow(ga, a, cy, b, cy, C_SX);
        else arrow(ga, b, cy, a, cy, C_SX);
      }
      nGrab.push(['sx', [sg, 0], cx + sg * (h + gap + 3), cy, cx + sg * (h + gap + Math.max(L, 30)), cy]);
    }
    // 短い矢印でもラベルが +x 面のせん断の矢印に被らないよう、中心を面から 46 以上離す
    if (!zero(s.sx)) label(ga, cx + h + gap + Math.max(L / 2, 46), cy + F(20), `σx = ${fmt(s.sx)}`, C_SX, 'middle', F(12));
  }
  {
    const L = len(s.sy);
    for (const sg of [1, -1]) {
      const a = cy - sg * (h + gap);
      const b = cy - sg * (h + gap + L);
      if (!zero(s.sy)) {
        if (s.sy > 0) arrow(ga, cx, a, cx, b, C_SY);
        else arrow(ga, cx, b, cx, a, C_SY);
      }
      nGrab.push(['sy', [0, -sg], cx, cy - sg * (h + gap + 3), cx, cy - sg * (h + gap + Math.max(L, 30))]);
    }
    if (!zero(s.sy)) label(ga, cx + 12, cy - h - gap - Math.max(L / 2, 10) + 4, `σy = ${fmt(s.sy)}`, C_SY, 'start', F(12));
  }
  {
    // +x 面で +y 向き、+y 面で +x 向きが正。反対の面は逆向き
    const sg = s.txy < 0 ? -1 : 1;
    const L = tlen(s.txy);
    const d = 6;
    if (!zero(s.txy)) {
      arrow(ga, cx + h + d, cy + sg * L, cx + h + d, cy - sg * L, C_T, 1.8, 6);
      arrow(ga, cx - h - d, cy - sg * L, cx - h - d, cy + sg * L, C_T, 1.8, 6);
      arrow(ga, cx - sg * L, cy - h - d, cx + sg * L, cy - h - d, C_T, 1.8, 6);
      arrow(ga, cx + sg * L, cy + h + d, cx - sg * L, cy + h + d, C_T, 1.8, 6);
      label(ga, cx + h + 14, cy - h - 8, `τxy = ${fmt(s.txy)}`, C_T, 'start', F(12));
    }
    const Lh = Math.max(L, 22);
    hit('txy', [0, -1], cx + h + d, cy - Lh, cx + h + d, cy + Lh); // +x 面: 上へ動かすと増える
    hit('txy', [0, 1], cx - h - d, cy - Lh, cx - h - d, cy + Lh); // −x 面: 下へ
    hit('txy', [1, 0], cx - Lh, cy - h - d, cx + Lh, cy - h - d); // +y 面: 右へ
    hit('txy', [-1, 0], cx - Lh, cy + h + d, cx + Lh, cy + h + d); // −y 面: 左へ
  }
  for (const g of nGrab) hit(...g);
  svg.appendChild(ga);
  label(svg, W - 8, 16, '[MPa]', MUTED, 'end', F(10.5));

  const off = 9;
  const gl = 40;
  const gw = 10;
  if (opts.rosette) {
    // --- ロゼット（0°・45°・90°）。中心から放射状に、少し離して置く（week3.py と同じ並び）
    const gr = el('g', {});
    const t0 = gauge(gr, cx, cy, 0, off, gl, gw);
    const t45 = gauge(gr, cx, cy, 45, off, gl, gw);
    const t90 = gauge(gr, cx, cy, 90, off, gl, gw);
    label(gr, t0[0] + 5, t0[1] + 4, 'εx', INK, 'start', F(12));
    label(gr, t45[0] + 4, t45[1] - 2, 'εp', INK, 'start', F(12));
    label(gr, t90[0] + 8, t90[1] + 6, 'εy', INK, 'start', F(12));
    // 45° の円弧
    const r45 = off + gl + 10;
    const arcPt = (deg) => [cx + r45 * Math.cos((deg * Math.PI) / 180), cy - r45 * Math.sin((deg * Math.PI) / 180)];
    const [a0, a1] = [arcPt(6), arcPt(39)];
    gr.appendChild(el('path', { d: `M ${a0[0]} ${a0[1]} A ${r45} ${r45} 0 0 0 ${a1[0]} ${a1[1]}`, fill: 'none', stroke: MUTED, 'stroke-width': 0.8 }));
    const am = arcPt(22.5);
    label(gr, am[0] + 4, am[1] + 4, '45°', MUTED, 'start', F(9.5));
    svg.appendChild(gr);

    // --- 回転ゲージ（φ の向き）。φ = 0 では εx のゲージにぴったり重なるので出さず、回したときだけ出す
    // （2026-10-06、ユーザーの指示）。ロゼットと同じ側に描くので、φ = 45°・90° では εp・εy のゲージに重なり、
    // 「重なった＝そのゲージと同じ読み」が見て分かる。向きは φ そのまま（ロゼットを隠したときの X 軸と同じ）。
    // 以前は (−90°, 90°] に畳んでいたが、φ が ±90° を越えたところでゲージが反対側へ跳んで見えた（2026-10-06）。
    if (opts.showRot && Math.abs(phi) > 1e-4) {
      const rg = el('g', {});
      const deg = (phi * 180) / Math.PI;
      const u = [Math.cos(phi), -Math.sin(phi)];
      rg.appendChild(
        el('line', {
          x1: cx - u[0] * (h + 4), y1: cy - u[1] * (h + 4), x2: cx + u[0] * (h + 4), y2: cy + u[1] * (h + 4),
          stroke: C_ROT, 'stroke-width': 1, 'stroke-dasharray': '4 4', 'stroke-opacity': 0.7,
        })
      );
      // 下のロゼットのゲージが透けて見えるよう半透明にする（重なっていることが分かるように）
      rg.setAttribute('opacity', '0.85');
      const tip = gauge(rg, cx, cy, deg, off, gl, gw, { fill: '#e4d8f3', stroke: C_ROT });
      // ラベルはロゼットのラベル（先端のすぐ横）より外に置く（重なったときに εp などと被らないように）
      label(rg, tip[0] + u[0] * 22, tip[1] + u[1] * 22 + 4, 'εX', C_ROT, 'middle', F(12), { 'font-weight': 600 });
      svg.appendChild(rg);
    }
  } else {
    // --- ロゼットを出さないときは、中心に元の x–y 軸（破線）と回した X–Y 軸（3D の探触点と同じ紫・金）
    const g = el('g', {});
    const R = h - 10;
    g.appendChild(el('line', { x1: cx - R, y1: cy, x2: cx + R, y2: cy, stroke: MUTED, 'stroke-width': 1, 'stroke-dasharray': '3 3', 'stroke-opacity': 0.6 }));
    g.appendChild(el('line', { x1: cx, y1: cy + R, x2: cx, y2: cy - R, stroke: MUTED, 'stroke-width': 1, 'stroke-dasharray': '3 3', 'stroke-opacity': 0.6 }));
    label(g, cx + R + 4, cy - 4, 'x', MUTED, 'start', F(11), { 'font-style': 'italic' });
    label(g, cx + 5, cy - R + 2, 'y', MUTED, 'start', F(11), { 'font-style': 'italic' });
    if (opts.showRot) {
      const L = 58;
      const ux = [Math.cos(phi), -Math.sin(phi)];
      const uy = [-Math.sin(phi), -Math.cos(phi)];
      arrow(g, cx, cy, cx + ux[0] * L, cy + ux[1] * L, C_ROT, 2.2, 8);
      arrow(g, cx, cy, cx + uy[0] * L, cy + uy[1] * L, C_ROT2, 2.2, 8);
      label(g, cx + ux[0] * (L + 11), cy + ux[1] * (L + 11) + 4, 'X', C_ROT, 'middle', F(13), { 'font-weight': 600 });
      label(g, cx + uy[0] * (L + 11), cy + uy[1] * (L + 11) + 4, 'Y', C_ROT2, 'middle', F(13), { 'font-weight': 600 });
      if (Math.abs(phi) > 1e-4) {
        // φ の円弧（x 軸から X 軸まで）
        const r = 26;
        const p1 = [cx + r * Math.cos(phi), cy - r * Math.sin(phi)];
        g.appendChild(el('path', { d: `M ${cx + r} ${cy} A ${r} ${r} 0 0 ${phi > 0 ? 0 : 1} ${p1[0]} ${p1[1]}`, fill: 'none', stroke: C_ROT, 'stroke-width': 1 }));
        label(g, cx + (r + 9) * Math.cos(phi / 2), cy - (r + 9) * Math.sin(phi / 2) + 4, 'φ', C_ROT, 'middle', F(11));
      }
    }
    svg.appendChild(g);
  }

  svg.appendChild(grabs); // 持ち手は最前面
  host.replaceChildren(svg);
  return { cx, cy, h, gap, ref };
}

// 矢印の長さの係数（app.js のドラッグが逆算に使う）
// 変形の誇張の倍率（枠からはみ出すときだけ下げる）
const MAG = 500;
export const NLEN = 60; // 垂直応力の矢印の長さ（応力が ref のとき）
export const NMAX = 100; // 垂直応力の矢印の長さの上限（図からはみ出さないように）
export const TLEN = 48; // せん断の矢印の半分の長さ（応力が ref のとき。上限は板の半辺 − 8）
