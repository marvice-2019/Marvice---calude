"""One-off: split the v3 single-page index.html into reusable partials under src/partials/."""
import os
import re

src = open('index.html').read()
body = src[src.index('<div class="hero" id="top">'):src.index('<footer>')]

# Top-level blocks in v3, in order. Each runs until the next start marker.
MARKERS = [
    ('hero', '<div class="hero" id="top">'),
    ('facts', '<div class="wrap">\n  <div class="facts">'),
    ('product', '<section class="product" id="s110">'),
    ('explore', '<section class="explore" id="explore">'),
    ('rugged', '<section id="rugged">'),
    ('band', '<div class="band" id="charging">'),
    ('reel', '<section class="reel" id="reel"'),
    ('people', '<section class="people">'),
    ('lineup', '<section class="lineup" id="range">'),
    ('savings', '<section id="savings">'),
    ('press', '<section id="press"'),
    ('lead', '<section id="book"'),
]
pos = [(name, body.index(m)) for name, m in MARKERS]
os.makedirs('src/partials', exist_ok=True)
for i, (name, start) in enumerate(pos):
    end = pos[i + 1][1] if i + 1 < len(pos) else len(body)
    open(f'src/partials/{name}.html', 'w').write(body[start:end].strip() + '\n')
    print(name, end - start)
