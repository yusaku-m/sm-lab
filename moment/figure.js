// モーメントのつり合い — 図（SVG）と操作
//
// 図は update のたびに SVG の中身を作り直す（要素数が少ないので十分速い）。
// 記号（P_1, O, 寸法の \frac{}{}L など）は SVG の上に重ねた HTML に KaTeX で描く。
// 位置は viewBox 座標の百分率で置くので、SVG が拡大縮小されてもずれない。
//
// 操作:
//   O の丸     … 左右ドラッグで回転中心（モーメントの中心）を動かす
//   矢印の先端 … 上下ドラッグで大きさと上下の向き。左右に大きく引くと「斜めモード」
//   矢印の軸   … 左右ドラッグで作用点を動かす
//   棒をダブルクリック … その位置に荷重を足す

import {
  decompose, compose, snapPosition, snapTilt, posTex, angleTex, clamp01, actionType,
  symbolIndex, fmt,
} from './model.js';

export const W = 960;
const X0 = 150;           // 棒の左端
let LPX = 660;            // 棒の長さ [px]。狭い画面では短くして、矢印・円弧・文字を相対的に大きく見せる
const LPX_WIDE = 660, LPX_NARROW = 400, NARROW_PX = 600;
const RY = 0;             // 棒の中心の高さ（viewBox の上下は中身に合わせて毎回決める）
const ROD_H = 14;
const BULGE_R = 13;       // 回転中心の丸（資料と同じく棒より少し太い）
const PX_PER_KN = 9;
export const P_MAX = 20;
const M_FULL = 12;        // この大きさ [kN·L] で円弧が 270° になる
const OBLIQUE_DX = 46;    // 先端をこれ以上横に引くと斜めモード
const SNAP_PX = 10;
const DIM_GAP = 26;       // 寸法線の段の間隔

export const COLORS = ['#245b8d', '#2f8f6f', '#8a4fa6', '#a8662a', '#1f7f95', '#b04a78'];
const ACCENT = '#ef6a4b';
const INK = '#1d2932';
const MUTED = '#8a959b';

const X = (t) => X0 + t * LPX;

export class MomentFigure {
  constructor(host, { onChange, onSelect, onDragState }) {
    this.host = host;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.onDragState = onDragState || (() => {});
    host.classList.add('fig-wrap');
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('viewBox', `0 -200 ${W} 400`);
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', '棒と荷重、O 点まわりのモーメントの図');
    this.overlay = document.createElement('div');
    this.overlay.className = 'fig-overlay';
    host.append(this.svg, this.overlay);
    this.labels = new Map();
    this.drag = null;
    this.hover = null;
    this.state = null;

    this.svg.addEventListener('pointerdown', (e) => this._down(e));
    this.svg.addEventListener('pointermove', (e) => this._move(e));
    this.svg.addEventListener('pointerup', (e) => this._up(e));
    this.svg.addEventListener('pointercancel', (e) => this._up(e));
    this.svg.addEventListener('dblclick', (e) => this._dbl(e));

    const ro = new ResizeObserver(() => {
      const lpx = this.host.clientWidth < NARROW_PX ? LPX_NARROW : LPX_WIDE;
      if (lpx !== LPX) {
        LPX = lpx;
        this.layout = null;
        this.onChange(null);
      }
      this._fitFont();
    });
    ro.observe(host);
  }

  _fitFont() {
    const LO = this.layout;
    const k = this.host.clientWidth / (LO ? LO.right - LO.left : W);
    this.overlay.style.fontSize = `${Math.max(10.5, 19 * k)}px`;
  }

  // ------------------------------------------------------------ 描画

  /**
   * state: app.js の状態。res: model.analyze() の結果。
   * anim: null か { theta [rad, 反時計まわり正], dx, dy [L 単位, 上が正], pivot [t] }
   */
  render(state, res, anim = null) {
    this.state = state;
    this.res = res;
    const s = [];
    const labels = [];
    const actions = state.actions;
    const sel = state.sel;
    const dragKind = this.drag && this.drag.kind;

    // 図の範囲（viewBox）は中身に合わせて決めるが、ドラッグ中とアニメーション中は固定する。
    // ドラッグ中に変えると、掴んでいる点の下で図の座標がずれて矢印が勝手に伸び続ける
    // （広げる方向だけでも起きる。はみ出したぶんは枠の外に描かれ、離したときに収め直す）。
    if (!anim && (!this.drag || !this.layout)) this.layout = this._layout(state, res);
    const LO = this.layout;
    if (!this._lastW || Math.abs(this._lastW - (LO.right - LO.left)) > 0.5) {
      this._lastW = LO.right - LO.left;
      this._fitFont();
    }
    this.svg.setAttribute('viewBox', `${LO.left} ${LO.top} ${LO.right - LO.left} ${LO.bottom - LO.top}`);
    // 画面上で小さく表示されているとき（スマホ）は掴み代を広げる
    const shown = this.host.clientWidth || (LO.right - LO.left);
    const hs = Math.max(1, (0.95 * (LO.right - LO.left)) / shown);
    this.hitScale = hs;

    // 動かしたときの座標変換（画面座標。y は下向き）
    const piv = anim ? { x: X(anim.pivot), y: RY } : null;
    const tf = (x, y) => {
      if (!anim) return { x, y };
      const c = Math.cos(anim.theta), sn = Math.sin(anim.theta);
      const rx = x - piv.x, ry = y - piv.y;
      return {
        x: piv.x + rx * c + ry * sn + anim.dx * LPX,
        y: piv.y - rx * sn + ry * c - anim.dy * LPX,
      };
    };

    s.push(`<defs>
      <marker id="mf-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker>
    </defs>`);

    // ---- 寸法線（止まっているときだけ）
    const dims = anim ? [] : this._dims(state, labels);
    s.push(...dims);

    // ---- 動かす前の棒（アニメーション中は点線で残す）
    if (anim) {
      s.push(`<rect x="${X0}" y="${RY - ROD_H / 2}" width="${LPX}" height="${ROD_H}" fill="none" stroke="${MUTED}" stroke-dasharray="5 5" stroke-width="1.2"/>`);
    }

    // ---- 棒（回転中心の丸を含む）
    const rodG = anim
      ? `transform="translate(${anim.dx * LPX} ${-anim.dy * LPX}) rotate(${(-anim.theta * 180) / Math.PI} ${piv.x} ${piv.y})"`
      : '';
    const ox = X(state.tO);
    const bulge = BULGE_R + (dragKind === 'O' ? 5 : this.hover === 'O' ? 2.5 : 0);
    s.push(`<g ${rodG}>`);
    s.push(`<rect x="${X0}" y="${RY - ROD_H / 2}" width="${LPX}" height="${ROD_H}" fill="#fffdf7" stroke="${INK}" stroke-width="2"/>`);
    if (state.mode === 'pin') {
      // 資料の図と同じく、丸を描いてから棒の内側を白で塗り直して「膨らみ」に見せる
      s.push(`<circle cx="${ox}" cy="${RY}" r="${bulge}" fill="#fffdf7" stroke="${INK}" stroke-width="2"/>`);
      const x1 = Math.max(X0 + 1, ox - bulge - 2), x2 = Math.min(X0 + LPX - 1, ox + bulge + 2);
      s.push(`<rect x="${x1}" y="${RY - ROD_H / 2 + 1}" width="${x2 - x1}" height="${ROD_H - 2}" fill="#fffdf7"/>`);
      s.push(`<circle cx="${ox}" cy="${RY}" r="2.6" fill="${INK}"/>`);
    }
    if (state.mode === 'free') {
      const gx = X(0.5);
      s.push(`<circle cx="${gx}" cy="${RY}" r="5.5" fill="#fffdf7" stroke="${INK}" stroke-width="1.4"/>
        <path d="M${gx} ${RY - 5.5} A5.5 5.5 0 0 1 ${gx + 5.5} ${RY} L${gx} ${RY} z M${gx} ${RY + 5.5} A5.5 5.5 0 0 1 ${gx - 5.5} ${RY} L${gx} ${RY} z" fill="${INK}"/>`);
    }
    s.push('</g>');
    if (state.mode === 'free' && !anim) {
      labels.push({ key: 'G', tex: 'G', x: X(0.5) + 14, y: RY + 22, cls: 'muted' });
    }

    // 自由体では O はただの「モーメントを測る点」なので、棒から離して十字で示す
    if (state.mode === 'free' && !anim) {
      const r = bulge;
      s.push(`<circle cx="${ox}" cy="${RY}" r="${r}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-dasharray="4 3"/>
        <path d="M${ox - r - 4} ${RY} H${ox + r + 4} M${ox} ${RY - r - 4} V${RY + r + 4}" stroke="${INK}" stroke-width="1"/>`);
    }
    const oPos = anim && state.mode === 'pin' ? tf(ox, RY) : { x: ox, y: RY };
    if (!(anim && state.mode === 'free')) {
      labels.push({ key: 'O', tex: 'O', x: oPos.x - bulge - 9, y: oPos.y + bulge + 9 });
    }

    // ---- モーメントの円弧（止まっているときだけ）
    if (!anim) s.push(...this._arcs(state, res, labels));

    // ---- 荷重
    actions.forEach((a, k) => {
      const T = actionType(a);
      if (a.type !== 'point') return; // 他の種類はここに描き方を足す
      const color = COLORS[k % COLORS.length];
      const i = symbolIndex(actions, k);
      const p0 = tf(X(a.t), RY);
      const r = (a.dir * Math.PI) / 180;
      const len = a.P * PX_PER_KN;
      const tip = { x: p0.x + Math.cos(r) * len, y: p0.y - Math.sin(r) * len };
      const active = sel === k;
      const w = active ? 3.4 : 2.6;

      // 腕の長さ（斜めのときは O から作用線へ下ろした垂線）
      if (active && !anim) s.push(...this._leverArm(state, a, color, labels, i));

      if (len > 0.5) {
        s.push(`<line x1="${p0.x}" y1="${p0.y}" x2="${tip.x}" y2="${tip.y}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" marker-end="url(#mf-head)"/>`);
      }
      // 掴み代（見えない太線と先端の丸）
      if (!anim) {
        s.push(`<line class="grab" data-k="${k}" data-part="shaft" x1="${p0.x}" y1="${p0.y}" x2="${tip.x}" y2="${tip.y}" stroke="transparent" stroke-width="${18 * hs}"/>`);
        const hr = active ? 8 : 6.5;
        s.push(`<circle class="grab tip" data-k="${k}" data-part="tip" cx="${tip.x}" cy="${tip.y}" r="${(hr + 7) * hs}" fill="transparent"/>`);
        s.push(`<circle cx="${tip.x}" cy="${tip.y}" r="${hr}" fill="${color}" fill-opacity="${active ? 0.22 : 0.12}" stroke="${color}" stroke-width="1.2" pointer-events="none"/>`);
        s.push(`<circle cx="${p0.x}" cy="${p0.y}" r="3.3" fill="${color}" pointer-events="none"/>`);
      }

      // 斜めのときは鉛直からの角度を示す
      const { up, tilt } = decompose(a.dir);
      if (!anim && Math.abs(tilt) > 0.5 && len > 20) {
        const rr = Math.min(40, len * 0.55);
        const ref = up ? -Math.PI / 2 : Math.PI / 2; // 画面座標での鉛直（上 or 下）
        const ang = Math.atan2(tip.y - p0.y, tip.x - p0.x);
        const q1 = { x: p0.x + rr * Math.cos(ref), y: p0.y + rr * Math.sin(ref) };
        const q2 = { x: p0.x + rr * Math.cos(ang), y: p0.y + rr * Math.sin(ang) };
        let dA = ang - ref;
        while (dA > Math.PI) dA -= 2 * Math.PI;
        while (dA < -Math.PI) dA += 2 * Math.PI;
        s.push(`<line x1="${p0.x}" y1="${p0.y}" x2="${p0.x + (rr + 12) * Math.cos(ref)}" y2="${p0.y + (rr + 12) * Math.sin(ref)}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3"/>`);
        s.push(`<path d="M${q1.x} ${q1.y} A${rr} ${rr} 0 0 ${dA > 0 ? 1 : 0} ${q2.x} ${q2.y}" fill="none" stroke="${color}" stroke-width="1.2"/>`);
        const mid = ref + dA / 2;
        labels.push({
          key: `th${k}`, tex: `\\theta_{${i}}${state.showValues ? '=' + angleTex(tilt) : ''}`,
          x: p0.x + (rr + 16) * Math.cos(mid), y: p0.y + (rr + 16) * Math.sin(mid), color, small: true,
        });
      }

      // 記号
      const ux = len > 0.5 ? (tip.x - p0.x) / len : 0;
      const uy = len > 0.5 ? (tip.y - p0.y) / len : -1;
      labels.push({
        key: `P${k}`,
        tex: `${T.symbol(i)}${state.showValues ? `=${fmt(a.P, 2)}\\,\\mathrm{kN}` : ''}`,
        x: tip.x + ux * 26 + (Math.abs(ux) < 0.5 ? 20 : 0),
        y: tip.y + uy * 22,
        color,
      });
    });

    this.svg.innerHTML = s.join('');
    this._setLabels(labels, LO);
  }

  /** 荷重の先端・円弧・寸法線の段数から、図の上下の範囲と寸法線の高さを決める */
  _layout(state, res) {
    let hi = RY, lo = RY, xl = X0, xr = X0 + LPX;
    state.actions.forEach((a, k) => {
      if (a.type !== 'point') return;
      const r = (a.dir * Math.PI) / 180;
      const x = X(a.t) + Math.cos(r) * a.P * PX_PER_KN;
      const y = RY - Math.sin(r) * a.P * PX_PER_KN;
      hi = Math.min(hi, y); lo = Math.max(lo, y);
      xl = Math.min(xl, x); xr = Math.max(xr, x);
      // 選んでいる斜めの荷重は、腕の長さの垂線の足も図に入れる（遠すぎるときは描かない）
      if (k === state.sel) {
        const f = this._foot(state, a);
        if (f) { hi = Math.min(hi, f.y); lo = Math.max(lo, f.y); xl = Math.min(xl, f.x); xr = Math.max(xr, f.x); }
      }
    });
    const nArc = (state.showEach ? res.terms.length : 0) + 1;
    const rArc = BULGE_R + 24 + 9 * (nArc - 1) + 4 + (state.mode === 'free' ? 6 : 0);
    const top = Math.min(RY - 130, hi - 42, RY - rArc - 40);
    const base = Math.max(RY + ROD_H / 2 + 30, lo + 36);
    const rows = this._dimRows(state).length;
    const bottom = Math.max(base + (rows - 1) * DIM_GAP + 24, RY + 130);
    const pad = state.showValues ? 44 : 0; // 「P_1=6 kN」のように長くなるぶん
    const left = Math.min(X0 - 70, xl - 46 - pad);
    const right = Math.max(X0 + LPX + 60 + pad, xr + 56 + pad);
    return { top, base, bottom, left, right };
  }

  /** O から荷重の作用線へ下ろした垂線の足（斜めの荷重だけ。遠すぎれば null） */
  _foot(state, a) {
    const { tilt } = decompose(a.dir);
    if (Math.abs(tilt) < 0.5 || Math.abs(Math.abs(tilt) - 90) < 0.5) return null;
    const ox = X(state.tO), ax = X(a.t);
    if (Math.abs(ax - ox) < 1) return null;
    const r = (a.dir * Math.PI) / 180;
    const d = { x: Math.cos(r), y: -Math.sin(r) };
    const s = (ox - ax) * d.x;
    const f = { x: ax + d.x * s, y: RY + d.y * s, d, s };
    if (Math.abs(f.y - RY) > 320) return null;
    return f;
  }

  /** アニメーションで棒が図からはみ出さない範囲（回転角 [rad] と上下の移動量 [L]） */
  animLimits(pivotT) {
    const LO = this.layout;
    const room = Math.min(RY - LO.top, LO.bottom - RY) - 12;
    const px = X(pivotT);
    const rmax = Math.max(Math.abs(px - X0), Math.abs(X0 + LPX - px), 1);
    return { theta: Math.min(1.22, Math.asin(Math.min(1, (room - 24) / rmax))), dy: (room - 24) / LPX, dx: 0.3 };
  }

  /** 寸法線の一覧（下から順ではなく上の段から）。L 表記は O からの距離、x 表記は左端からの座標。 */
  _dimRows(state) {
    const { actions, tO, notation } = state;
    const rows = [];
    const pts = actions.map((a, k) => ({ a, k })).filter(({ a }) => a.type === 'point');
    const isTotal = (ta, tb) => Math.abs(Math.min(ta, tb)) < 1e-9 && Math.abs(Math.max(ta, tb) - 1) < 1e-9;
    if (notation === 'x') {
      const xs = [{ t: tO, tex: 'x_{O}', key: 'dxO', color: INK }, ...pts.map(({ a, k }) => ({
        t: a.t, tex: `x_{${symbolIndex(actions, k)}}`, key: `dx${k}`, color: COLORS[k % COLORS.length],
      }))];
      for (const r of xs) if (r.t > 1e-9) rows.push({ ta: 0, tb: r.t, ...r });
    } else {
      const seen = new Set();
      for (const { a, k } of pts) {
        const d = a.t - tO;
        const id = a.t.toFixed(6);
        if (Math.abs(d) < 1e-9 || isTotal(tO, a.t) || seen.has(id)) continue;
        seen.add(id); // 同じ位置の荷重は寸法線を 1 本にまとめる
        rows.push({ ta: tO, tb: a.t, tex: posTex(d), key: `dl${k}`, color: COLORS[k % COLORS.length] });
      }
    }
    rows.push({ ta: 0, tb: 1, tex: 'L', key: 'dL', color: INK });
    return rows;
  }

  _dims(state, labels) {
    const out = [];
    const base = this.layout.base;
    if (state.notation === 'x') {
      labels.push({ key: 'x0', tex: 'x=0', x: X0 - 30, y: RY + 20, small: true, cls: 'muted' });
    }
    this._dimRows(state).forEach((r, lv) => {
      const y = base + lv * DIM_GAP;
      const xa = X(r.ta), xb = X(r.tb);
      out.push(this._extLine(xa, y), this._extLine(xb, y));
      out.push(`<line x1="${xa}" y1="${y}" x2="${xb}" y2="${y}" stroke="${r.color}" stroke-width="1" marker-start="url(#mf-head)" marker-end="url(#mf-head)"/>`);
      labels.push({ key: r.key, tex: r.tex, x: (xa + xb) / 2, y: y - 11, color: r.color, small: true, bg: true });
    });
    return out;
  }

  _extLine(x, y) {
    return `<line x1="${x}" y1="${RY + ROD_H / 2 + 3}" x2="${x}" y2="${y + 6}" stroke="${MUTED}" stroke-width="0.7"/>`;
  }

  /** O を中心にした円弧の矢印。長さ（角度）が |M|、向きが回す向き。 */
  _arcs(state, res, labels) {
    const out = [];
    const ox = X(state.tO);
    const items = [];
    if (state.showEach) {
      res.terms.forEach((t, k) => items.push({ M: t.value / state.Lm, color: COLORS[k % COLORS.length], w: 2.2, key: `a${k}` }));
    }
    items.push({ M: res.MO / state.Lm, color: ACCENT, w: 4.2, key: 'aSum', total: true });
    let r = BULGE_R + 24;
    if (state.mode === 'free') r += 6;
    for (const it of items) {
      if (it.total) r += 4;
      const deg = Math.min(340, (270 * Math.abs(it.M)) / M_FULL);
      if (Math.abs(it.M) > 1e-9) {
        out.push(arcArrow(ox, RY, r, Math.max(deg, 10), it.M > 0, it.color, it.w, it.total ? 0.95 : 0.7));
        if (it.total) {
          // 円弧の終わりに M_O を出す
          const a1 = -Math.PI / 2 - (it.M > 0 ? 1 : -1) * (Math.max(deg, 10) * Math.PI) / 180;
          labels.push({
            key: 'MO', tex: 'M_{O}', color: ACCENT,
            x: ox + (r + 16) * Math.cos(a1), y: RY + (r + 16) * Math.sin(a1),
          });
        }
      } else if (it.total) {
        labels.push({ key: 'MO', tex: 'M_{O}=0', color: ACCENT, x: ox, y: RY - r - 10 });
      }
      r += it.total ? 0 : 9;
    }
    return out;
  }

  /** 選んだ荷重の腕の長さを示す（斜めのときは垂線の足を描く） */
  _leverArm(state, a, color, labels, i) {
    const out = [];
    const f = this._foot(state, a);
    if (!f) return out;
    const ox = X(state.tO), ax = X(a.t);
    const { d, s } = f;
    const foot = f;
    const sg = Math.sign(s || 1);
    out.push(`<line x1="${ax - d.x * 30 * sg}" y1="${RY - d.y * 30 * sg}" x2="${foot.x + d.x * 30 * sg}" y2="${foot.y + d.y * 30 * sg}" stroke="${color}" stroke-width="1" stroke-dasharray="6 4"/>`);
    out.push(`<line x1="${ox}" y1="${RY}" x2="${foot.x}" y2="${foot.y}" stroke="${color}" stroke-width="1.6"/>`);
    // 直角の印
    const u = { x: (ox - foot.x), y: (RY - foot.y) };
    const ul = Math.hypot(u.x, u.y) || 1;
    const m = 8;
    const e1 = { x: (u.x / ul) * m, y: (u.y / ul) * m };
    const e2 = { x: -d.x * m * Math.sign(s || 1), y: -d.y * m * Math.sign(s || 1) };
    out.push(`<path d="M${foot.x + e1.x} ${foot.y + e1.y} l${e2.x} ${e2.y} l${-e1.x} ${-e1.y}" fill="none" stroke="${color}" stroke-width="1"/>`);
    const tex = state.notation === 'x'
      ? `(x_{${i}}-x_{O})\\cos\\theta_{${i}}`
      : `${posTex(a.t - state.tO)}\\cos\\theta_{${i}}`;
    labels.push({ key: 'lever', tex, x: (ox + foot.x) / 2 + 6, y: (RY + foot.y) / 2 - 14, color, small: true, bg: true });
    return out;
  }

  /** ラベルを KaTeX で描く。key ごとに要素を使い回し、式が変わったときだけ描き直す。 */
  _setLabels(list, LO) {
    const h = LO.bottom - LO.top;
    const seen = new Set();
    for (const L of list) {
      seen.add(L.key);
      let el = this.labels.get(L.key);
      if (!el) {
        el = document.createElement('span');
        el.className = 'fig-label';
        this.overlay.append(el);
        this.labels.set(L.key, el);
      }
      if (el.dataset.tex !== L.tex) {
        el.dataset.tex = L.tex;
        if (typeof katex !== 'undefined') katex.render(L.tex, el, { throwOnError: false });
        else el.textContent = L.tex;
      }
      el.style.left = `${((L.x - LO.left) / (LO.right - LO.left)) * 100}%`;
      el.style.top = `${((L.y - LO.top) / h) * 100}%`;
      el.style.color = L.color || INK;
      el.classList.toggle('small', !!L.small);
      el.classList.toggle('bg', !!L.bg);
      el.classList.toggle('muted', L.cls === 'muted');
    }
    for (const [k, el] of this.labels) {
      if (!seen.has(k)) { el.remove(); this.labels.delete(k); }
    }
  }

  // ------------------------------------------------------------ 操作

  _pt(e) {
    const m = this.svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  _hit(p, e) {
    const el = e.target.closest && e.target.closest('.grab');
    const st = this.state;
    // 先端 > O > 軸 の順に優先する（先端と O が重なったときは先端を掴む）
    if (el && el.dataset.part === 'tip') return { kind: 'tip', k: +el.dataset.k };
    if (Math.hypot(p.x - X(st.tO), p.y - RY) <= (BULGE_R + 9) * (this.hitScale || 1)) return { kind: 'O' };
    if (el && el.dataset.part === 'shaft') return { kind: 'shaft', k: +el.dataset.k };
    return null;
  }

  _down(e) {
    if (!this.state || this.state.animating) return;
    const p = this._pt(e);
    const h = this._hit(p, e);
    if (!h) return;
    e.preventDefault();
    this.svg.setPointerCapture(e.pointerId);
    this.drag = { ...h, id: e.pointerId, start: p };
    if (h.kind !== 'O') {
      const a = this.state.actions[h.k];
      this.drag.oblique = Math.abs(decompose(a.dir).tilt) > 0.5;
      this.onSelect(h.k);
    }
    this.onDragState(true);
    this._apply(p);
  }

  _move(e) {
    const p = this._pt(e);
    if (!this.drag) {
      const h = this.state && !this.state.animating ? this._hit(p, e) : null;
      const hv = h ? h.kind : null;
      this.svg.style.cursor = !h ? 'default' : h.kind === 'tip' ? 'grab' : 'ew-resize';
      if (hv !== this.hover) {
        this.hover = hv;
        this.onChange(null); // 丸の膨らみだけ描き直す
      }
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
    const st = this.state;
    const d = this.drag;
    const tol = SNAP_PX / LPX;
    if (d.kind === 'O') {
      this.onChange({ tO: snapPosition(clamp01((p.x - X0) / LPX), tol) });
      return;
    }
    const a = { ...st.actions[d.k] };
    if (d.kind === 'shaft') {
      a.t = snapPosition(clamp01((p.x - X0) / LPX), tol);
    } else {
      const ax = X(a.t);
      const dx = p.x - ax;
      const dy = RY - p.y; // 上が正
      if (!d.oblique && Math.abs(dx) > OBLIQUE_DX) d.oblique = true;
      if (!d.oblique) {
        // 基本は上下まっすぐ
        a.P = Math.min(P_MAX, Math.round(Math.abs(dy) / PX_PER_KN));
        a.dir = dy >= 0 ? 90 : -90;
      } else {
        const len = Math.hypot(dx, dy);
        a.P = Math.min(P_MAX, Math.round(len / PX_PER_KN));
        const raw = (Math.atan2(dy, dx) * 180) / Math.PI;
        const { up, tilt } = decompose(raw);
        a.dir = compose(up, snapTilt(tilt));
      }
    }
    this.onChange({ action: { k: d.k, value: a } });
  }

  _dbl(e) {
    if (!this.state || this.state.animating) return;
    const p = this._pt(e);
    if (Math.abs(p.y - RY) > 26 || p.x < X0 - 10 || p.x > X0 + LPX + 10) return;
    this.onChange({ add: snapPosition(clamp01((p.x - X0) / LPX), SNAP_PX / LPX) });
  }
}

/** 円弧の矢印。ccw = 反時計まわり（画面上）。12時の位置から描き始める。 */
function arcArrow(cx, cy, r, deg, ccw, color, w, op) {
  const a0 = -Math.PI / 2;
  const sg = ccw ? -1 : 1; // 画面座標の角度は時計まわりが正
  const head = Math.min(14 + w * 1.5, r * 0.9);
  const dHead = head / r; // 矢じりが食う角度
  const a1 = a0 + sg * (deg * Math.PI) / 180;
  const aBody = a1 - sg * dHead * 0.85;
  const p = (a) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  const s0 = p(a0), s1 = p(aBody), tip = p(a1);
  const large = Math.abs(aBody - a0) > Math.PI ? 1 : 0;
  const sweep = ccw ? 0 : 1;
  // 矢じり: 先端 tip、根元は aBody の位置で半径方向に広げる
  const hw = 4 + w * 0.9;
  const b = p(a1 - sg * dHead);
  const nx = Math.cos(a1 - sg * dHead), ny = Math.sin(a1 - sg * dHead);
  const h1 = { x: b.x + nx * hw, y: b.y + ny * hw };
  const h2 = { x: b.x - nx * hw, y: b.y - ny * hw };
  let body = '';
  if (Math.abs(aBody - a0) > 1e-3 && (aBody - a0) * sg > 0) {
    body = `<path d="M${s0.x} ${s0.y} A${r} ${r} 0 ${large} ${sweep} ${s1.x} ${s1.y}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" opacity="${op}"/>`;
  }
  return `${body}<path d="M${tip.x} ${tip.y} L${h1.x} ${h1.y} L${h2.x} ${h2.y} z" fill="${color}" opacity="${op}"/>`;
}

