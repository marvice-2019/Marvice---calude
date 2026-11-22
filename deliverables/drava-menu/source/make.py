"""Build the DRAVA beverage menu as HTML, then print to PDF with Chromium."""
import html, base64, pathlib, sys
from art import glass

HERE = pathlib.Path(__file__).parent
E = html.escape

# ---------- content (prices exactly as the client's menu; spelling corrected) ----------
DRAUGHT = [
    ("Kingfisher Premium", 299, 1399, 2699),
    ("Kingfisher Ultra", 319, 1499, 2999),
    ("Budweiser Premium", 319, 1499, 2999),
    ("Budweiser Magnum", 349, 1599, 3199),
]

P1_SECTIONS = [
    ("Beer", "Bottle", [
        ("Corona", 599), ("Hoegaarden", 599), ("Budweiser Magnum", 499),
        ("Carlsberg Elephant", 499), ("Budweiser Premium", 449), ("Heineken Silver", 449),
        ("Carlsberg Smooth", 399), ("Ultra Max Strong", 399), ("Kingfisher Ultra", 399),
        ("Kingfisher Premium", 349)]),
    ("Single Malt", "30 ml", [
        ("Singleton", 699), ("Monkey Shoulder", 649), ("Glenfiddich 12 Yr", 649),
        ("Glenlivet 12 Yr", 649), ("Paul John", 449), ("Paul John Nirvana", 349)]),
    ("Whisky", "30 ml", [
        ("JW Blue Label", 1499), ("JW Double Black", 549), ("JW Black Label", 499),
        ("Jack Daniel's", 499), ("Chivas Regal", 499), ("Jameson", 449),
        ("Ballantine's", 449), ("JW Red Label", 449), ("Jim Beam", 449),
        ("Black Dog 8 Yr", 399), ("Black & White", 399), ("Teacher's Highland Cream", 399),
        ("100 Pipers", 399), ("Dewar's White Label", 349)]),
    ("Brandy", "30 ml", [
        ("Hennessy", 999), ("Morpheus Blue", 399), ("Mansion House", 299), ("Roulette Brandy", 299)]),
    ("Rum", "30 ml", [
        ("Bacardi Carta Blanca", 349), ("Bacardi Flavours", 349), ("Bacardi Black", 349), ("Old Monk", 299)]),
    ("Gin", "30 ml", [
        ("Roku", 699), ("Bombay Sapphire", 449), ("Beefeater", 449), ("Malhar", 449), ("Greater Than", 349)]),
    ("Vodka", "30 ml", [
        ("Roberto Cavalli", 799), ("U'Luvka", 599), ("Grey Goose", 599), ("Absolut", 499), ("Smirnoff", 349)]),
    ("Tequila", "30 ml", [
        ("Patrón Silver", 799), ("Camino Real Silver", 499), ("Camino Real Gold", 499), ("Tequila Silver", 349)]),
    ("Liqueur", "30 ml", [
        ("Jägermeister", 599), ("Baileys", 399), ("Kahlúa", 399), ("Sambuca", 399)]),
    ("Sparkling Wine", "Bottle", [
        ("Cinzano Prosecco", 4999), ("Fratelli Noi", 4499)]),
    ("Wine", "Glass", [
        ("Jacob's Creek Shiraz", 799), ("Jacob's Creek Chardonnay", 799), ("Big Banyan Shiraz", 549),
        ("Big Banyan Chenin Blanc", 549), ("Fratelli Shiraz", 549), ("Fratelli Chenin Blanc", 549)]),

]

SIGNATURE = [
    ("Passion Martini", 449, "Vodka, passion fruit, fresh lime, sweetener"),
    ("Dravita", 449, "Tequila, pineapple crush, sweetener, fresh lime"),
    ("Kala Khatta", 449, "Vodka, kala khatta, chaat masala, coriander, chilli, mint, lime"),
    ("Irish Mojito", 449, "Whisky, lime, mint, brown sugar, tonic water"),
    ("Drava BTS", 449, "Whisky, Baileys, chocolate sauce, fresh cream, Oreo, sweet mixer"),
    ("Minty Jamun", 449, "Jamun, mint, green chilli, chaat masala, sweet & sour, soda"),
]
SPECIAL = [
    ("Red Thong", 999, "Rum, gin, vodka, brandy, tequila, triple sec, strawberry & raspberry crush, sour mix"),
    ("Morning Star", 999, "Rum, gin, vodka, brandy, tequila, triple sec, pineapple, blue curaçao, sour mix"),
    ("Faadduu", 999, "Rum, gin, vodka, brandy, tequila, whisky, triple sec, olive, jalapeño, gherkin, sweet lime, sour mix, Sprite"),
    ("Painkiller", 999, "Rum, gin, vodka, brandy, tequila, passion fruit, lime leaf, pineapple crush & juice"),
    ("Green Paradise", 999, "Rum, gin, vodka, tequila, triple sec, kiwi crush, lime, sweetener, Sprite"),
]
CLASSIC = ["Margarita", "Mojito", "Piña Colada", "Martini", "Sex on the Beach", "Whisky Sour",
           "Cosmopolitan", "Screwdriver", "Tequila Sunrise", "Tom Collins", "Mai Tai",
           "Sangria Red", "Sangria White"]
TALL = [("L.I.I.T.", 999), ("Bull Frog", 999), ("Long Beach Iced Tea", 999), ("Bangalore Sunset", 999)]
PITCHER = [("L.I.I.T.", 1599), ("Mojito", 1599), ("Sangria", 1599), ("Caipiroska", 1599)]
MIXERS = [
        ("Red Bull", 379), ("Canned Juice", 189), ("Ginger Ale", 149), ("Tonic Water", 149),
        ("Mineral Water 1 L", 75), ("Soda Water", 79), ("Sprite / Coke", 95)]
SHOOTERS = [
        ("Jäger Bomb", 899), ("B-52", 449), ("Kamikaze", 349), ("Chilli Tequila", 349), ("Fireball", 299)]
BREEZERS = [
        ("Cranberry", 399), ("Orange", 399), ("Jamaican", 399), ("Watermelon", 399), ("Bacardi & Cranberry", 399)]
MOCK = [("Spicy Guava", 349), ("Mango Chilli", 349), ("Blue Iceland Tea", 349), ("White Lady", 349),
        ("Virgin Choice", 349), ("Fruit Punch", 349)]


def price(p):
    return f"{p:,}"


ICON = {"Draught Beer": "mug", "Beer": "bottle", "Single Malt": "rocks", "Whisky": "rocks",
        "Brandy": "snifter", "Rum": "highball", "Gin": "coupe", "Vodka": "martini", "Tequila": "shot",
        "Liqueur": "coupe", "Shooters": "shot", "Breezers": "bottle", "Sparkling Wine": "flute",
        "Wine": "wine", "Signature Cocktails": "coupe", "Classic Cocktails": "martini",
        "Tall Boys": "hurricane", "Cocktail Pitchers": "pitcher", "Mocktails": "highball",
        "Mixers & Soft Drinks": "bottle"}


def ico(title):
    return glass(ICON[title]) if title in ICON else ""


def section(title, unit, rows, cls="", photo=None):
    items = "".join(
        f'<li><span class="n">{E(n)}</span><span class="p">{price(p)}</span></li>' for n, p in rows)
    u = f'<span class="unit">{E(unit)}</span>' if unit else ""
    if photo:
        return f'<section class="sec {cls}">{banner(photo, title, unit)}<ul>{items}</ul></section>'
    return f'<section class="sec {cls}"><h3>{ico(title)}<span class="t">{E(title)}</span><span class="rule"></span>{u}</h3><ul>{items}</ul></section>'


def described(rows):
    return "".join(
        f'<li class="d"><div class="row"><span class="n">{E(n)}</span><span class="p">{price(p)}</span></div>'
        f'<div class="desc">{E(d)}</div></li>' for n, p, d in rows)


logo = base64.b64encode((HERE / "logo.png").read_bytes()).decode()
LOGO = f'<img class="logo" src="data:image/png;base64,{logo}" alt="Drava Bar &amp; Kitchen">'


def photo(name):
    b = base64.b64encode((HERE / "img" / f"{name}.jpg").read_bytes()).decode()
    return f'<div class="ph" style="background-image:url(data:image/jpeg;base64,{b})"></div>'


def bgimg(name):
    b = base64.b64encode((HERE / "img" / f"{name}.jpg").read_bytes()).decode()
    return f'<div class="bg" style="background-image:url(data:image/jpeg;base64,{b})"></div>'


def banner(photo_name, title, unit=""):
    b = base64.b64encode((HERE / "img" / f"bz_{photo_name}.webp").read_bytes()).decode()
    u = f'<span class="unit">{E(unit)}</span>' if unit else ""
    return (f'<div class="bnw"><div class="bn" style="background-image:url(data:image/webp;base64,{b})"></div>'
            f'<span class="bt">{E(title)}</span>{u}</div>')


def header(left, right):
    return (f'<header class="hd"><div class="hl"><span class="hk">{left}</span></div>{LOGO}'
            f'<div class="hr"><span class="hs">{right}</span></div></header>')


def band(names, kicker):
    return (f'<div class="band"><div class="strip">{"".join(photo(n) for n in names)}</div>'
            f'<div class="shade"></div><div class="brand">{LOGO}</div>'
            f'<div class="kicker"><span></span>{kicker}<span></span></div></div>')


S = {t: (u, r) for t, u, r in P1_SECTIONS}
PH = {"Whisky": "whisky", "Wine": "wine"}


def sec(t):
    return section(t, *S[t], photo=PH.get(t))


draught_rows = "".join(
    f'<tr><td class="n">{E(n)}</td><td>{price(a)}</td><td>{price(b)}</td><td>{price(c)}</td></tr>'
    for n, a, b, c in DRAUGHT)
DRAUGHT_SEC = f"""<section class="sec draught">
    {banner("beer", "Draught Beer")}
    <table><thead><tr><th></th><th>Mug</th><th>Pitcher</th><th>Tower</th></tr></thead>
    <tbody>{draught_rows}</tbody></table></section>"""

page1 = f"""
<div class="page p1">
  {bgimg("bg1")}
  {header("The Bar", "Spirits · Beer · Wine")}
  <div class="frame"></div>
  <div class="cols two">
    <div class="col">{DRAUGHT_SEC}{''.join(sec(t) for t in ["Beer", "Single Malt", "Whisky"])}</div>
    <div class="col">{''.join(sec(t) for t in ["Brandy", "Rum", "Gin", "Vodka", "Tequila", "Liqueur", "Sparkling Wine", "Wine"])}</div>
  </div>
  <footer>Spirits served in 30 ml &nbsp;·&nbsp; Prices in ₹ &nbsp;·&nbsp; Government taxes as applicable</footer>
</div>"""

page2 = f"""
<div class="page p2">
  {bgimg("bg2")}
  {header("Cocktails", "Signatures · Classics · Mocktails")}
  <div class="frame"></div>
  <div class="cols two">
    <div class="col">
      <section class="sec">{banner("coupe", "Signature Cocktails")}
        <ul>{described(SIGNATURE)}</ul></section>
      <section class="special">
        <div class="sp-head"><div class="sp-k">House Strong</div><div class="sp-t">The Drava Special</div>
        <div class="sp-s">Our strongest, longest Long Island iced teas</div></div>
        <ul>{described(SPECIAL)}</ul></section>
      {section("Cocktail Pitchers", "", PITCHER, "after-special")}
      {section("Shooters", "", SHOOTERS)}
    </div>
    <div class="col">
      {section("Classic Cocktails", "", [(c, 449) for c in CLASSIC], photo="martini")}
      {section("Tall Boys", "", TALL)}
      {section("Breezers", "", BREEZERS)}
      {section("Mocktails", "", MOCK, photo="mojito")}
      {section("Mixers & Soft Drinks", "", MIXERS)}
    </div>
  </div>
  <footer>Prices in ₹ &nbsp;·&nbsp; Government taxes as applicable &nbsp;·&nbsp; Please drink responsibly</footer>
</div>"""

css = (HERE / "fonts" / "fonts.css").read_text() + (HERE / "style.css").read_text()
doc = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drava Menu</title>
<style>{css}</style></head><body>{page1}{page2}</body></html>"""
(HERE / "menu.html").write_text(doc)
print("html ok")
