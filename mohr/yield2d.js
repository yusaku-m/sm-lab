// 降伏条件（最大主応力説・最大せん断応力説・せん断ひずみエネルギー説）と平面応力の降伏曲面（SVG）。
// 応力成分 {sx, sy, sr, txy} と降伏応力だけを受け取って描く（3D 表示・応力円とは独立）。
//
// 記号は講義資料「06資料_材料の弾性限界」と Grading の packages/quiz/YieldSurface.py に合わせる:
// - 主応力は面外（r・z 方向）の主応力も含めて大きい順に σ1 ≧ σ2 ≧ σ3
// - 降伏曲面の軸は面内の 2 つの主応力を大小の順によらず σA・σB とする（σ1・σ2 を軸にすると
//   σ1 ≧ σ2 の約束と第 2・4 象限が両立しないため）。σA = 中心 + 半径、σB = 中心 − 半径（x–y 面の円）
// - 相当応力 σeq: ランキン max(σ1, −σ3)、トレスカ σ1 − σ3、
//   ミーゼス √{[(σ1−σ2)² + (σ2−σ3)² + (σ3−σ1)²]/2}
// - 圧縮側の限界 σYc が σY と違うとき（脆性材料）は、最大主応力説だけ σ1/σY と |σ3|/σYc を別々に比べる

const NS = 'http://www.w3.org/2000/svg';

export const CRITERIA = [
  { key: 'rankine', letter: 'r', name: '最大主応力説', who: 'ランキン', color: '#bd442c', dash: '2 3' },
  { key: 'tresca', letter: 't', name: '最大せん断応力説', who: 'トレスカ', color: '#245b8d', dash: '7 4' },
  { key: 'mises', letter: 'm', name: 'せん断ひずみエネルギー説', who: 'ミーゼス', color: '#1d2932', dash: null },
];

/** x–y 面内の 2 つの主応力 (σA ≧ σB)。 */
export function inPlane(c) {
  const cen = (c.sx + c.sy) / 2;
  const rad = Math.hypot((c.sx - c.sy) / 2, c.txy);
  return [cen + rad, cen - rad];
}

/** 3 つの主応力を大きい順に [σ1, σ2, σ3]（面外の主応力 sr も含める）。 */
export function principal3(c) {
  return [...inPlane(c), c.sr || 0].sort((a, b) => b - a);
}

/**
 * 各説の相当応力と、降伏応力に対する比率（1 以上で降伏）。
 * 最大主応力説で syc ≠ sy のときは eq を「σY に換算した値」（= 比率 × σY）にし、どちら側で決まったかを side に返す。
 */
export function evaluate(c, sy, syc) {
  const [s1, s2, s3] = principal3(c);
  const out = {};
  const rt = s1 > 0 ? s1 / sy : 0;
  const rc = s3 < 0 ? -s3 / syc : 0;
  out.rankine = { ratio: Math.max(rt, rc), eq: Math.max(rt, rc) * sy, side: rt >= rc ? 't' : 'c', rt, rc };
  out.tresca = { eq: s1 - s3 };
  out.tresca.ratio = out.tresca.eq / sy;
  out.mises = { eq: Math.sqrt(((s1 - s2) ** 2 + (s2 - s3) ** 2 + (s3 - s1) ** 2) / 2) };
  out.mises.ratio = out.mises.eq / sy;
  return { s: [s1, s2, s3], ...out };
}

/** 平面応力（σ面外 = 0）の各説の境界の点列 [[σA, σB], ...]。 */
function boundary(key, sy, syc) {
  if (key === 'rankine') return [[sy, sy], [-syc, sy], [-syc, -syc], [sy, -syc]];
  if (key === 'tresca') return [[sy, 0], [sy, sy], [0, sy], [-sy, 0], [-sy, -sy], [0, -sy]];
  // σA² − σAσB + σB² = σY²。u = (σA+σB)/√2、v = (σA−σB)/√2 とおくと u²/2 + 3v²/2 = σY²
  const pts = [];
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * 2 * Math.PI;
    const u = Math.SQRT2 * sy * Math.cos(t);
    const v = Math.sqrt(2 / 3) * sy * Math.sin(t);
    pts.push([(u + v) / Math.SQRT2, (u - v) / Math.SQRT2]);
  }
  return pts;
}

function el(tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
  if (text !== undefined) n.textContent = text;
  return n;
}

/** σ に下付き文字を付けた SVG テキスト。 */
function sigma(x, y, sub, attrs = {}) {
  const t = el('text', { x, y, ...attrs });
  t.appendChild(document.createTextNode(sub.startsWith('-') ? '−σ' : 'σ'));
  t.appendChild(el('tspan', { 'baseline-shift': 'sub', 'font-size': '0.72em' }, sub.replace(/^-/, '')));
  return t;
}

/**
 * 降伏曲面を描く。show = {rankine, tresca, mises}（true の説だけ描く）。
 * 原点から今の点を通る半直線（荷重を比例して大きくしたときの道すじ）と、各説の境界に当たる点も描く。
 */
export function renderYield(host, comps, { sy, syc, show, fontScale = 1 }) {
  const W = 320;
  const H = 320;
  const [sa, sb] = inPlane(comps);
  const keys = CRITERIA.filter((c) => show[c.key]).map((c) => c.key);
  let ext = Math.max(Math.abs(sa), Math.abs(sb), 1e-9);
  for (const k of keys) for (const p of boundary(k, sy, syc)) ext = Math.max(ext, Math.abs(p[0]), Math.abs(p[1]));
  ext *= 1.12;
  const m = 26;
  const k = (W - 2 * m) / (2 * ext);
  const cx = W / 2;
  const cy = H / 2;
  const X = (a) => cx + a * k;
  const Y = (b) => cy - b * k;
  const fs = 12 * fontScale;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'yield-svg', role: 'img', 'aria-label': '降伏曲面' });
  const axis = { stroke: '#1d2932', 'stroke-width': 1, 'marker-end': 'url(#yield-arrow)' };
  const defs = el('defs');
  const mk = el('marker', { id: 'yield-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
  mk.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#1d2932' }));
  defs.appendChild(mk);
  svg.appendChild(defs);
  svg.appendChild(el('line', { x1: m - 8, y1: cy, x2: W - m + 12, y2: cy, ...axis }));
  svg.appendChild(el('line', { x1: cx, y1: H - m + 8, x2: cx, y2: m - 12, ...axis }));
  svg.appendChild(sigma(W - m + 6, cy + fs + 4, 'A', { 'font-size': fs, fill: '#1d2932', 'text-anchor': 'middle' }));
  svg.appendChild(sigma(cx + 8, m - 6, 'B', { 'font-size': fs, fill: '#1d2932' }));

  for (const c of CRITERIA) {
    if (!show[c.key]) continue;
    const pts = boundary(c.key, sy, syc).map(([a, b]) => `${X(a).toFixed(2)},${Y(b).toFixed(2)}`).join(' ');
    svg.appendChild(el('polygon', {
      points: pts, fill: 'none', stroke: c.color, 'stroke-width': c.key === 'mises' ? 2 : 1.8,
      'stroke-dasharray': c.dash, 'stroke-linejoin': 'round',
    }));
  }
  // 目盛り（σY と −σY / −σYc）
  // 曲線と重なっても読めるよう、地の色で縁取る（paint-order: stroke）
  const tick = { 'font-size': fs * 0.85, fill: '#627078', stroke: '#fffdf7', 'stroke-width': 3, 'paint-order': 'stroke' };
  svg.appendChild(sigma(X(sy) + 3, cy + fs, 'Y', tick));
  svg.appendChild(sigma(cx - 4, Y(sy) - 4, 'Y', { ...tick, 'text-anchor': 'end' }));
  const negSub = show.rankine && syc !== sy ? '-Yc' : '-Y';
  const neg = show.rankine && syc !== sy ? syc : sy;
  svg.appendChild(sigma(X(-neg) - 3, cy - 5, negSub, { ...tick, 'text-anchor': 'end' }));
  svg.appendChild(sigma(cx + 4, Y(-neg) + fs, negSub, tick));

  // 原点から点を通る半直線と、各説の境界に当たる点
  const ev = evaluate({ ...comps, sr: 0 }, sy, syc);
  const norm = Math.max(Math.abs(sa), Math.abs(sb));
  if (norm > 1e-9) {
    const hits = keys.map((kk) => ({ kk, f: ev[kk].ratio > 0 ? 1 / ev[kk].ratio : Infinity }));
    const fmax = Math.min(Math.max(1, ...hits.map((h) => (Number.isFinite(h.f) ? h.f : 0))), ext / norm);
    svg.appendChild(el('line', {
      x1: X(0), y1: Y(0), x2: X(sa * fmax), y2: Y(sb * fmax), stroke: '#8a959b', 'stroke-width': 1, 'stroke-dasharray': '3 3',
    }));
    for (const h of hits) {
      if (!Number.isFinite(h.f) || h.f * norm > ext) continue;
      const c = CRITERIA.find((cc) => cc.key === h.kk);
      svg.appendChild(el('circle', { cx: X(sa * h.f), cy: Y(sb * h.f), r: 4, fill: '#fffdf7', stroke: c.color, 'stroke-width': 1.6 }));
    }
  }
  const yielded = keys.some((kk) => ev[kk].ratio >= 1);
  svg.appendChild(el('circle', { cx: X(sa), cy: Y(sb), r: 5, fill: yielded ? '#ef6a4b' : '#1d2932' }));
  host.replaceChildren(svg);
  return ev;
}
