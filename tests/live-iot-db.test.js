'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');

const habilitado = process.env.IOT_DB_TEST === '1' && Boolean(process.env.DATABASE_URL);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function hashLocal(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

test('ingesta IoT, dedupe de llegada y revocación contra PostgreSQL', { skip: !habilitado, timeout: 45000 }, async () => {
  const root = path.join(__dirname, '..');
  const pool = require('../db');
  const puerto = 33000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${puerto}`;
  const sufijo = Date.now().toString(36);
  const password = 'IotPrueba2026';
  const servidor = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(puerto), NODE_ENV: 'test', ADMIN_PASSWORD: 'AdministracionPrueba2026' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let salida = '';
  servidor.stdout.on('data', chunk => { salida += chunk; });
  servidor.stderr.on('data', chunk => { salida += chunk; });
  let driverId, passengerId;

  const pedir = async (ruta, { method = 'GET', cookie, csrf, body, headers = {} } = {}) => {
    const cabeceras = { ...headers };
    if (cookie) cabeceras.Cookie = cookie;
    if (csrf) cabeceras['X-CSRF-Token'] = csrf;
    if (body !== undefined) cabeceras['Content-Type'] = 'application/json';
    const respuesta = await fetch(`${base}${ruta}`, {
      method, headers: cabeceras, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const establecida = respuesta.headers.get('set-cookie');
    const datos = await respuesta.json().catch(() => ({}));
    return {
      status: respuesta.status, datos,
      cookie: establecida ? establecida.split(';')[0] : cookie
    };
  };

  const ingresar = async (email, contrasena) => {
    const sesion = await pedir('/api/session');
    assert.equal(sesion.status, 200);
    const respuesta = await pedir('/api/login', {
      method: 'POST', cookie: sesion.cookie, csrf: sesion.datos.csrfToken,
      body: { email, password: contrasena }
    });
    assert.equal(respuesta.status, 200, JSON.stringify(respuesta.datos));
    return { cookie: respuesta.cookie, csrf: respuesta.datos.csrfToken };
  };

  try {
    for (let intento = 0; intento < 40; intento++) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
      await sleep(250);
    }
    assert.equal((await fetch(`${base}/api/health`)).status, 200, salida);

    const conductora = await pool.query(`INSERT INTO users
      (name,student_id,email,career,password_hash,verified,role,created_at)
      VALUES ($1,$2,$3,$4,$5,TRUE,'user',NOW()) RETURNING id`,
    ['Conductor IoT', `IOTC-${sufijo}`, `iotc-${sufijo}@alumno.utpuebla.edu.mx`, 'Ingeniería', hashLocal(password)]);
    const pasajera = await pool.query(`INSERT INTO users
      (name,student_id,email,career,password_hash,verified,role,created_at)
      VALUES ($1,$2,$3,$4,$5,TRUE,'user',NOW()) RETURNING id`,
    ['Pasajera IoT', `IOtp-${sufijo}`, `iotp-${sufijo}@alumno.utpuebla.edu.mx`, 'Ingeniería', hashLocal(password)]);
    driverId = Number(conductora.rows[0].id);
    passengerId = Number(pasajera.rows[0].id);

    const viaje = await pool.query(`INSERT INTO rides
      (driver_id,origin,pickup_point,destination,departure_at,seats_total,contribution_cents,vehicle,color,plate_last4,notes,status,
       origin_lat,origin_lng,pickup_lat,pickup_lng,destination_lat,destination_lng)
      VALUES ($1,'Prueba IoT','Cruce 5 de Mayo','UTP',NOW() + interval '1 hour',3,0,'Auto','Verde','1234','','active',
       19.058,-98.154,19.06,-98.156,19.07,-98.16) RETURNING id`, [driverId]);
    const rideId = Number(viaje.rows[0].id);
    await pool.query(`INSERT INTO reservations (ride_id,passenger_id,seats,status,created_at)
      VALUES ($1,$2,1,'confirmed',NOW())`, [rideId, passengerId]);

    const conductor = await ingresar(`iotc-${sufijo}@alumno.utpuebla.edu.mx`, password);
    const pasajero = await ingresar(`iotp-${sufijo}@alumno.utpuebla.edu.mx`, password);
    assert.equal((await pedir(`/api/live/rides/${rideId}/start`, {
      method: 'POST', cookie: conductor.cookie, csrf: conductor.csrf, body: {}
    })).status, 201);

    const dispositivo = await pedir(`/api/live/rides/${rideId}/device`, {
      method: 'POST', cookie: conductor.cookie, csrf: conductor.csrf, body: { label: 'ESP32 prueba' }
    });
    assert.equal(dispositivo.status, 201, JSON.stringify(dispositivo.datos));
    const token = dispositivo.datos.token;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const guardado = await pool.query('SELECT token_hash, label FROM live_devices WHERE id=$1', [dispositivo.datos.device.id]);
    assert.equal(guardado.rows[0].token_hash, crypto.createHash('sha256').update(token).digest('hex'));
    assert.notEqual(guardado.rows[0].token_hash, token);

    const posicion = { lat: 19.0605, lng: -98.156, accuracy: 15, speed: 6, heading: 90 };
    assert.equal((await pedir('/api/live/iot/location', { method: 'POST', body: posicion })).status, 401);
    assert.equal((await pedir('/api/live/iot/location', {
      method: 'POST', cookie: conductor.cookie, body: posicion
    })).status, 401);
    const enviada = await pedir('/api/live/iot/location', {
      method: 'POST', headers: { Authorization: `Device ${token}` }, body: posicion
    });
    assert.equal(enviada.status, 200, JSON.stringify(enviada.datos));

    const estado = await pedir(`/api/live/rides/${rideId}`, { cookie: conductor.cookie });
    assert.equal(estado.datos.position.lat, 19.0605);
    assert.equal(estado.datos.live.fresh, true);
    assert.ok(['red', 'orange', 'yellow'].includes(estado.datos.estimate.proximity.code));
    const seen = await pool.query('SELECT last_seen_at FROM live_devices WHERE id=$1', [dispositivo.datos.device.id]);
    assert.ok(seen.rows[0].last_seen_at);

    const llegada = await pedir(`/api/live/rides/${rideId}/arrived`, {
      method: 'POST', cookie: pasajero.cookie, csrf: pasajero.csrf, body: {}
    });
    assert.equal(llegada.status, 200, JSON.stringify(llegada.datos));
    assert.equal(llegada.datos.alreadyNotified, false);
    const repetida = await pedir(`/api/live/rides/${rideId}/arrived`, {
      method: 'POST', cookie: pasajero.cookie, csrf: pasajero.csrf, body: {}
    });
    assert.equal(repetida.datos.alreadyNotified, true);
    const avisos = await pool.query(`SELECT title, body FROM app_notifications
      WHERE user_id=$1 AND title='Tu pasajero ya te espera'`, [driverId]);
    assert.equal(avisos.rowCount, 1);
    assert.match(avisos.rows[0].body, /Cruce 5 de Mayo/);

    const revocada = await pedir(`/api/live/rides/${rideId}/device`, {
      method: 'DELETE', cookie: conductor.cookie, csrf: conductor.csrf, body: { deviceId: dispositivo.datos.device.id }
    });
    assert.equal(revocada.status, 200, JSON.stringify(revocada.datos));
    assert.equal((await pedir('/api/live/iot/location', {
      method: 'POST', headers: { Authorization: `Device ${token}` }, body: posicion
    })).status, 401);
  } finally {
    if (driverId || passengerId) {
      await pool.query('DELETE FROM users WHERE id IN ($1,$2)', [driverId, passengerId]).catch(() => {});
    }
    await pool.end().catch(() => {});
    if (servidor.exitCode === null) servidor.kill('SIGTERM');
  }
});
