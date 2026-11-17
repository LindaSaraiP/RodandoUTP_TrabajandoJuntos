'use strict';

const crypto = require('node:crypto');

const DEVICE_TOKEN_BYTES = 32;
const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ACTIVE_LIVE_STATES = new Set(['en_camino', 'recogiendo', 'en_ruta']);

function numberInRange(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function integerInRange(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateDeviceToken() {
  return crypto.randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
}

function parseDeviceToken(header) {
  const value = String(header || '').trim();
  const match = /^Device ([A-Za-z0-9_-]+)$/.exec(value);
  return match && DEVICE_TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

function parseLocation(body) {
  const lat = numberInRange(body?.lat, -90, 90);
  const lng = numberInRange(body?.lng, -180, 180);
  const accuracy = numberInRange(body?.accuracy, 0, 100);
  const speed = body?.speed == null ? null : numberInRange(body.speed, 0, 60);
  const heading = body?.heading == null ? null : numberInRange(body.heading, 0, 360);
  if (lat == null || lng == null) throw Object.assign(new Error('Coordenadas inválidas.'), { status: 400 });
  if (accuracy == null) throw Object.assign(new Error('La precisión GPS debe ser de 100 m o mejor.'), { status: 400 });
  return { lat, lng, accuracy, speed, heading };
}

module.exports = {
  DEVICE_TOKEN_BYTES, ACTIVE_LIVE_STATES, numberInRange, integerInRange,
  sha256, generateDeviceToken, parseDeviceToken, parseLocation
};
