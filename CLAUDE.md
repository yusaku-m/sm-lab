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
**Gradingから`Beam.py`を`cp`し直して再同期する際は、この7箇所の修正が上書きで
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

## 現在のスコープ（Phase 1、`beam/`のみ実装済み）

- 支点・荷重の完全自由配置（pin/roller/fixed、集中荷重/集中モーメント/分布荷重）
- 出力: 梁図、反力（値＋解説）、SFD、BMD（値＋解説）
- 断面・材料は `bridge.py` 内の固定デフォルト（矩形100×200mm・軟鋼）— UIには出していない

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

**Phase 3（新規単元、未着手）**
- `axial/`（引張・圧縮変形）、`torsion/`（ねじり変形）、`mohr/`（モールの応力円）を追加
- ルートの`index.html`の該当unit-cardの`disabled`クラスを外してリンクを有効化

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

## デプロイ

`https://github.com/yusaku-m/sm-lab`（Public）へpush済み。GitHub Pagesは`master`ブランチ・
`/ (root)`で配信（Settings → Pages）。公開URL: `https://yusaku-m.github.io/sm-lab/`。
リポジトリ直下に`.nojekyll`必須（上記「デバッグの勘所」参照）。
新規GitHubリポジトリの作成・公開設定は毎回ユーザーに確認してから行う（このリポジトリ自体、
まだGit管理下に置いていない/pushしていない）。
