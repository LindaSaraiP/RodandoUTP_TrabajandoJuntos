'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const map = require('../public/js/live-map');

test('la leyenda nombra los cuatro colores de cercanía', () => {
  assert.deepEqual(map.PROXIMITY_LEGEND.map(item => item.color), ['green', 'yellow', 'orange', 'red']);
  map.PROXIMITY_LEGEND.forEach(item => assert.match(item.label, /min/));
});

test('los colores se resuelven desde variables CSS con respaldo gris', () => {
  assert.equal(map.colorVariable('orange'), '--live-orange');
  assert.equal(map.colorVariable('sin-dato'), '--live-gray');
  assert.equal(map.resolveColor('green', { '--live-green': '#2e9b58' }), '#2e9b58');
  assert.equal(map.resolveColor('red', {}), '#8c9b90');
});

test('la ruta usa origen, encuentro y destino solo cuando hay coordenadas', () => {
  const points = map.routePoints({ ride: {
    originLat: 19, originLng: -98, pickupLat: 19.05, pickupLng: -98.05,
    destinationLat: null, destinationLng: -98.1
  } });
  assert.deepEqual(points, [[19, -98], [19.05, -98.05]]);
  assert.deepEqual(map.routePoints({}), []);
});

test('el aviso de señal antigua es explícito', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  assert.equal(map.formatUltimaSenal('2026-11-17T11:57:30Z', now), 'hace 2 min');
  assert.equal(map.formatUltimaSenal('2026-11-17T10:00:00Z', now), 'hace 2 h');
  assert.equal(map.formatUltimaSenal('no-fecha', now), 'hora desconocida');
});
