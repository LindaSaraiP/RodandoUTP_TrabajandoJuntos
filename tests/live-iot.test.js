'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const iot = require('../lib/live-iot');
const { analizarPunto, construirRuta, rumbo } = require('../scripts/simular-dispositivo-iot');

test('el token tiene 32 bytes y solo se guarda su SHA-256', () => {
  const token = iot.generateDeviceToken();
  assert.equal(Buffer.from(token, 'base64url').length, iot.DEVICE_TOKEN_BYTES);
  assert.equal(iot.sha256(token), crypto.createHash('sha256').update(token).digest('hex'));
  assert.notEqual(iot.sha256(token), token);
});

test('la cabecera Device exige el formato del token', () => {
  const token = iot.generateDeviceToken();
  assert.equal(iot.parseDeviceToken(`Device ${token}`), token);
  assert.equal(iot.parseDeviceToken(`device ${token}`), null);
  assert.equal(iot.parseDeviceToken('Bearer otro-token'), null);
  assert.equal(iot.parseDeviceToken('Device corto'), null);
});

test('la validación de ingesta IoT es la misma del GPS del navegador', () => {
  assert.deepEqual(iot.parseLocation({ lat: '19.05', lng: '-98.15', accuracy: 15, speed: '6', heading: 90 }), {
    lat: 19.05, lng: -98.15, accuracy: 15, speed: 6, heading: 90
  });
  const sinOpcionales = iot.parseLocation({ lat: 19, lng: -98, accuracy: 0 });
  assert.equal(sinOpcionales.speed, null);
  assert.equal(sinOpcionales.heading, null);
  assert.throws(() => iot.parseLocation({ lat: 91, lng: 0, accuracy: 10 }), /Coordenadas inválidas/);
  assert.throws(() => iot.parseLocation({ lat: 19, lng: -98, accuracy: 101 }), /precisión GPS/);
});

test('solo los estados activos aceptan posiciones', () => {
  assert.deepEqual([...iot.ACTIVE_LIVE_STATES], ['en_camino', 'recogiendo', 'en_ruta']);
});

test('el simulador interpola dos puntos y calcula un rumbo válido', () => {
  assert.deepEqual(analizarPunto('19.05,-98.15'), [19.05, -98.15]);
  assert.throws(() => analizarPunto('19.05'), /Punto inválido/);
  const ruta = construirRuta([[0, 0], [0, 1]], 2);
  assert.deepEqual(ruta, [[0, 0], [0, 0.5], [0, 1]]);
  assert.equal(rumbo([0, 0], [0, 1]), 90);
});
