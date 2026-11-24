"""Builds the Aventose site: one shared layout + 7 pages -> *.html in aventose-demo/.
Run from aventose-demo/:  python3 src/build.py
"""
P = lambda n: open(f'src/partials/{n}.html').read()

LINKS = {'#book': 'enquire.html', '#s110': 's110.html', '#press': 'about.html#press', '#range': 'range.html',
         '#explore': 's110.html#explore', '#rugged': 'technology.html#rugged', '#charging': 'technology.html#charging'}


def fix_links(html):
    for a, b in LINKS.items():
        html = html.replace(f'href="{a}"', f'href="{b}"')
    return html


NAV = [('home', 'index.html', 'Home'), ('s110', 's110.html', 'S110'), ('range', 'range.html', 'Range'),
       ('technology', 'technology.html', 'Technology'), ('ownership', 'ownership.html', 'Ownership'),
       ('about', 'about.html', 'About'), ('team', 'team.html', 'Team'), ('enquire', 'enquire.html', 'Enquire')]


import hashlib
VER = hashlib.md5(open("assets/site.css","rb").read()+open("assets/site.js","rb").read()).hexdigest()[:8]


def layout(pid, title, desc, body, nxt=None):
    inline = ''.join(f'<a href="{h}" data-nav="{i}">{t}</a>' for i, h, t in NAV[1:7])
    big = ''.join(f'<li><a href="{h}" data-nav="{i}" style="--i:{k}"><small>{k + 1:02d}</small>{t}</a></li>' for k, (i, h, t) in enumerate(NAV))
    nextblock = ''
    if nxt:
        href, label, img = nxt
        nextblock = f'''<a class="nextpage" href="{href}"><img src="assets/img/{img}" alt="" loading="lazy">
  <div class="wrap"><div><div class="label">Next</div><h2 class="cond">{label}</h2></div><span class="arrow" aria-hidden="true">→</span></div></a>'''
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="assets/img/IntheVillage.webp">
<meta name="theme-color" content="#0c0e0f">
<link rel="icon" href="assets/logo_black.6dfd8e2.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/site.css?v={VER}">
</head>
<body data-page="{pid}">
<div class="progress" id="progress" aria-hidden="true"></div>

<header class="top">
  <div class="wrap bar">
    <a href="index.html" aria-label="Aventose Energy home"><img src="assets/logo_black.6dfd8e2.png" alt="Aventose Energy"></a>
    <nav id="nav" aria-label="Main">{inline}</nav>
    <div style="display:flex;gap:14px;align-items:center">
      <a href="enquire.html" class="btn mag">Book a test ride</a>
      <button class="menu" id="menu" aria-expanded="false" aria-controls="overlay"><span>Menu</span><i class="lines" aria-hidden="true"></i></button>
    </div>
  </div>
</header>

<div class="overlay" id="overlay">
  <ol class="ov-links">{big}</ol>
  <div class="ov-side">
    <img src="assets/img/GreenBike.webp" alt="Aventose S110" loading="lazy">
    <p>Aventose Energy Pvt Ltd · Designed and built in India<br>C-33, Arihant Amara, 49 Poonamallee High Road, Chennai 600056<br><a href="mailto:support@aventose.com">support@aventose.com</a></p>
    <a class="btn light" href="enquire.html">Book a test ride</a>
  </div>
</div>

<main>
{body}
</main>
{nextblock}
<footer>
  <div class="wrap">
    <div class="f-grid">
      <div><img src="assets/logo_black.6dfd8e2.png" alt="Aventose Energy"><p style="margin-top:20px;max-width:320px">Rugged electric mobility, designed and built in India.<br>C-33, Arihant Amara, 49 Poonamallee High Road, Chennai 600056</p></div>
      <div><h5>Explore</h5><ul><li><a href="s110.html">S110</a></li><li><a href="range.html">Range &amp; compare</a></li><li><a href="technology.html">Technology</a></li><li><a href="ownership.html">Ownership &amp; savings</a></li></ul></div>
      <div><h5>Company</h5><ul><li><a href="about.html">About</a></li><li><a href="team.html">Team</a></li><li><a href="about.html#press">News</a></li><li><a href="enquire.html?type=fleet">Fleet sales</a></li><li><a href="enquire.html?type=dealer">Become a dealer</a></li><li><a href="mailto:support@aventose.com">support@aventose.com</a></li></ul></div>
      <div><h5>Follow</h5><ul>
        <li><a href="https://www.instagram.com/aventoseenergy/" target="_blank" rel="noopener">Instagram</a></li>
        <li><a href="https://www.youtube.com/aventoseenergy" target="_blank" rel="noopener">YouTube</a></li>
        <li><a href="https://www.linkedin.com/company/aventoseenergy/" target="_blank" rel="noopener">LinkedIn</a></li>
        <li><a href="https://twitter.com/Aventoseenergy" target="_blank" rel="noopener">X</a></li></ul></div>
    </div>
    <div class="f-bot"><span>© 2026 Aventose Energy Pvt Ltd</span><span>Website concept by Marvice Media Private Limited</span></div>
  </div>
</footer>
<script src="assets/site.js?v={VER}" defer></script>
</body>
</html>
'''


def phero(img, crumb, l1, l2, lede, chips='', pos='50% 50%'):
    chips_html = f'<div class="chips">{chips}</div>' if chips else ''
    return f'''<section class="phero">
  <img src="assets/img/{img}" alt="" data-parallax=".18" style="object-position:{pos}" fetchpriority="high">
  <div class="wrap">
    <div class="crumbs"><a href="index.html">Home</a> / {crumb}</div>
    <h1 class="cond"><span class="ln"><span>{l1}</span></span><span class="ln"><span>{l2}</span></span></h1>
    <div class="phero-row"><p class="lede">{lede}</p>{chips_html}</div>
  </div>
</section>'''


# ------------------------------------------------------------------ HOME
home_product = '''<section class="product">
  <div class="wrap">
    <div class="head">
      <div><div class="label rv">Aventose S110 · ARAI certified</div><h2 class="cond rv">Charge anywhere.<br>Safe. Rugged.<br>Multi-purpose.</h2></div>
      <p class="rv">Removable battery, portable charger, 17-inch alloys and 175 mm of ground clearance. Built to carry a family, a shop's stock, or both.</p>
    </div>
    <div class="stage rv">
      <img id="imgGreen" src="assets/img/GreenBike.webp" alt="Aventose S110 in green, side view">
      <img id="imgBlack" src="assets/img/BlackBike.webp" alt="Aventose S110 in black, side view" hidden>
    </div>
    <div class="p-bar">
      <div class="label">Side view · S110</div>
      <div class="colors" role="group" aria-label="Choose colour">
        <button data-show="imgGreen" aria-pressed="true"><i style="background:rgb(31,100,97)"></i>Green</button>
        <button data-show="imgBlack" aria-pressed="false"><i style="background:#111"></i>Black</button>
      </div>
      <div class="price"><span class="label">Est. ex-showroom</span><b class="cond">₹1,19,900*</b></div>
    </div>
    <div class="cta-row" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:40px">
      <a class="btn mag" href="s110.html">Configure your S110</a><a class="btn line" href="range.html#compare">Compare models</a>
    </div>
  </div>
</section>'''

home_numbers = '''<section>
  <div class="wrap">
    <div class="head">
      <div><div class="label rv">Built to last</div><h2 class="cond rv">Numbers that<br>mean years.</h2></div>
      <p class="rv">Certified, sealed and warrantied for the way India rides: overloaded, in the rain, on roads nobody has fixed.</p>
    </div>
    <div class="big-nums">
      <div class="rv"><b class="cond"><span data-count="200000">2,00,000</span><small>km</small></b><span>Service life, certified by ARAI for the S110</span></div>
      <div class="rv"><b class="cond"><span data-count="8">8</span><small>years</small></b><span>Battery warranty, or 1,00,000 km</span></div>
      <div class="rv"><b class="cond">IP<span data-count="67">67</span></b><span>Motor, controller and battery, sealed against water and dust</span></div>
    </div>
  </div>
</section>'''

home_teasers = '''<section style="padding-top:0">
  <div class="wrap">
    <div class="head"><div><div class="label rv">Go deeper</div><h2 class="cond rv">Everything<br>under the seat.</h2></div></div>
    <div class="teasers stagger">
      <a class="teaser" href="technology.html"><div class="ph"><img src="assets/img/battery-pack.webp" alt="Aventose 2.45 kWh LFP battery pack" loading="lazy" style="object-fit:contain;background:#fff"></div><div class="t"><div class="label">Technology</div><h3 class="cond">T.E.J.A.S battery &amp; AURA VCU</h3><p>An 8-year battery and a control unit that learns how you ride.</p><span class="go">See the technology</span></div></a>
      <a class="teaser" href="ownership.html"><div class="ph"><img src="assets/img/ChargingAnywhere.webp" alt="Charging the S110 at home" loading="lazy"></div><div class="t"><div class="label">Ownership</div><h3 class="cond">What petrol costs you</h3><p>Work out your monthly saving, warranty and charging in a minute.</p><span class="go">Calculate savings</span></div></a>
      <a class="teaser" href="enquire.html?type=fleet"><div class="ph"><img src="assets/img/FortheEntrepreneur.webp" alt="Business owner with the S110" loading="lazy"></div><div class="t"><div class="label">Fleet &amp; business</div><h3 class="cond">Electric for your fleet</h3><p>Delivery, rental and quick commerce, with battery swapping.</p><span class="go">Talk to fleet sales</span></div></a>
    </div>
  </div>
</section>'''

home = (fix_links(P('hero')) + fix_links(P('facts')) + home_product
        + fix_links(P('people')) + home_numbers + fix_links(P('lineup')).replace('</section>', '''  <div class="wrap" style="display:flex;justify-content:center;margin-top:40px"><a class="btn line" href="range.html#compare">Compare the range side by side</a></div>
</section>''', 1)
        + home_teasers + fix_links(P('press')).replace('id="press" style="padding-top:0"', 'style="padding-top:0"'))

# ------------------------------------------------------------------ S110
s110_cfg = '''<section class="cfg">
  <div class="wrap cfg-grid">
    <div class="stage rv">
      <img id="cfgGreen" src="assets/img/GreenBike.webp" alt="Aventose S110 in green">
      <img id="cfgBlack" src="assets/img/BlackBike.webp" alt="Aventose S110 in black" hidden>
    </div>
    <div>
      <div class="crumbs"><a href="index.html">Home</a> / S110</div>
      <div class="label">Build yours</div>
      <h1 class="cond" id="cfgName">S110</h1>
      <div class="cfg-num"><b id="cfgRange" data-from="0">100</b><span>km on-road range</span></div>
      <div class="cfg-bar"><i id="cfgBar"></i></div>
      <div class="label">Battery</div>
      <div class="opts" role="group" aria-label="Battery">
        <button data-battery="std" aria-pressed="true">Standard <small>2.4 kWh</small></button>
        <button data-battery="er" aria-pressed="false">Extended range <small>3.2 kWh</small></button>
      </div>
      <div class="label">Colour</div>
      <div class="colors" role="group" aria-label="Colour">
        <button data-show="cfgGreen" aria-pressed="true"><i style="background:rgb(31,100,97)"></i>Green</button>
        <button data-show="cfgBlack" aria-pressed="false"><i style="background:#111;border:1px solid #444"></i>Black</button>
      </div>
      <div class="cfg-meta">
        <div>Battery<b id="cfgKwh">2.4 kWh LFP</b></div>
        <div>Colour<b id="cfgColour">Green</b></div>
        <div>Top speed<b>60 km/h</b></div>
        <div>Est. ex-showroom<b id="cfgPrice">₹1,19,900*</b></div>
      </div>
      <div class="cfg-acts"><a class="btn light mag" id="cfgEnquire" href="enquire.html?type=individual&amp;model=S110">Book a test ride</a><a class="btn line" href="#specs">Full specifications</a></div>
    </div>
  </div>
</section>'''

s110_specs = '''<section id="specs">
  <div class="wrap">
    <div class="head"><div><div class="label rv">Specifications</div><h2 class="cond rv">Every number,<br>in one place.</h2></div>
      <p class="rv">From Aventose Energy's published specification sheet. Specifications could vary slightly in the final product.</p></div>
    <div class="acc rv">
      <details open><summary>Performance</summary><div class="acc-body">
        <div><span>Range (on road)</span><b>100 km · 130 km ER</b></div><div><span>Top speed</span><b>60 km/h</b></div>
        <div><span>Wheel torque</span><b>156 Nm</b></div><div><span>Motor torque</span><b>20 Nm</b></div>
        <div><span>Motor</span><b>Mid-mounted PMSM</b></div><div><span>Transmission</span><b>Double stage</b></div>
        <div><span>Power (peak / rated)</span><b>3 / 2.1 kW</b></div><div><span>Motor protection</span><b>IP67</b></div></div></details>
      <details><summary>Battery &amp; charging</summary><div class="acc-body">
        <div><span>Battery</span><b>2.4 kWh LFP</b></div><div><span>Battery, ER</span><b>3.2 kWh NMC</b></div>
        <div><span>Battery protection</span><b>IP67</b></div><div><span>Charging time</span><b>80% in 4 h · 100% in 6 h</b></div>
        <div><span>Removable battery</span><b>Yes</b></div><div><span>Battery swapping</span><b>Yes</b></div>
        <div><span>Fixed charging</span><b>Yes</b></div><div><span>Charger</span><b>Portable</b></div></div></details>
      <details><summary>Chassis &amp; brakes</summary><div class="acc-body">
        <div><span>Chassis</span><b>42 mm parallel tubular</b></div><div><span>Ground clearance</span><b>175 mm</b></div>
        <div><span>Wheels</span><b>17" / 17" alloy</b></div><div><span>Tyres</span><b>Tubeless</b></div>
        <div><span>Brakes</span><b>Front &amp; rear disc, CBS</b></div><div><span>Suspension</span><b>Hydraulic, twin rear shocks</b></div>
        <div><span>Weight with battery</span><b>125 kg</b></div><div><span>Display &amp; VCU</span><b>IP65</b></div></div></details>
      <details><summary>Warranty &amp; price</summary><div class="acc-body">
        <div><span>Battery warranty</span><b>8 years / 1,00,000 km</b></div><div><span>Motor warranty</span><b>3 years / 50,000 km</b></div>
        <div><span>Service life (ARAI)</span><b>2,00,000 km</b></div><div><span>Est. ex-showroom</span><b>₹1,19,900*</b></div></div></details>
    </div>
  </div>
</section>'''

s110 = s110_cfg + fix_links(P('explore')) + fix_links(P('reel')) + s110_specs

# ------------------------------------------------------------------ RANGE
def mcard(key, tag, soon, rng, spd, tq, price, blurb):
    cls = 'tag soon' if soon else 'tag'
    primary = '<a class="btn mag" href="s110.html">Configure</a>' if key == 'S110' else f'<a class="btn mag" href="enquire.html?type=individual&amp;model={key}">Register interest</a>'
    return f'''<article class="mcard"><span class="{cls}">{tag}</span><img src="assets/img/lineup-{key.lower()}.webp" alt="Aventose {key}" loading="lazy">
  <h3 class="cond">{key}</h3><p style="color:var(--ink2)">{blurb}</p>
  <div class="kv"><div><b>{rng}</b>km range</div><div><b>{spd}</b>km/h top</div><div><b>{tq}</b>Nm torque</div></div>
  <div class="acts">{primary}<a class="btn line" href="#compare" data-cmp="{key}">Compare</a></div><p class="fine">Est. ex-showroom {price}</p></article>'''

range_body = phero('RenderFinal.webp', 'Range', 'Four machines.', 'One platform.',
                   'Scooters and motorcycles on Aventose\'s patented platform: removable batteries, IP67 sealing and the same rugged DNA.',
                   '<span class="chip">S110</span><span class="chip">S125</span><span class="chip">M125</span><span class="chip">M150</span>', '50% 40%') + f'''
<section>
  <div class="wrap">
    <div class="mcards stagger">
      {mcard('S110', 'ARAI certified · On sale', False, '100–130', '60', '156', '₹1,19,900*', 'The rugged, multi-purpose scooter. Flat floorboard, 17-inch wheels, removable battery.')}
      {mcard('S125', 'Coming soon', True, '100–130', '80', '140', '₹99,900*', 'A sleek city scooter with a hub motor and 12-inch wheels.')}
      {mcard('M125', 'Coming soon', True, '100–130', '80', '156', '₹1,09,000*', 'Aventose\'s first electric motorcycle, with a mid-mounted PMSM.')}
      {mcard('M150', 'In development', True, '130–175', '100', '170', 'TBD', 'The long-range motorcycle, with up to 4.4 kWh of battery.')}
    </div>
  </div>
</section>
<section id="compare" class="lineup">
  <div class="wrap">
    <div class="head"><div><div class="label rv">Compare</div><h2 class="cond rv">Side by side.</h2></div><p class="rv">Pick any two models. Bars show each figure against the best in the range.</p></div>
    <div class="cmp-head">
      <div class="cmp-pick"><img id="cmpImgA" alt=""><select id="cmpA" aria-label="First model"><option selected>S110</option><option>S125</option><option>M125</option><option>M150</option></select><span class="tag" id="cmpTagA"></span><span class="cond" id="cmpNameA" hidden></span></div>
      <div class="cmp-vs">VS</div>
      <div class="cmp-pick"><img id="cmpImgB" alt=""><select id="cmpB" aria-label="Second model"><option>S110</option><option>S125</option><option selected>M125</option><option>M150</option></select><span class="tag" id="cmpTagB"></span><span class="cond" id="cmpNameB" hidden></span></div>
    </div>
    <div id="cmpRows"></div>
    <p class="fine">*Figures and estimated prices from Aventose Energy's specification sheet. Specifications could vary slightly in the final product.</p>
  </div>
</section>'''

# ------------------------------------------------------------------ TECHNOLOGY
def tabs(groups):
    btns = ''.join(f'<button role="tab" id="t-{k}" aria-controls="p-{k}">{name}</button>' for k, (name, _) in groups)
    panels = ''.join(f'<div class="tab-panel" role="tabpanel" id="p-{k}" aria-labelledby="t-{k}"><ul>' + ''.join(f'<li>{x}</li>' for x in items) + '</ul></div>' for k, (name, items) in groups)
    return f'<div data-tabs><div class="tab-list" role="tablist">{btns}</div>{panels}</div>'

battery_tabs = tabs([
    ('th', ('Thermal', ['Advanced thermal conduction and heat dissipation', 'Thermal runaway protection'])),
    ('el', ('Electronics', ['Intelligent BMS senses and monitors cell and battery parameters', 'Predictive algorithms to safeguard and extend battery health', 'CAN-based communication for a wide array of data'])),
    ('ju', ('Junction', ['Reduced cell junction ohmic losses', 'Robust cell junction contact', 'Short circuit protection'])),
    ('st', ('Structure', ['Component design, selection and placement for greater heat dissipation', 'Bolstered aluminium enclosure for greater strength', 'Pressure release vent'])),
])
vcu_tabs = tabs([
    ('ad', ('Adaptive', ['Modulates drive power based on vehicle data and component temperature', 'Pre-emptive safety measures extend component life in high heat or overload', 'Boosts range at low charge through Safe Mode', 'CAN-based system, future-proofed for upcoming technologies'])),
    ('uf', ('User friendly', ['Intuitive data display for better riding habits', 'Controlled drive-mode transitions for smooth operation', 'Built-in safety routines for hassle-free riding'])),
    ('re', ('Remote', ['Collects vehicle and component data', 'Low-bandwidth transfer for remote viewing', 'Equipped to respond to remote commands'])),
    ('an', ('Analytical', ['Real-time range estimate based on your riding', 'Predictive maintenance for component life and efficiency'])),
])

technology = phero('Transmission.webp', 'Technology', 'Engineered for', 'real roads.',
                   'A sealed battery built to last eight years, a control unit that learns, and a chassis certified for two lakh kilometres.',
                   '<span class="chip">IP67</span><span class="chip">T.E.J.A.S</span><span class="chip">AURA VCU</span>', '50% 50%') + fix_links(P('rugged')) + f'''
<section style="padding-top:0">
  <div class="wrap tabs">
    <div class="tech-visual rv"><img src="assets/img/battery-pack.webp" alt="Aventose 2.45 kWh LFP battery pack" loading="lazy"></div>
    <div>
      <div class="label rv">Battery · Powered by T.E.J.A.S design</div>
      <h2 class="cond rv" style="font-size:clamp(40px,5vw,76px)">8 years.<br>1,00,000 km.</h2>
      <p class="rv" style="color:var(--ink2);margin-top:16px;max-width:480px">The 2.45 kWh LFP pack carries an 8-year / 1,00,000 km warranty. Four layers of engineering make that possible.</p>
      {battery_tabs}
    </div>
  </div>
</section>
<section class="dark-sec">
  <div class="wrap tabs">
    <div>
      <div class="label rv">Proprietary vehicle control unit</div>
      <h2 class="cond rv" style="font-size:clamp(40px,5vw,76px)">Active learning<br><span style="color:var(--blue)">AURA</span> VCU.</h2>
      <p class="rv" style="margin-top:16px;max-width:480px;color:#a9a8a3">Aventose's own VCU runs enhanced performance and safety algorithms, and gets to know the way you ride.</p>
      {vcu_tabs}
    </div>
    <div class="tech-visual rv"><img src="assets/img/aura-vcu.webp" alt="Aventose AURA vehicle control unit" loading="lazy"></div>
  </div>
</section>''' + fix_links(P('band')) + '''
<section style="padding-top:clamp(48px,6vw,80px)">
  <div class="wrap">
    <div class="teasers stagger">
      <figure class="teaser"><div class="ph"><img src="assets/img/ChargingAnywhere.webp" alt="Charging at home" loading="lazy"></div><div class="t"><h3 class="cond">Charge anywhere</h3><p>A removable battery and portable charger work with a regular plug point.</p></div></figure>
      <figure class="teaser"><div class="ph"><img src="assets/img/Removable.webp" alt="Removing the battery" loading="lazy"></div><div class="t"><h3 class="cond">Removable</h3><p>Under-seat storage for easy access and handling.</p></div></figure>
      <figure class="teaser"><div class="ph"><img src="assets/img/Regeneration.webp" alt="Regeneration indicator" loading="lazy"></div><div class="t"><h3 class="cond">Regeneration</h3><p>Charges the battery while you slow down.</p></div></figure>
    </div>
  </div>
</section>'''

# ------------------------------------------------------------------ OWNERSHIP
savings = '''<section id="savings">
  <div class="wrap">
    <div class="head">
      <div><div class="label rv">Running cost</div><h2 class="cond rv">What petrol<br>costs you.</h2></div>
      <p class="rv">Set your daily ride and your current bike's mileage. The S110 figure uses its own numbers: a 2.4 kWh battery for about 100 km.</p>
    </div>
    <div class="calc rv">
      <div>
        <label for="km">Daily ride <b id="kmV"></b></label><input type="range" id="km" min="5" max="120" value="40">
        <label for="fuel">Petrol price <b id="fuelV"></b></label><input type="range" id="fuel" min="90" max="115" value="102">
        <label for="mil">Your bike's mileage <b id="milV"></b></label><input type="range" id="mil" min="25" max="70" value="45">
        <label for="tar">Electricity tariff <b id="tarV"></b></label><input type="range" id="tar" min="4" max="12" value="8">
      </div>
      <div class="save">
        <span class="label">You save each year</span>
        <b class="cond" id="saveY">₹0</b>
        <div class="row">Petrol, per month <b id="pM"></b></div>
        <div style="height:6px;background:#333;margin:-4px 0 10px"><i id="calcBarP" style="display:block;height:100%;background:#9a9994;width:0;transition:width .6s"></i></div>
        <div class="row">S110 charging, per month <b id="eM"></b></div>
        <div style="height:6px;background:#333;margin:-4px 0 10px"><i id="calcBarE" style="display:block;height:100%;background:var(--blue);width:0;transition:width .6s"></i></div>
        <div class="row">Saved over 5 years <b id="s5"></b></div>
        <div class="row">CO₂ avoided each year <b id="co2"></b></div>
      </div>
    </div>
  </div>
</section>'''

faq = [
    ('How far does the S110 go on a charge?', 'About 100 km on road with the standard 2.4 kWh LFP battery, and about 130 km with the extended-range 3.2 kWh NMC battery.'),
    ('Where can I charge it?', 'Anywhere with a regular plug point. Lift the battery out from under the seat and charge it at home, at work or at your shop with the portable charger. Fixed charging and battery swapping are also supported.'),
    ('How long does charging take?', '80% in about 4 hours and a full charge in about 6 hours, according to the latest specification sheet.'),
    ('Can it handle waterlogged roads?', 'Yes. The motor, controller and battery are IP67 certified, and the VCU and display are IP65 rated against rain and dust.'),
    ('What is the warranty?', 'The battery is covered for 8 years or 1,00,000 km, and the motor for 3 years or 50,000 km. The S110 is ARAI certified for a two lakh kilometre service life.'),
    ('Can I take a test ride?', 'Yes. Book one online and the team will bring an S110 to you.'),
]
faq_html = ''.join(f'<details><summary>{q}</summary><div class="acc-body text">{a}</div></details>' for q, a in faq)

ownership = phero('FortheOfficeGoer.webp', 'Ownership', 'Cheaper every', 'single day.',
                  'Lower running cost, an 8-year battery warranty and parts that are easy to find. Here is what owning an S110 looks like.', '', '50% 40%') + savings + '''
<section style="padding-top:0">
  <div class="wrap">
    <div class="head"><div><div class="label rv">Warranty</div><h2 class="cond rv">Covered for<br>the long run.</h2></div></div>
    <div class="big-nums">
      <div class="rv"><b class="cond"><span data-count="8">8</span><small>years</small></b><span>Battery warranty, or 1,00,000 km</span></div>
      <div class="rv"><b class="cond"><span data-count="3">3</span><small>years</small></b><span>Motor warranty, or 50,000 km</span></div>
      <div class="rv"><b class="cond"><span data-count="200000">2,00,000</span><small>km</small></b><span>Service life, ARAI certified</span></div>
    </div>
  </div>
</section>
<section style="padding-top:0">
  <div class="wrap">
    <div class="teasers stagger">
      <figure class="teaser"><div class="ph"><img src="assets/img/EaseofServiceability.webp" alt="S110 being serviced" loading="lazy"></div><div class="t"><h3 class="cond">Easy to service</h3><p>Modular mounting and easily available spares mean minimal downtime.</p></div></figure>
      <figure class="teaser"><div class="ph"><img src="assets/img/LongStandby.webp" alt="S110 key and display" loading="lazy"></div><div class="t"><h3 class="cond">Long standby</h3><p>Complete shutdown when the ignition is off, with minimal self-discharge.</p></div></figure>
      <figure class="teaser"><div class="ph"><img src="assets/img/PortableCharger.webp" alt="Portable charger" loading="lazy"></div><div class="t"><h3 class="cond">Portable charger</h3><p>Lightweight and easy to carry, so the plug point comes to you.</p></div></figure>
    </div>
  </div>
</section>
<section style="padding-top:0">
  <div class="wrap">
    <div class="head"><div><div class="label rv">Questions</div><h2 class="cond rv">Good to know.</h2></div></div>
    <div class="acc rv">''' + faq_html + '''</div>
  </div>
</section>'''

# ------------------------------------------------------------------ ABOUT
about = phero('FortheEntrepreneur.webp', 'About', 'Designed &amp; built', 'in India.',
              'Aventose Energy builds safe, rugged, flexible-charging electric two-wheelers for the way India actually rides.', '', '50% 40%') + '''
<section>
  <div class="wrap split">
    <div class="txt">
      <div class="label rv">Our focus</div>
      <h3 class="cond rv">High-adoption electric mobility.</h3>
      <p class="rv">Electric two-wheelers only change things when ordinary riders can own one without compromise. That is why Aventose focuses on every part of the ecosystem that decides adoption: safety, flexible charging, ruggedness and reliability.</p>
      <ul class="ticks rv"><li>Charge anywhere, with a removable battery</li><li>Safe, with IP67 sealing and Safe Mode</li><li>Rugged, with an ARAI-certified 2,00,000 km service life</li><li>Multi-purpose, for families, shops and fleets</li></ul>
    </div>
    <figure class="ph rv" style="aspect-ratio:1184/544"><img src="assets/img/IntheCity.webp" alt="Two riders on the S110 in the city" loading="lazy"><figcaption>Chennai</figcaption></figure>
  </div>
</section>''' + fix_links(P('press')).replace('style="padding-top:0"', 'style="padding-top:0"') + '''
<section style="padding-top:0">
  <div class="wrap">
    <div class="head"><div><div class="label rv">Contact</div><h2 class="cond rv">Talk to us.</h2></div></div>
    <div class="contact-grid stagger">
      <div><span class="label">Registered office</span><b>Aventose Energy Pvt Ltd</b>C-33, Arihant Amara, 49 Poonamallee High Road, Chennai, Tamil Nadu 600056</div>
      <div><span class="label">Email</span><b><a href="mailto:support@aventose.com">support@aventose.com</a></b>For sales, service and partnerships</div>
      <div><span class="label">Enquire</span><b><a href="enquire.html">Book a test ride</a></b><a href="enquire.html?type=fleet">Fleet sales</a> · <a href="enquire.html?type=dealer">Become a dealer</a></div>
    </div>
  </div>
</section>'''

# ------------------------------------------------------------------ TEAM
# Names, photos and LinkedIn links from aventoseenergy.com/team. Only Vilas Tank's
# role is published (co-founder, per his LinkedIn founder interview); others await titles.
TEAM = [
    ('Vilas Tank', 'Co-founder', 'vilas-tank', 'https://www.linkedin.com/in/vilas-tank-711a5615/'),
    ('Gayatri Soni', 'Leadership team', 'gayatri-soni', 'https://www.linkedin.com/in/gayatrisoni/'),
    ('Nikhil Warwadekar', 'Leadership team', 'nikhil-warwadekar', 'https://www.linkedin.com/in/nikhilwarwadekar/'),
    ('Geeth Prajwal Reddy', 'Leadership team', 'geeth-prajwal-reddy', 'https://www.linkedin.com/in/geethprajwal/'),
    ('Rajesh Sreenath', 'Leadership team', 'rajesh-sreenath', 'https://www.linkedin.com/in/rajeshsreenath/'),
]
members = ''.join(f'''
      <a class="member" href="{li}" target="_blank" rel="noopener" aria-label="{name}, {role} — LinkedIn profile">
        <span class="m-num">{k + 1:02d}</span>
        <span class="m-photo"><img src="assets/img/{img}.webp" alt="{name}" width="270" height="270" loading="lazy"></span>
        <span class="label">{role}</span>
        <h3 class="cond">{name}</h3>
        <span class="m-li">LinkedIn ↗</span>
      </a>''' for k, (name, role, img, li) in enumerate(TEAM))

team = f'''<section class="team-hero">
  <div class="wrap">
    <div class="crumbs"><a href="index.html">Home</a> / Team</div>
    <div class="label">Leadership</div>
    <h1 class="cond"><span class="ln"><span>The people</span></span><span class="ln"><span>behind Aventose.</span></span></h1>
    <p class="lede">Engineers and operators building rugged, safe and flexible-charging electric two-wheelers, designed and built in India.</p>
  </div>
</section>
<section class="team-sec">
  <div class="wrap">
    <div class="team-grid stagger">{members}
    </div>
  </div>
</section>
<section class="team-feature">
  <div class="wrap team-feature-grid">
    <span class="m-photo big rv"><img src="assets/img/vilas-tank.webp" alt="Vilas Tank" width="270" height="270" loading="lazy"></span>
    <div class="txt">
      <div class="label rv">Founder interview</div>
      <h3 class="cond rv">Vilas Tank on building Aventose Energy.</h3>
      <p class="rv">Co-founder Vilas Tank's interview with Xtrawrkx on building Aventose Energy, published on LinkedIn.</p>
      <p class="rv" style="margin-top:22px"><a class="btn line mag" href="https://www.linkedin.com/pulse/founder-interview-vilas-tank-cofounder-aventose-energy-xtrawrkx-nbekc/" target="_blank" rel="noopener">Read the interview on LinkedIn ↗</a></p>
    </div>
  </div>
</section>
<section style="padding-top:0">
  <div class="wrap">
    <div class="contact-grid stagger">
      <div><span class="label">Careers</span><b><a href="mailto:contact@aventose.com?subject=Careers%20at%20Aventose">contact@aventose.com</a></b>Want to build electric mobility with us? Send your profile.</div>
      <div><span class="label">Partners</span><b><a href="enquire.html?type=dealer">Become a dealer</a></b>Open an Aventose showroom or service point.</div>
      <div><span class="label">Fleets</span><b><a href="enquire.html?type=fleet">Fleet sales</a></b>Electric vehicles for delivery and rental businesses.</div>
    </div>
  </div>
</section>'''

# ------------------------------------------------------------------ ENQUIRE
enquire = '<div style="height:clamp(100px,10vw,130px)"></div>' + fix_links(P('lead')).replace('<h2 class="cond">Let\'s find the right Aventose for you.</h2>', '<h1 class="cond" style="font-size:clamp(38px,3.6vw,56px)">Let\'s find the right Aventose for you.</h1>').replace('style="padding-top:0"', 'style="padding-top:0;padding-bottom:clamp(48px,6vw,90px)"', 1) + '''
<section style="padding-top:0">
  <div class="wrap">
    <div class="contact-grid stagger">
      <div><span class="label">Registered office</span><b>Aventose Energy Pvt Ltd</b>C-33, Arihant Amara, 49 Poonamallee High Road, Chennai 600056</div>
      <div><span class="label">Email</span><b><a href="mailto:support@aventose.com">support@aventose.com</a></b>We reply within one working day</div>
      <div><span class="label">Prefer to browse first?</span><b><a href="range.html#compare">Compare the range</a></b><a href="ownership.html">Calculate your savings</a></div>
    </div>
  </div>
</section>'''

PAGES = [
    ('index.html', 'home', 'Aventose Energy — Rugged Electric Mobility', 'Aventose S110: ARAI certified electric scooter, designed and built in India. Removable battery, IP67, 8-year battery warranty.', home, ('s110.html', 'Build your S110', 'IPCertification.webp')),
    ('s110.html', 's110', 'Aventose S110 — Configure, explore and specifications', 'Choose battery and colour, explore every detail and see full specifications of the ARAI certified Aventose S110.', s110, ('range.html', 'The range', 'RenderFinal.webp')),
    ('range.html', 'range', 'Aventose range — S110, S125, M125, M150 compared', 'Compare Aventose electric scooters and motorcycles side by side: range, speed, torque, battery and price.', range_body, ('technology.html', 'Technology', 'Transmission.webp')),
    ('technology.html', 'technology', 'Aventose technology — T.E.J.A.S battery, AURA VCU, IP67', 'Inside Aventose: an 8-year LFP battery, the active-learning AURA VCU and an IP67, ARAI-certified rugged platform.', technology, ('ownership.html', 'Ownership', 'FortheOfficeGoer.webp')),
    ('ownership.html', 'ownership', 'Owning an Aventose — savings, warranty, charging', 'Calculate your petrol savings and see warranty, charging and service details for the Aventose S110.', ownership, ('about.html', 'About Aventose', 'FortheEntrepreneur.webp')),
    ('about.html', 'about', 'About Aventose Energy — designed and built in India', 'Aventose Energy builds safe, rugged, flexible-charging electric two-wheelers in Chennai.', about, ('team.html', 'Meet the team', 'IntheCity.webp')),
    ('team.html', 'team', 'Team — the people behind Aventose Energy', 'Meet the leadership team building Aventose Energy\'s rugged electric two-wheelers in India.', team, ('enquire.html', 'Book a test ride', 'closeimage.webp')),
    ('enquire.html', 'enquire', 'Enquire — test ride, fleet or dealership | Aventose Energy', 'Book an S110 test ride, plan an electric fleet, or apply to become an Aventose dealer.', enquire, None),
]

for fname, pid, title, desc, body, nxt in PAGES:
    open(fname, 'w').write(layout(pid, title, desc, body, nxt))
    print('built', fname)
