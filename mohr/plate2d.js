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
  // 変位 u = εx·X + (γ/2)·Y, v = (γ/2)·X + εy·Y（剛体回転を除いた対称な形）。角の変位が板の 14% 程度になる倍率
  const g2 = e.gxy / 2;
  const peak = Math.max(Math.abs(e.ex) + Math.abs(g2), Math.abs(e.ey) + Math.abs(g2)) * 1e-6;
  const mag = peak > 1e-9 ? niceScale(0.14 / peak) : 0;
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

  // --- 応力の矢印（符号どおりの向き。長さは ref を基準にした相対値）
  // ref は最大の成分（下限 50 MPa）。ドラッグ中は app.js が固定して渡す（掴んだ矢印が指の下から逃げないように）
  const ref = opts.ref || Math.max(Math.abs(s.sx), Math.abs(s.sy), Math.abs(s.txy), 50);
  const gap = 12;
  const len = (v) => NLEN0 + NLEN * (Math.abs(v) / ref); // 垂直応力の矢印の長さ
  const tlen = (v) => Math.min(h - 8, TLEN0 + TLEN * (Math.abs(v) / ref)); // せん断の矢印の半分の長さ
  const zero = (v) => Math.abs(v) < 0.05;
  const ga = el('g', {});
  const grabs = el('g', {});
  const handle = (key, x, y, color) => {
    grabs.appendChild(el('circle', { cx: x, cy: y, r: 6, fill: color, 'fill-opacity': 0.16, stroke: color, 'stroke-width': 1.3 }));
    grabs.appendChild(el('circle', { cx: x, cy: y, r: 15, fill: 'transparent', 'data-grab': key }));
  };
  {
    const L = len(s.sx);
    if (!zero(s.sx)) {
      for (const sg of [1, -1]) {
        const a = cx + sg * (h + gap);
        const b = cx + sg * (h + gap + L);
        if (s.sx > 0) arrow(ga, a, cy, b, cy, C_SX);
        else arrow(ga, b, cy, a, cy, C_SX);
      }
      // 短い矢印でもラベルが +x 面のせん断の矢印・持ち手に被らないよう、中心を面から 46 以上離す
      label(ga, cx + h + gap + Math.max(L / 2, 46), cy + F(20), `σx = ${fmt(s.sx)}`, C_SX, 'middle', F(12));
    }
    if (opts.editable) handle('sx', cx + h + gap + L, cy, C_SX);
  }
  {
    const L = len(s.sy);
    if (!zero(s.sy)) {
      for (const sg of [1, -1]) {
        const a = cy - sg * (h + gap);
        const b = cy - sg * (h + gap + L);
        if (s.sy > 0) arrow(ga, cx, a, cx, b, C_SY);
        else arrow(ga, cx, b, cx, a, C_SY);
      }
      label(ga, cx + 12, cy - h - gap - L / 2 + 4, `σy = ${fmt(s.sy)}`, C_SY, 'start', F(12));
    }
    if (opts.editable) handle('sy', cx, cy - h - gap - L, C_SY);
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
    if (opts.editable) handle('txy', cx + h + d, cy - sg * L, C_T);
  }
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
    // 「重なった＝そのゲージと同じ読み」が見て分かる。ゲージは向きの無い線なので向きは (−90°, 90°] に畳む
    // （φ = −90° も εy に重なるように。0° のまわりは畳まないので、0 をまたいでも跳ばない）。
    if (opts.showRot && Math.abs(phi) > 1e-4) {
      const rg = el('g', {});
      let deg = (phi * 180) / Math.PI;
      while (deg > 90) deg -= 180;
      while (deg <= -90) deg += 180;
      const a = (deg * Math.PI) / 180;
      const u = [Math.cos(a), -Math.sin(a)];
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
export const NLEN0 = 16; // 垂直応力の矢印の最小の長さ
export const NLEN = 44; // ref のときに足す長さ
export const TLEN0 = 13; // せん断の矢印（半分）の最小の長さ
export const TLEN = 35;
