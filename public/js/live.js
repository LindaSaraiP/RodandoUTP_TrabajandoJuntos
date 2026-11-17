'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const shared = window.RodandoLiveMap;
  const els = {
    section: $('#seguimiento'), select: $('#liveRideSelect'), refresh: $('#liveRefresh'), connection: $('#liveConnectionState'),
    map: $('#liveMap'), legend: $('#liveMapLegend'), proximity: $('#liveProximity'), privacy: $('#livePrivacy'), status: $('#liveTripStatus'),
    title: $('#liveTripTitle'), meta: $('#liveTripMeta'), eta: $('#liveEta'), distance: $('#liveDistance'), seats: $('#liveSeats'),
    arrived: $('#liveArrived'), arrivedStatus: $('#liveArrivedStatus'),
    driver: $('#liveDriverControls'), start: $('#liveStart'), collecting: $('#liveCollecting'), onRoute: $('#liveOnRoute'), finish: $('#liveFinish'),
    deviceButton: $('#liveDeviceButton'), devicePanel: $('#liveDevicePanel'), deviceToken: $('#liveDeviceToken'),
    deviceCommand: $('#liveDeviceCommand'), deviceRevoke: $('#liveDeviceRevoke'),
    gps: $('#liveGpsStatus'), requests: $('#liveRequests'), requestCard: $('#liveSeatRequest'), requestForm: $('#liveRequestForm')
  };
  if (!els.section || !shared) return;

  const state = {
    user: null, csrf: '', rideId: null, current: null, map: null, vehicle: null, pickup: null, destination: null,
    route: null, proximityLine: null, proximityCircle: null,
    socket: null, poll: null, watchId: null, lastSentAt: 0, deviceId: null
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { ...(options.headers || {}) };
    let body = options.body;
    if (body && typeof body !== 'string') { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    if (!['GET', 'HEAD'].includes(method) && state.csrf) headers['X-CSRF-Token'] = state.csrf;
    const response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
    return data;
  }

  function setConnection(label, connected = false) {
    els.connection.textContent = label;
    els.connection.dataset.live = connected ? 'connected' : 'idle';
  }

  function ensureMap() {
    if (state.map || !window.L) return state.map;
    state.map = window.L.map(els.map, { scrollWheelZoom: true }).setView([19.0583869, -98.1545312], 12);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap'
    }).addTo(state.map);
    return state.map;
  }

  function renderLegend() {
    els.legend.innerHTML = '';
    shared.PROXIMITY_LEGEND.forEach(item => {
      const entry = document.createElement('li');
      entry.className = item.color;
      const swatch = document.createElement('i');
      swatch.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = item.label;
      entry.append(swatch, text);
      els.legend.append(entry);
    });
  }

  function proximityColor(data) {
    const styles = getComputedStyle(els.section);
    const variables = {};
    Object.values(shared.COLOR_VARIABLES).forEach(name => { variables[name] = styles.getPropertyValue(name); });
    return shared.resolveColor(data?.estimate?.proximity?.color, variables);
  }

  function markerFor(kind, coords, label, color) {
    if (!coords || coords.some(value => value == null)) return null;
    if (kind === 'vehicle') {
      return window.L.marker(coords, { icon: window.L.divIcon({
        className: '', html: `<span class="live-vehicle-marker" style="background:${color}">●</span>`, iconSize: [38, 38], iconAnchor: [19, 19]
      }) }).bindPopup(label);
    }
    return window.L.marker(coords).bindPopup(label);
  }

  function updateMap(data) {
    const map = ensureMap();
    if (!map) return;
    state.vehicle?.remove(); state.pickup?.remove(); state.destination?.remove();
    state.route?.remove(); state.proximityLine?.remove(); state.proximityCircle?.remove();
    const color = proximityColor(data);
    const route = shared.routePoints(data);
    const points = [...route];
    if (route.length > 1) {
      state.route = window.L.polyline(route, { color: '#1e7b46', weight: 4, opacity: .7, dashArray: '8 8' }).addTo(map);
    }
    let pickupCoords = null;
    if (data.ride.pickupLat != null && data.ride.pickupLng != null) {
      pickupCoords = [data.ride.pickupLat, data.ride.pickupLng];
      state.pickup = markerFor('pickup', pickupCoords, `Punto de encuentro: ${escapeHtml(data.ride.pickupPoint)}`)?.addTo(map);
    }
    if (data.ride.destinationLat != null && data.ride.destinationLng != null) {
      const coords = [data.ride.destinationLat, data.ride.destinationLng];
      state.destination = markerFor('destination', coords, escapeHtml(data.ride.destination))?.addTo(map);
    }
    if (data.position) {
      const coords = [data.position.lat, data.position.lng];
      const label = `Automóvil · ${escapeHtml(data.estimate?.proximity?.label || 'Sin estimación')}`;
      state.vehicle = markerFor('vehicle', coords, label, color)?.addTo(map);
      points.push(coords);
      if (pickupCoords) {
        state.proximityLine = window.L.polyline([coords, pickupCoords], { color, weight: 5, opacity: .9 }).addTo(map);
        const radius = Math.max(150, Math.min(1200, Number(data.estimate?.distanceKm || 0) * 1000));
        state.proximityCircle = window.L.circle(pickupCoords, {
          radius, color, fillColor: color, fillOpacity: .12, weight: 2
        }).addTo(map);
      }
    }
    els.map.setAttribute('aria-label', `Mapa de seguimiento. Cercanía: ${data.estimate?.proximity?.label || 'sin estimación'}. ${escapeHtml(data.ride.pickupPoint || '')}`);
    if (points.length > 1) map.fitBounds(points, { padding: [35, 35], maxZoom: 16 });
    else if (points.length === 1) map.setView(points[0], 15);
    else map.setView([19.0583869, -98.1545312], 12);
    setTimeout(() => map.invalidateSize(), 80);
  }

  function render(data) {
    state.current = data;
    if (data.permissions.isDriver && !data.live.sharing && state.watchId != null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    els.status.textContent = data.live.status.replaceAll('_', ' ');
    els.title.textContent = `${data.ride.origin} → ${data.ride.destination}`;
    els.meta.textContent = `${new Date(data.ride.departureAt).toLocaleString('es-MX')} · Con ${data.ride.driver.name}`;
    els.eta.textContent = data.estimate.etaMinutes ?? '—';
    els.distance.textContent = data.estimate.distanceKm ?? '—';
    els.seats.textContent = data.ride.seatsAvailable;
    els.arrived.hidden = !data.permissions.canMarkArrived;
    els.arrivedStatus.hidden = !data.permissions.canMarkArrived;
    if (data.permissions.canMarkArrived) {
      const notified = Boolean(data.live.arrivedNotified);
      els.arrived.disabled = notified;
      els.arrived.textContent = notified ? 'Aviso enviado' : 'Ya te espero';
      els.arrivedStatus.textContent = notified
        ? 'El conductor ya recibió tu aviso.'
        : 'Avisa al conductor cuando estés en el punto de encuentro.';
    }
    const proximity = data.estimate.proximity || { color: 'unknown', label: 'Sin estimación' };
    els.proximity.className = `live-proximity ${proximity.color || 'unknown'}`;
    els.proximity.querySelector('strong').textContent = proximity.label;
    els.proximity.querySelector('small').textContent = data.estimate.etaMinutes == null
      ? (data.permissions.canViewLocation ? 'Esperando una posición GPS reciente.' : 'La ubicación solo se muestra a participantes confirmados.')
      : `Llegada estimada en ${data.estimate.etaMinutes} min · cálculo aproximado.`;
    els.driver.hidden = !data.permissions.isDriver;
    els.requestCard.hidden = !data.permissions.canRequestSeat;
    els.start.textContent = data.live.sharing ? 'GPS activo' : 'Iniciar y compartir GPS';
    els.start.disabled = data.live.sharing && state.watchId != null;
    els.privacy.textContent = data.permissions.canViewLocation
      ? 'Ubicación autorizada para esta sesión. Se descarta si tiene más de 90 segundos.'
      : 'La ruta es visible, pero la posición exacta está protegida hasta confirmar la reserva.';
    if (els.requestCard.hidden === false) els.requestForm.elements.pickupLabel.value ||= data.ride.pickupPoint;
    updateMap(data);
    if (data.permissions.isDriver) loadRequests().catch(error => { els.requests.textContent = error.message; });
    if (data.permissions.canViewLocation) connectSocket(); else closeSocket();
    setConnection(data.live.fresh ? 'GPS actualizado' : data.live.sharing ? 'Esperando GPS' : 'Seguimiento inactivo', data.live.sharing);
  }

  async function refresh() {
    if (!state.rideId || !state.user) return;
    try { render(await api(`/api/live/rides/${state.rideId}`)); }
    catch (error) { setConnection(error.message); }
  }

  function addOption(ride, label) {
    if (!ride || els.select.querySelector(`option[value="${ride.id}"]`)) return;
    const option = document.createElement('option');
    option.value = ride.id;
    option.textContent = `${label}: ${ride.origin} → ${ride.destination}`;
    els.select.append(option);
  }

  async function loadOptions() {
    els.select.innerHTML = '<option value="">Selecciona uno de tus viajes</option>';
    if (!state.user) return;
    const data = await api('/api/dashboard');
    data.published.filter(ride => ride.status === 'active').forEach(ride => addOption(ride, 'Conduces'));
    data.reservations.filter(entry => entry.reservationStatus === 'confirmed' && entry.ride?.status === 'active')
      .forEach(entry => addOption(entry.ride, 'Reservaste'));
    if (state.rideId) els.select.value = String(state.rideId);
  }

  async function openRide(rideId, scroll = true) {
    if (!state.user) { setConnection('Inicia sesión para usar el seguimiento'); return; }
    const nextRideId = Number(rideId);
    if (state.rideId && state.rideId !== nextRideId && state.watchId != null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
      els.gps.textContent = 'GPS detenido al cambiar de viaje.';
    }
    state.rideId = nextRideId;
    hideDevicePanel();
    if (!els.select.querySelector(`option[value="${state.rideId}"]`)) {
      const option = document.createElement('option'); option.value = state.rideId; option.textContent = `Viaje ${state.rideId}`; els.select.append(option);
    }
    els.select.value = String(state.rideId);
    if (scroll) els.section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await refresh();
    clearInterval(state.poll);
    state.poll = setInterval(refresh, 15_000);
  }

  function closeSocket() {
    if (state.socket) { state.socket.onclose = null; state.socket.close(); }
    state.socket = null;
  }

  function connectSocket() {
    if (!state.rideId || state.socket?.readyState === WebSocket.OPEN || state.socket?.readyState === WebSocket.CONNECTING) return;
    closeSocket();
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/api/live/ws`);
    state.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'subscribe', rideId: state.rideId }));
      setConnection('Tiempo real conectado', true);
    };
    socket.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'live-state') render(message.data);
        else if (message.type === 'error') setConnection(message.message);
      } catch {}
    };
    socket.onclose = () => { if (state.socket === socket) state.socket = null; setConnection('Actualización periódica activa'); };
    socket.onerror = () => socket.close();
  }

  async function sendPosition(position) {
    if (!state.rideId || Date.now() - state.lastSentAt < 4000) return;
    state.lastSentAt = Date.now();
    if (position.coords.accuracy > 100) {
      els.gps.textContent = `Precisión insuficiente (${Math.round(position.coords.accuracy)} m). Esperando una lectura mejor.`;
      return;
    }
    try {
      await api(`/api/live/rides/${state.rideId}/location`, { method: 'POST', body: {
        lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy,
        speed: position.coords.speed, heading: position.coords.heading
      } });
      els.gps.textContent = `GPS enviado · precisión ${Math.round(position.coords.accuracy)} m`;
    } catch (error) { els.gps.textContent = error.message; }
  }

  async function startGps() {
    if (!navigator.geolocation) { els.gps.textContent = 'Este navegador no ofrece geolocalización.'; return; }
    try {
      await api(`/api/live/rides/${state.rideId}/start`, { method: 'POST', body: {} });
      if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
      state.watchId = navigator.geolocation.watchPosition(sendPosition, error => {
        els.gps.textContent = error.code === 1 ? 'Permiso de ubicación rechazado.' : 'No se pudo leer el GPS.';
      }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
      els.gps.textContent = 'Seguimiento iniciado. Mantén esta pantalla abierta.';
      await refresh();
    } catch (error) { els.gps.textContent = error.message; }
  }

  async function changeState(status) {
    try { await api(`/api/live/rides/${state.rideId}/state`, { method: 'POST', body: { status } }); await refresh(); }
    catch (error) { els.gps.textContent = error.message; }
  }

  function hideDevicePanel() {
    state.deviceId = null;
    els.devicePanel.hidden = true;
    els.deviceToken.textContent = '';
    els.deviceCommand.textContent = '';
  }

  async function connectDevice() {
    try {
      const data = await api(`/api/live/rides/${state.rideId}/device`, { method: 'POST', body: { label: 'Dispositivo IoT' } });
      state.deviceId = data.device.id;
      els.deviceToken.textContent = data.token;
      els.deviceCommand.textContent = `node scripts/simular-dispositivo-iot.js ${location.origin}/api/live/iot/location ${data.token} 19.0583869,-98.1545312 19.0640000,-98.1700000`;
      els.devicePanel.hidden = false;
      els.gps.textContent = 'Dispositivo registrado. El token solo aparece una vez.';
    } catch (error) { els.gps.textContent = error.message; }
  }

  async function revokeDevice() {
    try {
      await api(`/api/live/rides/${state.rideId}/device`, { method: 'DELETE', body: { deviceId: state.deviceId } });
      hideDevicePanel();
      els.gps.textContent = 'Dispositivo revocado.';
    } catch (error) { els.gps.textContent = error.message; }
  }

  async function markArrived() {
    els.arrived.disabled = true;
    try {
      await api(`/api/live/rides/${state.rideId}/arrived`, { method: 'POST', body: {} });
      els.arrivedStatus.textContent = 'El conductor ya recibió tu aviso.';
      els.arrived.textContent = 'Aviso enviado';
    } catch (error) {
      els.arrivedStatus.textContent = error.message;
      els.arrived.disabled = false;
    }
  }

  async function finish() {
    if (!confirm('¿Finalizar el viaje? Se detendrá la ubicación y se calcularán los EcoPuntos.')) return;
    try {
      await api(`/api/live/rides/${state.rideId}/finish`, { method: 'POST', body: {} });
      if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
      hideDevicePanel();
      await refresh(); await loadOptions();
    } catch (error) { els.gps.textContent = error.message; }
  }

  async function loadRequests() {
    if (!state.current?.permissions.isDriver) return;
    const data = await api(`/api/live/rides/${state.rideId}/requests`);
    const pending = data.requests.filter(request => request.status === 'pending');
    els.requests.innerHTML = pending.length ? '<h4>Solicitudes pendientes</h4>' : '<p class="helper small">No hay solicitudes pendientes.</p>';
    pending.forEach(request => {
      const item = document.createElement('div'); item.className = 'live-request-item';
      item.innerHTML = `<header><strong>${escapeHtml(request.passenger.name)}</strong><span>${request.seats} lugar(es)</span></header>
        <p>${escapeHtml(request.pickupLabel)} · ${escapeHtml(request.passenger.career)}</p><div class="actions-row"></div>`;
      for (const [action, label, className] of [['accept', 'Aceptar', 'solid'], ['reject', 'Rechazar', 'outline']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = `pill-btn ${className} mini`; button.textContent = label;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try { await api(`/api/live/requests/${request.id}`, { method: 'PATCH', body: { action } }); await loadRequests(); await refresh(); }
          catch (error) { els.gps.textContent = error.message; button.disabled = false; }
        });
        item.querySelector('.actions-row').append(button);
      }
      els.requests.append(item);
    });
  }

  els.select.addEventListener('change', () => { if (els.select.value) openRide(els.select.value, false); });
  els.refresh.addEventListener('click', refresh);
  els.start.addEventListener('click', startGps);
  els.collecting.addEventListener('click', () => changeState('recogiendo'));
  els.onRoute.addEventListener('click', () => changeState('en_ruta'));
  els.finish.addEventListener('click', finish);
  els.deviceButton.addEventListener('click', connectDevice);
  els.deviceRevoke.addEventListener('click', revokeDevice);
  els.arrived.addEventListener('click', markArrived);
  els.requestForm.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(els.requestForm);
    try {
      await api(`/api/live/rides/${state.rideId}/requests`, { method: 'POST', body: {
        seats: Number(form.get('seats')), pickupLabel: form.get('pickupLabel')
      } });
      els.requestCard.innerHTML = '<h3>Solicitud enviada</h3><p class="helper">Espera la respuesta del conductor. La ubicación aparecerá solo si acepta.</p>';
    } catch (error) { els.requestCard.querySelector('.helper').textContent = error.message; }
  });
  renderLegend();
  document.addEventListener('rodando:live:open', event => openRide(event.detail?.rideId));
  window.addEventListener('beforeunload', () => {
    if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
    closeSocket();
  });
  window.addEventListener('offline', () => setConnection('Sin conexión · GPS pausado'));

  async function setSession(detail) {
    const nextUser = detail?.user || null;
    if (Number(state.user?.id || 0) !== Number(nextUser?.id || 0) && state.watchId != null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    state.user = nextUser; state.csrf = detail?.csrfToken || '';
    closeSocket(); clearInterval(state.poll); hideDevicePanel();
    if (!state.user) {
      els.select.innerHTML = '<option value="">Inicia sesión para ver tus viajes</option>';
      els.arrived.hidden = true; els.arrivedStatus.hidden = true;
      setConnection('Sesión requerida');
      return;
    }
    await loadOptions().catch(() => {});
    const hashRide = Number((location.hash.match(/ride=(\d+)/) || [])[1]);
    if (hashRide) openRide(hashRide, false);
  }
  window.addEventListener('rodando:session', event => setSession(event.detail));
  api('/api/session').then(data => setSession({ user: data.user, csrfToken: data.csrfToken })).catch(() => {});
})();
