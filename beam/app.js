// UI ロジック: 支点・荷重の自由配置エディタ、Worker とのやり取り、
// SVG図＋KaTeX数式オーバーレイ・解説文（$...$入り）のレンダリング。

const SUPPORT_TYPES = [
  { value: "pin", label: "ピン（回転支点）" },
  { value: "roller", label: "ローラー（移動支点）" },
  { value: "fixed", label: "固定支点" },
];

const LOAD_TYPES = [
  { value: "point_load", label: "集中荷重" },
  { value: "point_moment", label: "集中モーメント" },
  { value: "distributed_load", label: "分布荷重" },
];

const DISTRIBUTED_FUNCTIONS = [
  { value: "1", label: "等分布" },
  { value: "x/L", label: "三角形（右側が最大）" },
  { value: "1-x/L", label: "三角形（左側が最大）" },
];

let nextId = 1;
let supports = [
  { id: nextId++, type: "fixed", position: 0 },
];
let loads = [
  { id: nextId++, type: "point_load", magnitude: 5, position: 1 },
];

const worker = new Worker("worker.js", { type: "module" });
let workerReady = false;
let requestSeq = 0;
let latestRequestId = 0;
let debounceTimer = null;

worker.onmessage = (e) => {
  const data = e.data;
  if (data.type === "ready") {
    workerReady = true;
    scheduleCompute(0);
  } else if (data.type === "init_error") {
    setStatus("初期化に失敗しました: " + data.message, true);
  } else if (data.type === "result") {
    if (data.id !== latestRequestId) return; // 古いリクエストの結果は無視
    if (data.ok) {
      setStatus("", false);
      renderResult(data.result);
    } else {
      setStatus("計算エラー: " + data.message, true);
    }
  }
};

worker.onerror = (err) => {
  setStatus("Worker エラー: " + err.message, true);
};

function clamp01(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function setStatus(msg, isError = false, busy = false) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  el.classList.toggle("busy", !!busy);
}

function scheduleCompute(delay = 400) {
  if (!workerReady) return;
  clearTimeout(debounceTimer);
  if (delay === 0) {
    doCompute();
  } else {
    debounceTimer = setTimeout(doCompute, delay);
  }
}

function buildConfig() {
  const length = Number(document.getElementById("length").value) || 1000;
  return {
    length,
    supports: supports.map((s) => ({ type: s.type, position: clamp01(s.position) })),
    loads: loads.map((l) => {
      if (l.type === "distributed_load") {
        return {
          type: l.type,
          magnitude: Number(l.magnitude) || 0,
          start: clamp01(l.start ?? 0),
          end: clamp01(l.end ?? 1),
          function: l.function || "1",
        };
      }
      return {
        type: l.type,
        magnitude: Number(l.magnitude) || 0,
        position: clamp01(l.position ?? 0),
      };
    }),
  };
}

function doCompute() {
  const config = buildConfig();
  const id = ++requestSeq;
  latestRequestId = id;
  setStatus("計算中…", false, true);
  worker.postMessage({ id, config });
}

// ---------------------------------------------------------------- 支点UI
function renderSupportsList() {
  const container = document.getElementById("supports-list");
  container.innerHTML = "";
  supports.forEach((s) => {
    const row = document.createElement("div");
    row.className = "row";

    const typeSelect = document.createElement("select");
    SUPPORT_TYPES.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.value;
      opt.textContent = t.label;
      if (t.value === s.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener("change", () => {
      s.type = typeSelect.value;
      scheduleCompute();
    });

    const posInput = document.createElement("input");
    posInput.type = "number";
    posInput.min = "0";
    posInput.max = "1";
    posInput.step = "0.01";
    posInput.value = s.position;
    posInput.title = "位置（0=左端 〜 1=右端）";
    posInput.addEventListener("input", () => {
      s.position = posInput.value;
      scheduleCompute();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      supports = supports.filter((x) => x.id !== s.id);
      renderSupportsList();
      scheduleCompute();
    });

    row.appendChild(typeSelect);
    row.appendChild(posInput);
    row.appendChild(removeBtn);
    container.appendChild(row);
  });
}

document.getElementById("add-support").addEventListener("click", () => {
  supports.push({ id: nextId++, type: "pin", position: 0.5 });
  renderSupportsList();
  scheduleCompute();
});

// ---------------------------------------------------------------- 荷重UI
function renderLoadsList() {
  const container = document.getElementById("loads-list");
  container.innerHTML = "";
  loads.forEach((l) => {
    const row = document.createElement("div");
    row.className = "row";

    const typeSelect = document.createElement("select");
    LOAD_TYPES.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.value;
      opt.textContent = t.label;
      if (t.value === l.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener("change", () => {
      l.type = typeSelect.value;
      if (l.type === "distributed_load") {
        l.start = l.start ?? 0;
        l.end = l.end ?? 1;
        l.function = l.function ?? "1";
      } else {
        l.position = l.position ?? 0.5;
      }
      renderLoadsList();
      scheduleCompute();
    });
    row.appendChild(typeSelect);
    container.appendChild(row);

    const fieldsRow = document.createElement("div");
    fieldsRow.className = "row";

    const magInput = document.createElement("input");
    magInput.type = "number";
    magInput.step = "0.1";
    magInput.value = l.magnitude ?? 1;
    magInput.title = l.type === "point_moment" ? "大きさ (kN·m)" : (l.type === "distributed_load" ? "基準値 (kN/m)" : "大きさ (kN)");
    magInput.addEventListener("input", () => {
      l.magnitude = magInput.value;
      scheduleCompute();
    });
    fieldsRow.appendChild(magInput);

    if (l.type === "distributed_load") {
      const startInput = document.createElement("input");
      startInput.type = "number";
      startInput.min = "0";
      startInput.max = "1";
      startInput.step = "0.01";
      startInput.value = l.start ?? 0;
      startInput.title = "開始位置（0-1）";
      startInput.addEventListener("input", () => {
        l.start = startInput.value;
        scheduleCompute();
      });
      fieldsRow.appendChild(startInput);

      const endInput = document.createElement("input");
      endInput.type = "number";
      endInput.min = "0";
      endInput.max = "1";
      endInput.step = "0.01";
      endInput.value = l.end ?? 1;
      endInput.title = "終了位置（0-1）";
      endInput.addEventListener("input", () => {
        l.end = endInput.value;
        scheduleCompute();
      });
      fieldsRow.appendChild(endInput);

      const funcSelect = document.createElement("select");
      DISTRIBUTED_FUNCTIONS.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.value;
        opt.textContent = f.label;
        if (f.value === (l.function || "1")) opt.selected = true;
        funcSelect.appendChild(opt);
      });
      funcSelect.addEventListener("change", () => {
        l.function = funcSelect.value;
        scheduleCompute();
      });
      fieldsRow.appendChild(funcSelect);
    } else {
      const posInput = document.createElement("input");
      posInput.type = "number";
      posInput.min = "0";
      posInput.max = "1";
      posInput.step = "0.01";
      posInput.value = l.position ?? 0.5;
      posInput.title = "位置（0-1）";
      posInput.addEventListener("input", () => {
        l.position = posInput.value;
        scheduleCompute();
      });
      fieldsRow.appendChild(posInput);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      loads = loads.filter((x) => x.id !== l.id);
      renderLoadsList();
      scheduleCompute();
    });
    fieldsRow.appendChild(removeBtn);

    container.appendChild(fieldsRow);
  });
}

document.getElementById("add-load").addEventListener("click", () => {
  loads.push({ id: nextId++, type: "point_load", magnitude: 1, position: 0.5 });
  renderLoadsList();
  scheduleCompute();
});

document.getElementById("length").addEventListener("input", () => scheduleCompute());

// ---------------------------------------------------------------- 結果表示
function renderFigure(containerId, figData) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  if (!figData) return;
  el.insertAdjacentHTML("beforeend", figData.svg);
  (figData.equations || []).forEach((eq) => {
    const span = document.createElement("span");
    span.className = "eq-overlay";
    span.style.left = eq.x + "px";
    span.style.top = eq.y + "px";
    const tx = eq.halign === "center" ? -50 : 0;
    const ty = eq.valign === "center" ? -50 : eq.valign === "bottom" ? -100 : 0;
    span.style.transform = `translate(${tx}%, ${ty}%)`;
    try {
      katex.render(eq.latex, span, { throwOnError: false });
    } catch (err) {
      span.textContent = eq.latex;
    }
    el.appendChild(span);
  });
}

function renderExplanation(containerId, lines) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  (lines || []).forEach((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    el.appendChild(p);
  });
  if (window.renderMathInElement) {
    renderMathInElement(el, {
      delimiters: [{ left: "$", right: "$", display: false }],
      throwOnError: false,
    });
  }
}

function appendMaxPair(containerId, label, pair, unit) {
  if (!pair) return;
  const el = document.getElementById(containerId);
  const p = document.createElement("p");
  const [exprObj, value] = pair;
  const exprLatex = exprObj && typeof exprObj === "object" && "__latex__" in exprObj ? exprObj.__latex__ : String(exprObj);
  const valueStr = typeof value === "number" ? value.toFixed(2) : String(value);
  p.innerHTML = `${label}: <span class="katex-target"></span> = ${valueStr} ${unit}`;
  el.appendChild(p);
  const target = p.querySelector(".katex-target");
  try {
    katex.render(exprLatex, target, { throwOnError: false });
  } catch (e) {
    target.textContent = exprLatex;
  }
}

function renderResult(result) {
  renderFigure("fig-beam", result.figure);
  renderFigure("fig-reactions", result.figure_reaction_forces);
  renderFigure("fig-sfd", result.shear_force_diagram);
  renderFigure("fig-bmd", result.bending_moment_diagram);

  renderExplanation("exp-reactions", result.explanation_reaction_forces);
  renderExplanation("exp-sectional", result.explanation_sectional_forces);
  appendMaxPair("exp-sectional", "最大曲げモーメント", result.maximum_bending_moment, "N·m");

  const shearEl = document.getElementById("exp-max-shear");
  shearEl.innerHTML = "";
  appendMaxPair("exp-max-shear", "最大せん断力", result.maximum_shear_force, "N");
}

// ---------------------------------------------------------------- 初期化
renderSupportsList();
renderLoadsList();
setStatus("Pyodide を読み込み中…（初回は数秒かかります）", false, true);
