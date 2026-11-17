# Base de datos unificada

## Fuente de verdad

La aplicación utiliza una sola base PostgreSQL/Neon mediante `pg` y `DATABASE_URL`. `docs/schema-postgres.sql` es idempotente: crea o amplía estructuras sin borrar registros. La migración específica de la integración está en `docs/migrations/007-unified-live-tracking.sql`.

## Tablas

| Tabla | Propósito | Relaciones clave |
|---|---|---|
| `users` | Estudiantes y administración | Padre de sesiones, viajes, reservas y puntos |
| `sessions` | Cookie, hash de token, CSRF y expiración | `user_id → users.id` |
| `rides` | Ruta, horario, cupo, vehículo, sentido y coordenadas | `driver_id → users.id` |
| `reservations` | Asientos confirmados/cancelados | `ride_id → rides.id`, `passenger_id → users.id` |
| `eco_events` | Libro de movimientos EcoPuntos | `user_id → users.id` |
| `parking_passes` | Folio y estado del pase QR | Uno a uno con `rides` |
| `push_subscriptions` | Suscripción Web Push por dispositivo | `user_id → users.id` |
| `app_notifications` | Bandeja de avisos | `user_id → users.id` |
| `live_trips` | Estado y última posición del automóvil | Uno a uno con `rides` |
| `live_seat_requests` | Solicitud pendiente/aceptada/rechazada | Viaje y pasajero |
| `live_proximity_notices` | Deduplicación de colores ya notificados | Viaje, usuario y umbral únicos |

## Relaciones

```text
users 1 ── N rides (driver_id)
users 1 ── N reservations N ── 1 rides
users 1 ── N eco_events
rides 1 ── 0..1 parking_passes
rides 1 ── 0..1 live_trips
rides 1 ── N live_seat_requests N ── 1 users
rides 1 ── N live_proximity_notices N ── 1 users
```

## Disponibilidad y concurrencia

Los lugares libres no se almacenan como contador mutable. Se calculan así:

```sql
rides.seats_total - SUM(reservations.seats WHERE status = 'confirmed')
```

Tanto una reserva normal como la aceptación de una solicitud ejecutan una transacción y bloquean `rides` con `SELECT ... FOR UPDATE`. Esto serializa operaciones simultáneas del mismo viaje y evita asignar dos veces el último asiento. `UNIQUE (ride_id, passenger_id)` impide duplicar una reserva por usuario.

## EcoPuntos

`eco_events` funciona como libro de movimientos; el saldo es la suma de `points`. Las operaciones persistentes son:

- publicar ruta: `+20`;
- reservar por primera vez: `+15`;
- generar el pase Parking por primera vez: regla GreenShare existente;
- completar como conductor: `40 + 10 × asientos confirmados`;
- completar como pasajero: `20 + 5 × asientos reservados`.

Completar bloquea el viaje y cambia `rides.status` a `completed`; un segundo intento falla y no duplica puntos. Reactivar una reserva cancelada no crea otro evento inicial.

## Seguimiento y retención

`live_trips.ride_id` es único. Cada lectura sobrescribe `lat`, `lng`, precisión, velocidad, rumbo y `updated_at`; no se almacena trayectoria. Al finalizar o cancelar:

```sql
status = 'finalizado', lat/lng/accuracy_m/speed_ms/heading = NULL
```

En la misma operación, las solicitudes todavía pendientes cambian a `cancelled`.

La interfaz solo utiliza una posición si tiene menos de 90 segundos. Precisión permitida: `0–100 m`.

## Solicitudes en vivo

El índice parcial `idx_live_request_pending` permite una única solicitud pendiente por pasajero/viaje. Al aceptar:

1. se bloquean solicitud y viaje;
2. se recalcula cupo confirmado;
3. se crea o reactiva `reservations`;
4. se marca solicitud `accepted`;
5. se confirma la transacción;
6. se envía el aviso fuera de la transacción.

## Índices relevantes

- `idx_rides_departure`, `idx_rides_direction`, `idx_rides_pickup_coords`.
- `idx_reservations_ride`.
- `idx_eco_events_user`.
- `idx_sessions_token`.
- `idx_live_trips_active`.
- `idx_live_request_pending`, `idx_live_request_driver`.
- unicidad `(ride_id,user_id,proximity_code)` para no repetir avisos.

## Aplicación segura

```powershell
npm run db:init
npm run db:check
```

No ejecutar semillas ni importaciones en producción. Antes de una migración real, crear una rama Neon o respaldo y probar `docs/schema-postgres.sql` allí. La integración no contiene `DROP`, `TRUNCATE` ni cambios destructivos.
