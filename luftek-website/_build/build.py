"""Generate the Luftek static site from data.py.

Run from anywhere:  python3 luftek-website/_build/build.py
Writes *.html into luftek-website/ and luftek-website/products/.
"""
import json
import math
import os
from html import escape as e
from urllib.parse import quote

from data import FAMILIES, OFFICES, PRODUCTS, PROJECTS, SECTORS, TIMELINE

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BY_KEY = {p["key"]: p for p in PRODUCTS}
SITE = "https://www.luftek.in"

I = {  # inline icons, 24px grid, stroke = currentColor
    "arrow": '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    "phone": '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
    "mail": '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3z"/><path d="m3 7 9 6 9-6"/></svg>',
    "pin": '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    "down": '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M6 10l6 6 6-6M5 20h14"/></svg>',
    "chev": '<svg class="i i--s" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    "search": '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    "x": '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    "left": '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    "right": '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    "zoom": '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/></svg>',
    "check": '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
    "li": '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4v11H3zM9.5 9.75h3.8v1.5h.06c.53-.95 1.83-1.95 3.77-1.95 4.03 0 4.77 2.55 4.77 5.86v5.59h-4v-4.96c0-1.18-.02-2.7-1.7-2.7-1.7 0-1.96 1.3-1.96 2.62v5.04h-4z"/></svg>',
}


def cfm(p):
    return f"{p['cmin']:,} – {p['cmax']:,} CFM" if p["cmin"] else "Packaged DX"


def purl(root, p):
    return f"{root}products/{p['slug']}.html"


def img(root, name, alt, cls="", lazy=True, w=None, h=None):
    dims = f' width="{w}" height="{h}"' if w else ""
    return f'<img class="{cls}" src="{root}assets/img/{name}.webp" alt="{e(alt)}"{dims}{" loading=lazy decoding=async" if lazy else ""}>'


# ---------------------------------------------------------------- shell

def head(title, desc, root, path, extra=""):
    return f"""<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{SITE}/{path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Luftek Engineering">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="{SITE}/assets/img/p-clean-hero.webp">
<meta name="theme-color" content="#243847">
<link rel="icon" href="{root}assets/img/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{root}assets/css/style.css">
{extra}</head>
<body>
<a class="skip" href="#main">Skip to content</a>
"""


def header(root, active):
    def nav(key, href, label):
        cur = ' aria-current="page"' if key == active else ""
        return f'<a class="hdr__link" href="{root}{href}"{cur}>{label}</a>'

    mega_cols = ""
    for fk, f in FAMILIES.items():
        items = "".join(
            f'<li><a href="{purl(root, p)}"><span class="mega__thumb">{img(root, p["imgs"][0], "")}</span>'
            f'<span><b>{e(p["name"])}</b><small>{e(cfm(p))}</small></span></a></li>'
            for p in PRODUCTS if p["fam"] == fk)
        mega_cols += f'<div class="mega__col"><p class="mega__h">{f["name"]}</p><ul>{items}</ul></div>'

    prod_cur = ' aria-current="page"' if active == "products" else ""
    return f"""<div class="util">
  <div class="wrap util__in">
    <p class="util__note">Manufacturer of air handling units, fan coil units and package units · Cheyyar SIPCOT, Tamil Nadu</p>
    <div class="util__links">
      <a href="mailto:sales@luftek.in">{I['mail']}sales@luftek.in</a>
      <a href="tel:+914448678556">{I['phone']}+91 44 4867 8556</a>
      <a href="https://www.linkedin.com/company/luftek/" rel="noopener" aria-label="Luftek on LinkedIn">{I['li']}</a>
    </div>
  </div>
</div>
<header class="hdr" id="top">
  <div class="hdr__in">
    <a class="hdr__logo" href="{root}index.html" aria-label="Luftek Engineering home"><img src="{root}assets/img/logo.png" alt="Luftek" width="170" height="27"></a>
    <nav class="hdr__nav" aria-label="Primary">
      {nav("home", "index.html", "Home")}
      {nav("about", "about.html", "About")}
      <div class="hdr__drop">
        <button class="hdr__link hdr__mega-btn" aria-expanded="false" aria-controls="mega"{prod_cur}>Products {I['chev']}</button>
      </div>
      {nav("industries", "industries.html", "Industries")}
      {nav("projects", "projects.html", "Projects")}
      {nav("certs", "certifications.html", "Certification")}
      {nav("contact", "contact.html", "Contact")}
    </nav>
    <a class="btn btn--red hdr__cta" href="{root}contact.html">Request a selection</a>
    <button class="hdr__burger" aria-label="Menu" aria-expanded="false" aria-controls="drawer"><span></span><span></span><span></span></button>
  </div>
  <div class="mega" id="mega" hidden>
    <div class="wrap mega__in">
      {mega_cols}
      <a class="mega__feature" href="{root}products.html#selector">
        <span class="mega__fk">Not sure which unit?</span>
        <b>Use the unit selector</b>
        <span>Enter airflow and application, get a shortlist in seconds.</span>
        <span class="mega__go">Open selector {I['arrow']}</span>
      </a>
    </div>
    <div class="wrap mega__foot"><a href="{root}products.html">View the full product range {I['arrow']}</a></div>
  </div>
</header>
<div class="drawer" id="drawer" hidden>
  <nav aria-label="Mobile">
    <a href="{root}index.html">Home</a>
    <a href="{root}about.html">About</a>
    <details><summary>Products {I['chev']}</summary>
      <a href="{root}products.html">All products</a>
      {''.join(f'<a href="{purl(root, p)}">{e(p["name"])}</a>' for p in PRODUCTS)}
    </details>
    <a href="{root}industries.html">Industries</a>
    <a href="{root}projects.html">Projects</a>
    <a href="{root}certifications.html">Certification</a>
    <a href="{root}contact.html">Contact</a>
  </nav>
  <a class="btn btn--red" href="{root}contact.html">Request a selection</a>
  <p class="drawer__c"><a href="tel:+914448678556">+91 44 4867 8556</a><br><a href="mailto:sales@luftek.in">sales@luftek.in</a></p>
</div>
"""


def footer(root):
    prods = "".join(f'<li><a href="{purl(root, p)}">{e(p["name"])}</a></li>' for p in PRODUCTS[:6])
    return f"""<section class="cta-band">
  <div class="wrap cta-band__in">
    <div>
      <h2>Send us your equipment schedule.</h2>
      <p>Share airflow, static pressure and application. Our engineers reply within 24 hours on working days with a selection and datasheet.</p>
    </div>
    <div class="cta-band__btns">
      <a class="btn btn--red btn--lg" href="{root}contact.html">Request a selection {I['arrow']}</a>
      <a class="btn btn--ghost-light btn--lg" href="tel:+914448678556">{I['phone']} +91 44 4867 8556</a>
    </div>
  </div>
</section>
<footer class="foot">
  <div class="wrap foot__in">
    <div class="foot__brand">
      <img src="{root}assets/img/logo.png" alt="Luftek" width="180" height="29" loading="lazy">
      <p>Luftek Engineering Private Limited designs and manufactures air conditioning products for commercial, industrial, hospital, pharma and special applications.</p>
      <div class="foot__marks"><span>Eurovent</span><span>AHRI 410</span><span>ISO 9001:2015</span></div>
    </div>
    <div><h2 class="foot__h">Company</h2><ul>
      <li><a href="{root}about.html">About Luftek</a></li><li><a href="{root}about.html#plant">Manufacturing plant</a></li>
      <li><a href="{root}industries.html">Industries</a></li><li><a href="{root}projects.html">Projects</a></li><li><a href="{root}certifications.html">Certification</a></li>
      <li><a href="{root}assets/docs/luftek-quality-policy.pdf">Quality policy (PDF)</a></li><li><a href="{root}contact.html">Contact</a></li><li><a href="{root}privacy-policy.html">Privacy policy</a></li></ul></div>
    <div><h2 class="foot__h">Products</h2><ul>{prods}<li><a href="{root}products.html">All products</a></li></ul></div>
    <div><h2 class="foot__h">Branches</h2><ul class="foot__plain">
      <li>Chennai <span>Corporate office</span></li><li>Cheyyar <span>Manufacturing plant</span></li>
      <li>Bengaluru</li><li>Hyderabad</li><li>Kochi</li><li>Mumbai</li></ul></div>
    <div><h2 class="foot__h">Reach us</h2><ul>
      <li><a href="mailto:sales@luftek.in">sales@luftek.in</a></li><li><a href="mailto:info@luftek.in">info@luftek.in</a></li>
      <li><a href="tel:+914448678556">+91 44 4867 8556</a></li><li><a href="tel:+914427663323">+91 44 2766 3323</a></li></ul>
      <p class="foot__hours">Mon – Sat, 9:00 am – 6:00 pm</p>
      <a class="foot__social" href="https://www.linkedin.com/company/luftek/" rel="noopener" aria-label="Luftek on LinkedIn">{I['li']}</a>
    </div>
  </div>
  <div class="foot__bar"><div class="wrap foot__bar-in">
    <p>© <span data-year>2026</span> Luftek Engineering Pvt Ltd. All rights reserved.</p>
    <p>Luftek® is a registered trademark of Luftek Engineering Pvt Ltd.</p>
  </div></div>
</footer>
<div class="lb" id="lightbox" hidden role="dialog" aria-modal="true" aria-label="Image viewer">
  <button class="lb__x" aria-label="Close">{I['x']}</button>
  <button class="lb__nav lb__prev" aria-label="Previous">{I['left']}</button>
  <figure class="lb__fig"><img alt=""><figcaption></figcaption></figure>
  <button class="lb__nav lb__next" aria-label="Next">{I['right']}</button>
</div>
<script src="{root}assets/js/main.js" defer></script>
</body>
</html>
"""


def page_hero(crumbs, title, lede, root, img_name=None, dark=True):
    cr = " ".join(f'<a href="{root}{h}">{e(t)}</a><span aria-hidden="true">/</span>' for t, h in crumbs[:-1])
    pic = f'<div class="ph__img">{img(root, img_name, "", lazy=False)}</div>' if img_name else ""
    return f"""<section class="ph{' ph--dark' if dark else ''}{' ph--img' if img_name else ''}">
  {pic}
  <div class="wrap ph__in">
    <nav class="crumbs" aria-label="Breadcrumb">{cr}<span aria-current="page">{e(crumbs[-1][0])}</span></nav>
    <h1>{title}</h1>
    <p class="ph__lede">{lede}</p>
  </div>
</section>"""


def write(path, html):
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(html)


# ---------------------------------------------------------------- shared blocks

def product_card(root, p, extra_cls=""):
    fam = FAMILIES[p["fam"]]["name"]
    return f"""<a class="pcard {extra_cls}" href="{purl(root, p)}" data-fam="{p['fam']}">
  <span class="pcard__img">{img(root, p['imgs'][0], p['title'])}</span>
  <span class="pcard__body">
    <span class="pcard__fam">{fam}</span>
    <b class="pcard__name">{e(p['name'])}</b>
    <span class="pcard__tag">{e(p['tag'])}</span>
    <span class="pcard__meta"><span>{e(cfm(p))}</span><span class="pcard__go">{I['arrow']}</span></span>
  </span>
</a>"""


def selector(root):
    apps = [("comfort", "Offices & commercial"), ("clean", "Hospital / pharma clean area"), ("rooms", "Hotel rooms & wards"),
            ("energy", "High fresh air"), ("halls", "Halls, no chilled water")]
    chips = "".join(f'<button type="button" class="chip" data-app="{k}" aria-pressed="{str(i == 0).lower()}">{v}</button>' for i, (k, v) in enumerate(apps))
    return f"""<section class="sec sec--grey" id="selector">
  <div class="wrap">
    <div class="sec__head sec__head--split">
      <div><p class="kicker">Unit selector</p><h2>Find the right unit for your duty.</h2></div>
      <p>Set the airflow and the application. The shortlist updates instantly from Luftek's published ranges. Final selection is always confirmed by our engineers.</p>
    </div>
    <div class="sel" data-selector data-root="{root}">
      <div class="sel__controls">
        <label class="sel__label" for="sel-cfm">Design airflow</label>
        <div class="sel__val"><output id="sel-out">6,000</output> <span>CFM</span></div>
        <input id="sel-cfm" type="range" min="0" max="1000" value="620" aria-describedby="sel-scale">
        <div class="sel__scale" id="sel-scale"><span>200</span><span>1,000</span><span>5,000</span><span>42,000</span></div>
        <p class="sel__label">Application</p>
        <div class="chips">{chips}</div>
      </div>
      <div class="sel__results" aria-live="polite"><p class="sel__count"></p><div class="sel__list"></div></div>
    </div>
  </div>
</section>"""


def data_script(root):
    d = {
        "products": [{"key": p["key"], "name": p["name"], "fam": p["fam"], "famName": FAMILIES[p["fam"]]["name"],
                      "cmin": p["cmin"], "cmax": p["cmax"], "img": p["imgs"][0], "url": f"products/{p['slug']}.html",
                      "tag": p["tag"]} for p in PRODUCTS],
    }
    return f'<script type="application/json" id="ldata">{json.dumps(d)}</script>'


# ---------------------------------------------------------------- pages

def page_home():
    root = ""
    slides_keys = ["clean", "uniflow", "smart", "eru", "hideaway", "deco"]
    slides, tabs = "", ""
    for i, k in enumerate(slides_keys):
        p = BY_KEY[k]
        keys = "".join(f"<div><dt>{e(a)}</dt><dd>{e(b)} <small>{e(c)}</small></dd></div>" for a, b, c in p["keys"][:3])
        slides += f"""<div class="hs__slide" data-i="{i}"{'' if i == 0 else ' hidden'}>
      <div class="hs__copy">
        <p class="hs__fam">{FAMILIES[p['fam']]['name']}</p>
        <h2 class="hs__name">{e(p['name'])}</h2>
        <p class="hs__tag">{e(p['tag'])}</p>
        <dl class="hs__keys">{keys}</dl>
        <div class="hs__btns"><a class="btn btn--dark" href="{purl(root, p)}">Explore the unit {I['arrow']}</a><a class="btn btn--line" href="contact.html?product={quote(p['name'])}">Request a selection</a></div>
      </div>
      <div class="hs__img">{img(root, p['imgs'][0], p['title'], lazy=(i != 0))}</div>
    </div>"""
        tabs += f'<button class="hs__tab" data-i="{i}" aria-label="Show {e(p["name"])}"{" aria-current=\"true\"" if i == 0 else ""}><span class="hs__bar"><i></i></span><b>{i + 1:02d}</b> {e(p["name"])}</button>'

    fam_cards = ""
    for fk, f in FAMILIES.items():
        items = [p for p in PRODUCTS if p["fam"] == fk]
        links = "".join(f'<li><a href="{purl(root, p)}">{e(p["name"])} <span>{e(cfm(p))}</span></a></li>' for p in items)
        fam_cards += f"""<article class="fam">
      <a class="fam__img" href="products.html#{fk}" tabindex="-1">{img(root, f['img'], f['name'])}</a>
      <div class="fam__body">
        <p class="fam__n">{len(items)} product line{'s' if len(items) > 1 else ''}</p>
        <h3><a href="products.html#{fk}">{f['name']}</a></h3>
        <p>{f['blurb']}</p>
        <ul class="fam__list">{links}</ul>
      </div>
    </article>"""

    spots = [
        (60.5, 52.7, "Direct-drive plug fan", "AC or EC motor, no belts to wear. Fans certified to AMCA 210 for performance and AMCA 300 for sound."),
        (15.6, 35.0, "Coil section", "AHRI 410 certified chilled water and hot water coils, so the duty on the datasheet is the duty on site."),
        (34.2, 54.0, "50 mm double-skin panel", "Injected PU foam between a precoated outer skin and a galvanised inner skin. Rockwool, aluminium and stainless steel are options."),
        (72.8, 24.0, "Thermal-break aluminium frame", "Extruded profiles with a thermal break, rated TB2 under EN 1886, so the casing does not sweat in humid climates."),
        (21.5, 80.0, "Stainless steel drain pan", "Sloped for complete condensate removal. No standing water means nothing grows inside the unit."),
        (9.3, 48.0, "Filter section", "ISO 16890 / EN 779 certified filters, sealed to an F9 filter bypass class so air cannot slip round them."),
    ]
    hs = "".join(f'<button class="spot" style="left:{x}%;top:{y}%" data-i="{i}" aria-label="{e(t)}"><span>{i + 1}</span></button>' for i, (x, y, t, d) in enumerate(spots))
    hs_list = "".join(f'<li data-i="{i}"{" class=is-on" if i == 0 else ""}><button type="button"><b>{i + 1:02d}</b>{e(t)}</button><p>{e(d)}</p></li>' for i, (x, y, t, d) in enumerate(spots))

    sec_tabs, sec_panels = "", ""
    for i, (sk, s) in enumerate(SECTORS.items()):
        projs = [p for p in PROJECTS if p[4] == sk]
        units = "".join(f'<a href="{purl(root, BY_KEY[u])}">{e(BY_KEY[u]["name"])}</a>' for u in s["units"])
        names = ", ".join(p[1] for p in projs[:4]) + (f" and {len(projs) - 4} more" if len(projs) > 4 else "")
        sec_tabs += f'<button role="tab" id="st-{sk}" aria-controls="sp-{sk}" aria-selected="{str(i == 0).lower()}" tabindex="{0 if i == 0 else -1}">{s["name"]}<span>{len(projs)}</span></button>'
        sec_panels += f"""<div class="ind__panel" role="tabpanel" id="sp-{sk}" aria-labelledby="st-{sk}"{'' if i == 0 else ' hidden'}>
      <div class="ind__img">{img(root, s['img'], s['name'])}</div>
      <div class="ind__body">
        <h3>{s['name']}</h3>
        <p>{e(s['need'])}</p>
        <p class="ind__k">Suited Luftek units</p>
        <div class="ind__units">{units}</div>
        <p class="ind__k">Reference projects</p>
        <p class="ind__refs">{e(names)}</p>
        <div class="ind__links"><a class="link" href="industries.html#{sk}">{s['name']} in detail {I['arrow']}</a><a class="link" href="projects.html?sector={sk}">See projects {I['arrow']}</a></div>
      </div>
    </div>"""

    rail = "".join(f"""<a class="rcard" href="projects.html?p={f}">
      <span class="rcard__img">{img(root, 'r-' + f, n)}</span>
      <span class="rcard__body"><span class="rcard__s">{SECTORS[s]['name']}</span><b>{e(n)}</b><span>{e(c)}, {e(co)}</span></span></a>"""
                   for f, n, c, co, s in [PROJECTS[i] for i in (0, 2, 7, 11, 20, 30, 34, 1, 8, 12)])

    certs = "".join(f'<li><b>{a}</b><span>{b}</span></li>' for a, b in [
        ("Eurovent", "AHU performance and casing"), ("AHRI 410", "Coil performance"), ("AHRI 1061", "Energy recovery"),
        ("EN 1886", "Casing classes"), ("AMCA 210 / 300", "Fan air and sound"), ("ISO 9001:2015", "Quality system")])

    body = f"""{head("Luftek Engineering | Air Handling Units & Fan Coil Units Manufacturer, Chennai", "Luftek designs and manufactures Eurovent-certified air handling units, fan coil units and roof top package units at Cheyyar SIPCOT, Tamil Nadu. 200 to 42,000 CFM. AHRI 410 certified coils.", root, "")}
{header(root, "home")}
<main id="main">
<section class="hs" data-carousel aria-roledescription="carousel" aria-label="Featured products">
  <div class="wrap hs__in">
    <div class="hs__intro">
      <p class="kicker">Luftek Engineering · Since 2017</p>
      <h1>Air handling equipment, engineered and built in India to European standards.</h1>
    </div>
    <div class="hs__stage">{slides}</div>
    <div class="hs__tabs" role="group" aria-label="Choose product">{tabs}</div>
  </div>
</section>

<section class="stats" aria-label="Luftek in numbers">
  <div class="wrap stats__in">
    <div><b>2017</b><span>Established</span></div>
    <div><b data-count="10">10</b><span>Product lines</span></div>
    <div><b data-count="42000">42,000</b><span>CFM maximum airflow</span></div>
    <div><b data-count="6">6</b><span>Offices and plant</span></div>
    <div><b data-count="37" data-suffix="+">37+</b><span>Reference projects</span></div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="sec__head sec__head--split">
      <div><p class="kicker">Product range</p><h2>Three families. Ten product lines.</h2></div>
      <p>Every Luftek unit is designed and built in our own plant, and customised to each project's construction, size and performance requirements.</p>
    </div>
    <div class="fams">{fam_cards}</div>
  </div>
</section>

<section class="sec sec--slate">
  <div class="wrap">
    <div class="sec__head sec__head--split">
      <div><p class="kicker kicker--light">Inside the casing</p><h2>What makes a Luftek AHU hold its rating.</h2></div>
      <p>Tap a point on the Clean Room Unit to see how it is built.</p>
    </div>
    <div class="hot" data-hotspots>
      <div class="hot__stage">{img(root, 'p-clean-open', 'Luftek Clean Room AHU with fan section door open, showing the plug fan')}{hs}</div>
      <ol class="hot__list">{hs_list}</ol>
    </div>
  </div>
</section>

{selector(root)}

<section class="sec">
  <div class="wrap">
    <div class="sec__head sec__head--split">
      <div><p class="kicker">Industries</p><h2>Built for the buildings that can't afford downtime.</h2></div>
      <p>Each sector puts different demands on air handling. Here is what matters and which units suit it.</p>
    </div>
    <div class="ind" data-tabs>
      <div class="ind__tabs" role="tablist" aria-label="Industries">{sec_tabs}</div>
      {sec_panels}
    </div>
  </div>
</section>

<section class="sec sec--grey">
  <div class="wrap">
    <div class="sec__head sec__head--split">
      <div><p class="kicker">Projects</p><h2>Running across India, the Gulf and Sri Lanka.</h2></div>
      <div class="rail-ctrl"><a class="link" href="projects.html">All 37 projects {I['arrow']}</a><button class="rbtn" data-rail-prev aria-label="Previous">{I['left']}</button><button class="rbtn" data-rail-next aria-label="Next">{I['right']}</button></div>
    </div>
  </div>
  <div class="rail" data-rail><div class="rail__track">{rail}</div></div>
</section>

<section class="sec">
  <div class="wrap split">
    <div class="split__img">{img(root, 'x-plant', 'Luftek manufacturing plant at Cheyyar SIPCOT')}<span class="split__tag">{I['pin']} Cheyyar SIPCOT, Tamil Nadu</span></div>
    <div class="split__body">
      <p class="kicker">About Luftek</p>
      <h2>Our own plant. Our own engineering team.</h2>
      <p>Luftek was established in 2017 to cater to the HVAC industry with products that suit any design requirement for indoor air quality, are energy efficient and eco-friendly, take less space and come at an affordable cost.</p>
      <p>In 2024 we opened a new factory at Cheyyar SIPCOT with modern machinery, building for commercial, industrial, hospital, pharma and special applications.</p>
      <ul class="ticks"><li>{I['check']} Design to EN and AHRI standards</li><li>{I['check']} Customised construction, size and performance</li><li>{I['check']} Teams across mechanical, fluid dynamics, acoustics and controls</li></ul>
      <a class="btn btn--dark" href="about.html">Our story {I['arrow']}</a>
    </div>
  </div>
</section>

<section class="certs-band">
  <div class="wrap certs-band__in"><p>Certified performance</p><ul>{certs}</ul><a class="link" href="certifications.html">Certification {I['arrow']}</a></div>
</section>
</main>
{data_script(root)}
{footer(root)}"""
    write("index.html", body)


def page_products():
    root = ""
    rows = ""
    LMIN, LMAX = 2.0, 4.7  # log10 axis 100 .. ~50,000 CFM
    for p in PRODUCTS:
        if not p["cmin"]:
            continue
        a = (math.log10(p["cmin"]) - LMIN) / (LMAX - LMIN) * 100
        b = (math.log10(p["cmax"]) - LMIN) / (LMAX - LMIN) * 100
        rows += f"""<a class="rng__row" href="{purl(root, p)}" data-fam="{p['fam']}">
      <span class="rng__name">{e(p['name'])}</span>
      <span class="rng__track"><span class="rng__bar rng__bar--{p['fam']}{' rng__bar--in' if b - a > 30 else ''}" style="left:{a:.2f}%;width:{b - a:.2f}%"><span class="rng__lbl">{e(cfm(p))}</span></span></span></a>"""
    ticks = "".join(f'<span style="left:{(math.log10(v) - LMIN) / (LMAX - LMIN) * 100:.2f}%">{v:,}</span>' for v in (200, 500, 1000, 2000, 5000, 10000, 20000, 42000))

    groups = ""
    for fk, f in FAMILIES.items():
        cards = "".join(product_card(root, p) for p in PRODUCTS if p["fam"] == fk)
        groups += f"""<div class="pgroup" id="{fk}" data-fam="{fk}">
      <div class="pgroup__head"><h2>{f['name']}</h2><p>{f['blurb']}</p></div>
      <div class="pgrid">{cards}</div>
    </div>"""

    def cell(p, kind):
        if kind == "esp":
            return f"{p['esp']} Pa" if p.get("esp") else "Project specific"
        if kind == "casing":
            return {"ahu": "50 mm double skin", "fcu": "Single skin / 25 mm DS"}.get(p["fam"], "Packaged")
        if kind == "cert":
            return "Eurovent · AHRI 410" if p["fam"] == "ahu" else ("AHRI 410" if p["key"] == "hideaway" else ("ESMA" if p["key"] == "rtpu" else "—"))
    trs = "".join(f'<tr><th scope="row"><a href="{purl(root, p)}">{e(p["name"])}</a></th><td>{FAMILIES[p["fam"]]["short"]}</td><td class="num">{e(cfm(p))}</td><td>{cell(p, "esp")}</td><td>{cell(p, "casing") if p["key"] != "hideaway" else "25 / 40 mm double skin"}</td><td>{cell(p, "cert")}</td></tr>' for p in PRODUCTS)

    body = f"""{head("Products | Air Handling Units, Fan Coil Units & Package Units | Luftek", "Luftek's full range: UniFlow, Smart, Clean Room and Energy Recovery AHUs, fan coil units, hide away units and roof top package units. Compare airflow, casing and certification.", root, "products.html")}
{header(root, "products")}
<main id="main">
{page_hero([("Home", "index.html"), ("Products", "products.html")], "Products", "Ten product lines across air handling units, fan coil units and package units. Compare airflow ranges, find your unit, or go straight to a datasheet.", root, "x-concealed")}

<nav class="fambar" aria-label="Product families" data-fambar>
  <div class="wrap fambar__in">
    <button aria-pressed="true" data-f="all">All products</button>
    {''.join(f'<button aria-pressed="false" data-f="{k}">{f["name"]}</button>' for k, f in FAMILIES.items())}
    <a class="fambar__sel" href="#selector">Unit selector {I['arrow']}</a>
  </div>
</nav>

<section class="sec sec--tight">
  <div class="wrap">{groups}</div>
</section>

<section class="sec sec--grey">
  <div class="wrap">
    <div class="sec__head sec__head--split">
      <div><p class="kicker">Airflow coverage</p><h2>Which units cover your airflow.</h2></div>
      <p>Each bar shows a product's published airflow range on a logarithmic scale. Select a bar to open the product.</p>
    </div>
    <div class="rng" data-range>
      <div class="rng__axis" aria-hidden="true"><span class="rng__name"></span><span class="rng__ticks">{ticks}</span></div>
      {rows}
      <div class="rng__axis rng__axis--unit" aria-hidden="true"><span class="rng__name"></span><span>Airflow, CFM (log scale)</span></div>
      <div class="rng__legend"><span class="lg lg--ahu">Air handling units</span><span class="lg lg--fcu">Fan coil units</span></div>
    </div>
  </div>
</section>

{selector(root)}

<section class="sec">
  <div class="wrap">
    <div class="sec__head"><p class="kicker">Comparison</p><h2>The range at a glance.</h2></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th scope="col">Product</th><th scope="col">Family</th><th scope="col">Airflow</th><th scope="col">Rated ESP</th><th scope="col">Casing</th><th scope="col">Certification</th></tr></thead>
      <tbody>{trs}</tbody>
    </table></div>
  </div>
</section>
</main>
{data_script(root)}
{footer(root)}"""
    write("products.html", body)


def page_product(p):
    root = "../"
    fam = FAMILIES[p["fam"]]
    thumbs = "".join(f'<button class="gal__th{" is-on" if i == 0 else ""}" data-i="{i}" aria-label="View image {i + 1}">{img(root, n, "")}</button>' for i, n in enumerate(p["imgs"]))
    gal_items = json.dumps([f"{root}assets/img/{n}.webp" for n in p["imgs"]])
    keys = "".join(f'<div class="kt"><dt>{e(a)}</dt><dd>{e(b)}<small>{e(c)}</small></dd></div>' for a, b, c in p["keys"])
    feats = "".join(f"<li>{I['check']}<span>{e(x)}</span></li>" for x in p["features"])
    tech = "".join(f'<tr><th scope="row">{e(a)}</th><td>{e(b)}</td></tr>' for a, b in p["tech"])

    en_html = ""
    if p["en"]:
        scale = {"Thermal conductivity": ["T1", "T2", "T3", "T4", "T5"], "Thermal bridging": ["TB1", "TB2", "TB3", "TB4", "TB5"],
                 "Casing strength": ["D1", "D2", "D3"], "Casing leakage": ["L1", "L2", "L3"], "Filter bypass leakage": ["F9", "F8", "F7", "G1–M6"]}
        rows = ""
        for name, val in p["en"]:
            cls = scale[name]
            pills = "".join(f'<span class="{"on" if c == val else ""}">{c}</span>' for c in cls)
            rows += f'<div class="enr"><span class="enr__n">{name}</span><span class="enr__s">{pills}</span></div>'
        extra = "".join(f'<li><b>{e(a)}</b> {e(b)}</li>' for a, b in p["en_extra"])
        en_html = f"""<section class="pd__sec" id="rating">
        <h2>EN 1886 casing rating <small>502LK series</small></h2>
        <p>EN 1886 grades how an assembled AHU casing performs. The highlighted class is Luftek's certified rating; the left-most class is the best possible.</p>
        <div class="enscale">{rows}</div>
        {f'<ul class="enx">{extra}</ul>' if extra else ''}
        <a class="link" href="{root}certifications.html#en1886">What each class means {I['arrow']}</a>
      </section>"""

    certs_html = ""
    if p["certs"]:
        certs_html = f"""<section class="pd__sec" id="certification"><h2>Certification</h2>
        <ul class="clist">{''.join(f"<li>{I['check']}<span>{e(c)}</span></li>" for c in p['certs'])}</ul></section>"""

    apps = ""
    for sk in p["apps"]:
        s = SECTORS[sk]
        projs = [x for x in PROJECTS if x[4] == sk]
        apps += f"""<a class="acard" href="{root}projects.html?sector={sk}">
        <span class="acard__img">{img(root, s['img'], s['name'])}</span>
        <span class="acard__b"><b>{s['name']}</b><span>{len(projs)} reference projects</span></span></a>"""

    related = [x for x in PRODUCTS if x["fam"] == p["fam"] and x["key"] != p["key"]][:3]
    if len(related) < 3:
        related += [x for x in PRODUCTS if x["fam"] != p["fam"] and x["key"] != p["key"]][: 3 - len(related)]
    rel = "".join(product_card(root, x) for x in related)

    subnav = [("overview", "Overview"), ("features", "Features"), ("technical", "Technical data")]
    if p["en"]:
        subnav.append(("rating", "EN 1886 rating"))
    if p["certs"]:
        subnav.append(("certification", "Certification"))
    subnav.append(("applications", "Applications"))
    sn = "".join(f'<a href="#{a}">{b}</a>' for a, b in subnav)

    ld = {"@context": "https://schema.org", "@type": "Product", "name": f"Luftek {p['title']}", "description": p["intro"],
          "brand": {"@type": "Brand", "name": "Luftek"}, "manufacturer": {"@type": "Organization", "name": "Luftek Engineering Private Limited"},
          "image": f"{SITE}/assets/img/{p['imgs'][0]}.webp", "category": fam["name"]}

    body = f"""{head(f"{p['title']} | Luftek Engineering", f"Luftek {p['title']}: {p['tag']}. {cfm(p)}. Specifications, features and certification.", root, f"products/{p['slug']}.html", f'<script type="application/ld+json">{json.dumps(ld)}</script>')}
{header(root, "products")}
<main id="main" class="pd">
  <div class="wrap">
    <nav class="crumbs crumbs--dark" aria-label="Breadcrumb"><a href="{root}index.html">Home</a><span aria-hidden="true">/</span><a href="{root}products.html">Products</a><span aria-hidden="true">/</span><a href="{root}products.html#{p['fam']}">{fam['name']}</a><span aria-hidden="true">/</span><span aria-current="page">{e(p['name'])}</span></nav>
    <div class="pd__top">
      <div class="gal" data-gallery='{gal_items}' data-caption="Luftek {e(p['title'])}">
        <button class="gal__main" aria-label="Enlarge image">{img(root, p['imgs'][0], 'Luftek ' + p['title'], lazy=False)}<span class="gal__zoom">{I['zoom']}</span></button>
        <div class="gal__ths">{thumbs}</div>
      </div>
      <div class="pd__info">
        <p class="kicker">{fam['name']}</p>
        <h1>{e(p['title'])}</h1>
        <p class="pd__tag">{e(p['tag'])}</p>
        <dl class="kts">{keys}</dl>
        <div class="pd__btns">
          <a class="btn btn--red btn--lg" href="{root}contact.html?product={quote(p['name'])}">Request a selection {I['arrow']}</a>
          <a class="btn btn--line btn--lg" href="mailto:sales@luftek.in?subject={quote('Datasheet request: ' + p['title'])}">{I['down']} Ask for datasheet</a>
        </div>
        <p class="pd__note">Selections and datasheets are prepared by Luftek engineers for your exact duty.</p>
      </div>
    </div>
  </div>

  <nav class="subnav" aria-label="On this page" data-subnav><div class="wrap subnav__in">{sn}</div></nav>

  <div class="wrap pd__body">
    <div class="pd__main">
      <section class="pd__sec" id="overview"><h2>Overview</h2><p class="pd__lead">{e(p['intro'])}</p></section>
      <section class="pd__sec" id="features"><h2>Salient features</h2><ul class="flist">{feats}</ul></section>
      <section class="pd__sec" id="technical"><h2>Technical data</h2><table class="spec">{tech}</table></section>
      {en_html}
      {certs_html}
      <section class="pd__sec" id="applications"><h2>Applications</h2><p>Sectors where this unit fits, with Luftek's reference projects in each.</p><div class="acards">{apps}</div></section>
    </div>
    <aside class="pd__aside">
      <div class="askbox">
        <p class="kicker">Talk to an engineer</p>
        <p>Send the airflow, ESP and coil duty. We reply within 24 hours on working days.</p>
        <a class="btn btn--red" href="{root}contact.html?product={quote(p['name'])}">Request a selection</a>
        <a class="askbox__l" href="tel:+914448678556">{I['phone']} +91 44 4867 8556</a>
        <a class="askbox__l" href="mailto:sales@luftek.in">{I['mail']} sales@luftek.in</a>
      </div>
    </aside>
  </div>

  <section class="sec sec--grey">
    <div class="wrap">
      <div class="sec__head sec__head--split"><div><p class="kicker">Related</p><h2>Other units to consider.</h2></div><a class="link" href="{root}products.html">All products {I['arrow']}</a></div>
      <div class="pgrid">{rel}</div>
    </div>
  </section>
</main>
{footer(root)}"""
    write(f"products/{p['slug']}.html", body)


def page_projects():
    root = ""
    chips = '<button class="chip" data-s="all" aria-pressed="true">All <span>{}</span></button>'.format(len(PROJECTS))
    chips += "".join(f'<button class="chip" data-s="{k}" aria-pressed="false">{s["name"]} <span>{sum(1 for p in PROJECTS if p[4] == k)}</span></button>' for k, s in SECTORS.items())
    cards = "".join(f"""<li class="pj" data-s="{s}" data-id="{f}" data-q="{e((n + ' ' + c + ' ' + co + ' ' + SECTORS[s]['name']).lower())}">
      <button class="pj__btn" aria-label="View {e(n)}">
        <span class="pj__img">{img(root, 'r-' + f, n)}</span>
        <span class="pj__body"><span class="pj__s">{SECTORS[s]['name']}</span><b>{e(n)}</b><span class="pj__loc">{I['pin']}{e(c)}, {e(co)}</span></span>
      </button></li>""" for f, n, c, co, s in PROJECTS)
    cities = {}
    for f, n, c, co, s in PROJECTS:
        cities.setdefault((c, co), 0)
        cities[(c, co)] += 1
    city_btns = "".join(f'<button class="city" data-city="{e(c.lower())}"><b>{e(c)}</b><span>{co}</span><i>{k}</i></button>' for (c, co), k in sorted(cities.items(), key=lambda x: -x[1]))
    pdata = json.dumps({f: {"name": n, "city": c, "country": co, "sector": s, "sectorName": SECTORS[s]["name"], "need": SECTORS[s]["need"],
                            "units": [{"name": BY_KEY[u]["name"], "url": f"products/{BY_KEY[u]['slug']}.html"} for u in SECTORS[s]["units"]]}
                        for f, n, c, co, s in PROJECTS})

    sectors_sum = "".join(f"""<div class="ss"><b>{s['name']}</b><span>{sum(1 for p in PROJECTS if p[4] == k)}</span></div>""" for k, s in SECTORS.items())

    body = f"""{head("Projects & References | Luftek Engineering", "37 reference projects: Kempegowda and GMR Hyderabad airports, Apollo and MIOT hospitals, Pfizer, Renault Nissan, Kia, Flipkart, IIT Madras and more, across India, Qatar and Sri Lanka.", root, "projects.html")}
{header(root, "projects")}
<main id="main">
{page_hero([("Home", "index.html"), ("Projects", "projects.html")], "Projects", "Airports, hospitals, pharma plants, factories, campuses and offices across India, Qatar and Sri Lanka run on Luftek air handling equipment.", root, "r-GMR-Hyd-Intl-Airport")}

<section class="pstats">
  <div class="wrap pstats__in">
    <div class="pstats__big"><b data-count="37">37</b><span>reference projects</span></div>
    <div class="pstats__big"><b data-count="3">3</b><span>countries</span></div>
    <div class="pstats__big"><b data-count="{len(cities)}">{len(cities)}</b><span>cities</span></div>
    <div class="pstats__sec">{sectors_sum}</div>
  </div>
</section>

<section class="sec sec--tight" data-projects>
  <div class="wrap">
    <div class="pfil">
      <div class="chips" role="group" aria-label="Filter by sector">{chips}</div>
      <label class="psearch">{I['search']}<span class="sr">Search projects</span><input type="search" placeholder="Search by name or city" data-psearch></label>
    </div>
    <p class="pcount" aria-live="polite"><b data-pcount>37</b> projects</p>
    <ul class="pjs">{cards}</ul>
    <p class="pempty" hidden>No projects match. <button class="link" data-preset>Clear filters</button></p>

    <div class="cities">
      <h2>By location</h2>
      <p>Select a city to filter the projects above.</p>
      <div class="cities__grid">{city_btns}</div>
    </div>
  </div>
</section>

<div class="pm" id="pmodal" hidden role="dialog" aria-modal="true" aria-labelledby="pm-title">
  <div class="pm__card">
    <button class="pm__x" aria-label="Close">{I['x']}</button>
    <div class="pm__img"><img alt=""></div>
    <div class="pm__body">
      <p class="kicker" data-pm="sectorName"></p>
      <h2 id="pm-title" data-pm="name"></h2>
      <p class="pm__loc">{I['pin']}<span data-pm="loc"></span></p>
      <h3>What this sector needs from air handling</h3>
      <p data-pm="need"></p>
      <h3>Luftek units suited to this sector</h3>
      <div class="pm__units" data-pm="units"></div>
      <div class="pm__nav"><button class="btn btn--line" data-pm-prev>{I['left']} Previous</button><button class="btn btn--line" data-pm-next>Next {I['right']}</button></div>
    </div>
  </div>
</div>
<script type="application/json" id="pdata">{pdata}</script>
</main>
{footer(root)}"""
    write("projects.html", body)


def page_about():
    root = ""
    tl = "".join(f'<li class="tl__item" data-y="{y}"><span class="tl__y">{y}</span><b>{e(t)}</b><p>{e(d)}</p></li>' for y, t, d in TIMELINE)
    years = "".join(f'<button data-y="{y}"{" aria-current=true" if i == 0 else ""}>{y}</button>' for i, (y, t, d) in enumerate(TIMELINE))
    body = f"""{head("About Luftek Engineering | AHU Manufacturer, Chennai", "Established in 2017, Luftek Engineering designs and manufactures HVAC airside products at its own plant at Cheyyar SIPCOT, Tamil Nadu.", root, "about.html")}
{header(root, "about")}
<main id="main">
{page_hero([("Home", "index.html"), ("About", "about.html")], "Engineering is our passion.", "Air conditioning products are our intellectual excellence, built with innovation and sustainability.", root, "x-plant")}

<section class="sec">
  <div class="wrap about">
    <div>
      <p class="kicker">Who we are</p>
      <h2>Quality, innovative air conditioning products since 2017.</h2>
    </div>
    <div class="about__txt">
      <p class="lead">Luftek® was established in 2017 with a vision to serve the HVAC industry with air conditioning products that meet any design requirement for better indoor air quality, while staying energy efficient, eco-friendly, compact and affordable.</p>
      <p>A state-of-the-art manufacturing facility near Chennai, with modern machinery and manufacturing processes, produces quality HVAC products for commercial, industrial, hospital, pharma and special applications.</p>
      <p>Our engineering team has comprehensive knowledge of engineering standards and requirements. Product design complies with EN and AHRI standards for mechanical and cooling performance, and every unit can be customised to the project's construction, size and performance requirements.</p>
    </div>
  </div>
</section>

<section class="sec sec--grey">
  <div class="wrap">
    <div class="vmc">
      <article><p class="kicker">Vision</p><h3>Sustainable solutions, consistent quality.</h3><p>To meet customer requirements with sustainable and eco-friendly solutions by delivering quality products consistently.</p></article>
      <article><p class="kicker">Mission</p><h3>A global player through engineering.</h3><p>To be a global player by launching products with leading-edge technology, through engineering excellence and research.</p></article>
      <article><p class="kicker">Commitment</p><h3>Reliable products to global standards.</h3><p>We design and manufacture products that are reliable, efficient and meet global standards, with the resources for development and continuous improvement.</p></article>
    </div>
  </div>
</section>

<section class="sec" id="timeline">
  <div class="wrap">
    <div class="sec__head sec__head--split"><div><p class="kicker">Our journey</p><h2>Eight years of building.</h2></div><div class="tl__years" data-tl-years>{years}</div></div>
    <ol class="tl" data-tl>{tl}</ol>
  </div>
</section>

<section class="sec sec--slate" id="plant">
  <div class="wrap split split--rev">
    <div class="split__img">{img(root, 'p-hideaway-inside', 'Inside a Luftek unit: belt-driven centrifugal fan and motor')}</div>
    <div class="split__body">
      <p class="kicker kicker--light">Manufacturing plant</p>
      <h2>Cheyyar SIPCOT, Tamil Nadu.</h2>
      <p>Our new factory, inaugurated in 2024, sits in the Cheyyar SIPCOT Industrial Complex Phase II. It builds AHUs, FCUs and package units for projects across India, the Gulf and Sri Lanka.</p>
      <p class="addr">{I['pin']} A 1/1, Cheyyar SIPCOT Industrial Complex Phase II, Perumulimedu, Cheyyar Taluk, Tiruvannamalai District, Tamil Nadu</p>
      <a class="btn btn--red" href="https://www.google.com/maps/search/?api=1&amp;query={quote('Cheyyar SIPCOT Industrial Complex Phase II')}" rel="noopener">Get directions {I['arrow']}</a>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap split">
    <div class="split__img">{img(root, 'x-motor', 'Fan coil motor and twin blowers')}</div>
    <div class="split__body">
      <p class="kicker">Research &amp; development</p>
      <h2>Great ideas need intensive research.</h2>
      <p>Our investment in R&amp;D supports our commitment to innovation. Highly skilled engineers dedicated to AHU design keep finding new ways to improve Luftek machines.</p>
      <p>The team spans electrical and mechanical engineering, fluid dynamics, design, testing, acoustics and controls. That range of backgrounds lets us approach each challenge from every angle, and design AHUs and heat recovery units that achieve optimum performance.</p>
    </div>
  </div>
</section>

<section class="sec sec--grey">
  <div class="wrap qp">
    <div>
      <p class="kicker">Quality policy</p>
      <blockquote>“We are committed to establishing ourselves as a manufacturer of reliable and energy-efficient heating, ventilation and air conditioning equipment. We commit to high-quality products, on-time delivery, on-time servicing and customer satisfaction.”</blockquote>
      <p class="qp__src">Luftek Quality System Manual, LE/QMS/05 · 23 June 2025</p>
    </div>
    <a class="doc" href="assets/docs/luftek-quality-policy.pdf"><span class="doc__ic">PDF</span><span><b>Quality policy</b><small>1 page · ISO 9001:2015 QMS</small></span>{I['down']}</a>
  </div>
</section>

<section class="sec">
  <div class="wrap careers">
    <div><p class="kicker">Careers</p><h2>Let's grow with Luftek.</h2></div>
    <div>
      <p>As one of the leading AHU manufacturers in South India, Luftek offers opportunities in both production and office-based disciplines. In a competitive marketplace we put honesty and integrity first, and we work together to make our business a success.</p>
      <p>Innovation is key to our success, and we owe much of it to the engineers, sales, marketing, finance and administration people who chose to be part of our team.</p>
      <a class="btn btn--dark" href="mailto:info@luftek.in?subject=Career%20enquiry">Send your CV {I['arrow']}</a>
    </div>
  </div>
</section>
</main>
{footer(root)}"""
    write("about.html", body)


def page_certs():
    root = ""
    certs = [
        ("Eurovent", "AHU performance and casing", "Luftek air handling units are certified by the Eurovent certification body for the performance of the unit and the mechanical characteristics of the casing construction."),
        ("AHRI 410", "Cooling and heating coils", "Luftek water coils are tested to AHRI 410 and certified for cooling and heating performance. The AHRI Certified® mark assures buyers that the equipment will perform accurately and consistently."),
        ("ISO 9001:2015", "Quality management", "To demonstrate its ability to provide products and service that meet customer requirements, Luftek maintains a quality management system in accordance with ISO 9001:2015."),
        ("AHRI 1061", "Energy recovery", "Energy recovery equipment in Luftek ERUs is certified to AHRI 1061 for recovery effectiveness."),
        ("AMCA 210 / 300", "Fans", "Fans used in Luftek AHUs are certified to AMCA 210 for air performance and AMCA 300 for sound."),
        ("ISO 16890 / EN 779", "Filters", "Filters are certified to ISO 16890 / EN 779 classifications."),
        ("VDI 6022 · DIN 1946-4", "Hygiene", "Clean Room Units are designed to DIN 1946-4 and VDI 6022 hygiene requirements, with VDI 6022 certified accessories."),
        ("ESMA", "Package units", "Roof top package units are certified by the Emirates Authority for Standardization and Metrology for higher efficiency and lower power consumption."),
    ]
    cards = "".join(f'<article class="cc"><span class="cc__n">{i + 1:02d}</span><h3>{a}</h3><p class="cc__s">{b}</p><p>{c}</p></article>' for i, (a, b, c) in enumerate(certs))
    en = [("Casing strength", "D1 – D3", "D1", "How far panels deflect under fan pressure. Less deflection keeps seals tight for years."),
          ("Casing leakage", "L1 – L3", "L1", "Air lost through the casing. L1 means conditioned air reaches the room instead of the plant room."),
          ("Filter bypass leakage", "F9 – G1", "F9", "Air that slips round the filter. F9 is the tightest class, essential for clean rooms."),
          ("Thermal conductivity", "T1 – T5", "T2", "Heat passing through the panels. A lower class keeps the coil's cooling inside the unit."),
          ("Thermal bridging", "TB1 – TB5", "TB2", "Cold spots through the frame. A lower class stops the outer skin sweating in humid climates.")]
    en_rows = "".join(f'<tr><th scope="row">{a}</th><td class="num">{b}</td><td><span class="pill">{c}</span></td><td>{d}</td></tr>' for a, b, c, d in en)
    body = f"""{head("Certification | Eurovent, AHRI 410, ISO 9001 | Luftek Engineering", "Luftek AHUs are Eurovent certified, coils are AHRI 410 certified, and the quality system follows ISO 9001:2015. EN 1886 casing ratings explained.", root, "certifications.html")}
{header(root, "certs")}
<main id="main">
{page_hero([("Home", "index.html"), ("Certification", "certifications.html")], "Certified performance.", "Luftek products are backed by third-party certification and testing to global performance standards, so consultants can specify them with confidence.", root)}

<section class="sec">
  <div class="wrap cert-intro">
    <div class="cert-doc">
      <button class="cert-doc__btn" data-zoom="assets/img/c-ahri.webp" data-cap="AHRI certificate of product ratings, Luftek water coils" aria-label="Enlarge AHRI certificate">{img(root, 'c-ahri', 'AHRI certificate of product ratings for Luftek water coils')}<span class="gal__zoom">{I['zoom']}</span></button>
      <p>AHRI certificate of product ratings for Luftek water coils.</p>
    </div>
    <div>
      <p class="kicker">Our approach</p>
      <h2>Tested, verified, then delivered.</h2>
      <p class="lead">To ensure total customer satisfaction, we apply a meticulous, constant process to improve our products and processes, from performance through careful research and development, supported by advanced testing and verification.</p>
      <ul class="ticks"><li>{I['check']} 2019: AHRI 410 coil certification and EN 1886 AHU testing</li><li>{I['check']} 2023: Eurovent certification</li><li>{I['check']} 2025: Quality system manual LE/QMS/05 issued</li></ul>
    </div>
  </div>
</section>

<section class="sec sec--grey">
  <div class="wrap">
    <div class="sec__head"><p class="kicker">Standards</p><h2>Eight standards, one product range.</h2></div>
    <div class="ccs">{cards}</div>
  </div>
</section>

<section class="sec" id="en1886">
  <div class="wrap">
    <div class="sec__head sec__head--split"><div><p class="kicker">EN 1886 explained</p><h2>What the casing classes mean on site.</h2></div><p>EN 1886 rates an assembled AHU casing on five properties. Class 1 is the best in each. These are the ratings of Luftek's 502LK series.</p></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Property</th><th scope="col">Class range</th><th scope="col">Luftek 502LK</th><th scope="col">What it means</th></tr></thead><tbody>{en_rows}</tbody></table></div>
    <p class="note">503LK series: thermal bridging TB3. 251LK series: thermal conductivity T3.</p>
  </div>
</section>

<section class="sec sec--grey">
  <div class="wrap qp">
    <div><p class="kicker">Quality policy</p><blockquote>“The effectiveness of the quality management system shall be continually improved through a systematic quality process.”</blockquote><p class="qp__src">Luftek Quality System Manual, LE/QMS/05 · 23 June 2025</p></div>
    <a class="doc" href="assets/docs/luftek-quality-policy.pdf"><span class="doc__ic">PDF</span><span><b>Quality policy</b><small>1 page</small></span>{I['down']}</a>
  </div>
</section>
</main>
{footer(root)}"""
    write("certifications.html", body)


def page_contact():
    root = ""
    offices = "".join(f"""<article class="off">
      <p class="off__city">{e(o['city'])}</p>
      <h3>{e(o['name'])}</h3>
      <p>{e(o['addr'])}</p>
      <p class="off__l"><a href="tel:{o['tel'].replace(' ', '')}">{I['phone']}{e(o['tel'])}</a>{f'<a href="mailto:{o["mail"]}">{I["mail"]}{o["mail"]}</a>' if o.get('mail') else ''}</p>
      <a class="link" href="https://www.google.com/maps/search/?api=1&amp;query={quote(o['q'])}" rel="noopener">Get directions {I['arrow']}</a>
    </article>""" for o in OFFICES)
    opts = "".join(f"<option>{e(p['name'])}</option>" for p in PRODUCTS) + "<option>Not sure yet</option>"
    body = f"""{head("Contact Luftek Engineering | Chennai, Bengaluru, Hyderabad, Kochi, Mumbai", "Contact Luftek for AHU and FCU selections. Corporate office in Egmore, Chennai; plant at Cheyyar SIPCOT; offices in Bengaluru, Hyderabad, Kochi and Mumbai.", root, "contact.html")}
{header(root, "contact")}
<main id="main">
{page_hero([("Home", "index.html"), ("Contact", "contact.html")], "Let's associate.", "Call, write or walk in. We aim to answer every enquiry within 24 hours.", root)}

<section class="sec">
  <div class="wrap contact">
    <form class="form" id="enquiry" novalidate>
      <h2>Request a selection</h2>
      <p class="form__sub">Tell us about the project. Fields marked * are required.</p>
      <div class="f2"><label>Name *<input name="name" required autocomplete="name"></label><label>Company<input name="company" autocomplete="organization"></label></div>
      <div class="f2"><label>Email *<input name="email" type="email" required autocomplete="email"></label><label>Phone<input name="phone" type="tel" autocomplete="tel"></label></div>
      <div class="f2"><label>Product<select name="product">{opts}</select></label><label>Airflow (CFM)<input name="cfm" inputmode="numeric" placeholder="e.g. 12,000"></label></div>
      <div class="f2"><label>Project city<input name="city" placeholder="e.g. Chennai"></label><label>Quantity<input name="qty" inputmode="numeric" placeholder="e.g. 4"></label></div>
      <label>Project and application<textarea name="msg" rows="5" placeholder="Hospital OT, 600 Pa ESP, chilled water 7/12 °C"></textarea></label>
      <button class="btn btn--red btn--lg" type="submit">Send request {I['arrow']}</button>
      <p class="form__note" role="status">Opens your email app with the request addressed to sales@luftek.in. See our <a href="privacy-policy.html">privacy policy</a>.</p>
    </form>
    <aside class="contact__side">
      <div class="cbox"><p class="kicker">Sales</p><a class="cbox__big" href="tel:+914448678556">+91 44 4867 8556</a><a href="mailto:sales@luftek.in">sales@luftek.in</a></div>
      <div class="cbox"><p class="kicker">Plant</p><a class="cbox__big" href="tel:+914427663323">+91 44 2766 3323</a><a href="mailto:info@luftek.in">info@luftek.in</a></div>
      <div class="cbox"><p class="kicker">Working hours</p><p>Monday – Saturday, 9:00 am – 6:00 pm<br>Closed on Sundays and national holidays</p></div>
    </aside>
  </div>
</section>

<section class="sec sec--grey">
  <div class="wrap">
    <div class="sec__head"><p class="kicker">Offices</p><h2>Six locations across India.</h2></div>
    <div class="offs">{offices}</div>
  </div>
</section>

<section class="mapwrap" aria-label="Map of corporate office">
  <iframe title="Luftek corporate office, Egmore, Chennai" src="https://maps.google.com/maps?q={quote('TASS Mahal Complex, Montieth Road, Egmore, Chennai')}&amp;z=15&amp;output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
</section>
</main>
{footer(root)}"""
    write("contact.html", body)


def page_industries():
    root = ""
    nav = "".join(f'<a href="#{k}">{s["name"]}</a>' for k, s in SECTORS.items())
    blocks = ""
    for n, (sk, s) in enumerate(SECTORS.items()):
        projs = [p for p in PROJECTS if p[4] == sk]
        units = "".join(product_card(root, BY_KEY[u]) for u in s["units"][:3])
        more = s["units"][3:]
        more_html = (f'<p class="indd__more">Also suited: ' + ", ".join(f'<a href="{purl(root, BY_KEY[u])}">{e(BY_KEY[u]["name"])}</a>' for u in more) + '</p>') if more else ""
        thumbs = "".join(f'<a class="indd__pj" href="projects.html?p={f}">{img(root, "r-" + f, nm)}<span><b>{e(nm)}</b>{e(c)}</span></a>' for f, nm, c, co, _ in projs)
        blocks += f"""<section class="indd{' indd--alt' if n % 2 else ''}" id="{sk}">
  <div class="wrap">
    <div class="indd__top">
      <div class="indd__img">{img(root, s['img'], s['name'], lazy=n > 0)}</div>
      <div>
        <p class="kicker">{len(projs)} reference project{'s' if len(projs) != 1 else ''}</p>
        <h2>{s['name']}</h2>
        <p class="lead">{e(s['need'])}</p>
        <ul class="ticks">{''.join(f"<li>{I['check']} {e(x)}</li>" for x in s['points'])}</ul>
      </div>
    </div>
    <h3 class="indd__h">Recommended Luftek units</h3>
    <div class="pgrid">{units}</div>
    {more_html}
    <h3 class="indd__h">Reference projects</h3>
    <div class="indd__pjs">{thumbs}</div>
  </div>
</section>"""
    body = f"""{head("Industries | HVAC for Hospitals, Pharma, Airports & Industry | Luftek", "How Luftek air handling units and fan coil units serve hospitals, pharma, airports, industry, commercial buildings, education and international projects.", root, "industries.html")}
{header(root, "industries")}
<main id="main">
{page_hero([("Home", "index.html"), ("Industries", "industries.html")], "Industries we serve.", "Every sector asks something different of its air handling. Here is what matters in each, the Luftek units that suit it, and where they already run.", root, "r-Bangalore-International-Airport-Bangalore")}
<nav class="fambar" aria-label="Industries" data-subnav><div class="wrap fambar__in fambar__in--links">{nav}</div></nav>
{blocks}
</main>
{footer(root)}"""
    write("industries.html", body)


def page_privacy():
    root = ""
    secs = [
        ("Who we are", "This website is operated by Luftek Engineering Private Limited, No.10, TASS Mahal Complex, 4th Floor, Montieth Road, Egmore, Chennai 600 008, India (“Luftek”, “we”). This policy explains how we handle personal data shared with us through this website, in line with the Digital Personal Data Protection Act, 2023."),
        ("What we collect", "The selection request form collects your name, company, email address, phone number, project city and project details. The form does not send data to our servers: it opens your own email application with a pre-filled message to sales@luftek.in, which you choose whether to send. We receive only what you send us by email or phone."),
        ("Why we use it", "We use your details to respond to your enquiry, prepare equipment selections and quotations, and follow up on that enquiry. We do not sell your personal data or use it for unrelated marketing without your consent."),
        ("Who we share it with", "Your enquiry is handled by Luftek's sales and engineering teams. We may share it with our own branch offices to serve your project location, and with service providers who host our email, under confidentiality obligations."),
        ("How long we keep it", "We keep enquiry correspondence for as long as needed to serve the enquiry and any resulting order, and as required by applicable tax and commercial record-keeping laws."),
        ("Cookies and third parties", "This website does not set its own tracking or advertising cookies. Fonts are loaded from Google Fonts and the contact page embeds a Google Maps view; those services may receive your IP address under their own privacy policies."),
        ("Your rights", "You may ask us to access, correct or erase your personal data, or withdraw consent, by writing to info@luftek.in. We will respond within a reasonable time and as required by law. If you are not satisfied, you may approach the Data Protection Board of India."),
        ("Changes", "We may update this policy from time to time. The date below shows when it was last revised."),
    ]
    body_html = "".join(f"<h2>{e(t)}</h2><p>{e(x)}</p>" for t, x in secs)
    body = f"""{head("Privacy Policy | Luftek Engineering", "How Luftek Engineering Private Limited handles personal data shared through this website.", root, "privacy-policy.html")}
{header(root, "")}
<main id="main">
{page_hero([("Home", "index.html"), ("Privacy policy", "privacy-policy.html")], "Privacy policy", "How we handle the details you share with us.", root)}
<section class="sec"><div class="wrap prose">{body_html}<p class="note">Last updated: November 2026</p></div></section>
</main>
{footer(root)}"""
    write("privacy-policy.html", body)


def page_404():
    root = "/"
    body = f"""{head("Page not found | Luftek Engineering", "The page you were looking for could not be found.", root, "404.html")}
{header(root, "")}
<main id="main">
<section class="nf"><div class="wrap nf__in">
  <p class="nf__code">404</p>
  <h1>This page has moved or no longer exists.</h1>
  <p>Try the product range, or tell us what you need and our engineers will help.</p>
  <div class="hs__btns"><a class="btn btn--dark" href="/products.html">View products {I['arrow']}</a><a class="btn btn--line" href="/contact.html">Contact us</a></div>
  <ul class="nf__links">{''.join(f'<li><a href="/{purl("", p)}">{e(p["name"])}</a></li>' for p in PRODUCTS[:6])}</ul>
</div></section>
</main>
{footer(root)}"""
    write("404.html", body)


def write_seo():
    urls = ["", "about.html", "products.html", "industries.html", "projects.html", "certifications.html", "contact.html", "privacy-policy.html"] + [f"products/{p['slug']}.html" for p in PRODUCTS]
    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(f"  <url><loc>{SITE}/{u}</loc><lastmod>2026-11-24</lastmod></url>\n" for u in urls) + "</urlset>\n"
    write("sitemap.xml", sm)
    write("robots.txt", f"User-agent: *\nAllow: /\nDisallow: /_build/\n\nSitemap: {SITE}/sitemap.xml\n")


if __name__ == "__main__":
    page_home()
    page_products()
    for prod in PRODUCTS:
        page_product(prod)
    page_projects()
    page_about()
    page_certs()
    page_contact()
    page_industries()
    page_privacy()
    page_404()
    write_seo()
    print("built", 9 + len(PRODUCTS), "pages + sitemap.xml + robots.txt")
