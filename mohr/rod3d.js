// 丸棒の 3D 表示（three.js）。
//  - 円筒側面＋断面円板に頂点カラーで応力コンターを描く
//  - 一部を輪切りに抜いて断面を見せる（抜く位置はドラッグで移動）
//  - 軸力 N・曲げモーメント M・ねじりモーメント T のグリフを掴んでドラッグすると大きさが変わる
//  - 棒の上をドラッグするとその点の応力を取り出す（モールの応力円用）
//
// 応力の計算そのものは stress.js に閉じている（この単元は Pyodide を使わない。
// 理由は CLAUDE.md の mohr/ の節を参照）。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sectionProps, fieldByKey, rawFieldValue, colorAt } from './stress.js';

// ---------------------------------------------------------------- カラーLUT
// three.js は頂点カラーをリニア色空間として扱うので、sRGB のカラーマップを
// あらかじめリニアへ変換したテーブルにしておく（毎頂点で変換すると重いため）。
const LUT_N = 256;

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function buildLut(diverging) {
  const lut = new Float32Array(LUT_N * 3);
  for (let i = 0; i < LUT_N; i++) {
    const rgb = colorAt(i / (LUT_N - 1), diverging);
    lut[i * 3] = srgbToLinear(rgb[0]);
    lut[i * 3 + 1] = srgbToLinear(rgb[1]);
    lut[i * 3 + 2] = srgbToLinear(rgb[2]);
  }
  return lut;
}

const LUT = { div: buildLut(true), seq: buildLut(false) };

// ---------------------------------------------------------------- ジオメトリ

/** 円筒側面。u（0..1, 軸方向）と a（周方向角）をパラメータとして保持する。 */
function makeLateral(nu, na) {
  const nv = (nu + 1) * (na + 1);
  const position = new Float32Array(nv * 3);
  const normal = new Float32Array(nv * 3);
  const color = new Float32Array(nv * 3);
  const pu = new Float32Array(nv);
  const pa = new Float32Array(nv);
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= na; j++) {
      const k = i * (na + 1) + j;
      const a = (j / na) * Math.PI * 2;
      pu[k] = i / nu;
      pa[k] = a;
      normal[k * 3] = 0;
      normal[k * 3 + 1] = Math.cos(a);
      normal[k * 3 + 2] = Math.sin(a);
    }
  }
  const idx = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < na; j++) {
      const a0 = i * (na + 1) + j;
      const b0 = a0 + na + 1;
      idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setIndex(idx);
  return { geometry: g, pu, pa, pr: null, kind: 'lateral' };
}

/** 断面（円板）。r と a をパラメータとして保持する。 */
function makeDisk(nr, na, sign) {
  const nv = (nr + 1) * (na + 1);
  const position = new Float32Array(nv * 3);
  const normal = new Float32Array(nv * 3);
  const color = new Float32Array(nv * 3);
  const pr = new Float32Array(nv);
  const pa = new Float32Array(nv);
  for (let i = 0; i <= nr; i++) {
    for (let j = 0; j <= na; j++) {
      const k = i * (na + 1) + j;
      pr[k] = i / nr;
      pa[k] = (j / na) * Math.PI * 2;
      normal[k * 3] = sign;
    }
  }
  const idx = [];
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < na; j++) {
      const a0 = i * (na + 1) + j;
      const b0 = a0 + na + 1;
      idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setIndex(idx);
  return { geometry: g, pu: null, pa, pr, kind: 'disk' };
}

// ---------------------------------------------------------------- 矢印など

const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const UNIT_CONE = new THREE.ConeGeometry(1, 1, 20);
const UP = new THREE.Vector3(0, 1, 0);

/** from → to の矢印（Group を返す。以後は placeArrow() で使い回す）。 */
function makeArrow(color) {
  const mat = new THREE.MeshLambertMaterial({ color });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(UNIT_CYL, mat));
  g.add(new THREE.Mesh(UNIT_CONE, mat));
  return g;
}

/** 記号ラベル（x / θ / r）用のスプライト。常に正面を向き、棒の陰に隠れない。 */
function makeLabelSprite(text, color) {
  const px = 128;
  const cv = document.createElement('canvas');
  cv.width = px;
  cv.height = px;
  const g = cv.getContext('2d');
  g.font = 'italic bold 86px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 14;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255, 253, 247, 0.92)'; // 紙色のフチ（棒の上でも読めるように）
  g.strokeText(text, px / 2, px / 2);
  g.fillStyle = color;
  g.fillText(text, px / 2, px / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
  );
  sp.renderOrder = 20;
  return sp;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

function placeArrow(group, from, to, shaftR) {
  _v1.copy(to).sub(from);
  const len = _v1.length();
  if (len < 1e-6) {
    group.visible = false;
    return;
  }
  group.visible = true;
  _v1.normalize();
  _q.setFromUnitVectors(UP, _v1);
  const headLen = Math.min(len * 0.42, shaftR * 4.2);
  const headR = shaftR * 2.1;
  const shaft = group.children[0];
  const head = group.children[1];
  shaft.quaternion.copy(_q);
  shaft.scale.set(shaftR, Math.max(1e-4, len - headLen), shaftR);
  _v2.copy(_v1).multiplyScalar((len - headLen) / 2).add(from);
  shaft.position.copy(_v2);
  head.quaternion.copy(_q);
  head.scale.set(headR, headLen, headR);
  _v2.copy(_v1).multiplyScalar(len - headLen / 2).add(from);
  head.position.copy(_v2);
}

// ---------------------------------------------------------------- 本体

const DEFAULT_RANGES = { N: 120, M: 600, T: 600 };

export class RodScene {
  constructor(container, opts = {}) {
    this.container = container;
    this.onPick = opts.onPick || (() => {});
    this.onLoadsChange = opts.onLoadsChange || (() => {});
    this.onSectionChange = opts.onSectionChange || (() => {});
    this.ranges = opts.ranges || DEFAULT_RANGES;

    this.geom = { d: 50, L: 250 };
    this.loads = { N: 40, M: 260, T: 300 };
    this.fieldKey = 'sx';
    this.sectionT = 0.28; // 0..1（棒の左端からの相対位置）
    this.probe = null; // {x, r, a}
    // 図に収めるときの余白。ビューが小さいとカラーバー等のオーバーレイと
    // 棒が重なるので、スマホでは呼び出し側から大きめの値を入れる。
    this.fitMargin = 1.06;
    this.range = { min: 0, max: 0 };

    this._initThree();
    this._buildRod();
    this._buildGlyphs();
    this._buildProbe();
    this._bindPointer();
    this.rebuild();
    this._animate();
  }

  // ------------------------------------------------------------ 初期化

  _initThree() {
    const c = this.container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearAlpha(0);
    this.renderer.setSize(c.clientWidth || 600, c.clientHeight || 380, false);
    c.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1.6, 1, 20000);
    this.camera.position.set(260, 190, 420);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.85;
    this._userMoved = false;
    this.controls.addEventListener('start', () => { this._userMoved = true; });

    // three.js r155 以降は光の強度がそのまま放射照度になり、Lambert の BRDF で
    // 1/π されるため、カラーマップの色をほぼそのまま出すには π 倍相当の強さが要る
    // （弱いと図全体が暗くなり、カラーバーと色が合わなくなる）。
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
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // まだ一度も視点を動かしていないうちは、器の縦横比に合わせて収め直す
    if (!this._userMoved && this.parts) this.fitCamera();
  }

  // ------------------------------------------------------------ 棒の構築

  _buildRod() {
    this.rodMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.rodGroup = new THREE.Group();
    this.scene.add(this.rodGroup);

    this.parts = [
      { ...makeLateral(26, 88), role: 'latL' },
      { ...makeLateral(26, 88), role: 'latR' },
      { ...makeDisk(14, 88, 1), role: 'cutL' }, // 輪切りの左側の切断面（+x を向く）
      { ...makeDisk(14, 88, -1), role: 'cutR' }, // 輪切りの右側の切断面（-x を向く）
      { ...makeDisk(14, 88, -1), role: 'capL' }, // 棒の左端面
      { ...makeDisk(14, 88, 1), role: 'capR' }, // 棒の右端面
    ];
    this.pickTargets = [];
    for (const p of this.parts) {
      p.mesh = new THREE.Mesh(p.geometry, this.rodMat);
      p.mesh.userData.part = p;
      this.rodGroup.add(p.mesh);
      this.pickTargets.push(p.mesh);
    }

    // 断面の輪郭リング（見た目のアクセント）と、その掴み代
    const ringMat = new THREE.MeshLambertMaterial({ color: 0x1d2932 });
    this.sectionRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 64), ringMat);
    this.sectionRing.rotation.y = Math.PI / 2;
    this.rodGroup.add(this.sectionRing);
    this.sectionGrab = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.2, 6, 32),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    this.sectionGrab.rotation.y = Math.PI / 2;
    this.sectionGrab.userData.handle = { kind: 'section' };
    this.rodGroup.add(this.sectionGrab);
  }

  // ------------------------------------------------------------ グリフ

  _buildGlyphs() {
    this.glyphGroup = new THREE.Group();
    this.scene.add(this.glyphGroup);

    const C = { N: 0x245b8d, M: 0xef6a4b, T: 0x2f8f6f };
    this.glyphs = { N: [], M: [], T: [] };
    this.handles = [];

    for (const end of [-1, 1]) {
      // 軸力: 端面の中心から外向き（引張）/ 内向き（圧縮）の直線矢印
      const arrow = makeArrow(C.N);
      this.glyphGroup.add(arrow);
      this.glyphs.N.push({ arrow, end });

      // 曲げ・ねじり: 円弧矢印（弧の角度が大きさに対応）
      for (const kind of ['M', 'T']) {
        const mat = new THREE.MeshLambertMaterial({ color: C[kind] });
        const arc = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 40, 1), mat);
        const head = new THREE.Mesh(UNIT_CONE, mat);
        this.glyphGroup.add(arc, head);
        this.glyphs[kind].push({ arc, head, end, mat });
      }
    }

    // 掴み代（透明な球）。kind と end を userData に持たせる。
    for (const kind of ['N', 'M', 'T']) {
      for (const end of [-1, 1]) {
        const grab = new THREE.Mesh(
          new THREE.SphereGeometry(1, 12, 10),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
        );
        grab.userData.handle = { kind, end };
        this.glyphGroup.add(grab);
        this.handles.push(grab);
      }
    }
    this.handles.push(this.sectionGrab);
  }

  _buildProbe() {
    this.probeGroup = new THREE.Group();
    this.probeGroup.visible = false;
    this.scene.add(this.probeGroup);
    this.probeDot = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x1d2932 })
    );
    this.probeGroup.add(this.probeDot);
    this.probeAxes = {
      x: makeArrow(0xbd442c), // e_x
      t: makeArrow(0x2f8f6f), // e_θ
      r: makeArrow(0x245b8d), // e_r
    };
    for (const k in this.probeAxes) this.probeGroup.add(this.probeAxes[k]);
    this.probeLabels = {
      x: makeLabelSprite('x', '#bd442c'),
      t: makeLabelSprite('θ', '#2f8f6f'),
      r: makeLabelSprite('r', '#245b8d'),
    };
    for (const k in this.probeLabels) this.probeGroup.add(this.probeLabels[k]);
  }

  // ------------------------------------------------------------ 更新

  /** まとめて設定して 1 回だけ再構築する。 */
  set(partial) {
    let refit = false;
    if (partial.geom) {
      refit = Math.abs(partial.geom.L - this.geom.L) > 1e-6;
      this.geom = { ...partial.geom };
    }
    if (partial.loads) this.loads = { ...partial.loads };
    if (partial.field !== undefined) this.fieldKey = partial.field;
    if (partial.sectionT !== undefined) {
      this.sectionT = Math.min(0.88, Math.max(0.04, partial.sectionT));
    }
    this.rebuild();
    if (refit) this.fitCamera();
  }

  setSectionT(t) {
    this.sectionT = Math.min(0.88, Math.max(0.04, t));
    this.rebuild();
  }

  /** 断面の絶対位置 [mm]（棒の中心が 0）。 */
  get sectionX() {
    const L = this.geom.L;
    return -L / 2 + this.sectionT * L;
  }

  get gap() {
    return Math.max(this.geom.d * 0.7, this.geom.L * 0.085);
  }

  rebuild() {
    const sec = sectionProps(this.geom.d);
    const L = this.geom.L;
    const xs = this.sectionX;
    const gap = this.gap;
    const field = fieldByKey(this.fieldKey);
    const lut = field.diverging ? LUT.div : LUT.seq;
    const key = field.key;
    // 応力式の係数（ループ内でのオブジェクト生成を避けるため展開しておく）
    const kN = (this.loads.N * 1000) / sec.A;
    const kM = (this.loads.M * 1000) / sec.I;
    const kT = (this.loads.T * 1000) / sec.Ip;

    // --- 1回目: 位置を決めつつ場の値を求める
    const values = [];
    let vmin = Infinity;
    let vmax = -Infinity;
    for (const p of this.parts) {
      const pos = p.geometry.attributes.position.array;
      const n = pos.length / 3;
      const vals = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        let x, r, a;
        if (p.kind === 'lateral') {
          const u = p.pu[k];
          a = p.pa[k];
          r = sec.R;
          x = p.role === 'latL' ? -L / 2 + u * (xs + L / 2) : xs + gap + u * (L / 2 - xs - gap);
          pos[k * 3] = x;
          pos[k * 3 + 1] = r * Math.cos(a);
          pos[k * 3 + 2] = r * Math.sin(a);
        } else {
          a = p.pa[k];
          r = p.pr[k] * sec.R;
          x = p.role === 'cutL' ? xs : p.role === 'cutR' ? xs + gap : p.role === 'capL' ? -L / 2 : L / 2;
          pos[k * 3] = x;
          pos[k * 3 + 1] = r * Math.cos(a);
          pos[k * 3 + 2] = r * Math.sin(a);
        }
        const v = rawFieldValue(kN + kM * r * Math.cos(a), kT * r, key);
        vals[k] = v;
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
      }
      p.geometry.attributes.position.needsUpdate = true;
      p.geometry.computeBoundingSphere();
      values.push(vals);
    }

    // --- 表示レンジ（発散系は 0 を中心に対称、連続系は 0..max）
    if (!Number.isFinite(vmin)) { vmin = 0; vmax = 0; }
    let lo, hi;
    if (field.diverging) {
      const m = Math.max(Math.abs(vmin), Math.abs(vmax), 1e-6);
      lo = -m; hi = m;
    } else {
      lo = 0; hi = Math.max(vmax, 1e-6);
    }
    this.range = { min: lo, max: hi };

    // --- 2回目: 色
    const span = hi - lo || 1;
    for (let pi = 0; pi < this.parts.length; pi++) {
      const p = this.parts[pi];
      const col = p.geometry.attributes.color.array;
      const vals = values[pi];
      for (let k = 0; k < vals.length; k++) {
        let u = (vals[k] - lo) / span;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const i = (u * (LUT_N - 1) + 0.5) | 0;
        col[k * 3] = lut[i * 3];
        col[k * 3 + 1] = lut[i * 3 + 1];
        col[k * 3 + 2] = lut[i * 3 + 2];
      }
      p.geometry.attributes.color.needsUpdate = true;
    }

    // --- 断面リング
    this.sectionRing.scale.set(sec.R * 1.06, sec.R * 1.06, sec.R * 0.9);
    this.sectionRing.position.x = xs;
    this.sectionGrab.scale.set(sec.R * 1.06, sec.R * 1.06, sec.R * 1.6);
    this.sectionGrab.position.x = xs;

    // --- 探触点を新しい形状に追従させる
    if (this.probe) {
      if (this.probe.onSurface) this.probe.r = sec.R;
      else this.probe.x = xs;
      this.probe.r = Math.min(this.probe.r, sec.R);
      this.probe.x = Math.max(-L / 2, Math.min(L / 2, this.probe.x));
    }

    this._updateGlyphs(sec);
    this._updateProbeMarker(sec);
  }

  _updateGlyphs(sec) {
    const L = this.geom.L;
    const R = sec.R;
    const rg = this.ranges;

    // 軸力
    for (const g of this.glyphs.N) {
      const mag = Math.abs(this.loads.N) / rg.N;
      const len = L * (0.07 + 0.2 * mag);
      const base = g.end * (L / 2 + R * 0.3);
      // 引張なら棒から外向き、圧縮なら棒へ向かう矢印（両端とも同じ見え方になるよう
      // 「外側の点 tip」と「端面側の点 base」の順序だけを入れ替える）
      const tip = base + g.end * len;
      const outward = (this.loads.N || 0) >= 0;
      const from = new THREE.Vector3(outward ? base : tip, 0, 0);
      const to = new THREE.Vector3(outward ? tip : base, 0, 0);
      if (mag < 0.004) g.arrow.visible = false;
      else placeArrow(g.arrow, from, to, R * 0.13);
      g.grabPoint = new THREE.Vector3(base + (g.end * len) / 2, 0, 0);
      g.dirWorld = new THREE.Vector3(g.end, 0, 0); // ここを引くと N が増える向き
    }

    // 曲げ（z 軸まわり）とねじり（x 軸まわり）
    for (const kind of ['M', 'T']) {
      const val = this.loads[kind];
      const mag = Math.abs(val) / rg[kind];
      for (const g of this.glyphs[kind]) {
        // 両端で向きが逆（つり合い）
        const sign = Math.sign(val || 1) * g.end;
        const sweep = 0.35 + 3.0 * Math.min(1, mag);
        const radius = R * (kind === 'M' ? 2.5 : 1.75);
        const tube = R * 0.085;
        const cx = g.end * (L / 2 - R * (kind === 'M' ? 0.1 : 1.15));

        g.arc.geometry.dispose();
        g.arc.geometry = new THREE.TorusGeometry(radius, tube, 8, 48, sweep);
        g.arc.visible = mag > 0.004;
        g.head.visible = mag > 0.004;

        // 弧は既定で XY 面・+z 軸まわりに 0→sweep で描かれる。
        //   曲げ M : そのまま（z 軸まわり、棒を縦に曲げる面内）
        //   ねじり T: x 軸まわりへ倒す
        // どちらも「描き始めが手前側に来る」姿勢を選び、向きの反転は
        // 軸だけをひっくり返す（裏返すと弧が棒の陰に隠れて見えなくなるため）。
        // Euler(XYZ) の z 成分は弧の「自転」（どこから描き始めるか）になる。
        // 弧の中央が見やすい位置へ来るように spin を決める:
        //   M … 端面より外側へ張り出させる（内側だと棒に埋もれる）
        //   T … 棒の真上を通す
        let spin;
        if (kind === 'T') {
          g.arc.rotation.set(sign < 0 ? 0 : Math.PI, ((sign < 0 ? -1 : 1) * Math.PI) / 2, 0);
          spin = (sign < 0 ? Math.PI / 2 : -Math.PI / 2) - sweep / 2;
        } else {
          g.arc.rotation.set(sign < 0 ? Math.PI : 0, 0, 0);
          spin = (g.end > 0 ? 0 : Math.PI) - sweep / 2;
        }
        g.arc.rotation.z = spin;
        g.arc.position.set(cx, 0, 0);

        // 弧の先端に矢じり
        const endAng = sweep;
        const local = new THREE.Vector3(radius * Math.cos(endAng), radius * Math.sin(endAng), 0);
        const tan = new THREE.Vector3(-Math.sin(endAng), Math.cos(endAng), 0);
        local.applyEuler(g.arc.rotation).add(g.arc.position);
        tan.applyEuler(g.arc.rotation);
        g.head.scale.set(tube * 2.6, tube * 6, tube * 2.6);
        g.head.quaternion.setFromUnitVectors(UP, tan.clone().normalize());
        g.head.position.copy(local).add(tan.clone().multiplyScalar(tube * 3));

        // 掴み位置（弧の中ほど）と、そこを「押す」と値が増える向き
        const midAng = sweep * 0.55;
        const mid = new THREE.Vector3(radius * Math.cos(midAng), radius * Math.sin(midAng), 0)
          .applyEuler(g.arc.rotation)
          .add(g.arc.position);
        g.grabPoint = mid;
        const axis = kind === 'T' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
        axis.multiplyScalar(g.end); // 端ごとの向き
        const rel = mid.clone().sub(g.arc.position);
        g.dirWorld = axis.clone().cross(rel).normalize();
      }
    }

    // 掴み代の配置
    for (const grab of this.handles) {
      const h = grab.userData.handle;
      if (h.kind === 'section') continue;
      const g = this.glyphs[h.kind].find((q) => q.end === h.end);
      grab.position.copy(g.grabPoint);
      grab.scale.setScalar(R * 0.55);
      grab.userData.dirWorld = g.dirWorld;
      grab.userData.center = h.kind === 'N' ? null : g.arc.position.clone();
    }
  }

  _updateProbeMarker(sec) {
    if (!this.probe) {
      this.probeGroup.visible = false;
      return;
    }
    const { x, r, a } = this.probe;
    const R = sec.R;
    const p = new THREE.Vector3(x, r * Math.cos(a), r * Math.sin(a));
    this.probeGroup.visible = true;
    this.probeDot.position.copy(p);
    this.probeDot.scale.setScalar(R * 0.1);
    const ex = new THREE.Vector3(1, 0, 0);
    const er = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    const et = new THREE.Vector3(0, -Math.sin(a), Math.cos(a));
    const len = R * 1.05;
    placeArrow(this.probeAxes.x, p, p.clone().addScaledVector(ex, len), R * 0.05);
    placeArrow(this.probeAxes.t, p, p.clone().addScaledVector(et, len), R * 0.05);
    placeArrow(this.probeAxes.r, p, p.clone().addScaledVector(er, len * 0.75), R * 0.05);
    // 各軸の先に記号ラベル（x=軸方向, θ=周方向, r=半径方向）
    const lab = R * 0.72;
    this.probeLabels.x.scale.setScalar(lab);
    this.probeLabels.t.scale.setScalar(lab);
    this.probeLabels.r.scale.setScalar(lab);
    this.probeLabels.x.position.copy(p).addScaledVector(ex, len + lab * 0.6);
    this.probeLabels.t.position.copy(p).addScaledVector(et, len + lab * 0.6);
    this.probeLabels.r.position.copy(p).addScaledVector(er, len * 0.75 + lab * 0.6);
  }

  // ------------------------------------------------------------ カメラ

  fitCamera(reset = false) {
    const sec = sectionProps(this.geom.d);
    const L = this.geom.L;
    // 棒＋荷重グリフを包む円筒の代表点をサンプリングして、画面に収まる距離を求める。
    // 細長い形状なので外接球で合わせると余白が大きくなりすぎる。
    // 軸力矢印と、端面より外へ張り出す曲げの円弧のぶんを含める
    const axial = L / 2 + Math.max(sec.R * 2.55, L * 0.17);
    const radial = sec.R * 2.7;
    const pts = [];
    for (const x of [-axial, -L / 2, 0, L / 2, axial]) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        pts.push(new THREE.Vector3(x, radial * Math.cos(a), radial * Math.sin(a)));
      }
    }
    const dir = reset
      ? new THREE.Vector3(0.38, 0.30, 0.88).normalize()
      : this.camera.position.clone().sub(this.controls.target).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const vfov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 1.6;
    const tanV = Math.tan(vfov / 2);
    const tanH = tanV * aspect;
    let dist = 1;
    for (const p of pts) {
      const w = p.dot(dir);
      dist = Math.max(dist, Math.abs(p.dot(right)) / tanH + w, Math.abs(p.dot(up)) / tanV + w);
    }
    dist *= this.fitMargin;
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.multiplyScalar(dist));
    this.controls.minDistance = dist * 0.25;
    this.controls.maxDistance = dist * 3.2;
    this.controls.update();
  }

  resetView() {
    this._userMoved = false;
    this.fitCamera(true);
  }

  // ------------------------------------------------------------ 入力

  _ndc(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  /** ワールド方向ベクトルを画面上の向き（px, y は下向き正）に変換する。 */
  _screenDir(point, dirWorld) {
    const a = point.clone().project(this.camera);
    const b = point.clone().add(dirWorld.clone().multiplyScalar(this.geom.d * 0.2)).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(
      ((b.x - a.x) * rect.width) / 2,
      (-(b.y - a.y) * rect.height) / 2
    );
    if (v.length() < 1e-6) return new THREE.Vector2(0, -1);
    return v.normalize();
  }

  _bindPointer() {
    const el = this.container;
    // OrbitControls は canvas 側に listener を持つので、親要素のキャプチャ段階で
    // 先に判定し、こちらで処理するときだけ stopPropagation して奪う。
    el.addEventListener(
      'pointerdown',
      (ev) => {
        if (ev.button !== undefined && ev.button !== 0) return;
        const ndc = this._ndc(ev);
        this.raycaster.setFromCamera(ndc, this.camera);

        const hitHandle = this.raycaster.intersectObjects(this.handles, false)[0];
        if (hitHandle) {
          ev.stopPropagation();
          ev.preventDefault();
          this._startHandleDrag(ev, hitHandle.object);
          return;
        }
        const hitRod = this.raycaster.intersectObjects(this.pickTargets, false)[0];
        if (hitRod) {
          ev.stopPropagation();
          ev.preventDefault();
          this._startProbeDrag(ev, hitRod);
        }
        // それ以外（背景）は OrbitControls に任せる = 視点回転
      },
      true
    );
  }

  _startHandleDrag(ev, obj) {
    const h = obj.userData.handle;
    const start = { x: ev.clientX, y: ev.clientY };
    let dir2;
    let base;
    if (h.kind === 'section') {
      dir2 = this._screenDir(obj.position, new THREE.Vector3(1, 0, 0));
      base = this.sectionT;
    } else {
      dir2 = this._screenDir(obj.position, obj.userData.dirWorld);
      base = this.loads[h.kind];
    }
    const px = h.kind === 'section' ? 240 : 230; // このピクセル数で全レンジ分動く
    const span = h.kind === 'section' ? 1 : this.ranges[h.kind] * 2;

    const move = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const t = (dx * dir2.x + dy * dir2.y) / px;
      if (h.kind === 'section') {
        this.setSectionT(base + t * span);
        this.onSectionChange(this.sectionT);
      } else {
        const rgm = this.ranges[h.kind];
        const v = Math.min(rgm, Math.max(-rgm, base + t * span));
        this.loads[h.kind] = Math.round(v * 10) / 10;
        this.rebuild();
        this.onLoadsChange({ ...this.loads });
      }
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
      const h = this.raycaster.intersectObjects(this.pickTargets, false)[0];
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
    const sec = sectionProps(this.geom.d);
    const p = hit.point;
    const r = Math.min(sec.R, Math.hypot(p.y, p.z));
    const a = Math.atan2(p.z, p.y);
    this.probe = { x: p.x, r, a, onSurface: hit.object.userData.part.kind === 'lateral' };
    this._updateProbeMarker(sec);
    this.onPick(this.probe);
  }

  /** プログラムから探触点を設定（r は 0..R、a は rad）。 */
  setProbe(r, a) {
    const sec = sectionProps(this.geom.d);
    this.probe = { x: this.sectionX, r: Math.min(sec.R, r), a, onSurface: false };
    this._updateProbeMarker(sec);
    this.onPick(this.probe);
  }

  // ------------------------------------------------------------ ループ

  _animate() {
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
}
