'use strict';
// Recorrido de punta a punta del seguimiento en vivo contra un servidor de PRUEBA con los usuarios demo
// de scripts/seed-demo.js. Publica un viaje temporal, lo recorre y lo finaliza.
// uso: TEST_BASE_URL=http://localhost:3000 node scripts/demo-seguimiento.js
require('dotenv').config();
const WebSocket = require('ws');
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const PASS = 'DemoEco2026';
const UTP = [19.0583869, -98.1545312];
const PICKUP = [19.0631, -98.2306];        // Paradero San Pedro Cholula (aprox.)
const ORIGIN = [19.0690, -98.3030];        // San Pedro Cholula
let paso = 0;
const ok = (msg, extra = '') => console.log(`PASO ${String(++paso).padStart(2, '0')}  OK   ${msg}${extra ? ' — ' + extra : ''}`);
const falla = (msg) => { console.log(`PASO ${String(++paso).padStart(2, '0')}  FALLA ${msg}`); process.exitCode = 1; };
const check = (cond, msg, extra) => cond ? ok(msg, extra) : falla(msg + (extra ? ' — ' + extra : ''));

function cliente() {
  let cookie = '', csrf = '';
  const api = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const h = { ...headers, ...(cookie ? { cookie } : {}) };
    if (body) h['content-type'] = 'application/json';
    if (method !== 'GET' && csrf) h['x-csrf-token'] = csrf;
    const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) if (c.startsWith('rodando_session=')) cookie = c.split(';')[0];
    let data = {}; try { data = await res.json(); } catch {}
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: res.status, data };
  };
  return {
    api, get cookie() { return cookie; },
    async login(email) { await api('/api/session'); const r = await api('/api/login', { method: 'POST', body: { email, password: PASS } }); return r; }
  };
}
const punto = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

(async () => {
  const conductor = cliente(), pasajera = cliente(), nueva = cliente(), ajeno = cliente();
  const logins = await Promise.all([
    conductor.login('luis.ortega@alumno.utpuebla.edu.mx'), pasajera.login('carlos.medina@alumno.utpuebla.edu.mx'),
    nueva.login('valeria.cruz@alumno.utpuebla.edu.mx'), ajeno.login('sofia.torres@alumno.utpuebla.edu.mx')]);
  check(logins.every(r => r.status === 200), 'Inician sesión conductor, pasajera, estudiante nueva y usuario ajeno');

  const salida = new Date(Date.now() + 45000).toISOString();
  const pub = await conductor.api('/api/rides', { method: 'POST', body: {
    origin: 'San Pedro Cholula', pickupPoint: 'Paradero San Pedro Cholula', direction: 'to_utp',
    departureAt: salida, seatsTotal: 3, contribution: 30, vehicle: 'Nissan Versa', color: 'Gris', plateFull: 'TXA1234',
    routeType: 'direct', notes: 'Viaje de demostración del seguimiento en vivo',
    originLat: ORIGIN[0], originLng: ORIGIN[1], pickupLat: PICKUP[0], pickupLng: PICKUP[1], destinationLat: UTP[0], destinationLng: UTP[1] } });
  const rideId = pub.data.ride?.id || pub.data.id;
  check(pub.status === 201 && rideId, 'El conductor publica un viaje con origen, punto de encuentro y destino en el mapa', `viaje ${rideId}`);

  const res1 = await pasajera.api(`/api/rides/${rideId}/reserve`, { method: 'POST', body: { seats: 1 } });
  check([200, 201].includes(res1.status), 'La pasajera reserva un lugar', `HTTP ${res1.status} ${res1.data.error || ''}`);

  let st = await pasajera.api(`/api/live/rides/${rideId}`);
  check(st.data.live?.status === 'programado' && st.data.position === null, 'Antes de iniciar: viaje programado y sin posición', st.data.live?.status);

  const ini = await conductor.api(`/api/live/rides/${rideId}/start`, { method: 'POST', body: {} });
  check(ini.status === 201, 'El conductor inicia y comparte su GPS (consentimiento registrado)', ini.data.trip?.status);

  // WebSocket de la pasajera
  const mensajes = [];
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/api/live/ws', { headers: { cookie: pasajera.cookie, origin: BASE } });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  ws.on('message', m => mensajes.push(JSON.parse(m)));
  ws.send(JSON.stringify({ type: 'subscribe', rideId }));
  await new Promise(r => setTimeout(r, 600));
  check(mensajes.some(m => m.type === 'live-state'), 'La pasajera se conecta al WebSocket con su sesión y recibe el estado');

  const colores = [];
  for (const [t, speed] of [[0, 9], [0.55, 9], [0.8, 9], [0.93, 9], [0.985, 9]]) {
    const [lat, lng] = punto(ORIGIN, PICKUP, t);
    const r = await conductor.api(`/api/live/rides/${rideId}/location`, { method: 'POST', body: { lat, lng, accuracy: 12, speed, heading: 90 } });
    colores.push(`${r.data.estimate?.etaMinutes} min ${r.data.estimate?.proximity?.code}`);
    await new Promise(x => setTimeout(x, 300));
  }
  check(colores.length === 5 && colores[0].includes('green') && colores.at(-1).includes('red'),
    'El auto se acerca y el color cambia de verde a rojo', colores.join(' → '));
  check(mensajes.filter(m => m.type === 'live-state').length >= 5, 'Cada posición llega a la pasajera por WebSocket', `${mensajes.length} mensajes`);

  st = await pasajera.api(`/api/live/rides/${rideId}`);
  check(st.data.position && st.data.estimate?.etaMinutes != null, 'La pasajera ve la posición y la llegada estimada', `${st.data.estimate.distanceKm} km, ${st.data.estimate.etaMinutes} min`);
  const otro = await ajeno.api(`/api/live/rides/${rideId}`);
  check(otro.status === 200 && otro.data.position === null, 'Un usuario sin reserva no ve la posición del auto');

  const avisos = (await pasajera.api('/api/notifications')).data;
  const lista = avisos.notifications || avisos.items || avisos;
  const cerca = (Array.isArray(lista) ? lista : []).filter(n => /cerca/i.test(n.title || ''));
  check(cerca.length >= 1, 'La pasajera recibe los avisos de cercanía (uno por color)', cerca.map(n => n.body).join(' | '));

  const sol = await nueva.api(`/api/live/rides/${rideId}/requests`, { method: 'POST', body: { seats: 1, pickupLabel: 'Paradero San Pedro Cholula' } });
  check(sol.status === 201, 'Otra estudiante pide lugar mientras el conductor va en camino', `solicitud ${sol.data.request?.id}`);
  const pend = await conductor.api(`/api/live/rides/${rideId}/requests`);
  const req = (pend.data.requests || []).find(x => x.status === 'pending');
  const acep = await conductor.api(`/api/live/requests/${req?.id}`, { method: 'PATCH', body: { action: 'accept' } });
  check(acep.status === 200, 'El conductor acepta la solicitud y se crea la reserva real');
  st = await nueva.api(`/api/live/rides/${rideId}`);
  check(st.data.permissions?.canViewLocation === true, 'La estudiante aceptada ya puede ver el auto');

  const dev = await conductor.api(`/api/live/rides/${rideId}/device`, { method: 'POST', body: { label: 'Rastreador GPS IoT' } });
  check(dev.status === 201 && dev.data.token, 'El conductor conecta un dispositivo IoT y recibe su token una sola vez');
  const [ilat, ilng] = punto(ORIGIN, PICKUP, 0.99);
  const iot = await fetch(BASE + '/api/live/iot/location', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Device ${dev.data.token}` },
    body: JSON.stringify({ lat: ilat, lng: ilng, accuracy: 8, speed: 7 }) });
  check(iot.status === 200, 'El dispositivo IoT envía su posición a la nube sin sesión de navegador', `HTTP ${iot.status}`);
  const malo = await fetch(BASE + '/api/live/iot/location', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Device token-falso-1234567890' }, body: JSON.stringify({ lat: 19, lng: -98, accuracy: 5 }) });
  check(malo.status === 401, 'Un token IoT falso es rechazado', `HTTP ${malo.status}`);

  const lle = await pasajera.api(`/api/live/rides/${rideId}/arrived`, { method: 'POST', body: {} });
  check(lle.status === 200 && lle.data.alreadyNotified === false, 'La pasajera avisa «ya te espero»');
  const lle2 = await pasajera.api(`/api/live/rides/${rideId}/arrived`, { method: 'POST', body: {} });
  check(lle2.data.alreadyNotified === true, 'El aviso no se duplica si lo pulsa otra vez');
  const avC = (await conductor.api('/api/notifications')).data;
  const listaC = avC.notifications || avC.items || avC;
  check((Array.isArray(listaC) ? listaC : []).some(n => /ya te espera/i.test(n.title || '')), 'El conductor recibe «Tu pasajero ya te espera»');

  const espera = new Date(salida).getTime() - Date.now() + 2000;
  if (espera > 0) { console.log(`        (esperando ${Math.ceil(espera / 1000)} s a que pase la hora de salida para poder finalizar)`); await new Promise(x => setTimeout(x, espera)); }
  const fin = await conductor.api(`/api/live/rides/${rideId}/finish`, { method: 'POST', body: {} });
  st = await pasajera.api(`/api/live/rides/${rideId}`);
  check(fin.status === 200 && st.data.position === null, 'Al finalizar se borra la posición', st.data.live?.status);
  const iot2 = await fetch(BASE + '/api/live/iot/location', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Device ${dev.data.token}` }, body: JSON.stringify({ lat: ilat, lng: ilng, accuracy: 8 }) });
  check(iot2.status === 401, 'Después de finalizar, el token del dispositivo ya no sirve', `HTTP ${iot2.status}`);
  ws.close();
  console.log(`\nRESULTADO: ${paso} pasos, ${process.exitCode ? 'con fallas' : 'todos correctos'}. Viaje de prueba: ${rideId}`);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
