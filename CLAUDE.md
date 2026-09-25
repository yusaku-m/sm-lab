# CLAUDE.md

`sm-lab` は、材料力学（`C:\Users\Yusaku\Documents\GitHub\Grading` の採点システム）で使っている
記号計算エンジン（`packages/quiz/Beam.py` 他）をブラウザ上でそのまま動かす、学生向けの学習ツール集。
各単元（梁・引張圧縮・ねじり・モールの応力円 等）ごとにサブフォルダを持つ**マンモス構成の
静的サイト1つ**として構築する（単元が増えてもリポジトリは分けない — 理由は下記）。

支点・荷重などの条件を自由に変えると、その場で再計算され、日本語の解説文（$...$ 数式込み）と
一緒に表示される。GitHub Pages で公開する想定（現時点では未公開・未pushのローカルリポジトリ）。
ビルドツールは使わない（plain HTML/JS、CDN読み込みのみ）。

## Grading リポジトリとの関係

**このリポジトリは Grading リポジトリの一部を意図的にコピーして作った別リポジトリ**（Gitの
共有履歴・submodule等は無い、単純な `cp`）。理由: `Grading` には週次問題バンク（`weekN.py` の
出題・正答生成ロジック）が含まれ、これを公開すると試験の公平性に関わるため、公開してよい
「汎用の力学エンジン部分」だけをこちらへ切り出した。

**vendoring している元ファイル**（`py/quiz_web/` 配下、`Grading/packages/quiz/` から）:
`Beam.py`, `BeamLibrary.py`, `Action.py`, `Material.py`, `SafetyFactor.py`, `CrossSection.py`
は **無改造でコピー**（`CrossSection.py` のみ冒頭の未使用 `import matplotlib.pyplot as plt` を削除）。

**例外（sm-lab側のみのローカルパッチ、Grading側には無い変更）**: `Beam.py` の
`_add_equilibrium_explanation`・`_add_reaction_results_explanation`（反力の解説）と
断面力V/M計算ループ（断面力の解説、`explanation_sectional_forces`）内の計7箇所で、
sympy式を `sp.latex()` でラップせず素のf-stringに埋め込んでいたバグ（`str()`が使われ
数式が`PL/4`や`L*P`のような一行・`*`表記になり、ブラウザのKaTeXで正しいTeX表示
（$\frac{}{}$・$\cdot$）にならなかった）を2026-07-17に修正済み（同ファイル内の他の
正しい箇所と同じ`sp.latex(sp.nsimplify(...))`パターンに揃えた）。
**同日、さらに追加で計8箇所を修正**: `_add_reaction_results_explanation`の
`reaction[0]`（支点反力シンボル自体）と、不静定梁（固定端2つ・3支点以上等）を
重ね合わせ法で解く分岐（`_add_reaction_results_explanation`内、`C_fixed_fixed`/
`S_fixed_fixed`/redundant-force法の3パターン）で使われる`R1`・`M1`・`M2`・`R_r_sym`
という**sympy Symbolオブジェクト自体**を、`sp.latex()`を通さずf-stringへ直接埋め込んで
いた箇所（`str(Symbol("M_R1"))`は`"M_R1"`になり、TeXとして`M_{R1}`ではなく`M`の
下付き文字`R`の直後に文字`1`が続く形に誤解釈される——単純支持・片持ち梁の検証時は
反力記号が`R_1`のような1文字下付きだったため`str()`と`sp.latex()`の出力が偶然一致し
見つからなかった。固定端2つ（fixed-fixed）や3支点連続梁など不静定梁で`M_R1`のような
2文字以上の下付き文字を持つ記号を使ったときにだけ表面化するバグだった）。
**Gradingから`Beam.py`を`cp`し直して再同期する際は、これら計15箇所の修正が上書きで
失われるため、修正前後の差分を見比べて再適用すること**（あるいはGrading側の
`Beam.py`にも同じ修正を先に取り込んでおくとよい）。
`Figure.py` だけは**別実装**（後述）。今後 引張圧縮・ねじり用に `Rod.py` 等を追加するときも同じ方針
（無改造コピー、必要なら未使用import等の削除のみ）で `py/quiz_web/` に足していく。

**Grading側を更新した後にこちらへ再同期する場合**、上記ファイルを Grading から `cp` し直すだけでよい
（`CrossSection.py` は matplotlib import の削除を再度行うこと）。`Figure.py` は独自実装なので
Grading側の変更を追う必要はない（Grading の `Figure.py`/`Equation.py` はPDF出力専用でこちらでは使わない）。

Grading側の設計知識（`Beam`/`CrossSection`/`Action`/`Material` の単位系・プロパティの型など）は
`Grading/packages/quiz/CLAUDE.md` と `Grading/packages/CLAUDE.md` に詳しい。挙動に疑問があれば
まずそちらを参照する（例: `reaction_forces` の単位はN/Nm、`ConcentratedLoad.magnitude`はkN等）。

## なぜ単元ごとにリポジトリを分けないか

`CrossSection.py`/`Material.py`/`Action.py`/`SafetyFactor.py` は梁だけでなく引張圧縮・ねじりでも
共通のエンジンなので、リポジトリを分けるとGrading側からの再同期をN回繰り返す羽目になる。
Pyodide起動（module worker）・KaTeX数式オーバーレイ・デバウンス入力等のJS側の骨組みも単元間で
使い回せる。GitHub Pagesは1リポジトリ内でサブフォルダごとに複数ページを持てるので、学生に配る
URLも1つで済む（2026-07-17、ユーザーと相談の上この方針に決定。リポジトリ名を `beam-lab` から
`sm-lab` へ変更）。

## 構成

```
index.html        # トップページ（単元一覧）。common/style.cssを読み込むだけ
common/
  style.css        # 全単元共通スタイル。新しい単元を追加するときはこれを読み込むだけで見た目が揃う
py/
  quiz_web/        # 全単元共通の力学エンジン（Gradingからvendoring、無改造コピー。詳細は上記）
    __init__.py
    Beam.py, BeamLibrary.py, Action.py, Material.py, SafetyFactor.py, CrossSection.py
    Figure.py       # ブラウザ向け軽量版（新規実装、下記）
beam/               # 「梁」単元（Phase 1 実装済み）
  index.html         # UI本体。KaTeX(CDN)読み込み、common/style.css・app.js/worker.jsを読み込むだけ
  app.js             # 支点・荷重の自由配置エディタ、Workerとの通信、SVG+KaTeXオーバーレイ描画
  worker.js          # Web Worker。Pyodide起動、../py/quiz_webを仮想FSへ展開、bridge.py実行
  bridge.py          # Worker内Pythonのエントリポイント。compute_beam(json)->json（梁専用）
mohr/               # 「モールの応力円」単元（下記の通り beam/ とは構成が違う。Pyodideを使わない）
  index.html         # importmapでthree.js、CDNでKaTeX。style.css（この単元専用）を読む
  style.css          # mohr/専用テーマ。common/style.cssは読まない
  stress.js          # 応力の計算（純粋関数のみ、DOM非依存）
  rod3d.js           # three.jsのシーン（丸棒のコンター・荷重グリフ・ドラッグ・点の拾い上げ）
  mohr2d.js          # モールの応力円と応力要素のSVG描画
  app.js             # 状態と配線
moment/             # 「モーメントのつり合い」単元（mohr/ と同じくPyodide不使用・common/style.css不使用）
  index.html         # CDNでKaTeX・qrcode-svg。style.css（mohr/と同じテーマ）を読む
  style.css          # mohr/style.css の配色・カード・フォームを写した自己完結テーマ
  model.js           # モーメント・合力・吸着・式(TeX)の組み立て（純粋関数、DOM非依存）
  figure.js          # SVG描画＋KaTeXラベルのオーバーレイ＋ドラッグ操作
  app.js             # 状態・荷重一覧・式の表示・アニメーション・URLハッシュ/QR
```

**今後 単元を追加するとき**（引張圧縮=`axial/`、ねじり=`torsion/`、モールの応力円=`mohr/` 等）:
- `beam/` と同じ4点セット（`index.html`/`app.js`/`worker.js`/`bridge.py`）を新フォルダに作る
- `worker.js`の`../py/quiz_web/`参照・`common/style.css`参照は`beam/`のものをそのまま踏襲できる
  （相対パスの深さが同じなら）
- `py/quiz_web/`に新しく必要なモジュール（`Rod.py`等）をGradingから無改造vendoringする
- ルートの`index.html`の`.unit-list`に新しいunit-cardを追加してリンクする
- **JS側の共通処理**（Pyodideのworker起動・KaTeXオーバーレイ描画・デバウンス）が2単元目以降で
  重複してきたら、そこで初めて`common/`にJSとして切り出す（1単元目の現時点ではまだ切り出して
  いない — 早すぎる抽象化を避けるため）
- **ただし`mohr/`はこの型に当てはまらない**（Pyodideも`common/style.css`も使っていない）。
  リアルタイムに動かす可視化中心の単元を足すときは`beam/`ではなく`mohr/`を雛形にするとよい。
  判断基準は「sympyの記号計算が要るか」「1操作ごとに再計算すれば足りるか（beam型）、それとも
  ドラッグ中に毎フレーム塗り直すか（mohr型）」。詳細は下記`mohr/`の節。

### `worker.js`（各単元フォルダ内）

- **module worker として読み込むこと（重要）**。`app.js` 側は
  `new Worker("worker.js", { type: "module" })` で生成しており、`worker.js` 冒頭も
  `import { loadPyodide } from ".../pyodide.mjs"`（静的import）を使っている。
  最近のPyodide（`pyodide.asm.mjs`がESモジュール）は **classic worker の `importScripts()` では
  読み込めない**（`type:"module"`を付け忘れる、または`importScripts(".../pyodide.js")`に戻すと、
  ブラウザ上で `Uncaught NetworkError: Failed to execute 'importScripts' ... failed to load` に
  なる。2026-07-17に実機で発生・原因特定・module worker化で解決済み。ローカルの検証用サンドボックス
  でも同じ症状が再現したため、一見「サンドボックス固有のネットワーク制限」に見えたが、実際は
  Pyodideバージョンの仕様変更が原因だった——同じ症状が出ても真っ先にこれを疑うこと）。
- Pyodide本体・`numpy`/`sympy`/`svgwrite` を CDN (`cdn.jsdelivr.net/pyodide/vX.Y.Z/full/`) から取得。
  **バージョンは冒頭の `import` 文のURLと `PYODIDE_INDEX_URL` 定数の両方に書いてある**（`import`文は
  静的文字列である必要があり定数から組み立てられないため、2箇所を揃えて書き換える）。現在 `v314.0.2`
  （pyodideは2026年に0.29.x系から314.x系へバージョニング方式が変わった）。変更する際はCDN上の実在を
  必ず確認すること — `curl -I https://cdn.jsdelivr.net/pyodide/vX.Y.Z/full/pyodide.mjs` で200を確認、
  `pyodide-lock.json` に必要パッケージ（`numpy`/`sympy`/`svgwrite`等）が含まれるかも確認。
- `py/quiz_web/*.py` を `fetch()` して Pyodide の仮想FS（`/home/pyodide/quiz_web/`）へ書き込み、
  `sys.path` に `/home/pyodide` を追加してから `import quiz_web.Beam` 等が通るようにする
  （相対import `from .Figure import Figure` を壊さないため、パッケージとして配置する必要がある）。
  **fetchのパスは単元フォルダから見て一つ上の`py/quiz_web/`を指す**（`beam/worker.js`なら
  `../py/quiz_web/${filename}`）。`bridge.py`は同じ単元フォルダ内にあるので`"bridge.py"`のまま。
- メインスレッドから `{id, config}` を受け取り、`compute_beam(json)` を呼んで結果をJSONで返す。
  **すべての計算はWorker内で行う**（sympyの重い記号計算でUIスレッドをブロックしないため）。

### `beam/bridge.py`

`compute_beam(config_json)` が唯一のエントリポイント。処理の流れ:
1. JSON設定から `Action.*`（集中荷重/集中モーメント/分布荷重）・`CrossSection.*`・`Material.*` の
   インスタンスを組み立て、`Beam.Beam(...)` を構築
2. `beam.figure` / `beam.reaction_forces` / `beam.explanation_reaction_forces` /
   `beam.shear_force_diagram` / `beam.bending_moment_diagram` /
   `beam.explanation_sectional_forces` / `beam.maximum_shear_force` /
   `beam.maximum_bending_moment` にアクセスし、`_to_jsonable()` でJSON化して返す
   （**Phase 1スコープ**。たわみ・応力・断面係数はまだ呼んでいない — 下記「今後の拡張」参照）
3. 例外は全部 `try/except` で捕まえて `{"ok": false, "message": ...}` を返す
   （UIはtracebackでなく日本語の簡潔なエラーを出す設計）

`_to_jsonable(v)`: sympy式で数値評価できるものは`float`に、できないもの（`P`や`L`を含む式）は
`{"__latex__": sympy.latex(v)}` に変換する汎用ヘルパー。個々のプロパティの正確なタプル構造を
把握しきっていない状態でも安全にJSON化できるようにするための設計（Beam.pyは3500行超あり、
全プロパティの内部shapeを事前に完全把握するのは非現実的）。他の単元の`bridge.py`を書くときも
この関数はそのまま使い回せる。

`explanation_*` はBeam.py側で既に `$...$` インライン数式込みの日本語文字列（リスト）として
生成されているので、**そのままJSONへ通すだけ**でよい（フロント側でKaTeXのauto-renderに渡す）。

### `py/quiz_web/Figure.py`（新規実装・要注意・全単元共通）

元の `Grading/packages/quiz/Figure.py` は reportlab/svglib/matplotlib(`Equation.py`経由) に依存した
PDF埋め込み専用の重い経路を持つが、これは **SVG生成そのものには不要**（Beam.py/CrossSection.pyの
`generate_figure()`系はSVG描画プリミティブしか呼んでいない）。そのためここでは:

- `line/rect/circle/polygon/text/draw_arrow/draw_force/draw_moment/draw_distributed_load/
  draw_fixed_support/draw_pin_support/draw_roller_support` 等はほぼそのまま移植（float型強制の
  ラッパー等も含め元と同じ挙動）
- `draw_equation()` だけ全面差し替え: 元は matplotlib で数式を画像化して `_equations` に積んでいたが、
  ここでは `sympy.sympify()`→`sympy.latex()` だけ行い `(latex文字列, position, fill, valign, halign)`
  を `_equations` に積む。実際の数式レンダリングは**しない**（ブラウザ側でKaTeXが行う）。
  `symbol_map`（E, r, R, N, DeltaL等の特殊シンボル）は元の `Equation.py` から転記したもの
  ——数式の見た目（$P$ が斜体になる等）を変えないため。
- `embed_to_pdf` は削除（不要）。フォント登録（Meiryo）も削除（ブラウザはCSSの`font-family`で
  日本語フォントを解決する。`common/style.css`のbody `font-family`参照）。
- `equations_as_list()` は `_equations` をJSONで送りやすい `dict` のリストに変換するヘルパー
  （各単元の`app.js`側の `renderFigure()` が読む）。

**Beam.pyやCrossSection.pyを新しく書き換えた場合、あるいは新しい単元（Rod.py等）を追加した場合**、
そこで使われている `Figure` のメソッドがここに実装済みかを必ず確認すること。実装漏れがあると
`AttributeError` がWorker内で発生し、`bridge.py`のtry/exceptで捕まって
`{"ok": false, "message": "... object has no attribute ..."}` が返る（tracebackはPython側の
`traceback.format_exc()` で `result.traceback` に入っているので、デバッグ時はJSON全体をブラウザの
consoleやNetwork/console.logで確認するとよい）。

### `mohr/`（モールの応力円。2026-09-18 実装、beam/ とは別構成）

**この単元だけ Pyodide を使わない**（`worker.js`/`bridge.py` が無く、`py/quiz_web/` も参照しない）。
理由: 丸棒に「軸力 N ＋ 両端の曲げモーメント M ＋ ねじりモーメント T」を与えたときの応力は
閉じた式で書けて sympy が要らない一方、UI 側の要件が「荷重の矢印を掴んでドラッグしながら
コンターを塗り直す」「1万点超の頂点カラーを毎フレーム更新する」なので、Worker 越しの記号計算
（`beam/` は 400ms デバウンス）では成立しないため。計算は全部素の JS（`stress.js`）に閉じている。

**この単元だけ `common/style.css` も読まない**。参照サイト
（<https://d-kitamura.github.io/linear-algebra-visual-lab/>）風のテーマ
（地 `#f4f1e9` / 紙 `#fffdf7` / インク `#1d2932` / アクセント `#ef6a4b`、Georgia 系の見出し、
角丸の大きなカード）を `mohr/style.css` に自己完結で書いてある。`beam/` の見た目・座標系には
一切影響しない（2026-09-18、ユーザーと相談のうえ「mohr/ だけに新テーマ」で決定）。
ダークモード非対応（`color-scheme: light only`）の方針は `common/style.css` と同じ。

#### 力学モデル（`stress.js`）

座標系は円筒座標で **x=軸方向、y=周方向、r=半径方向**。断面内の点は極座標 `(r, a)` で表す
（a は断面の上側 +y から測った角度）。単位は P を kN、M/T を N·m、寸法を mm で受け取り、
応力は MPa で返す。

```
A = πd²/4,  I = πd⁴/64,  Ip = πd⁴/32
σx  = P/A - M·(r cos a)/I      ← 曲げの項の符号に注意（下記）
τxy = T·r/Ip
σy = σr = τyr = τrx = 0      ← 内圧などが無いので恒等的に 0
```

**曲げの項がマイナスなのは、3D図に描いているモーメントの向きに合わせるため**。図では棒の
+x 端に `+M z`（右ねじ）の偶力を描いている。断面の釣り合いから `M_ext,z = -∫ y·σx dA` なので、
この向きに対応する応力分布は `σx = -M·y/I` になる（M>0 で下側が引張＝サギング）。
2026-09-18 まで `+M·y/I` にしていて、**図の曲げの向きと引張・圧縮の側が逆になっていた**
（ユーザーの指摘で発覚。グリフ側ではなく応力式のほうを直した）。符号を触ったときは
「単純曲げ・M>0 で棒の下側が赤（引張）」を +z 方向から見て確認すること。

**周方向を θ ではなく y と呼ぶのは講義資料の表記に合わせるため**（2026-09-18、ユーザーの指示で
θ→y にリネーム）。このとき**曲げ応力の「中立軸からの高さ」に y を使うと新しい y 軸と衝突する**ので、
式でも `y` を使わず `r cos a` と書くことにした（`stressAt()` 内の変数名も `hb`）。
以後 θ という表記は主軸の向き `θp` にだけ残っている。
応力成分のキーは `{sx, sy, sr, txy}`（表示名 σx/σy/σr/τxy とそのまま対応）。

`τyr = τrx = 0` なので **r 方向がそのまま主方向**であり、x–y / y–r / r–x の 3 つの座標面が
そのまま 3 つのモールの円になる（`mohr2d.js` の `PLANES`、キーは `xy`/`yr`/`rx`。
チェックボックスで表示切替。y–r 面は常に原点の 1 点に潰れるが、それも
「一軸応力＋せん断」の理解につながるので出している）。

コンターの選択肢に `σθ`・`σr`（常に 0）を残しつつ `τxθ`・`τmax`・`σeq`（von Mises）・`σ1` も
足してあるのは、σθ/σr だけでは全部真っ白になって単元として成立しないため
（2026-09-18、ユーザーの「コンターはせん断応力に対応せねば」という指摘を受けて追加）。

コンター描画は 1 フレームに 1 万点以上評価するので、`analyze()`（オブジェクトを作る通常版）
ではなく `rawFieldValue(sx, txy, key)`（σθ=σr=0 前提・アロケーション無し）を使う。

#### three.js まわりの注意（ハマりどころ）

- バージョンは `index.html` の importmap に **2 箇所**（`three` と `three/addons/`）書いてある。
  変更するときは両方を揃える（`beam/worker.js` の Pyodide と同じ話）。現在 `0.180.0`。
  実在確認は `curl -I https://cdn.jsdelivr.net/npm/three@X.Y.Z/build/three.module.js`。
- **ライトの強度を大きめ（AmbientLight 2.3 など）にしてあるのは意図的**。three.js r155 で
  `useLegacyLights` が廃止され intensity がそのまま放射照度になったため、Lambert の BRDF で
  1/π されるぶんを見込まないと図全体が暗い茶色になり、カラーバーと色が合わなくなる。
  **「コンターが暗い／カラーバーと色が違う」ときは真っ先にここを疑う**（2026-09-18 に実際に発生。
  一見カラーマップ側のせいに見えたが原因はライト強度だった）。
- **頂点カラーはリニア色空間として扱われる**。`stress.js` のカラーマップは sRGB なので、
  `rod3d.js` の冒頭で sRGB→リニア変換済みの 256 段 LUT を作ってそれを引いている。
- 掴み代（透明メッシュ）は `material.visible = false` ではなく `transparent + opacity: 0` に
  してある（`visible:false` だとレイキャストされるかがバージョン依存になるため）。
- 円弧グリフ（曲げ・ねじり）は `TorusGeometry` の `arc` 引数で大きさを表している。
  Euler(XYZ) の **z 成分が「弧の描き始め位置」**になるので、それを使って弧の中央を見える側
  （M は端面より外側、T は棒の真上）へ持ってきている。ここを 0 にすると弧が棒の陰に入って
  ほとんど見えなくなる（2026-09-18 に発生）。向きの反転は「弧の面を裏返す」のではなく
  「回転軸だけを反転する」こと（裏返すとやはり陰に入る）。
- カメラのフィットは外接球ではなく、代表点を実際にカメラへ投影して収める方式。細長い棒を
  外接球で合わせると余白だらけになるため。荷重グリフの張り出しぶんも `axial`/`radial` に
  含めること（含め忘れると円弧が画面外に出る）。

#### 画面構成（PCは2列、スマホは1画面に詰める）

ページ冒頭の説明文（`.site-head .lede`）は**幅制限を付けないこと**。`max-width: 62ch` を
付けていたらパネルの幅を使い切らず3行になって縦を無駄にしていた（2026-09-18にユーザーから指摘）。
文章は 1280px 幅で1行に収まる長さ（全角78文字程度）に抑えてある。長さを変えたら
`.lede` の `height / line-height` を数えて行数を確かめること。

カードは4枚: `rod-card` / `mohr-card` / `controls-card` / `notes-card`。
PCは2列（`grid-template-areas` が `rod|mohr` / `ctrl|mohr` / `notes notes`）。
**φスライダー・応力要素の図・成分表は`mohr-card`の中**（円の真下）に置いてある
——一度これを別カード（`detail-card`）に切り出したが、PCの見た目が崩れるのでユーザーの指示で
元に戻した（2026-09-18）。スマホでは1列で `mohr → rod → ctrl → notes` の順。

**スマホ（`@media (max-width: 760px)`、style.cssの末尾）では、応力円・回転スライダー・
コンター図の3つが1画面に入るように以下を削る**（ユーザーの要望。数値は応力円の中に書いてある）:
- kicker と `.sub`（説明文）を非表示、カードのpadding・見出しを縮める
- **面の選択トグル（`.checks`）は非表示**。代わりに φ と 2φ の関係を1行だけ出す（`.phi-note`）
- **成分表（`.stress-table`）だけ非表示**。応力要素の図は`.rotate-area`のグリッドを組み替えて
  **φスライダーの左隣**に置いている（`"elem rot"`の横並び。PCは`"rot rot" / "elem tbl"`の2行）。
  円の隣に並べると円が小さくなりすぎるのでこの配置にした（2026-09-18、ユーザーの要望で
  一度消した要素図を復活させた経緯）。要素図も縮小されるので`renderElement(..., {fontScale})`で
  文字を2.1倍にし、はみ出さないよう`S`（viewBox）も少し広げている。
- 円は`25svh`、3D図（`.viewport`）は`21svh`（`svh`＝アドレスバーを除いた高さ。`vh`のフォールバック付き）。
  **棒は横長なので3D側を低くするほうが破綻しにくい**（円はラベルがあるので高さを優先する）
- コンター選択のツールバーを1行に固定（`nowrap`＋selectを可変幅に、ラベルは隠す）
- `.hint`は後半を隠す（`.hint-more`）、`.probe`は1行の短い表記に切り替える（`isCompact()`）
- 丸棒パネルに「単純引張／単純ねじり」を出す（`#presets-rod`。PCでは非表示）

**この媒体クエリはstyle.cssの一番最後に置くこと**。`.check .short { display: none }` のような
既定値が後方に書かれていると、先に書いた媒体クエリが上書きされてラベルが消える
（2026-09-18に実際に発生）。

ボタンのラベルは`<span class="long">`/`<span class="short">`の2本立てで、スマホだけ短い方を出す
（`.btn .long`/`.btn .short`）。丸棒パネルには「単純引張・単純曲げ・単純ねじり・応力円が最大の点へ」の
4つが並ぶので、短縮しないと360px幅で2行になって1画面に収まらない。

**細い列に入力行を入れるときの落とし穴**: グリッド項目の`min-width`は既定で`auto`（=min-content）、
かつ暗黙の`auto`トラックもmin-content未満には縮まないので、そのままだと中身が枠外へはみ出す。
`.field-row`に`grid-template-columns: minmax(0, 1fr)`、`.rotate-area > *`・`.field-head`・
`.field-inputs`に`min-width: 0`を入れてある（2026-09-18、360px幅でφの数値入力が枠外に出て発覚。
`card.scrollWidth - card.clientWidth`を見れば機械的に検出できる）。

カラーバーは`.viewport`の中に入れて絶対配置のオーバーレイにしてある（縦方向の場所を食わないため。
PCでも同じ見た目）。HTML上も`#viewport`の子要素なので、動かすときは位置関係に注意。
スマホでは**カラーバーを下・操作説明を上**に入れ替えている（上に置くと曲げの円弧と重なる）。
あわせて`rod.fitMargin`を1.26にして棒を少し小さく収め、オーバーレイと重ならないようにしている
（PCは1.06）。切り替えは`app.js`の`compactMq`（`matchMedia('(max-width: 760px)')`）。

応力円のラベルは、スマホではSVG全体が縮小表示されて読めなくなるので、
`renderCircles(..., {fontScale})` で**文字だけ1.45倍**にしている（余白 `ml`/`mb` も
`fontScale` に連動。面応力点のラベルは右半分では内側へ出して枠から出さないようにしてある）。
応力円の下端には `τmax / σeq / θp` を1行で焼き込んでいる（スマホで成分表を省略するため）。

確認は390×844と360×740で `.mohr-card` を `scrollIntoView` してから
`.rod-card` の `getBoundingClientRect().bottom <= window.innerHeight` を見ればよい。

#### 入力の取り合い（無限ループ防止）

- `app.js` → `rod3d.js` は `rod.set({geom, loads, field, sectionT})` で**まとめて1回**渡す
  （個別 setter を連打すると `rebuild()` が何度も走る）。
- 逆向き（3D図のドラッグ → UI）は `onLoadsChange` / `onSectionChange` / `onPick` コールバック。
  受け側は `update({fromScene: true})` として `rod.set()` を呼び返さない。
- `update()` は関数宣言で巻き上がるが `let` は巻き上がらない。`RodScene` の生成直後に
  `setProbe()` → `onPick` → `update()` が走るため、**`update()` が触る `let`（`updating`,
  `hashTimer`, `lastHash`）はすべてシーン生成より前に宣言しておくこと**
  （順序を戻すと `Cannot access 'X' before initialization` になる。2026-09-18に
  `hashTimer` で再発した）。
- そのため **`try` は `new RodScene(...)` だけを包み、生成後の初期化（`set`/`fitCamera`/
  `setProbe`）は `if (rod) { ... }` として try の外に出してある**。中に入れておくと、
  初期化中のただのバグが「WebGL を初期化できませんでした」という誤ったメッセージに化けて
  原因究明が遅れる（実際に2度やった）。デバッグ時は `#err` の中身と
  `page.on('pageerror')` の両方を見ること。
- OrbitControls は canvas に listener を張るので、**その親（`#viewport`）のキャプチャ段階**で
  先にレイキャストし、グリフ or 棒に当たったときだけ `stopPropagation()` して操作を奪っている。
  「背景のドラッグだけが視点回転」になるのはこのため。
- 断面（輪切り）の位置は、ユーザーの当初の要望は「上下ドラッグ」だったが、視点を自由に回せる
  3D では**棒の軸方向に沿ってドラッグ**する方が自然なのでそちらにしてある（スライダーもある）。

- デバッグ用に `window.__mohr = {state, rod, update}` を公開してある。ブラウザの console から
  `__mohr.state.loads` や `__mohr.rod.probe` を覗ける。

#### 設定の共有（URL ハッシュ＋QRコード）

設定は**URL のハッシュ**に載せてある（例
`#n=40&m=260&t=300&d=50&l=250&s=30&f=sx&p=xy&q=0&pr=25&pa=0`）。
クエリではなくハッシュなのは、サーバーを介さずそのまま共有・QR化できるから。
`app.js` の `buildHash()` / `applyHash()` が対応し、`update()` の最後で `syncHash()` が
**デバウンス（350ms）して `history.replaceState`** する（ドラッグ中に履歴を汚さないため）。
`hashchange` も拾うので、戻る/進む・URL直貼りでも設定が復元される。

**省略されたキーは既定に戻すこと**。`ax`（軸範囲）は固定のときだけ書き出すので、
`applyHash()` は `ax` が無ければ `mode:'auto'` に戻す。戻し忘れると、固定のURLを開いた後に
`ax` 無しのURLへ移っても固定のままになる（2026-09-18に総当たり検証で発覚）。

キー: `n`/`m`/`t`=荷重、`d`/`l`=寸法、`s`=輪切り位置[%]、`f`=コンターの種類、
`p`=表示する平面（`.`区切り、無しは`-`）、`q`=φ[deg]、`pr`/`pa`=探触点の r[mm] と a[deg]。
値は `applyHash()` 側でレンジにクランプするので、壊れたURLでも既定値で起動する。
**`f` と `p` の値は FIELDS / PLANES のキーそのもの**なので、キー名を変えると
既存のURLが読めなくなる（2026-09-18のθ→yリネームで `sz`→`sr`、`yz`/`zx`→`yr`/`rx` に
変えたが、公開直後で共有URLが出回る前だったので影響なしと判断した）。

共有UIは**ページ最下部の `<footer class="site-foot">`**。「現状QR」ボタン（`#share-toggle`）を
押すと、URLのテキスト欄＋コピーボタン＋QRコードが出る（2026-09-18、ユーザーの指示で
「荷重と寸法」パネルの末尾からここへ移動＋改名）。ボタンのラベルは開閉で変えず、
`aria-expanded` と `.btn[aria-expanded="true"]` の見た目で状態を示している。
スマホでは1画面に収める領域（応力円＋丸棒）より下なので、レイアウト計算には影響しない。
QRは `qrcode-svg`（CDN、18KB、`window.QRCode`、`.svg()`でSVG文字列）で作り、
**canvas で PNG に焼いて `<img>` として置く**（`svgToPngDataUrl()`）。インラインSVGだと
右クリックでブラウザの画像メニュー（画像をコピー／名前を付けて保存）が出ないため
（2026-09-18、ユーザーの要望）。表示は 224px、焼くのは 3 倍の 672px でスライドに貼っても粗くない。
**`padding` は必ず 4 以上にすること**（モジュール単位のクワイエットゾーン。QR規格が4モジュール
必要で、1 にしていたらカメラを向けても読めなかった。2026-09-18に実機で発覚）。色は白地・黒で
コントラストを最大にし、枠側（`.share-qr`）の `padding` は 0 にして SVG 自身の余白を使う。
検証は `jsqr`（CDN）でデコードできる——SVGをcanvasへ描いて `jsQR(data, w, h)` を通し、
`#share-url` の値と一致するか見る。90px に縮小しても読めることを確認済み。
クリップボードは `navigator.clipboard` が使えない環境向けに `execCommand('copy')` の保険つき。

**`index.html` の静的な入力欄の初期値には注意**: φ の `<input value="0">` は URL から復元した値で
上書きしないと表示だけ 0 のままになる（`boot()` で代入している。2026-09-18に実際に発生）。

#### 補助ボタン

- **「単純引張 / 単純曲げ / 単純ねじり」**（`app.js`の`PRESETS`）… 指定の荷重以外を 0 にする。
  残す側が 0 のときだけ既定値を入れる（ユーザーが決めた大きさを勝手に書き換えないため）。
  荷重パネル（`#presets`、3つ全部）と丸棒パネル（`#rod-actions`、引張とねじりの2つだけ・
  `.preset-mobile`でスマホのみ表示）の両方に置いてある。スマホでは荷重パネルが画面外なので
  手元にも要るという理由。`#rod-actions`には「応力円が最大の点へ」も入っていて、
  PCではこのボタンだけの行になる。
- **「応力円が最大の点へ」**（`app.js`の`maxCirclePoint()`、**丸棒パネルの`#rod-actions`にある**）
  … 3つの円のうち最大の直径
  σ1−σ3（= 2τmax）が最大になる点を探して探触点にする。**同じ大きさの円になる点が複数あるときは
  σ1 が大きいほう（引張側）を選ぶ**——純曲げだと上下で |σx| が等しく、単に先に見つかったほうを
  採ると圧縮側に着地する（2026-09-18、ユーザーの指摘で修正）。この応力状態では解析的に必ず
  r = R・a = 0 か π になるが、将来 x 方向に変化する応力を入れても壊れないよう素朴に走査している
  （r×a を 25×360 で約 9000 点、クリック時のみなので一瞬）。
- 場が全域 0 になる組合せ（例: 単純ねじりで σx を表示）では図が一様になって壊れて見えるので、
  カラーバーの見出しに「この荷重では全域 0」と出している（`renderColorbar()`）。

#### φ などの記号の字形（要注意）

**地の文やラベルに出る記号は `<span class="tex" data-tex="\phi">` として KaTeX で描いている**
（`app.js`の`renderTexSpans()`が起動時に一括描画）。理由: `--display-font`（Georgia）の斜体で
U+03C6 を出すと**上の縦線が無い筆記体型（`arphi`相当）**になり、数式カードの`\phi`や
sans体（Inter）の φ とは別の字に見えるため（2026-09-18にユーザーから指摘）。
KaTeXの`\phi`・Inter/Noto Sans の U+03C6 はどちらも**上の線がある直線型**なので、
`<em>`（Georgia斜体）をやめて KaTeX に寄せることで全部揃う。
**新しくラベルを足すときも、記号は `<em>` ではなく `data-tex` を使うこと**。
SVG内の文字（`2φ=60°`など）はKaTeXを使えないが、sans体なので直線型になり整合する。

#### 応力円の直径を掴んで回す

応力円の直径はドラッグで回せる（＝ φ が変わる）。`app.js` の `#mohr-plot` の `pointerdown` で、
円周から `max(22, r*0.45)` 以内を掴んだときだけ開始する。SVG は `update()` のたびに作り直されるので、
**掴んだ時点の DOM 要素ではなく `mohrDrag`（円の中心・半径・φ=0 の基準角。`renderCircles` が返す）
を見て角度を計算する**。クライアント座標→SVG ユーザー座標は `svg.getScreenCTM().inverse()`。
φ = (alpha0 − 現在の画面角) / 2。

- **スマホ（`isCompact()`）ではタッチのドラッグを無効**にしている。応力円が画面の大きな面積を
  占めるので、ここでスクロールを奪うと操作しづらい（φ はスライダーで変えられる）。
  `touch-action: none` も `@media (min-width: 761px)` に限定している。
- `setPhi()` は `update({ skipRod: true })` を使う。3D 図の頂点ジオメトリは作り直さないので、
  ドラッグ中に毎フレーム 1 万点超のジオメトリを作り直さずに済む（探触点の回した X–Y 軸だけは
  `update()` 内で毎回 `rod.setPhi()` を呼んで軽く更新している。上記「3D図中の記号ラベル」参照）。
- **スライダー・数値入力・URL(`q=`)の設定可能範囲は ±180°**（2026-09-24、ユーザーの依頼で
  ±90°から拡張）。sn/tauはcos2φ/sin2φなので物理的な周期は180°で、±90°を超える値は
  ±90°以内のどこかと同じ応力状態になる（冗長）が、**手入力・スライダーでは折り返さず
  そのまま±180°まで動かせる**ようにしてある（`setPhi()`はMath.min/maxで単純クランプ）。
  一方、**円の直径ドラッグ・「主応力の向きへ」「最大せん断の向きへ」ボタンは`wrap90()`で
  従来通り±90°に畳んでいる**——ドラッグは向きのない線（直径）を掴む操作なので、
  そもそも±90°を超える情報を持てない（180°回すと同じ直径に戻る）。ここを
  `wrap90()`の期間を360°に広げて「畳まない」ようにすると、`atan2`の分岐（±180°）を
  跨いだ瞬間にφが180°ジャンプする不具合が出るため、あえて直さないこと。

#### 応力円の軸範囲（自動 / 固定）

`state.axis = { mode: 'auto'|'fixed', sMin, sMax, tMax }`。自動は円に合わせて毎回スケールし直すが、
**固定にすると荷重を変えても目盛りが動かない**。これは「荷重の符号が変わるとき・大きさが変わる
ときに円がどう動くか」を見せるのに必要で、自動だと円の見かけの大きさが変わらず動きが伝わらない
（2026-09-18、ユーザーの要望）。UI は応力円カードの `.axis-ctrl`
（自動/固定のセレクト＋σの下限・上限＋τの±＋「いまの範囲を取り込む」）。
**スマホでは UI を出さない**（`.axis-ctrl { display: none }`）が、**URL で渡された値は効く**
（`ax=-120,120,120`）。授業で「この軸範囲で見せたい」URLを配れるようにするため。

実装で注意する点:
- 円が円に見えるよう縦横のスケールは常に等しい（`k` は 1 つ）。そのため固定範囲を素直に使うと
  片方が指定より広く映って「入力した値と目盛りが合わない」ことになる。これを避けるため、
  固定時は**プロット領域の高さ `ph`（と viewBox の `H`）を範囲の比に合わせて変える**。
  極端な比のときだけ `ph` を 130–620 に丸め、そのときは従来どおり両方が収まるよう縮む。
- 範囲外へ出た円・弦は `clipPath`（`#mohr-plot-clip`）で切る。「はみ出している」ことが
  分かるのが狙い。点・主応力のティック・ラベルは範囲内のときだけ描く（`inPlot()`）。
- `renderCircles()` は**実際に映った範囲を返す**。`app.js` の `shownAxis` がそれを覚えていて、
  「いまの範囲を取り込む」と自動→固定の切り替え時の初期値に使う（`roundAxis()` でキリのよい値へ）。

#### `hidden` 属性は author の display に負ける（要注意）

`[hidden] { display: none }` は UA スタイル由来なので、`.axis-fields { display: inline-flex }` の
ような author 側の `display` 指定があると**効かない**。このプロジェクトは `hidden` 属性で
出し入れする箇所が複数あるので、`style.css` の冒頭に
`[hidden] { display: none !important; }` を置いて確実に効かせている
（2026-09-18、軸範囲の入力欄が「自動」でも消えずに残っていて発覚。
`getComputedStyle(el).display` を見れば機械的に検出できる）。

#### ラベルの重なりは事後に実測して解消する（要注意）

応力円のラベルは**個別に位置を調整しない**。荷重・軸範囲・φ の組合せで重なり方が変わるので、
`mohr2d.js` の `avoidLabelOverlaps()` が **DOM に入れたあと `getBBox()` で実測して縦にずらす**。

- `data-fixed` … 動かさない（軸名・目盛り・下端のまとめ行）。当たり判定にだけ使う
- `data-nudge="<数字>"` … ずらしてよい。小さい順に置くので優先度になる
  （面応力点 1/2 → 主応力 10.. → 2φ 20）
- どうしても空きが無いものは `fill-opacity` を落とす（消すと値が読めないため）
- 左右は `clampLabelIntoView()` で viewBox 内へ寄せる（`text-anchor: middle` のラベルは
  アンカーを枠内に収めても半分はみ出すため）

**この仕組みがあるので、ラベルを足すときは `data-fixed` / `data-nudge` を付けるだけでよい。**
個別に座標を調整すると、この後処理と二重に効いて逆に崩れる。

あわせて手で直してある配置（`avoidLabelOverlaps` では直せないもの）:
- **τ の軸名はプロットの上へ左寄せ**。左マージンに置くと τ の目盛りと同じ列で重なり、
  右寄せにすると枠の外へ出る。そのぶん `mt`（上マージン）を `14 + 10*fs` に広げてある
- τ の目盛りラベルは枠の端に来ると角で σ 側の目盛りとぶつかるので、y を枠内へクランプ
- 同じ値の主応力はまとめて 1 つのラベルにする（`σ₂=σ₃=0.0`）
- 下端のまとめ行は `Math.min(F(10.5), 12.2)` で、他のラベルほど大きくしない（横に長いため）

検証は**総当たりでやること**: 荷重の符号・大きさ・軸範囲・φ・表示平面を組み合わせた
720 通りで「text 同士の bbox 交差 0 件」「viewBox 外へ出た text 0 件」を確認している
（`getBBox()` はクリップを考慮しないので、`g[clip-path]` 配下のラベルは除外して数える）。
2026-09-18、`#n=64&...&ax=-300,300,200` のような状態で 4 箇所重なっているとユーザーから指摘。

#### 応力円の 2φ の見せ方と τ 軸の向き

φ=0 の直径（基準）を**点線で残し**、回した直径を実線で描いて、その間に 2φ の円弧を出している。
「面をφ回すと円上の点は2φ動く」を図だけで読み取れるようにするため
（2026-09-18、ユーザーの要望で点線の基準線を追加）。

**縦軸 τ は下向きが正**（`Y = (t) => cy + t * k`）。こうすると**面を φ 回したとき円上の点が
同じ向き（反時計まわり）に 2φ 動く**——講義資料に合わせるためのユーザー指示（2026-09-18）。
τ を上向き正にすると点は逆（時計まわり）に動く。**値そのものは一切変えていない**ので、
ラベル・成分表・式に出る数字はテンソル成分のまま。軸名は正の側（プロット左下）に
`τ [MPa] ↓正` と置いてある（上に置くと正の向きと逆の位置に名前が来て紛らわしい）。

この向き替えのせいで、**y 座標を直接組み立てている箇所は `Y()` 経由に直す必要がある**。
2φ の円弧は画面座標の角度（`Math.atan2(Y(t)-Y(0), X(s)-X(c))`）から組み立て、
SVG の sweep フラグも角度差の符号から決めている。面応力点のラベルの上下も
`Y(pt.t) <= Y(0)` で判定している（`pt.t >= 0` で判定すると逆側に出る）。
検算は「φ を 0→20→40 と動かして、X面の点の画面上の角度が 2φ ぶん反時計まわりに動く」を見る。

#### 荷重の記号は P / M / T

3D図の荷重グリフには `P`（軸方向の荷重・青）・`M`（曲げ・橙）・`T`（ねじり・緑）のラベルを
両端に出している（`rod3d.js` の `_buildGlyphs()` の `SYM`）。**軸方向の荷重の表示記号は
講義資料に合わせて `N` ではなく `P`**（2026-09-18、ユーザーの指示）。入力欄のラベルも
`P 荷重（引張が正）`、応力の式も `σx = P/A + M r cos a / I` に揃えてある。

ただし**コード内のキーと URL のキーは `N` / `n` のまま**にしている。URL の `p` は
「表示する平面」に使っていて衝突するため（`state.loads.N`、`RANGES.N`、`#...&n=40&...`）。
記号だけ P、キーは N という食い違いなので、触るときはこの節を思い出すこと。

#### 3D図中の記号ラベル

微小要素（応力要素の図）の**回した座標系は大文字 X–Y**、破線のガイドが元の x–y 軸
（講義資料に合わせる。2026-09-18にユーザーの指示で `x′`/`y′` から変更）。応力円の面応力点も
`X面`/`Y面`、成分表も `σX（φ=..）`/`τXY（φ=..）` と揃えてある。

探触点の三面体（e_x / e_y / e_r の矢印）の先に `x` `y` `r` のラベルを出している。
**3軸とも黒（`#1d2932`）にすること**——以前は赤/緑/青にしていたが、荷重グリフ（P=青・M=橙・
T=緑）と色が被り、「軸と荷重が対応している」と誤解されるとユーザーから指摘があった
（2026-09-18）。微小要素の図とも直接対応しないので色分けする意味がない。実装は
canvas に描いた文字をテクスチャにした `THREE.Sprite`（`makeLabelSprite()`）。`depthTest: false` と
`renderOrder` で棒の陰に隠れないようにし、紙色のフチを付けて棒の上でも読めるようにしてある。
大きさは断面半径 R に比例（`R * 0.72`）させているので、寸法を変えても見た目の比率が変わらない。

**φ（応力要素の回転角）が 0 でないときだけ、回した X–Y 軸を紫/金で追加表示する**
（`RodScene.probeAxesRot`/`probeLabelsRot`、2026-09-24追加）。`ex`/`ey`（軸方向・周方向の
単位ベクトル）を`stress.js`の`rotated()`と同じ式（`cosφ`/`sinφ`、反時計まわりが正）で
回すだけなので、頂点ジオメトリは作り直さない——`RodScene.setPhi(phi)`が
`_updateProbeMarker()`を呼ぶだけの軽い処理で、`app.js`の`update()`から毎回呼んでいる
（φスライダーの`skipRod:true`とは独立——3D図の頂点は動かさないが、この軸だけは更新する）。
**色は応力要素の図（`mohr2d.js`のrenderElement、σX=橙赤`#bd442c`/σY=青`#245b8d`）とは
あえて揃えず、紫`#7d5ba6`/金`#b8860b`にしてある**——揃えると荷重グリフM（橙赤）・P（青）と
色が一致し、探触点のすぐ隣という近さも相まって「軸と荷重が対応している」という誤解を招く
（上記、x/y/rを黒一色にした理由と同じ問題が再発する）。φ=0では黒いx/yと重なるだけなので
非表示にしている（`Math.abs(phi) > 1e-4`）。

### `moment/`（モーメントのつり合い。2026-09-25 実装、mohr/ 型）

材力Ⅰ後期1週（Grading の `3ME_Strength_of_the_Material_I/2026/2nd/week1.py`、
`Rod.RodwithRotationCenter`）に合わせた単元。**回転中心 O の図は資料と同じく「丸を描いてから
棒の内側を白で塗り直す」膨らみ**（Grading の `RodwithRotationCenter.generate_figure()` と同じ描き方）。
O を掴むと丸が少し膨らむ。計算は「腕の長さ × 力の鉛直成分」の和だけなので sympy は不要、
ドラッグ中に毎回式を組み直すので Pyodide（400ms デバウンス）では遅い → mohr/ 型にした。

#### 約束（`model.js` 冒頭にも書いてある）

- 位置 `t` は L を 1 とした無次元量（左端 0）。力は kN、モーメントは kN·m（`Lm`=L[m] を掛ける）
- 荷重の向き `dir` は +x から反時計まわり [deg]（上向き 90、下向き −90）。
  UI・式では「上向き/下向き」＋「鉛直からの傾き θ（右へ倒すと正）」に分解して見せる
  （`decompose()`/`compose()`）。**資料（week1.py）が鉛直からの角度＋cos で書いているのに合わせた**
- モーメントは反時計まわり正。**L 表記**は「O からの距離 × P cos θ」を出して回す向きで符号を決める
  書き方、**x 表記**は `±P_i cos θ_i (x_i − x_O)`（符号は上向き＋/下向き−だけ、腕の符号は
  `x_i − x_O` が受け持つ）。どちらもユーザーの指示（「長さの記号は L, x が切替可能に」）
- 厳密な係数は `(n/d)·√s`（s=1,2,3）で持つ（`mulCoef`/`coefTex`）。分数に直せない位置
  （吸着しなかったとき）は小数に落ちる。吸着しなかった位置は L/200 刻みに丸めてある

#### 吸着（ユーザーの要望）

- 位置: L/2, L/3, L/4, L/5, L/10 の倍数（`SNAP_DENOMS`）。許容 10px、分母が小さいほど強く吸う
- 傾き: 0, π/6, π/4, π/3, π/2（`TILT_SNAPS`）。許容 ±5°、それ以外は 1° 刻み
- 矢印の先端は**まず上下だけ**（縦モード）。先端を作用点から横に 46px 以上引いたら
  そのドラッグ中は斜めモード（`OBLIQUE_DX`）。最初から斜めの荷重は斜めモードで始まる
- URL の小数（`0.333333`）は `exactFrac()` で分数の位置へ戻す（戻さないと `0.333L` 表記になる）

#### 荷重の種類を足すとき（分布荷重・集中モーメント）

`model.js` の `ACTION_TYPES` に `force(a)` / `momentAbout(a, tO)` / `terms(a, ctx)` / `symbol(i)` /
`create()` を実装した項目を足す。合計（`analyze()`・`sumLines()`）・アニメーション
（`accelerations()`）はこのインターフェースしか見ていない。あとは
- `figure.js` の `render()` 内 `if (a.type !== 'point') return;` の所に描き方と掴み代を足す
  （`_layout()`・`_dimRows()` も `point` だけ数えている）
- `app.js` の `TYPE_KEY`/`KEY_TYPE`（URL の略号）と `buildList()` の入力欄
- 記号の番号は種類ごとに 1 から（`symbolIndex()`）。集中モーメントを `M_i` にすると
  各荷重のモーメント `M_i` と衝突するので、記号は別（`C_i` や `ar{M}_i` 等）にすること

#### 図（`figure.js`）のハマりどころ

- viewBox は中身（矢印の先端・円弧・寸法線の段数・斜め荷重の垂線の足）に合わせて毎回決める
  （`_layout()`）。**ただしドラッグ中とアニメーション中は固定**。ドラッグ中に広げると、掴んでいる点の
  下で座標の対応がずれて矢印が勝手に伸び続け、一瞬で最大（20 kN）に張り付く
  （2026-09-25、「広げる方向だけ」でも起きた）。はみ出したぶんは `svg { overflow: visible }` で
  枠外に描き、離したときに収め直す
- 寸法線は棒の下で、**一番下まで伸びた下向き矢印よりさらに下**から始める（下向きの荷重は資料と同じく
  作用点から下へ描くので、寸法線と重なるため）
- 狭い画面（幅 600px 未満）では棒の長さ `LPX` を 660→400 にして、矢印・円弧・文字を相対的に
  大きくしている。あわせて掴み代を `hitScale` 倍に広げる（スマホで先端の丸が 5px しかなかった）
- ラベルは SVG に重ねた HTML（KaTeX）。位置は viewBox に対する百分率なので、
  `left`/`top` の計算に viewBox の `left`/`top` を引くのを忘れないこと
- 腕の長さの垂線は**選んでいる斜めの荷重だけ**。足が 320px より遠いときは描かない

#### アニメーション

「動かしてみる」は**動き始めの加速度のまま**（荷重の向き・大きさは空間に固定したまま）棒を動かす。
ピン: O まわりに `α = M_O / I_O`、自由体: 重心 G まわりに `α = M_G / I_G` ＋ 並進 `a = F/m`。
質量 m は「F = 10 kN で 1.4 s 後に 0.2L 動く」ように**可視化の都合で決めた値**（`MASS`）。
回転角・移動量は図の中に収まる範囲（`fig.animLimits()`）で止め、0.8 s 止めて繰り返す。

#### その他

- `app.js` 冒頭で `applyHash()` を呼ぶので、**そこで使う `const`（`TYPE_KEY`/`KEY_TYPE`）は
  その前に宣言すること**（後ろに置くと URL に荷重があるときだけ `Cannot access 'KEY_TYPE'
  before initialization` で落ちる。2026-09-25 に発生。mohr/ の `hashTimer` と同じ罠）
- URL: `#m=pin|free&n=L|x&L=<mm>&o=<t>&a=<種類>,<t>,<P>,<dir>;...&e=<各荷重の円弧>&v=<図に数値>`
- デバッグ用に `window.__moment = {state, update, fig, res}`

### `common/style.css`

全単元共通スタイル。**ダークモード非対応（意図的）**: `color-scheme: light only` を指定し、
`body`の`background`/`color`を明示的に白/黒固定している。理由: 図（SVG）が黒線・白背景前提で
描かれており、端末側のダーク設定に引っ張られると図が見えなくなる（2026-07-17、実際にユーザーの
端末で発生し確認・修正）。**新しい単元のCSSを書くときも、このファイルの前提を崩さないこと**
（個別に`prefers-color-scheme: dark`対応を入れると図が見えなくなる場合がある）。

各単元の`index.html`は`<link rel="stylesheet" href="../common/style.css">`で読み込む
（トップページの`index.html`だけ`common/style.css`、単元フォルダ内は`../common/style.css`）。

### `beam/app.js`

- 状態は `supports` / `loads` の配列（type + position 等）。UIから増減・編集する度に
  `scheduleCompute()`（400msデバウンス）→ `worker.postMessage({id, config})`。
- Workerからの結果は `id` で照合し、**古いリクエストの結果は無視**（速い連続操作で古い計算結果が
  後から返って表示が巻き戻るのを防ぐ）。
- 図（SVG）は `fig-wrap`（`position:relative`）にそのまま挿入し、等倍（スケールなし）で表示。
  数式ラベルは `_equations` の `(x,y)` をそのまま`left`/`top`（px）にして絶対配置した
  `<span>` にKaTeXでレンダリング（`halign=center`→`translateX(-50%)`、
  `valign=center/bottom`→`translateY(-50%/-100%)`）。**SVGをCSSで拡大縮小する場合はこの座標系が
  崩れるので、スケールをかけるなら数式オーバーレイ側にも同じscaleを掛けること。**
- 解説文（`explanation_*`）は素朴に `<p>` へ入れてから `renderMathInElement`（KaTeX auto-render、
  delimiter `$...$`）を実行するだけ。追加パース不要（Beam.py側の文字列規約に乗っかっている）。

## 現在のスコープ

### `beam/`（Phase 1）

- 支点・荷重の完全自由配置（pin/roller/fixed、集中荷重/集中モーメント/分布荷重）
- 出力: 梁図、反力（値＋解説）、SFD、BMD（値＋解説）
- 断面・材料は `bridge.py` 内の固定デフォルト（矩形100×200mm・軟鋼）— UIには出していない

### `mohr/`（2026-09-18 実装済み）

- 丸棒＋軸力 N / 両端曲げ M / ねじり T。スライダー・数値入力・3D図の矢印ドラッグで変更
- コンター: σx / σθ / σr / τxθ / σ1 / τmax / σeq（von Mises）をドロップダウンで切替
- 一部を輪切りに抜いて断面のコンターを表示。輪切り位置は軸に沿ってドラッグ（またはスライダー）
- 棒の上をドラッグすると探触点が動き、その点のモールの応力円（既定は x–θ 面、
  チェックボックスで残り2面）・回転角 φ の応力要素図・応力成分の一覧が更新される
- 材料定数は使っていない（応力までしか出さないので E・ν が不要）

## 今後の拡張

**Phase 2（`beam/`の機能拡張、未着手）**
- たわみ角・たわみ（`beam.slope` / `beam.deflection` / `beam.explanation_deflection` /
  `beam.figure_slope` / `beam.figure_deflection` / `beam.maximum_slope` / `beam.maximum_deflection`）
- 曲げ応力分布・断面係数・断面二次モーメント・重心の解説（`beam.top_stress` / `bottom_stress` /
  `explanation_stress` / `cross_section.explanation_centroid` / `explanation_moment_of_inertia` /
  `explanation_section_modulus`）
- 断面形状（Rectangle/Circle/HollowCircle/HollowRectangle/Triangle）・材料のUI選択
  （`bridge.py`の`_CROSS_SECTION_BUILDERS`に形状を追加するだけで済むはず）

`bridge.py`の`compute_beam()`にキーを追加し、`app.js`の`renderResult()`に対応する描画を足す形で
段階的に拡張していく想定。

**Phase 3（新規単元）**
- `mohr/`（モールの応力円）… **実装済み**（ルートの`index.html`のunit-cardもリンク済み）
- `moment/`（モーメントのつり合い）… **実装済み**（集中荷重のみ。分布荷重・集中モーメントは
  `ACTION_TYPES` に足す想定。上記`moment/`の節）
- `axial/`（引張・圧縮変形）、`torsion/`（ねじり変形）… 未着手。
  ルートの`index.html`の該当unit-cardの`disabled`クラスを外してリンクを有効化する
- `mohr/`の今後の拡張余地: x 方向に変化する応力分布（現在は全長で一定なので輪切り位置を
  動かしても値は変わらない。`stress.js` の `stressAt()` は既に x を引数に取ってある）、
  ひずみ・主ひずみ、降伏条件（Tresca / von Mises）の可視化

## デバッグの勘所

1. **まずCPythonで疑う**: `py/` を `sys.path` に足して各単元の `bridge.py` を素のPython
   （Grading側のpixi環境に sympy/numpy/svgwrite が入っている）で直接呼ぶと、Pyodideを介さず
   高速に検証できる。
   ```python
   import sys; sys.path.insert(0, r"C:\Users\Yusaku\Documents\GitHub\sm-lab\py")
   sys.path.insert(0, r"C:\Users\Yusaku\Documents\GitHub\sm-lab\beam")
   import bridge, json
   print(bridge.compute_beam(json.dumps({
       "length": 1000,
       "supports": [{"type": "fixed", "position": 0}],
       "loads": [{"type": "point_load", "magnitude": 5, "position": 1}],
   })))
   ```
   反力・最大SFD/BMDの数値は手計算（片持ち梁: R=P, M=PL 等）と突き合わせて検証済み
   （2026-07-16、cantilever/simply-supported/fixed-fixed/2径間連続梁/UDLの5パターンで一致確認）。
   不安定な支点構成（例: ローラー1点のみ）は`sp.solve`内部で`TypeError`となり、
   `bridge.py`の`try/except`で正しく`{"ok": false}`に変換されることも確認済み。
2. **ローカルサーバーで実ブラウザ確認**: `python -m http.server` を `sm-lab` 直下（リポジトリ
   ルート）で起動し、`http://localhost:PORT/beam/index.html` のように単元フォルダを開く。
   `file://` 直開きはPyodideのfetchがCORSでブロックされるため不可。
3. **`Uncaught NetworkError: Failed to execute 'importScripts' ... failed to load` が出たら**:
   ほぼ確実に `worker.js` が classic worker として読み込まれている（`new Worker("worker.js")` に
   `{type:"module"}` が付いていない、または `worker.js` 側が `import` でなく `importScripts` に
   戻ってしまっている）。2026-07-17に実際にこのエラーで詰まり、原因はこれだった（詳細は上の
   `worker.js`の節）。**「CDNやネットワークの問題」と早合点しないこと**——開発中、Playwrightの
   自動検証でも同一エラーが再現し、一見「テスト環境のネットワーク制限」に見えたが、実際は
   Pyodideのバージョン仕様（module worker必須）が原因だった。まず`new Worker(...)`の
   第二引数と`worker.js`冒頭の`import`文を確認する。
4. **図が真っ黒/見えない、画面が意図せずダーク表示になる**: `common/style.css`の
   `color-scheme: light only` と`body`の`background`/`color`固定が外れていないか確認する
   （2026-07-17、端末のダークモード設定でこの問題が実際に発生した）。
5. Worker内のPythonエラーは `bridge.py` が `result.traceback`（フル traceback文字列）を返すので、
   ブラウザのconsoleで `JSON.parse(...)` した中身を見るとよい。
6. パス関連のエラー（`fetch failed: ...`）が出たら、単元フォルダの深さと`worker.js`内の
   相対パス（`../py/quiz_web/...`）が一致しているか確認する。
7. **ローカルでは動くのにGitHub Pagesでだけ特定のファイルが404する（特に`__init__.py`のような
   アンダースコア始まりのファイル）**: GitHub PagesはデフォルトでJekyllビルドを通しており、
   Jekyllは**アンダースコアで始まるファイル/フォルダをデフォルトで出力から除外する**
   （`_layouts`等の特殊フォルダ向けの挙動だが、任意のファイル名にも同様に適用される）。
   リポジトリ直下に `.nojekyll`（空ファイル）を置くとJekyll処理自体を無効化し、リポジトリの
   中身がそのまま配信されるようになる。2026-07-17、`py/quiz_web/__init__.py`だけが本番で404し、
   これが原因だった（ローカルの`python -m http.server`はJekyllを介さないため再現しなかった）。
8. **解説文中の分数（`\frac{}{}`）が潰れて/小さく詰まって表示される**: KaTeXは
   `displayMode: false`（インライン）で描画すると`\frac`を省スペースの`textstyle`で描くため、
   分子・分母が小さくなる。地の文（日本語の解説文）に埋め込む都合上インライン自体は必須なので、
   `displayMode`を変えるのではなく**描画直前に`\frac{`→`\dfrac{`へ文字列置換**して分数だけ
   displaystyle相当の大きさにする（`beam/app.js`の`useDisplayFrac()`）。`Beam.py`/`Figure.py`が
   生成するsympy由来のLaTeX文字列自体は無改造方針なので変更しない。2026-07-23に対応。
   `renderFigure`（図の数式オーバーレイ）・`renderExplanation`（解説文）・`appendMaxPair`
   （最大せん断力/曲げモーメント）の3箇所すべてで通す必要がある（1箇所でも忘れると
   そこだけ潰れたままになる）。他の単元を追加する際も同じ`useDisplayFrac`を流用できる
   （`common/`にJSを切り出すタイミングが来たらそこに含める）。
9. **claude-in-chrome拡張機能が使えず実ブラウザで見た目を確認できないとき**: `/chrome`は
   セッション途中で実行しても当該セッション内では有効化されない（新しいセッションが必要）。
   代わりに**Playwrightのヘッドレスブラウザで代替検証できる**——このマシンには`npm install`
   済みのグローバルパッケージとしてではなく、`npx`のキャッシュ経由でPlaywrightの実体
   （chromiumバイナリ込み）が既に存在している。手順:
   1. `find "$LOCALAPPDATA/npm-cache/_npx" -maxdepth 4 2>/dev/null | grep -i playwright`
      でキャッシュ内の`node_modules`パス（例: `.../_npx/<hash>/node_modules`）を特定する。
   2. `python -m http.server <port>` を`sm-lab`直下（リポジトリルート）でバックグラウンド起動
      （`file://`直開き不可なのは上記2.と同じ理由）。
   3. `require('playwright')`するNode.jsスクリプトを書き、実行時に
      `NODE_PATH="<上記node_modulesパス>"`を環境変数で渡す（`npm install`は不要、
      このリポジトリに`package.json`を足す必要もない）。
   4. スクリプト内では`page.on('console', ...)`と`page.on('pageerror', ...)`を必ず登録し、
      Pyodideロードや計算完了を`waitForSelector`/`waitForFunction`で待ってから
      `page.screenshot({fullPage:true})`。KaTeXの分数が潰れていないかは
      `document.querySelectorAll('.katex .mfrac').length`等DOM評価で機械的に検証もできるが、
      **最終的には必ずスクリーンショットを`Read`ツールで目視確認する**（DOM上のクラス名だけでは
      文字サイズの見た目までは保証できないため）。
   5. 検証後は`taskkill //F //IM python.exe`等でローカルサーバーを止める。
   2026-07-23、このやり方で分数表示修正（上記8.）を実ブラウザ相当の環境で検証済み
   （詳細は[[playwright-headless-browser-test-workflow]]メモリも参照）。
   **2026-09-18 追記**: `ms-playwright` に入っているブラウザのビルド番号と npx キャッシュの
   playwright が要求するビルド番号がずれていて `Executable doesn't exist ...` になることがある。
   `ls "$LOCALAPPDATA/ms-playwright"` で実在するビルドを調べ、
   `chromium.launch({ executablePath: ".../chromium-<build>/chrome-win64/chrome.exe" })` と
   直接指定すれば `npx playwright install` 無しで動く。WebGL（`mohr/`の3D表示）を使うページは
   `args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader']` を
   付けるとヘッドレスでも描画される。
10. **`mohr/`で3Dの色が暗い・カラーバーと合わない / 円弧グリフが見えない / 視点がズレる**:
   いずれも three.js 側の仕様に起因する既知のハマりどころ。上記`mohr/`の節
   「three.js まわりの注意」を参照（ライト強度・頂点カラーの色空間・TorusGeometry の回転・
   カメラのフィット方式）。

## コミット・プッシュの運用（毎回やること）

**ひとまとまりの作業が終わったら、その都度 `git commit` して `git push origin master` する**
（ユーザーからの指示を待たない。2026-09-18にユーザーから明示的に依頼）。理由:
`master`へのpushがそのままGitHub Pagesの公開内容になるので、手元だけ進んでいて公開版が
古いままという状態を作らないため。

- ブランチは`master`（このリポジトリの既定ブランチ。作業ブランチは切らない運用）
- コミット単位は「単元ひとつ」「バグ修正ひとつ」程度。README/CLAUDE.mdの更新は
  その作業を説明するものなので同じコミットに含めてよい
- コミットメッセージは日本語で、`beam: ...` / `mohr: ...` のように単元名を接頭辞に付ける
  （単元をまたぐ変更や文書だけの変更は接頭辞なしでよい）
- push後、GitHub Pagesの反映には1〜2分かかる。見た目の確認は
  `https://yusaku-m.github.io/sm-lab/` で行う
- **例外**: 動作確認が済んでいない・壊れていると分かっているコードはpushしない
  （公開ページが壊れるため）。その場合はコミットだけ行い、直してからpushする

## GitHub Pages のキャッシュ（見た目の修正が反映されないとき）

`https://yusaku-m.github.io/...` の静的ファイルは **`Cache-Control: max-age=600`** で返る。
つまり push 直後に見ても**最大10分間は古い CSS/JS がブラウザのキャッシュから使われる**。
2026-09-18、ヘッダーの説明文を1行にする修正をしたあとユーザーの画面では3行のままで、
原因はこれだった（`curl -sI .../style.css` で `Cache-Control` と `Age` を確認できる）。

- 直すには **Ctrl+Shift+R（ハードリロード）** か、DevTools を開いて "Disable cache"
- 確認する側（Claude）は Playwright の新規コンテキストで開けばキャッシュを持たないので、
  **「公開版を実測したら直っている」のにユーザーの画面が直っていない場合は、まずこれを疑う**
- `?v=` を付けて回る方式は、ESモジュールの `import` 先（`rod3d.js` 等）にも付けないと
  中途半端になるので採っていない

## デプロイ

`https://github.com/yusaku-m/sm-lab`（Public）へpush済み。GitHub Pagesは`master`ブランチ・
`/ (root)`で配信（Settings → Pages）。公開URL: `https://yusaku-m.github.io/sm-lab/`。
リポジトリ直下に`.nojekyll`必須（上記「デバッグの勘所」参照）。
新規GitHubリポジトリの作成・公開設定は毎回ユーザーに確認してから行う。
