'use strict';

const INTERVALO_MS = 3000;
const PASOS_PREDETERMINADOS = 10;

function uso() {
  return [
    'Uso: node scripts/simular-dispositivo-iot.js <url> <token> <lat,lng> [lat,lng ...] [--pasos=N]',
    '',
    'Ejemplo:',
    'node scripts/simular-dispositivo-iot.js http://localhost:3000/api/live/iot/location MI_TOKEN 19.0584,-98.1545 19.064,-98.1700',
    '',
    'Con dos coordenadas interpola diez puntos y los repite. Con tres o más recorre la lista.',
    'Envía una posición cada 3 segundos con la cabecera Authorization: Device <token>.'
  ].join('\n');
}

function analizarPunto(valor) {
  const partes = String(valor || '').split(',');
  if (partes.length !== 2) throw new Error(`Punto inválido: ${valor}`);
  const lat = Number(partes[0]), lng = Number(partes[1]);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error(`Coordenadas fuera de rango: ${valor}`);
  }
  return [lat, lng];
}

function rumbo(desde, hasta) {
  const rad = value => value * Math.PI / 180;
  const [lat1, lng1] = desde, [lat2, lng2] = hasta;
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
}

function construirRuta(puntos, pasos) {
  if (puntos.length !== 2) return puntos;
  const resultado = [];
  for (let index = 0; index <= pasos; index++) {
    const factor = index / pasos;
    resultado.push([
      puntos[0][0] + (puntos[1][0] - puntos[0][0]) * factor,
      puntos[0][1] + (puntos[1][1] - puntos[0][1]) * factor
    ]);
  }
  return resultado;
}

async function main() {
  const args = process.argv.slice(2);
  const opcionPasos = args.find(arg => arg.startsWith('--pasos='));
  const posicionales = args.filter(arg => !arg.startsWith('--'));
  const pasos = opcionPasos ? Number(opcionPasos.split('=')[1]) : PASOS_PREDETERMINADOS;
  if (posicionales.length < 3 || !Number.isInteger(pasos) || pasos < 1 || pasos > 100) {
    console.error(uso());
    process.exitCode = 1;
    return;
  }
  const [url, token, ...puntosCrudos] = posicionales;
  let endpoint;
  try {
    endpoint = new URL(url);
    if (!/^https?:$/.test(endpoint.protocol)) throw new Error('solo http o https');
  } catch {
    console.error('La URL debe ser completa, por ejemplo http://localhost:3000/api/live/iot/location');
    process.exitCode = 1;
    return;
  }
  const puntos = construirRuta(puntosCrudos.map(analizarPunto), pasos);
  let indice = 0;
  const enviar = async () => {
    const actual = puntos[indice % puntos.length];
    const siguiente = puntos[(indice + 1) % puntos.length];
    const cuerpo = {
      lat: Number(actual[0].toFixed(6)), lng: Number(actual[1].toFixed(6)),
      accuracy: 15, speed: 6, heading: rumbo(actual, siguiente)
    };
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Device ${token}` },
        body: JSON.stringify(cuerpo)
      });
      const data = await response.json().catch(() => ({}));
      console.log(`${new Date().toLocaleTimeString('es-MX')} · punto ${indice + 1} · HTTP ${response.status} · ${data.error || 'posición aceptada'}`);
    } catch (error) {
      console.error(`No se pudo enviar la posición: ${error.message}`);
    }
    indice++;
  };
  await enviar();
  const temporizador = setInterval(enviar, INTERVALO_MS);
  process.on('SIGINT', () => {
    clearInterval(temporizador);
    console.log('Simulación detenida.');
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { analizarPunto, construirRuta, rumbo };
