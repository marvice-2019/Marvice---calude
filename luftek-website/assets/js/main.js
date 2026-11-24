// Luftek Engineering — site behaviour. Each block only runs if its markup is on the page.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => Math.round(n).toLocaleString("en-IN");

  // ---------------------------------------------------------------- header
  const hdr = $(".hdr");
  const megaBtn = $(".hdr__mega-btn");
  const mega = $("#mega");
  const setMega = (open) => { megaBtn.setAttribute("aria-expanded", String(open)); mega.hidden = !open; };
  if (megaBtn) {
    megaBtn.addEventListener("click", () => setMega(mega.hidden));
    let t;
    const drop = megaBtn.parentElement;
    [drop, mega].forEach((el) => {
      el.addEventListener("mouseenter", () => { if (matchMedia("(hover:hover)").matches) { clearTimeout(t); setMega(true); } });
      el.addEventListener("mouseleave", () => { if (matchMedia("(hover:hover)").matches) t = setTimeout(() => setMega(false), 180); });
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !mega.hidden) { setMega(false); megaBtn.focus(); } });
    document.addEventListener("click", (e) => { if (!mega.hidden && !hdr.contains(e.target)) setMega(false); });
  }
  const burger = $(".hdr__burger");
  const drawer = $("#drawer");
  if (burger) burger.addEventListener("click", () => {
    const open = burger.getAttribute("aria-expanded") !== "true";
    burger.setAttribute("aria-expanded", String(open));
    drawer.hidden = !open;
    drawer.style.top = `${hdr.getBoundingClientRect().bottom}px`;
    document.body.style.overflow = open ? "hidden" : "";
  });
  const onScroll = () => hdr && hdr.classList.toggle("is-scrolled", scrollY > 40);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // ---------------------------------------------------------------- hero carousel
  const hs = $("[data-carousel]");
  if (hs) {
    const slides = $$(".hs__slide", hs), tabs = $$(".hs__tab", hs);
    const DUR = 6500; let i = 0, timer;
    hs.style.setProperty("--dur", `${DUR}ms`);
    const show = (n) => {
      i = (n + slides.length) % slides.length;
      slides.forEach((s, k) => (s.hidden = k !== i));
      tabs.forEach((t, k) => { t.removeAttribute("aria-current"); if (k === i) { void t.offsetWidth; t.setAttribute("aria-current", "true"); } });
    };
    const play = () => { clearInterval(timer); if (!reduced) timer = setInterval(() => show(i + 1), DUR); };
    tabs.forEach((t, k) => t.addEventListener("click", () => { show(k); play(); }));
    hs.addEventListener("mouseenter", () => { clearInterval(timer); hs.classList.add("is-paused"); });
    hs.addEventListener("mouseleave", () => { hs.classList.remove("is-paused"); play(); });
    hs.addEventListener("focusin", () => { clearInterval(timer); hs.classList.add("is-paused"); });
    let x0 = null;
    hs.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
    hs.addEventListener("touchend", (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) { show(i + (dx < 0 ? 1 : -1)); play(); } x0 = null; });
    play();
  }

  // ---------------------------------------------------------------- count-up
  const counters = $$("[data-count]");
  if (counters.length && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((ents) => ents.forEach((en) => {
      if (!en.isIntersecting) return; io.unobserve(en.target);
      const el = en.target, end = +el.dataset.count, plain = "plain" in el.dataset, suf = el.dataset.suffix || "";
      if (reduced) return;
      const start = plain ? end - 12 : 0, t0 = performance.now(), d = 1400;
      const step = (t) => { const k = Math.min(1, (t - t0) / d), v = start + (end - start) * (1 - Math.pow(1 - k, 3)); el.textContent = (plain ? Math.round(v) : fmt(v)) + (k === 1 ? suf : ""); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }), { threshold: 0.6 });
    counters.forEach((c) => io.observe(c));
  }

  // ---------------------------------------------------------------- hotspots
  const hot = $("[data-hotspots]");
  if (hot) {
    const spots = $$(".spot", hot), items = $$(".hot__list li", hot);
    const on = (n) => { spots.forEach((s, k) => s.classList.toggle("is-on", k === n)); items.forEach((li, k) => li.classList.toggle("is-on", k === n)); };
    spots.forEach((s, k) => s.addEventListener("click", () => on(k)));
    items.forEach((li, k) => { $("button", li).addEventListener("click", () => on(k)); li.addEventListener("mouseenter", () => matchMedia("(hover:hover)").matches && on(k)); });
    on(0);
  }

  // ---------------------------------------------------------------- unit selector
  const dataEl = $("#ldata");
  const LD = dataEl ? JSON.parse(dataEl.textContent) : null;
  $$("[data-selector]").forEach((sel) => {
    const root = sel.dataset.root || "";
    const range = $("input[type=range]", sel), out = $("output", sel), list = $(".sel__list", sel), count = $(".sel__count", sel);
    const chips = $$(".chip", sel);
    const MIN = Math.log10(200), MAX = Math.log10(42000);
    const toCfm = (v) => { const raw = Math.pow(10, MIN + (MAX - MIN) * (v / 1000)); const st = raw < 1000 ? 50 : raw < 10000 ? 100 : 500; return Math.round(raw / st) * st; };
    let app = "comfort";
    const PREF = {
      comfort: ["uniflow", "smart", "hideaway", "high", "medium", "low", "eru", "deco"],
      clean: ["clean", "smart", "eru", "uniflow"],
      rooms: ["deco", "medium", "high", "low", "hideaway"],
      energy: ["eru", "smart", "uniflow"],
      halls: ["rtpu", "uniflow"],
    };
    const WHY = {
      uniflow: "Modular, 35 models, EN 1886 casing", smart: "Built-in controls, BMS over MODBUS / BACnet",
      clean: "Hygienic build to VDI 6022, filter bypass F9", eru: "Recovers exhaust energy, AHRI 1061 certified",
      hideaway: "Compact, fits above the false ceiling", low: "Concealed, free-blow at 30 Pa", medium: "Ducted, short runs at 50 Pa",
      high: "Ducted, longer runs at 75 Pa", deco: "Exposed unit with linear bar grille", rtpu: "Self-contained DX, no chilled water needed",
    };
    const render = () => {
      const c = toCfm(+range.value);
      out.textContent = fmt(c);
      range.style.setProperty("--p", `${range.value / 10}%`);
      const order = PREF[app];
      const hits = order.map((k) => LD.products.find((p) => p.key === k))
        .filter((p) => p && (p.cmin === null || (c >= p.cmin && c <= p.cmax)));
      count.textContent = hits.length ? `${hits.length} unit${hits.length > 1 ? "s" : ""} match ${fmt(c)} CFM` : `No standard unit covers ${fmt(c)} CFM for this application.`;
      list.innerHTML = hits.map((p, k) => `<a class="sr-item" href="${root}${p.url}">
          <span class="sr-item__img"><img src="${root}assets/img/${p.img}.webp" alt=""></span>
          <span><b>${esc(p.name)}${k === 0 ? '<span class="sr-item__best">Best fit</span>' : ""}</b>
          <small>${esc(p.famName)} · ${p.cmin ? `${fmt(p.cmin)} – ${fmt(p.cmax)} CFM` : "Packaged DX"}</small>
          <span class="why">${esc(WHY[p.key])}</span></span>
          <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>`).join("") ||
        `<a class="sr-item" href="${root}contact.html"><span class="sr-item__img"></span><span><b>Talk to our engineers</b><small>Multiple units or a custom build may suit this duty.</small></span></a>`;
    };
    range.addEventListener("input", render);
    chips.forEach((ch) => ch.addEventListener("click", () => { chips.forEach((x) => x.setAttribute("aria-pressed", String(x === ch))); app = ch.dataset.app; render(); }));
    render();
  });

  // ---------------------------------------------------------------- tabs (industries)
  $$("[data-tabs]").forEach((wrap) => {
    const tabs = $$('[role="tab"]', wrap);
    const sel = (t, focus) => {
      tabs.forEach((x) => { const on = x === t; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; $("#" + x.getAttribute("aria-controls")).hidden = !on; });
      if (focus) t.focus();
    };
    tabs.forEach((t, k) => {
      t.addEventListener("click", () => sel(t));
      t.addEventListener("keydown", (e) => { const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (d) { e.preventDefault(); sel(tabs[(k + d + tabs.length) % tabs.length], true); } });
    });
  });

  // ---------------------------------------------------------------- rail (drag + buttons)
  $$("[data-rail]").forEach((rail) => {
    const sec = rail.closest("section");
    const card = () => ($(".rcard", rail)?.offsetWidth || 300) + 20;
    $("[data-rail-prev]", sec)?.addEventListener("click", () => rail.scrollBy({ left: -card(), behavior: "smooth" }));
    $("[data-rail-next]", sec)?.addEventListener("click", () => rail.scrollBy({ left: card(), behavior: "smooth" }));
    let down = false, x0 = 0, s0 = 0, moved = false;
    rail.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") return; down = true; moved = false; x0 = e.clientX; s0 = rail.scrollLeft; });
    addEventListener("pointermove", (e) => { if (!down) return; const dx = e.clientX - x0; if (Math.abs(dx) > 4) { moved = true; rail.classList.add("is-drag"); } rail.scrollLeft = s0 - dx; });
    addEventListener("pointerup", () => { down = false; rail.classList.remove("is-drag"); });
    rail.addEventListener("click", (e) => { if (moved) { e.preventDefault(); moved = false; } }, true);
  });

  // ---------------------------------------------------------------- lightbox
  const lb = $("#lightbox");
  let lbSet = [], lbI = 0, lbCap = "", lbReturn = null;
  const lbShow = (n) => { lbI = (n + lbSet.length) % lbSet.length; $("img", lb).src = lbSet[lbI]; $("figcaption", lb).textContent = `${lbCap}${lbSet.length > 1 ? ` · ${lbI + 1} / ${lbSet.length}` : ""}`; $$(".lb__nav", lb).forEach((b) => (b.hidden = lbSet.length < 2)); };
  const lbOpen = (set, n, cap) => { lbSet = set; lbCap = cap || ""; lbReturn = document.activeElement; lb.hidden = false; document.body.style.overflow = "hidden"; lbShow(n); $(".lb__x", lb).focus(); };
  const lbClose = () => { lb.hidden = true; document.body.style.overflow = ""; lbReturn && lbReturn.focus(); };
  if (lb) {
    $(".lb__x", lb).addEventListener("click", lbClose);
    $(".lb__prev", lb).addEventListener("click", () => lbShow(lbI - 1));
    $(".lb__next", lb).addEventListener("click", () => lbShow(lbI + 1));
    lb.addEventListener("click", (e) => { if (e.target === lb) lbClose(); });
    document.addEventListener("keydown", (e) => { if (lb.hidden) return; if (e.key === "Escape") lbClose(); if (e.key === "ArrowRight") lbShow(lbI + 1); if (e.key === "ArrowLeft") lbShow(lbI - 1); });
  }
  $$("[data-zoom]").forEach((b) => b.addEventListener("click", () => lbOpen([b.dataset.zoom], 0, b.dataset.cap)));

  // ---------------------------------------------------------------- product gallery
  $$("[data-gallery]").forEach((g) => {
    const set = JSON.parse(g.dataset.gallery), main = $(".gal__main img", g), ths = $$(".gal__th", g);
    let cur = 0;
    ths.forEach((t, k) => t.addEventListener("click", () => {
      cur = k; ths.forEach((x) => x.classList.toggle("is-on", x === t));
      main.style.opacity = 0; setTimeout(() => { main.src = set[k]; main.style.opacity = 1; }, 150);
    }));
    $(".gal__main", g).addEventListener("click", () => lbOpen(set, cur, g.dataset.caption));
  });

  // ---------------------------------------------------------------- sub-nav scroll-spy (product pages)
  const sub = $("[data-subnav]");
  if (sub) {
    const links = $$("a", sub), secs = links.map((a) => $(a.getAttribute("href")));
    const spy = () => { const y = scrollY + 200; let cur = 0; secs.forEach((s, k) => { if (s && s.offsetTop <= y) cur = k; }); links.forEach((a, k) => a.classList.toggle("is-on", k === cur)); };
    addEventListener("scroll", spy, { passive: true }); spy();
  }

  // ---------------------------------------------------------------- products page family filter
  const fambar = $("[data-fambar]");
  if (fambar) {
    const btns = $$("button", fambar);
    const apply = (f) => {
      btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === f)));
      $$(".pgroup").forEach((g) => (g.hidden = f !== "all" && g.dataset.fam !== f));
      $$(".rng__row").forEach((r) => r.classList.toggle("is-dim", f !== "all" && r.dataset.fam !== f));
    };
    btns.forEach((b) => b.addEventListener("click", () => { apply(b.dataset.f); history.replaceState(null, "", b.dataset.f === "all" ? location.pathname : `#${b.dataset.f}`); }));
    const h = location.hash.slice(1);
    if (["ahu", "fcu", "pkg"].includes(h)) apply(h);
  }

  // ---------------------------------------------------------------- projects page
  const pwrap = $("[data-projects]");
  if (pwrap) {
    const PD = JSON.parse($("#pdata").textContent);
    const cards = $$(".pj", pwrap), chips = $$(".chips .chip", pwrap), cities = $$(".city", pwrap);
    const search = $("[data-psearch]", pwrap), countEl = $("[data-pcount]", pwrap), empty = $(".pempty", pwrap);
    let sector = "all", q = "", city = "";
    const apply = () => {
      let n = 0;
      cards.forEach((c) => { const ok = (sector === "all" || c.dataset.s === sector) && (!q || c.dataset.q.includes(q)) && (!city || c.dataset.q.includes(city)); c.hidden = !ok; if (ok) n++; });
      countEl.textContent = n; empty.hidden = n > 0;
      chips.forEach((ch) => ch.setAttribute("aria-pressed", String(ch.dataset.s === sector)));
      cities.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.city === city)));
    };
    chips.forEach((ch) => ch.addEventListener("click", () => { sector = ch.dataset.s; apply(); }));
    search.addEventListener("input", () => { q = search.value.trim().toLowerCase(); apply(); });
    cities.forEach((b) => b.addEventListener("click", () => { city = city === b.dataset.city ? "" : b.dataset.city; apply(); $(".pfil", pwrap).scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); }));
    $("[data-preset]", pwrap).addEventListener("click", () => { sector = "all"; q = ""; city = ""; search.value = ""; apply(); });

    const pm = $("#pmodal"); let order = [], at = 0, ret = null;
    const fill = (id) => {
      const d = PD[id];
      $(".pm__img img", pm).src = `assets/img/r-${id}.webp`; $(".pm__img img", pm).alt = d.name;
      $('[data-pm="sectorName"]', pm).textContent = d.sectorName; $('[data-pm="name"]', pm).textContent = d.name;
      $('[data-pm="loc"]', pm).textContent = `${d.city}, ${d.country}`; $('[data-pm="need"]', pm).textContent = d.need;
      $('[data-pm="units"]', pm).innerHTML = d.units.map((u) => `<a href="${u.url}">${esc(u.name)}</a>`).join("");
      history.replaceState(null, "", `?p=${id}`);
    };
    const open = (id) => { order = cards.filter((c) => !c.hidden).map((c) => c.dataset.id); at = Math.max(0, order.indexOf(id)); ret = document.activeElement; fill(id); pm.hidden = false; document.body.style.overflow = "hidden"; $(".pm__x", pm).focus(); };
    const close = () => { pm.hidden = true; document.body.style.overflow = ""; history.replaceState(null, "", location.pathname); ret && ret.focus(); };
    const step = (d) => { at = (at + d + order.length) % order.length; fill(order[at]); };
    cards.forEach((c) => $(".pj__btn", c).addEventListener("click", () => open(c.dataset.id)));
    $(".pm__x", pm).addEventListener("click", close);
    $("[data-pm-prev]", pm).addEventListener("click", () => step(-1));
    $("[data-pm-next]", pm).addEventListener("click", () => step(1));
    pm.addEventListener("click", (e) => { if (e.target === pm) close(); });
    document.addEventListener("keydown", (e) => { if (pm.hidden) return; if (e.key === "Escape") close(); if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); });

    const qs = new URLSearchParams(location.search);
    if (qs.get("sector") && $(`.chip[data-s="${qs.get("sector")}"]`, pwrap)) { sector = qs.get("sector"); apply(); }
    if (qs.get("p") && PD[qs.get("p")]) open(qs.get("p"));
  }

  // ---------------------------------------------------------------- timeline
  const tl = $("[data-tl]");
  if (tl) {
    const items = $$(".tl__item", tl), years = $$("[data-tl-years] button");
    const on = (y) => { items.forEach((it) => it.classList.toggle("is-on", it.dataset.y === y)); years.forEach((b) => (b.dataset.y === y ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current"))); };
    years.forEach((b) => b.addEventListener("click", () => { on(b.dataset.y); const it = items.find((x) => x.dataset.y === b.dataset.y); tl.scrollTo({ left: it.offsetLeft - tl.offsetLeft, behavior: reduced ? "auto" : "smooth" }); }));
    items.forEach((it) => it.addEventListener("mouseenter", () => on(it.dataset.y)));
    on(items[0].dataset.y);
  }

  // ---------------------------------------------------------------- contact form
  const form = $("#enquiry");
  if (form) {
    const pre = new URLSearchParams(location.search).get("product");
    const sel = $('select[name="product"]', form);
    if (pre && [...sel.options].some((o) => o.text === pre)) sel.value = pre;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let ok = true;
      $$("[required]", form).forEach((el) => { const bad = !el.value.trim() || (el.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value)); el.setAttribute("aria-invalid", String(bad)); if (bad) ok = false; });
      const note = $(".form__note", form);
      if (!ok) { note.textContent = "Please add your name and a valid email address."; $('[aria-invalid="true"]', form).focus(); return; }
      const d = Object.fromEntries(new FormData(form));
      const body = [`Name: ${d.name}`, `Company: ${d.company}`, `Email: ${d.email}`, `Phone: ${d.phone}`, `Product: ${d.product}`, `Airflow (CFM): ${d.cfm}`, `City: ${d.city}`, `Quantity: ${d.qty}`, "", d.msg].join("\n");
      location.href = `mailto:sales@luftek.in?subject=${encodeURIComponent(`Selection request: ${d.product} — ${d.company || d.name}`)}&body=${encodeURIComponent(body)}`;
      note.textContent = "Your email app should now be open with the request filled in.";
    });
  }

  // ---------------------------------------------------------------- reveal on scroll
  if ("IntersectionObserver" in window && !reduced) {
    const els = $$(".sec__head, .fam, .pcard, .cc, .off, .vmc article, .split__img, .split__body, .ind, .hot, .sel, .rng, .tbl-wrap, .qp, .acard, .about > *");
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -6% 0px" });
    els.forEach((el) => { el.classList.add("rv"); io.observe(el); });
    $$(".pgrid, .fams, .ccs, .offs, .acards").forEach((g) => $$(":scope > *", g).forEach((c, k) => (c.style.transitionDelay = `${(k % 4) * 70}ms`)));
  }
  $$("[data-year]").forEach((y) => (y.textContent = new Date().getFullYear()));
})();
