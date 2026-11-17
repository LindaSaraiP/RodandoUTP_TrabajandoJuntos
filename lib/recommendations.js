'use strict';

/**
 * Recomendador de viajes de Rodando UTP.
 *
 * La selección y el ordenamiento SIEMPRE se realizan con viajes reales de
 * PostgreSQL. La integración opcional con Groq solo extrae origen/horario del
 * texto; nunca puede crear conductores, asientos o rutas.
 */

const ZONES = [
  { name: 'Cholula', lat: 19.0641, lng: -98.3035, aliases: ['cholula', 'san pedro cholula', 'san andres cholula'] },
  { name: 'Angelópolis', lat: 19.0319, lng: -98.2325, aliases: ['angelopolis', 'angelópolis', 'sonata', 'lomas de angelopolis'] },
  { name: 'Centro de Puebla', lat: 19.0414, lng: -98.2063, aliases: ['centro', 'centro de puebla', 'zocalo', 'zócalo'] },
  { name: 'La Margarita', lat: 18.9996, lng: -98.1815, aliases: ['la margarita', 'margarita'] },
  { name: 'Amozoc', lat: 19.0461, lng: -98.0454, aliases: ['amozoc'] },
  { name: 'Cuautlancingo', lat: 19.0897, lng: -98.2719, aliases: ['cuautlancingo'] },
  { name: 'UTP', lat: 19.0583869, lng: -98.1545312, aliases: ['utp', 'universidad tecnologica de puebla', 'universidad tecnológica de puebla'] }
];

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function haversineKm(lat1, lng1, lat2, lng2) {
  const values = [lat1, lng1, lat2, lng2].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const rad = Math.PI / 180;
  const dLat = (values[2] - values[0]) * rad;
  const dLng = (values[3] - values[1]) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(values[0] * rad) * Math.cos(values[2] * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function zoneFromText(text) {
  const clean = normalize(text);
  return ZONES.find(zone => zone.aliases.some(alias => clean.includes(normalize(alias)))) || null;
}

function parseHour(text) {
  const clean = normalize(text);
  const match = clean.match(/(?:a\s+las\s+)?\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|de\s+la\s+manana|de\s+la\s+tarde|de\s+la\s+noche)?\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3] || '';
  if ((period.includes('p') || period.includes('tarde') || period.includes('noche')) && hour < 12) hour += 12;
  if ((period.includes('a') || period.includes('manana')) && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function deterministicParse(message, supplied = {}) {
  const zone = zoneFromText(supplied.origin || message);
  const destination = /\butp\b|universidad tecnologica/i.test(normalize(supplied.destination || message))
    ? 'Universidad Tecnológica de Puebla' : (supplied.destination || 'Universidad Tecnológica de Puebla');
  const desiredTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(supplied.desiredTime || ''))
    ? supplied.desiredTime : parseHour(message);
  const lat = Number(supplied.lat), lng = Number(supplied.lng);
  return {
    origin: String(supplied.origin || zone?.name || '').slice(0, 80),
    destination: String(destination).slice(0, 100),
    desiredTime,
    lat: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : null,
    lng: Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : null,
    zone
  };
}

let aiDay = '';
let aiCalls = 0;

async function optionalGroqParse(message, current) {
  if (String(process.env.AI_PROVIDER || '').toLowerCase() !== 'groq' || !process.env.GROQ_API_KEY) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (today !== aiDay) { aiDay = today; aiCalls = 0; }
  const limit = clamp(Number(process.env.AI_DAILY_LIMIT) || 50, 1, 200);
  if (aiCalls >= limit) return null;
  aiCalls++;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(6000),
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
      temperature: 0,
      max_completion_tokens: 160,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Extrae solo datos de búsqueda. Devuelve JSON con origin, destination y desiredTime (HH:MM o null). No inventes valores ausentes.' },
        { role: 'user', content: String(message || '').slice(0, 500) }
      ]
    })
  });
  if (!response.ok) throw new Error(`Groq respondió ${response.status}`);
  const payload = await response.json();
  const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
  return {
    origin: current.origin || String(parsed.origin || '').slice(0, 80),
    destination: current.destination || String(parsed.destination || '').slice(0, 100),
    desiredTime: current.desiredTime || (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(parsed.desiredTime || '')) ? parsed.desiredTime : null)
  };
}

function minutesOfDay(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function departureMinutes(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date);
  return Number(parts.find(p => p.type === 'hour')?.value) * 60 + Number(parts.find(p => p.type === 'minute')?.value);
}

function rideDistance(ride, input) {
  const pickup = ride.pickupLat != null && ride.pickupLng != null ? [ride.pickupLat, ride.pickupLng] : null;
  if (pickup && input.lat != null && input.lng != null) return haversineKm(input.lat, input.lng, pickup[0], pickup[1]);
  const originZone = zoneFromText(input.origin);
  if (pickup && originZone) return haversineKm(originZone.lat, originZone.lng, pickup[0], pickup[1]);
  const rideZone = zoneFromText(ride.origin);
  if (originZone && rideZone) return haversineKm(originZone.lat, originZone.lng, rideZone.lat, rideZone.lng);
  if (input.origin && normalize(ride.origin).includes(normalize(input.origin))) return 0;
  return null;
}

function scoreRide(ride, input) {
  const seats = Number(ride.seatsAvailable || 0);
  if (seats < 1 || ride.status !== 'active') return null;
  const distance = rideDistance(ride, input);
  const desired = minutesOfDay(input.desiredTime);
  const departure = departureMinutes(ride.departureAt);
  const timeDelta = desired != null && departure != null ? Math.abs(desired - departure) : null;
  const towardUtp = normalize(input.destination).includes('utp') || normalize(input.destination).includes('universidad tecnologica');
  if (towardUtp && ride.direction === 'from_utp') return null;

  const proximity = distance == null ? 18 : clamp(45 - distance * 2.4, 0, 45);
  const schedule = timeDelta == null ? 16 : clamp(30 - timeDelta / 6, 0, 30);
  const availability = clamp(seats / Math.max(1, Number(ride.seatsTotal || seats)) * 15, 3, 15);
  const verified = ride.driver?.verified ? 5 : 2;
  const route = ride.routeType === 'direct' ? 5 : 3;
  const score = proximity + schedule + availability + verified + route;
  const reasons = [];
  if (distance != null) reasons.push(distance < 0.2 ? 'El punto de encuentro coincide con tu zona.' : `Punto de encuentro a ${distance.toFixed(1)} km aproximadamente.`);
  else reasons.push(`Ruta publicada desde ${ride.origin}; no hay coordenadas suficientes para calcular distancia.`);
  if (timeDelta != null) reasons.push(timeDelta <= 30 ? 'Horario muy cercano al solicitado.' : `Diferencia aproximada de ${timeDelta} minutos respecto al horario solicitado.`);
  reasons.push(`${seats} asiento${seats === 1 ? '' : 's'} disponible${seats === 1 ? '' : 's'} según PostgreSQL.`);
  if (ride.driver?.verified) reasons.push('Conductor con cuenta verificada.');

  return {
    rideId: ride.id,
    score: Number(score.toFixed(1)),
    driver: { id: ride.driver?.id, name: ride.driver?.name, verified: !!ride.driver?.verified },
    origin: ride.origin,
    destination: ride.destination,
    pickupPoint: ride.pickupPoint,
    departureAt: ride.departureAt,
    seatsAvailable: seats,
    contribution: ride.contribution,
    routeType: ride.routeType,
    distanceKm: distance == null ? null : Number(distance.toFixed(2)),
    scheduleDifferenceMinutes: timeDelta,
    reasons
  };
}

function createRecommendationService({ getRides }) {
  async function recommend(message, supplied = {}) {
    let input = deterministicParse(message, supplied);
    let parser = 'reglas-deterministas';
    try {
      const ai = await optionalGroqParse(message, input);
      if (ai) {
        input = { ...input, ...ai, zone: zoneFromText(ai.origin || input.origin) || input.zone };
        parser = 'groq-opcional-para-extraccion';
      }
    } catch {
      parser = 'reglas-deterministas-fallback';
    }

    const rides = await getRides();
    const recommendations = rides.map(ride => scoreRide(ride, input)).filter(Boolean)
      .sort((a, b) => b.score - a.score || new Date(a.departureAt) - new Date(b.departureAt)).slice(0, 5);
    const missing = [];
    if (!input.origin && input.lat == null) missing.push('origen o ubicación');
    if (!input.desiredTime) missing.push('horario deseado');
    const answer = recommendations.length
      ? `Encontré ${recommendations.length} viaje${recommendations.length === 1 ? '' : 's'} real${recommendations.length === 1 ? '' : 'es'} con lugares disponibles.`
      : `No encontré viajes vigentes con lugares disponibles${input.origin ? ` cerca de ${input.origin}` : ''}.`;
    return {
      mode: 'recomendacion-determinista-con-datos-reales', parser,
      disclaimer: 'Las recomendaciones se calculan con reglas explicables. Una API opcional solo puede interpretar el texto; los viajes y asientos siempre provienen de PostgreSQL.',
      answer, missing, query: { origin: input.origin || null, destination: input.destination, desiredTime: input.desiredTime, usingLocation: input.lat != null },
      recommendations
    };
  }
  return { recommend };
}

module.exports = {
  ZONES, normalize, haversineKm, parseHour, deterministicParse, scoreRide, createRecommendationService
};
