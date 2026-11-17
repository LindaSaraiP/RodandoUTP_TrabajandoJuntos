# Pruebas de integración

Fecha de última ejecución local: **16 de noviembre de 2026**.

## Resultados ejecutados

| Prueba | Comando | Resultado |
|---|---|---|
| Sintaxis backend y frontend | `node --check` sobre servidor, módulos, app, live, assistant, SW y prueba v7 | Aprobada |
| Recomendador: parser, distancia, filtros y fuente real | `npm test` | 4 aprobadas |
| ETA y umbrales de proximidad | `npm test` | 3 aprobadas |
| Manifest, app shell, privacidad de caché y esquema | `npm test` | 4 aprobadas |
| Dependencias | `npm audit` | 0 vulnerabilidades conocidas |
| Revisión visual estática (1000×700) | Chromium con datos locales no persistentes | Sin desbordamiento horizontal ni errores de consola |
| Lighthouse visual | Chromium | Accesibilidad 1.00; Best Practices 1.00; SEO 1.00 |

Resultado automatizado sin base: **11/11 pruebas aprobadas**.

## Cobertura de `npm test`

- Horarios “7 de la mañana” y “7:30 pm”.
- Reconocimiento de Cholula/Angelópolis.
- Haversine y ausencia explícita de distancia si faltan datos.
- Exclusión de rutas llenas, canceladas o en sentido contrario.
- Garantía de que toda recomendación pertenece al arreglo suministrado por la fuente real.
- Colores verde, amarillo, naranja y rojo.
- ETA con velocidad GPS o respaldo conservador.
- Manifest instalable e iconos 192/512.
- Service Worker 7.0 con módulos integrados.
- Exclusión total de `/api/` del caché.
- Una sola interfaz/manifest y ausencia de historial GPS.
- Presencia del bloqueo `FOR UPDATE` para aceptación concurrente.

## Prueba PostgreSQL/HTTP/WebSocket preparada

`scripts/test-v7.js` ejecuta un flujo real contra un servidor y una base de **pruebas**:

1. health y sesiones de conductor, pasajeros y usuario ajeno;
2. publicación con coordenadas;
3. búsqueda geográfica;
4. reserva y rechazo de sobreventa;
5. recomendaciones comparadas contra IDs reales de `/api/rides`;
6. historial EcoPuntos persistente;
7. permisos, QR, PDF y verificación Parking;
8. inicio GPS y actualización de posición;
9. comprobación de que un usuario ajeno recibe `position: null`;
10. solicitud durante recorrido, aceptación y consumo del último asiento;
11. suscripción WebSocket usando cookie de sesión;
12. cancelación, invalidación del pase y borrado GPS;
13. PWA y recursos 7.0.

Ejecución:

```powershell
# Terminal 1, con .env apuntando a una BD de prueba preparada con npm run seed
npm start

# Terminal 2
npm run test:integration
```

El script elimina el viaje temporal y sus relaciones al terminar. Debe usarse en una base aislada porque depende de las cuentas demo documentadas en `scripts/seed-demo.js`.

En este equipo se intentó `npm run test:integration`; el proceso terminó antes de abrir conexiones o crear datos con el mensaje controlado `Falta DATABASE_URL`. No se reutilizó ninguna credencial ni base productiva.

El primer análisis detectó contraste insuficiente en el aviso inferior del asistente. Se oscureció el texto en `public/css/assistant.css`; la segunda ejecución alcanzó 1.00 y no reportó fallos.

## Pruebas no ejecutadas en este entorno

| Prueba pendiente | Motivo | Cómo completarla |
|---|---|---|
| Esquema y flujo completo PostgreSQL | No existe `DATABASE_URL`; Docker y `psql` no están instalados | Usar rama Neon de desarrollo y ejecutar los comandos anteriores |
| WebSocket entre dos navegadores | El servidor no puede iniciar sin PostgreSQL | Abrir conductor/pasajero tras aprobar `test:integration` |
| GPS físico | Requiere teléfono y HTTPS/localhost | Iniciar recorrido desde teléfono del conductor |
| Web Push real | Requiere claves VAPID y permiso del navegador | Configurar VAPID en entorno de prueba |
| Instalación PWA manual | Requiere servidor HTTPS o localhost activo | Revisar Application/Manifest/Service Worker en navegador |
| Responsive en teléfono real | Servidor bloqueado por falta de BD; la revisión Chromium fue a 1000×700 | Probar 360, 768 y 1280 px con DevTools |
| Groq opcional | No se configuró clave ni se autorizó consumo externo | Probar con límite bajo en una cuenta gratuita autorizada |

Estas funciones no se marcan como verificadas end-to-end hasta completar la prueba con infraestructura. El fallback determinista sí fue probado y no necesita Groq.

## Criterios observables durante la demostración

- Un no participante nunca debe recibir `position`.
- Al aceptar el último asiento, otra aceptación simultánea debe responder `409`.
- Si WebSocket se desconecta, la vista consulta cada 15 segundos.
- Una posición con precisión superior a 100 m debe rechazarse.
- Al cancelar/finalizar, el mapa deja de mostrar el automóvil.
- DevTools > Cache Storage no debe contener solicitudes `/api`.
- Las tarjetas del chat deben coincidir con viajes visibles y cupo de PostgreSQL.
