'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('manifest PWA válido y con acceso al seguimiento', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  assert.ok(manifest.shortcuts.some(shortcut => shortcut.url === '/#seguimiento'));
});

test('service worker precachea la app 7.0 y excluye toda API privada', () => {
  const sw = read('public/service-worker.js');
  assert.match(sw, /const VERSION = '7\.0\.0'/);
  assert.match(sw, /\/js\/live\.js\?v=7\.0\.0/);
  assert.match(sw, /\/js\/assistant\.js\?v=7\.0\.0/);
  assert.match(sw, /PRIVATE_PATH_PREFIXES = \['\/api\/', '\/auth\/'\]/);
});

test('una sola interfaz carga todos los módulos integrados', () => {
  const html = read('public/index.html');
  assert.match(html, /id="seguimiento"/);
  assert.match(html, /id="assistantPanel"/);
  assert.match(html, /id="ecoHistory"/);
  assert.equal((html.match(/rel="manifest"/g) || []).length, 1);
});

test('el esquema conserva una sola posición y protege solicitudes concurrentes', () => {
  const schema = read('docs/schema-postgres.sql');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS live_trips/);
  assert.doesNotMatch(schema, /live_position_history/i);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS idx_live_request_pending/);
  const live = read('lib/live-tracking.js');
  assert.match(live, /SELECT id FROM rides WHERE id=\$1 FOR UPDATE/);
  assert.match(live, /Solo los participantes confirmados pueden ver la ubicación/);
});
