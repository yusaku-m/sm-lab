// モールの応力円（SVG）と、回転させた応力要素の図。
// 3D 表示（rod3d.js）とは独立しており、応力成分 {sx, sy, sz, txy} と
// 回転角 φ だけを受け取って描く。

import { rotated, principalAngle, fmt } from './stress.js';

const NS = 'http://www.w3.org/2000/svg';

export const PLANES = [
  { key: 'xy', label: 'x–y 面（軸–周方向）', short: 'x–y', color: '#ef6a4b', a: 'sx', b: 'sy', t: 'txy', an: 'x', bn: 'y' },
  { key: 'yr', label: 'y–r 面（周–半径方向）', short: 'y–r', color: '#2f8f6f', a: 'sy', b: 'sr', t: 'tyr', an: 'y', bn: 'r' },
  { key: 'rx', label: 'r–x 面（半径–軸方向）', short: 'r–x', color: '#245b8d', a: 'sr', b: 'sx', t: 'trx', an: 'r', bn: 'x' },
];

function el(tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
  if (text !== undefined) n.textContent = text;
  return n;
}

/** <text> の外形（SVG のユーザー座標）。DOM に入っていないと測れない。 */
function textBox(t) {
  const b = t.getBBox();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function boxesHit(a, b, pad = 1) {
  return (
    a.x < b.x + b.w + pad && b.x < a.x + a.w + pad &&
    a.y < b.y + b.h + pad && b.y < a.y + a.h + pad
  );
}

/**
 * ラベルの重なりを実測して縦にずらす。
 *   data-fixed : 動かさない（軸名・目盛り）。当たり判定にだけ使う
 *   data-nudge : ずらしてよい。小さい数字から順に置くので優先度になる
 * どうしても空きが無いラベルは薄くする（消すと値が読めなくなるため）。
 * 個別に位置を調整して回るより、こうして事後に解消するほうが、
 * 荷重や軸範囲の組合せが変わっても破綻しない。
 */
/** ラベルが viewBox の左右から出ていたら、実測して内側へ寄せる。 */
function clampLabelIntoView(t, W) {
  const b = textBox(t);
  let dx = 0;
  if (b.x < 2) dx = 2 - b.x;
  else if (b.x + b.w > W - 2) dx = W - 2 - (b.x + b.w);
  if (dx) t.setAttribute('x', String(parseFloat(t.getAttribute('x')) + dx));
}

function avoidLabelOverlaps(svg, step, W) {
  let placed;
  try {
    const fixed = [...svg.querySelectorAll('[data-fixed]')];
    for (const t of fixed) clampLabelIntoView(t, W); // 動かさないラベルも左右だけは枠内へ
    placed = fixed.map(textBox);
  } catch (e) {
    return; // getBBox が使えない環境（描画前など）では何もしない
  }
  const movable = [...svg.querySelectorAll('[data-nudge]')].sort(
    (a, b) => Number(a.dataset.nudge) - Number(b.dataset.nudge)
  );
  const tries = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
  for (const t of movable) {
    clampLabelIntoView(t, W); // 先に左右を枠内へ入れてから、縦の重なりを解消する
    const y0 = parseFloat(t.getAttribute('y'));
    let ok = false;
    for (const k of tries) {
      t.setAttribute('y', String(y0 + k * step));
      const b = textBox(t);
      if (!placed.some((q) => boxesHit(q, b))) {
        placed.push(b);
        ok = true;
        break;
      }
    }
    if (!ok) {
      t.setAttribute('y', String(y0));
      t.setAttribute('fill-opacity', '0.45');
      placed.push(textBox(t));
    }
  }
}

function niceStep(span, target) {
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

/** 線＋三角の矢じりを g に足す。 */
function arrow(g, x1, y1, x2, y2, color, width = 1.6, head = 6) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  g.appendChild(el('line', { x1, y1, x2: bx, y2: by, stroke: color, 'stroke-width': width, 'stroke-linecap': 'round' }));
  const px = -uy;
  const py = ux;
  const h = head * 0.5;
  g.appendChild(
    el('polygon', {
      points: `${x2},${y2} ${bx + px * h},${by + py * h} ${bx - px * h},${by - py * h}`,
      fill: color,
    })
  );
}

// ------------------------------------------------------------------ 応力円

/**
 * モールの応力円を描く。
 * host    : SVG を入れる要素
 * comps   : {sx, sy, sr, txy}
 * an      : analyze() の戻り値（主応力の表示に使う）
 * visible : {xy:bool, yr:bool, rx:bool}
 * phi     : 回転角 [rad]
 */
export function renderCircles(host, comps, an, visible, phi, opts = {}) {
  // fontScale: スマホでは SVG 全体が縮小表示されるので、文字だけ大きめに描く
  const fs = opts.fontScale || 1;
  const F = (v) => +(v * fs).toFixed(2);

  const W = 470;
  let H = 356;
  const ml = 26 + 20 * fs;
  const mr = 24;
  const mt = 14 + 10 * fs; // τ の軸名をプロットの上に置くぶん
  const mb = 28 + 14 * fs;
  const pw = W - ml - mr;
  let ph = H - mt - mb;

  const shown = PLANES.filter((p) => visible[p.key]);
  const circles = shown.map((p) => {
    const a = comps[p.a];
    const b = comps[p.b];
    const t = p.t === 'txy' ? comps.txy : 0; // τyr, τrx は本単元では常に 0
    return { plane: p, c: (a + b) / 2, r: Math.hypot((a - b) / 2, t), a, b, t };
  });

  // 軸の範囲。固定なら指定値そのまま（余白を足さない）、自動なら円に合わせる。
  const axis = opts.axis && opts.axis.mode === 'fixed' ? opts.axis : null;
  let sMin = 0, sMax = 0, tMax = 0;
  if (axis) {
    sMin = Math.min(axis.sMin, axis.sMax);
    sMax = Math.max(axis.sMin, axis.sMax);
    tMax = Math.abs(axis.tMax);
    if (sMax - sMin < 1e-6) sMax = sMin + 1;
    if (tMax < 1e-6) tMax = 1;
  } else {
    for (const c of circles) {
      sMin = Math.min(sMin, c.c - c.r);
      sMax = Math.max(sMax, c.c + c.r);
      tMax = Math.max(tMax, c.r);
    }
    // 荷重ゼロでも軸が潰れないように最小スパンを確保
    const floor = Math.max(1, (sMax - sMin) * 0.02);
    if (sMax - sMin < floor) { sMax += floor / 2; sMin -= floor / 2; }
    if (tMax < floor / 2) tMax = floor / 2;
    const padS = (sMax - sMin) * 0.14;
    sMin -= padS; sMax += padS;
    tMax *= 1.22;
  }

  if (axis) {
    // 指定した範囲がそのまま映るように、プロット領域の縦横比を範囲の比に合わせる
    // （円が円に見えるよう縦横のスケールは常に同じにしているので、こうしないと
    //   片方が指定より広く映って「入力した値と目盛りが合わない」ことになる）。
    // 極端な比を指定されたときだけ上下に丸め、その場合は従来どおり両方が収まる
    // ように縮める（指定より広く映る）。
    const want = (2 * tMax * pw) / (sMax - sMin);
    ph = Math.min(Math.max(want, 130), 620);
    H = mt + ph + mb;
  }
  const k = Math.min(pw / (sMax - sMin), ph / (2 * tMax));
  const sMid = (sMin + sMax) / 2;
  const cx = ml + pw / 2;
  const cy = mt + ph / 2;
  const X = (s) => cx + (s - sMid) * k;
  // τ は「下向きが正」。こうすると、面を φ 回したとき円上の点が同じ向き（反時計まわり）に
  // 2φ 動いて見える。値そのものは変えていないので、ラベルや成分表の数字は τ のまま。
  const Y = (t) => cy + t * k;
  const clampX = (x) => Math.min(ml + pw, Math.max(ml, x));
  // 円が円に見えるよう縦横のスケールは同じにしているので、指定した範囲より
  // 片方が広く映る。目盛りと「取り込む」ボタンは実際に映る範囲を使う。
  const shownS = [sMid - pw / 2 / k, sMid + pw / 2 / k];
  const shownT = ph / 2 / k;
  const inPlot = (s, t) => s >= shownS[0] && s <= shownS[1] && Math.abs(t) <= shownT;
  sMin = shownS[0];
  sMax = shownS[1];
  tMax = shownT;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'モールの応力円' });
  const font = 'Inter, "Noto Sans JP", sans-serif';
  const serif = 'Georgia, serif';

  // 軸を固定したとき、範囲外へ出た円や弦はここで切る（はみ出しが見えるように）
  const defs = el('defs', {});
  const clip = el('clipPath', { id: 'mohr-plot-clip' });
  clip.appendChild(el('rect', { x: ml, y: mt, width: pw, height: ph }));
  defs.appendChild(clip);
  svg.appendChild(defs);
  const CLIP = 'url(#mohr-plot-clip)';

  // --- 目盛り
  const step = niceStep(sMax - sMin, 6);
  const digits = Math.abs(step) < 1 ? 2 : 0;
  const grid = el('g', {});
  for (let v = Math.ceil(sMin / step) * step; v <= sMax; v += step) {
    const x = X(v);
    grid.appendChild(el('line', { x1: x, y1: mt, x2: x, y2: mt + ph, stroke: '#1d29320f', 'stroke-width': 1 }));
    grid.appendChild(
      el('text', { x, y: mt + ph + F(15), 'text-anchor': 'middle', 'font-size': F(10), fill: '#627078', 'font-family': font, 'data-fixed': '1' }, fmt(v, digits))
    );
  }
  for (let v = -Math.floor(tMax / step) * step; v <= tMax; v += step) {
    if (Math.abs(v) < 1e-9) continue;
    const y = Y(v);
    if (y < mt || y > mt + ph) continue;
    grid.appendChild(el('line', { x1: ml, y1: y, x2: ml + pw, y2: y, stroke: '#1d29320f', 'stroke-width': 1 }));
    // 端の目盛りは枠の内側へ寄せる（角で σ 側の目盛りや軸名と重なるため）
    const ty = Math.min(Math.max(y + F(3.5), mt + F(9)), mt + ph - F(1));
    grid.appendChild(el('text', { x: ml - 7, y: ty, 'text-anchor': 'end', 'font-size': F(10), fill: '#627078', 'font-family': font, 'data-fixed': '1' }, fmt(v, digits)));
  }
  svg.appendChild(grid);

  // --- 軸
  const axes = el('g', {});
  axes.appendChild(el('line', { x1: ml, y1: Y(0), x2: ml + pw, y2: Y(0), stroke: '#1d293255', 'stroke-width': 1.2 }));
  if (X(0) >= ml && X(0) <= ml + pw) {
    axes.appendChild(el('line', { x1: X(0), y1: mt, x2: X(0), y2: mt + ph, stroke: '#1d293255', 'stroke-width': 1.2 }));
  }
  axes.appendChild(el('text', { x: ml + pw, y: Y(0) - F(8), 'text-anchor': 'end', 'font-size': F(12), fill: '#1d2932', 'font-family': serif, 'font-style': 'italic', 'data-fixed': '1' }, 'σ  [MPa]'));
  // τ の軸名は正の側（下）の左端へ。左マージンに置くと τ の目盛りと同じ列で重なり、
  // 上に置くと正の向きと逆の位置に名前があることになって紛らわしい。
  axes.appendChild(el('text', { x: ml + 4, y: mt + ph - F(5), 'text-anchor': 'start', 'font-size': F(12), fill: '#1d2932', 'font-family': serif, 'font-style': 'italic', 'data-fixed': '1' }, 'τ  [MPa] ↓正'));
  svg.appendChild(axes);

  // --- 円（主円 xy は最後に描いて前面に）
  const ordered = circles.slice().sort((p, q) => (p.plane.key === 'xy' ? 1 : 0) - (q.plane.key === 'xy' ? 1 : 0));
  for (const c of ordered) {
    const main = c.plane.key === 'xy';
    const g = el('g', { 'clip-path': CLIP });
    g.appendChild(
      el('circle', {
        cx: X(c.c), cy: Y(0), r: Math.max(0.6, c.r * k),
        fill: c.plane.color, 'fill-opacity': main ? 0.07 : 0.04,
        stroke: c.plane.color, 'stroke-width': main ? 2 : 1.4,
        'stroke-dasharray': main ? undefined : '5 4',
      })
    );
    g.appendChild(el('circle', { cx: X(c.c), cy: Y(0), r: 2.4, fill: c.plane.color }));
    svg.appendChild(g);
  }

  // --- 主応力の位置
  const pg = el('g', {});
  // 値が同じものはまとめて 1 つのラベルにする（σ₂=σ₃=0.0 のような場合）
  const groups = [];
  for (const [name, v] of [['σ₁', an.s1], ['σ₂', an.s2], ['σ₃', an.s3]]) {
    if (!inPlot(v, 0)) continue; // 軸を固定していて範囲外なら描かない
    const g = groups.find((q) => Math.abs(q.v - v) < 0.05);
    if (g) g.names.push(name);
    else groups.push({ v, names: [name] });
  }
  groups.forEach((gp, i) => {
    const x = X(gp.v);
    pg.appendChild(el('line', { x1: x, y1: Y(0) - 5, x2: x, y2: Y(0) + 5, stroke: '#1d2932', 'stroke-width': 1.4 }));
    pg.appendChild(
      el('text', {
        x: clampX(x), y: Y(0) + F(24), 'text-anchor': 'middle',
        'font-size': F(10.5), fill: '#1d2932', 'font-family': font,
        'data-nudge': String(10 + i),
      }, `${gp.names.join('=')}=${fmt(gp.v)}`)
    );
  });
  svg.appendChild(pg);

  // --- x–y 面の面応力点と回転
  if (visible.xy) {
    const main = circles.find((c) => c.plane.key === 'xy');
    const rot = rotated(comps, phi);
    const A = { s: rot.sn, t: rot.tau };
    const B = { s: rot.sn90, t: -rot.tau };
    const g = el('g', { 'clip-path': CLIP });
    const gLab = el('g', {}); // ラベルはクリップしない（点が範囲内のときだけ描く）

    // φ=0 の直径（基準）を点線で残しておく。回した直径との角度差がそのまま 2φ になる。
    g.appendChild(
      el('line', {
        x1: X(comps.sx), y1: Y(comps.txy), x2: X(comps.sy), y2: Y(-comps.txy),
        stroke: '#bd442c', 'stroke-width': 1.3, 'stroke-dasharray': '5 4', 'stroke-opacity': 0.45,
      })
    );
    g.appendChild(el('circle', { cx: X(comps.sx), cy: Y(comps.txy), r: 3.2, fill: '#ef6a4b', 'fill-opacity': 0.45 }));
    g.appendChild(el('circle', { cx: X(comps.sy), cy: Y(-comps.txy), r: 3.2, fill: '#ef6a4b', 'fill-opacity': 0.45 }));

    // 2φ の円弧
    if (Math.abs(phi) > 1e-4 && main.r * k > 10) {
      const rr = Math.min(main.r * k * 0.42, 34);
      // 画面上の角度（y 下向き）で組み立てる。縦軸の向きに依存しない。
      const ang = (s, t) => Math.atan2(Y(t) - Y(0), X(s) - X(main.c));
      const a0 = ang(comps.sx, comps.txy);
      let da = ang(A.s, A.t) - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const a1 = a0 + da;
      const sweep = da > 0 ? 1 : 0; // 画面座標では角度が増える向き＝時計まわり
      const p0 = [X(main.c) + rr * Math.cos(a0), Y(0) + rr * Math.sin(a0)];
      const p1 = [X(main.c) + rr * Math.cos(a1), Y(0) + rr * Math.sin(a1)];
      g.appendChild(
        el('path', {
          d: `M ${p0[0]} ${p0[1]} A ${rr} ${rr} 0 0 ${sweep} ${p1[0]} ${p1[1]}`,
          fill: 'none', stroke: '#bd442c', 'stroke-width': 1.2, 'stroke-dasharray': '3 3',
        })
      );
      g.appendChild(
        el('text', {
          x: X(main.c) + (rr + F(12)) * Math.cos(a0 + da / 2),
          y: Y(0) + (rr + F(12)) * Math.sin(a0 + da / 2) + F(3.5),
          'text-anchor': 'middle', 'font-size': F(10.5), fill: '#bd442c', 'font-family': font,
          'data-nudge': '20',
        }, `2φ=${((2 * phi * 180) / Math.PI).toFixed(0)}°`)
      );
    }

    // 直径（2つの面を結ぶ弦）
    g.appendChild(el('line', { x1: X(A.s), y1: Y(A.t), x2: X(B.s), y2: Y(B.t), stroke: '#bd442c', 'stroke-width': 1.6 }));

    [[A, 'X面', 1], [B, 'Y面', 2]].forEach(([pt, name, prio]) => {
      if (!inPlot(pt.s, pt.t)) return;
      const px = X(pt.s);
      const toRight = px <= cx; // 右寄りの点はラベルを内側（左）へ出して枠から出さない
      g.appendChild(el('circle', { cx: px, cy: Y(pt.t), r: 5, fill: '#fffdf7', stroke: '#bd442c', 'stroke-width': 2 }));
      gLab.appendChild(
        el('text', {
          x: px + (toRight ? 9 : -9),
          y: Y(pt.t) + (Y(pt.t) <= Y(0) ? -F(8) : F(14)),
          'text-anchor': toRight ? 'start' : 'end',
          'font-size': F(10.5), fill: '#bd442c', 'font-family': font,
          'data-nudge': String(prio),
        }, `${name} (${fmt(pt.s)}, ${fmt(pt.t)})`)
      );
    });
    svg.appendChild(g);
    svg.appendChild(gLab);
  }

  // --- 図の中に主要な数値を書いておく（スマホでは成分表を省略するため）
  svg.appendChild(
    el('text', {
      // まとめ行は横に長いので、他のラベルほど大きくしない（スマホで枠から出るため）
      x: ml, y: H - 4, 'font-size': Math.min(F(10.5), 12.2), fill: '#627078', 'font-family': font, 'data-fixed': '1',
    }, `τmax = ${fmt(an.tmax)} ／ σeq = ${fmt(an.vm)} ／ ${fs > 1.2 ? '' : 'σ₁ の向き '}θp = ${((principalAngle(comps) * 180) / Math.PI).toFixed(1)}°`)
  );

  host.replaceChildren(svg);
  // 挿入してからでないと getBBox で実測できないので、ここで重なりを解消する
  avoidLabelOverlaps(svg, F(13), W);
  return { sMin, sMax, tMax };
}

// ------------------------------------------------------------ 応力要素の図

/**
 * φ だけ回した微小要素に働く応力を描く。
 * 回した座標系は講義資料に合わせて大文字 X–Y（破線のガイドが元の x–y 軸）。
 */
export function renderElement(host, comps, an, phi, opts = {}) {
  // fontScale: スマホでは小さく縮小表示されるので、文字だけ大きく描く
  // （そのぶんラベルがはみ出さないよう viewBox も少し広げる）
  const fs = opts.fontScale || 1;
  const F = (v) => +(v * fs).toFixed(2);
  const S = 250 + 24 * (fs - 1);
  const c = S / 2;
  const h = 44; // 要素の半辺
  const rot = rotated(comps, phi);
  const ref = Math.max(Math.abs(an.s1), Math.abs(an.s3), Math.abs(comps.txy), 1e-6);
  const len = (v) => 14 + 32 * (Math.abs(v) / ref);

  const svg = el('svg', { viewBox: `0 0 ${S} ${S}`, role: 'img', 'aria-label': '応力要素' });
  const font = 'Inter, "Noto Sans JP", sans-serif';

  // 回転前の x–y 軸（薄いガイド）
  const guide = el('g', { opacity: 0.35 });
  guide.appendChild(el('line', { x1: c - 104, y1: c, x2: c + 104, y2: c, stroke: '#627078', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
  guide.appendChild(el('line', { x1: c, y1: c - 104, x2: c, y2: c + 104, stroke: '#627078', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
  guide.appendChild(el('text', { x: c + 108, y: c + 4, 'font-size': F(11), fill: '#627078', 'font-family': font }, 'x'));
  guide.appendChild(el('text', { x: c - 5, y: c - 108, 'font-size': F(11), fill: '#627078', 'font-family': font }, 'y'));
  svg.appendChild(guide);

  // 回転した基底（画面は y 上向きなので sin の符号を反転して描く）
  const n = [Math.cos(phi), -Math.sin(phi)];
  const t = [-Math.sin(phi), -Math.cos(phi)];

  const corner = (a, b) => [c + n[0] * a * h + t[0] * b * h, c + n[1] * a * h + t[1] * b * h];
  const pts = [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)];
  svg.appendChild(
    el('polygon', {
      points: pts.map((p) => p.join(',')).join(' '),
      fill: '#ef6a4b14', stroke: '#1d2932', 'stroke-width': 1.5,
    })
  );

  const g = el('g', {});
  // 垂直応力（面の外向き法線方向）
  const faces = [
    { dir: n, val: rot.sn, color: '#bd442c', label: 'σX' },
    { dir: [-n[0], -n[1]], val: rot.sn, color: '#bd442c' },
    { dir: t, val: rot.sn90, color: '#245b8d', label: 'σY' },
    { dir: [-t[0], -t[1]], val: rot.sn90, color: '#245b8d' },
  ];
  for (const f of faces) {
    const base = [c + f.dir[0] * h, c + f.dir[1] * h];
    const tip = [c + f.dir[0] * (h + len(f.val)), c + f.dir[1] * (h + len(f.val))];
    if (f.val >= 0) arrow(g, base[0], base[1], tip[0], tip[1], f.color, 1.7);
    else arrow(g, tip[0], tip[1], base[0], base[1], f.color, 1.7);
    if (f.label) {
      g.appendChild(
        el('text', {
          x: c + f.dir[0] * (h + len(f.val) + 16),
          y: c + f.dir[1] * (h + len(f.val) + 16) + 4,
          'text-anchor': 'middle', 'font-size': F(12), fill: f.color, 'font-family': font,
        }, f.label)
      );
    }
  }

  // せん断応力（面に沿う向き）
  const tau = rot.tau;
  if (Math.abs(tau) > 1e-6) {
    const sl = 14 + 24 * (Math.abs(tau) / ref);
    const sgn = Math.sign(tau);
    const shears = [
      { pos: n, along: [t[0] * sgn, t[1] * sgn] },
      { pos: [-n[0], -n[1]], along: [-t[0] * sgn, -t[1] * sgn] },
      { pos: t, along: [n[0] * sgn, n[1] * sgn] },
      { pos: [-t[0], -t[1]], along: [-n[0] * sgn, -n[1] * sgn] },
    ];
    for (const s of shears) {
      const px = c + s.pos[0] * (h + 5);
      const py = c + s.pos[1] * (h + 5);
      arrow(g, px - s.along[0] * sl / 2, py - s.along[1] * sl / 2, px + s.along[0] * sl / 2, py + s.along[1] * sl / 2, '#2f8f6f', 1.7, 5.5);
    }
    g.appendChild(
      el('text', {
        x: c + t[0] * (h + 20) + n[0] * 40,
        y: c + t[1] * (h + 20) + n[1] * 40 + 4,
        'text-anchor': 'middle', 'font-size': F(12), fill: '#2f8f6f', 'font-family': font,
      }, 'τXY')
    );
  }
  svg.appendChild(g);
  host.replaceChildren(svg);
}
