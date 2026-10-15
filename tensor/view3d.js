// 軽量な 3D（平行投影）を SVG に描く。丸棒と微小要素（立方体）の 2 種類。
// three.js を使わないのは、図が線と矢印だけで足り、ラベルを KaTeX で重ねたいため（mohr/ と違い
// コンターの塗り直しが無い）。視点（yaw, pitch）は全パネルで共有する。

const NS = 'http://www.w3.org/2000/svg';
const deg = Math.PI / 180;

export const COLORS = {
  tension: '#d0473b',
  compress: '#245b8d',
  shear: '#2f8f6f',
  load: '#ef6a4b',
  moment: '#8a4fbf',
  axisX: '#c0392b', axisY: '#2f8f6f', axisZ: '#245b8d',
  axisXp: '#8a4fbf', axisYp: '#c08a1e', axisZp: '#1f7a8c',
  ink: '#1d2932', muted: '#8b969c',
};

export class Camera {
  constructor(yaw = 34, pitch = 20) { this.yaw = yaw; this.pitch = pitch; }
  // 既定は x 右奥・y 上・z 右手前（自由端の断面が見え、固定端の壁が奥になる向き）
  basis() {
    const cy = Math.cos(this.yaw * deg), sy = Math.sin(this.yaw * deg);
    const cp = Math.cos(this.pitch * deg), sp = Math.sin(this.pitch * deg);
    // yaw: y 軸まわり、pitch: 画面の横軸まわり
    const r = (v) => {
      const x1 = cy * v[0] + sy * v[2], z1 = -sy * v[0] + cy * v[2], y1 = v[1];
      return [x1, cp * y1 - sp * z1, sp * y1 + cp * z1];
    };
    return r;
  }
  // 画面座標の単位ベクトル（右・上・手前）を世界座標で返す（要素のドラッグ回転に使う）
  screenAxes() {
    const cy = Math.cos(this.yaw * deg), sy = Math.sin(this.yaw * deg);
    const cp = Math.cos(this.pitch * deg), sp = Math.sin(this.pitch * deg);
    // r の逆変換: 画面ベクトル (a,b,c) → 世界
    const inv = ([a, b, c]) => {
      const y1 = cp * b + sp * c, z1 = -sp * b + cp * c, x1 = a;
      return [cy * x1 - sy * z1, y1, sy * x1 + cy * z1];
    };
    return { right: inv([1, 0, 0]), up: inv([0, 1, 0]), toward: inv([0, 0, 1]) };
  }
}

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// SVG＋KaTeX ラベルの重ね描き。描画ごとに作り直す（要素数が少ないので十分速い）
export class Panel {
  constructor(host, camera) {
    this.host = host; this.camera = camera;
    host.classList.add('figure3d');
    this.svg = el('svg', { role: 'img' }, host);
    this.overlay = document.createElement('div');
    this.overlay.className = 'fig-overlay';
    host.appendChild(this.overlay);
  }

  begin() {
    this.svg.replaceChildren();
    this.overlay.replaceChildren();
    this.prims = []; // {kind, depth, draw(g, P)}
    this.labels = [];
    this.pts = [];
    this.R = this.camera.basis();
  }

  proj(v) { const p = this.R(v); return [p[0], -p[1], p[2]]; }

  track(v) { const p = this.proj(v); this.pts.push(p); return p; }

  // 形を登録（最後にまとめて範囲を決めて描く）
  line(a, b, style) { this.prims.push({ t: 'line', a: this.track(a), b: this.track(b), style }); }
  poly(vs, style) { this.prims.push({ t: 'poly', ps: vs.map((v) => this.track(v)), style }); }
  arrow(a, b, style) { this.prims.push({ t: 'arrow', a: this.track(a), b: this.track(b), style }); }
  dblArrow(a, b, style) { this.prims.push({ t: 'arrow', a: this.track(a), b: this.track(b), style: { ...style, double: true } }); }
  path3(vs, style) { this.prims.push({ t: 'path', ps: vs.map((v) => this.track(v)), style }); }
  dot(v, r, style) { this.prims.push({ t: 'dot', a: this.track(v), r, style }); }
  hull(vs, style) { this.prims.push({ t: 'hull', ps: vs.map((v) => this.track(v)), style }); }
  label(v, tex, style = {}) { this.labels.push({ p: this.track(v), tex, style }); }
  group(fn) { this.prims.push({ t: 'mark' }); fn(); }

  end({ pad = 0.25, aspect = null, minH = 0 } = {}) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of this.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (!Number.isFinite(x0)) { x0 = -1; x1 = 1; y0 = -1; y1 = 1; }
    let w = x1 - x0 + 2 * pad, h = Math.max(y1 - y0 + 2 * pad, minH);
    let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (aspect) { // 幅/高さ を固定（パネルの寸法を変えない）
      if (w / h > aspect) h = w / aspect; else w = h * aspect;
    }
    const vb = [cx - w / 2, cy - h / 2, w, h];
    this.vb = vb;
    this.svg.setAttribute('viewBox', vb.join(' '));
    const u = w / 400; // 線の太さ・矢じりの基準（viewBox 単位）
    this.u = u;
    for (const pr of this.prims) this._draw(pr, u);
    for (const lb of this.labels) {
      const d = document.createElement('div');
      d.className = 'fig-label' + (lb.style.cls ? ' ' + lb.style.cls : '');
      d.style.left = ((lb.p[0] - vb[0]) / vb[2] * 100) + '%';
      d.style.top = ((lb.p[1] - vb[1]) / vb[3] * 100) + '%';
      if (lb.style.color) d.style.color = lb.style.color;
      if (window.katex) window.katex.render(lb.tex, d, { throwOnError: false });
      else d.textContent = lb.tex;
      this.overlay.appendChild(d);
    }
  }

  _draw(pr, u) {
    const s = pr.style || {};
    const stroke = s.color || COLORS.ink;
    const sw = (s.width || 1.6) * u;
    const dash = s.dash ? `${5 * u} ${4 * u}` : null;
    const op = s.opacity ?? 1;
    if (pr.t === 'line') {
      el('line', { x1: pr.a[0], y1: pr.a[1], x2: pr.b[0], y2: pr.b[1], stroke, 'stroke-width': sw, 'stroke-dasharray': dash, opacity: op, 'stroke-linecap': 'round' }, this.svg);
    } else if (pr.t === 'poly' || pr.t === 'hull') {
      const ps = pr.t === 'hull' ? convexHull(pr.ps) : pr.ps;
      el('polygon', { points: ps.map((p) => `${p[0]},${p[1]}`).join(' '), fill: s.fill || 'none', 'fill-opacity': s.fillOpacity ?? 1, stroke: s.stroke ?? 'none', 'stroke-width': (s.width || 1) * u, 'stroke-dasharray': dash, opacity: op, 'stroke-linejoin': 'round' }, this.svg);
    } else if (pr.t === 'path') {
      el('polyline', { points: pr.ps.map((p) => `${p[0]},${p[1]}`).join(' '), fill: 'none', stroke, 'stroke-width': sw, 'stroke-dasharray': dash, opacity: op, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, this.svg);
      if (s.head) this._head(pr.ps[pr.ps.length - 2], pr.ps[pr.ps.length - 1], stroke, u * (s.headScale || 1), op);
    } else if (pr.t === 'dot') {
      el('circle', { cx: pr.a[0], cy: pr.a[1], r: pr.r * u, fill: s.fill || stroke, stroke: s.stroke || 'none', 'stroke-width': u, opacity: op }, this.svg);
    } else if (pr.t === 'arrow') {
      const L = Math.hypot(pr.b[0] - pr.a[0], pr.b[1] - pr.a[1]);
      const hs = u * (s.headScale || 1);
      const hl = Math.min(11 * hs, L * 0.6);
      // 軸は矢じりの付け根で止める
      const k = L > 1e-9 ? (L - hl * 0.8) / L : 0;
      const tip = pr.b;
      const base = [pr.a[0] + (tip[0] - pr.a[0]) * k, pr.a[1] + (tip[1] - pr.a[1]) * k];
      el('line', { x1: pr.a[0], y1: pr.a[1], x2: base[0], y2: base[1], stroke, 'stroke-width': sw, 'stroke-dasharray': dash, opacity: op, 'stroke-linecap': 'round' }, this.svg);
      if (L > 1e-9) {
        this._head(pr.a, tip, stroke, hs, op, hl);
        if (s.double) { // モーメントのベクトル表示（二重矢じり）
          const back = [tip[0] - (tip[0] - pr.a[0]) * (hl * 0.75) / L, tip[1] - (tip[1] - pr.a[1]) * (hl * 0.75) / L];
          this._head(pr.a, back, stroke, hs, op, hl);
        }
      }
    }
  }

  _head(from, tip, color, hs, op, hl = 11 * hs) {
    const dx = tip[0] - from[0], dy = tip[1] - from[1], L = Math.hypot(dx, dy);
    if (L < 1e-12) return;
    const ux = dx / L, uy = dy / L, hw = hl * 0.42;
    const bx = tip[0] - ux * hl, by = tip[1] - uy * hl;
    el('polygon', { points: `${tip[0]},${tip[1]} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}`, fill: color, opacity: op }, this.svg);
  }
}

function convexHull(ps) {
  const p = ps.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// 円（中心 c、互いに直交する単位ベクトル e1, e2、半径 r）の点列。t0..t1 [rad]
export function circle(c, e1, e2, r, t0 = 0, t1 = 2 * Math.PI, n = 64) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * i / n;
    out.push(add(c, add(sc(e1, r * Math.cos(t)), sc(e2, r * Math.sin(t)))));
  }
  return out;
}

export { add, sc, deg };
