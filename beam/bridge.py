"""Pyodide Worker から呼び出される計算ブリッジ。

worker.js が pyodide.runPython(このファイルの内容) でグローバル名前空間に
compute_beam() を定義し、以後 pyodide.runPython("compute_beam(json_str)") で
呼び出す。戻り値は JSON 文字列（{"ok": true, "result": {...}} または
{"ok": false, "message": "..."}）。

Phase 1 スコープ: 梁図・反力・SFD・BMD のみ。断面/たわみ/応力は Phase 2 で追加。
"""

import json
import traceback

import sympy as sp

from quiz_web import Beam as BeamMod
from quiz_web import Action
from quiz_web import Material
from quiz_web import CrossSection


def _to_jsonable(v):
    """sympy式・numpy/Decimal数値などを JSON化できる素朴な形に変換する。

    数値化できる sympy 式は float に、それ以外（P や L 等のシンボルを含む式）は
    {"__latex__": ...} として返す（フロント側で KaTeX に渡す）。
    """
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, sp.Basic):
        if v.is_number:
            try:
                return float(v)
            except (TypeError, ValueError):
                pass
        return {"__latex__": sp.latex(v)}
    if isinstance(v, (list, tuple)):
        return [_to_jsonable(x) for x in v]
    if isinstance(v, dict):
        return {k: _to_jsonable(x) for k, x in v.items()}
    try:
        return float(v)
    except (TypeError, ValueError):
        return str(v)


def _figure_payload(fig):
    if fig is None:
        return None
    return {"svg": fig.tostring(), "equations": fig.equations_as_list()}


def _build_action(cfg):
    t = cfg["type"]
    if t == "point_load":
        return Action.ConcentratedLoad(float(cfg["magnitude"]), float(cfg["position"]))
    if t == "point_moment":
        return Action.ConcentratedMoment(float(cfg["magnitude"]), float(cfg["position"]))
    if t == "distributed_load":
        return Action.DistributedLoad(
            float(cfg["magnitude"]),
            position_range=(float(cfg["start"]), float(cfg["end"])),
            total_length=1,
            function=cfg.get("function", "1"),
        )
    raise ValueError(f"不明な荷重タイプです: {t}")


_CROSS_SECTION_BUILDERS = {
    "rectangle": lambda d: CrossSection.Rectangle(float(d["width"]), float(d["height"])),
    "circle": lambda d: CrossSection.Circle(float(d["diameter"])),
    "hollow_circle": lambda d: CrossSection.HollowCircle(
        float(d["outer_diameter"]), float(d["inner_diameter"])
    ),
    "hollow_rectangle": lambda d: CrossSection.HollowRectangle(
        float(d["outer_width"]), float(d["outer_height"]),
        float(d["inner_width"]), float(d["inner_height"]),
    ),
    "triangle": lambda d: CrossSection.Triangle(float(d["base"]), float(d["height"])),
}

_DEFAULT_CROSS_SECTION = {"shape": "rectangle", "dims": {"width": 100, "height": 200}}


def _build_beam(cfg):
    length = float(cfg["length"])
    supports = [(s["type"], float(s["position"])) for s in cfg["supports"]]
    actions = [_build_action(a) for a in cfg["loads"]]

    cs_cfg = cfg.get("cross_section", _DEFAULT_CROSS_SECTION)
    section = _CROSS_SECTION_BUILDERS[cs_cfg["shape"]](cs_cfg["dims"])

    material_name = cfg.get("material", "Steel")
    material = getattr(Material, material_name)()

    return BeamMod.Beam(length, supports, actions, section=section, material=material)


def compute_beam(config_json, emit=None):
    """梁の計算を行い、最終結果のJSON文字列を返す。

    emit: 途中経過を段階的にフロントへ渡すためのJS側コールバック（省略可）。
    worker.js から `compute_beam(config_json, emit)` の形で呼ばれ、各段階の
    計算が終わるたびに `emit(json.dumps({"ok": True, "stage": ..., "data": ...}))`
    を呼ぶ。各段階はBeam.py側のプロパティキャッシュ（self._xxxがNoneなら計算、
    そうでなければキャッシュを返す）に乗っかっているだけなので、最後にもう一度
    全プロパティへアクセスしても再計算は発生しない。
    """
    try:
        cfg = json.loads(config_json)
        beam = _build_beam(cfg)

        def _emit(stage, data):
            if emit is not None:
                emit(json.dumps({"ok": True, "stage": stage, "data": data}))

        figure_data = {"figure": _figure_payload(beam.figure)}
        _emit("figure", figure_data)

        reactions_data = {
            "reaction_forces": _to_jsonable(beam.reaction_forces),
            "explanation_reaction_forces": beam.explanation_reaction_forces,
            "figure_reaction_forces": _figure_payload(beam.figure_reaction_forces),
        }
        _emit("reactions", reactions_data)

        sfd_data = {
            "shear_force_diagram": _figure_payload(beam.shear_force_diagram),
            "maximum_shear_force": _to_jsonable(beam.maximum_shear_force),
        }
        _emit("sfd", sfd_data)

        bmd_data = {
            "bending_moment_diagram": _figure_payload(beam.bending_moment_diagram),
            "explanation_sectional_forces": beam.explanation_sectional_forces,
            "maximum_bending_moment": _to_jsonable(beam.maximum_bending_moment),
        }
        _emit("bmd", bmd_data)

        result = {**figure_data, **reactions_data, **sfd_data, **bmd_data}
        return json.dumps({"ok": True, "result": result})
    except Exception as e:  # noqa: BLE001 -- ワーカー越しにフロントへ伝える
        return json.dumps({
            "ok": False,
            "message": str(e),
            "traceback": traceback.format_exc(),
        })
