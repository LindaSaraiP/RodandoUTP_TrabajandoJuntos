'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  haversineKm, parseHour, deterministicParse, scoreRide, createRecommendationService
} = require('../lib/recommendations');

function ride(overrides = {}) {
  return {
    id: 15, origin: 'Cholula', destination: 'Universidad Tecnológica de Puebla', direction: 'to_utp',
    pickupPoint: 'Centro de Cholula', pickupLat: 19.0641, pickupLng: -98.3035,
    departureAt: '2030-01-02T13:00:00.000Z', seatsTotal: 3, seatsAvailable: 2,
    contribution: 25, routeType: 'direct', status: 'active',
    driver: { id: 2, name: 'Conductora Real', verified: true }, ...overrides
  };
}

test('interpreta zonas y horarios en español sin API externa', () => {
  assert.equal(parseHour('Necesito llegar a las 7 de la mañana'), '07:00');
  assert.equal(parseHour('salgo 7:30 pm'), '19:30');
  const parsed = deterministicParse('Estoy en Angelópolis y llego a la UTP a las 8 am');
  assert.equal(parsed.origin, 'Angelópolis');
  assert.equal(parsed.desiredTime, '08:00');
  assert.equal(parsed.destination, 'Universidad Tecnológica de Puebla');
});

test('calcula distancia geográfica sin inventarla', () => {
  assert.equal(haversineKm(19.0641, -98.3035, 19.0641, -98.3035), 0);
  assert.ok(haversineKm(19.0641, -98.3035, 19.0583869, -98.1545312) > 10);
  assert.equal(haversineKm('x', 0, 0, 0), null);
});

test('descarta viajes llenos, inactivos o en sentido opuesto', () => {
  const input = deterministicParse('Desde Cholula hacia la UTP a las 7 am');
  assert.equal(scoreRide(ride({ seatsAvailable: 0 }), input), null);
  assert.equal(scoreRide(ride({ status: 'cancelled' }), input), null);
  assert.equal(scoreRide(ride({ direction: 'from_utp' }), input), null);
});

test('ordena exclusivamente los viajes entregados por la fuente real', async () => {
  const source = [ride({ id: 1, pickupLat: 19.0641 }), ride({ id: 2, origin: 'Amozoc', pickupLat: 19.0461, pickupLng: -98.0454 })];
  const service = createRecommendationService({ getRides: async () => source });
  const result = await service.recommend('Estoy en Cholula, necesito salir a las 7 am');
  assert.equal(result.mode, 'recomendacion-determinista-con-datos-reales');
  assert.equal(result.recommendations.length, 2);
  assert.equal(result.recommendations[0].rideId, 1);
  assert.ok(result.recommendations.every(item => source.some(real => real.id === item.rideId)));
  assert.deepEqual(Object.keys(result.recommendations[0].driver).sort(), ['id', 'name', 'verified']);
});
