"""Hand-built line illustrations (40x56 grid). Gold strokes, optional coloured liquid."""

FOOT = 'M12 51 Q20 48.5 28 51'

# each glass: (liquid path, line-art paths, extras that animate e.g. bubbles)
G = {
 "martini": ("M8.5 12 L31.5 12 L20 26 Z",
   ["M4 7 L36 7 L20 27 Z", "M20 27 L20 49", FOOT,
    "M27 2 L17 20", "M22.1 16 A2.6 2.6 0 1 1 16.9 16 A2.6 2.6 0 1 1 22.1 16"]),
 "coupe": ("M7 12 Q8 23 20 23.5 Q32 23 33 12 Z",
   ["M4 9 Q5 25 20 25.5 Q35 25 36 9 Z", "M20 25.5 L20 49", FOOT,
    "M32.4 7 A2.4 2.4 0 1 1 27.6 7 A2.4 2.4 0 1 1 32.4 7", "M30 4.6 Q31 1.5 34 1"]),
 "highball": ("M11.4 18 L12.6 50 L27.4 50 L28.6 18 Z",
   ["M10 6 L12 52 L28 52 L30 6", "M12.3 48 L27.7 48", "M24 1 L21 40",
    "M28 6 A7 7 0 0 1 35 13 Z", "M15 21 l6.5 1.4 l-1.4 6.5 l-6.5 -1.4 Z", "M18.5 31 l6.6 -1.2 l1.2 6.6 l-6.6 1.2 Z"]),
 "rocks": ("M7.6 30 L9 50 L31 50 L32.4 30 Z",
   ["M6 22 L8 52 L32 52 L34 22", "M8.3 48.5 L31.7 48.5",
    "M11 32 l6.9 -1 l1 6.9 l-6.9 1 Z", "M20.5 28 l7.7 2 l-2 7.7 l-7.7 -2 Z", "M26 22 Q30 15 36 17"]),
 "wine": ("M9.6 20 Q10.5 29 20 29.5 Q29.5 29 30.4 20 Z",
   ["M9 4 Q7 30 20 31 Q33 30 31 4", "M20 31 L20 50", FOOT]),
 "flute": ("M14.6 13 Q15 30 20 32 Q25 30 25.4 13 Z",
   ["M14 3 Q14 31 20 33 Q26 31 26 3 Z", "M20 33 L20 50", FOOT]),
 "mug": ("M9.5 16 L9.5 50 L26.5 50 L26.5 16 Z",
   ["M10 12 L26 12 Q28 12 28 14 L28 50 Q28 52 26 52 L10 52 Q8 52 8 50 L8 14 Q8 12 10 12 Z",
    "M28 20 Q37 20 37 30 Q37 40 28 40", "M28 24 Q33 24 33 30 Q33 36 28 36",
    "M7 13 Q6.5 7 12 8 Q14 4 19 6 Q23 3 26 7 Q30.5 7.5 29 13", "M14 18 L14 46", "M22 18 L22 46"]),
 "shot": ("M11.2 30 L12.3 50 L27.7 50 L28.8 30 Z",
   ["M10 22 L12 52 L28 52 L30 22", "M12.3 46 L27.7 46",
    "M25 20 A5 5 0 0 1 35 20 Z", "M30 20 L30 15.5", "M30 20 L33.4 16.6", "M30 20 L26.6 16.6"]),
 "pitcher": ("M9 22 L8.6 50 L27.6 50 L27.4 22 Z",
   ["M9 8 Q6.5 10 7 14 L7 52 L29 52 L29 12 Q29.5 8 34 6 L9 8",
    "M7 16 Q1 16 1 28 Q1 40 7 40", "M7 20 Q4 20 4 28 Q4 36 7 36", "M12 30 L12 46"]),
 "bottle": ("M11 30 L11 51 L29 51 L29 30 Z",
   ["M16 2 L24 2 L24 12 Q24 16 29 20 L29 52 Q29 54 27 54 L13 54 Q11 54 11 52 L11 20 Q16 16 16 12 Z",
    "M16 5.5 L24 5.5", "M13.5 31 L26.5 31 L26.5 43 L13.5 43 Z"]),
 "snifter": ("M8.5 30 Q10 42 20 42 Q30 42 31.5 30 Z",
   ["M12 10 Q4 22 6 32 Q8 44 20 44 Q32 44 34 32 Q36 22 28 10 Z", "M20 44 L20 50", FOOT]),
 "hurricane": ("M11 16 Q8 26 13 34 Q16 40 14 46 L26 46 Q24 40 27 34 Q32 26 29 16 Z",
   ["M10 6 Q5 22 12 34 Q15 40 13 47 L27 47 Q25 40 28 34 Q35 22 30 6", "M20 47 L20 49.5", FOOT,
    "M23 7 Q30 0 37 5 Z", "M30 3.5 L25 16", "M14 7 A4 4 0 1 1 6 7 A4 4 0 1 1 14 7"]),
}

BUBBLES = {"highball": [(17, 44), (23, 40), (19, 36)], "flute": [(19, 27), (21.5, 22), (19.5, 17)],
           "mug": [(18, 42), (12, 36), (24, 30)], "coupe": [], "martini": []}


def glass(name, liquid="#d6a24a", liq_op=.2, cls="ico", bubbles=False, attrs=""):
    liq, lines = G[name]
    paths = "".join(f'<path d="{d}"/>' for d in lines)
    bub = ""
    if bubbles:
        bub = "".join(f'<circle class="bub" style="animation-delay:{i*.7:.1f}s" cx="{x}" cy="{y}" r=".9"/>'
                      for i, (x, y) in enumerate(BUBBLES.get(name, [])))
    return (f'<svg class="{cls}" viewBox="0 0 40 56" {attrs}><path class="liq" d="{liq}" '
            f'style="fill:{liquid};fill-opacity:{liq_op}"/><g class="ln">{paths}</g>{bub}</svg>')


def g_inline(name, x, y, s, liquid, op=.55, bubbles=True, rot=0):
    """Glass placed inside a larger SVG scene."""
    liq, lines = G[name]
    paths = "".join(f'<path d="{d}"/>' for d in lines)
    bub = ""
    if bubbles:
        bub = "".join(f'<circle class="bub" style="animation-delay:{i*.8:.1f}s" cx="{bx}" cy="{by}" r=".9"/>'
                      for i, (bx, by) in enumerate(BUBBLES.get(name, [])))
    return (f'<g transform="translate({x} {y}) rotate({rot} 20 28) scale({s})">'
            f'<path class="liq" d="{liq}" style="fill:{liquid};fill-opacity:{op}"/>'
            f'<path class="sheen" d="{liq}"/>'
            f'<g class="ln">{paths}</g>{bub}</g>')


DEFS = '''<defs><linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient><radialGradient id="glow" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="#d6a24a" stop-opacity=".16"/><stop offset="1" stop-color="#d6a24a" stop-opacity="0"/></radialGradient></defs>'''


def leaf(x, y, s, rot):
    return (f'<g class="ln" transform="translate({x} {y}) rotate({rot}) scale({s})">'
            '<path d="M0 0 Q7 -7 16 0 Q7 7 0 0 Z" style="fill:#5f8a3a;fill-opacity:.35"/><path d="M0 0 L14 0"/></g>')


def citrus(x, y, r, color="#e0a33a"):
    spokes = "".join(f'<path d="M{x} {y} L{x + r*.82*c:.2f} {y + r*.82*s:.2f}"/>'
                     for c, s in [(1, 0), (.5, .866), (-.5, .866), (-1, 0), (-.5, -.866), (.5, -.866)])
    return (f'<g class="ln"><circle cx="{x}" cy="{y}" r="{r}" style="fill:{color};fill-opacity:.28"/>'
            f'<circle cx="{x}" cy="{y}" r="{r*.82:.2f}"/>{spokes}</g>')


def spark(x, y, s, d=0):
    return (f'<path class="spark" style="animation-delay:{d}s" transform="translate({x} {y}) scale({s})" '
            'd="M0 -5 Q0.6 -0.6 5 0 Q0.6 0.6 0 5 Q-0.6 0.6 -5 0 Q-0.6 -0.6 0 -5 Z"/>')


def ice(x, y, s, rot):
    return (f'<g class="ln" transform="translate({x} {y}) rotate({rot}) scale({s})">'
            '<path d="M0 0 L8 0 L8 8 L0 8 Z" style="fill:#ffffff;fill-opacity:.05"/><path d="M1.6 1.6 L4 1.6"/></g>')


def hero():
    """Cover scene: three cocktails, citrus, mint, ice, sparkles."""
    parts = [
        '<ellipse cx="160" cy="214" rx="140" ry="7" class="floor"/>',
        g_inline("coupe", 18, 76, 2.55, "#b8323f", .62),
        g_inline("highball", 104, 6, 3.75, "#7da23f", .5),
        g_inline("martini", 214, 76, 2.55, "#e3a93b", .6, bubbles=False),
        citrus(103, 202, 11), citrus(236, 205, 8, "#d9c13e"),
        leaf(150, 196, 1.3, -20), leaf(156, 30, 1.1, -60), leaf(70, 206, 1, 200),
        ice(276, 200, 1.4, 18), ice(44, 199, 1.2, -12),
        spark(40, 40, 1.4, 0), spark(290, 60, 1.1, .9), spark(250, 20, .8, 1.6),
        spark(70, 18, .7, 2.2), spark(300, 150, .7, .4), spark(16, 150, .8, 1.2),
    ]
    return f'<svg class="hero" viewBox="0 0 320 224">{DEFS}<ellipse cx="160" cy="120" rx="170" ry="120" fill="url(#glow)"/>{"".join(parts)}</svg>'


def trio():
    """Small scene for the cocktails page."""
    parts = [
        '<ellipse cx="80" cy="96" rx="74" ry="3.5" class="floor"/>',
        g_inline("hurricane", 6, 18, 1.4, "#e0782f", .55),
        g_inline("flute", 58, 8, 1.6, "#e7c45a", .45),
        g_inline("rocks", 106, 26, 1.28, "#c4762b", .55, bubbles=False),
        citrus(52, 92, 5), leaf(98, 92, .7, -15), spark(150, 20, .7, .3), spark(10, 10, .6, 1.1),
    ]
    return f'<svg class="trio" viewBox="0 0 160 100">{DEFS}{"".join(parts)}</svg>'


def duo():
    """Back-cover scene: bottle + whisky glass."""
    parts = [
        '<ellipse cx="80" cy="112" rx="66" ry="4" class="floor"/>',
        g_inline("bottle", 30, 3, 1.95, "#b06a22", .55, bubbles=False),
        g_inline("rocks", 78, 42, 1.25, "#c4762b", .6, bubbles=False),
        spark(140, 30, .9, 0), spark(22, 40, .7, 1.3),
    ]
    return f'<svg class="duo" viewBox="0 0 160 118">{DEFS}<ellipse cx="80" cy="60" rx="90" ry="62" fill="url(#glow)"/>{"".join(parts)}</svg>'
