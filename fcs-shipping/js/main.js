/* FCS Shipping — front-end logic (v2: cu-ft pricing, EB/L, supplies).
   Editable content lives in /site.config.json; live prices can be overridden
   from the admin dashboard (settings table). */

(async function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const fmt = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    if (pr && pr.cargo) Object.assign(cfg, pr);
  } catch { /* static preview — config prices are fine */ }

  /* ---------- populate static text ---------- */
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
  $('cPhones').innerHTML = co.phones.map((p, i) => `<a href="tel:${co.phoneLinks[i]}">${p}</a>`).join(' · ');
  $('cEmail').innerHTML = `<a href="mailto:${co.email}">${co.email}</a>`;
  $('footLine').textContent =
    `© ${new Date().getFullYear()} ${co.name} · ${co.address} · ${co.phones[0]} · ${co.email}`;
  $('faqList').innerHTML = cfg.faq
    .map((f, i) => `<details${i === 0 ? ' open' : ''}><summary>${f.q}</summary><p>${f.a}</p></details>`)
    .join('');

  /* ---------- signed-in nav: Welcome Back, Name! ---------- */
  try {
    const AC = window.ADMIN_CONFIG || {};
    if (window.supabase && AC.SUPABASE_URL && !AC.SUPABASE_URL.includes('YOUR-PROJECT')) {
      const sb = window.supabase.createClient(AC.SUPABASE_URL, AC.SUPABASE_ANON_KEY);
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        const full = (session.user.user_metadata && session.user.user_metadata.full_name) || '';
        const first = full.split(' ')[0] || session.user.email.split('@')[0];
        const signin = document.querySelector('.nav-signin');
        const cta = document.querySelector('.nav-cta');
        if (cta) { cta.textContent = `Welcome Back, ${first}!`; cta.href = '/account/'; }
        if (signin) signin.remove();
      }
    }
  } catch (e) { console.warn('session check skipped', e); }

  /* ---------- next Thursday departure ---------- */
  function nextThursday(from) {
    const d = new Date(from || Date.now());
    d.setHours(0, 0, 0, 0);
    const add = (4 - d.getDay() + 7) % 7; /* 4 = Thursday; today if Thursday */
    d.setDate(d.getDate() + add);
    return d;
  }
  const departDate = nextThursday();
  const departStr = departDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  /* ---------- quote builder state ---------- */
  let qty = 1;
  const state = {
    cargoId: cfg.cargo[0].id,
    dest: cfg.destinations[0],
    extras: [],
    dims: { l: 0, w: 0, h: 0 },
    supplies: {},           /* id -> qty */
    supplyDelivery: false,
    ebl: null,              /* loaded EB/L record */
  };
  cfg.supplies.forEach((s) => (state.supplies[s.id] = 0));

  const cargoById = (id) => cfg.cargo.find((c) => c.id === id);

  $('itemChips').innerHTML = cfg.cargo
    .map((c, i) => `<button type="button" class="chip" data-id="${c.id}" aria-pressed="${i === 0}">${c.label}</button>`)
    .join('');
  $('dest').innerHTML = cfg.destinations
    .map((d) => `<option value="${d.name}">${d.name}${d.rate ? ` ($${d.rate}/cu ft)` : ''}</option>`)
    .join('');
  $('extraChips').innerHTML = cfg.extras
    .map((x) => `<button type="button" class="chip extra" data-id="${x.id}" aria-pressed="false">${x.buttonText}</button>`)
    .join('');
  $('suppliesList').innerHTML = cfg.supplies
    .map((s) => `<div class="supply-row">
        <div class="sl">${s.label}<small>$${s.price} each</small></div>
        <button type="button" class="qty-btn" data-sminus="${s.id}" aria-label="Fewer">−</button>
        <span class="sqty" id="sqty-${s.id}">0</span>
        <button type="button" class="qty-btn" data-splus="${s.id}" aria-label="More">+</button>
      </div>`)
    .join('');

  /* ---------- pricing (mirrors the server; server always recomputes) ---------- */
  function currentCuft() {
    const c = cargoById(state.cargoId);
    if (!c) return 0;
    if (c.custom) {
      const { l, w, h } = state.dims;
      if (l > 0 && w > 0 && h > 0) return Math.max(1, Math.round((l * w * h) / 1728 * 10) / 10);
      return 0;
    }
    return c.cuft || 0;
  }

  function renderBill() {
    const c = cargoById(state.cargoId);
    $('wbDeparting').textContent = departStr + ' (every Thursday)';

    /* EB/L mode: show the pre-priced bill from the office */
    if (c.ebl && state.ebl) {
      const e = state.ebl;
      $('wbNoLabel').textContent = 'EB/L Nº';
      $('wbNo').textContent = e.ebl_no;
      $('wbItem').textContent = `${e.cargo}${e.quantity > 1 ? ' × ' + e.quantity : ''}`;
      $('wbVolume').textContent = e.cuft ? e.cuft + ' cu ft' : '—';
      $('wbDest').textContent = e.destination ? `${e.destination}, St. Lucia` : '—';
      $('wbBase').textContent = fmt(e.price_cents);
      $('wbExtras').textContent = '—';
      $('wbSupplies').textContent = '—';
      $('wbTotalLabel').textContent = 'TOTAL DUE';
      $('wbTotal').textContent = fmt(e.price_cents);
      $('wbNote').hidden = true;
      $('lockBtn').textContent = 'Pay now →';
      return;
    }

    $('wbNoLabel').textContent = 'EB/L Nº';
    $('wbNo').textContent = 'PENDING';
    $('wbTotalLabel').textContent = 'ESTIMATED TOTAL';
    $('wbNote').hidden = false;
    $('lockBtn').textContent = 'Lock in this rate →';

    if (c.ebl) {
      $('wbItem').textContent = 'Enter your EB/L number';
      $('wbVolume').textContent = '—';
      $('wbDest').textContent = '—';
      $('wbBase').textContent = '—';
      $('wbExtras').textContent = '—';
      $('wbSupplies').textContent = '—';
      $('wbTotal').textContent = '—';
      return;
    }

    const cuft = currentCuft();
    const rate = state.dest.rate || 0;
    const callMode = Boolean(state.dest.call);
    const freight = Math.round(cuft * rate * qty * 100);
    const extrasC = state.extras.reduce((s, x) => s + x.price * 100, 0);
    let suppliesC = 0, suppliesN = 0;
    cfg.supplies.forEach((s) => {
      suppliesC += s.price * 100 * state.supplies[s.id];
      suppliesN += state.supplies[s.id];
    });
    if (suppliesN > 0 && state.supplyDelivery) suppliesC += (cfg.suppliesDeliveryFee || 5) * 100;

    $('wbItem').textContent = `${c.label} × ${qty}`;
    $('wbVolume').textContent = cuft ? `${(cuft * qty).toLocaleString()} cu ft` + (c.custom ? ` (${cuft}/box)` : '') : (c.custom ? 'enter measurements' : '—');
    $('wbDest').textContent = callMode ? state.dest.name : `${state.dest.name}, St. Lucia`;
    $('wbBase').textContent = callMode ? 'call us' : (cuft ? fmt(freight) + ` ($${rate}/cu ft)` : '—');
    $('wbExtras').textContent = state.extras.length
      ? state.extras.map((x) => x.label + (x.price ? '' : ' (FREE)')).join(', ') + (extrasC ? '  ' + fmt(extrasC) : '')
      : '—';
    $('wbSupplies').textContent = suppliesN
      ? cfg.supplies.filter((s) => state.supplies[s.id]).map((s) => `${s.label} × ${state.supplies[s.id]}`).join(', ')
        + (state.supplyDelivery ? ' + delivery' : '') + '  ' + fmt(suppliesC)
      : '—';
    $('wbTotal').textContent = callMode
      ? 'Call us'
      : (cuft || suppliesC ? '$' + Math.round((freight + extrasC + suppliesC) / 100).toLocaleString() : '—');
  }

  /* ---------- cargo chips ---------- */
  document.querySelectorAll('#itemChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#itemChips .chip').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      state.cargoId = chip.dataset.id;
      const c = cargoById(state.cargoId);
      $('dimsField').hidden = !c.custom;
      $('eblField').hidden = !c.ebl;
      if (!c.ebl) state.ebl = null;
      renderBill();
    });
  });

  /* box measurements */
  ['dimL', 'dimW', 'dimH'].forEach((id, i) => {
    $(id).addEventListener('input', () => {
      state.dims[['l', 'w', 'h'][i]] = Math.max(0, Number($(id).value) || 0);
      const cuft = currentCuft();
      $('dimsNote').textContent = cuft
        ? `= ${cuft} cu ft per box`
        : '= enter all three to calculate cubic feet';
      renderBill();
    });
  });

  /* EB/L lookup */
  $('eblLoad').addEventListener('click', async () => {
    const no = $('eblInput').value.trim().toUpperCase();
    const msg = $('eblMsg');
    if (!no) return;
    msg.textContent = 'Looking up ' + no + '…';
    try {
      const res = await fetch(`${FN}/ebl?no=${encodeURIComponent(no)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Not found');
      if (data.status === 'paid') { msg.textContent = 'This EB/L is already paid — thank you! Call us with any questions.'; return; }
      state.ebl = data;
      msg.textContent = 'Loaded! Review your bill of lading and hit Pay now.';
      renderBill();
    } catch (e) {
      state.ebl = null;
      msg.textContent = `Couldn't find that EB/L number. Double-check it or call ${co.phones[0]}.`;
      renderBill();
    }
  });
  $('eblInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('eblLoad').click(); } });

  /* destination */
  $('dest').addEventListener('change', (e) => {
    state.dest = cfg.destinations.find((d) => d.name === e.target.value) || cfg.destinations[0];
    $('destNote').hidden = !state.dest.call;
    renderBill();
  });

  /* quantity */
  $('qtyPlus').addEventListener('click', () => { qty = Math.min(qty + 1, 50); $('qtyVal').textContent = qty; renderBill(); });
  $('qtyMinus').addEventListener('click', () => { qty = Math.max(qty - 1, 1); $('qtyVal').textContent = qty; renderBill(); });

  /* extras */
  document.querySelectorAll('.chip.extra').forEach((chip) => {
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') === 'true';
      chip.setAttribute('aria-pressed', String(!on));
      const x = cfg.extras.find((e) => e.id === chip.dataset.id);
      if (on) state.extras = state.extras.filter((e) => e.id !== x.id);
      else state.extras.push(x);
      renderBill();
    });
  });

  /* supplies steppers */
  function bumpSupply(id, delta) {
    state.supplies[id] = Math.min(50, Math.max(0, state.supplies[id] + delta));
    $('sqty-' + id).textContent = state.supplies[id];
    const any = Object.values(state.supplies).some((n) => n > 0);
    $('supplyDeliveryWrap').hidden = !any;
    if (!any) { state.supplyDelivery = false; $('supplyDelivery').setAttribute('aria-pressed', 'false'); }
    renderBill();
  }
  document.querySelectorAll('[data-splus]').forEach((b) => b.addEventListener('click', () => bumpSupply(b.dataset.splus, 1)));
  document.querySelectorAll('[data-sminus]').forEach((b) => b.addEventListener('click', () => bumpSupply(b.dataset.sminus, -1)));
  $('supplyDelivery').addEventListener('click', () => {
    state.supplyDelivery = !state.supplyDelivery;
    $('supplyDelivery').setAttribute('aria-pressed', String(state.supplyDelivery));
    renderBill();
  });

  renderBill();

  /* ---------- lock in / pay ---------- */
  let lastQuoteId = null;

  function quotePayload() {
    return {
      cargoId: state.cargoId,
      quantity: qty,
      destination: state.dest.name,
      dims: state.dims,
      extras: state.extras.map((x) => x.id),
      supplies: state.supplies,
      supplyDelivery: state.supplyDelivery,
    };
  }

  $('lockBtn').addEventListener('click', async () => {
    const c = cargoById(state.cargoId);
    /* EB/L: straight to payment */
    if (c.ebl && state.ebl) {
      $('lockBtn').disabled = true;
      $('lockBtn').textContent = 'Opening secure checkout…';
      try {
        const res = await fetch(`${FN}/create-checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eblNo: state.ebl.ebl_no }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw new Error(data.error || 'Checkout unavailable');
        window.location.href = data.url;
      } catch (err) {
        alert(`Online payment isn't available right now — call ${co.phones[0]} to pay.`);
        $('lockBtn').disabled = false;
        $('lockBtn').textContent = 'Pay now →';
      }
      return;
    }
    if (c.ebl) { $('eblMsg').textContent = 'Enter your EB/L number above first, then hit Load.'; return; }
    if (state.dest.call) { $('destNote').hidden = false; return; }
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
        body: JSON.stringify(Object.assign({ name, phone, email, website: $('qWebsite').value }, quotePayload())),
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
      msg.textContent = `Couldn't send right now — please call ${co.phones[0]} or email ${co.email}.`;
      msg.classList.add('err');
      btn.disabled = false;
      btn.textContent = 'Send quote request';
    }
  });

  $('payBtn').addEventListener('click', async () => {
    const btn = $('payBtn');
    btn.disabled = true;
    btn.textContent = 'Opening secure checkout…';
    try {
      const res = await fetch(`${FN}/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ quoteId: lastQuoteId, email: $('qEmail').value.trim() }, quotePayload())),
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
    msg.textContent = 'Payment received — thank you! We\'ll call you to arrange drop-off or pickup.';
    msg.className = 'form-msg ok';
    document.getElementById('quote').scrollIntoView();
  } else if (params.get('canceled') === '1') {
    const msg = $('quoteMsg');
    $('lockPanel').classList.add('show');
    $('lockBtn').style.display = 'none';
    msg.textContent = 'Checkout canceled — no charge was made. Call us anytime.';
    msg.className = 'form-msg err';
  }

  /* ---------- tracking (B/L) ---------- */
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
    destination: 'Vieux-Fort',
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
      (STATUS_LABELS[t.status] || t.status).toUpperCase() + (t.status === 'at_sea' ? ' — ON SCHEDULE' : '');
    const evByStatus = {};
    (t.events || []).forEach((ev) => (evByStatus[ev.status] = ev));
    const fdt = (iso) =>
      new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
        err.textContent = `No shipment found for "${wb}". Double-check your B/L number or call ${co.phones[0]}.`;
        err.classList.add('show');
        return;
      }
      throw new Error('track function unavailable');
    } catch (e) {
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

  /* ---------- sailing schedule (live with config fallback) ---------- */
  function renderSchedule(sailings) {
    const f = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const TAGS = {
      open: '<span class="tag open">Accepting cargo</span>',
      closing: '<span class="tag closing">Closing soon</span>',
      closed: '<span class="tag closed">Cut-off passed</span>',
      sailed: '<span class="tag sailed">Sailed</span>',
    };
    $('schedBody').innerHTML = sailings
      .map((s) => `<tr><td>${s.vessel}</td><td>${f(s.departs)}</td><td>${f(s.arrives)} (est.)</td><td>${f(s.cutoff)}</td><td>${TAGS[s.status] || TAGS.open}</td></tr>`)
      .join('');
    startCountdown(sailings);
  }

  function startCountdown(sailings) {
    const next = sailings
      .filter((s) => s.status !== 'sailed' && new Date(s.departs + 'T12:00:00') > new Date())
      .sort((a, b) => a.departs.localeCompare(b.departs))[0];
    const el = $('countdown');
    const dep = next ? new Date(next.departs + 'T12:00:00') : nextThursday();
    function tick() {
      const d = dep - new Date();
      if (d <= 0) { el.textContent = 'Departed — next sailing soon'; return; }
      const days = Math.floor(d / 86400000), hrs = Math.floor(d / 3600000) % 24,
        min = Math.floor(d / 60000) % 60, sec = Math.floor(d / 1000) % 60;
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
      renderSchedule(cfg.sailings);
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
