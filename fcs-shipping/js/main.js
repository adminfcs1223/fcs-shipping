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
  /* headline spells itself out, letter by letter, with a blinking caret */
  (function typeHeadline() {
    const el = $('heroTitle');
    const text = cfg.hero.title;
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { el.textContent = text; return; }
    el.textContent = '';
    el.classList.add('typing');
    let i = 0;
    const tick = () => {
      el.textContent = text.slice(0, ++i);
      if (i < text.length) {
        /* slight jitter reads like real typing; pause a beat on spaces */
        setTimeout(tick, text[i - 1] === ' ' ? 150 : 62 + Math.random() * 60);
      } else {
        setTimeout(() => el.classList.remove('typing'), 2600); /* caret blinks, then rests */
      }
    };
    setTimeout(tick, 500);
  })();
  /* tagline: "___ Shipping Simplified" with a rotating first word */
  (function heroTagline() {
    const p = $('heroLede');
    if (!p) return;
    const words = (Array.isArray(cfg.hero.rotatorWords) && cfg.hero.rotatorWords.length)
      ? cfg.hero.rotatorWords
      : ['Barrel', 'Box', 'Container', 'Crate', 'Life'];
    const suffix = cfg.hero.rotatorSuffix || 'Shipping Simplified';
    const escW = (s) => String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    p.innerHTML = `<b id="rotWord">${escW(words[0])}</b> ${escW(suffix)}`;
    const w = $('rotWord');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || words.length < 2) return;
    let i = 0;
    setInterval(() => {
      w.classList.add('rot-out');                       /* slide up & out */
      setTimeout(() => {
        i = (i + 1) % words.length;
        w.textContent = words[i];
        w.classList.remove('rot-out');
        w.classList.add('rot-in');                      /* appear from below */
        requestAnimationFrame(() => requestAnimationFrame(() => w.classList.remove('rot-in')));
      }, 260);
    }, 2300);
  })();

  /* ---------- hero geometry: the water above and below the ship are two
        windows; each text bubble stays dead-center in its window at ANY
        viewport size. Ship band measured from the photo itself. ---------- */
  (function heroBands() {
    const hero = document.querySelector('.hero');
    const topEl = document.querySelector('.hero-top');
    const botEl = document.querySelector('.hero-bottom');
    if (!hero || !topEl || !botEl) return;
    const IMG = { w: 3200, h: 2128, posY: 0.42, shipTop: 0.412, shipBottom: 0.607 };
    function layout(second) {
      const W = hero.clientWidth, H = hero.clientHeight;
      if (!W || !H) return;
      const scale = Math.max(W / IMG.w, H / IMG.h);   /* background-size: cover */
      const dispH = IMG.h * scale;
      const offset = (dispH - H) * IMG.posY;          /* image cropped above the frame */
      const shipTopPx = Math.max(0, IMG.shipTop * dispH - offset);
      const shipBotPx = Math.min(H, IMG.shipBottom * dispH - offset);
      /* if a window can't fit its bubble, grow the hero just enough — never clip */
      const deficit = Math.max(0,
        (botEl.offsetHeight + 76) - (H - shipBotPx),
        (topEl.offsetHeight + 20) - shipTopPx);
      if (deficit > 4 && !second) {
        hero.style.minHeight = (H + deficit) + 'px';
        return layout(true);
      }
      /* top bubble: centered between the photo's top edge and the ship */
      topEl.style.top = Math.max(8, (shipTopPx - topEl.offsetHeight) / 2) + 'px';
      /* bottom bubble: centered between the ship and the photo's bottom edge */
      botEl.style.top = Math.max(shipBotPx + 8, shipBotPx + (H - shipBotPx - botEl.offsetHeight) / 2) + 'px';
    }
    layout();
    window.addEventListener('resize', layout);
    window.addEventListener('load', layout);
    setTimeout(layout, 350);
    setTimeout(layout, 1800);  /* once fonts + animations have settled */
  })();
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

  /* arrival country on the schedule header (backend-controlled) */
  const arrCountry = $('arrCountry');
  if (arrCountry && cfg.arrivalCountry) arrCountry.textContent = cfg.arrivalCountry;

  /* team grid (backend-editable: settings → pricing.team) */
  (function renderTeam() {
    const grid = $('teamGrid');
    if (!grid) return;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const list = Array.isArray(cfg.team) ? cfg.team.filter((t) => t && t.name) : [];
    const head = document.querySelector('.team-head');
    if (!list.length) { if (head) head.hidden = true; grid.hidden = true; return; }
    grid.innerHTML = list.map((t) => {
      const initials = t.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
      const photo = t.photo
        ? `<img class="ph" src="${esc(t.photo)}" alt="${esc(t.name)}" onerror="this.outerHTML='<div class=&quot;ph-fallback&quot;>${initials}</div>'">`
        : `<div class="ph-fallback">${initials}</div>`;
      return `<div class="team-card">${photo}<b>${esc(t.name)}</b><span>${esc(t.role || '')}</span></div>`;
    }).join('');
  })();

  /* ---------- supabase client (session check + live testimonials) ---------- */
  let sbClient = null;
  try {
    const AC = window.ADMIN_CONFIG || {};
    if (window.supabase && AC.SUPABASE_URL && !AC.SUPABASE_URL.includes('YOUR-PROJECT')) {
      sbClient = window.supabase.createClient(AC.SUPABASE_URL, AC.SUPABASE_ANON_KEY);
      const { data: { session } } = await sbClient.auth.getSession();
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

  /* ---------- testimonials (admin-editable via settings table) ---------- */
  (async () => {
    const grid = $('testimonialGrid');
    if (!grid) return;
    const escT = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let list = cfg.testimonials || [];
    try {
      if (sbClient) {
        const { data } = await sbClient.from('settings').select('value').eq('key', 'testimonials').maybeSingle();
        if (data && Array.isArray(data.value) && data.value.length) list = data.value;
      }
    } catch { /* config fallback */ }
    grid.innerHTML = list.map((t) =>
      `<div class="t-card">
        <div class="t-stars" aria-label="5 out of 5 stars">★★★★★</div>
        <p>“${escT(t.text)}”</p>
        <div class="who"><b>${escT(t.name)}</b> · ${escT(t.location)}</div>
      </div>`).join('');
  })();

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

  /* ==================================================================
     REQUEST-A-PICKUP WIZARD
     Step 1 icons → destination (admin-driven, flags) → extras → modal.
     The waybill (desktop) fills in live as choices are made.
     ================================================================== */
  const state = {
    item: null,             /* 'amazon' side path only */
    items: { barrel: 0, bin: 0, box: 0 },  /* id -> qty, mix & match */
    dest: null,             /* destination object from cfg */
    insurance: false,
    supplies: {},           /* id -> qty */
    supplyDelivery: false,
    suppliesOnly: false,
    ebl: null,
  };
  const ITEM_IDS = ['barrel', 'bin', 'box'];
  cfg.supplies.forEach((s) => (state.supplies[s.id] = 0));
  const cargoById = (id) => cfg.cargo.find((c) => c.id === id);
  const insuranceExtra = cfg.extras.find((x) => x.id === 'insurance') || { price: 25, label: 'Insurance' };

  const ITEM_LABELS = { barrel: 'Barrel', bin: 'Commercial Bin', box: 'Box', amazon: 'Amazon / online order' };

  function flagFor(country) {
    const c = String(country || '').toLowerCase();
    const MAP = [['lucia','\u{1F1F1}\u{1F1E8}'],['jamaica','\u{1F1EF}\u{1F1F2}'],['trinidad','\u{1F1F9}\u{1F1F9}'],
      ['barbados','\u{1F1E7}\u{1F1E7}'],['grenada','\u{1F1EC}\u{1F1E9}'],['vincent','\u{1F1FB}\u{1F1E8}'],
      ['dominican','\u{1F1E9}\u{1F1F4}'],['dominica','\u{1F1E9}\u{1F1F2}'],['haiti','\u{1F1ED}\u{1F1F9}'],
      ['guyana','\u{1F1EC}\u{1F1FE}'],['antigua','\u{1F1E6}\u{1F1EC}'],['kitts','\u{1F1F0}\u{1F1F3}'],
      ['bahamas','\u{1F1E7}\u{1F1F8}'],['cuba','\u{1F1E8}\u{1F1FA}'],['puerto','\u{1F1F5}\u{1F1F7}']];
    for (const [k, f] of MAP) if (c.includes(k)) return f;
    return '\u{1F30E}';
  }

  /* ---------- steps ---------- */
  function showStep(n) {
    ['wzStep1', 'wzStep2', 'wzStep3', 'wzStepEbl'].forEach((id) =>
      $(id).classList.toggle('on', id === 'wzStep' + n));
    renderBill();
  }
  document.querySelectorAll('.wz-back').forEach((b) =>
    b.addEventListener('click', () => showStep(b.dataset.back)));

  /* step 1: pick items with quantities — tap a card, +/- appears, mix as many
     kinds as you want, then hit Continue */
  function syncItemCards() {
    let total = 0;
    ITEM_IDS.forEach((id) => {
      const n = state.items[id]; total += n;
      const card = document.querySelector(`[data-pick="${id}"]`);
      if (!card) return;
      card.classList.toggle('sel', n > 0);
      const st = card.querySelector('.wz-qty'); if (st) st.hidden = n === 0;
      const q = $('iqty-' + id); if (q) q.textContent = n;
    });
    $('wzContinue').hidden = total === 0;
    renderBill();
  }
  document.querySelectorAll('[data-pick]').forEach((card) =>
    card.addEventListener('click', (ev) => {
      state.suppliesOnly = false;
      state.ebl = null;
      const id = card.dataset.pick;
      if (id === 'amazon') { state.item = 'amazon'; openModal('mAmazon'); renderBill(); return; }
      state.item = null;
      if (ev.target.closest('.qb')) return; /* +/- buttons handle themselves */
      if (state.items[id] === 0) state.items[id] = 1;
      syncItemCards();
    }));
  document.querySelectorAll('[data-iplus]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    state.items[b.dataset.iplus] = Math.min(50, state.items[b.dataset.iplus] + 1);
    syncItemCards();
  }));
  document.querySelectorAll('[data-iminus]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    state.items[b.dataset.iminus] = Math.max(0, state.items[b.dataset.iminus] - 1);
    syncItemCards();
  }));
  $('wzContinue').addEventListener('click', () => {
    if (!ITEM_IDS.some((id) => state.items[id] > 0)) return;
    buildDestGrid();
    showStep(2);
  });

  /* step 2: destination cards from the admin-controlled destinations list */
  function buildDestGrid() {
    $('wzDestGrid').innerHTML = cfg.destinations.map((d, i) => {
      if (d.call) {
        return `<button type="button" class="wz-card wz-dest" data-dest="${i}" data-call="1">
          <span class="flag-sm">+</span><span>Other island</span><small>call us for rates</small></button>`;
      }
      return `<button type="button" class="wz-card wz-dest" data-dest="${i}">
        <span class="flag-sm">${flagFor(d.country)}</span><span>${d.name}</span><small>${d.country || ''}</small></button>`;
    }).join('');
    document.querySelectorAll('[data-dest]').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.call) { openModal('mCall'); return; }
        state.dest = cfg.destinations[+b.dataset.dest];
        buildExtras();
        showStep(3);
      }));
  }

  /* step 3: extras */
  function buildExtras() {
    $('wzExtrasTitle').textContent = state.suppliesOnly ? 'What do you need?' : 'Anything extra?';
    $('wzInsurance').style.display = state.suppliesOnly ? 'none' : '';
    $('wzInsPrice').textContent = insuranceExtra.price ? `+$${insuranceExtra.price}` : '';
    $('wzSupplies').innerHTML =
      `<p class="dims-note" style="margin-bottom:.5rem">${state.suppliesOnly ? 'Empty barrels & bins, delivered or picked up:' : 'Need empty barrels or bins with that?'}</p>` +
      cfg.supplies.map((sp) => `<div class="supply-row">
          <div class="sl">${sp.label}<small>$${sp.price} each</small></div>
          <button type="button" class="qty-btn" data-sminus="${sp.id}" aria-label="Fewer">\u2212</button>
          <span class="sqty" id="sqty-${sp.id}">${state.supplies[sp.id]}</span>
          <button type="button" class="qty-btn" data-splus="${sp.id}" aria-label="More">+</button>
        </div>`).join('');
    document.querySelectorAll('[data-splus]').forEach((b) => b.addEventListener('click', () => bumpSupply(b.dataset.splus, 1)));
    document.querySelectorAll('[data-sminus]').forEach((b) => b.addEventListener('click', () => bumpSupply(b.dataset.sminus, -1)));
    syncDeliver();
  }
  function bumpSupply(id, d) {
    state.supplies[id] = Math.min(50, Math.max(0, state.supplies[id] + d));
    $('sqty-' + id).textContent = state.supplies[id];
    syncDeliver(); renderBill();
  }
  function syncDeliver() {
    const any = Object.values(state.supplies).some((n) => n > 0);
    $('wzDeliverWrap').hidden = !any;
    if (!any) { state.supplyDelivery = false; $('wzDeliver').checked = false; }
  }
  $('wzDeliver').addEventListener('change', () => { state.supplyDelivery = $('wzDeliver').checked; renderBill(); });
  $('wzInsurance').addEventListener('click', () => {
    state.insurance = !state.insurance;
    $('wzInsurance').setAttribute('aria-pressed', String(state.insurance));
    renderBill();
  });
  $('wzNoThanks').addEventListener('click', () => {
    state.insurance = false; $('wzInsurance').setAttribute('aria-pressed', 'false');
    cfg.supplies.forEach((sp) => (state.supplies[sp.id] = 0));
    state.supplyDelivery = false;
    renderBill();
    openPickupModal();
  });
  $('wzRequest').addEventListener('click', openPickupModal);

  /* side paths */
  $('wzSuppliesOnly').addEventListener('click', () => {
    state.suppliesOnly = true; state.item = null; state.dest = null; state.insurance = false;
    buildExtras(); showStep(3);
  });
  $('wzHaveEbl').addEventListener('click', () => showStep('Ebl'));

  /* ---------- modals ---------- */
  function openModal(id) {
    $('mBack').hidden = false;
    ['mForm', 'mAmazon', 'mCall', 'mDone'].forEach((m) => ($(m).hidden = m !== id));
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    $('mBack').hidden = true;
    document.body.style.overflow = '';
  }
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  $('mBack').addEventListener('click', (e) => { if (e.target === $('mBack')) closeModal(); });

  function openPickupModal() {
    $('mFormSub').textContent = state.suppliesOnly
      ? 'Tell us who you are and where the supplies are headed.'
      : state.item === 'amazon'
        ? "Tell us what's on the way and who it's for."
        : "Tell us where to come and we'll take it from there.";
    /* destination is already answered — show it, don't ask again */
    const d = state.dest;
    $('mDestLine').textContent = d && !d.call
      ? `${flagFor(d.country)} ${d.name}, ${d.country || cfg.arrivalCountry || 'St. Lucia'}`
      : state.suppliesOnly ? 'Supplies — Brooklyn pickup or delivery'
      : state.item === 'amazon' ? 'Our Brooklyn warehouse → the island'
      : '—';
    $('mErr').hidden = true;
    openModal('mForm');
    setTimeout(() => $('pName').focus(), 150);
  }

  /* amazon flow */
  $('mCopyAddr').addEventListener('click', async () => {
    const txt = ($('pName').value.trim() || 'Your Name') +
      ' — c/o FCS Shipping LLC\n9502 Ditmas Ave, Building 4\nBrooklyn, NY 11236';
    try { await navigator.clipboard.writeText(txt); $('mCopyAddr').textContent = 'Copied \u2713'; }
    catch { prompt('Copy this address:', txt); }
    setTimeout(() => ($('mCopyAddr').textContent = 'Copy address'), 2000);
  });
  $('mNotify').addEventListener('click', () => { state.item = 'amazon'; openPickupModal(); });

  /* submit */
  $('mSubmit').addEventListener('click', async () => {
    const name = $('pName').value.trim();
    const phone = $('pPhone').value.trim();
    if (!name || !phone) {
      $('mErr').textContent = 'Just need your name and a phone number so we can reach you.';
      $('mErr').hidden = false;
      return;
    }
    const btn = $('mSubmit');
    btn.disabled = true; btn.textContent = 'Sending\u2026';
    try {
      const res = await fetch(`${FN}/pickup-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: state.suppliesOnly ? 'supplies' : (state.item === 'amazon' ? 'amazon' : 'pickup'),
          item: state.item || ITEM_IDS.filter((id) => state.items[id] > 0).map((id) => id + '×' + state.items[id]).join(', '),
          items: state.items,
          destination: state.dest ? state.dest.name : '',
          insurance: state.insurance,
          supplies: state.supplies,
          supplyDelivery: state.supplyDelivery,
          sender: {
            name, phone,
            phone2: $('pPhone2').value.trim(), email: $('pEmail').value.trim(),
            street: $('pStreet').value.trim(), apt: $('pApt').value.trim(),
            city: $('pCity').value.trim(), state: $('pState').value.trim(), zip: $('pZip').value.trim(),
            date: $('pDate').value,
          },
          consignee: {
            name: $('cName').value.trim(),
            /* filled from what they already chose — no need to ask twice */
            address: state.dest && !state.dest.call ? state.dest.name : '',
            country: state.dest && !state.dest.call ? (state.dest.country || cfg.arrivalCountry || 'St. Lucia') : '',
            phone: $('cPhone').value.trim(), phone2: $('cPhone2').value.trim(),
            email: $('ccEmail').value.trim(),
          },
          website: $('pWebsite').value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Request failed');
      $('mDoneText').textContent = 'You will receive a call from us shortly.';
      openModal('mDone');
    } catch (err) {
      /* show the server's actual reason when it has one (e.g. rate limit) */
      $('mErr').textContent = (err && err.message && err.message !== 'Request failed')
        ? err.message
        : `Couldn't send right now \u2014 call us at ${co.phones[0]} and we'll set it up.`;
      $('mErr').hidden = false;
    }
    btn.disabled = false; btn.textContent = 'Request Pickup';
  });

  /* ---------- EB/L: load + pay ---------- */
  $('eblLoad').addEventListener('click', async () => {
    const no = $('eblInput').value.trim().toUpperCase();
    const msg = $('eblMsg');
    if (!no) return;
    msg.textContent = 'Looking up ' + no + '\u2026';
    try {
      const res = await fetch(`${FN}/ebl?no=${encodeURIComponent(no)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Not found');
      if (data.status === 'paid') { msg.textContent = 'This EB/L is already paid \u2014 thank you!'; return; }
      state.ebl = data;
      $('eblPay').hidden = false;
      msg.textContent = 'Loaded! Review the bill and hit Pay now.';
      renderBill();
    } catch (e) {
      state.ebl = null; $('eblPay').hidden = true;
      msg.textContent = `Couldn't find that EB/L number. Double-check it or call ${co.phones[0]}.`;
      renderBill();
    }
  });
  $('eblInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('eblLoad').click(); } });
  $('eblPay').addEventListener('click', async () => {
    if (!state.ebl) return;
    const btn = $('eblPay');
    btn.disabled = true; btn.textContent = 'Opening secure checkout\u2026';
    try {
      const res = await fetch(`${FN}/create-checkout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eblNo: state.ebl.ebl_no }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Checkout unavailable');
      window.location.href = data.url;
    } catch (err) {
      alert(`Online payment isn't available right now \u2014 call ${co.phones[0]} to pay.`);
      btn.disabled = false; btn.textContent = 'Pay now \u2192';
    }
  });

  /* ---------- waybill (desktop) ---------- */
  function flatPrice(c, destName) {
    return c && c.prices && c.prices[destName] != null ? Number(c.prices[destName]) : null;
  }

  function renderBill() {
    if (!$('wbDeparting')) return;
    $('wbDeparting').textContent = departStr + ' (every Thursday)';
    $('wbSave').hidden = true;

    /* EB/L mode */
    if (state.ebl && $('wzStepEbl').classList.contains('on')) {
      const e = state.ebl;
      $('wbNoLabel').textContent = 'EB/L N\u00BA';
      $('wbNo').textContent = e.ebl_no;
      $('wbItem').textContent = `${e.cargo}${e.quantity > 1 ? ' \u00D7 ' + e.quantity : ''}`;
      $('wbVolume').textContent = e.cuft ? e.cuft + ' cu ft' : '\u2014';
      $('wbDest').textContent = e.destination ? `${e.destination}, ${cfg.arrivalCountry || 'St. Lucia'}` : '\u2014';
      $('wbBase').textContent = fmt(e.price_cents);
      $('wbExtras').textContent = '\u2014';
      $('wbSupplies').textContent = '\u2014';
      $('wbTotalLabel').textContent = 'TOTAL DUE';
      $('wbTotal').textContent = fmt(e.price_cents);
      $('wbNote').hidden = true;
      return;
    }
    $('wbNoLabel').textContent = 'EB/L N\u00BA';
    $('wbNo').textContent = 'PENDING';
    $('wbTotalLabel').textContent = 'ESTIMATED TOTAL';
    $('wbNote').hidden = false;

    const d = state.dest;
    /* the little St. Lucia map only appears once a St. Lucia destination is chosen */
    const lm = $('luciaMap');
    if (lm) lm.hidden = !(d && !d.call &&
      String(d.country || cfg.arrivalCountry || '').toLowerCase().includes('lucia'));
    const chosen = ITEM_IDS.filter((id) => state.items[id] > 0);
    let freight = 0, cuft = 0, boxLater = false, ref = 0, anyFlat = false;
    if (chosen.length && d && !d.call) {
      chosen.forEach((id) => {
        const c = cargoById(id); if (!c) return;
        const n = state.items[id];
        cuft += (c.cuft || 0) * n;
        const flat = flatPrice(c, d.name);
        if (flat != null) {
          freight += Math.round(flat * 100) * n;
          anyFlat = true;
          ref += (d.rate && c.cuft) ? Math.round(c.cuft * d.rate * 100) * n : Math.round(flat * 100) * n;
        } else if (c.custom) { boxLater = true; }
        else if (d.rate && c.cuft) { const v = Math.round(c.cuft * d.rate * 100) * n; freight += v; ref += v; }
      });
      if (anyFlat && ref > freight) {
        $('wbSaveAmt').textContent = '$' + Math.round((ref - freight) / 100).toLocaleString();
        $('wbSave').hidden = false;
      }
    }
    let suppliesC = 0, suppliesN = 0;
    const supplyBits = [];
    cfg.supplies.forEach((sp) => {
      const n = state.supplies[sp.id];
      if (n > 0) { suppliesC += sp.price * 100 * n; suppliesN += n; supplyBits.push(`${sp.label} \u00D7 ${n}`); }
    });
    if (suppliesN > 0 && state.supplyDelivery) suppliesC += (cfg.suppliesDeliveryFee || 5) * 100;
    const insC = state.insurance ? Math.round(insuranceExtra.price * 100) : 0;

    $('wbItem').textContent = state.suppliesOnly ? 'Empty supplies order'
      : state.item === 'amazon' ? 'Online orders \u2192 our warehouse'
      : chosen.length
        ? chosen.map((id) => { const c2 = cargoById(id); return `${c2 ? c2.label : id}${state.items[id] > 1 ? ' \u00d7 ' + state.items[id] : ''}`; }).join(', ')
        : 'pick an item to begin';
    $('wbVolume').textContent = cuft ? cuft + ' cu ft' + (boxLater ? ' + box' : '') : (boxLater ? 'measured at pickup' : '\u2014');
    $('wbDest').textContent = d && !d.call ? `${d.name}, ${d.country || cfg.arrivalCountry || 'St. Lucia'}` : '\u2014';
    $('wbBase').textContent = freight ? fmt(freight) + (anyFlat ? ' (flat)' : '') + (boxLater ? ' + box at pickup' : '')
      : (boxLater ? 'priced at pickup' : '\u2014');
    $('wbExtras').textContent = state.insurance ? `${insuranceExtra.label}  ${fmt(insC)}` : '\u2014';
    $('wbSupplies').textContent = suppliesN
      ? supplyBits.join(', ') + (state.supplyDelivery ? ' + delivery' : '') + '  ' + fmt(suppliesC)
      : '\u2014';
    const total = freight + insC + suppliesC;
    $('wbTotal').textContent = total ? '$' + Math.round(total / 100).toLocaleString() : '\u2014';
  }

  renderBill();

  /* payment redirect results (EB/L payments) */
  const params = new URLSearchParams(location.search);
  if (params.get('paid') === '1') {
    $('mDoneText').textContent = 'Payment received \u2014 thank you! We\u2019ll call you to arrange the details.';
    openModal('mDone');
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

  /* ---------- next-sailing countdown (schedule table retired) ---------- */
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

  /* the vessel leaves every Thursday — countdown always aims at the next one */
  startCountdown([]);

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
