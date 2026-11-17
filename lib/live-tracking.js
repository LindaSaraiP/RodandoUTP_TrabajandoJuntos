'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const { haversineKm } = require('./recommendations');

const ACTIVE_STATES = new Set(['en_camino', 'recogiendo', 'en_ruta']);
const POSITION_MAX_AGE_MS = 90_000;

function numberInRange(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function integerInRange(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function proximityFromEta(etaMinutes) {
  if (etaMinutes == null) return { code: 'unknown', label: 'Sin estimación', color: 'gray' };
  if (etaMinutes <= 2) return { code: 'red', label: 'Muy próximo', color: 'red' };
  if (etaMinutes <= 5) return { code: 'orange', label: 'Cercano', color: 'orange' };
  if (etaMinutes <= 10) return { code: 'yellow', label: 'Aproximándose', color: 'yellow' };
  return { code: 'green', label: 'Lejano', color: 'green' };
}

function estimateArrival(ride, trip) {
  if (trip?.lat == null || trip?.lng == null || ride.pickup_lat == null || ride.pickup_lng == null) {
    return { distanceKm: null, etaMinutes: null, proximity: proximityFromEta(null) };
  }
  const distanceKm = haversineKm(trip.lat, trip.lng, ride.pickup_lat, ride.pickup_lng);
  const speedKmh = trip.speed_ms >= 1.4 && trip.speed_ms <= 38 ? trip.speed_ms * 3.6 : 25;
  const etaMinutes = Math.max(1, Math.ceil((distanceKm / speedKmh) * 60 * 1.15));
  return {
    distanceKm: Number(distanceKm.toFixed(2)), etaMinutes,
    proximity: proximityFromEta(etaMinutes)
  };
}

function createLiveTracking({ pool, readBody, json, requireAuth, requireCsrf, rateLimit, pushService, completeRide }) {
  const sockets = new Set();

  async function rideById(rideId, db = pool) {
    const { rows } = await db.query(`SELECT r.*, u.name AS driver_name, u.verified AS driver_verified,
      COALESCE((SELECT SUM(seats) FROM reservations rs WHERE rs.ride_id=r.id AND rs.status='confirmed'),0)::int AS seats_confirmed
      FROM rides r JOIN users u ON u.id=r.driver_id WHERE r.id=$1`, [rideId]);
    return rows[0] || null;
  }

  async function liveTrip(rideId, db = pool) {
    return (await db.query('SELECT * FROM live_trips WHERE ride_id=$1', [rideId])).rows[0] || null;
  }

  async function userCanView(rideId, userId, role, db = pool) {
    const ride = await rideById(rideId, db);
    if (!ride) return { allowed: false, ride: null, isDriver: false };
    const isDriver = Number(ride.driver_id) === Number(userId);
    if (isDriver || role === 'admin') return { allowed: true, ride, isDriver };
    const reservation = (await db.query(`SELECT id,seats FROM reservations
      WHERE ride_id=$1 AND passenger_id=$2 AND status='confirmed'`, [rideId, userId])).rows[0];
    return { allowed: !!reservation, ride, isDriver: false, reservation };
  }

  async function getState(user, rideId) {
    const auth = await userCanView(rideId, user.id, user.role);
    if (!auth.ride) throw Object.assign(new Error('Viaje no encontrado.'), { status: 404 });
    const trip = await liveTrip(rideId);
    const ageMs = trip?.updated_at ? Date.now() - new Date(trip.updated_at).getTime() : null;
    const current = Boolean(trip && ACTIVE_STATES.has(trip.status));
    const fresh = current && ageMs != null && ageMs <= POSITION_MAX_AGE_MS;
    const estimate = fresh && auth.allowed ? estimateArrival(auth.ride, trip) : {
      distanceKm: null, etaMinutes: null, proximity: proximityFromEta(null)
    };
    const available = Math.max(0, Number(auth.ride.seats_total) - Number(auth.ride.seats_confirmed || 0));
    const result = {
      ride: {
        id: Number(auth.ride.id), origin: auth.ride.origin, destination: auth.ride.destination,
        pickupPoint: auth.ride.pickup_point, pickupLat: auth.ride.pickup_lat == null ? null : Number(auth.ride.pickup_lat),
        pickupLng: auth.ride.pickup_lng == null ? null : Number(auth.ride.pickup_lng),
        destinationLat: auth.ride.destination_lat == null ? null : Number(auth.ride.destination_lat),
        destinationLng: auth.ride.destination_lng == null ? null : Number(auth.ride.destination_lng),
        departureAt: auth.ride.departure_at, seatsTotal: Number(auth.ride.seats_total), seatsAvailable: available,
        driver: { id: Number(auth.ride.driver_id), name: auth.ride.driver_name, verified: !!auth.ride.driver_verified }
      },
      live: {
        status: trip?.status || 'programado', sharing: current, fresh,
        startedAt: trip?.started_at || null, updatedAt: trip?.updated_at || null,
        endedAt: trip?.ended_at || null, consentAt: trip?.consent_at || null
      },
      permissions: { isDriver: auth.isDriver, canViewLocation: auth.allowed, canRequestSeat: !auth.allowed && available > 0 && current },
      estimate
    };
    if (auth.allowed && fresh) {
      result.position = {
        lat: Number(trip.lat), lng: Number(trip.lng), accuracy: trip.accuracy_m == null ? null : Number(trip.accuracy_m),
        speed: trip.speed_ms == null ? null : Number(trip.speed_ms), heading: trip.heading == null ? null : Number(trip.heading),
        updatedAt: trip.updated_at
      };
    } else result.position = null;
    return result;
  }

  async function assertDriver(user, rideId, db = pool) {
    const ride = await rideById(rideId, db);
    if (!ride) throw Object.assign(new Error('Viaje no encontrado.'), { status: 404 });
    if (Number(ride.driver_id) !== Number(user.id) && user.role !== 'admin') {
      throw Object.assign(new Error('Solo el conductor puede gestionar el seguimiento.'), { status: 403 });
    }
    if (ride.status !== 'active') throw Object.assign(new Error('El viaje no está activo.'), { status: 409 });
    return ride;
  }

  async function notifyProximity(ride, trip) {
    const estimate = estimateArrival(ride, trip);
    if (!['yellow', 'orange', 'red'].includes(estimate.proximity.code)) return;
    const { rows } = await pool.query(`SELECT passenger_id FROM reservations
      WHERE ride_id=$1 AND status='confirmed'`, [ride.id]);
    await Promise.allSettled(rows.map(async ({ passenger_id }) => {
      const inserted = await pool.query(`INSERT INTO live_proximity_notices (ride_id,user_id,proximity_code,sent_at)
        VALUES ($1,$2,$3,NOW()) ON CONFLICT (ride_id,user_id,proximity_code) DO NOTHING RETURNING id`,
      [ride.id, passenger_id, estimate.proximity.code]);
      if (!inserted.rowCount) return;
      await pushService.notifyUser(passenger_id, 'Tu conductor está cerca',
        `${estimate.proximity.label}: llegada estimada en ${estimate.etaMinutes} min.`, `/#seguimiento?ride=${ride.id}`);
    }));
  }

  async function start(user, rideId) {
    const ride = await assertDriver(user, rideId);
    const { rows } = await pool.query(`INSERT INTO live_trips (ride_id,status,started_at,consent_at,updated_at)
      VALUES ($1,'en_camino',NOW(),NOW(),NOW())
      ON CONFLICT (ride_id) DO UPDATE SET status='en_camino', started_at=COALESCE(live_trips.started_at,NOW()),
        consent_at=NOW(), ended_at=NULL, updated_at=NOW() RETURNING *`, [rideId]);
    const passengers = (await pool.query("SELECT passenger_id FROM reservations WHERE ride_id=$1 AND status='confirmed'", [rideId])).rows;
    await Promise.allSettled(passengers.map(p => pushService.notifyUser(p.passenger_id, 'El viaje comenzó',
      `${ride.driver_name} comenzó a compartir su ubicación.`, `/#seguimiento?ride=${rideId}`)));
    await broadcast(rideId);
    return { trip: rows[0] };
  }

  async function updateLocation(user, rideId, body) {
    const ride = await assertDriver(user, rideId);
    const lat = numberInRange(body.lat, -90, 90), lng = numberInRange(body.lng, -180, 180);
    const accuracy = numberInRange(body.accuracy, 0, 100);
    const speed = body.speed == null ? null : numberInRange(body.speed, 0, 60);
    const heading = body.heading == null ? null : numberInRange(body.heading, 0, 360);
    if (lat == null || lng == null) throw Object.assign(new Error('Coordenadas inválidas.'), { status: 400 });
    if (accuracy == null) throw Object.assign(new Error('La precisión GPS debe ser de 100 m o mejor.'), { status: 400 });
    const result = await pool.query(`UPDATE live_trips SET lat=$2,lng=$3,accuracy_m=$4,speed_ms=$5,heading=$6,updated_at=NOW()
      WHERE ride_id=$1 AND status IN ('en_camino','recogiendo','en_ruta') RETURNING *`,
    [rideId, lat, lng, accuracy, speed, heading]);
    if (!result.rowCount) throw Object.assign(new Error('Primero inicia el seguimiento.'), { status: 409 });
    await notifyProximity(ride, result.rows[0]);
    await broadcast(rideId);
    return getState(user, rideId);
  }

  async function changeState(user, rideId, status) {
    await assertDriver(user, rideId);
    if (!ACTIVE_STATES.has(status)) throw Object.assign(new Error('Estado de seguimiento inválido.'), { status: 400 });
    const result = await pool.query(`UPDATE live_trips SET status=$2,updated_at=NOW()
      WHERE ride_id=$1 AND status <> 'finalizado' RETURNING *`, [rideId, status]);
    if (!result.rowCount) throw Object.assign(new Error('Primero inicia el seguimiento.'), { status: 409 });
    await broadcast(rideId);
    return { trip: result.rows[0] };
  }

  async function stopTracking(rideId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE live_trips SET status='finalizado',lat=NULL,lng=NULL,accuracy_m=NULL,speed_ms=NULL,
        heading=NULL,ended_at=NOW(),updated_at=NOW() WHERE ride_id=$1`, [rideId]);
      await client.query(`UPDATE live_seat_requests SET status='cancelled',responded_at=NOW()
        WHERE ride_id=$1 AND status='pending'`, [rideId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
    await broadcast(rideId);
  }

  async function finish(user, rideId) {
    await assertDriver(user, rideId);
    const result = await completeRide(rideId, user.id);
    await stopTracking(rideId);
    return result;
  }

  async function createRequest(user, rideId, body) {
    const ride = await rideById(rideId);
    if (!ride || ride.status !== 'active') throw Object.assign(new Error('Viaje no disponible.'), { status: 404 });
    if (Number(ride.driver_id) === Number(user.id)) throw Object.assign(new Error('No puedes solicitar tu propio viaje.'), { status: 400 });
    const trip = await liveTrip(rideId);
    if (!trip || !ACTIVE_STATES.has(trip.status)) throw Object.assign(new Error('El recorrido todavía no está en seguimiento.'), { status: 409 });
    const seats = integerInRange(body.seats, 1, 3);
    if (!seats) throw Object.assign(new Error('Número de asientos inválido.'), { status: 400 });
    const available = Number(ride.seats_total) - Number(ride.seats_confirmed || 0);
    if (available < seats) throw Object.assign(new Error('No hay suficientes lugares disponibles.'), { status: 409 });
    const pickupLabel = String(body.pickupLabel || ride.pickup_point).trim().replace(/\s+/g, ' ').slice(0, 120);
    const pickupLat = body.pickupLat == null ? ride.pickup_lat : numberInRange(body.pickupLat, -90, 90);
    const pickupLng = body.pickupLng == null ? ride.pickup_lng : numberInRange(body.pickupLng, -180, 180);
    try {
      const { rows } = await pool.query(`INSERT INTO live_seat_requests
        (ride_id,passenger_id,seats,pickup_label,pickup_lat,pickup_lng,status,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW()) RETURNING *`,
      [rideId, user.id, seats, pickupLabel, pickupLat, pickupLng]);
      await Promise.allSettled([pushService.notifyUser(ride.driver_id, 'Solicitud durante el recorrido',
        `${user.name} solicita ${seats} lugar${seats === 1 ? '' : 'es'} en ${pickupLabel}.`, `/#seguimiento?ride=${rideId}`)]);
      await broadcast(rideId);
      return rows[0];
    } catch (error) {
      if (error.code === '23505') throw Object.assign(new Error('Ya tienes una solicitud pendiente para este viaje.'), { status: 409 });
      throw error;
    }
  }

  async function listRequests(user, rideId) {
    await assertDriver(user, rideId);
    const { rows } = await pool.query(`SELECT q.id,q.seats,q.pickup_label,q.pickup_lat,q.pickup_lng,q.status,q.created_at,
      u.name,u.student_id,u.career FROM live_seat_requests q JOIN users u ON u.id=q.passenger_id
      WHERE q.ride_id=$1 ORDER BY CASE q.status WHEN 'pending' THEN 0 ELSE 1 END,q.created_at`, [rideId]);
    return rows.map(row => ({
      id: Number(row.id), seats: Number(row.seats), pickupLabel: row.pickup_label,
      pickupLat: row.pickup_lat == null ? null : Number(row.pickup_lat), pickupLng: row.pickup_lng == null ? null : Number(row.pickup_lng),
      status: row.status, createdAt: row.created_at,
      passenger: { name: row.name, studentId: row.student_id, career: row.career }
    }));
  }

  async function respondRequest(user, requestId, action) {
    if (!['accept', 'reject'].includes(action)) throw Object.assign(new Error('Respuesta inválida.'), { status: 400 });
    const client = await pool.connect();
    let output;
    try {
      await client.query('BEGIN');
      const request = (await client.query('SELECT * FROM live_seat_requests WHERE id=$1 FOR UPDATE', [requestId])).rows[0];
      if (!request) throw Object.assign(new Error('Solicitud no encontrada.'), { status: 404 });
      // Serializa todas las aceptaciones y reservas del mismo viaje.
      await client.query('SELECT id FROM rides WHERE id=$1 FOR UPDATE', [request.ride_id]);
      const ride = await assertDriver(user, request.ride_id, client);
      if (request.status !== 'pending') throw Object.assign(new Error('La solicitud ya fue atendida.'), { status: 409 });
      if (action === 'reject') {
        output = (await client.query("UPDATE live_seat_requests SET status='rejected',responded_at=NOW() WHERE id=$1 RETURNING *", [requestId])).rows[0];
      } else {
        const taken = Number((await client.query("SELECT COALESCE(SUM(seats),0)::int AS n FROM reservations WHERE ride_id=$1 AND status='confirmed'", [ride.id])).rows[0].n);
        if (taken + Number(request.seats) > Number(ride.seats_total)) throw Object.assign(new Error('El viaje ya no tiene suficientes lugares.'), { status: 409 });
        const existing = (await client.query('SELECT * FROM reservations WHERE ride_id=$1 AND passenger_id=$2 FOR UPDATE', [ride.id, request.passenger_id])).rows[0];
        if (existing?.status === 'confirmed') throw Object.assign(new Error('El pasajero ya tiene una reserva confirmada.'), { status: 409 });
        if (existing) await client.query("UPDATE reservations SET seats=$1,status='confirmed',created_at=NOW() WHERE id=$2", [request.seats, existing.id]);
        else await client.query("INSERT INTO reservations (ride_id,passenger_id,seats,status,created_at) VALUES ($1,$2,$3,'confirmed',NOW())", [ride.id, request.passenger_id, request.seats]);
        output = (await client.query("UPDATE live_seat_requests SET status='accepted',responded_at=NOW() WHERE id=$1 RETURNING *", [requestId])).rows[0];
        if (!existing) await client.query("INSERT INTO eco_events (user_id,points,reason,created_at) VALUES ($1,15,'Lugar reservado durante recorrido',NOW())", [request.passenger_id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
    await Promise.allSettled([pushService.notifyUser(output.passenger_id,
      output.status === 'accepted' ? 'Solicitud aceptada' : 'Solicitud no aceptada',
      output.status === 'accepted' ? 'Tu asiento quedó confirmado. Ya puedes ver la ubicación del automóvil.' : 'Busca otra opción disponible.',
      `/#seguimiento?ride=${output.ride_id}`)]);
    await broadcast(output.ride_id);
    return output;
  }

  function userFromSession(session) {
    return { id: Number(session.row.user_id), role: session.row.role, name: session.row.name };
  }

  async function handle(req, res, url, ip) {
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/live/')) return false;
    const rideMatch = pathname.match(/^\/api\/live\/rides\/(\d+)(?:\/(start|location|state|finish|requests))?$/);
    const requestMatch = pathname.match(/^\/api\/live\/requests\/(\d+)$/);
    if (!rideMatch && !requestMatch) { json(res, 404, { error: 'Endpoint de seguimiento no encontrado.' }); return true; }
    const session = await requireAuth(req, res); if (!session) return true;
    const user = userFromSession(session);
    try {
      if (rideMatch) {
        const rideId = Number(rideMatch[1]), action = rideMatch[2] || '';
        if (req.method === 'GET' && !action) { json(res, 200, await getState(user, rideId)); return true; }
        if (req.method === 'GET' && action === 'requests') { json(res, 200, { requests: await listRequests(user, rideId) }); return true; }
        if (req.method !== 'POST') { json(res, 405, { error: 'Método no permitido.' }); return true; }
        if (!requireCsrf(req, res, session)) return true;
        const body = await readBody(req);
        if (action === 'start') json(res, 201, await start(user, rideId));
        else if (action === 'location') {
          if (!rateLimit(ip, `live-location-${user.id}`, 180, 60_000)) json(res, 429, { error: 'Demasiadas posiciones por minuto.' });
          else json(res, 200, await updateLocation(user, rideId, body));
        } else if (action === 'state') json(res, 200, await changeState(user, rideId, String(body.status || '')));
        else if (action === 'finish') json(res, 200, await finish(user, rideId));
        else if (action === 'requests') json(res, 201, { request: await createRequest(user, rideId, body) });
        else json(res, 404, { error: 'Acción no encontrada.' });
        return true;
      }
      if (requestMatch && req.method === 'PATCH') {
        if (!requireCsrf(req, res, session)) return true;
        const body = await readBody(req);
        json(res, 200, { request: await respondRequest(user, Number(requestMatch[1]), String(body.action || '')) });
        return true;
      }
      json(res, 405, { error: 'Método no permitido.' }); return true;
    } catch (error) {
      json(res, error.status || 500, { error: error.status ? error.message : 'No se pudo procesar el seguimiento.' });
      return true;
    }
  }

  async function broadcast(rideId) {
    const targets = [...sockets].filter(ws => ws.readyState === WebSocket.OPEN && ws.rideId === Number(rideId));
    await Promise.all(targets.map(async ws => {
      try { ws.send(JSON.stringify({ type: 'live-state', data: await getState(ws.user, Number(rideId)) })); }
      catch { ws.send(JSON.stringify({ type: 'error', message: 'El seguimiento ya no está disponible.' })); }
    }));
  }

  function attachRealtime(server, sessionFromReq, production = false) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    server.on('upgrade', async (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/api/live/ws') return socket.destroy();
      if (production && req.headers.origin) {
        try { if (new URL(req.headers.origin).host !== req.headers.host) return socket.destroy(); }
        catch { return socket.destroy(); }
      }
      try {
        const session = await sessionFromReq(req);
        if (!session?.row?.user_id) return socket.destroy();
        wss.handleUpgrade(req, socket, head, ws => {
          ws.user = userFromSession(session);
          wss.emit('connection', ws);
        });
      } catch { socket.destroy(); }
    });
    wss.on('connection', ws => {
      sockets.add(ws);
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', async raw => {
        let message;
        try { message = JSON.parse(String(raw)); } catch { return ws.send(JSON.stringify({ type: 'error', message: 'Mensaje inválido.' })); }
        if (message.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
        if (message.type !== 'subscribe') return ws.send(JSON.stringify({ type: 'error', message: 'Acción WebSocket no reconocida.' }));
        const rideId = integerInRange(message.rideId, 1, Number.MAX_SAFE_INTEGER);
        if (!rideId) return ws.send(JSON.stringify({ type: 'error', message: 'Viaje inválido.' }));
        const auth = await userCanView(rideId, ws.user.id, ws.user.role);
        if (!auth.allowed) return ws.send(JSON.stringify({ type: 'error', message: 'Solo los participantes confirmados pueden ver la ubicación.' }));
        ws.rideId = rideId;
        ws.send(JSON.stringify({ type: 'live-state', data: await getState(ws.user, rideId) }));
      });
      ws.on('close', () => sockets.delete(ws));
      ws.on('error', () => sockets.delete(ws));
    });
    const heartbeat = setInterval(() => {
      for (const ws of sockets) {
        if (!ws.isAlive) { ws.terminate(); sockets.delete(ws); continue; }
        ws.isAlive = false; ws.ping();
      }
    }, 30_000);
    heartbeat.unref?.();
    wss.on('close', () => clearInterval(heartbeat));
    return wss;
  }

  return { handle, attachRealtime, stopTracking, getState, broadcast };
}

module.exports = { createLiveTracking, proximityFromEta, estimateArrival, POSITION_MAX_AGE_MS };
