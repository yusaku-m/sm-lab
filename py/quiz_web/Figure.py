"""ブラウザ（Pyodide）向けの軽量版 Figure。

元の packages/quiz/Figure.py から SVG 描画プリミティブだけを移植したもの。
PDF 埋め込み（embed_to_pdf, reportlab/svglib, Equation クラスの matplotlib
レンダリング）は一切行わない。数式ラベルは sympy の sympify/latex だけで
LaTeX 文字列に変換して self._equations に位置情報つきで積んでおき、
実際のレンダリングはブラウザ側（KaTeX）に任せる。

Beam.py / CrossSection.py はこのクラスの API（line/rect/circle/polygon/text/
draw_*/tostring 等）だけを使っており、無改造のまま動く。
"""

import numpy as np
import svgwrite
import sympy


# Equation.py の symbol_map と同じもの（数式の見た目を変えないための転記）
_E_symbol = sympy.Symbol("E", real=True, positive=True)
_r_symbol = sympy.Symbol('r', real=True, positive=True)
_R_symbol = sympy.Symbol('R', real=True, positive=True)
_N_symbol = sympy.Symbol('N', real=True, positive=True)
_eprime_symbol = sympy.Symbol("varepsilon", real=True)
_DeltaL_symbol = sympy.Symbol(r"\Delta L", real=True, positive=True)
_DeltaT_symbol = sympy.Symbol("\Delta T", real=True)
_DeltaT_1_symbol = sympy.Symbol(r"\Delta T_1", real=True)
_DeltaT_2_symbol = sympy.Symbol(r"\Delta T_2", real=True)
_dr_symbol = sympy.Symbol("dr", real=True, positive=True)

_SYMBOL_MAP = {
    "E": _E_symbol,
    "r": _r_symbol,
    "R": _R_symbol,
    "N": _N_symbol,
    "varepsilon'": _eprime_symbol,
    "DeltaL": _DeltaL_symbol,
    "DeltaT_1": _DeltaT_1_symbol,
    "DeltaT_2": _DeltaT_2_symbol,
    "DeltaT": _DeltaT_symbol,
    "dr": _dr_symbol,
}


def _text_to_latex(text):
    """Equation.py の generate_figure() 前半（sympify→latex）だけを再現する。

    matplotlib計測は行わない。sympify に失敗した場合は元の文字列をそのまま返す
    （Equation.py と同じフォールバック挙動）。
    """
    try:
        equation = sympy.sympify(text, locals=_SYMBOL_MAP, evaluate=False)
    except Exception:
        return text

    if isinstance(equation, str):
        return equation
    return sympy.latex(equation)


class Figure(svgwrite.Drawing):
    def __init__(self, name="buf_figure", size=(162, 100), rotation_angle=0):
        super().__init__(name + '.svg', profile='full', size=size)
        self._rotation_angle = rotation_angle
        self._equations = []  # (latex_str, (x, y), fill, valign, halign)

    def line(self, start=(0, 0), end=(0, 0), **kwargs):
        start = (float(start[0]), float(start[1]))
        end = (float(end[0]), float(end[1]))
        if 'stroke_width' in kwargs:
            kwargs['stroke_width'] = float(kwargs['stroke_width'])
        return svgwrite.shapes.Line(start=start, end=end, **kwargs)

    def rect(self, insert=(0, 0), size=(1, 1), **kwargs):
        insert = (float(insert[0]), float(insert[1]))
        size = (float(size[0]), float(size[1]))
        if 'stroke_width' in kwargs:
            kwargs['stroke_width'] = float(kwargs['stroke_width'])
        return svgwrite.shapes.Rect(insert=insert, size=size, **kwargs)

    def circle(self, center=(0, 0), r=1, **kwargs):
        center = (float(center[0]), float(center[1]))
        r = float(r)
        if 'stroke_width' in kwargs:
            kwargs['stroke_width'] = float(kwargs['stroke_width'])
        return svgwrite.shapes.Circle(center=center, r=r, **kwargs)

    def polygon(self, points=[], **kwargs):
        points = [(float(p[0]), float(p[1])) for p in points]
        if 'stroke_width' in kwargs:
            kwargs['stroke_width'] = float(kwargs['stroke_width'])
        return svgwrite.shapes.Polygon(points=points, **kwargs)

    def text(self, text, insert=(0, 0), **kwargs):
        insert = (float(insert[0]), float(insert[1]))
        if 'font_size' in kwargs:
            kwargs['font_size'] = float(kwargs['font_size'])
        return svgwrite.text.Text(text=text, insert=insert, **kwargs)

    @property
    def width(self):
        return self.attribs.get('width')

    @property
    def height(self):
        return self.attribs.get('height')

    def draw_rectangle_from_center(self, insert_center, size, fill="none", stroke="none", stroke_width=1):
        insert = (float(insert_center[0] - size[0] / 2), float(insert_center[1] - size[1] / 2))
        size = (float(size[0]), float(size[1]))
        self.add(self.rect(insert=insert, size=size, stroke=stroke, fill=fill, stroke_width=stroke_width))

    def draw_triangle(self, top_point, size, color="black", fill_color=None, stroke_width=1):
        p2 = (float(top_point[0] - size / 2), float(top_point[1] + size * np.sqrt(3) / 2))
        p3 = (float(top_point[0] + size / 2), float(top_point[1] + size * np.sqrt(3) / 2))
        top_point = (float(top_point[0]), float(top_point[1]))

        points = [top_point, p2, p3]
        self.add(self.polygon(points, fill=fill_color, stroke=color, stroke_width=stroke_width, stroke_linejoin="round"))

    def draw_arrow(self, start, end, color="black", stroke_width=0.75, size=5, arrow_type="both"):
        start = (float(start[0]), float(start[1]))
        end = (float(end[0]), float(end[1]))

        self.add(self.line(start, end, stroke=color, stroke_width=stroke_width, stroke_linecap="round"))
        vec = np.array(end) - np.array(start)
        vec1 = np.array([vec[0]*np.cos(np.pi/6)-vec[1]*np.sin(np.pi/6),
                         vec[0]*np.sin(np.pi/6)+vec[1]*np.cos(np.pi/6)])
        vec2 = np.array([vec[0]*np.cos(-np.pi/6)-vec[1]*np.sin(-np.pi/6),
                         vec[0]*np.sin(-np.pi/6)+vec[1]*np.cos(-np.pi/6)])

        vec1 = vec1 / np.linalg.norm(vec1) * size
        vec2 = vec2 / np.linalg.norm(vec2) * size

        if np.linalg.norm(vec1)*2 > np.linalg.norm(vec):
            self.add(self.line((float(start[0] - vec[0]/ np.linalg.norm(vec1) * size * 1.5), float(start[1] - vec[1]/ np.linalg.norm(vec1) * size * 1.5)),
                               (float(end[0] + vec[0]/ np.linalg.norm(vec1) * size * 1.5), float(end[1] + vec[1]/ np.linalg.norm(vec1) * size * 1.5)),
                               stroke=color, stroke_width=stroke_width, stroke_linecap="round"))
        if arrow_type == "start" or arrow_type == "both":
            self.add(self.line(start, (float(start[0] + vec1[0]), float(start[1] + vec1[1])), stroke=color, stroke_width=stroke_width, stroke_linecap="round"))
            self.add(self.line(start, (float(start[0] + vec2[0]), float(start[1] + vec2[1])), stroke=color, stroke_width=stroke_width, stroke_linecap="round"))
        if arrow_type == "end" or arrow_type == "both":
            self.add(self.line(end, (float(end[0] - vec1[0]), float(end[1] - vec1[1])), stroke=color, stroke_width=stroke_width, stroke_linecap="round"))
            self.add(self.line(end, (float(end[0] - vec2[0]), float(end[1] - vec2[1])), stroke=color, stroke_width=stroke_width, stroke_linecap="round"))

    def draw_force(self, start, end, color="black", stroke_width=3, size=5):
        start = (float(start[0]), float(start[1]))
        end = (float(end[0]), float(end[1]))

        self.add(self.line(start, end, stroke=color, stroke_width=stroke_width, stroke_linecap="round"))
        vec = np.array(end) - np.array(start)
        vec1 = np.array([vec[0]*np.cos(np.pi/6)-vec[1]*np.sin(np.pi/6),
                         vec[0]*np.sin(np.pi/6)+vec[1]*np.cos(np.pi/6)])
        vec2 = np.array([vec[0]*np.cos(-np.pi/6)-vec[1]*np.sin(-np.pi/6),
                         vec[0]*np.sin(-np.pi/6)+vec[1]*np.cos(-np.pi/6)])

        vec1 = vec1 / np.linalg.norm(vec1) * size
        vec2 = vec2 / np.linalg.norm(vec2) * size

        self.add(self.line(end, (float(end[0] - vec1[0]), float(end[1] - vec1[1])), stroke=color, stroke_width=stroke_width, stroke_linecap="round"))
        self.add(self.line(end, (float(end[0] - vec2[0]), float(end[1] - vec2[1])), stroke=color, stroke_width=stroke_width, stroke_linecap="round"))

    def draw_moment(self, center, radius, direction="CCW", angle_range=(30, 330), color="black", stroke_width=3, aspect_ratio=1.0):
        R_y = float(radius)
        R_x = float(radius * aspect_ratio)
        center = (float(center[0]), float(center[1]))

        def get_point(angle_deg):
            rad = np.radians(angle_deg)
            return (center[0] + R_x * np.sin(rad), center[1] + R_y * np.cos(rad))

        angle_diff = (angle_range[1] - angle_range[0]) % 360
        num_segments = 4
        step_diff = angle_diff / num_segments

        sweep_flag = 1 if direction == "CW" else 0

        start_angle = angle_range[0] if direction == "CCW" else angle_range[1]
        target_angle = angle_range[1] if direction == "CCW" else angle_range[0]

        start_p = get_point(start_angle)
        path_data = 'M {x1} {y1} '.format(x1=float(start_p[0]), y1=float(start_p[1]))

        current_angle = start_angle
        for i in range(num_segments):
            if direction == "CCW":
                next_angle = start_angle + step_diff * (i + 1)
            else:
                next_angle = start_angle - step_diff * (i + 1)

            next_p = get_point(next_angle)

            path_data += 'A {rx} {ry} 0 0 {sweep_flag} {x2} {y2} '.format(
                rx=R_x, ry=R_y, sweep_flag=sweep_flag, x2=float(next_p[0]), y2=float(next_p[1]))

            current_angle = next_angle

        arc_path = self.path(
            d=path_data,
            fill='none',
            stroke=color,
            stroke_width=stroke_width,
            stroke_linecap="round"
        )
        self.add(arc_path)

        ta = target_angle + 5 if direction == "CCW" else target_angle - 5
        tip = get_point(ta)
        rad = np.radians(ta)

        tx = R_x * np.cos(rad)
        ty = -R_y * np.sin(rad)

        if direction == "CW":
            tx, ty = -tx, -ty

        norm = np.sqrt(tx**2 + ty**2)
        tx /= norm
        ty /= norm

        nx, ny = -ty, tx

        arrow_size = stroke_width * 3
        p1 = tip
        p2 = (tip[0] - tx * arrow_size + nx * arrow_size * 0.6,
              tip[1] - ty * arrow_size + ny * arrow_size * 0.6)
        p3 = (tip[0] - tx * arrow_size - nx * arrow_size * 0.6,
              tip[1] - ty * arrow_size - ny * arrow_size * 0.6)

        self.add(self.polygon([p1, p2, p3], fill=color, stroke=color, stroke_width=1, stroke_linejoin="round"))

    def draw_distributed_load(self, beam_leftend, beam_rightend, base_magnitude, load_range=(0, 1), function="1", color="black", stroke_width=0.75, arrow_size=5):
        import sympy as sp

        length = float(beam_rightend[0] - beam_leftend[0])
        start_pos = float(beam_leftend[0] + load_range[0] * length)
        end_pos = float(beam_leftend[0] + load_range[1] * length)

        num_arrows = int(15 * (load_range[1] - load_range[0]))

        local_magnitudes = []
        X = []
        for i in range(num_arrows + 1):
            X.append(start_pos + (end_pos - start_pos) * i / num_arrows)
            relative_position = (X[-1] - beam_leftend[0]) / length

            d = {sp.symbols('x'): relative_position, sp.symbols('L'): 1}
            local_magnitudes.append(float(base_magnitude * sp.sympify(function).subs(d).evalf()))

        for i in range(num_arrows + 1):
            local_magnitude = float(local_magnitudes[i])
            xi = float(X[i])

            start_point = (float(xi), float(beam_leftend[1]) - local_magnitude)
            end_point = (float(xi), float(beam_leftend[1]))

            if local_magnitude > arrow_size:
                self.draw_force(start_point, end_point, color=color, stroke_width=stroke_width, size=arrow_size)

            if i > 0:
                xi_prev = float(X[i-1])
                mag_prev = float(local_magnitudes[i-1])
                self.add(self.line((float(xi_prev), float(beam_leftend[1]) - mag_prev), (float(xi), float(beam_leftend[1]) - local_magnitude), stroke=color, stroke_width=stroke_width, stroke_linecap="round"))

    def draw_fixed_end(self, rod_center, width, height, color="black", rotate_angle=0, pitch=5):
        rod_center = (float(rod_center[0]), float(rod_center[1]))
        width = float(width)
        height = float(height)

        left_top = (rod_center[0] - width / 2, rod_center[1])
        right_top = (rod_center[0] + width / 2, rod_center[1])
        left_bottom = (rod_center[0] - width / 2, rod_center[1] + height)
        right_bottom = (rod_center[0] + width / 2, rod_center[1] + height)

        self.add(self.line(left_top, right_top, stroke_width=2, stroke=color, stroke_linecap="round",
                           transform=f'rotate({rotate_angle} {rod_center[0]} {rod_center[1]})'))
        left_top = self.rotate_point(left_top, rod_center, rotate_angle)
        right_top = self.rotate_point(right_top, rod_center, rotate_angle)
        left_bottom = self.rotate_point(left_bottom, rod_center, rotate_angle)
        right_bottom = self.rotate_point(right_bottom, rod_center, rotate_angle)

        x = min(left_top[0], right_top[0], left_bottom[0], right_bottom[0]) - float(self.width)
        y = min(left_top[1], right_top[1], left_bottom[1], right_bottom[1]) - float(self.height)

        x_e = max(left_top[0], right_top[0], left_bottom[0], right_bottom[0])
        y_e = max(left_top[1], right_top[1], left_bottom[0], right_bottom[1])

        line_length = max(x_e - x + width, y_e - y + height)

        if x_e - x < y_e - y:
            y = y - height*10
            y_e = y_e + height * 10
            e = y_e
            t = y
            xscan = False
            yscan = True
        else:
            x = x - width*10
            x_e = x_e + width*10
            e = x_e
            t = x
            xscan = True
            yscan = False

        while t < e:
            start = (float(x), float(y))
            end = (float(x + line_length), float(y + line_length))
            intersections = []
            intersections.append(self.intersection(start, end, left_bottom, right_bottom))
            intersections.append(self.intersection(start, end, left_top, right_top))
            intersections.append(self.intersection(start, end, left_top, left_bottom))
            intersections.append(self.intersection(start, end, right_top, right_bottom))

            intersections = [i for i in intersections if i is not None]

            if len(intersections) > 1:
                intersections = np.array(intersections)

                x1 = np.min(intersections[:, 0])
                y1 = np.min(intersections[:, 1])
                x2 = np.max(intersections[:, 0])
                y2 = np.max(intersections[:, 1])

                self.add(self.line((float(x1), float(y1)), (float(x2), float(y2)), stroke_width=0.75, stroke=color, stroke_linecap="round"))
            else:
                pass

            t += pitch
            if xscan:
                x += pitch
            if yscan:
                y += pitch

    def draw_fixed_support(self, rod_center, width, height, color="black", rotate_angle=0, pitch=5):
        self.draw_fixed_end(rod_center, width, height, color, rotate_angle, pitch)

    def rotate_point(self, point, center, angle):
        x = float(point[0] - center[0])
        y = float(point[1] - center[1])
        angle = np.radians(angle)
        x_new = x * np.cos(angle) - y * np.sin(angle)
        y_new = x * np.sin(angle) + y * np.cos(angle)
        return (float(x_new + center[0]), float(y_new + center[1]))

    def intersection(self, s1, e1, s2, e2):
        def slope(s, e):
            if float(e[0]) == float(s[0]):
                return float('inf')
            else:
                return (float(e[1])-float(s[1])) / (float(e[0])-float(s[0]))

        def intercept(s, e):
            return float(s[1]) - slope(s, e) * float(s[0])

        def intersection(line1, line2):
            s1, e1 = line1
            s2, e2 = line2

            if slope(s1, e1) == slope(s2, e2):
                return None
            elif slope(s1, e1) == float('inf'):
                x = s1[0]
                y = slope(s2, e2) * x + intercept(s2, e2)
            elif slope(s2, e2) == float('inf'):
                x = s2[0]
                y = slope(s1, e1) * x + intercept(s1, e1)
            else:
                x = (intercept(s2, e2) - intercept(s1, e1)) / (slope(s1, e1) - slope(s2, e2))
                y = slope(s1, e1) * x + intercept(s1, e1)

            return (float(x), float(y))

        res = intersection((s1, e1), (s2, e2))
        if res is None:
            return None
        (x, y) = res

        if x >= min(float(s1[0]), float(e1[0]))-0.01 and x <= max(float(s1[0]), float(e1[0]))+0.01 and \
           x >= min(float(s2[0]), float(e2[0]))-0.01 and x <= max(float(s2[0]), float(e2[0]))+0.01 and \
           y >= min(float(s1[1]), float(e1[1]))-0.01 and y <= max(float(s1[1]), float(e1[1]))+0.01 and \
           y >= min(float(s2[1]), float(e2[1]))-0.01 and y <= max(float(s2[1]), float(e2[1]))+0.01:
            return (x, y)
        else:
            return None

    def draw_pin_support(self, rod_center, size, color="white", rotate_angle=0, delta=True, circle=True):
        rod_center = (float(rod_center[0]), float(rod_center[1]))
        size = float(size)

        if delta:
            self.draw_triangle(top_point=rod_center, size=size*3.5, color="black", fill_color=color, stroke_width=1.5)

        if circle:
            self.add(self.circle(center=rod_center, r=size, fill=color, stroke="black", stroke_width=1.5))

    def draw_roller_support(self, rod_center, size, color="white", rotate_angle=0):
        rod_center = (float(rod_center[0]), float(rod_center[1]))
        size = float(size)

        self.draw_triangle(top_point=rod_center, size=size*3.5, color="black", fill_color=color, stroke_width=1.5)
        left = (float(rod_center[0] - size*1.75), float(rod_center[1] + size*4))
        right = (float(rod_center[0] + size*1.75), float(rod_center[1] + size*4))
        self.add(self.line(left, right, stroke="black", stroke_width=1.5, stroke_linecap="round"))

    def draw_equation(self, equation, position, fontsize=10, color="black", fill="none", valign="center", halign="center"):
        """数式を描画する（ブラウザ側では KaTeX が実際のレンダリングを行う）。

        元の Figure.draw_equation は Equation オブジェクト（matplotlib計測）を
        self._equations に積んでいたが、ここでは (latex文字列, 位置, ...) の
        タプルだけを積む。SVG自体には何も描画しない（equations はオーバーレイ）。
        """
        latex_str = _text_to_latex(equation)
        position = (float(position[0]), float(position[1]))
        self._equations.append((latex_str, position, fill, valign, halign))

    def equations_as_list(self):
        """JS側へ渡しやすい形（リストのリスト）で数式ラベルを返す。"""
        return [
            {"latex": latex_str, "x": pos[0], "y": pos[1], "valign": valign, "halign": halign}
            for (latex_str, pos, fill, valign, halign) in self._equations
        ]
