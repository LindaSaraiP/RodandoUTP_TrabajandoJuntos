'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { proximityFromEta, estimateArrival, POSITION_MAX_AGE_MS } = require('../lib/live-tracking');

test('aplica los cuatro umbrales documentados de proximidad', () => {
  assert.equal(proximityFromEta(11).code, 'green');
  assert.equal(proximityFromEta(10).code, 'yellow');
  assert.equal(proximityFromEta(5).code, 'orange');
  assert.equal(proximityFromEta(2).code, 'red');
  assert.equal(proximityFromEta(null).code, 'unknown');
});

test('estima llegada con distancia real y velocidad limitada', () => {
  const ride = { pickup_lat: 19.0583869, pickup_lng: -98.1545312 };
  const trip = { lat: 19.064, lng: -98.17, speed_ms: 8 };
  const result = estimateArrival(ride, trip);
  assert.ok(result.distanceKm > 0);
  assert.ok(Number.isInteger(result.etaMinutes));
  assert.ok(['green', 'yellow', 'orange', 'red'].includes(result.proximity.code));
  assert.equal(POSITION_MAX_AGE_MS, 90000);
});

test('no presenta ETA cuando faltan coordenadas', () => {
  const result = estimateArrival({ pickup_lat: null, pickup_lng: null }, { lat: 19, lng: -98 });
  assert.equal(result.etaMinutes, null);
  assert.equal(result.distanceKm, null);
});
