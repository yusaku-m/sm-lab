// SFD・BMD — 図（梁と荷重、仮想断面の自由体、V・M のグラフ）
//
// 3 つの SVG（梁・SFD・BMD）は viewBox の横幅と棒の位置（X0, LPX）を共通にしてあるので、
// 幅 100% で縦に並べると x の位置がそろう。縦の範囲だけ図ごとに決める。
// 記号は SVG の上に重ねた HTML に KaTeX で描く（equilibrium/figure.js と同じやり方）。
//
// 描き方:
//   集中荷重 … 棒に向かう矢印（下向きは棒の上から、上向きは棒の下から。長さ ∝ 大きさ）
//   集中モーメント … 作用点を中心にした円弧（角度 ∝ 大きさ）
//   分布荷重 … 棒に向かう矢印の列（equilibrium/ と同じ）
//   支点 … ピン（三角）・ローラー（三角＋丸）・固定（壁）。反力は解いた向きの矢印（緑）
//   仮想断面 … 破線。右側を薄くして、左側の自由体の断面に V・M を「正の向き」で描く
//
// 操作:
//   矢印の先端 … 上下で大きさと向き        矢印の軸・円弧の中心・支点 … 左右で位置
//   円弧の先端 … 回して大きさと向き        分布荷重 … 頭の丸・両端の四角・中の列（equilibrium/ と同じ）
//   仮想断面の上下の三角 … 左右で断面の位置（グラフの上をクリック／ドラッグしても動く）

import { snapPosition, clamp01, posTex, fmt, DIST_SHAPES } from '../equilibrium/model.js';

export const W = 960;
export const X0 = 110;
export const LPX = 740;
const RY = 0;
const ROD_H = 14;
const PX_PER_KN = 6;
export const P_MAX = 20;
export const C_MAX = 12;
export const W_MAX = 20;
const PX_PER_KNPM = 4;
const DIST_MIN_H = 12;
const DIST_GAP = 3;
const MOM_R = 24;
const DEG_PER_KNM = 30;
const SNAP_PX = 10;
const REACT_LEN = 46;

export const COLORS = ['#245b8d', '#8a4fa6', '#a8662a', '#1f7f95', '#b04a78', '#5f7424', '#8f3f3f', '#2f6f8f'];
export const V_COLOR = '#245b8d';
export const M_COLOR = '#bd442c';
const REACT_COLOR = '#2f8f6f';
const INK = '#1d2932';
const MUTED = '#8a959b';
const PAPER = '#fffdf7';

export const X = (t) => X0 + t * LPX;

// ---------------------------------------------------------------- 共通の小道具

/** 12時の位置から反時計まわりに sweep [deg] 回った円周上の点（画面座標） */
function arcPoint(cx, cy, r, sweep, start = 0) {
  const a = -Math.PI / 2 - ((start + sweep) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/**
 * 円弧の矢印。start [deg] は 12 時から反時計まわりに測った描き始めの位置、deg は長さ、ccw は向き。
 * equilibrium/figure.js の arcArrow に描き始めの位置を足したもの。
 */
function arcArrow(cx, cy, r, deg, ccw, color, w, op = 1, dash = '', start = 0) {
  const a0 = -Math.PI / 2 - (start * Math.PI) / 180;
  const sg = ccw ? -1 : 1;
  const head = Math.min(12 + w * 1.5, r * 0.9);
  const dHead = head / r;
  const a1 = a0 + sg * (deg * Math.PI) / 180;
  const aBody = a1 - sg * dHead * 0.85;
  const p = (a) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  const s0 = p(a0), s1 = p(aBody), tip = p(a1);
  const large = Math.abs(aBody - a0) > Math.PI ? 1 : 0;
  const sweep = ccw ? 0 : 1;
  const hw = 4 + w * 0.9;
  const b = p(a1 - sg * dHead);
  const nx = Math.cos(a1 - sg * dHead), ny = Math.sin(a1 - sg * dHead);
  const h1 = { x: b.x + nx * hw, y: b.y + ny * hw };
  const h2 = { x: b.x - nx * hw, y: b.y - ny * hw };
  let body = '';
  if (Math.abs(aBody - a0) > 1e-3 && (aBody - a0) * sg > 0) {
    const da = dash ? ` stroke-dasharray="${dash}"` : '';
    body = `<path d="M${s0.x} ${s0.y} A${r} ${r} 0 ${large} ${sweep} ${s1.x} ${s1.y}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"${da} opacity="${op}"/>`;
  }
  return `${body}<path d="M${tip.x} ${tip.y} L${h1.x} ${h1.y} L${h2.x} ${h2.y} z" fill="${color}" opacity="${op}"/>`;
}

function arrow(x1, y1, x2, y2, color, w, extra = '') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" marker-end="url(#sb-head)"${extra}/>`;
}

const DEFS = `<defs><marker id="sb-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>`;

/** KaTeX のラベルを SVG の上に重ねる（equilibrium/figure.js の _setLabels と同じ） */
class LabelLayer {
  constructor(host) {
    this.el = document.createElement('div');
    this.el.className = 'fig-overlay';
    host.append(this.el);
    this.map = new Map();
  }
  set(list, LO) {
    const w = LO.right - LO.left, h = LO.bottom - LO.top;
    const seen = new Set();
    for (const L of list) {
      seen.add(L.key);
      let el = this.map.get(L.key);
      if (!el) {
        el = document.createElement('span');
        el.className = 'fig-label';
        this.el.append(el);
        this.map.set(L.key, el);
      }
      if (el.dataset.tex !== L.tex) {
        el.dataset.tex = L.tex;
        if (typeof katex !== 'undefined') katex.render(L.tex.replace(/\\frac\{/g, '\\dfrac{'), el, { throwOnError: false });
        else el.textContent = L.tex;
      }
      el.style.left = `${((L.x - LO.left) / w) * 100}%`;
      el.style.top = `${((L.y - LO.top) / h) * 100}%`;
      el.style.color = L.color || INK;
      el.classList.toggle('small', !!L.small);
      el.style.opacity = L.faded ? '0.3' : '';
    }
    for (const [k, el] of this.map) if (!seen.has(k)) { el.remove(); this.map.delete(k); }
  }
  fit(host, LO) {
    const k = host.clientWidth / (LO.right - LO.left);
    this.el.style.fontSize = `${Math.max(10, 19 * k)}px`;
  }
}

function svgPoint(svg, e) {
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

// ---------------------------------------------------------------- 梁の図

const pointLen = (a) => Math.max(0, a.P * PX_PER_KN);
const distH = (a) => Math.max(DIST_MIN_H, a.w * PX_PER_KNPM);
function distHeightAt(a, t) {
  const h = distH(a);
  const b = a.t2 - a.t1;
  if (a.shape === 'u' || b < 1e-9) return h;
  const s = (t - a.t1) / b;
  return Math.max(0, a.shape === 'r' ? s : 1 - s) * h;
}
function momentSweep(a) {
  if (Math.abs(a.C) < 1e-9) return 0;
  return Math.sign(a.C) * Math.max(18, Math.min(330, Math.abs(a.C) * DEG_PER_KNM));
}
/** 荷重を描く側（画面の y の向き）。下向きの荷重は棒の上（-1）、上向きは下（+1） */
const sideOf = (a) => (a.up ? 1 : -1);

export class BeamFigure {
  constructor(host, { onChange, onSelect, onCut, onDragState }) {
    this.host = host;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.onCut = onCut;
    this.onDragState = onDragState || (() => {});
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', '梁と荷重、仮想断面の図');
    host.classList.add('fig-wrap');
    host.append(this.svg);
    this.labels = new LabelLayer(host);
    this.drag = null;
    this.layout = null;
    this.svg.addEventListener('pointerdown', (e) => this._down(e));
    this.svg.addEventListener('pointermove', (e) => this._move(e));
    this.svg.addEventListener('pointerup', (e) => this._up(e));
    this.svg.addEventListener('pointercancel', (e) => this._up(e));
    new ResizeObserver(() => this.layout && this.labels.fit(this.host, this.layout)).observe(host);
  }

  /** 図の縦の範囲。ドラッグ中は固定（equilibrium/ と同じ理由） */
  _layout(state) {
    let hi = -60, lo = 60;
    for (const a of state.loads) {
      const side = sideOf(a);
      let h = 0;
      if (a.type === 'point') h = ROD_H / 2 + pointLen(a) + 34;
      else if (a.type === 'dist') h = ROD_H / 2 + DIST_GAP + distH(a) + 36;
      else h = MOM_R + 34;
      if (a.type === 'moment') { hi = Math.min(hi, -h); lo = Math.max(lo, h * 0.6); continue; }
      if (side < 0) hi = Math.min(hi, -h); else lo = Math.max(lo, h);
    }
    // 支点・反力・寸法線のぶん
    lo = Math.max(lo, ROD_H / 2 + 34 + REACT_LEN + 34);
    const dimY = lo + 16;
    return { left: 0, right: W, top: Math.min(hi - 16, -110), bottom: dimY + 40, dimY };
  }

  render(state, ctx) {
    this.state = state;
    const { sol, sec, names } = ctx;
    if (!this.drag || !this.layout) this.layout = this._layout(state);
    const LO = this.layout;
    this.svg.setAttribute('viewBox', `${LO.left} ${LO.top} ${LO.right - LO.left} ${LO.bottom - LO.top}`);
    this.labels.fit(this.host, LO);
    const hs = Math.max(1, (0.95 * W) / (this.host.clientWidth || W));
    this.hs = hs;
    const s = [DEFS];
    const labels = [];
    const xc = X(state.xs);

    // ---- 棒
    s.push(`<rect x="${X0}" y="${RY - ROD_H / 2}" width="${LPX}" height="${ROD_H}" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>`);

    // ---- 支点と反力
    const rById = new Map();
    if (sol.status === 'solved') for (const r of sol.reactions) {
      if (!rById.has(r.support)) rById.set(r.support, []);
      rById.get(r.support).push(r);
    }
    state.supports.forEach((sp, i) => {
      const n0 = labels.length;
      this._drawSupport(s, labels, sp, i, rById.get(i) || [], state);
      const right = state.showCut && sp.t > state.xs + 1e-9;
      for (let j = n0; j < labels.length; j++) labels[j].faded = right;
    });

    // ---- 荷重
    state.loads.forEach((a, k) => {
      const color = COLORS[k % COLORS.length];
      const active = state.sel && state.sel.kind === 'load' && state.sel.k === k;
      const o = { a, k, color, sym: names[k].sym, active, hs, state };
      const n0 = labels.length;
      if (a.type === 'point') this._drawPoint(s, labels, o);
      else if (a.type === 'moment') this._drawMoment(s, labels, o);
      else this._drawDist(s, labels, o);
      // 断面より右（薄くしている側）の荷重は、記号も薄くする（HTML のラベルは SVG の覆いが効かない）
      const right = state.showCut && (a.type === 'dist' ? a.t1 : a.t) > state.xs + 1e-9;
      for (let j = n0; j < labels.length; j++) labels[j].faded = right;
    });

    // ---- 仮想断面（右側を薄くして、左側の自由体の断面に V・M を描く）
    if (state.showCut) {
      s.push(`<rect x="${xc}" y="${LO.top}" width="${LO.right - xc}" height="${LO.bottom - LO.top}" fill="${PAPER}" opacity="0.72" pointer-events="none"/>`);
      s.push(`<line x1="${xc}" y1="${LO.top + 6}" x2="${xc}" y2="${LO.dimY - 26}" stroke="${INK}" stroke-width="1.4" stroke-dasharray="7 5"/>`);
      if (sec) this._drawSection(s, labels, xc, sec);
      // 断面の位置の寸法（左端から x）
      const y = LO.dimY;
      s.push(`<line x1="${X0}" y1="${ROD_H / 2 + 3}" x2="${X0}" y2="${y + 6}" stroke="${MUTED}" stroke-width="0.7"/>`);
      s.push(`<line x1="${xc}" y1="${y - 8}" x2="${xc}" y2="${y + 6}" stroke="${MUTED}" stroke-width="0.7"/>`);
      if (xc - X0 > 4) s.push(`<line x1="${X0}" y1="${y}" x2="${xc}" y2="${y}" stroke="${INK}" stroke-width="1" marker-start="url(#sb-head)" marker-end="url(#sb-head)"/>`);
      labels.push({ key: 'dimx', tex: 'x', x: (X0 + xc) / 2, y: y - 13, small: true });
      // 断面を動かす持ち手（上下の三角）
      for (const [yy, dir] of [[LO.top + 6, 1], [LO.dimY - 26, -1]]) {
        s.push(`<path d="M${xc - 8} ${yy - dir * 2} L${xc + 8} ${yy - dir * 2} L${xc} ${yy + dir * 11} z" fill="${INK}"/>`);
        s.push(`<rect class="grab" data-part="cut" x="${xc - 16 * hs}" y="${yy - 16 * hs}" width="${32 * hs}" height="${32 * hs}" fill="transparent"/>`);
      }
      s.push(`<rect class="grab" data-part="cut" x="${xc - 7 * hs}" y="${LO.top}" width="${14 * hs}" height="${LO.dimY - LO.top - 26}" fill="transparent"/>`);
    } else {
      // 全長の寸法
      const y = LO.dimY;
      s.push(`<line x1="${X0}" y1="${y}" x2="${X0 + LPX}" y2="${y}" stroke="${INK}" stroke-width="1" marker-start="url(#sb-head)" marker-end="url(#sb-head)"/>`);
      labels.push({ key: 'dimx', tex: 'L', x: X0 + LPX / 2, y: y - 13, small: true });
    }

    this.svg.innerHTML = s.join('');
    this.labels.set(labels, LO);
  }

  /** 左側の自由体の断面に、正の向きの V（下向き）と M（反時計まわり）を描く */
  _drawSection(s, labels, xc, sec) {
    const vx = xc + 7;
    s.push(arrow(vx, -40, vx, 40, V_COLOR, 2.6));
    // 断面の右側（3 時の方向＝12 時から反時計まわりに 270°）を中心に、下から上へ（反時計まわり）
    s.push(arcArrow(xc, RY, 30, 130, true, M_COLOR, 2.6, 1, '', 270 - 65));
    const st = this.state;
    labels.push({ key: 'Vcut', tex: `V${st.showValues ? `=${fmt(sec.V, 2)}\\,\\mathrm{kN}` : ''}`, x: vx + (st.showValues ? 58 : 22), y: 30, color: V_COLOR });
    labels.push({ key: 'Mcut', tex: `M${st.showValues ? `=${fmt(sec.M, 2)}\\,\\mathrm{kN\\cdot m}` : ''}`, x: xc + (st.showValues ? 96 : 50), y: -12, color: M_COLOR });
  }

  _drawSupport(s, labels, sp, i, reacts, state) {
    const x = X(sp.t);
    const y = RY + ROD_H / 2;
    const active = state.sel && state.sel.kind === 'support' && state.sel.k === i;
    const w = active ? 2.2 : 1.6;
    const col = INK;
    if (sp.type === 'fixed') {
      // 壁（棒の端に縦の線と斜線）。左端なら左側、右端なら右側に斜線
      const dir = sp.t < 0.5 ? -1 : 1;
      const hh = 34;
      s.push(`<line x1="${x}" y1="${-hh}" x2="${x}" y2="${hh}" stroke="${col}" stroke-width="${w + 1}"/>`);
      for (let k = -hh; k < hh; k += 9) s.push(`<line x1="${x}" y1="${k + 9}" x2="${x + dir * 9}" y2="${k}" stroke="${col}" stroke-width="1"/>`);
      s.push(`<rect class="grab" data-part="support" data-k="${i}" x="${x - 18}" y="${-hh}" width="36" height="${2 * hh}" fill="transparent"/>`);
    } else {
      const th = 22, tw = 15;
      s.push(`<path d="M${x} ${y} L${x - tw} ${y + th} L${x + tw} ${y + th} z" fill="${PAPER}" stroke="${col}" stroke-width="${w}"/>`);
      let gy = y + th;
      if (sp.type === 'roller') {
        s.push(`<circle cx="${x - 7}" cy="${gy + 5}" r="4" fill="${PAPER}" stroke="${col}" stroke-width="1.3"/><circle cx="${x + 7}" cy="${gy + 5}" r="4" fill="${PAPER}" stroke="${col}" stroke-width="1.3"/>`);
        gy += 9;
      }
      s.push(`<line x1="${x - 22}" y1="${gy}" x2="${x + 22}" y2="${gy}" stroke="${col}" stroke-width="1.4"/>`);
      for (let k = -20; k < 22; k += 8) s.push(`<line x1="${x + k}" y1="${gy}" x2="${x + k - 6}" y2="${gy + 6}" stroke="${col}" stroke-width="0.9"/>`);
      s.push(`<rect class="grab" data-part="support" data-k="${i}" x="${x - 24}" y="${y}" width="48" height="${gy - y + 8}" fill="transparent"/>`);
    }
    // 反力（解いた向き）
    for (const r of reacts) {
      if (!isFinite(r.value)) continue;
      const mag = Math.abs(r.value);
      if (r.kind === 'R') {
        const top = RY + ROD_H / 2 + 36, bot = top + REACT_LEN;
        if (mag > 1e-9) {
          if (r.value > 0) s.push(arrow(x, bot, x, top, REACT_COLOR, 2.4));
          else s.push(arrow(x, top, x, bot, REACT_COLOR, 2.4));
        }
        const tex = `${r.sym}${state.showValues ? `=${fmt(mag, 2)}\\,\\mathrm{kN}` : ''}`;
        labels.push({ key: `R${i}`, tex, x: x + (state.showValues ? 46 : 18) * (sp.t > 0.9 ? -1 : 1), y: bot - 6, color: REACT_COLOR });
      } else if (mag > 1e-9) {
        const dir = sp.t < 0.5 ? -1 : 1; // 壁の外側に弧を描く
        s.push(arcArrow(x, RY, 44, 120, r.value > 0, REACT_COLOR, 2.4, 1, '', dir < 0 ? 30 : 210));
        const tex = `${r.sym}${state.showValues ? `=${fmt(mag, 2)}\\,\\mathrm{kN\\cdot m}` : ''}`;
        labels.push({ key: `MR${i}`, tex, x: x + dir * 44, y: -58, color: REACT_COLOR });
      }
    }
  }

  _tip(s, part, k, p, color, active, hs) {
    const hr = active ? 8 : 6.5;
    s.push(`<circle class="grab" data-part="${part}" data-k="${k}" cx="${p.x}" cy="${p.y}" r="${(hr + 7) * hs}" fill="transparent"/>`);
    s.push(`<circle cx="${p.x}" cy="${p.y}" r="${hr}" fill="${color}" fill-opacity="${active ? 0.22 : 0.12}" stroke="${color}" stroke-width="1.2" pointer-events="none"/>`);
  }

  _drawPoint(s, labels, { a, k, color, sym, active, hs, state }) {
    const x = X(a.t);
    const side = sideOf(a);
    const face = RY + side * (ROD_H / 2);
    const len = pointLen(a);
    const tail = { x, y: face + side * len };
    if (len > 0.5) s.push(arrow(x, tail.y, x, face, color, active ? 3.4 : 2.6));
    s.push(`<line class="grab" data-part="shaft" data-k="${k}" x1="${x}" y1="${face}" x2="${x}" y2="${tail.y}" stroke="transparent" stroke-width="${18 * hs}"/>`);
    this._tip(s, 'tip', k, tail, color, active, hs);
    const tex = `${sym}${state.showValues ? `=${fmt(a.P, 2)}\\,\\mathrm{kN}` : ''}`;
    labels.push({ key: `L${k}`, tex, x: x + (state.showValues ? 44 : 18), y: tail.y + side * 14, color });
  }

  _drawMoment(s, labels, { a, k, color, sym, active, hs, state }) {
    const c = { x: X(a.t), y: RY };
    const sw = momentSweep(a);
    if (Math.abs(sw) > 0.5) s.push(arcArrow(c.x, c.y, MOM_R, Math.abs(sw), sw > 0, color, active ? 3.2 : 2.5));
    s.push(`<circle class="grab" data-part="shaft" data-k="${k}" cx="${c.x}" cy="${c.y}" r="${MOM_R + 6 * hs}" fill="transparent"/>`);
    this._tip(s, 'tip', k, arcPoint(c.x, c.y, MOM_R, sw), color, active, hs);
    const lp = arcPoint(c.x, c.y, MOM_R + 20, sw + (sw >= 0 ? 8 : -8));
    const tex = `${sym}${state.showValues ? `=${fmt(Math.abs(a.C), 2)}\\,\\mathrm{kN\\cdot m}` : ''}`;
    labels.push({ key: `L${k}`, tex, x: lp.x, y: lp.y, color });
  }

  _drawDist(s, labels, { a, k, color, sym, active, hs, state }) {
    const side = sideOf(a);
    const y0 = RY + side * (ROD_H / 2 + DIST_GAP);
    const pt = (t, h) => ({ x: X(t), y: y0 + side * h });
    const w = active ? 2.4 : 1.8;
    const b = a.t2 - a.t1;
    const hMax = distH(a);
    const hA = distHeightAt(a, a.t1), hB = distHeightAt(a, a.t2);
    const P = [pt(a.t1, 0), pt(a.t1, hA), pt(a.t2, hB), pt(a.t2, 0)];
    s.push(`<path d="M${P[0].x} ${P[0].y} L${P[1].x} ${P[1].y} L${P[2].x} ${P[2].y} L${P[3].x} ${P[3].y}" fill="${color}" fill-opacity="${active ? 0.1 : 0.06}"/>`);
    s.push(`<path d="M${P[1].x} ${P[1].y} L${P[2].x} ${P[2].y}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`);
    const n = Math.max(1, Math.round((b * LPX) / 26));
    for (let i = 0; i <= n; i++) {
      const t = a.t1 + (b * i) / n;
      const h = distHeightAt(a, t);
      if (h < 7) continue;
      const p1 = pt(t, h), p2 = pt(t, 0);
      s.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${color}" stroke-width="${w * 0.75}" marker-end="url(#sb-head)"/>`);
    }
    const top = Math.min(y0, y0 + side * hMax);
    s.push(`<rect class="grab" data-part="shaft" data-k="${k}" x="${X(a.t1)}" y="${top}" width="${Math.max(b * LPX, 6)}" height="${hMax}" fill="transparent"/>`);
    for (const [which, t] of [[1, a.t1], [2, a.t2]]) {
      const hh = Math.max(distHeightAt(a, t), DIST_MIN_H) / 2;
      const p = { x: X(t), y: y0 + side * hh };
      const r = active ? 5.5 : 4.5;
      s.push(`<rect class="grab" data-part="end" data-k="${k}" data-which="${which}" x="${p.x - (r + 7) * hs}" y="${p.y - (r + 7) * hs}" width="${2 * (r + 7) * hs}" height="${2 * (r + 7) * hs}" fill="transparent"/>`);
      s.push(`<rect x="${p.x - r}" y="${p.y - r}" width="${2 * r}" height="${2 * r}" rx="1.5" fill="${PAPER}" stroke="${color}" stroke-width="1.4" pointer-events="none"/>`);
    }
    const tTip = a.shape === 'r' ? a.t2 : a.shape === 'l' ? a.t1 : (a.t1 + a.t2) / 2;
    this._tip(s, 'tip', k, { x: X(tTip), y: y0 + side * hMax }, color, active, hs);
    const tex = `${sym}${state.showValues ? `=${fmt(a.w, 2)}\\,\\mathrm{kN/m}` : ''}`;
    labels.push({ key: `L${k}`, tex, x: X(tTip), y: y0 + side * (hMax + 24), color });
  }

  // ------------------------------------------------------------ 操作

  _hit(e) {
    const el = e.target.closest && e.target.closest('.grab');
    if (!el) return null;
    return { part: el.dataset.part, k: +el.dataset.k, which: +el.dataset.which };
  }

  _down(e) {
    if (!this.state) return;
    const h = this._hit(e);
    if (!h) return;
    e.preventDefault();
    this.svg.setPointerCapture(e.pointerId);
    const p = svgPoint(this.svg, e);
    this.drag = { ...h, id: e.pointerId, start: p };
    if (h.part === 'support') this.onSelect({ kind: 'support', k: h.k });
    else if (h.part !== 'cut') {
      const a = this.state.loads[h.k];
      this.onSelect({ kind: 'load', k: h.k });
      if (a.type === 'moment') this.drag.sweep = momentSweep(a);
      if (a.type === 'dist') this.drag.span = { t1: a.t1, t2: a.t2 };
    }
    this.onDragState(true);
    this._apply(p);
  }

  _move(e) {
    const p = svgPoint(this.svg, e);
    if (!this.drag) {
      const h = this._hit(e);
      this.svg.style.cursor = !h ? 'default' : h.part === 'tip' ? 'grab' : 'ew-resize';
      return;
    }
    if (e.pointerId !== this.drag.id) return;
    this._apply(p);
  }

  _up(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.drag = null;
    this.onDragState(false);
    this.onChange(null);
  }

  _apply(p) {
    const d = this.drag;
    const st = this.state;
    const tol = SNAP_PX / LPX;
    const tAt = (x) => snapPosition(clamp01((x - X0) / LPX), tol);
    if (d.part === 'cut') { this.onCut(clamp01((p.x - X0) / LPX)); return; }
    if (d.part === 'support') {
      const sp = { ...st.supports[d.k] };
      const t = tAt(p.x);
      sp.t = sp.type === 'fixed' ? (t < 0.5 ? 0 : 1) : t; // 固定は端だけ
      this.onChange({ support: { k: d.k, value: sp } });
      return;
    }
    const a = { ...st.loads[d.k] };
    if (a.type === 'dist') this._applyDist(a, d, p, tol);
    else if (d.part === 'shaft') a.t = tAt(p.x);
    else if (a.type === 'point') {
      const dy = RY - p.y; // 上が正
      const off = ROD_H / 2;
      if (Math.abs(dy) > off) a.up = dy < 0; // 棒の上から押すのは下向きの荷重
      a.P = Math.min(P_MAX, Math.round(Math.max(0, Math.abs(dy) - off) / PX_PER_KN));
    } else {
      const ang = Math.atan2(p.y - RY, p.x - X(a.t));
      let sw = (-(ang + Math.PI / 2) * 180) / Math.PI;
      while (sw - d.sweep > 180) sw -= 360;
      while (sw - d.sweep < -180) sw += 360;
      sw = Math.max(-330, Math.min(330, sw));
      d.sweep = sw;
      a.C = Math.sign(sw) * Math.min(C_MAX, Math.round(Math.abs(sw) / DEG_PER_KNM));
    }
    this.onChange({ load: { k: d.k, value: a } });
  }

  /** 分布荷重のドラッグ（equilibrium/figure.js の _applyDist と同じ） */
  _applyDist(a, d, p, tol) {
    if (d.part === 'tip') {
      const dy = RY - p.y;
      const off = ROD_H / 2 + DIST_GAP;
      if (Math.abs(dy) > off) a.up = dy < 0;
      a.w = Math.min(W_MAX, Math.round(Math.max(0, Math.abs(dy) - off) / PX_PER_KNPM));
    } else if (d.part === 'end') {
      const t = snapPosition(clamp01((p.x - X0) / LPX), tol);
      if (d.which === 1) {
        if (t <= a.t2) a.t1 = t; else { a.t1 = a.t2; a.t2 = t; d.which = 2; }
      } else if (t >= a.t1) a.t2 = t; else { a.t2 = a.t1; a.t1 = t; d.which = 1; }
    } else {
      const b = d.span.t2 - d.span.t1;
      const raw1 = Math.min(Math.max(0, d.span.t1 + (p.x - d.start.x) / LPX), 1 - b);
      const s1 = snapPosition(raw1, tol), s2 = snapPosition(raw1 + b, tol);
      const snapped = (v) => [1, 2, 3, 4, 5, 10].some((q) => Math.abs(v * q - Math.round(v * q)) < 1e-9);
      let t1 = snapped(s1) ? s1 : snapped(s2) ? s2 - b : s1;
      t1 = Math.max(0, Math.min(t1, 1 - b));
      a.t1 = t1; a.t2 = t1 + b;
    }
  }
}

// ---------------------------------------------------------------- V・M のグラフ

export class DiagramPlot {
  /**
   * key: 'V' | 'M'。onCut(t) は横軸の上をクリック／ドラッグしたとき。
   */
  constructor(host, { key, color, unit, title, onCut }) {
    this.host = host;
    this.key = key;
    this.color = color;
    this.unit = unit;
    this.title = title;
    this.onCut = onCut;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', `${title}の図`);
    host.classList.add('fig-wrap');
    host.append(this.svg);
    this.labels = new LabelLayer(host);
    this.H = 110; // 縦の片側の大きさ（render() で画面幅に合わせて決め直す）
    this.LO = { left: 0, right: W, top: -this.H - 20, bottom: this.H + 20 };
    let drag = null;
    this.svg.addEventListener('pointerdown', (e) => {
      drag = e.pointerId;
      this.svg.setPointerCapture(e.pointerId);
      this.onCut(clamp01((svgPoint(this.svg, e).x - X0) / LPX), true);
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (drag !== e.pointerId) return;
      this.onCut(clamp01((svgPoint(this.svg, e).x - X0) / LPX), true);
    });
    const end = (e) => { if (drag === e.pointerId) { drag = null; this.onCut(null, false); } };
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', end);
    new ResizeObserver(() => this.labels.fit(this.host, this.LO)).observe(host);
  }

  /** data = model.diagram() の結果。xs = 断面の位置、ghost = まだ通っていない部分も薄く描くか */
  render(data, xs, cur, { ghost = true, showCut = true } = {}) {
    const { pts, extremes, bps } = data;
    const key = this.key;
    // 狭い画面（スマホ）では SVG 全体が縮むので、文字を大きく・グラフを縦長にする
    const cw = this.host.clientWidth || W;
    const fz = Math.max(1, (11 / 13) * (W / cw));
    this.H = cw < 600 ? 150 : 110;
    this.LO = { left: 0, right: W, top: -this.H - 20, bottom: this.H + 20 };
    const LO = this.LO;
    const F = (n) => n * fz;
    this.svg.setAttribute('viewBox', `${LO.left} ${LO.top} ${LO.right - LO.left} ${LO.bottom - LO.top}`);
    this.labels.fit(this.host, LO);
    const vmax = Math.max(1e-9, ...pts.map((p) => Math.abs(p[key])));
    const k = (this.H - 22) / vmax;
    const Y = (v) => -v * k;
    const s = [DEFS];
    const labels = [];
    const limit = showCut ? xs : 1;

    // 軸
    s.push(`<line x1="${X0}" y1="0" x2="${X0 + LPX}" y2="0" stroke="${INK}" stroke-width="1.2"/>`);
    s.push(`<line x1="${X0}" y1="${-this.H + 6}" x2="${X0}" y2="${this.H - 6}" stroke="${MUTED}" stroke-width="0.8"/>`);
    s.push(`<line x1="${X0 + LPX}" y1="${-this.H + 6}" x2="${X0 + LPX}" y2="${this.H - 6}" stroke="${MUTED}" stroke-width="0.8"/>`);
    for (const t of bps) {
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      s.push(`<line x1="${X(t)}" y1="${-this.H + 10}" x2="${X(t)}" y2="${this.H - 10}" stroke="${MUTED}" stroke-width="0.6" stroke-dasharray="3 4"/>`);
    }
    labels.push({ key: 'ttl', tex: `${key}\\ [\\mathrm{${this.unit}}]`, x: X0 - 54, y: -this.H + 12, small: true, color: this.color });
    s.push(`<text x="${X0 - 12}" y="${-this.H + 30}" text-anchor="end" font-size="${F(13)}" fill="${MUTED}">＋</text>`);
    s.push(`<text x="${X0 - 12}" y="${this.H - 18}" text-anchor="end" font-size="${F(13)}" fill="${MUTED}">－</text>`);

    // 線（通った部分は色つき＋塗り、まだの部分は薄い破線）
    const path = (list) => list.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)} ${Y(p[key])}`).join(' ');
    const done = [], rest = [];
    for (const p of pts) {
      if (p.x <= limit + 1e-12) done.push(p);
      if (p.x >= limit - 1e-12) rest.push(p);
    }
    // 断面の位置の値で線を切る（done の末尾と rest の先頭に断面の点を入れる）
    if (cur && showCut) {
      done.push({ x: xs, [key]: cur[key] });
      rest.unshift({ x: xs, [key]: cur[key] });
    }
    if (ghost && rest.length > 1) {
      s.push(`<path d="${path(rest)}" fill="none" stroke="${MUTED}" stroke-width="1.4" stroke-dasharray="5 4" opacity="0.8"/>`);
    }
    if (done.length > 1) {
      const d = path(done);
      const first = done[0], last = done[done.length - 1];
      s.push(`<path d="${d} L${X(last.x)} 0 L${X(first.x)} 0 z" fill="${this.color}" fill-opacity="0.12" stroke="none"/>`);
      s.push(`<path d="${d}" fill="none" stroke="${this.color}" stroke-width="2.6" stroke-linejoin="round"/>`);
    }

    // 最大・最小（通り過ぎたものだけ）
    const extKeys = key === 'V' ? ['Vmax', 'Vmin'] : ['Mmax', 'Mmin'];
    const shown = new Set();
    for (const ek of extKeys) {
      const e = extremes[ek];
      if (!e || Math.abs(e.v) < 1e-9 || e.x > limit + 1e-9) continue;
      const id = `${e.x.toFixed(4)}:${e.v.toFixed(4)}`;
      if (shown.has(id)) continue;
      // 断面の値のラベルと重なるときは出さない（断面の点がその値を示している）
      if (showCut && cur && Math.abs(X(e.x) - X(xs)) < F(110) && Math.abs(Y(e.v) - Y(cur[key])) < F(24)) continue;
      shown.add(id);
      const up = e.v > 0;
      s.push(`<circle cx="${X(e.x)}" cy="${Y(e.v)}" r="3.5" fill="${this.color}"/>`);
      s.push(`<text x="${X(e.x)}" y="${Y(e.v) + (up ? -F(9) : F(19))}" text-anchor="middle" font-size="${F(13)}" font-weight="600" fill="${this.color}" paint-order="stroke" stroke="${PAPER}" stroke-width="${F(4)}">${ek.endsWith('max') ? '最大' : '最小'} ${fmt(e.v, 2)}</text>`);
    }

    // 断面の位置
    if (showCut && cur) {
      const xc = X(xs);
      s.push(`<line x1="${xc}" y1="${-this.H + 2}" x2="${xc}" y2="${this.H - 2}" stroke="${INK}" stroke-width="1.2" stroke-dasharray="7 5"/>`);
      const y = Y(cur[key]);
      s.push(`<circle cx="${xc}" cy="${y}" r="5.5" fill="${PAPER}" stroke="${this.color}" stroke-width="2.4"/>`);
      const right = xs < (fz > 1.5 ? 0.6 : 0.78); // 右に寄ったら値を断面の左に出す
      s.push(`<text x="${xc + (right ? F(12) : -F(12))}" y="${y + (cur[key] >= 0 ? -F(10) : F(20))}" text-anchor="${right ? 'start' : 'end'}" font-size="${F(15)}" font-weight="700" fill="${this.color}" paint-order="stroke" stroke="${PAPER}" stroke-width="${F(4)}">${key} = ${fmt(cur[key], 2)}</text>`);
    }
    s.push(`<rect x="${X0 - 6}" y="${-this.H}" width="${LPX + 12}" height="${2 * this.H}" fill="transparent" style="cursor: ew-resize"/>`);
    this.svg.innerHTML = s.join('');
    this.labels.set(labels, LO);
  }
}

export { DIST_SHAPES };
