/* FCS Shipping — front-end logic.
   All editable content lives in /site.config.json. */

(async function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => '$' + n.toFixed(2);
  const FN = '/.netlify/functions';

  /* ---------- load config ---------- */
  let cfg;
  try {
    cfg = await (await fetch('/site.config.json', { cache: 'no-cache' })).json();
  } catch (e) {
    console.error('Could not load site.config.json', e);
    return;
  }
  const co = cfg.company;

  /* live pricing (admin-edited, via settings table) overrides config prices */
  try {
    const pr = await fetch(`${FN}/pricing`).then((r) => (r.ok ? r.json() : null));
    if (pr && pr.cargo) {
      cfg.cargo = pr.cargo;
      cfg.destinations = pr.destinations;
      cfg.extras = pr.extras;
    }
  } catch { /* static preview — config prices are fine */ }

  /* ---------- populate static text from config ---------- */
  $('tbPhone').textContent = '☎ ' + co.phones[0];
  $('tbEmail').textContent = '✉ ' + co.email;
  $('tbAddr').textContent = '📍 ' + co.addressShort;
  $('tbHours').textContent = co.hours;
  $('heroKicker').textContent = cfg.hero.kicker;
  $('heroTitle').textContent = cfg.hero.title;
  $('heroLede').textContent = cfg.hero.lede;
  $('quotePhone').textContent = co.phones[0];
  $('trackPhone').textContent = co.phones[0];
  $('cAddr').textContent = co.address;
  $('cHours').textContent = co.hoursLong;
  $('cPhones').innerHTML = co.phones
    .map((p, i) => `<a href="tel:${co.phoneLinks[i]}">${p}</a>`)
    .join(' · ');
  $('cEmail').innerHTML = `<a href="mailto:${co.email}">${co.email}</a>`;
  $('footLine').textContent =
    `© ${new Date().getFullYear()} ${co.name} · ${co.address} · ${co.phones[0]} · ${co.email}`;
  $('wbVessel').textContent = cfg.defaultVessel;

  /* FAQ */
  $('faqList').innerHTML = cfg.faq
    .map(
      (f, i) =>
        `<details${i === 0 ? ' open' : ''}><summary>${f.q}</summary><p>${f.a}</p></details>`
    )
    .join('');

  /* Service card "from $x" pulled from config prices */
  document.querySelectorAll('[data-price-from]').forEach((el) => {
    const key = el.dataset.priceFrom;
    let price;
    if (key.startsWith('extra:')) {
      const x = cfg.extras.find((e) => e.id === key.slice(6));
      price = x && x.price;
    } else {
      const c = cfg.cargo.find((c) => c.id === key);
      price = c && c.price;
    }
    if (price != null) el.textContent = 'from $' + price.toLocaleString();
  });

  /* ---------- quote builder ---------- */
  let qty = 1;
  const state = {
    cargoId: cfg.cargo[0].id,
    itemLabel: cfg.cargo[0].label,
    itemPrice: cfg.cargo[0].price,
    dest: cfg.destinations[0].name,
    fee: cfg.destinations[0].fee,
    extras: [],
  };

  $('itemChips').innerHTML = cfg.cargo
    .map(
      (c, i) =>
        `<button type="button" class="chip" data-id="${c.id}" data-price="${c.price}" aria-pressed="${i === 0}">${c.label}</button>`
    )
    .join('');
  $('dest').innerHTML = cfg.destinations
    .map(
      (d) =>
        `<option value="${d.name}" data-fee="${d.fee}">${d.name}${d.fee ? ` (+$${d.fee})` : ''}</option>`
    )
    .join('');
  $('extraChips').innerHTML = cfg.extras
    .map(
      (x) =>
        `<button type="button" class="chip extra" data-id="${x.id}" data-label="${x.label}" data-price="${x.price}" aria-pressed="false">${x.buttonText}</button>`
    )
    .join('');

  function renderWaybill() {
    const extrasTotal = state.extras.reduce((s, e) => s + e.price, 0);
    const total = state.itemPrice * qty + state.fee * qty + extrasTotal;
    $('wbItem').textContent = `${state.itemLabel} × ${qty}`;
    $('wbDest').textContent = `${state.dest}, St. Lucia`;
    $('wbBase').textContent = fmt(state.itemPrice * qty);
    $('wbFee').textContent = fmt(state.fee * qty);
    $('wbExtras').textContent = state.extras.length
      ? state.extras.map((e) => e.label).join(', ') + '  ' + fmt(extrasTotal)
      : '—';
    $('wbTotal').textContent = '$' + Math.round(total).toLocaleString();
  }

  document.querySelectorAll('#itemChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document
        .querySelectorAll('#itemChips .chip')
        .forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      state.cargoId = chip.dataset.id;
      state.itemLabel = chip.textContent.trim();
      state.itemPrice = +chip.dataset.price;
      renderWaybill();
    });
  });
  document.querySelectorAll('.chip.extra').forEach((chip) => {
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') === 'true';
      chip.setAttribute('aria-pressed', String(!on));
      const { id, label } = chip.dataset;
      const price = +chip.dataset.price;
      if (on) state.extras = state.extras.filter((e) => e.id !== id);
      else state.extras.push({ id, label, price });
      renderWaybill();
    });
  });
  $('dest').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    state.dest = opt.value;
    state.fee = +opt.dataset.fee;
    renderWaybill();
  });
  $('qtyPlus').addEventListener('click', () => {
    qty = Math.min(qty + 1, 20);
    $('qtyVal').textContent = qty;
    renderWaybill();
  });
  $('qtyMinus').addEventListener('click', () => {
    qty = Math.max(qty - 1, 1);
    $('qtyVal').textContent = qty;
    renderWaybill();
  });

  $('wbNo').textContent = 'FCS-' + new Date().getFullYear() + '-' + String(Math.floor(1000 + Math.random() * 9000));
  renderWaybill();

  /* ---------- Phase 2: quote request ---------- */
  let lastQuoteId = null;

  $('lockBtn').addEventListener('click', () => {
    $('lockPanel').classList.add('show');
    $('lockBtn').style.display = 'none';
    $('qName').focus();
  });

  $('quoteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('quoteMsg');
    msg.className = 'form-msg';
    const name = $('qName').value.trim();
    const phone = $('qPhone').value.trim();
    const email = $('qEmail').value.trim();
    if (!name || !phone || !email) {
      msg.textContent = 'Please fill in your name, phone, and email.';
      msg.classList.add('err');
      return;
    }
    const btn = $('sendQuoteBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const res = await fetch(`${FN}/quote-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          email,
          website: $('qWebsite').value, // honeypot
          cargoId: state.cargoId,
          quantity: qty,
          destination: state.dest,
          extras: state.extras.map((x) => x.id),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Request failed');
      lastQuoteId = data.quoteId || null;
      msg.textContent = `Got it! Your quote (${'$' + (data.total / 100).toLocaleString()}) is on its way to our team — we'll call you to confirm.`;
      msg.classList.add('ok');
      $('payPanel').classList.add('show');
      if (data.testMode) $('testModeBadge').hidden = false;
      btn.textContent = 'Sent ✓';
    } catch (err) {
      console.error(err);
      msg.textContent =
        `Couldn't send right now — please call ${co.phones[0]} or email ${co.email}.`;
      msg.classList.add('err');
      btn.disabled = false;
      btn.textContent = 'Send quote request';
    }
  });

  /* ---------- Phase 3: Stripe deposit ---------- */
  $('payBtn').addEventListener('click', async () => {
    const btn = $('payBtn');
    btn.disabled = true;
    btn.textContent = 'Opening secure checkout…';
    try {
      const res = await fetch(`${FN}/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: lastQuoteId,
          cargoId: state.cargoId,
          quantity: qty,
          destination: state.dest,
          extras: state.extras.map((x) => x.id),
          email: $('qEmail').value.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Checkout unavailable');
      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      const msg = $('quoteMsg');
      msg.textContent = `Online payment isn't set up yet — call ${co.phones[0]} to pay your deposit.`;
      msg.className = 'form-msg err';
      btn.disabled = false;
      btn.textContent = 'Pay deposit by card →';
    }
  });

  /* payment redirect results */
  const params = new URLSearchParams(location.search);
  if (params.get('paid') === '1') {
    const msg = $('quoteMsg');
    $('lockPanel').classList.add('show');
    $('lockBtn').style.display = 'none';
    msg.textContent = 'Deposit received — thank you! We\'ll call you to arrange drop-off or pickup.';
    msg.className = 'form-msg ok';
    document.getElementById('quote').scrollIntoView();
  } else if (params.get('canceled') === '1') {
    const msg = $('quoteMsg');
    $('lockPanel').classList.add('show');
    $('lockBtn').style.display = 'none';
    msg.textContent = 'Checkout canceled — your quote request is still saved. Call us anytime.';
    msg.className = 'form-msg err';
  }

  /* ---------- Phase 4: tracking ---------- */
  const STATUS_LABELS = {
    received: 'Received at Brooklyn warehouse',
    loaded: 'Loaded & manifested',
    at_sea: 'At sea',
    arrived: 'Arrived — customs clearance',
    ready: 'Ready for pickup / delivery',
    delivered: 'Delivered',
  };
  const STATUS_ORDER = ['received', 'loaded', 'at_sea', 'arrived', 'ready'];

  const DEMO_TRACKING = {
    waybill_no: 'FCS-2026-4471',
    status: 'at_sea',
    vessel: 'M/V Caribbean Star',
    destination: 'Port Castries',
    eta: '2026-07-28',
    events: [
      { status: 'received', note: '9502 Ditmas Ave', created_at: '2026-07-14T10:22:00-04:00' },
      { status: 'loaded', note: 'Container BKLN-88', created_at: '2026-07-17T15:05:00-04:00' },
      { status: 'at_sea', note: 'Aboard M/V Caribbean Star', created_at: '2026-07-19T08:00:00-04:00' },
    ],
  };

  function renderTracking(t) {
    $('tlNo').textContent = t.waybill_no;
    const statusIdx = STATUS_ORDER.indexOf(t.status);
    $('tlStatus').textContent =
      (STATUS_LABELS[t.status] || t.status).toUpperCase() +
      (t.status === 'at_sea' ? ' — ON SCHEDULE' : '');
    const evByStatus = {};
    (t.events || []).forEach((ev) => (evByStatus[ev.status] = ev));
    const fdt = (iso) =>
      new Date(iso).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    $('tlSteps').innerHTML = STATUS_ORDER.map((s, i) => {
      const ev = evByStatus[s];
      const cls = i < statusIdx ? 'done' : i === statusIdx ? 'now' : 'future';
      const dot = cls === 'done' ? '✓' : cls === 'now' ? '●' : '';
      let sub = '';
      if (ev) sub = [ev.note, fdt(ev.created_at)].filter(Boolean).join(' · ');
      else if (s === 'at_sea' && t.eta) sub = `ETA ${new Date(t.eta + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      else if (s === 'arrived') sub = `${t.destination || ''} · customs clearance, 1–2 days`;
      else if (s === 'ready') sub = "We'll call you the moment it lands";
      return `<div class="tl-step ${cls}"><div class="tl-dot">${dot}</div><div><h4>${STATUS_LABELS[s]}</h4><p>${sub}</p></div></div>`;
    }).join('');
    $('trackErr').classList.remove('show');
    $('timeline').classList.add('show');
    $('timeline').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function track(no) {
    const wb = (no || '').trim().toUpperCase();
    if (!wb) return;
    $('trackErr').classList.remove('show');
    try {
      const res = await fetch(`${FN}/track?waybill=${encodeURIComponent(wb)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.waybill_no) return renderTracking(data);
      }
      if (res.status === 404) {
        $('timeline').classList.remove('show');
        const err = $('trackErr');
        err.textContent = `No shipment found for "${wb}". Double-check the number or call ${co.phones[0]}.`;
        err.classList.add('show');
        return;
      }
      throw new Error('track function unavailable');
    } catch (e) {
      /* Static preview / backend not deployed yet: demo waybill still works */
      if (wb === DEMO_TRACKING.waybill_no) return renderTracking(DEMO_TRACKING);
      $('timeline').classList.remove('show');
      const err = $('trackErr');
      err.textContent = `Tracking is temporarily unavailable — call ${co.phones[0]} and we'll check for you.`;
      err.classList.add('show');
    }
  }

  $('trackBtn').addEventListener('click', () => track($('trackInput').value));
  $('trackInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); track($('trackInput').value); }
  });
  $('demoNo').addEventListener('click', () => {
    $('trackInput').value = DEMO_TRACKING.waybill_no;
    track(DEMO_TRACKING.waybill_no);
  });

  /* ---------- Phase 4: sailing schedule (live with config fallback) ---------- */
  function renderSchedule(sailings) {
    const f = (iso) =>
      new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const TAGS = {
      open: '<span class="tag open">Accepting cargo</span>',
      closing: '<span class="tag closing">Closing soon</span>',
      closed: '<span class="tag closed">Cut-off passed</span>',
      sailed: '<span class="tag sailed">Sailed</span>',
    };
    $('schedBody').innerHTML = sailings
      .map(
        (s) =>
          `<tr><td>${s.vessel}</td><td>${f(s.departs)}</td><td>${f(s.arrives)} (est.)</td><td>${f(s.cutoff)}</td><td>${TAGS[s.status] || TAGS.open}</td></tr>`
      )
      .join('');
    startCountdown(sailings);
  }

  function startCountdown(sailings) {
    const next = sailings
      .filter((s) => s.status !== 'sailed' && new Date(s.departs + 'T12:00:00') > new Date())
      .sort((a, b) => a.departs.localeCompare(b.departs))[0];
    const el = $('countdown');
    if (!next) { el.textContent = 'Next sailing announced soon'; return; }
    const dep = new Date(next.departs + 'T12:00:00');
    function tick() {
      const d = dep - new Date();
      if (d <= 0) { el.textContent = 'Departed — next sailing soon'; return; }
      const days = Math.floor(d / 86400000),
        hrs = Math.floor(d / 3600000) % 24,
        min = Math.floor(d / 60000) % 60,
        sec = Math.floor(d / 1000) % 60;
      el.textContent = `${days}d ${String(hrs).padStart(2, '0')}h ${String(min).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
    }
    tick();
    setInterval(tick, 1000);
  }

  (async () => {
    try {
      const res = await fetch(`${FN}/sailings`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) return renderSchedule(data);
      }
      throw new Error('fallback');
    } catch {
      renderSchedule(cfg.sailings); // fallback to config
    }
  })();

  /* ---------- scroll reveal ---------- */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
})();
