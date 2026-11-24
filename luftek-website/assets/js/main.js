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
    if (["ahu", "fcu", "hau", "pkg"].includes(h)) apply(h);
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

  // ---------------------------------------------------------------- lead tracking (first-touch source, kept for the session)
  try {
    if (!sessionStorage.getItem("lf_src")) {
      const q = new URLSearchParams(location.search), src = {};
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"].forEach((k) => q.get(k) && (src[k] = q.get(k)));
      src.landing = location.pathname; src.referrer = document.referrer || "direct";
      sessionStorage.setItem("lf_src", JSON.stringify(src));
    }
  } catch (_) { /* storage blocked: source simply not attached */ }

  // ---------------------------------------------------------------- lead form (multi-step)
  const CFM_MIN = Math.log10(200), CFM_MAX = Math.log10(42000);
  const toCfm = (v) => { const raw = Math.pow(10, CFM_MIN + (CFM_MAX - CFM_MIN) * (v / 1000)); const st = raw < 1000 ? 50 : raw < 10000 ? 100 : 500; return Math.round(raw / st) * st; };
  const LABELS = { category: "Category", product: "Unit", application: "Application", airflow: "Airflow", quantity: "Quantity", city: "City", timeline: "Timeline", name: "Name", company: "Company", email: "Email", phone: "Mobile", role: "Role" };

  function initLead(form) {
    const steps = $$(".lf__step", form), rail = $$(".lf__rail li", form), bar = $(".lf__bar i", form);
    const back = $("[data-back]", form), next = $("[data-next]", form), submit = $("[data-submit]", form);
    const prodWrap = $(".lf__prod", form), prodChips = $("[data-prodchips]", form);
    const PRODS = JSON.parse(form.dataset.products), sumEl = $("[data-summary]", form), sumBox = $(".lf__sum", form);
    const range = $("[data-cfm]", form), cfmOut = $("[data-cfm-out]", form), unknown = $("[data-cfm-unknown]", form), air = $(".lf__air", form);
    let at = 0;
    const touched = new Set();

    const val = (n) => { const el = form.elements[n]; if (!el) return ""; if (el instanceof RadioNodeList) return el.value; return el.type === "checkbox" ? el.checked : el.value.trim(); };
    const data = () => ({
      category: val("category"), product: val("product"), application: val("application"),
      airflow: unknown.checked ? "Not known yet" : `${fmt(toCfm(+range.value))} CFM`, quantity: val("quantity"), city: val("city"), project: val("project"),
      timeline: val("timeline"), name: val("name"), company: val("company"), email: val("email"), phone: val("phone"), role: val("role"), message: val("message"),
    });
    const renderSummary = () => {
      const d = data(), keys = ["category", "product", "application", "airflow", "quantity", "city", "timeline"];
      const rows = keys.filter((k) => d[k] && (!["airflow", "quantity"].includes(k) || touched.has(k))).map((k) => `<div><dt>${LABELS[k]}</dt><dd>${esc(d[k])}</dd></div>`);
      sumEl.innerHTML = rows.join("") || "<div><dt>Category</dt><dd>—</dd></div>";
      sumBox.dataset.mini = [d.product || d.category, d.application, touched.has("airflow") ? d.airflow : ""].filter(Boolean).join(" · ") || "Start by choosing a category";
    };
    const show = (n) => {
      at = n;
      steps.forEach((s, k) => (s.hidden = k !== n));
      rail.forEach((li, k) => { li.classList.toggle("is-done", k < n); k === n ? li.setAttribute("aria-current", "step") : li.removeAttribute("aria-current"); });
      bar.style.width = `${((n + 1) / steps.length) * 100}%`;
      back.hidden = n === 0; next.hidden = n === steps.length - 1; submit.hidden = n !== steps.length - 1;
      if (n === steps.length - 1) review();
      const lg = $("legend", steps[n]); if (lg && form.contains(document.activeElement)) { lg.setAttribute("tabindex", "-1"); lg.focus({ preventScroll: true }); }
      const top = form.closest(".lfd__panel") || null;
      if (top) top.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" }); else if (form.getBoundingClientRect().top < 80) form.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    };
    const fail = (stepEl, msg, el) => { $(".lf__err", stepEl).textContent = msg; if (el) { el.setAttribute("aria-invalid", "true"); el.focus(); } return false; };
    const check = (n) => {
      const s = steps[n]; $$(".lf__err", s).forEach((x) => (x.textContent = "")); $$("[aria-invalid]", s).forEach((x) => x.removeAttribute("aria-invalid"));
      if (n === 0 && !val("category")) return fail(s, "Choose a category to continue.");
      if (n === 2) {
        if (!val("name")) return fail(s, "Please add your name.", form.elements.name);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val("email"))) return fail(s, "Please add a valid email address.", form.elements.email);
        if (val("phone").replace(/\D/g, "").length < 10) return fail(s, "Please add a mobile number with at least 10 digits.", form.elements.phone);
        if (!val("consent")) return fail(s, "Please tick the consent box so we can contact you.");
      }
      return true;
    };
    const review = () => {
      const d = data(), order = [["category", 0], ["product", 0], ["application", 1], ["airflow", 1], ["quantity", 1], ["city", 1], ["timeline", 1], ["name", 2], ["company", 2], ["email", 2], ["phone", 2], ["role", 2]];
      $("[data-review]", form).innerHTML = order.filter(([k]) => d[k]).map(([k, st]) => `<div><dt>${LABELS[k]}</dt><dd>${esc(d[k])}</dd><button type="button" data-goto="${st}">Edit</button></div>`).join("");
    };

    form.addEventListener("change", (e) => {
      if (e.target.name === "category") {
        const fam = e.target.dataset.fam, list = PRODS[fam] || [];
        prodWrap.hidden = !list.length;
        prodChips.innerHTML = list.map((n) => `<label class="lf-chip"><input type="radio" name="product" value="${esc(n)}"><span>${esc(n)}</span></label>`).join("");
        $(".lf__err", steps[0]).textContent = "";
      }
      renderSummary();
    });
    form.addEventListener("input", (e) => { if (e.target.name === "quantity") touched.add("quantity"); renderSummary(); });
    range.addEventListener("input", () => { touched.add("airflow"); cfmOut.textContent = fmt(toCfm(+range.value)); renderSummary(); });
    unknown.addEventListener("change", () => { touched.add("airflow"); air.classList.toggle("is-off", unknown.checked); range.disabled = unknown.checked; renderSummary(); });
    $$("[data-q]", form).forEach((b) => b.addEventListener("click", () => { touched.add("quantity"); const q = form.elements.quantity; q.value = Math.max(1, Math.min(999, (parseInt(q.value, 10) || 1) + +b.dataset.q)); renderSummary(); }));
    next.addEventListener("click", () => { if (check(at)) show(at + 1); });
    back.addEventListener("click", () => show(at - 1));
    form.addEventListener("click", (e) => { const g = e.target.closest("[data-goto]"); if (g) show(+g.dataset.goto); });
    form.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox" && at < steps.length - 1) { e.preventDefault(); next.click(); } });

    const done = (ref, fallback) => {
      $(".lf__nav", form).hidden = true; steps.forEach((s) => (s.hidden = true)); $(".lf__rail", form).hidden = true; $(".lf__bar", form).hidden = true;
      $("[data-ref]", form).textContent = ref; $("[data-fallback]", form).hidden = !fallback; $(".lf__done", form).hidden = false;
    };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!check(2)) { show(2); check(2); return; }
      if (val("website")) { done("LFT-000000-0000", false); return; } // honeypot: silently accept bots
      const d = data(), now = new Date();
      const ref = `LFT-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
      let src = {}; try { src = JSON.parse(sessionStorage.getItem("lf_src") || "{}"); } catch (_) { /* no source */ }
      const payload = { ref, ...d, page: location.href, source: src, submitted_at: now.toISOString() };
      const ep = form.dataset.endpoint;
      submit.setAttribute("aria-busy", "true");
      if (ep) {
        try {
          const r = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          if (!r.ok) throw new Error(r.status);
          submit.removeAttribute("aria-busy"); done(ref, false); return;
        } catch (_) { /* network or endpoint error: fall back to email so the lead is not lost */ }
      }
      const body = [`Reference: ${ref}`, "", ...Object.entries(LABELS).map(([k, l]) => `${l}: ${d[k] || "-"}`), `Project: ${d.project || "-"}`, "", d.message || "", "", `Page: ${location.href}`, `Source: ${src.utm_source || src.referrer || "-"} ${src.utm_campaign ? "/ " + src.utm_campaign : ""}`].join("\n");
      location.href = `mailto:sales@luftek.in?subject=${encodeURIComponent(`Selection request ${ref}: ${d.product || d.category} - ${d.company || d.name}`)}&body=${encodeURIComponent(body)}`;
      submit.removeAttribute("aria-busy"); done(ref, true);
    });
    $("[data-reset]", form).addEventListener("click", () => {
      form.reset(); touched.clear(); prodWrap.hidden = true; air.classList.remove("is-off"); range.disabled = false; cfmOut.textContent = fmt(toCfm(+range.value));
      $(".lf__done", form).hidden = true; $(".lf__nav", form).hidden = false; $(".lf__rail", form).hidden = false; $(".lf__bar", form).hidden = false; renderSummary(); show(0);
    });

    form.preset = (product) => {
      if (!product) return;
      const fam = Object.keys(PRODS).find((k) => PRODS[k].includes(product));
      const cat = fam && $(`input[name="category"][data-fam="${fam}"]`, form);
      if (cat) { cat.checked = true; cat.dispatchEvent(new Event("change", { bubbles: true })); const p = $(`input[name="product"][value="${CSS.escape(product)}"]`, form); if (p) p.checked = true; renderSummary(); }
    };
    renderSummary(); show(0);
    return form;
  }
  const leadForms = $$("[data-lead]").map(initLead);
  const pagePreset = new URLSearchParams(location.search).get("product");
  const pageForm = leadForms.find((f) => f.classList.contains("lf--page"));
  if (pageForm && pagePreset) pageForm.preset(pagePreset);

  // Slide-in drawer: every "Request a selection" link opens the form in place
  const lfd = $("#leaddrawer");
  if (lfd) {
    const dForm = $("[data-lead]", lfd); let ret = null;
    const open = (product) => { ret = document.activeElement; lfd.hidden = false; document.body.style.overflow = "hidden"; dForm.preset(product); setTimeout(() => $(".lfd__x", lfd).focus(), 50); };
    const close = () => { lfd.hidden = true; document.body.style.overflow = ""; ret && ret.focus(); };
    document.addEventListener("click", (e) => {
      const a = e.target.closest('a[href*="contact.html"]');
      if (!a || e.metaKey || e.ctrlKey || a.closest(".foot, .drawer__c, .hdr__nav")) return;
      e.preventDefault(); if (!drawer.hidden) burger.click(); open(new URL(a.href, location.href).searchParams.get("product"));
    });
    $(".lfd__x", lfd).addEventListener("click", close);
    lfd.addEventListener("click", (e) => { if (e.target === lfd) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !lfd.hidden) close(); });
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
