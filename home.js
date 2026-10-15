// トップページのサムネイル。各単元の図を簡略化した SVG を毎フレーム描き直して動かす。
// 画面外のカードは描かない（IntersectionObserver）。prefers-reduced-motion なら静止画。
// viewBox は 320×200（カードの .thumb が 16:10）。

const C = {
  ink: '#1d2932', muted: '#627078', paper: '#fffdf7', faint: '#1d293240',
  blue: '#245b8d', green: '#2f8f6f', accent: '#ef6a4b', accentStrong: '#bd442c',
  purple: '#7d5ba6', gold: '#b8860b',
};
const W = 320, H = 200;
const f = (n) => n.toFixed(1);
const ease = (t, period) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);

function arrow(x1, y1, x2, y2, { c = C.ink, w = 2.4, head = 9, dash = '', op = 1 } = {}) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len < 0.5) return '';
  const hl = Math.min(head, len), ux = dx / len, uy = dy / len;
  const bx = x2 - ux * hl, by = y2 - uy * hl, hw = hl * 0.45;
  const d = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<g opacity="${op}"><line x1="${f(x1)}" y1="${f(y1)}" x2="${f(bx)}" y2="${f(by)}" stroke="${c}" stroke-width="${w}"${d}/>` +
    `<polygon points="${f(x2)},${f(y2)} ${f(bx - uy * hw)},${f(by + ux * hw)} ${f(bx + uy * hw)},${f(by - ux * hw)}" fill="${c}"/></g>`;
}
// 斜体の記号。sub は下付き
function sym(x, y, s, { c = C.ink, size = 17, anchor = 'middle', sub = '', op = 1 } = {}) {
  const st = sub ? `<tspan font-size="${size * 0.68}" dy="${size * 0.28}">${sub}</tspan>` : '';
  return `<text x="${f(x)}" y="${f(y)}" fill="${c}" font-size="${size}" text-anchor="${anchor}" opacity="${op}" ` +
    `font-family="Georgia, 'Times New Roman', serif" font-style="italic">${s}${st}</text>`;
}
function bar(x1, x2, y, h) {
  return `<rect x="${x1}" y="${f(y - h / 2)}" width="${x2 - x1}" height="${h}" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.8"/>`;
}
function pin(x, y) {
  return `<polygon points="${x},${y} ${x - 9},${y + 12} ${x + 9},${y + 12}" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.5"/>` +
    hatch(x - 13, x + 13, y + 12);
}
function roller(x, y) {
  return `<polygon points="${x},${y} ${x - 9},${y + 10} ${x + 9},${y + 10}" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.5"/>` +
    `<circle cx="${x - 5}" cy="${y + 13}" r="2.6" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.2"/>` +
    `<circle cx="${x + 5}" cy="${y + 13}" r="2.6" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.2"/>` +
    hatch(x - 13, x + 13, y + 16);
}
function hatch(x1, x2, y) {
  let s = `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${C.ink}" stroke-width="1.5"/>`;
  for (let x = x1 + 3; x <= x2; x += 5) s += `<line x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + 5}" stroke="${C.ink}" stroke-width="1"/>`;
  return s;
}
function wall(x, y1, y2) {
  let s = `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${C.ink}" stroke-width="2"/>`;
  for (let y = y1 + 2; y <= y2; y += 6) s += `<line x1="${x}" y1="${y}" x2="${x - 6}" y2="${y + 6}" stroke="${C.ink}" stroke-width="1"/>`;
  return s;
}
function dim(x1, x2, y, label) {
  return arrow(x1 + 5, y, x1, y, { c: C.muted, w: 1, head: 5 }) + arrow(x1 + 4, y, x2, y, { c: C.muted, w: 1, head: 5 }) +
    sym((x1 + x2) / 2, y - 5, label, { size: 13, c: C.muted });
}

// ---------- 力とモーメントのつり合い：荷重 P を動かすと、モーメントのつり合いから右端の反力 R が変わる ----------
function equilibrium(t) {
  const x0 = 46, x1 = 280, y = 96, h = 12, r = 11;
  const a = 0.15 + 0.75 * ease(t, 7), xp = x0 + (x1 - x0) * a;
  const R = a;  // M_O = 0: P·a − R·L = 0
  const k = Math.sqrt(r * r - (h / 2) ** 2);
  let s = `<circle cx="${x0}" cy="${y}" r="${r}" fill="${C.paper}" stroke="${C.ink}" stroke-width="2.2"/>` +
    `<rect x="${x0}" y="${y - h / 2 + 1}" width="${x1 - x0}" height="${h - 2}" fill="${C.paper}"/>` +
    `<path d="M${f(x0 + k)} ${y - h / 2} H${x1} V${y + h / 2} H${f(x0 + k)}" fill="none" stroke="${C.ink}" stroke-width="2.2"/>` +
    `<circle cx="${x0}" cy="${y}" r="2.2" fill="${C.ink}"/>` + sym(x0 - 4, y + 34, 'O', { size: 16 });
  s += arrow(xp, y + h / 2, xp, y + 58, { c: C.blue, w: 3, head: 12 }) + `<circle cx="${f(xp)}" cy="${y + h / 2}" r="2.6" fill="${C.blue}"/>` +
    sym(xp + 14, y + 56, 'P', { c: C.blue });
  const top = y - h / 2 - 8 - 58 * R;
  s += arrow(x1, y - h / 2, x1, top, { c: C.green, w: 2.4, head: 11, dash: '5 4' }) + sym(x1 + 16, top + 14, 'R', { c: C.green });
  s += dim(x0, xp, 178, 'a') ;
  s += `<text x="20" y="30" fill="${C.ink}" font-size="14" font-family="Georgia, 'Times New Roman', serif">` +
    `<tspan font-style="italic">M</tspan><tspan font-size="10" dy="4">O</tspan><tspan dy="-4"> = </tspan>` +
    `<tspan font-style="italic">Pa</tspan> − <tspan font-style="italic">RL</tspan> = 0</text>`;
  return s;
}

// ---------- 梁：荷重を動かすと反力と BMD が変わる ----------
function beam(t) {
  const x0 = 40, x1 = 280, y = 76, a = 0.18 + 0.64 * ease(t, 6.5), xp = x0 + (x1 - x0) * a;
  let s = bar(x0, x1, y, 10) + pin(x0, y + 5) + roller(x1, y + 5);
  s += arrow(xp, 24, xp, y - 6, { c: C.blue, w: 3, head: 11 }) + sym(xp + 13, 34, 'P', { c: C.blue });
  [[x0, 1 - a, '1'], [x1, a, '2']].forEach(([x, R, i]) => {
    const tail = 104 + 34 * R;
    s += arrow(x, tail, x, 104, { c: C.green, w: 2.2, head: 8 }) + sym(x + (i === '1' ? 14 : -14), tail - 2, 'R', { c: C.green, size: 14, sub: i });
  });
  const by = 188, peak = by - 170 * a * (1 - a);
  s += `<polygon points="${x0},${by} ${f(xp)},${f(peak)} ${x1},${by}" fill="${C.accent}26" stroke="${C.accentStrong}" stroke-width="2" stroke-linejoin="round"/>` +
    `<line x1="${x0}" y1="${by}" x2="${x1}" y2="${by}" stroke="${C.ink}" stroke-width="1.2"/>` +
    `<line x1="${f(xp)}" y1="${y + 6}" x2="${f(xp)}" y2="${by}" stroke="${C.faint}" stroke-dasharray="3 4"/>` +
    sym(xp, peak - 8, 'M', { c: C.accentStrong, size: 14, sub: 'max' });
  return s;
}

// ---------- SFD・BMD：仮想断面が左から右へ進み、そこまでの V・M が描かれていく ----------
function sfdbmd(t) {
  const x0 = 40, x1 = 280, L = x1 - x0, y = 44;
  const per = 7.5, run = 6, u = Math.min(1, (t % per) / run), xc = x0 + L * u;
  let s = '';
  // 等分布荷重
  s += `<line x1="${x0}" y1="14" x2="${x1}" y2="14" stroke="${C.blue}" stroke-width="1.6"/>`;
  for (let i = 0; i <= 8; i++) { const x = x0 + (L * i) / 8; s += arrow(x, 14, x, y - 5, { c: C.blue, w: 1.4, head: 6 }); }
  s += sym(x1 + 16, 22, 'w', { c: C.blue, size: 15 });
  s += bar(x0, x1, y, 9) + pin(x0, y + 4.5) + roller(x1, y + 4.5);
  // SFD（V = wL/2 − wx）
  const sy = 112, sk = 46, V = (q) => 0.5 - q;
  s += `<line x1="${x0}" y1="${sy}" x2="${x1}" y2="${sy}" stroke="${C.ink}" stroke-width="1"/>` +
    `<path d="M${x0} ${sy} V${sy - sk * 0.5} L${x1} ${sy + sk * 0.5} V${sy}" fill="none" stroke="${C.blue}" stroke-opacity="0.35" stroke-dasharray="4 4"/>` +
    `<polygon points="${x0},${sy} ${x0},${sy - sk * 0.5} ${f(xc)},${f(sy - sk * V(u))} ${f(xc)},${sy}" fill="${C.blue}26" stroke="${C.blue}" stroke-width="2" stroke-linejoin="round"/>` +
    sym(18, sy + 5, 'V', { c: C.blue, size: 15 });
  // BMD（M = w x (L − x)/2、上が正）
  const my = 188, mk = 330, M = (q) => (q * (1 - q)) / 2;
  let ghost = '', fill = `${x0},${my}`;
  for (let i = 0; i <= 40; i++) {
    const q = i / 40, X = x0 + L * q, Y = my - mk * M(q);
    ghost += `${i ? 'L' : 'M'}${f(X)} ${f(Y)} `;
    if (q <= u) fill += ` ${f(X)},${f(Y)}`;
  }
  fill += ` ${f(xc)},${f(my - mk * M(u))} ${f(xc)},${my}`;
  s += `<line x1="${x0}" y1="${my}" x2="${x1}" y2="${my}" stroke="${C.ink}" stroke-width="1"/>` +
    `<path d="${ghost}" fill="none" stroke="${C.accentStrong}" stroke-opacity="0.35" stroke-dasharray="4 4"/>` +
    `<polygon points="${fill}" fill="${C.accent}26" stroke="${C.accentStrong}" stroke-width="2" stroke-linejoin="round"/>` +
    sym(18, my - 8, 'M', { c: C.accentStrong, size: 15 });
  // 断面より右を薄くし、断面の線と値の点
  s += `<rect x="${f(xc)}" y="6" width="${f(W - xc)}" height="${y + 24}" fill="#f6f2e9" opacity="0.72"/>` +
    `<line x1="${f(xc)}" y1="6" x2="${f(xc)}" y2="194" stroke="${C.ink}" stroke-width="1.3" stroke-dasharray="5 4"/>` +
    `<circle cx="${f(xc)}" cy="${f(sy - sk * V(u))}" r="3.6" fill="${C.paper}" stroke="${C.blue}" stroke-width="2"/>` +
    `<circle cx="${f(xc)}" cy="${f(my - mk * M(u))}" r="3.6" fill="${C.paper}" stroke="${C.accentStrong}" stroke-width="2"/>`;
  return s;
}

// ---------- モールの応力円：要素を φ 回すと、円上の点が同じ向きに 2φ 動く ----------
function mohr(t) {
  const sx = 40, sy = -10, txy = 20, c = (sx + sy) / 2, a = (sx - sy) / 2, R = Math.hypot(a, txy);
  const phi = (38 * Math.PI) / 180 * Math.sin((2 * Math.PI * t) / 9);
  const c2 = Math.cos(2 * phi), s2 = Math.sin(2 * phi);
  const sX = c + a * c2 + txy * s2, sY = c - a * c2 - txy * s2, tXY = -a * s2 + txy * c2;
  // 応力要素（画面は y 下向きなので、反時計まわりの φ は画面上 −φ）
  const ex = [76, 100], hs = 25, kx = 0.5;
  const ux = [Math.cos(phi), -Math.sin(phi)], uy = [-Math.sin(phi), -Math.cos(phi)];
  const P = (p, q) => [ex[0] + ux[0] * p + uy[0] * q, ex[1] + ux[1] * p + uy[1] * q];
  const sq = [P(hs, hs), P(-hs, hs), P(-hs, -hs), P(hs, -hs)].map((p) => p.map(f).join(',')).join(' ');
  let s = `<rect x="${ex[0] - hs}" y="${ex[1] - hs}" width="${2 * hs}" height="${2 * hs}" fill="none" stroke="${C.faint}" stroke-dasharray="3 3"/>` +
    `<polygon points="${sq}" fill="#fce9e2" stroke="${C.ink}" stroke-width="1.6"/>`;
  const normal = (n, sig, col) => {
    const L = Math.abs(sig) * kx, g = 3;
    [1, -1].forEach((sg) => {
      const nx = n[0] * sg, ny = n[1] * sg, px = ex[0] + nx * (hs + g), py = ex[1] + ny * (hs + g);
      s += sig >= 0 ? arrow(px, py, px + nx * L, py + ny * L, { c: col, w: 2.2, head: 7 })
                    : arrow(px + nx * L, py + ny * L, px, py, { c: col, w: 2.2, head: 7 });
    });
  };
  normal(ux, sX, C.accentStrong); normal(uy, sY, C.blue);
  s += sym(ex[0] + ux[0] * (hs + 8 + Math.abs(sX) * kx) + 4, ex[1] + ux[1] * (hs + 8 + Math.abs(sX) * kx) + 4, 'σ', { c: C.accentStrong, size: 13, sub: 'X' });
  // 円（τ は下向きが正）
  const cx = 222, cy = 100, k = 58 / R, X = (v) => cx + (v - c) * k, Y = (v) => cy + v * k;
  s += `<line x1="146" y1="${cy}" x2="312" y2="${cy}" stroke="${C.ink}" stroke-width="1"/>` +
    `<line x1="${f(X(0))}" y1="26" x2="${f(X(0))}" y2="178" stroke="${C.ink}" stroke-width="1"/>` +
    sym(306, cy - 7, 'σ', { size: 14 }) + sym(X(0) - 10, 186, 'τ', { size: 14 }) +
    `<circle cx="${cx}" cy="${cy}" r="${f(R * k)}" fill="${C.accent}14" stroke="${C.accent}" stroke-width="2"/>` +
    `<line x1="${f(X(sx))}" y1="${f(Y(txy))}" x2="${f(X(sy))}" y2="${f(Y(-txy))}" stroke="${C.accentStrong}" stroke-opacity="0.5" stroke-dasharray="3 3"/>` +
    `<line x1="${f(X(sX))}" y1="${f(Y(tXY))}" x2="${f(X(sY))}" y2="${f(Y(-tXY))}" stroke="${C.accentStrong}" stroke-width="2"/>`;
  const a0 = Math.atan2(Y(txy) - cy, X(sx) - cx), a1 = Math.atan2(Y(tXY) - cy, X(sX) - cx), ra = 20;
  if (Math.abs(phi) > 0.02) {
    const sweep = a1 > a0 ? 1 : 0;
    s += `<path d="M${f(cx + ra * Math.cos(a0))} ${f(cy + ra * Math.sin(a0))} A${ra} ${ra} 0 0 ${sweep} ${f(cx + ra * Math.cos(a1))} ${f(cy + ra * Math.sin(a1))}" fill="none" stroke="${C.accentStrong}" stroke-width="1.6"/>`;
    const am = (a0 + a1) / 2;
    s += sym(cx + 33 * Math.cos(am), cy + 33 * Math.sin(am) + 5, '2φ', { c: C.accentStrong, size: 12 });
  }
  s += `<circle cx="${f(X(sX))}" cy="${f(Y(tXY))}" r="4.2" fill="${C.paper}" stroke="${C.accentStrong}" stroke-width="2"/>` +
    `<circle cx="${f(X(sY))}" cy="${f(Y(-tXY))}" r="4.2" fill="${C.paper}" stroke="${C.blue}" stroke-width="2"/>` +
    sym(X(sX) + 12 * Math.cos(a1), Y(tXY) + 12 * Math.sin(a1) + 5, 'X', { c: C.accentStrong, size: 13 }) +
    sym(X(sY) - 12 * Math.cos(a1), Y(-tXY) - 12 * Math.sin(a1) + 5, 'Y', { c: C.blue, size: 13 });
  return s;
}

// ---------- 応力テンソル：x 方向の一軸応力の中で要素を y 軸まわりに回すと σx′x′ = σ cos²ψ ----------
function tensor(t) {
  const psi = t * 0.55, az = -0.62, el = 0.42, sc = 1, cx0 = 176, cy0 = 102;
  const proj = ([x, y, z]) => {
    const x1 = x * Math.cos(az) + z * Math.sin(az), z1 = -x * Math.sin(az) + z * Math.cos(az);
    const y2 = y * Math.cos(el) - z1 * Math.sin(el), z2 = y * Math.sin(el) + z1 * Math.cos(el);
    return [cx0 + x1 * sc, cy0 - y2 * sc, z2];
  };
  const e = [[Math.cos(psi), 0, -Math.sin(psi)], [0, 1, 0], [Math.sin(psi), 0, Math.cos(psi)]];
  const sig = [Math.cos(psi) ** 2, 0, Math.sin(psi) ** 2];
  const h = 40, add = (...vs) => vs.reduce((p, v) => p.map((q, i) => q + v[i]), [0, 0, 0]), mul = (v, k) => v.map((q) => q * k);
  const faces = [];
  for (let i = 0; i < 3; i++) for (const sg of [1, -1]) {
    const n = mul(e[i], sg), j = (i + 1) % 3, k = (i + 2) % 3, ctr = mul(n, h);
    const pts = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([p, q]) => proj(add(ctr, mul(e[j], p * h), mul(e[k], q * h))));
    const pc = proj(ctr), tip = proj(add(ctr, mul(n, 6 + 56 * sig[i])));
    faces.push({ i, pts, pc, tip, depth: proj(n)[2] - proj([0, 0, 0])[2], s: sig[i] });
  }
  faces.sort((p, q) => p.depth - q.depth);
  const fa = (fc, op) => fc.s > 0.04 ? arrow(fc.pc[0], fc.pc[1], fc.tip[0], fc.tip[1], { c: C.accentStrong, w: 2.4, head: 9, op }) : '';
  let s = '';
  faces.filter((fc) => fc.depth <= 0).forEach((fc) => { s += fa(fc, 0.35); });
  faces.filter((fc) => fc.depth > 0).forEach((fc) => {
    s += `<polygon points="${fc.pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' ')}" fill="#efe9f7" fill-opacity="0.92" stroke="${C.ink}" stroke-width="1.4" stroke-linejoin="round"/>`;
  });
  faces.filter((fc) => fc.depth > 0).forEach((fc) => { s += fa(fc, 1); });
  // 座標軸：灰色の x y z（固定）と、回した x′ y′ z′
  const o = [-96, -62, 40], tri = (v, col, name, dash) => {
    const p0 = proj(o), p1 = proj(add(o, mul(v, 30)));
    return arrow(p0[0], p0[1], p1[0], p1[1], { c: col, w: 1.6, head: 6, dash }) + sym(p1[0] + (p1[0] - p0[0]) * 0.3, p1[1] + (p1[1] - p0[1]) * 0.3 + 4, name, { c: col, size: 12 });
  };
  s += tri([1, 0, 0], C.muted, 'x', '3 2') + tri([0, 0, 1], C.muted, 'z', '3 2');
  s += tri(e[0], C.purple, 'x′') + tri(e[1], C.gold, 'y′') + tri(e[2], C.blue, 'z′');
  // 外から加わる一軸応力（x 方向）
  s += arrow(40, 26, 14, 26, { c: C.muted, w: 1.6, head: 7 }) + arrow(280, 26, 306, 26, { c: C.muted, w: 1.6, head: 7 }) +
    `<line x1="40" y1="26" x2="280" y2="26" stroke="${C.muted}" stroke-dasharray="2 4" opacity="0.5"/>` +
    sym(160, 18, 'σ', { c: C.muted, size: 14, sub: 'x' });
  return s;
}

// ---------- 準備中の単元（静止画） ----------
function axial() {
  let s = wall(40, 64, 136) + `<rect x="40" y="90" width="222" height="20" fill="none" stroke="${C.ink}" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.5"/>` +
    `<rect x="40" y="90" width="190" height="20" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.8"/>`;
  s += arrow(262, 100, 304, 100, { c: C.blue, w: 3, head: 11 }) + sym(292, 88, 'P', { c: C.blue });
  s += dim(40, 230, 150, 'L') + dim(230, 262, 128, 'δ');
  return s;
}
function torsion() {
  const x0 = 50, x1 = 250, cy = 100, r = 30;
  let s = wall(x0, 58, 142) +
    `<rect x="${x0}" y="${cy - r}" width="${x1 - x0}" height="${2 * r}" fill="${C.paper}"/>` +
    `<line x1="${x0}" y1="${cy - r}" x2="${x1}" y2="${cy - r}" stroke="${C.ink}" stroke-width="1.8"/>` +
    `<line x1="${x0}" y1="${cy + r}" x2="${x1}" y2="${cy + r}" stroke="${C.ink}" stroke-width="1.8"/>` +
    `<ellipse cx="${x1}" cy="${cy}" rx="10" ry="${r}" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.8"/>` +
    `<line x1="${x0}" y1="${cy}" x2="${x1}" y2="${cy}" stroke="${C.ink}" stroke-dasharray="3 3" opacity="0.6"/>` +
    `<line x1="${x0}" y1="${cy - r * 0.55}" x2="${x1}" y2="${cy - r * 0.55}" stroke="${C.ink}" stroke-dasharray="4 3" opacity="0.45"/>` +
    `<line x1="${x0}" y1="${cy - r * 0.55}" x2="${x1}" y2="${cy + r * 0.25}" stroke="${C.accentStrong}" stroke-width="1.8"/>`;
  s += `<path d="M${x1 + 30} ${cy + 36} A16 40 0 1 1 ${x1 + 30} ${cy - 36}" fill="none" stroke="${C.green}" stroke-width="2.6"/>` +
    arrow(x1 + 30, cy - 36, x1 + 22, cy - 38, { c: C.green, w: 2.6, head: 10 }) + sym(x1 + 54, cy - 30, 'T', { c: C.green });
  s += sym(x1 - 16, cy + 6, 'γ', { c: C.accentStrong, size: 13 });
  return s;
}

const DRAW = { equilibrium, beam, sfdbmd, mohr, tensor, axial, torsion };
const STATIC = new Set(['axial', 'torsion']);
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const thumbs = [...document.querySelectorAll('.thumb[data-thumb]')].map((el) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  el.appendChild(svg);
  const fn = DRAW[el.dataset.thumb];
  svg.innerHTML = fn(reduce ? 1.6 : 0);
  return { el, svg, fn, animate: !reduce && !STATIC.has(el.dataset.thumb), visible: false };
});

const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const th = thumbs.find((x) => x.el === en.target);
    if (th) th.visible = en.isIntersecting;
  }
});
thumbs.forEach((th) => th.animate && io.observe(th.el));

const t0 = performance.now();
function frame(now) {
  const t = (now - t0) / 1000;
  for (const th of thumbs) if (th.animate && th.visible) th.svg.innerHTML = th.fn(t);
  requestAnimationFrame(frame);
}
if (!reduce) requestAnimationFrame(frame);
