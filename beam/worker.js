// Pyodide を起動し、Beam.py（sympyベースの梁計算エンジン）を仮想FS上に
// 展開して呼び出す Web Worker。UIスレッドをブロックしないよう、重い記号計算
// はすべてここ（別スレッド）で行う。
//
// 注意: 最近の Pyodide（pyodide.asm.mjs が ES module）は classic worker の
// importScripts() では読み込めない。このファイルは module worker として
// （app.js 側で `new Worker("worker.js", { type: "module" })`）読み込むこと。
// バージョンを変更する場合、下の import 文の URL と PYODIDE_INDEX_URL の
// 両方を揃えて書き換える（import 文は静的文字列である必要があり、
// PYODIDE_VERSION 定数からは組み立てられない）。

import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.mjs";

const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/";

const QUIZ_WEB_FILES = [
  "__init__.py",
  "Action.py",
  "BeamLibrary.py",
  "CrossSection.py",
  "Figure.py",
  "Material.py",
  "SafetyFactor.py",
  "Beam.py",
];

let pyodideReadyPromise = initPyodide();

async function fetchText(relativePath) {
  const url = new URL(relativePath, self.location.href);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`fetch failed: ${relativePath} (${resp.status})`);
  }
  return resp.text();
}

async function initPyodide() {
  const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  await pyodide.loadPackage(["numpy", "sympy", "svgwrite"]);

  pyodide.FS.mkdirTree("/home/pyodide/quiz_web");
  for (const filename of QUIZ_WEB_FILES) {
    // quiz_web はリポジトリ直下の py/ に置かれた全単元共通エンジン（sm-lab/py/quiz_web/）。
    // このファイル（beam/worker.js）から見ると一つ上の階層になる。
    const text = await fetchText(`../py/quiz_web/${filename}`);
    pyodide.FS.writeFile(`/home/pyodide/quiz_web/${filename}`, text);
  }

  pyodide.runPython(`
import sys
if "/home/pyodide" not in sys.path:
    sys.path.insert(0, "/home/pyodide")
`);

  const bridgeText = await fetchText("bridge.py");
  pyodide.runPython(bridgeText);

  self.postMessage({ type: "ready" });
  return pyodide;
}

self.onmessage = async (event) => {
  const { id, config } = event.data;
  try {
    const pyodide = await pyodideReadyPromise;
    pyodide.globals.set("_config_json", JSON.stringify(config));
    // 各計算段階（figure/reactions/sfd/bmd）が終わるたびにBeam.py側から呼ばれ、
    // その場でメインスレッドへ部分結果を流す（終わった順に画面へ反映するため）。
    pyodide.globals.set("_emit", (stageJson) => {
      let payload;
      try {
        payload = JSON.parse(stageJson);
      } catch (e) {
        return;
      }
      self.postMessage({ type: "partial", id, ...payload });
    });
    const resultJson = pyodide.runPython("compute_beam(_config_json, _emit)");
    pyodide.globals.delete("_emit");
    const payload = JSON.parse(resultJson);
    self.postMessage({ type: "result", id, ...payload });
  } catch (err) {
    self.postMessage({
      type: "result",
      id,
      ok: false,
      message: err && err.message ? err.message : String(err),
    });
  }
};

pyodideReadyPromise.catch((err) => {
  self.postMessage({
    type: "init_error",
    message: err && err.message ? err.message : String(err),
  });
});
