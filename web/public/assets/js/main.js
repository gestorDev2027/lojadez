/* =====================================================================
   LP Barbeador · comportamento
   Sem dependências externas. Os dados vêm de assets/js/config.js.
   ===================================================================== */
(() => {
  'use strict';

  const C = window.LP_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const num = (v, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------------
     DADOS DERIVADOS DO CONFIG
     ------------------------------------------------------------------ */
  const P = Object.assign({ nome: 'Kit Barbeador', aparelhos: 1, refis: 19, laminasPorRefil: 3 }, C.produto);
  // A foto do kit pode ser trocada pela área do vendedor: o servidor manda o endereço em C.fotoKit.
  const FOTO_KIT = C.fotoKit || '/assets/img/kit-foto.jpg';
  $$('[data-foto-kit]').forEach((el) => {
    if (el.tagName === 'IMG') el.src = FOTO_KIT;
    if (el.dataset.src) el.dataset.src = FOTO_KIT;
  });
  const offers = (C.ofertas || []).map((o) => ({ ...o }));
  const base = offers[0] || { id: 'kit1', titulo: '1 Kit', quantidade: 1, preco: 0 };
  offers.forEach((o) => {
    o.quantidade = o.quantidade || 1;
    o.refisTotal = P.refis * o.quantidade;
    o.porRefil = o.preco / o.refisTotal;
    const referencia = base.preco * o.quantidade;
    o.de = o.precoDe && o.precoDe > o.preco ? o.precoDe : (o.quantidade > 1 && referencia > o.preco ? referencia : null);
    o.economia = o.de ? o.de - o.preco : 0;
  });
  let selected = offers.find((o) => o.id === C.ofertaPadrao) || offers[0] || base;

  const calc0 = Object.assign({ barbeadasPorSemana: 5, usosPorRefil: 5 }, C.calculadora);
  const mesesPara = (porSemana, usos) => (P.refis * usos) / ((porSemana * 52) / 12);

  const values = {
    marca: C.marca || '',
    aparelhos: P.aparelhos,
    refis: P.refis,
    laminasPorRefil: P.laminasPorRefil,
    laminasTotal: P.refis * P.laminasPorRefil,
    precoKit1: brl(base.preco),
    precoKit1Int: Math.floor(base.preco).toLocaleString('pt-BR'),
    precoKit1Cents: String(Math.round(base.preco * 100) % 100).padStart(2, '0'),
    precoPorRefil: brl(base.preco / P.refis),
    calcSemana: calc0.barbeadasPorSemana,
    calcUsos: calc0.usosPorRefil,
    mesesEstimados: Math.max(1, Math.floor(mesesPara(calc0.barbeadasPorSemana, calc0.usosPorRefil))),
  };

  /* ------------------------------------------------------------------
     TEXTOS E BLOCOS CONDICIONAIS
     ------------------------------------------------------------------ */
  $$('[data-text]').forEach((el) => {
    const k = el.dataset.text;
    if (k in values) el.textContent = values[k];
  });

  const flags = {
    pagamentoNaEntrega: !!C.pagamentoNaEntrega,
    depoimentos: Array.isArray(C.depoimentos) && C.depoimentos.length > 0,
  };
  $$('[data-if]').forEach((el) => (flags[el.dataset.if] ? (el.hidden = false) : el.remove()));
  $$('[data-if-not]').forEach((el) => flags[el.dataset.ifNot] && el.remove());

  const badgeText = $('#badgeText');
  if (badgeText) {
    badgeText.textContent = `${P.refis} REFIS ✦ ${P.laminasPorRefil} LÂMINAS ✦ MAIS ECONOMIA ✦ `;
    badgeText.setAttribute('textLength', '486');
    badgeText.setAttribute('lengthAdjust', 'spacing');
  }

  const legal = $('#footerLegal');
  if (legal) {
    const e = C.empresa || {};
    legal.textContent = [`© ${new Date().getFullYear()} ${C.marca || ''}`, e.razaoSocial, e.cnpj && `CNPJ ${e.cnpj}`, e.email]
      .filter(Boolean).join(' · ');
  }

  /* ------------------------------------------------------------------
     RASTREAMENTO (Meta Pixel / GTM) — só carrega se houver ID
     ------------------------------------------------------------------ */
  const R = C.rastreamento || {};
  window.dataLayer = window.dataLayer || [];
  if (R.gtmId) {
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(R.gtmId)}`;
    document.head.appendChild(s);
  }
  if (R.metaPixelId) {
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s) }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', R.metaPixelId);
    window.fbq('track', 'PageView');
  }

  function track(evento, o, extra = {}) {
    const payload = o ? {
      currency: 'BRL', value: o.preco,
      items: [{ item_id: o.id, item_name: `${P.nome} - ${o.titulo}`, price: o.preco, quantity: 1 }],
    } : {};
    const ga = { InitiateCheckout: 'begin_checkout', ViewContent: 'view_item', SelectItem: 'select_item' }[evento] || evento;
    window.dataLayer.push({ event: ga, ecommerce: payload, ...extra });
    if (window.fbq && o && ['InitiateCheckout', 'ViewContent'].includes(evento)) {
      window.fbq('track', evento, { value: o.preco, currency: 'BRL', content_ids: [o.id], content_name: o.titulo, content_type: 'product', num_items: o.quantidade });
    }
  }

  /* ------------------------------------------------------------------
     CHECKOUT E WHATSAPP
     ------------------------------------------------------------------ */
  const W = C.whatsapp || {};
  const waLink = (texto) => `https://wa.me/${String(W.numero || '').replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
  const waMensagem = (o) => (W.mensagem || 'Olá! Tenho interesse no {kit} ({preco}).')
    .replace('{kit}', `${P.nome} - ${o.titulo}`).replace('{preco}', brl(o.preco));

  function checkoutUrl(o) {
    if (!o.checkoutUrl) return null;
    try {
      const u = new URL(o.checkoutUrl, location.href);
      if (!C.checkout || C.checkout.repassarParametros !== false) {
        new URLSearchParams(location.search).forEach((v, k) => { if (!u.searchParams.has(k)) u.searchParams.set(k, v); });
      }
      return u.toString();
    } catch (err) {
      return o.checkoutUrl;
    }
  }

  function irParaCheckout(o) {
    track('InitiateCheckout', o);
    const url = checkoutUrl(o);
    if (url) {
      if (C.checkout && C.checkout.abrirEmNovaAba) window.open(url, '_blank', 'noopener');
      else location.href = url;
    } else {
      window.open(waLink(waMensagem(o)), '_blank', 'noopener');
    }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-checkout]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.dataset.checkout;
    irParaCheckout(id === 'selected' ? selected : offers.find((o) => o.id === id) || selected);
  });

  $$('[data-whatsapp]').forEach((a) => {
    a.href = waLink(`Olá! Tenho uma dúvida sobre o ${P.nome}.`);
    a.target = '_blank';
    a.rel = 'noopener';
  });

  /* ------------------------------------------------------------------
     OFERTAS
     ------------------------------------------------------------------ */
  const offerList = $('#offerList');
  const checkSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function renderOffers() {
    if (!offerList) return;
    offerList.innerHTML = offers.map((o, i) => {
      const aparelhos = o.quantidade * P.aparelhos;
      const imgs = Array.from({ length: Math.min(o.quantidade, 3) }, () =>
        `<img src="${esc(FOTO_KIT)}" alt="" loading="lazy" width="628" height="760">`).join('');
      return `
        <div class="offer" role="radio" tabindex="0" aria-checked="false" data-id="${esc(o.id)}" style="--rd:${i * 0.12}s">
          ${o.selo ? `<span class="offer__seal">${esc(o.selo)}</span>` : ''}
          <h3 class="offer__title">${esc(o.titulo)}</h3>
          <p class="offer__desc">${aparelhos} ${aparelhos > 1 ? 'aparelhos' : 'aparelho'} + ${o.refisTotal} refis</p>
          <div class="offer__stack" aria-hidden="true">${imgs}</div>
          <div class="offer__price">
            <span class="offer__from">${o.de ? `de ${brl(o.de)}` : ''}</span>
            <span class="offer__now"><small>R$</small>${num(o.preco)}</span>
          </div>
          <div class="offer__meta">
            <span><b>${brl(o.porRefil)}</b> por refil</span>
            ${o.economia > 0.009 ? `<span class="offer__save">Economize ${brl(o.economia)}</span>` : ''}
          </div>
          <div class="offer__foot"><span class="offer__check">${checkSvg}</span><span class="offer__label">Selecionar</span></div>
        </div>`;
    }).join('');

    $$('.offer', offerList).forEach((card) => {
      card.addEventListener('click', () => selectOffer(card.dataset.id, true));
      card.addEventListener('keydown', (e) => {
        const idx = offers.findIndex((o) => o.id === card.dataset.id);
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOffer(card.dataset.id, true); }
        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
          const next = offers[(idx + dir + offers.length) % offers.length];
          selectOffer(next.id, true);
          $(`.offer[data-id="${next.id}"]`, offerList)?.focus();
        }
      });
      if (fine && !reduced) {
        card.addEventListener('pointermove', (e) => {
          const r = card.getBoundingClientRect();
          card.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 8}deg`);
          card.style.setProperty('--rx', `${-((e.clientY - r.top) / r.height - 0.5) * 8}deg`);
        });
        card.addEventListener('pointerleave', () => { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
      }
    });
  }

  function selectOffer(id, fromUser) {
    const o = offers.find((x) => x.id === id);
    if (!o) return;
    selected = o;
    $$('.offer', offerList).forEach((card) => {
      const on = card.dataset.id === id;
      card.classList.toggle('is-selected', on);
      card.setAttribute('aria-checked', String(on));
      card.tabIndex = on ? 0 : -1;
      $('.offer__label', card).textContent = on ? 'Kit selecionado' : 'Selecionar';
    });
    const set = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };
    set('#ctaKit', o.titulo);
    set('#ctaPreco', brl(o.preco));
    set('#stickyKit', o.titulo);
    set('#stickyPreco', brl(o.preco));
    if (fromUser) track('SelectItem', o);
  }

  renderOffers();
  selectOffer(selected.id, false);

  /* ------------------------------------------------------------------
     DEPOIMENTOS (apenas os informados no config)
     ------------------------------------------------------------------ */
  if (flags.depoimentos) {
    $('#reviewsList').innerHTML = C.depoimentos.map((d, i) => `
      <article class="review reveal" style="--rd:${i * 0.1}s">
        <div class="review__stars" aria-label="Nota ${clamp(d.nota || 5, 1, 5)} de 5">${'★'.repeat(clamp(d.nota || 5, 1, 5))}</div>
        <p>${esc(d.texto)}</p>
        <b>${esc(d.nome)}</b>${d.cidade ? `<small>${esc(d.cidade)}</small>` : ''}
      </article>`).join('');
  }

  /* ------------------------------------------------------------------
     CONTAGEM REGRESSIVA
     ------------------------------------------------------------------ */
  (function countdown() {
    const cd = C.contagem;
    const box = $('#countdown');
    if (!box || !cd || !cd.ativo || !cd.terminaEm) return;
    const end = new Date(cd.terminaEm).getTime();
    if (Number.isNaN(end) || end <= Date.now()) return;
    $('#countdownTitle').textContent = cd.titulo || '';
    box.hidden = false;
    const els = { d: $('#cdD'), h: $('#cdH'), m: $('#cdM'), s: $('#cdS') };
    const put = (el, v) => {
      const t = String(v).padStart(2, '0');
      if (el.textContent !== t) {
        el.textContent = t;
        el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
      }
    };
    const timer = setInterval(update, 1000);
    function update() {
      const diff = end - Date.now();
      if (diff <= 0) { clearInterval(timer); box.hidden = true; return; }
      put(els.d, Math.floor(diff / 864e5));
      put(els.h, Math.floor((diff / 36e5) % 24));
      put(els.m, Math.floor((diff / 6e4) % 60));
      put(els.s, Math.floor((diff / 1e3) % 60));
    }
    update();
  })();

  /* ------------------------------------------------------------------
     PRELOADER + ENTRADA DO HERO
     ------------------------------------------------------------------ */
  const loader = $('#loader');
  const t0 = performance.now();
  let started = false;
  document.body.classList.add('is-loading');

  function start() {
    if (started) return;
    started = true;
    const wait = reduced ? 0 : Math.max(0, 1150 - (performance.now() - t0));
    setTimeout(() => {
      loader.classList.add('is-done');
      document.body.classList.remove('is-loading');
      document.body.classList.add('is-ready');
      $$('.hero .slice').forEach((s, i) => { s.style.setProperty('--d', `${0.15 + i * 0.2}s`); s.classList.add('go'); });
      setupReveals();
      setTimeout(() => loader.classList.add('is-gone'), 1100);
    }, wait);
  }
  if (document.readyState === 'complete') start();
  else { window.addEventListener('load', start); setTimeout(start, 2600); }

  /* ------------------------------------------------------------------
     REVELAÇÃO AO ROLAR + CONTADORES
     ------------------------------------------------------------------ */
  function setupReveals() {
    // escalonamento automático dentro do mesmo grupo
    $$('.stats, .how__list, .faq__list, .thumbs').forEach((g) => {
      $$('.reveal', g).forEach((el, i) => el.style.setProperty('--rd', `${i * 0.09}s`));
    });
    $$('.hero .reveal').forEach((el, i) => el.style.setProperty('--rd', `${0.5 + i * 0.1}s`));

    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target;
        el.classList.add('in');
        if (el.classList.contains('slice')) el.classList.add('go');
        const counter = el.matches('[data-count-key]') ? el : $('[data-count-key]', el);
        if (counter) countUp(counter);
        io.unobserve(el);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    $$('.reveal, .offer, .final, .slice--scroll').forEach((el) => io.observe(el));
  }

  function countUp(el) {
    const to = Number(values[el.dataset.countKey]) || 0;
    const suffix = el.dataset.suffix || '';
    if (reduced) { el.textContent = to + suffix; return; }
    const dur = 1600;
    const t = performance.now();
    (function step(now) {
      const p = clamp((now - t) / dur, 0, 1);
      const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      el.textContent = Math.round(to * e) + (p === 1 ? suffix : '');
      if (p < 1) requestAnimationFrame(step);
    })(t);
  }

  /* ------------------------------------------------------------------
     MARQUEES (faixas) — aceleram com a velocidade da rolagem
     ------------------------------------------------------------------ */
  const marquees = $$('[data-marquee]').map((track) => {
    const unit = document.createElement('div');
    unit.style.cssText = 'display:flex;flex-shrink:0';
    const originals = [...track.children];
    originals.forEach((n) => unit.appendChild(n));
    track.appendChild(unit);
    let guard = 0;
    while (unit.scrollWidth < innerWidth * 1.2 && guard++ < 12) originals.forEach((n) => unit.appendChild(n.cloneNode(true)));
    const clone = unit.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    track.appendChild(clone);
    const m = { track, unit, x: 0, speed: parseFloat(track.dataset.marquee) || 40, velocity: track.hasAttribute('data-velocity'), visible: true, width: unit.scrollWidth };
    new IntersectionObserver(([en]) => { m.visible = en.isIntersecting; }).observe(track);
    return m;
  });
  const measureMarquees = () => marquees.forEach((m) => { m.width = m.unit.scrollWidth; });
  window.addEventListener('resize', measureMarquees);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureMarquees);

  /* ------------------------------------------------------------------
     LOOP PRINCIPAL: rolagem, hero, marquees
     ------------------------------------------------------------------ */
  const header = $('#header');
  const progressBar = $('#progressBar');
  const hero = $('#hero');
  const tilt = $('#tilt');
  const floatCards = $$('[data-depth]');
  const sticky = $('#stickyBuy');
  let offersVisible = false;
  let heroVisible = true;
  let lastY = scrollY;
  let vel = 0;
  let dir = 1;
  let lastT = performance.now();
  const ptr = { x: 0.5, y: 0.4, tx: 0.5, ty: 0.4, active: false };

  new IntersectionObserver(([en]) => { offersVisible = en.isIntersecting; }, { threshold: 0.1 }).observe($('#ofertas'));
  new IntersectionObserver(([en]) => { heroVisible = en.isIntersecting; }).observe(hero);

  let viewSent = false;
  new IntersectionObserver(([en], obs) => {
    if (en.isIntersecting && !viewSent) { viewSent = true; track('ViewContent', selected); obs.disconnect(); }
  }, { threshold: 0.3 }).observe($('#ofertas'));

  if (fine && !reduced) {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      ptr.tx = (e.clientX - r.left) / r.width;
      ptr.ty = (e.clientY - r.top) / r.height;
      ptr.active = true;
    });
    hero.addEventListener('pointerleave', () => { ptr.tx = 0.5; ptr.ty = 0.4; ptr.active = false; });
  }

  function frame(now) {
    const dt = Math.min(64, now - lastT) / 1000;
    lastT = now;
    const y = scrollY;
    const dy = y - lastY;
    lastY = y;
    vel = lerp(vel, dy / Math.max(dt, 0.001), 0.12);
    if (Math.abs(dy) > 0.5) dir = dy > 0 ? 1 : -1;

    // cabeçalho, progresso, barra fixa
    header.classList.toggle('is-scrolled', y > 10);
    const max = document.documentElement.scrollHeight - innerHeight;
    progressBar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    sticky.classList.toggle('show', y > hero.offsetHeight * 0.75 && !offersVisible);

    // hero: holofote, inclinação 3D e paralaxe
    if (heroVisible && fine && !reduced) {
      ptr.x = lerp(ptr.x, ptr.tx, 0.08);
      ptr.y = lerp(ptr.y, ptr.ty, 0.08);
      hero.style.setProperty('--mx', `${ptr.x * 100}%`);
      hero.style.setProperty('--my', `${ptr.y * 100}%`);
      if (tilt) {
        tilt.style.setProperty('--ry', `${(ptr.x - 0.5) * 18}deg`);
        tilt.style.setProperty('--rx', `${-(ptr.y - 0.45) * 14}deg`);
        tilt.style.setProperty('--gx', `${ptr.x * 100}%`);
        tilt.style.setProperty('--gy', `${ptr.y * 100}%`);
      }
      floatCards.forEach((c) => {
        const d = Number(c.dataset.depth) || 20;
        c.style.setProperty('--px', `${(ptr.x - 0.5) * -d}px`);
        c.style.setProperty('--py', `${(ptr.y - 0.5) * -d + Math.min(y, 600) * -0.08}px`);
      });
    }

    // faixas
    if (!reduced) {
      const boost = 1 + clamp(Math.abs(vel) * 0.004, 0, 6);
      marquees.forEach((m) => {
        if (!m.visible || !m.width) return;
        const s = m.velocity ? m.speed * boost * dir : m.speed;
        m.x -= s * dt;
        if (m.x <= -m.width) m.x += m.width;
        if (m.x > 0) m.x -= m.width;
        m.track.style.transform = `translate3d(${m.x}px,0,0)`;
      });
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ------------------------------------------------------------------
     BOTÕES MAGNÉTICOS
     ------------------------------------------------------------------ */
  if (fine && !reduced) {
    $$('.magnetic').forEach((b) => {
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        b.style.setProperty('--bx', `${(e.clientX - r.left - r.width / 2) * 0.22}px`);
        b.style.setProperty('--by', `${(e.clientY - r.top - r.height / 2) * 0.35}px`);
      });
      b.addEventListener('pointerleave', () => { b.style.setProperty('--bx', '0px'); b.style.setProperty('--by', '0px'); });
    });
  }

  /* ------------------------------------------------------------------
     JOGO: PASSE A LÂMINA NA ESPUMA
     ------------------------------------------------------------------ */
  (function shave() {
    const stage = $('#shaveStage');
    if (!stage) return;
    const foam = $('#foam');
    const fx = $('#foamFx');
    const razor = $('#razor');
    const meter = $('#shaveMeter');
    const pctEl = $('#shavePct');
    const ctx = foam.getContext('2d');
    const fctx = fx.getContext('2d');
    const SWATH = 76;          // largura do corte (px)
    const RAZOR_W = 92;        // largura do aparelho na tela
    const HEAD_Y = 21;         // centro da cabeça do aparelho, em px
    const GOAL = 0.58;         // porcentagem que revela tudo
    let Wd = 0, Ht = 0, done = false, down = false, last = null, rot = 0;
    let cols = 0, rows = 0, grid = null, cleared = 0;
    let particles = [], fxOn = false;

    function resize() {
      const r = stage.getBoundingClientRect();
      if (Wd && Math.abs(r.width - Wd) < 2) return;
      Wd = r.width; Ht = r.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      [foam, fx].forEach((c) => { c.width = Math.round(Wd * dpr); c.height = Math.round(Ht * dpr); });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = 40; rows = Math.max(1, Math.round(cols * Ht / Wd));
      grid = new Uint8Array(cols * rows); cleared = 0;
      updateMeter();
      if (!done) paint();
    }

    function paint() {
      ctx.globalCompositeOperation = 'source-over';
      const g = ctx.createLinearGradient(0, 0, 0, Ht);
      g.addColorStop(0, '#fbfbfa'); g.addColorStop(1, '#e3e6ea');
      ctx.fillStyle = g; ctx.fillRect(0, 0, Wd, Ht);
      const n = Math.round((Wd * Ht) / 210);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * Wd;
        const y = Math.random() * Ht;
        const r = 2 + Math.pow(Math.random(), 2.2) * 18;
        const rg = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
        rg.addColorStop(0, 'rgba(255,255,255,.98)');
        rg.addColorStop(0.65, 'rgba(238,240,243,.55)');
        rg.addColorStop(1, 'rgba(170,177,187,.35)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      const v = ctx.createRadialGradient(Wd / 2, Ht / 2, Math.min(Wd, Ht) * 0.3, Wd / 2, Ht / 2, Math.max(Wd, Ht) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(40,44,52,.28)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, Wd, Ht);
      ctx.fillStyle = 'rgba(30,32,38,.55)';
      ctx.font = `800 ${clamp(Wd * 0.03, 13, 20)}px Manrope, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('ESPUMA DE BARBEAR', Wd / 2, Ht * 0.18);
    }

    function cut(a, b) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.globalAlpha = 0.35; ctx.lineWidth = SWATH + 16; ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = SWATH; ctx.stroke();

      // marca as células limpas para medir o progresso
      const cw = Wd / cols, ch = Ht / rows, rad = SWATH / 2;
      const minC = clamp(Math.floor((Math.min(a.x, b.x) - rad) / cw), 0, cols - 1);
      const maxC = clamp(Math.floor((Math.max(a.x, b.x) + rad) / cw), 0, cols - 1);
      const minR = clamp(Math.floor((Math.min(a.y, b.y) - rad) / ch), 0, rows - 1);
      const maxR = clamp(Math.floor((Math.max(a.y, b.y) + rad) / ch), 0, rows - 1);
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const i = r * cols + c;
          if (grid[i]) continue;
          const px = (c + 0.5) * cw, py = (r + 0.5) * ch;
          const t = clamp(((px - a.x) * dx + (py - a.y) * dy) / len2, 0, 1);
          const qx = a.x + t * dx - px, qy = a.y + t * dy - py;
          if (qx * qx + qy * qy <= rad * rad) { grid[i] = 1; cleared++; }
        }
      }
      updateMeter();

      // espuma que voa das bordas da lâmina
      const dist = Math.hypot(dx, dy);
      const k = Math.min(4, Math.floor(dist / 9));
      const nx = -dy / (dist || 1), ny = dx / (dist || 1);
      for (let i = 0; i < k; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        spawn(b.x + nx * rad * side, b.y + ny * rad * side, nx * side * (1 + Math.random() * 2) + dx * 0.04, -Math.random() * 2.5);
      }
      if (cleared / grid.length >= GOAL) finish();
    }

    function updateMeter() {
      const p = grid ? Math.min(1, cleared / grid.length / GOAL) : 0;
      meter.style.transform = `scaleX(${done ? 1 : p})`;
      pctEl.textContent = `${done ? 100 : Math.round(p * 100)}%`;
    }

    function spawn(x, y, vx, vy, r) {
      particles.push({ x, y, vx, vy, r: r || 2 + Math.random() * 5, life: 1 });
      if (!fxOn) { fxOn = true; requestAnimationFrame(fxLoop); }
    }
    function fxLoop() {
      fctx.clearRect(0, 0, Wd, Ht);
      particles = particles.filter((p) => p.life > 0 && p.y < Ht + 30);
      particles.forEach((p) => {
        p.vy += 0.22; p.x += p.vx; p.y += p.vy; p.life -= 0.016;
        fctx.globalAlpha = Math.max(0, p.life);
        fctx.fillStyle = '#f6f7f8';
        fctx.beginPath(); fctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); fctx.fill();
        fctx.fillStyle = 'rgba(160,166,176,.5)';
        fctx.beginPath(); fctx.arc(p.x + p.r * 0.25, p.y + p.r * 0.3, p.r * 0.55, 0, Math.PI * 2); fctx.fill();
      });
      fctx.globalAlpha = 1;
      if (particles.length) requestAnimationFrame(fxLoop); else fxOn = false;
    }

    function finish() {
      if (done) return;
      done = true;
      stage.classList.add('is-done');
      updateMeter();
      for (let i = 0; i < 70; i++) {
        spawn(Math.random() * Wd, Ht * (0.3 + Math.random() * 0.7), (Math.random() - 0.5) * 6, -3 - Math.random() * 7, 3 + Math.random() * 8);
      }
      foam.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(10px)' }], { duration: 900, easing: 'ease-out', fill: 'forwards' });
      stage.style.touchAction = 'auto';
      window.dataLayer.push({ event: 'shave_game_complete' });
    }

    const pos = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    function placeRazor(p, prev) {
      if (prev) rot = lerp(rot, clamp((p.x - prev.x) * 1.4, -30, 30), 0.3);
      razor.style.transform = `translate3d(${p.x - RAZOR_W / 2}px, ${p.y - HEAD_Y}px, 0)`;
      razor.style.setProperty('--rr', `${rot.toFixed(1)}deg`);
    }
    function touched() { if (!stage.classList.contains('is-touched')) stage.classList.add('is-touched'); }

    stage.addEventListener('pointerdown', (e) => {
      if (done || e.target.closest('button, a')) return;
      down = true; last = pos(e);
      stage.classList.add('is-touching');
      placeRazor(last);
      if (e.pointerType !== 'mouse') stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (done) return;
      const p = pos(e);
      placeRazor(p, last);
      if (e.pointerType === 'mouse' || down) {
        if (e.target.closest('.shave__skip')) { last = null; return; }
        if (last) cut(last, p);
        last = p;
        touched();
      }
    });
    const release = (e) => {
      down = false;
      if (!e || e.pointerType !== 'mouse') last = null;
      stage.classList.remove('is-touching');
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('pointerleave', (e) => { last = null; if (e.pointerType === 'mouse') razor.style.transform = 'translate3d(-200px,-200px,0)'; });
    $('#shaveSkip').addEventListener('click', finish);

    new ResizeObserver(resize).observe(stage);
    if (reduced) finish();
  })();

  /* ------------------------------------------------------------------
     ANATOMIA: o passo no centro da tela controla a ilustração
     ------------------------------------------------------------------ */
  (function anatomy() {
    const visual = $('#anatomyVisual');
    const numEl = $('#anatomyNum');
    const steps = $$('.step');
    if (!visual || !steps.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const n = en.target.dataset.step;
        steps.forEach((s) => s.classList.toggle('is-active', s === en.target));
        visual.dataset.step = n;
        numEl.textContent = String(n).padStart(2, '0');
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach((s) => io.observe(s));
    steps[0].classList.add('is-active');
  })();

  /* ------------------------------------------------------------------
     CALCULADORA DE RENDIMENTO
     ------------------------------------------------------------------ */
  (function calculator() {
    const inS = $('#inSemana');
    const inU = $('#inUsos');
    if (!inS || !inU) return;
    inS.value = calc0.barbeadasPorSemana;
    inU.value = calc0.usosPorRefil;
    const refisBox = $('#resRefis');
    refisBox.innerHTML = Array.from({ length: P.refis }, (_, i) => `<i style="--i:${i}"></i>`).join('');
    refisBox.style.gridTemplateColumns = `repeat(${Math.ceil(P.refis / 2)}, 1fr)`;
    $('#resMonths').innerHTML = Array.from({ length: 12 }, (_, i) => `<span>${i + 1}</span>`).join('');

    // terceiro cartão: troca de refil
    const cards = $('.calc__cards');
    const extra = document.createElement('div');
    extra.innerHTML = '<span class="mono">Refil novo a cada</span><b id="resDias">7 dias</b>';
    cards.appendChild(extra);

    let shownMeses = mesesPara(calc0.barbeadasPorSemana, calc0.usosPorRefil);
    let anim = 0;

    function fill(input) {
      const p = ((input.value - input.min) / (input.max - input.min)) * 100;
      input.style.setProperty('--p', `${p}%`);
    }

    function update(wave) {
      const sem = Number(inS.value);
      const usos = Number(inU.value);
      fill(inS); fill(inU);
      $('#outSemana').textContent = sem;
      $('#outUsos').textContent = usos;
      const barbeadas = P.refis * usos;
      const meses = mesesPara(sem, usos);
      const dias = Math.max(1, Math.round((7 * usos) / sem));
      $('#resBarbeadas').textContent = barbeadas.toLocaleString('pt-BR');
      $('#resCusto').textContent = brl(base.preco / barbeadas);
      $('#resDias').textContent = `${dias} ${dias > 1 ? 'dias' : 'dia'}`;
      $('#resBar').style.transform = `scaleX(${clamp(meses / 12, 0.02, 1)})`;
      $$('#resMonths span').forEach((s, i) => s.classList.toggle('on', i < Math.ceil(meses)));

      cancelAnimationFrame(anim);
      const from = shownMeses, t = performance.now();
      const draw = (v) => {
        $('#resMeses').textContent = v.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: v < 10 ? 1 : 0 });
        $('#resUnidade').textContent = v < 1.05 ? 'mês' : 'meses';
      };
      (function step(now) {
        const p = reduced ? 1 : clamp((now - t) / 500, 0, 1);
        shownMeses = lerp(from, meses, 1 - Math.pow(1 - p, 3));
        draw(shownMeses);
        if (p < 1) anim = requestAnimationFrame(step);
      })(t);

      if (wave && !reduced) { refisBox.classList.remove('wave'); void refisBox.offsetWidth; refisBox.classList.add('wave'); }
    }
    let debounce;
    [inS, inU].forEach((el) => el.addEventListener('input', () => {
      update(false);
      clearTimeout(debounce);
      debounce = setTimeout(() => update(true), 160);
    }));
    update(false);
  })();

  /* ------------------------------------------------------------------
     GALERIA COM LUPA
     ------------------------------------------------------------------ */
  (function gallery() {
    const wrap = $('#lensWrap');
    const img = $('#galleryMain');
    const lens = $('#lens');
    if (!wrap) return;
    const ZOOM = 2.6;

    $$('.thumb').forEach((t) => t.addEventListener('click', () => {
      if (t.classList.contains('is-active')) return;
      $$('.thumb').forEach((x) => x.classList.toggle('is-active', x === t));
      img.classList.add('is-swapping');
      setTimeout(() => {
        img.src = t.dataset.src;
        img.alt = t.dataset.alt || '';
        img.onload = () => img.classList.remove('is-swapping');
      }, 250);
    }));

    if (!fine) return;
    function shownRect() {
      const r = wrap.getBoundingClientRect();
      const ir = img.naturalWidth / img.naturalHeight || 1;
      const br = r.width / r.height;
      const w = ir > br ? r.width : r.height * ir;
      const h = ir > br ? r.width / ir : r.height;
      return { r, w, h, ox: (r.width - w) / 2, oy: (r.height - h) / 2 };
    }
    wrap.addEventListener('pointerenter', () => wrap.classList.add('is-zooming'));
    wrap.addEventListener('pointerleave', () => wrap.classList.remove('is-zooming'));
    wrap.addEventListener('pointermove', (e) => {
      const s = shownRect();
      const x = e.clientX - s.r.left;
      const y = e.clientY - s.r.top;
      const ix = clamp(x - s.ox, 0, s.w);
      const iy = clamp(y - s.oy, 0, s.h);
      const L = lens.offsetWidth / 2;
      lens.style.left = `${x - L}px`;
      lens.style.top = `${y - L}px`;
      lens.style.backgroundImage = `url("${img.currentSrc || img.src}")`;
      lens.style.backgroundSize = `${s.w * ZOOM}px ${s.h * ZOOM}px`;
      lens.style.backgroundPosition = `${-(ix * ZOOM - L)}px ${-(iy * ZOOM - L)}px`;
    });
  })();

  /* ------------------------------------------------------------------
     DÚVIDAS: abrir e fechar com animação, uma de cada vez
     ------------------------------------------------------------------ */
  $$('.qa').forEach((d) => {
    const sum = $('summary', d);
    const body = $('.qa__body', d);
    sum.addEventListener('click', (e) => {
      if (reduced) return;
      e.preventDefault();
      if (d.open) {
        const h = body.scrollHeight;
        body.animate([{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 380, easing: 'cubic-bezier(.7,0,.2,1)' })
          .onfinish = () => { d.open = false; };
      } else {
        $$('.qa[open]').forEach((o) => o !== d && $('summary', o).click());
        d.open = true;
        const h = body.scrollHeight;
        body.animate([{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' });
      }
    });
  });
})();
