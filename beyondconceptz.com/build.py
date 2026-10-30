"""Builds the Beyond Conceptz site from shared parts.

dist/      deployable static site (every page a full HTML document)
artifact/  same pages; index.html without <html>/<head> wrappers for the claude.ai preview
Run: python3 build.py
"""

import os
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")


def part(name):
    with open(os.path.join(SRC, name + ".html")) as fh:
        return fh.read()


PAGES = [  # file, nav label, <title>
    ("index.html", "Home", "Beyond Conceptz"),
    ("about.html", "About", "About | Beyond Conceptz"),
    ("services.html", "Services", "Services | Beyond Conceptz"),
    ("collections.html", "Collections", "Collections and pricing | Beyond Conceptz"),
    ("process.html", "Process", "How we build | Beyond Conceptz"),
    ("projects.html", "Projects", "Projects | Beyond Conceptz"),
    ("contact.html", "Contact", "Contact | Beyond Conceptz"),
]
DESC = {
    "index.html": "Beyond Conceptz designs and builds independent homes in Chennai and Kanchipuram: plans, approvals, construction and interiors from one team.",
    "about.html": "Why Beyond Conceptz keeps design and construction in one team, and how we work with home owners in Chennai and Kanchipuram.",
    "services.html": "Architecture and planning, approval drawings, turnkey construction, interiors, renovation and design-only services.",
    "collections.html": "Essential, Signature and Bespoke collections with their specifications, and a budget planner for your home.",
    "process.html": "Six steps from site visit to handover, stage-wise payments and video updates from site.",
    "projects.html": "Homes Beyond Conceptz is designing and building in Chennai and Kanchipuram.",
    "contact.html": "Book a free site visit with Beyond Conceptz. Tell us about your plot and we will call within one working day.",
}


def fix_links(html):
    """Section parts were written for one page; point their links at the right pages."""
    html = html.replace('href="#contact"', 'href="contact.html"')
    html = html.replace('href="#planner"', 'href="collections.html#planner"')
    html = html.replace('href="#collections"', 'href="collections.html"')
    html = html.replace('href="#services"', 'href="services.html"')
    return html


def header(current):
    links = "".join(
        f'<li><a href="{f}"{' aria-current="page"' if f == current else ""}>{label}</a></li>'
        for f, label, _ in PAGES
        if f not in ("index.html", "contact.html")
    )
    return f'''<a class="skip" href="#main">Skip to content</a>
<header class="top" id="top">
  <div class="wrap">
    <a class="logo" href="index.html" aria-label="Beyond Conceptz, home">
      <svg viewBox="0 0 256 370" aria-hidden="true"><use href="#mark"/></svg>
      <span class="wm"><b>BEYOND</b><span>CONCEPTZ</span></span>
    </a>
    <button class="menu-btn" id="menuBtn" aria-expanded="false" aria-controls="nav">Menu</button>
    <nav id="nav" aria-label="Main"><ul>{links}<li class="nav-contact"><a href="contact.html"{' aria-current="page"' if current == "contact.html" else ""}>Contact</a></li></ul></nav>
    <a class="btn cta" href="contact.html">Book a site visit</a>
  </div>
</header>
'''


FOOTER = """<footer>
  <div class="wrap f-top">
    <div><h2>Beyond Conceptz</h2><p class="lead">Architecture, construction and interiors for independent homes in Chennai and Kanchipuram.</p></div>
    <div><h2>Explore</h2><ul><li><a href="about.html">About</a></li><li><a href="services.html">Services</a></li><li><a href="collections.html">Collections</a></li><li><a href="process.html">Process</a></li><li><a href="projects.html">Projects</a></li></ul></div>
    <div><h2>Contact</h2><ul><li>beyondconceptz@gmail.com</li><li>Monday to Saturday</li><li><a href="contact.html">Book a site visit</a></li></ul></div>
  </div>
  <div class="wrap f-name" aria-hidden="true"><svg viewBox="0 0 256 370"><use href="#mark"/></svg><b>BEYOND CONCEPTZ</b></div>
  <div class="f-base"><div class="wrap f-base-in"><span>© <span id="yr">2026</span> Beyond Conceptz</span><span>Website by Marvice Media</span></div></div>
</footer>
"""

CTA = """<section class="cta-band" aria-labelledby="cta-h">
  <div class="wrap cta-in">
    <h2 id="cta-h">Tell us about your plot</h2>
    <p>The first site visit and consultation are free. We call within one working day.</p>
    <a class="btn light" href="contact.html">Book a free site visit</a>
  </div>
</section>
"""


def phero(h1, lede, img=None, alt=""):
    pic = (
        f'<div class="phero-pic"><div class="arch"><img src="img/{img}" alt="{alt}" width="800" height="1071" fetchpriority="high"></div></div>'
        if img
        else ""
    )
    cls = "phero has-pic" if img else "phero"
    return f'''<section class="{cls}" aria-labelledby="ph-h">
  <div class="wrap phero-grid">
    <div><h1 id="ph-h">{h1}</h1><p class="lede">{lede}</p></div>
    {pic}
  </div>
</section>
'''


# ---------- page content ----------

home_collections = """<section class="sec" aria-labelledby="hc-h">
  <div class="wrap">
    <div class="head"><h2 id="hc-h" class="rv">Three collections, in writing</h2><p class="rv">Every collection comes with a written specification: the brand, grade and allowance for each material. Pick one as a starting point and we adjust it to your home.</p></div>
    <div class="tiers-row">
      <a class="tier-link rv" href="collections.html"><span class="t-name">Essential</span><span class="t-rate num">₹2,100 – 2,400 per sq.ft</span><span class="t-desc">A well-built family home with dependable brands and a clean finish.</span></a>
      <a class="tier-link on rv" href="collections.html"><span class="t-name">Signature</span><span class="t-rate num">₹2,500 – 2,900 per sq.ft</span><span class="t-desc">Our most chosen home, with teak joinery, larger tiles and a fuller kitchen.</span></a>
      <a class="tier-link rv" href="collections.html"><span class="t-name">Bespoke</span><span class="t-rate num">₹3,100 – 3,800 per sq.ft</span><span class="t-desc">Designer finishes, system windows and details chosen with you.</span></a>
    </div>
    <p class="rv" style="margin-top:2rem"><a class="tlink" href="collections.html#planner">Estimate the cost of your home</a></p>
  </div>
</section>
"""

home_project = """<section class="sec" aria-labelledby="hp-h">
  <div class="wrap split">
    <div class="copy">
      <h2 id="hp-h" class="rv">On site in Kanchipuram</h2>
      <p class="rv">The Sampath Residence is an independent family home we designed and are now building. Its owner receives a video at every stage.</p>
      <p class="rv" style="margin-top:1.6rem"><a class="tlink" href="projects.html">See the project</a></p>
    </div>
    <figure class="rv"><div class="arch"><img src="img/site.jpg" alt="An independent house at the brickwork stage on a residential street" width="1000" height="1239" loading="lazy"></div><figcaption>Representative image.</figcaption></figure>
  </div>
</section>
"""

about_values = """<section class="sec" aria-labelledby="val-h">
  <div class="wrap">
    <div class="head"><h2 id="val-h" class="rv">How we work with you</h2><p class="rv">Four commitments we write into every agreement, so you can hold us to them.</p></div>
    <div class="values">
      <div class="rv"><h3>One accountable team</h3><p>The architect who draws your home stays responsible for it on site. You never chase three firms for one answer.</p></div>
      <div class="rv"><h3>An open specification</h3><p>Every material is listed with its brand, grade and allowance before you sign, so you can compare like for like.</p></div>
      <div class="rv"><h3>Pay for what you have seen</h3><p>Payments are tied to construction stages. You release each one after the stage is finished and shown to you.</p></div>
      <div class="rv"><h3>Your site on your phone</h3><p>Photos, a short video and the engineer's checklist at every stage, wherever you live.</p></div>
    </div>
  </div>
</section>
"""

about_region = """<section class="sec" aria-labelledby="reg-h">
  <div class="wrap split">
    <figure class="rv"><div class="arch"><img src="img/hero.jpg" alt="A finished contemporary family home with a brick feature wall" width="1000" height="1239" loading="lazy"></div></figure>
    <div class="copy">
      <h2 id="reg-h" class="rv">Built for Chennai's climate</h2>
      <p class="rv">Deep overhangs against the afternoon sun, cross-ventilation through every room, waterproofing that holds through the north-east monsoon, and materials chosen for salt air near the coast.</p>
      <p class="rv">We work across Chennai, Kanchipuram and the towns around them, so we know the soil, the local approval process and the trades who do the work well.</p>
    </div>
  </div>
</section>
"""

SERVICES_DETAIL = [
    (
        "architecture.jpg",
        "An architect's desk with floor plans, a house model and material swatches",
        "Architecture and planning",
        "A layout shaped around your plot, its light and the way your family lives. We revise it with you until every room is right.",
        [
            "Site study and space planning",
            "Floor plans, with Vastu alignment if you want it",
            "3D elevation and a model you can turn",
            "Working drawings for the site team",
        ],
    ),
    (
        "site.jpg",
        "A house at the brickwork stage on a residential street",
        "Approvals and structure",
        "Submission drawings and structural design prepared for your local authority, and followed through until the approval is issued.",
        [
            "Plan approval drawing set",
            "Structural design by a qualified engineer",
            "Soil and site checks before the design is frozen",
            "Government fees shown separately in your estimate",
        ],
    ),
    (
        "construction.jpg",
        "A house under construction with a concrete frame and brick walls",
        "Turnkey construction",
        "Foundation to final coat, built by our own team to the specification you signed, with an engineer responsible for your home.",
        [
            "Engineer checks before every concrete pour",
            "Electrical, plumbing and waterproofing",
            "Photos, video and a checklist at every stage",
            "Payment released after each stage is shown",
        ],
    ),
    (
        "interiors.jpg",
        "A living room with an arched teak window and a terracotta sofa",
        "Interiors",
        "Interiors planned with the architecture, so storage, lighting and furniture sit where the plan intended them to.",
        [
            "Modular kitchen and wardrobes",
            "Lighting and ceiling design",
            "Pooja room, TV unit and storage",
            "Furniture selection and styling",
        ],
    ),
]


def services_detail():
    rows = []
    for i, (img, alt, title, text, items) in enumerate(SERVICES_DETAIL):
        lis = "".join(f"<li>{x}</li>" for x in items)
        flip = " flip" if i % 2 else ""
        rows.append(f'''<div class="srow{flip}">
      <figure class="rv"><div class="arch"><img src="img/{img}" alt="{alt}" width="800" height="1071" loading="lazy"></div></figure>
      <div class="copy"><h2 class="rv">{title}</h2><p class="rv">{text}</p><ul class="rv">{lis}</ul></div>
    </div>''')
    return f"""<section class="sec" aria-label="Services in detail">
  <div class="wrap srows">
    {"".join(rows)}
  </div>
</section>
<section class="sec" aria-labelledby="sx-h">
  <div class="wrap">
    <div class="head"><h2 id="sx-h" class="rv">Smaller jobs we take on</h2><p class="rv">Not building from scratch? These are priced on their own.</p></div>
    <div class="values">
      <div class="rv"><h3>Renovation and extensions</h3><p>Add a floor or rework an older home. We check the existing structure first and tell you plainly what it can carry.</p></div>
      <div class="rv"><h3>Design only</h3><p>Already have a contractor? We prepare your plans, elevation and approval drawings, and visit site at key stages.</p></div>
    </div>
  </div>
</section>
"""


projects_handover = """<section class="sec" aria-labelledby="ho-h">
  <div class="wrap">
    <div class="head"><h2 id="ho-h" class="rv">What every handover includes</h2><p class="rv">When we hand over a home, you receive more than the keys.</p></div>
    <div class="values">
      <div class="rv"><h3>Your drawing set</h3><p>Final architectural, structural, electrical and plumbing drawings, so any future work starts from the truth.</p></div>
      <div class="rv"><h3>Warranties and manuals</h3><p>Every warranty card and manual for fittings, pumps and appliances, filed in one folder.</p></div>
      <div class="rv"><h3>A walkthrough together</h3><p>We walk the house with you, test every tap and switch, and fix anything you note before handover.</p></div>
      <div class="rv"><h3>The stage record</h3><p>Every stage video, photo and engineer's checklist from the build, kept for your records.</p></div>
    </div>
  </div>
</section>
"""

# Contact page: the contact section is the page's first screen, so its heading becomes the h1
contact_top = part("contact").replace(
    '<h2 id="ct-h">Tell us about your plot</h2>',
    '<h1 id="ct-h">Tell us about your plot</h1>',
)
contact_top = contact_top.replace('class="contact"', 'class="contact first"', 1)

home_services = fix_links(part("services")).replace(
    "</ul>\n      </div>\n    </div>\n  </section>",
    '</ul>\n      </div>\n      <p class="rv" style="margin-top:2.5rem"><a class="tlink" href="services.html">All services in detail</a></p>\n    </div>\n  </section>',
    1,
)

BODY = {
    "index.html": fix_links(part("hero"))
    + fix_links(part("about"))
    + home_services
    + part("model")
    + home_collections
    + home_project
    + CTA,
    "about.html": phero(
        "One team, sketch to keys",
        "We design and build independent homes, so the house you approve on paper is the house you move into.",
        "interiors.jpg",
        "A living room with an arched teak window and a terracotta sofa",
    )
    + fix_links(part("about"))
    + about_values
    + about_region
    + CTA,
    "services.html": phero(
        "Design, approvals, build",
        "Take the complete service, or hire us for the one part you need. Each is scoped and priced before work starts.",
        "architecture.jpg",
        "An architect's desk with floor plans and a house model",
    )
    + services_detail()
    + part("model")
    + CTA,
    "collections.html": phero(
        "Collections and pricing",
        "Three written specifications and a planner that shows what your home will cost and how payments split across the build.",
    )
    + fix_links(part("collections"))
    + CTA,
    "process.html": phero(
        "How we build your home",
        "Six steps from an empty plot to your keys, with something you can keep at the end of each.",
        "construction.jpg",
        "A house under construction with a concrete frame and brick walls",
    )
    + fix_links(part("process"))
    + fix_links(part("updates"))
    + CTA,
    "projects.html": phero(
        "Homes we are building",
        "We show live sites with the owner's permission. Ask us and we will walk you through one in person.",
    )
    + fix_links(part("project"))
    + projects_handover
    + CTA,
    "contact.html": contact_top + part("faq"),
}

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600&family=Marcellus&display=swap">\n'
)
THREE = (
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n'
    '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>\n'
    '<script src="assets/model.js"></script>\n'
)


def page(fname, title, full):
    body = BODY[fname]
    scripts = '<script src="assets/site.js"></script>\n' + (
        THREE if 'id="stage"' in body else ""
    )
    meta = (
        f'<title>{title}</title>\n<meta name="description" content="{DESC[fname]}">\n'
        + FONTS
        + '<link rel="stylesheet" href="assets/site.css">\n<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">\n'
    )
    content = (
        part("defs")
        + header(fname)
        + '<main id="main">\n'
        + body
        + "</main>\n"
        + FOOTER
        + scripts
    )
    if full:
        return (
            '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<meta name="claude:viewport-fit-sides" content="cover">\n'
            + meta
            + "</head>\n<body>\n"
            + content
            + "</body>\n</html>\n"
        )
    return (
        meta.replace("\n", "\n", 1)
        + '<meta name="claude:viewport-fit-sides" content="cover">\n'
        + content
    )


def build():
    for out, full_index in (("dist", True), ("artifact", False)):
        d = os.path.join(ROOT, out)
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
        shutil.copytree(os.path.join(ROOT, "assets"), os.path.join(d, "assets"))
        shutil.copytree(os.path.join(ROOT, "img"), os.path.join(d, "img"))
        for fname, _, title in PAGES:
            full = full_index or fname != "index.html"
            with open(os.path.join(d, fname), "w") as fh:
                fh.write(page(fname, title, full))
    print("built", [p[0] for p in PAGES])


if __name__ == "__main__":
    build()
