# RodandoUTP GreenShare 7.0

PWA unificada para que estudiantes de la Universidad Tecnológica de Puebla publiquen, busquen y reserven viajes compartidos. Conserva el diseño blanco/verde de GreenShare e integra EcoPuntos, Rodando Parking, seguimiento GPS por WebSocket y un asistente flotante que recomienda **viajes reales de PostgreSQL**.

## Funcionalidades

- Registro institucional, inicio de sesión, perfiles y sesiones en cookie `HttpOnly`.
- Publicación y búsqueda por origen, destino, fecha, horario, sentido, asientos y cercanía.
- Reserva transaccional sin sobreventa y cancelación de viajes o reservas.
- EcoPuntos persistentes, niveles, insignias e historial de movimientos.
- Rodando Parking con pase, QR, PDF y validación pública con datos mínimos.
- Seguimiento en vivo con consentimiento del conductor, Leaflet y WebSocket.
- ETA aproximada y colores: verde `>10 min`, amarillo `≤10`, naranja `≤5`, rojo `≤2`.
- Solicitudes de asiento durante el recorrido y aceptación transaccional.
- Avisos internos/Web Push de inicio, solicitudes, aceptación y proximidad.
- Ingesta de posiciones desde un rastreador GPS, ESP32 o el teléfono como sensor, con token por viaje.
- Aviso "ya te espero" del pasajero confirmado al conductor.
- Asistente flotante determinista y explicable; consulta cupo, horario y coordenadas reales.
- Service Worker único: app shell offline, sin cachear `/api`, sesiones ni ubicación del servidor.

## Arquitectura

```text
PWA HTML/CSS/JS + Leaflet
        │ REST + cookie HttpOnly + CSRF
        │ WebSocket /api/live/ws
        ▼
server.js (servidor HTTP Node.js)
 ├─ lib/recommendations.js
 ├─ lib/live-tracking.js
 ├─ push-notifications.js
 └─ parking-pass-pdf.js
        │
        ▼
PostgreSQL / Neon
```

Existe una sola autenticación, API, PWA y base de datos. El WebSocket reutiliza la cookie de sesión; no expone JWT en el navegador. Solo se guarda la última posición GPS en la base de datos y se elimina al finalizar o cancelar el viaje. Los dispositivos IoT usan `Authorization: Device <token>` sin cookie ni CSRF; de ellos solo se conserva el SHA-256 del token. La única excepción de caché es la última posición local descrita en Seguridad y privacidad.

## Requisitos

- Node.js `22.5` o posterior.
- PostgreSQL o una rama de desarrollo de Neon.
- HTTPS en producción para geolocalización, PWA y notificaciones.

## Instalación en Windows

```powershell
cd "C:\Users\perez\Music\RodandoUTP_Trabajando juntos"
npm install
Copy-Item .env.example .env
notepad .env
npm run db:init
npm start
```

Abrir `http://localhost:3000`. `localhost` permite probar geolocalización en desarrollo; un teléfono conectado por IP normalmente requiere HTTPS.

### Configurar Neon

1. Crear una rama o base **de desarrollo**, no usar producción para pruebas.
2. Copiar la cadena del botón **Connect** en `DATABASE_URL`.
3. Mantener `sslmode=require`.
4. Ejecutar `npm run db:init`; el SQL es idempotente y no contiene `DROP` ni `TRUNCATE`.
5. Ejecutar `npm run db:check` para revisar conteos.

La carga demo es opcional y exige autorización explícita:

```powershell
# Solo en una base vacía de demostración:
# cambiar ALLOW_DEMO_SEED=true en .env
npm run seed
# volver a ALLOW_DEMO_SEED=false
```

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---:|---|
| `DATABASE_URL` | Sí | Conexión PostgreSQL/Neon |
| `PORT` | No | Puerto, por defecto `3000` |
| `NODE_ENV` | Sí en despliegue | Usar `production` en servidor HTTPS |
| `APP_URL` | Recomendable | URL pública usada en QR y enlaces |
| `ADMIN_EMAIL` | Recomendable | Cuenta administrativa |
| `ADMIN_PASSWORD` | Sí en producción | Mínimo 12 caracteres |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | No | Web Push |
| `VAPID_SUBJECT` | No | Contacto VAPID |
| `AI_PROVIDER=groq` | No | Activa únicamente el parser textual opcional |
| `GROQ_API_KEY` | No | Clave del parser; nunca se envía al frontend |
| `GROQ_MODEL` | No | Modelo compatible configurado por el equipo |
| `AI_DAILY_LIMIT` | No | Límite del parser, `50` por defecto |

Sin Groq, el asistente sigue funcionando con reglas locales. Aunque se active, Groq solo extrae origen y horario: la selección final siempre proviene de PostgreSQL. No se contrata ni activa automáticamente ningún servicio de pago.

## Comandos

```powershell
npm start                 # servidor
npm run dev               # servidor en desarrollo
npm test                  # pruebas unitarias/estáticas sin BD
npm run test:integration  # flujo HTTP/WS contra BD de pruebas y servidor activo
npm run db:init           # esquema idempotente
npm run db:check          # conteos PostgreSQL
npm audit                 # dependencias
```

Para integración, iniciar primero el servidor con una base de prueba que tenga los usuarios demo de `scripts/seed-demo.js`; luego ejecutar `npm run test:integration` en otra terminal.

La ingesta IoT se puede demostrar sin hardware. En los controles del conductor, "Conectar dispositivo IoT" entrega el token y el comando exacto; la forma general es:

```bash
node scripts/simular-dispositivo-iot.js http://localhost:3000/api/live/iot/location <token> 19.0583869,-98.1545312 19.064,-98.17
```

## Despliegue

En Render u otro proveedor Node:

- Build: `npm ci`
- Start: `npm start`
- Health check: `/api/health`
- Variables: `DATABASE_URL`, `NODE_ENV=production`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y, opcionalmente, VAPID/Groq.
- Usar una instancia compatible con conexiones WebSocket y HTTPS.
- No configurar `ALLOW_DEMO_SEED=true` ni `ALLOW_SQLITE_IMPORT=true` en producción.

## Seguridad y privacidad

- Contraseñas con `scrypt`, SQL parametrizado, CSRF y rate limits.
- Reservas y aceptación en vivo bloquean la fila `rides` con `FOR UPDATE`.
- GPS visible únicamente al conductor, administración y pasajeros confirmados.
- Posiciones con más de 100 m de imprecisión se rechazan; una lectura caduca a los 90 s.
- El Service Worker no intercepta `/api/` y no guarda datos autenticados ni respuestas de ubicación.
- Excepción de privacidad documentada: solo en el propio dispositivo, la PWA guarda en Cache Storage `rodando-live-v1` una única lectura `{rideId, lat, lng, etaMinutes, proximity, updatedAt}` para participantes autorizados. Esa caché no se envía al servidor ni se comparte; se borra al finalizar el viaje, al cerrar sesión y al perder el permiso. Sin red se muestra con el aviso "Dato sin actualizar · última señal hace X".
- El token de un dispositivo IoT se muestra una sola vez; en PostgreSQL solo existe su SHA-256. Revocarlo o finalizar el viaje lo inutiliza de inmediato.
- El QR público enmascara nombres, matrículas y placa; participantes autorizados ven el detalle.

## Documentación

- [`docs/INTEGRACION_PROYECTOS.md`](docs/INTEGRACION_PROYECTOS.md)
- [`docs/BASE_DE_DATOS.md`](docs/BASE_DE_DATOS.md)
- [`docs/PRUEBAS_INTEGRACION.md`](docs/PRUEBAS_INTEGRACION.md)
- [`docs/schema-postgres.sql`](docs/schema-postgres.sql)

La integración se desarrolló en `integration/greenshare-unified`. No se modifica ningún repositorio de origen y no se realiza `push` automáticamente.
