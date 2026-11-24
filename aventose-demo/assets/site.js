(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const store = { get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

  // ---------- header: active page, full-screen menu, hide on scroll down ----------
  const pageId = document.body.dataset.page;
  $$('[data-nav]').forEach(a => { if (a.dataset.nav === pageId) a.setAttribute('aria-current', 'page'); });
  const menuBtn = $('#menu'), header = $('header.top');
  const setMenu = open => { document.body.classList.toggle('menu-open', open); menuBtn.setAttribute('aria-expanded', open); menuBtn.querySelector('span').textContent = open ? 'Close' : 'Menu'; };
  menuBtn.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
  let lastY = scrollY;

  // ---------- scroll progress + header behaviour + parallax ----------
  const prog = $('#progress'), par = $$('[data-parallax]');
  const onScroll = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    prog.style.transform = `scaleX(${h > 0 ? scrollY / h : 0})`;
    header.classList.toggle('scrolled', scrollY > 40);
    if (!document.body.classList.contains('menu-open')) header.classList.toggle('hide', scrollY > 400 && scrollY > lastY + 4);
    if (scrollY < lastY - 4) header.classList.remove('hide');
    lastY = scrollY;
    if (!reduce) par.forEach(el => { const r = el.parentElement.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) el.style.transform = `translate3d(0,${(-r.top) * (+el.dataset.parallax || .2)}px,0) scale(1.08)`; });
  };

  // ---------- reveal on scroll ----------
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .15 });
  $$('.rv:not(.ph), .split, .stagger').forEach(el => io.observe(el));

  // ---------- count-up figures ----------
  const countTo = (el, end, dec = 0) => {
    const t0 = performance.now(), dur = reduce ? 0 : 1200, from = parseFloat(el.dataset.from || 0);
    const tick = t => { const p = dur ? Math.min((t - t0) / dur, 1) : 1, v = from + (end - from) * (1 - Math.pow(1 - p, 3)); el.textContent = dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-IN'); if (p < 1) requestAnimationFrame(tick); else el.dataset.from = end; };
    requestAnimationFrame(tick);
  };
  const cio = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; cio.unobserve(e.target); countTo(e.target, +e.target.dataset.count); }), { threshold: .6 });
  $$('[data-count]').forEach(el => { el.textContent = '0'; cio.observe(el); });

  // ---------- magnetic buttons (desktop pointer only) ----------
  if (!reduce && matchMedia('(pointer: fine)').matches) $$('.mag').forEach(b => {
    b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * .18}px,${(e.clientY - r.top - r.height / 2) * .25}px)`; });
    b.addEventListener('pointerleave', () => b.style.transform = '');
  });

  // ---------- colour switch ----------
  $$('.colors').forEach(g => g.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    g.querySelectorAll('button').forEach(x => { x.setAttribute('aria-pressed', x === b); const t = document.getElementById(x.dataset.show); if (t) t.hidden = x !== b; });
    const n = $('#cfgColour'); if (n) n.textContent = b.textContent.trim();
  })));

  // ---------- S110 configurator: battery choice ----------
  const BATT = { std: { range: 100, kwh: '2.4 kWh LFP', price: '₹1,19,900*', name: 'S110' }, er: { range: 130, kwh: '3.2 kWh NMC', price: 'On request', name: 'S110 ER' } };
  $$('[data-battery]').forEach(b => b.addEventListener('click', () => {
    $$('[data-battery]').forEach(x => x.setAttribute('aria-pressed', x === b));
    const v = BATT[b.dataset.battery];
    countTo($('#cfgRange'), v.range); $('#cfgKwh').textContent = v.kwh; $('#cfgPrice').textContent = v.price; $('#cfgName').textContent = v.name;
    const bar = $('#cfgBar'); if (bar) bar.style.width = v.range / 130 * 100 + '%';
    const link = $('#cfgEnquire'); if (link) link.href = 'enquire.html?type=individual&model=' + encodeURIComponent(v.name);
  }));

  // ---------- S110 explorer ----------
  const POINTS = [
    { x: 29.5, y: 23.5, t: 'Smart display', d: 'IP65 rated VCU and display. Safe Mode detects abnormal temperature rise in critical parts, protects them, and boosts range when the battery is low.', img: 'SafeMode' },
    { x: 56.5, y: 47, t: 'Removable battery', d: 'Under-seat battery storage for easy access. Lift it out and charge at home, at work or at the shop. IP67 certified, with an 8-year / 1,00,000 km warranty.', img: 'Removable' },
    { x: 72.5, y: 48, t: 'Twin rear shocks', d: 'Hydraulic suspension with twin rear shock absorbers to cut the jolts from bad roads before they reach the rider.', img: 'Shockabsorbers' },
    { x: 63, y: 63, t: 'Mid-mounted motor', d: 'A mid-mounted PMSM with double-stage transmission delivers 156 Nm at the wheel, plus regeneration that charges while you slow down.', img: 'Transmission' },
    { x: 42.5, y: 62, t: 'Flat floorboard', d: 'Large, uninterrupted legroom and an adjustable handlebar. Room for a gas cylinder, a sack of rice or a week of shopping.', img: 'vehicaleErgonomics' },
    { x: 24.5, y: 62, t: 'Disc brakes, CBS', d: 'Front and rear disc brakes with a combined braking system for confident stops, loaded or empty.', img: 'DiscBrakes' },
    { x: 13, y: 70, t: '17-inch wheels', d: '17" alloy wheels on tubeless tyres and 175 mm of ground clearance, so potholes and speed-breakers stop being a problem.', img: 'LargeTyres' }
  ];
  const stage = $('#exStage');
  if (stage) {
    const panel = $('#exPanel'), bar = $('#exBar');
    POINTS.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'hs'; b.textContent = i + 1; b.style.left = p.x + '%'; b.style.top = p.y + '%'; b.style.setProperty('--i', i);
      b.setAttribute('aria-label', p.t); b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => { show(i); stopAuto(); });
      stage.appendChild(b);
    });
    let cur = -1, auto = null;
    const show = i => {
      cur = (i + POINTS.length) % POINTS.length; const p = POINTS[cur];
      $$('.hs').forEach((b, k) => b.setAttribute('aria-pressed', k === cur));
      panel.classList.add('out');
      setTimeout(() => {
        $('#exImg').src = `assets/img/${p.img}.webp`; $('#exImg').alt = p.t;
        $('#exTitle').textContent = p.t; $('#exText').textContent = p.d; $('#exN').textContent = String(cur + 1).padStart(2, '0');
        panel.classList.remove('out');
      }, reduce ? 0 : 220);
      if (auto) { bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run'); }
    };
    const startAuto = () => { if (auto || reduce) return; auto = setInterval(() => show(cur + 1), 6000); bar.classList.add('run'); };
    const stopAuto = () => { clearInterval(auto); auto = null; bar.classList.remove('run'); };
    $('#exNext').onclick = () => { stopAuto(); show(cur + 1); };
    $('#exPrev').onclick = () => { stopAuto(); show(cur - 1); };
    show(0);
    new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { $('#explore').classList.add('in'); startAuto(); } else stopAuto(); }), { threshold: .35 }).observe($('#explore'));
  }

  // ---------- pinned horizontal feature reel (desktop) ----------
  const reel = $('#reel');
  let moveReel = () => {};
  if (reel) {
    const track = $('#reelTrack'), line = $('#reelLine'), mq = matchMedia('(min-width: 981px)'), n = track.children.length;
    const sizeReel = () => { reel.style.height = mq.matches ? (track.scrollWidth - innerWidth + innerHeight) + 'px' : ''; };
    moveReel = () => {
      if (!mq.matches) return;
      const r = reel.getBoundingClientRect(), max = reel.offsetHeight - innerHeight;
      const p = Math.min(Math.max(-r.top / max, 0), 1);
      track.style.transform = `translateX(${-p * (track.scrollWidth - innerWidth)}px)`; line.style.transform = `scaleX(${p})`;
      $('#reelN').textContent = String(Math.min(n, 1 + Math.floor(p * n))).padStart(2, '0');
    };
    sizeReel(); addEventListener('resize', () => { sizeReel(); moveReel(); }); addEventListener('load', sizeReel);
  }

  // ---------- people rail ----------
  const rail = $('#rail');
  if (rail) {
    const stepW = () => rail.querySelector('figure').offsetWidth + 16;
    $('#next').onclick = () => rail.scrollBy({ left: stepW(), behavior: 'smooth' });
    $('#prev').onclick = () => rail.scrollBy({ left: -stepW(), behavior: 'smooth' });
    let down = false, x0 = 0, s0 = 0;
    rail.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') return; down = true; x0 = e.clientX; s0 = rail.scrollLeft; rail.style.scrollSnapType = 'none'; });
    addEventListener('pointerup', () => { if (down) { down = false; rail.style.scrollSnapType = ''; } });
    rail.addEventListener('pointermove', e => { if (down) rail.scrollLeft = s0 - (e.clientX - x0); });
    rail.addEventListener('dragstart', e => e.preventDefault());
  }

  // ---------- range sliders: filled track ----------
  const fill = r => r.style.setProperty('--p', (r.value - r.min) / (r.max - r.min) * 100 + '%');
  $$('input[type=range]').forEach(r => { fill(r); r.addEventListener('input', () => fill(r)); });

  // ---------- running-cost calculator: S110 uses 2.4 kWh per ~100 km (Aventose spec sheet) ----------
  if ($('#saveY')) {
    const KWH_PER_KM = 2.4 / 100;
    const calc = () => {
      const km = +$('#km').value, fuel = +$('#fuel').value, mil = +$('#mil').value, tar = +$('#tar').value;
      const month = km * 30, petrol = month / mil * fuel, ev = month * KWH_PER_KM * tar, year = (petrol - ev) * 12;
      $('#kmV').textContent = km + ' km'; $('#fuelV').textContent = '₹' + fuel + '/L'; $('#milV').textContent = mil + ' km/L'; $('#tarV').textContent = '₹' + tar + '/unit';
      $('#pM').textContent = inr(petrol); $('#eM').textContent = inr(ev); $('#saveY').textContent = inr(year); $('#s5').textContent = inr(year * 5);
      $('#co2').textContent = Math.round(month * 12 / mil * 2.31).toLocaleString('en-IN') + ' kg';
      $('#calcBarP').style.width = '100%'; $('#calcBarE').style.width = Math.max(2, ev / petrol * 100) + '%';
      store.set('ae_calc', { dailyKm: km, yearlySaving: inr(year) });
    };
    ['km', 'fuel', 'mil', 'tar'].forEach(id => $('#' + id).addEventListener('input', calc)); calc();
  }

  // ---------- model compare ----------
  const MODELS = {
    S110: { status: 'ARAI certified', img: 'lineup-s110', range: [100, 130], torque: 156, speed: [60], power: [3, 2.1], weight: '125 kg', drive: 'Mid-mounted PMSM', battery: '2.4 kWh LFP / 3.2 kWh NMC', clearance: 175, wheels: '17" / 17" alloy', price: '₹1,19,900*' },
    S125: { status: 'Coming soon', img: 'lineup-s125', range: [100, 130], torque: 140, speed: [80], power: [4.4, 3], weight: '115 kg', drive: 'BLDC hub motor', battery: '2.4 kWh LFP / 3.2 kWh NMC', clearance: 170, wheels: '12" / 12" alloy', price: '₹99,900*' },
    M125: { status: 'Coming soon', img: 'lineup-m125', range: [100, 130], torque: 156, speed: [80], power: [5, 3], weight: '115 kg', drive: 'Mid-mounted PMSM', battery: '2.4 kWh LFP / 3.2 kWh NMC', clearance: 170, wheels: '17" / 17" alloy', price: '₹1,09,000*' },
    M150: { status: 'In development', img: 'lineup-m150', range: [130, 175], torque: 170, speed: [80, 100], power: [5, 3], weight: '115 / 130 kg', drive: 'Mid-mounted PMSM', battery: '3.2 kWh NMC / 4.4 kWh LFP', clearance: 165, wheels: '17" / 17" alloy', price: 'TBD' }
  };
  const cmp = $('#compare');
  if (cmp) {
    const ROWS = [
      ['Range, on road', m => m.range.join(' / ') + ' km', m => Math.max(...m.range) / 175],
      ['Top speed', m => m.speed.join(' / ') + ' km/h', m => Math.max(...m.speed) / 100],
      ['Wheel torque', m => m.torque + ' Nm', m => m.torque / 170],
      ['Peak power', m => m.power[0] + ' kW', m => m.power[0] / 5],
      ['Ground clearance', m => m.clearance + ' mm', m => m.clearance / 175],
      ['Motor', m => m.drive], ['Battery', m => m.battery], ['Wheels', m => m.wheels], ['Weight with battery', m => m.weight], ['Est. ex-showroom', m => m.price]
    ];
    const render = () => {
      const a = MODELS[$('#cmpA').value], b = MODELS[$('#cmpB').value];
      [['A', a, $('#cmpA').value], ['B', b, $('#cmpB').value]].forEach(([k, m, name]) => {
        $('#cmpImg' + k).src = `assets/img/${m.img}.webp`; $('#cmpImg' + k).alt = 'Aventose ' + name;
        $('#cmpName' + k).textContent = name; $('#cmpTag' + k).textContent = m.status;
      });
      const body = $('#cmpRows'); body.innerHTML = '';
      ROWS.forEach(([label, fmt, pct]) => {
        const row = document.createElement('div'); row.className = 'cmp-row';
        const cell = m => { const c = document.createElement('div'); c.className = 'cmp-cell'; const v = document.createElement('b'); v.textContent = fmt(m); c.appendChild(v); if (pct) { const bar = document.createElement('i'); bar.className = 'cmp-bar'; const f = document.createElement('i'); bar.appendChild(f); c.appendChild(bar); requestAnimationFrame(() => requestAnimationFrame(() => f.style.width = Math.min(100, pct(m) * 100) + '%')); } return c; };
        const l = document.createElement('div'); l.className = 'cmp-label'; l.textContent = label;
        row.append(cell(a), l, cell(b)); body.appendChild(row);
      });
    };
    $('#cmpA').addEventListener('change', render); $('#cmpB').addEventListener('change', render); render();
    $$('[data-cmp]').forEach(a => a.addEventListener('click', () => {
      const k = a.dataset.cmp; $('#cmpA').value = k;
      if ($('#cmpB').value === k) $('#cmpB').value = k === 'S110' ? 'M125' : 'S110';
      render();
    }));
  }

  // ---------- tabs ----------
  document.querySelectorAll('[data-tabs]').forEach(t => {
    const btns = [...t.querySelectorAll('[role=tab]')], panels = [...t.querySelectorAll('[role=tabpanel]')];
    const sel = i => { btns.forEach((b, k) => { b.setAttribute('aria-selected', k === i); b.tabIndex = k === i ? 0 : -1; }); panels.forEach((p, k) => p.hidden = k !== i); };
    btns.forEach((b, i) => { b.addEventListener('click', () => sel(i)); b.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { sel((i + 1) % btns.length); btns[(i + 1) % btns.length].focus(); } if (e.key === 'ArrowLeft') { const j = (i - 1 + btns.length) % btns.length; sel(j); btns[j].focus(); } }); });
    sel(0);
  });

  addEventListener('scroll', () => { onScroll(); moveReel(); }, { passive: true });
  onScroll();

  // ---------- lead source tracking ----------
  // First-touch source is kept in this browser so a lead from a Google search on day 1 who returns directly on day 3 is still credited to organic.
  const qs = new URLSearchParams(location.search), ref = document.referrer, refHost = ref ? new URL(ref).hostname : '';
  const classify = () => {
    const med = (qs.get('utm_medium') || '').toLowerCase();
    if (qs.get('gclid') || qs.get('fbclid') || /cpc|ppc|paid/.test(med)) return 'Paid';
    if (med === 'organic') return 'Organic search';
    if (med) return med.charAt(0).toUpperCase() + med.slice(1);
    if (/google\.|bing\.|duckduckgo\.|yahoo\.|ecosia\./.test(refHost)) return 'Organic search';
    if (/instagram|facebook|linkedin|youtube|t\.co|twitter|x\.com|whatsapp/.test(refHost)) return 'Organic social';
    if (refHost && refHost !== location.hostname) return 'Referral';
    return 'Direct';
  };
  const touch = { channel: classify(), source: qs.get('utm_source') || refHost || '(direct)', campaign: qs.get('utm_campaign') || '', term: qs.get('utm_term') || '', landing: location.pathname + location.search, at: new Date().toISOString() };
  if (!store.get('ae_first_touch')) store.set('ae_first_touch', touch);
  const visits = (store.get('ae_visits') || 0) + 1; store.set('ae_visits', visits);
  const t0 = Date.now(), seen = new Set();
  const sio = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && seen.add(e.target.id)), { threshold: .4 });
  $$('section[id], div[id=charging]').forEach(s => sio.observe(s));


  // ---------- multi-step enquiry form ----------
  const LEAD_WEBHOOK = '/api/lead'; // nginx forwards this to the n8n workflow. Set to '' for offline demo mode.
  const form = $('#lead');
  if (!form) return;
  const steps = $$('.step'), err = $('#leadErr');
  let stepN = 1;
  const intent = () => (form.querySelector('[name=intent]:checked') || {}).value;
  const branch = () => form.querySelector(`[data-branch="${intent()}"]`);
  const val = (n, scope = form) => { const els = [...scope.querySelectorAll(`[name="${n}"]`)]; if (!els.length) return ''; const t = els[0].type; if (t === 'radio') return (els.find(e => e.checked) || {}).value || ''; if (t === 'checkbox') return els.length > 1 ? els.filter(e => e.checked).map(e => e.value) : (els[0].checked ? els[0].value : ''); return els[0].value.trim(); };
  const go = n => {
    stepN = n;
    steps.forEach(s => s.classList.toggle('on', +s.dataset.step === n));
    $$('#stepList li').forEach((li, i) => { li.classList.toggle('on', i + 1 === n); li.classList.toggle('done', i + 1 < n); });
    $('#leadBar').style.width = n * 25 + '%';
    $('#leadActions').classList.toggle('back', n > 1 && n < 4);
    $('#leadActions').hidden = n === 4;
    $('#leadNext').textContent = n === 3 ? 'Submit enquiry' : 'Continue';
    err.textContent = '';
    if (n > 1) form.closest('.lead').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  const need = (ok, msg, el) => { if (ok) return true; err.textContent = msg; el && el.focus && el.focus(); return false; };
  const check = () => {
    if (stepN === 1) return need(intent(), 'Please choose what brings you here.');
    if (stepN === 2) {
      const b = branch();
      if (intent() === 'individual') return need(val('model', b), 'Please choose a model, or "Help me choose".') && need(val('use', b).length, 'Please pick at least one main use.') && need(val('timeline', b), 'Please tell us when you plan to buy.');
      if (intent() === 'fleet') return need(val('company', b), 'Please enter your company name.', b.querySelector('[name=company]')) && need(val('industry', b), 'Please choose your industry.') && need(val('fleetSize', b), 'Please choose how many vehicles you need.') && need(val('timeline', b), 'Please tell us when you need vehicles.');
      return need(val('business', b), 'Please enter your business name.', b.querySelector('[name=business]')) && need(val('dealerCity', b), 'Please enter the proposed city or district.', b.querySelector('[name=dealerCity]')) && need(val('bizType', b), 'Please choose your current business.') && need(val('investment', b), 'Please choose an investment range.') && need(val('timeline', b), 'Please tell us when you could start.');
    }
    if (stepN === 3) {
      const f = n => form.querySelector(`[name=${n}]`);
      return need(val('name'), 'Please enter your name.', f('name')) && need(/^[6-9]\d{9}$/.test(val('phone')), 'Please enter a valid 10-digit Indian mobile number.', f('phone')) && need(!val('email') || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val('email')), 'Please check your email address.', f('email')) && need(/^[1-9]\d{5}$/.test(val('pincode')), 'Please enter a valid 6-digit pincode.', f('pincode')) && need(val('consent'), 'Please tick the consent box so we can contact you.');
    }
    return true;
  };
  // Internal score for sales priority. Never shown to the visitor.
  const score = d => {
    let s = 0; const tl = d.needs.timeline;
    s += { 'This month': 40, 'Within 3 months': 35, '1–3 months': 25, '3–6 months': 12 }[tl] || 0;
    if (d.type === 'fleet') s += { '1–10': 10, '11–50': 25, '51–200': 40, '200+': 50 }[d.needs.fleetSize] || 0;
    if (d.type === 'dealer') s += { '₹10–25 lakh': 10, '₹25–50 lakh': 25, '₹50 lakh+': 40 }[d.needs.investment] || 0;
    if (d.type === 'individual') { if (d.needs.payment) s += 10; if (d.contact.testRide) s += 10; if (d.needs.model !== 'Not sure') s += 5; }
    if (d.contact.email) s += 5;
    return { score: s, grade: s >= 50 ? 'Hot' : s >= 25 ? 'Warm' : 'Nurture' };
  };
  const collect = () => {
    const b = branch(), needs = {};
    b.querySelectorAll('[name]').forEach(el => { if (!(el.name in needs)) needs[el.name] = val(el.name, b); });
    const d = {
      ref: 'AE-' + Date.now().toString(36).toUpperCase().slice(-6),
      website: val('website'),
      type: intent(), needs,
      contact: { name: val('name'), phone: '+91' + val('phone'), email: val('email'), pincode: val('pincode'), channel: val('channel'), bestTime: val('time'), testRide: intent() === 'individual' && !!val('testRide'), consent: true, consentAt: new Date().toISOString() },
      attribution: { firstTouch: store.get('ae_first_touch') || touch, lastTouch: touch, visits },
      engagement: { secondsOnSite: Math.round((Date.now() - t0) / 1000), sectionsViewed: [...seen], page: pageId, calculator: store.get('ae_calc') },
      page: location.href, submittedAt: new Date().toISOString()
    };
    d.priority = score(d);
    return d;
  };
  const finish = d => {
    const first = d.contact.name.split(' ')[0], label = { individual: 'Purchase & test ride', fleet: 'Fleet enquiry', dealer: 'Dealership application' }[d.type];
    $('#doneTitle').textContent = `Thank you, ${first}.`;
    $('#doneRef').textContent = `Reference ${d.ref} · ${label}`;
    const rows = d.type === 'individual' ? [['Model', d.needs.model], ['Timeline', d.needs.timeline], ['Daily ride', d.needs.dailyKm + ' km'], ['Test ride at home', d.contact.testRide ? 'Yes' : 'No']]
      : d.type === 'fleet' ? [['Company', d.needs.company], ['Vehicles', d.needs.fleetSize], ['Industry', d.needs.industry], ['Timeline', d.needs.timeline]]
      : [['Business', d.needs.business], ['City', d.needs.dealerCity], ['Investment', d.needs.investment], ['Start', d.needs.timeline]];
    rows.push(['Contact via', d.contact.channel], ['Best time', d.contact.bestTime]);
    $('#summary').innerHTML = ''; rows.forEach(([k, v]) => { const r = document.createElement('div'); r.innerHTML = '<span></span><b></b>'; r.children[0].textContent = k; r.children[1].textContent = v || '—'; $('#summary').appendChild(r); });
    const nx = { individual: ['Our sales team calls you within one working day.', 'We confirm a test-ride slot at your address.', 'You get pricing, EMI options and delivery dates on WhatsApp.'],
      fleet: ['Our fleet team reviews your requirement within one working day.', 'We share a fleet proposal with pricing and a swapping plan.', 'We arrange a pilot with a few vehicles on your routes.'],
      dealer: ['Our network team reviews your application within three working days.', 'We schedule a call to understand your market and location.', 'Shortlisted partners get a site visit and the dealership proposal.'] }[d.type];
    $('#nextSteps').innerHTML = ''; nx.forEach(t => { const li = document.createElement('li'); li.textContent = t; $('#nextSteps').appendChild(li); });
    const wa = `Hi Aventose, I just submitted enquiry ${d.ref} (${label}). My name is ${d.contact.name}.`;
    $('#waBtn').href = 'https://wa.me/?text=' + encodeURIComponent(wa);
    $('#payload').textContent = JSON.stringify(d, null, 2);
    go(4);
  };
  form.addEventListener('change', e => {
    if (e.target.name === 'intent') {
      $$('[data-branch]', form).forEach(b => b.hidden = b.dataset.branch !== intent());
      $$('[data-only]', form).forEach(el => el.hidden = el.dataset.only !== intent());
      setTimeout(() => go(2), reduce ? 0 : 250);
    }
  });
  form.addEventListener('input', e => { const o = e.target.dataset.out; if (o) $('#' + o).textContent = e.target.value + e.target.dataset.unit; if (e.target.type === 'range') e.target.style.setProperty('--p', (e.target.value - e.target.min) / (e.target.max - e.target.min) * 100 + '%'); });
  $$('#lead input[type=range]').forEach(r => r.style.setProperty('--p', (r.value - r.min) / (r.max - r.min) * 100 + '%'));
  $('#leadBack').onclick = () => go(Math.max(1, stepN - 1));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!check()) return;
    if (stepN < 3) return go(stepN + 1);
    const d = collect(), btn = $('#leadNext');
    if (LEAD_WEBHOOK) {
      btn.disabled = true; btn.textContent = 'Sending…';
      try { const r = await fetch(LEAD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); if (!r.ok) throw new Error(r.status); }
      catch { btn.disabled = false; btn.textContent = 'Submit enquiry'; err.textContent = 'Something went wrong sending your enquiry. Please try again, or message us on WhatsApp.'; return; }
    } else console.info('[demo] lead payload', d);
    finish(d);
  });

  // Pre-select from links such as enquire.html?type=fleet or ?type=individual&model=S110%20ER
  const preType = qs.get('type'), preModel = qs.get('model');
  const preRadio = preType && form.querySelector(`[name=intent][value="${CSS.escape(preType)}"]`);
  if (preRadio) {
    preRadio.checked = true; preRadio.dispatchEvent(new Event('change', { bubbles: true }));
    const m = preModel && form.querySelector(`[name=model][value="${CSS.escape(preModel)}"]`); if (m) m.checked = true;
  }
})();
