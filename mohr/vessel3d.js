// 薄肉圧力容器（球殻・円筒殻）の 3D 表示（three.js）。
//  - 殻の一部を楔形に切り欠いて、内面と内圧 p の矢印を見せる
//  - 膜応力は殻のどこでも同じなので、コンターは一色（カラーバーの位置で大きさを読む）
//  - 外表面をドラッグすると探触点が動く（局所座標 x / y / r の向きだけが変わる）
//  - 内圧の矢印（中央の 1 本）を掴んでドラッグすると p が変わる
//
// 表示上の寸法は外半径を 100 に正規化している（r が 50 mm でも 2 m でも同じ大きさに見える）。
// 肉厚だけは t / r の比で描く（薄すぎると見えないので下限を設ける）。
// 局所座標の取り方は講義資料「薄肉容器」に合わせる:
//   球殻  : x = 経線方向 φ、y = 周方向 θ、r = 半径方向
//   円筒殻: x = 軸方向 z、  y = 周方向 θ、r = 半径方向（丸棒と同じ向き）
// どちらも丸棒（rod3d.js）と同じく、外から見て x → y が時計まわり（x × y = −r）になるように
// とってある。応力要素の図・回した X–Y 軸の向きが丸棒と揃う。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeArrow, makeLabelSprite, placeArrow } from './rod3d.js';
import { vesselStress, analyze, fieldByKey, colorAt } from './stress.js';

const RO = 100; // 表示上の外半径
const HALF = 135; // 円筒殻の表示上の半長
const DEG = Math.PI / 180;

// 切り欠く範囲（窓）。円筒殻は右半分（x > 0）の角度 a（+y から +z へ）の範囲、
// 球殻は上半球（緯度 > 0）の経度 lon（+x から +z へ）の範囲を抜く。
// 全体を楔形に抜くと容器の形が読めなくなる（2026-10-05 に試して判明）ので、半分だけにしてある。
// 既定の視点（VIEW_DIR）から窓の奥の内面と、閉じた側の外面（探触点）の両方が見える角度。
const CYL_CUT = [0 * DEG, 100 * DEG];
const SPH_CUT = [25 * DEG, 115 * DEG];
// 既定の視点。丸棒（rod3d.js）より見下ろし気味にして、窓から内面の底（内圧の矢印）が見えるようにする。
// 矢印は壁に垂直なので、真横から覗くと視線に沿ってしまい点にしか見えない
const VIEW_DIR = new THREE.Vector3(0.38, 0.62, 0.7).normalize();

/** パラメータ (u, v) ∈ [0,1]² の格子面。f(u, v) が [x, y, z] を返す。 */
function grid(nu, nv, f) {
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const k = (i * (nv + 1) + j) * 3;
      const p = f(i / nu, j / nv);
      pos[k] = p[0];
      pos[k + 1] = p[1];
      pos[k + 2] = p[2];
    }
  }
  const idx = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j;
      const b = a + nv + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const lerp = (a, b, t) => a + (b - a) * t;
const cylPt = (x, r, a) => [x, r * Math.cos(a), r * Math.sin(a)];
const sphPt = (r, lat, lon) => [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)];

/** 円筒殻の局所基底（丸棒と同じ）。 */
function cylBasis(a) {
  return {
    er: new THREE.Vector3(0, Math.cos(a), Math.sin(a)),
    ex: new THREE.Vector3(1, 0, 0),
    ey: new THREE.Vector3(0, -Math.sin(a), Math.cos(a)),
  };
}

/** 球殻の局所基底。x は経線方向（北向き）、y = x × r（外から見て x → y が時計まわり）。 */
function sphBasis(lat, lon) {
  const er = new THREE.Vector3(...sphPt(1, lat, lon));
  const ex = new THREE.Vector3(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), -Math.sin(lat) * Math.sin(lon));
  const ey = new THREE.Vector3().crossVectors(ex, er);
  return { er, ex, ey };
}

export class VesselScene {
  constructor(container, opts = {}) {
    this.container = container;
    this.onPick = opts.onPick || (() => {});
    this.onPressureChange = opts.onPressureChange || (() => {});
    this.pRange = opts.pRange || [-5, 20];

    this.kind = 'cyl';
    this.vessel = { p: 2, r: 500, t: 10 };
    this.fieldKey = 'sx';
    this.phi = 0;
    this.fitMargin = 1.06;
    // 画面の上下に容器をずらす量（ビューの半分の高さに対する割合、正で上へ）。
    // スマホではカラーバーが図の下側に被るので、容器を上へ寄せる（app.js が設定）
    this.lift = 0;
    this.range = { min: 0, max: 0 };
    this.active = false;
    // 探触点。円筒殻: u = 軸方向位置（−1..1、半長で割った値）、v = 角度 a [rad]
    //         球殻  : u = 緯度 [rad]、v = 経度 [rad]
    this.probes = { cyl: { u: -0.45, v: 75 * DEG }, sph: { u: -15 * DEG, v: 145 * DEG } };

    this._initThree();
    this._buildStatic();
    this._bindPointer();
    this.rebuild();
    this._animate();
  }

  get probe() {
    return this.probes[this.kind];
  }

  // ------------------------------------------------------------ 初期化

  _initThree() {
    const c = this.container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearAlpha(0);
    this.renderer.setSize(c.clientWidth || 600, c.clientHeight || 380, false);
    this.renderer.domElement.style.display = 'none';
    // カラーバー等のオーバーレイより下に来るよう、丸棒の canvas の直後に入れる
    c.insertBefore(this.renderer.domElement, c.querySelector('canvas')?.nextSibling || c.firstChild);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1.6, 1, 20000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.85;
    this.controls.enabled = false;
    this._userMoved = false;
    this.controls.addEventListener('start', () => { this._userMoved = true; });

    // ライトの強さは rod3d.js と同じ（理由もそちらのコメント・CLAUDE.md を参照）
    this.scene.add(new THREE.AmbientLight(0xffffff, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 0.55);
    key.position.set(0.45, 1, 0.75);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.2);
    fill.position.set(-0.6, -0.4, -0.8);
    this.scene.add(fill);

    this.raycaster = new THREE.Raycaster();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(c);
  }

  _resize() {
    if (!this.active) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this._userMoved) this.fitCamera();
  }

  _buildStatic() {
    this.shellMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    this.cutMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    // 内面は外面より淡くして、窓から見えているのが内側だと分かるようにする
    this.innerMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    this.shellGroup = new THREE.Group();
    this.scene.add(this.shellGroup);
    this.outers = [];

    // 内圧の矢印（資料と同じく赤）。中央の 1 本に記号 p と掴み代を付ける
    this.pGroup = new THREE.Group();
    this.scene.add(this.pGroup);
    this.pArrows = [];
    for (let i = 0; i < 9; i++) {
      const a = makeArrow(0xd23c3c);
      this.pGroup.add(a);
      this.pArrows.push(a);
    }
    this.pLabel = makeLabelSprite('p', '#c0392b');
    this.pLabel.material.depthTest = true; // 殻の内側にあるので、殻の陰では隠れるようにする
    this.pGroup.add(this.pLabel);
    this.pGrab = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    this.pGroup.add(this.pGrab);

    // 探触点（rod3d.js と同じ見た目: 黒い x / y / r と、φ≠0 のときだけ紫・金の X / Y）
    this.probeGroup = new THREE.Group();
    this.scene.add(this.probeGroup);
    this.probeDot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x1d2932 }));
    this.probeGroup.add(this.probeDot);
    this.probeAxes = { x: makeArrow(0x1d2932), y: makeArrow(0x1d2932), r: makeArrow(0x1d2932) };
    this.probeLabels = { x: makeLabelSprite('x', '#1d2932'), y: makeLabelSprite('y', '#1d2932'), r: makeLabelSprite('r', '#1d2932') };
    this.probeAxesRot = { X: makeArrow(0x7d5ba6), Y: makeArrow(0xb8860b) };
    this.probeLabelsRot = { X: makeLabelSprite('X', '#7d5ba6'), Y: makeLabelSprite('Y', '#b8860b') };
    for (const o of [this.probeAxes, this.probeLabels, this.probeAxesRot, this.probeLabelsRot]) {
      for (const k in o) this.probeGroup.add(o[k]);
    }
  }

  // ------------------------------------------------------------ 更新

  /** まとめて設定して 1 回だけ再構築する。 */
  set(partial) {
    const kindChanged = partial.kind !== undefined && partial.kind !== this.kind;
    if (partial.kind !== undefined) this.kind = partial.kind;
    if (partial.vessel) this.vessel = { ...partial.vessel };
    if (partial.field !== undefined) this.fieldKey = partial.field;
    this.rebuild();
    if (kindChanged) this.resetView();
  }

  get wall() {
    // 肉厚の表示（t / r の比。薄すぎると見えないので下限、厚すぎると殻に見えないので上限）
    return Math.min(30, Math.max(1.6, (RO * this.vessel.t) / this.vessel.r));
  }

  rebuild() {
    this._buildShell();
    this._updateColor();
    this._updatePressure();
    this._updateProbeMarker();
  }

  _buildShell() {
    for (const m of this.shellGroup.children) m.geometry.dispose();
    this.shellGroup.clear();
    this.outers = [];
    const w = this.wall;
    const ri = RO - w;
    const outer = (g) => this.outers.push(add(g, this.shellMat));
    const inner = (g) => add(g, this.innerMat);
    const cut = (g) => add(g, this.cutMat);
    const add = (g, mat = this.shellMat) => {
      const m = new THREE.Mesh(g, mat);
      this.shellGroup.add(m);
      return m;
    };
    const TAU = 2 * Math.PI;

    if (this.kind === 'cyl') {
      const [c0, c1] = CYL_CUT;
      const full = (v) => v * TAU;
      const kept = (v) => lerp(c1, c0 + TAU, v); // 窓の側で残す角度
      const hi = HALF - w;
      // 胴: 左半分は閉じた円筒、右半分は窓を抜いた円筒
      outer(grid(16, 96, (u, v) => cylPt(lerp(-HALF, 0, u), RO, full(v))));
      outer(grid(16, 72, (u, v) => cylPt(lerp(0, HALF, u), RO, kept(v))));
      inner(grid(16, 96, (u, v) => cylPt(lerp(-hi, 0, u), ri, full(v))));
      inner(grid(16, 72, (u, v) => cylPt(lerp(0, hi, u), ri, kept(v))));
      // 端板（資料の図と同じく平らなふた）。外面と内面。端板の上は膜応力の式が成り立たないので探触点は置かない
      add(grid(8, 96, (u, v) => cylPt(-HALF, RO * u, full(v))));
      inner(grid(8, 96, (u, v) => cylPt(-hi, ri * u, full(v))));
      add(grid(8, 72, (u, v) => cylPt(HALF, RO * u, kept(v))));
      inner(grid(8, 72, (u, v) => cylPt(hi, ri * u, kept(v))));
      // 切り口: 胴の肉厚の帯（窓の両縁と x = 0 の縁）、右の端板
      for (const a of [c0, c1]) {
        cut(grid(16, 1, (u, v) => cylPt(lerp(0, HALF, u), lerp(ri, RO, v), a)));
        cut(grid(1, 4, (u, v) => cylPt(lerp(hi, HALF, u), ri * v, a)));
      }
      cut(grid(1, 24, (u, v) => cylPt(0, lerp(ri, RO, u), lerp(c0, c1, v))));
    } else {
      const [l0, l1] = SPH_CUT;
      const full = (v) => v * TAU;
      const kept = (v) => lerp(l1, l0 + TAU, v);
      const south = (u) => lerp(-Math.PI / 2, 0, u);
      const north = (u) => lerp(0, Math.PI / 2, u);
      // 下半球は閉じたまま、上半球だけ経度の範囲を抜く
      outer(grid(32, 96, (u, v) => sphPt(RO, south(u), full(v))));
      outer(grid(32, 72, (u, v) => sphPt(RO, north(u), kept(v))));
      inner(grid(32, 96, (u, v) => sphPt(ri, south(u), full(v))));
      inner(grid(32, 72, (u, v) => sphPt(ri, north(u), kept(v))));
      // 切り口: 経線に沿う 2 枚と赤道の 1 枚
      for (const lon of [l0, l1]) cut(grid(32, 1, (u, v) => sphPt(lerp(ri, RO, v), north(u), lon)));
      cut(grid(1, 24, (u, v) => sphPt(lerp(ri, RO, u), 0, lerp(l0, l1, v))));
    }
  }

  /** 膜応力はどこでも同じなので、殻全体を 1 色で塗る。 */
  _updateColor() {
    const field = fieldByKey(this.fieldKey);
    const an = analyze(vesselStress(this.kind, this.vessel));
    const v = field.get(an);
    // 色の基準は「この容器に生じる最大の主応力の大きさ」。σx と σy（円筒殻なら 1 : 2）を
    // 切り替えたときに色の濃さで比べられるようにするため（場ごとに合わせると常に最濃色になる）
    const m = Math.max(Math.abs(an.s1), Math.abs(an.s3), 1e-6);
    this.range = field.diverging ? { min: -m, max: m } : { min: 0, max: m };
    const u = (v - this.range.min) / (this.range.max - this.range.min);
    const rgb = colorAt(u, field.diverging);
    this.shellMat.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
    this.cutMat.color.setRGB(rgb[0] * 0.72, rgb[1] * 0.72, rgb[2] * 0.72, THREE.SRGBColorSpace);
    const pale = (c) => c + (1 - c) * 0.45;
    this.innerMat.color.setRGB(pale(rgb[0]), pale(rgb[1]), pale(rgb[2]), THREE.SRGBColorSpace);
    this.value = v;
  }

  /** 内圧の矢印。切り欠きから見える奥の内面に、内側から壁を押す向きで描く。 */
  _updatePressure() {
    const ri = RO - this.wall;
    const p = this.vessel.p;
    const pMax = Math.max(Math.abs(this.pRange[0]), Math.abs(this.pRange[1]));
    const mag = Math.min(1, Math.abs(p) / pMax);
    const len = RO * (0.16 + 0.4 * mag);
    const spots = [];
    // 窓の奥に見える内面に置く（先頭の 1 本に記号 p と掴み代を付ける）
    if (this.kind === 'cyl') {
      for (const a of [190, 150, 230]) for (const x of [0.5, 0.2, 0.8]) spots.push({ x: x * HALF, n: cylBasis(a * DEG).er });
    } else {
      const lc = (SPH_CUT[0] + SPH_CUT[1]) / 2 + Math.PI;
      for (const [lat, dl] of [[-55, 0], [-80, 0], [-35, 0], [-50, -45], [-50, 45], [-30, -40], [-30, 40], [-60, -90], [-60, 90]]) {
        spots.push({ x: 0, n: sphBasis(lat * DEG, lc + dl * DEG).er });
      }
    }
    const show = mag > 0.004;
    spots.forEach((s, i) => {
      const wall = s.n.clone().multiplyScalar(ri).add(new THREE.Vector3(s.x, 0, 0));
      const tail = wall.clone().addScaledVector(s.n, -len);
      // 正（内圧）なら壁を外へ押す向き、負なら内向き
      if (!show) this.pArrows[i].visible = false;
      else if (p >= 0) placeArrow(this.pArrows[i], tail, wall, RO * 0.016);
      else placeArrow(this.pArrows[i], wall, tail, RO * 0.016);
      if (i === 0) {
        const mid = wall.clone().addScaledVector(s.n, -len / 2);
        this.pGrab.position.copy(mid);
        this.pGrab.scale.setScalar(RO * 0.09);
        this.pGrab.userData.dirWorld = s.n.clone().negate(); // 中心へ引くと p が増える
        this.pLabel.visible = show;
        this.pLabel.scale.setScalar(RO * 0.2);
        // 記号は矢印の横（軸方向にずらす）に置く
        this.pLabel.position.copy(tail).add(new THREE.Vector3(RO * 0.12, RO * 0.06, 0));
      }
    });
  }

  _probePoint() {
    const q = this.probe;
    if (this.kind === 'cyl') {
      const b = cylBasis(q.v);
      return { p: new THREE.Vector3(...cylPt(q.u * HALF, RO, q.v)), ...b };
    }
    const b = sphBasis(q.u, q.v);
    return { p: new THREE.Vector3(...sphPt(RO, q.u, q.v)), ...b };
  }

  _updateProbeMarker() {
    const { p, ex, ey, er } = this._probePoint();
    const len = RO * 0.4;
    const shaft = RO * 0.018;
    const lab = RO * 0.24;
    this.probeDot.position.copy(p);
    this.probeDot.scale.setScalar(RO * 0.035);
    const axes = { x: [ex, len], y: [ey, len], r: [er, len * 0.75] };
    for (const k in axes) {
      const [e, l] = axes[k];
      placeArrow(this.probeAxes[k], p, p.clone().addScaledVector(e, l), shaft);
      this.probeLabels[k].scale.setScalar(lab);
      this.probeLabels[k].position.copy(p).addScaledVector(e, l + lab * 0.6);
    }
    const showRot = Math.abs(this.phi) > 1e-4;
    for (const k of ['X', 'Y']) {
      this.probeAxesRot[k].visible = showRot;
      this.probeLabelsRot[k].visible = showRot;
    }
    if (showRot) {
      // stress.js の rotated() と同じく反時計まわりに φ（rod3d.js と同じ式）
      const c = Math.cos(this.phi);
      const s = Math.sin(this.phi);
      const eX = ex.clone().multiplyScalar(c).addScaledVector(ey, s);
      const eY = ex.clone().multiplyScalar(-s).addScaledVector(ey, c);
      for (const [k, e] of [['X', eX], ['Y', eY]]) {
        placeArrow(this.probeAxesRot[k], p, p.clone().addScaledVector(e, len), shaft);
        this.probeLabelsRot[k].scale.setScalar(lab);
        this.probeLabelsRot[k].position.copy(p).addScaledVector(e, len + lab * 0.6);
      }
    }
  }

  setPhi(phi) {
    this.phi = phi;
    this._updateProbeMarker();
  }

  /** プログラムから探触点を設定（u, v は this.probes と同じ単位）。 */
  setProbe(u, v, kind = this.kind) {
    const q = this.probes[kind];
    if (kind === 'cyl') {
      q.u = Math.min(1, Math.max(-1, u));
      q.v = v;
    } else {
      q.u = Math.min(Math.PI / 2, Math.max(-Math.PI / 2, u));
      q.v = v;
    }
    if (kind === this.kind) {
      this._updateProbeMarker();
      this.onPick(this.probe);
    }
  }

  // ------------------------------------------------------------ カメラ

  fitCamera(reset = false) {
    // rod3d.js と同じく、代表点を実際に投影して収める
    const ext = RO * 1.32; // 探触点の軸ラベルの張り出しぶん
    const pts = [];
    const xs = this.kind === 'cyl' ? [-HALF, 0, HALF] : [-ext, -ext * 0.6, 0, ext * 0.6, ext];
    for (const x of xs) {
      const rad = this.kind === 'cyl' ? ext : Math.sqrt(Math.max(0, ext * ext - x * x));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        pts.push(new THREE.Vector3(x, rad * Math.cos(a), rad * Math.sin(a)));
      }
    }
    const dir = reset
      ? VIEW_DIR.clone()
      : this.camera.position.clone().sub(this.controls.target).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const tanH = tanV * (this.camera.aspect || 1.6);
    let dist = 1;
    for (const p of pts) {
      const w = p.dot(dir);
      dist = Math.max(dist, Math.abs(p.dot(right)) / tanH + w, Math.abs(p.dot(up)) / tanV + w);
    }
    dist *= this.fitMargin;
    // 注視点を画面の下方向へずらすと、容器は画面の上へ動く
    this.controls.target.copy(up).multiplyScalar(-this.lift * dist * tanV);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.minDistance = dist * 0.25;
    this.controls.maxDistance = dist * 3.2;
    this.controls.update();
  }

  resetView() {
    this._userMoved = false;
    this.fitCamera(true);
  }

  setActive(on) {
    this.active = on;
    this.renderer.domElement.style.display = on ? '' : 'none';
    this.controls.enabled = on;
    if (on) {
      this._resize();
      if (!this._userMoved) this.fitCamera(true);
    }
  }

  // ------------------------------------------------------------ 入力

  _ndc(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  _screenDir(point, dirWorld) {
    const a = point.clone().project(this.camera);
    const b = point.clone().add(dirWorld.clone().multiplyScalar(RO * 0.2)).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((b.x - a.x) * rect.width) / 2, (-(b.y - a.y) * rect.height) / 2);
    if (v.length() < 1e-6) return new THREE.Vector2(0, -1);
    return v.normalize();
  }

  _bindPointer() {
    // rod3d.js と同じく、親要素のキャプチャ段階で OrbitControls より先に判定する
    this.container.addEventListener(
      'pointerdown',
      (ev) => {
        if (!this.active) return;
        if (ev.button !== undefined && ev.button !== 0) return;
        this.raycaster.setFromCamera(this._ndc(ev), this.camera);
        // 掴み代は p = 0 で矢印が消えていても同じ場所に残してある（引けば内圧を入れられる）
        // 殻の内側にあるので、外面より手前に見えているときだけ掴む
        const hit = this.raycaster.intersectObjects(this.outers, false)[0];
        const grab = this.raycaster.intersectObject(this.pGrab, false)[0];
        if (grab && (!hit || grab.distance < hit.distance)) {
          ev.stopPropagation();
          ev.preventDefault();
          this._startPressureDrag(ev);
          return;
        }
        if (hit) {
          ev.stopPropagation();
          ev.preventDefault();
          this._startProbeDrag(ev, hit);
        }
      },
      true
    );
  }

  _startPressureDrag(ev) {
    const start = { x: ev.clientX, y: ev.clientY };
    const dir2 = this._screenDir(this.pGrab.position, this.pGrab.userData.dirWorld);
    const base = this.vessel.p;
    const [lo, hi] = this.pRange;
    const move = (e) => {
      const t = ((e.clientX - start.x) * dir2.x + (e.clientY - start.y) * dir2.y) / 230;
      const v = Math.min(hi, Math.max(lo, base + t * (hi - lo)));
      this.vessel.p = Math.round(v * 10) / 10;
      this.rebuild();
      this.onPressureChange(this.vessel.p);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  _startProbeDrag(ev, hit) {
    this._applyProbeHit(hit);
    const move = (e) => {
      this.raycaster.setFromCamera(this._ndc(e), this.camera);
      const h = this.raycaster.intersectObjects(this.outers, false)[0];
      if (h) this._applyProbeHit(h);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  _applyProbeHit(hit) {
    const p = hit.point;
    if (this.kind === 'cyl') this.setProbe(p.x / HALF, Math.atan2(p.z, p.y));
    else this.setProbe(Math.asin(Math.max(-1, Math.min(1, p.y / p.length()))), Math.atan2(p.z, p.x));
  }

  // ------------------------------------------------------------ ループ

  _animate() {
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      if (!this.active) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
}
