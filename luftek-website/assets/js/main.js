// Luftek Engineering — page behaviour. Product and project data are taken from luftek.in (Nov 2026).
(() => {
  const EN1886 = {
    "502LK": [["Thermal conductivity", "T2"], ["Thermal bridging", "TB2"], ["Casing strength", "D1"], ["Casing leakage", "L1"], ["Filter bypass", "F9"]],
  };
  const AHU_BUILD = [
    "50 mm double-skin panels, injected PU foam",
    "Extruded aluminium frame with thermal break",
    "Precoated outer / galvanised inner sheet",
    "Aluminium or stainless steel sheet options",
    "Stainless steel drain pan",
    "IE2 / IE3 motors, IP55, class F insulation",
  ];
  const AHU_CERT = [
    "EN 1886 casing ratings, certified by Eurovent",
    "Casing to EN ISO 9223",
    "AHRI 410 certified cooling and heating coils",
    "Fans to AMCA 210 (performance) and AMCA 300 (sound)",
    "ISO 16890 / EN 779 certified filters",
    "EC fans for energy saving",
  ];
  const FCU_FEAT = [
    "Low-height, heavy-gauge sheet metal construction",
    "Low-noise aluminium impeller, DIDW blowers",
    "Motors with overload protection sensors",
    "Counter-flow, high-efficiency coils",
  ];

  const P = [
    { fam: "ahu", name: "UniFlow Unit", img: "p-uniflow", cfm: "1,000 – 42,000",
      desc: "Modular double-skin AHUs built around certified components, with 35 models to match the duty. Customised to the project's construction, size and performance requirements.",
      a: ["35 models across the range", "502LK, 503LK and 251LK series", ...AHU_BUILD.slice(0, 4)], b: AHU_CERT, en: "502LK", extra: "503LK: TB3 · 251LK: T3" },
    { fam: "ahu", name: "Smart Unit", img: "p-smart", cfm: "1,000 – 42,000",
      desc: "An AHU with its control panel, control valve and sensors built in. The controller adjusts fan speed and chilled water flow to the load, and an HMI lets the client set and view parameters at the unit.",
      a: ["Inbuilt controller, valve and sensors", "BMS ready over MODBUS or BACnet", "Touch HMI for set-points", ...AHU_BUILD.slice(0, 3)], b: AHU_CERT, en: "502LK", extra: "503LK: TB3" },
    { fam: "ahu", name: "Clean Room Unit", img: "p-clean", cfm: "1,000 – 42,000",
      desc: "For hospitals, pharma, food processing and sterile rooms, where the AHU itself must not grow or carry microorganisms. Designed to DIN 1946-4 and VDI 6022 hygiene requirements.",
      a: ["VDI 6022 certified accessories", "Plug fans with AC or EC motors", ...AHU_BUILD], b: AHU_CERT, en: "502LK" },
    { fam: "ahu", name: "Energy Recovery Unit", img: "p-eru", cfm: "1,000 – 30,000",
      desc: "Recovers energy from conditioned exhaust air into the incoming fresh air, using a recovery wheel, a cross-flow plate exchanger or heat pipes.",
      a: ["Wheel, plate or heat pipe recovery", "Recovery devices certified to AHRI 1061", ...AHU_BUILD.slice(0, 4)], b: AHU_CERT, en: "502LK", extra: "503LK: TB3" },

    { fam: "fcu", name: "Hide Away Unit", img: "p-hideaway", cfm: "1,000 – 8,000",
      desc: "A compact unit that sits above the false ceiling. It takes up less plenum depth than a conventional AHU and runs quietly, which suits builders and architects.",
      a: ["25 / 40 mm double-skin panels", "Aluminium frame, with or without thermal break", "PU foam, rockwool or glass wool insulation", "Stainless steel drain pan", "IE2 / IE3 motors, IP55"], b: ["Casing to EN ISO 9223", "AHRI 410 certified cooling coils", "Fans to AMCA 210 / 300", "ISO 16890 / EN 779 filters", "EC fans for energy saving"] },
    { fam: "fcu", name: "Low Static Unit", img: "p-fcu-low", cfm: "400 – 1,200", esp: "30 Pa",
      desc: "Conventional fan coil units with UL-recognised motor components and low-noise centrifugal DIDW blowers. The slim build suits hotels, hospitals and apartments.",
      a: FCU_FEAT, b: ["Rated at 30 Pa ESP", "Single skin, nitrile foam insulation", "Single-phase PSC motor, multi-speed, IP20", "Stainless steel drain pan", "Option: 25 mm double skin with PU"] },
    { fam: "fcu", name: "Medium Static Unit", img: "p-fcu-med", cfm: "200 – 1,200", esp: "50 Pa",
      desc: "Ducted fan coil units for short duct runs. UL-recognised motor components and low-noise centrifugal DIDW blowers in a slim casing.",
      a: [...FCU_FEAT, "2-pipe and 4-pipe coil options"], b: ["Rated at 50 Pa ESP", "High Delta-T coils for district cooling", "Single-phase PSC motor, multi-speed, IP20", "Stainless steel drain pan", "Option: 25 mm double skin with PU"] },
    { fam: "fcu", name: "High Static Unit", img: "p-fcu-high", cfm: "800 – 2,400", esp: "75 Pa",
      desc: "Fan coil units for longer duct runs and higher resistance. UL-recognised motor components and low-noise centrifugal DIDW blowers.",
      a: [...FCU_FEAT, "2-pipe and 4-pipe coil options"], b: ["Rated at 75 Pa ESP", "High Delta-T coils for district cooling", "Single-phase PSC motor, multi-speed, IP20", "Stainless steel drain pan", "Option: 25 mm double skin with PU"] },
    { fam: "fcu", name: "Decorative Unit", img: "p-decorative", cfm: "200 – 1,200",
      desc: "Exposed fan coil units with a linear bar grille on supply and an egg-crate grille on return. Built for free throw at minimum static, so air reaches further and the unit stays quiet.",
      a: ["25 mm double-skin casing, PU insulated", "Low-height construction", "Low-noise aluminium impeller", "2-pipe and 4-pipe coil options"], b: ["High Delta-T coils for district cooling", "Single-phase PSC motor, multi-speed, IP20", "Stainless steel drain pan", "Inbuilt valve package (option)"] },

    { fam: "pkg", name: "Roof Top Package Unit", img: "p-rtpu", cfm: "Packaged DX",
      desc: "Self-contained cooling for auditoriums, banquet and prayer halls, supermarkets and convention centres. Every unit is leak tested, vacuumed, desiccated and charged with R410A before it ships.",
      a: ["ESMA certified for efficiency", "Runs at ambient up to 52 °C", "Scroll compressors, high EER", "IP54 axial condenser fans", "Anti-corrosion coating for saline air (option)"], b: ["DIDW forward-curved supply fan", "Seamless copper / aluminium fin condenser with subcooling", "25 mm aluminium mesh filter", "Phase reversal, imbalance and voltage protection", "Thermostat (option)"] },
  ];
  const FAM = { ahu: "Air Handling Unit", fcu: "Fan Coil Unit", pkg: "Package Unit" };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const list = document.getElementById("plist");
  const panel = document.getElementById("ppanel");
  let fam = "ahu";

  function renderPanel(p) {
    const en = p.en ? `<div class="pp__en">${EN1886[p.en].map(([k, v]) => `<span>${esc(k)}<b>${v}</b></span>`).join("")}${p.extra ? `<span>${esc(p.extra)}</span>` : ""}</div>` : "";
    panel.innerHTML = `
      <div class="pp__img"><img src="assets/img/${p.img}.webp" alt="Luftek ${esc(p.name)}" loading="lazy"></div>
      <div>
        <p class="mono pp__fam">${FAM[p.fam]}</p>
        <h3 class="pp__name">${esc(p.name)}</h3>
        <p class="pp__desc">${esc(p.desc)}</p>
        <div class="pp__cfm"><b>${esc(p.cfm)}</b><span>${p.cfm.includes("–") ? "CFM airflow" : ""}${p.esp ? ` · rated at ${p.esp} ESP` : ""}</span></div>
        ${en ? `<p class="mono" style="margin-top:24px;color:var(--mute)">EN 1886 · ${p.en} series</p>${en}` : ""}
        <div class="pp__cols">
          <div><h3>Construction</h3><ul>${p.a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
          <div><h3>${p.fam === "ahu" ? "Certified components" : "Specification"}</h3><ul>${p.b.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        </div>
        <a class="btn pp__cta" href="#contact" data-product="${esc(p.name)}">Request a ${esc(p.name)} selection</a>
      </div>`;
    panel.classList.remove("is-swap"); void panel.offsetWidth; panel.classList.add("is-swap");
  }

  function renderList() {
    const items = P.filter((p) => p.fam === fam);
    list.innerHTML = items.map((p, i) => `<li><button type="button" data-name="${esc(p.name)}"${i === 0 ? ' aria-current="true"' : ""}><span class="mono">${String(i + 1).padStart(2, "0")}</span>${esc(p.name)}</button></li>`).join("");
    renderPanel(items[0]);
  }

  list.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    list.querySelectorAll("button").forEach((x) => x.removeAttribute("aria-current"));
    b.setAttribute("aria-current", "true");
    renderPanel(P.find((p) => p.name === b.dataset.name));
  });
  document.querySelectorAll(".tabs button").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === t ? "true" : "false"));
    fam = t.dataset.fam; renderList();
  }));
  renderList();

  // Carry product choice into the enquiry form
  panel.addEventListener("click", (e) => {
    const a = e.target.closest("[data-product]"); if (!a) return;
    const sel = document.querySelector('#enquiry select[name="product"]');
    const n = a.dataset.product;
    const match = [...sel.options].find((o) => n.startsWith(o.text.split(" ")[0]) && o.text !== "Not sure yet");
    sel.value = match ? match.text : (P.find((p) => p.name === n).fam === "fcu" ? "Fan Coil Unit" : "Air Handling Unit");
  });

  // Projects
  const R = [
    ["Bangalore-International-Airport-Bangalore", "Kempegowda International Airport", "Bengaluru", "air"],
    ["GMR-Hyd-Intl-Airport", "GMR Hyderabad International Airport", "Hyderabad", "air"],
    ["Apollo-Hospital-Chennai", "Apollo Hospitals", "Chennai", "health"],
    ["MIOT-Hospital-Chennai", "MIOT International", "Chennai", "health"],
    ["Meenakshi-Mission-Hospital", "Meenakshi Mission Hospital", "Madurai", "health"],
    ["Meridian-Walfs-Hospital-Chennai", "Meridian Walfs Hospital", "Chennai", "health"],
    ["Kindorama-Hospital-Bengaluru", "Kindorama Hospital", "Bengaluru", "health"],
    ["Pfizer-Chennai", "Pfizer", "Chennai", "pharma"],
    ["Stellis-Pharma-Bangalore", "Stelis Biopharma", "Bengaluru", "pharma"],
    ["Hikal-Ltd-Bengaluru", "Hikal Ltd", "Bengaluru", "pharma"],
    ["Symrise-Chennai", "Symrise", "Chennai", "pharma"],
    ["Renault-Nissan-Chennai", "Renault Nissan", "Chennai", "ind"],
    ["KIA-Ananthpur", "Kia Motors", "Anantapur", "ind"],
    ["Ashok-Leyland-Chennai", "Ashok Leyland", "Chennai", "ind"],
    ["Bosch-Tirunelveli", "Bosch", "Tirunelveli", "ind"],
    ["Amararaja-Renigunta", "Amara Raja", "Renigunta", "ind"],
    ["JSW-Salem", "JSW Steel", "Salem", "ind"],
    ["RANE-Trichy", "Rane", "Trichy", "ind"],
    ["Hatsun-Chennai", "Hatsun Agro", "Chennai", "ind"],
    ["Salcomp", "Salcomp", "Chennai", "ind"],
    ["Featherlite-Chennai", "Featherlite", "Chennai", "com"],
    ["Flipkart-Bangalore", "Flipkart", "Bengaluru", "com"],
    ["Dell-Bangalore", "Dell", "Bengaluru", "com"],
    ["HP-Chennai", "HP", "Chennai", "com"],
    ["HPCL-Bangalore", "HPCL", "Bengaluru", "com"],
    ["ICICI-Bank-Mumbai", "ICICI Bank", "Mumbai", "com"],
    ["Walmart-Chennai", "Walmart", "Chennai", "com"],
    ["Olympia-Chennai", "Olympia", "Chennai", "com"],
    ["Sattva-Bangalore", "Sattva", "Bengaluru", "com"],
    ["GRT-Chennai", "GRT", "Chennai", "com"],
    ["IIT-Madras-Chennai", "IIT Madras", "Chennai", "edu"],
    ["Vellore-Institute-of-Technology-VIT-Vellore", "VIT", "Vellore", "edu"],
    ["SRM-Chennai", "SRM University", "Chennai", "edu"],
    ["FIITJEE-Chennai", "FIITJEE", "Chennai", "edu"],
    ["Debenhams-Doha-Qatar", "Debenhams, Doha City Centre", "Qatar", "intl"],
    ["Hiru-Studio-Sri-Lanka", "Hiru Studio", "Sri Lanka", "intl"],
    ["Jaffna-Cultural-Centre-Sri-Lanka", "Jaffna Cultural Centre", "Sri Lanka", "intl"],
  ];
  const SECT = { all: "All", air: "Airports", health: "Hospitals", pharma: "Pharma", ind: "Industry", com: "Commercial", edu: "Education", intl: "International" };
  const proj = document.getElementById("proj");
  proj.innerHTML = R.map(([f, n, c, s]) => `<li data-s="${s}"><img src="assets/img/r-${f}.webp" alt="${esc(n)}, ${esc(c)}" loading="lazy"><div class="cap"><b>${esc(n)}</b><span>${esc(c)} · ${SECT[s]}</span></div></li>`).join("");
  const filters = document.getElementById("filters");
  filters.innerHTML = Object.entries(SECT).map(([k, v]) => `<button type="button" data-s="${k}" aria-pressed="${k === "all"}">${v}<span class="n">${k === "all" ? R.length : R.filter((r) => r[3] === k).length}</span></button>`).join("");
  filters.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    filters.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    proj.querySelectorAll("li").forEach((li) => { li.hidden = !(b.dataset.s === "all" || li.dataset.s === b.dataset.s); });
  });

  // Enquiry form: validates, then opens a pre-filled email to sales (no backend yet)
  const form = document.getElementById("enquiry");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    let ok = true;
    form.querySelectorAll("[required]").forEach((el) => {
      const bad = !el.value.trim() || (el.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value));
      el.setAttribute("aria-invalid", bad ? "true" : "false"); if (bad) ok = false;
    });
    const note = document.getElementById("formnote");
    if (!ok) { note.textContent = "Please add your name and a valid email."; return; }
    const d = Object.fromEntries(new FormData(form));
    const body = `Name: ${d.name}\nCompany: ${d.company}\nEmail: ${d.email}\nPhone: ${d.phone}\nProduct: ${d.product}\nAirflow (CFM): ${d.cfm}\n\n${d.msg}`;
    window.location.href = `mailto:sales@luftek.in?subject=${encodeURIComponent(`Selection request: ${d.product} — ${d.company || d.name}`)}&body=${encodeURIComponent(body)}`;
    note.textContent = "Your email app should now be open with the request filled in.";
  });

  // Nav
  const nav = document.querySelector(".nav");
  const burger = document.querySelector(".nav__burger");
  const mnav = document.getElementById("mnav");
  burger.addEventListener("click", () => {
    const open = burger.getAttribute("aria-expanded") !== "true";
    burger.setAttribute("aria-expanded", String(open)); mnav.classList.toggle("is-open", open);
  });
  mnav.addEventListener("click", (e) => { if (e.target.tagName === "A") { burger.setAttribute("aria-expanded", "false"); mnav.classList.remove("is-open"); } });
  const navLinks = [...document.querySelectorAll(".nav__links a")];
  const spy = navLinks.map((a) => document.querySelector(a.getAttribute("href")));
  const onScroll = () => {
    nav.classList.toggle("is-scrolled", window.scrollY > 8);
    const y = window.scrollY + 140;
    let cur = -1;
    spy.forEach((s, i) => { if (s && s.offsetTop <= y) cur = i; });
    navLinks.forEach((a, i) => a.classList.toggle("is-active", i === cur));
  };
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // Reveal on scroll
  const els = document.querySelectorAll(".sec__head, .explorer, .build, .parts li, .stds > div, .timeline li, .plant, .offices, .form, .ribbon > div");
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -8% 0px" });
    els.forEach((el, i) => { el.classList.add("rv"); el.style.transitionDelay = `${(i % 4) * 60}ms`; io.observe(el); });
  }
  document.getElementById("yr").textContent = new Date().getFullYear();
})();
