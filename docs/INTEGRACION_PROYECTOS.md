# Integración de los tres proyectos

## Resultado arquitectónico

RodandoUTP GreenShare 7.0 es una sola PWA. GreenShare aporta la interfaz y el modelo principal; la lógica reutilizable de seguimiento y recomendaciones fue adaptada al servidor CommonJS y a las tablas existentes. No se copiaron `.git`, interfaces completas ni backends paralelos.

## Matriz de integración

| Funcionalidad | Repositorio de origen | Estado encontrado | Acción aplicada |
|---|---|---|---|
| Diseño GreenShare | `RodandoUTP-GreenShare` | Completo y responsivo | Conservado como sistema visual principal |
| Registro, sesión y perfil | GreenShare | Funcional con cookie HttpOnly, CSRF y PostgreSQL | Conservado; usado también por WebSocket |
| Búsqueda/publicación | GreenShare | Funcional con mapas y filtros | Conservado y conectado al asistente |
| Reservas | GreenShare | Transacción con `FOR UPDATE` | Conservado; reutilizado por solicitudes en vivo |
| EcoPuntos | GreenShare | Saldo, niveles y asignación persistente | Se añadió historial; finalización en vivo usa la misma transacción |
| Rodando Parking | GreenShare | QR, PDF, verificación y pase persistente | Conservado en la navegación única |
| GPS y ETA | `netfoor/pwa-rodando-utp` | Implementación funcional separada con JWT/Express | Adaptada a `lib/live-tracking.js`, cookie GreenShare y tablas GreenShare |
| WebSocket | netfoor | Salas por viaje con autorización | Integrado al mismo servidor HTTP en `/api/live/ws` |
| Solicitudes durante recorrido | netfoor | Pendiente/aceptada/rechazada | Adaptada con bloqueo de viaje y reserva real |
| Proximidad y push | netfoor | ETA y avisos deduplicados | Adaptada a cuatro umbrales y notificaciones GreenShare |
| Motor de sugerencias | `Villegas0117/RodandoUTP` | “IA simulada”: grafo/reglas y datos de demostración | Portado conceptualmente a Node.js; ahora puntúa viajes reales de PostgreSQL |
| Chat flotante | Villegas0117 | No era un chat integrado a GreenShare | Creado como componente flotante GreenShare |
| PostgreSQL/Neon | Los tres | Modelos y autenticaciones incompatibles | Se conserva un solo esquema GreenShare y se agregan tres tablas en vivo |
| PWA/offline | Los tres | Service Workers distintos | Se conserva un único Service Worker 7.0 sin caché privada |

## Decisiones principales

### Backend único

GreenShare usa un servidor HTTP Node.js sin Express. Reemplazarlo por los otros backends introducía dos autenticaciones y rutas duplicadas, por lo que se mantuvo `server.js` y se extrajeron módulos de dominio:

- `lib/recommendations.js`: parser local, cercanía Haversine, compatibilidad horaria y puntuación.
- `lib/live-tracking.js`: autorización, ETA, solicitudes, notificaciones y WebSocket.
- `server.js`: autenticación, rutas, reservas, EcoPuntos y Parking compartidos.

### Autenticación y tiempo real

El proyecto netfoor usaba JWT/ticket efímero. La integración no expone JWT: el handshake WebSocket recibe la misma cookie `rodando_session` HttpOnly, consulta `sessions` y valida la participación antes de suscribir el socket. Cada difusión vuelve a construir una vista autorizada; un usuario que pierde la reserva deja de recibir coordenadas.

### Recomendaciones reales

El proyecto Villegas declaraba correctamente su motor como simulado y utilizaba un grafo de zonas. La integración conserva el enfoque explicable, pero elimina conductores de demostración como fuente de respuesta. `POST /api/recommendations` consulta `rides`, `reservations` y `users`; descarta viajes llenos/inactivos y ordena por:

1. distancia al punto de abordaje cuando hay coordenadas;
2. diferencia de horario;
3. porcentaje de lugares disponibles;
4. conductor verificado;
5. ruta directa o conexión.

Groq es opcional y solo interpreta texto. Hugging Face Inference Providers no ofrecía créditos mensuales para cuentas Free al momento del análisis; no se incorporó una dependencia obligatoria ni se activó consumo facturable.

### Privacidad GPS

- Consentimiento registrado al iniciar.
- Solo se conserva una fila por `ride_id` en `live_trips`.
- No existe tabla de historial de posiciones.
- Lecturas de más de 90 segundos se consideran caducadas.
- Finalizar o cancelar pone el seguimiento en `finalizado` y borra coordenadas.
- `/api/` está fuera del Cache API.

## Flujo entre módulos

```text
Usuario ──publica──> rides
Pasajero ──reserva──> reservations ──habilita──> GPS/WebSocket
Conductor ──inicia──> live_trips ──ETA──> aviso de proximidad
Solicitud en vivo ──aceptar──> reservations (misma disponibilidad)
Finalizar viaje ──> rides.completed + eco_events + GPS eliminado
Asistente ──consulta──> rides + reservations + users
Parking ──genera──> parking_passes asociado al viaje y participantes
```

## Archivos incorporados o modificados

- `lib/recommendations.js`
- `lib/live-tracking.js`
- `public/js/assistant.js`
- `public/js/live.js`
- `public/css/assistant.css`
- `public/css/live.css`
- `public/index.html`
- `public/service-worker.js`
- `public/manifest.webmanifest`
- `docs/migrations/007-unified-live-tracking.sql`
- `tests/*.test.js`
- `scripts/test-v7.js`

Los repositorios originales se analizaron en una carpeta temporal fuera del destino y permanecen sin modificaciones.
