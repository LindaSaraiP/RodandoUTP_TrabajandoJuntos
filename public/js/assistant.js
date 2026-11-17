'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const els = {
    shell: $('#assistantShell'), toggle: $('#assistantToggle'), panel: $('#assistantPanel'), close: $('#assistantClose'),
    messages: $('#assistantMessages'), form: $('#assistantForm'), input: $('#assistantInput'),
    location: $('#assistantLocation'), locationState: $('#assistantLocationState')
  };
  if (!els.shell) return;

  const state = { location: null, busy: false };

  function setOpen(open) {
    els.panel.hidden = !open;
    els.toggle.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => els.input.focus(), 50);
  }

  function message(text, type = 'bot') {
    const node = document.createElement('div');
    node.className = `assistant-message ${type}`;
    node.textContent = text;
    els.messages.append(node);
    els.messages.scrollTop = els.messages.scrollHeight;
    return node;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Horario por confirmar' : new Intl.DateTimeFormat('es-MX', {
      weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function money(value) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function actionButton(label, className, handler) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `pill-btn ${className} mini`; button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function renderRecommendations(payload) {
    message(payload.answer || 'Consulta completada.');
    if (payload.missing?.length) {
      message(`Para afinar el resultado puedes indicar: ${payload.missing.join(' y ')}.`, 'bot');
    }
    for (const item of payload.recommendations || []) {
      const card = document.createElement('article'); card.className = 'assistant-result';
      const header = document.createElement('header');
      const title = document.createElement('h4'); title.textContent = item.driver?.name || 'Conductor';
      const score = document.createElement('strong'); score.textContent = `${item.seatsAvailable} lugar${item.seatsAvailable === 1 ? '' : 'es'}`;
      header.append(title, score);

      const route = document.createElement('p');
      route.textContent = `${item.origin} → ${item.destination} · ${formatDate(item.departureAt)}`;
      const detail = document.createElement('p');
      detail.textContent = `${item.distanceKm == null ? 'Distancia no calculable' : `${item.distanceKm} km aprox.`} · ${money(item.contribution)} por lugar`;
      const reasons = document.createElement('ul');
      for (const reason of item.reasons || []) {
        const li = document.createElement('li'); li.textContent = reason; reasons.append(li);
      }
      const actions = document.createElement('div'); actions.className = 'actions-row';
      actions.append(
        actionButton('Ver en viajes', 'outline', () => {
          setOpen(false);
          document.dispatchEvent(new CustomEvent('rodando:show-ride', { detail: { rideId: Number(item.rideId) } }));
        }),
        actionButton('Reservar', 'solid', () => {
          document.dispatchEvent(new CustomEvent('rodando:reserve-ride', { detail: { rideId: Number(item.rideId) } }));
          setOpen(false);
        })
      );
      card.append(header, route, detail, reasons, actions);
      els.messages.append(card);
    }
    const note = document.createElement('div'); note.className = 'assistant-message bot';
    note.textContent = payload.parser?.startsWith('groq')
      ? 'Groq interpretó el texto; la selección y disponibilidad se calcularon con PostgreSQL y reglas locales.'
      : 'Resultado calculado con reglas deterministas y viajes reales de PostgreSQL.';
    els.messages.append(note);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  async function submit(query) {
    if (state.busy) return;
    state.busy = true;
    const loading = message('Consultando viajes y asientos reales…', 'bot loading');
    try {
      const response = await fetch('/api/recommendations', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query, ...(state.location || {}) })
      });
      let payload = {};
      try { payload = await response.json(); } catch {}
      if (!response.ok) throw new Error(payload.error || 'No se pudo consultar el asistente.');
      loading.remove();
      renderRecommendations(payload);
    } catch (error) {
      loading.classList.remove('loading');
      loading.textContent = navigator.onLine ? error.message : 'El asistente necesita conexión para consultar viajes reales.';
    } finally { state.busy = false; }
  }

  els.toggle.addEventListener('click', () => setOpen(els.panel.hidden));
  els.close.addEventListener('click', () => setOpen(false));
  els.form.addEventListener('submit', event => {
    event.preventDefault();
    const query = els.input.value.trim();
    if (!query) return;
    message(query, 'user'); els.input.value = ''; submit(query);
  });
  els.location.addEventListener('click', () => {
    if (!navigator.geolocation) { els.locationState.textContent = 'Geolocalización no disponible.'; return; }
    els.location.disabled = true; els.locationState.textContent = 'Solicitando permiso…';
    navigator.geolocation.getCurrentPosition(position => {
      state.location = { lat: position.coords.latitude, lng: position.coords.longitude };
      els.locationState.textContent = `Ubicación lista (precisión ${Math.round(position.coords.accuracy)} m).`;
      els.location.textContent = 'Actualizar ubicación'; els.location.disabled = false;
    }, error => {
      state.location = null;
      els.locationState.textContent = error.code === 1 ? 'Permiso rechazado; escribe tu zona.' : 'No se pudo obtener la ubicación.';
      els.location.disabled = false;
    }, { enableHighAccuracy: false, maximumAge: 120000, timeout: 10000 });
  });
  window.addEventListener('offline', () => message('Estás sin conexión. Puedes leer este chat, pero no consultar disponibilidad.', 'bot'));
})();
