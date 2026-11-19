'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('el esquema y las migraciones nuevas son idempotentes', () => {
  const schema = read('docs/schema-postgres.sql');
  const iot = read('docs/migrations/008-live-iot-devices.sql');
  const arrival = read('docs/migrations/009-live-arrival-notices.sql');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS live_devices/);
  assert.match(schema, /token_hash TEXT UNIQUE NOT NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS live_arrival_notices/);
  assert.match(schema, /code = 'arrived'/);
  assert.match(iot, /CREATE INDEX IF NOT EXISTS idx_live_devices_ride/);
  assert.match(arrival, /UNIQUE \(ride_id, user_id, code\)/);
  for (const sql of [iot, arrival]) {
    assert.doesNotMatch(sql, /\bDROP\b/i);
    assert.match(sql, /IF NOT EXISTS/);
  }
});

test('el service worker preserva la caché privada sin tocar la API', () => {
  const sw = read('public/service-worker.js');
  assert.match(sw, /const LIVE_CACHE = 'rodando-live-v1'/);
  assert.match(sw, /key !== CACHE && key !== LIVE_CACHE/);
  assert.match(sw, /PRIVATE_PATH_PREFIXES = \['\/api\/', '\/auth\/'\]/);
});

test('la interfaz expone los controles nuevos y carga el módulo de mapa', () => {
  const html = read('public/index.html');
  for (const id of ['liveMapLegend', 'liveDeviceButton', 'liveDevicePanel', 'liveArrived', 'liveArrivedStatus']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /\/js\/live-map\.js\?v=7\.1\.0/);
});

test('el servidor mantiene la ingesta IoT fuera de la autenticación por cookie', () => {
  const live = read('lib/live-tracking.js');
  assert.match(live, /\/api\/live\/iot\/location/);
  assert.match(live, /parseDeviceToken\(req\.headers\.authorization\)/);
  assert.match(live, /live-iot-\$\{tokenHash\.slice\(0, 16\)\}/);
  assert.match(live, /action === 'arrived'/);
});
