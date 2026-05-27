# ADR-0027: Arquitectura de push notifications con server actions + `web-push`

## Estado

`accepted`

**Fecha:** 2026-05-27
**Autores:** Responsable NIDO + Claude Code
**Fase del proyecto:** Fase 5.5 — Push notifications transversal

## Contexto

Tras cerrar F5 (mensajería + Realtime in-app) hay que añadir el canal "app cerrada": cuando un mensaje o anuncio llega y la familia no tiene NIDO abierto, debe sonar el móvil. ADR-0025 ya estableció que esta capacidad se aborda como módulo transversal F5.5 (no dentro de F5) para que F6, F7, F8, F9 y F10 la enchufen con un único punto de entrada.

Las decisiones de producto ya cerradas son:

- Granularidad: un toggle global ON/OFF por usuario, sin granularidad por tipo.
- Plataformas objetivo: Chrome/Firefox/Edge desktop, Android Chrome, iOS Safari ≥ 16.4 con la web instalada como PWA-lite.
- Eventos iniciales de F5.5: mensaje nuevo + anuncio nuevo. F6+ enchufan los suyos.

Falta decidir **cómo** se envían los push y desde **dónde**. Las restricciones del proyecto:

- NIDO ya tiene server actions de Next.js + Supabase. No queremos introducir un nuevo plano arquitectónico solo para push.
- El proyecto es open-source y self-host friendly: añadir un SaaS de pago como dependencia obligatoria sería un coste recurrente difícil de justificar para ANAIA y posibles centros futuros.
- El flujo "mensaje → push" requiere lookup cross-user (el autor no es el destinatario), lo que choca con la RLS que aísla `push_subscriptions` por usuario.

## Opciones consideradas

### Opción A: Edge Function de Supabase + cola

Un trigger BD en `mensajes` y `anuncios` invoca a una Edge Function (`notify-on-event`) que carga suscripciones del destinatario, llama a `web-push.sendNotification` y limpia los expirados. La cola opcional (Inngest, Trigger.dev) absorbe picos.

**Pros:**

- Desacoplo total: el server action no espera al envío.
- Reusable cross-proyecto sin cambios.
- Si en el futuro hay reintentos por retry exponential, la cola lo facilita.

**Contras:**

- Edge Functions de Supabase son un plano operativo nuevo (deploy separado, env vars duplicadas, logs en otro panel).
- En Supabase Cloud aún hay limitaciones: el SDK de `web-push` empaqueta bien pero requiere Deno, no Node. El paquete tiene polyfills pero el debugging es más opaco que en una server action de Next.
- Una cola añade complejidad operativa innecesaria para ANAIA (50 niños × 2 tutores × 2 dispositivos = ~200 envíos por anuncio al centro — cabe en una lambda).

### Opción B: Server actions de Next.js + paquete `web-push` directo

Tras el INSERT exitoso del mensaje/anuncio, el mismo server action de Next.js calcula destinatarios, invoca `enviarPushANotificarUsuarios` (helper server-side que importa `web-push`) y devuelve al cliente. El helper:

- Usa **service role** para leer `push_subscriptions` cross-user (la RLS por `usuario_id = auth.uid()` impediría leer suscripciones de otros).
- Paraleliza envíos con `Promise.allSettled`.
- Limpia automáticamente las suscripciones que reciben `410 Gone` o `404 Not Found`.
- No lanza nunca — un fallo de push no rompe la operación de mensajería (try/catch en el caller).

**Pros:**

- Cero planos nuevos: todo vive en `src/features/push/`.
- Una sola lambda por evento → menor latencia perceptible.
- Mock-friendly para tests: `vi.doMock('web-push', ...)` + service client mockeado.
- Reutilizable directamente desde cualquier futura fase (`import { enviarPushANotificarUsuarios } from '@/features/push/lib/enviar-push'`).
- `web-push` en Node es maduro y bien documentado.

**Contras:**

- El server action espera a `Promise.allSettled` antes de responder al cliente, sumando latencia (~50-500 ms típicos). Para ANAIA con audiencias pequeñas es asumible.
- Si las audiencias crecen mucho (Ola 2 multi-centro con miles de tutores), habrá que mover el envío a una cola — refactor previsto, no bloqueante hoy.
- No hay log de entregas persistido (tabla `notificaciones_push` queda diferida). Solo `console.error` server-side en Vercel logs.

### Opción C: Proveedor SaaS (OneSignal, Pushwoosh, Pusher Beams)

Outsourcing total: la app delega push al SaaS, que se encarga de endpoints, certificados Apple, FCM, etc.

**Pros:**

- Cero infra mantenida por nosotros.
- Analytics de entrega out-of-the-box.
- iOS y Android nativo (no solo web push) cuando llegue la app empaquetada.

**Contras:**

- Tier gratuito limitado (OneSignal 10k suscripciones, Pusher 1k); ANAIA aún está lejos pero la sombra del coste recurrente está ahí.
- Vendor lock-in: cada SaaS tiene su SDK, su modelo de "tags" y "segments". Cambiar luego es trabajoso.
- Privacidad: los datos de las familias (suscripciones, payloads incluso si solo es un id) salen a un tercero. Para una app con menores y RGPD es un argumento serio que requeriría DPA con el proveedor.
- Mayor superficie de auditoría legal (RGPD, Schrems II si el SaaS es USA).

### Opción D: No hacer push en F5.5, esperar a Ola 2

Cerrar F5 con badge in-app vía Realtime y posponer push hasta Ola 2 con la app empaquetada nativa.

**Pros:**

- Menos código en Ola 1.

**Contras:**

- Resta competitividad frente a Tyra/Schooltivity, que sí avisan a familias con app cerrada.
- ADR-0025 ya decidió que F5.5 entra en Ola 1. Revertirlo abriría una grieta en el plan que no necesita revertirse.

## Decisión

**Se elige la Opción B (server actions de Next.js + `web-push` directo).**

Razones concretas:

1. **Mismo plano arquitectónico que el resto del backend.** Cero contexto nuevo para entender el flujo: `enviar-mensaje.ts` invoca `enviarPushANotificarUsuarios` justo después del INSERT. Cualquiera que sepa leer una server action ya entiende el push.
2. **Privacidad-by-default.** Las suscripciones y el contenido del payload no salen de nuestra infra. Solo el proveedor del navegador (FCM para Chrome, Mozilla Push, APNs vía Safari) toca el endpoint, y eso es inherente a Web Push — no hay forma de evitarlo eligiendo otro proveedor.
3. **Coste cero.** Cero suscripciones SaaS, cero tier limits, cero DPA adicionales. La única dependencia es el paquete npm `web-push`, MIT-licensed.
4. **Reusable para F6+ sin refactor.** Cualquier fase futura llama a la misma función con su payload. La firma `(usuarioIds, payload)` es la mínima necesaria.
5. **Latencia aceptable hoy.** ~200 envíos en paralelo con `Promise.allSettled` caben holgadamente en una Vercel function de 60s. Cuando crezca, se introducirá una cola — esa refactorización aislada en un único helper es menos riesgo que vivir con un plano arquitectónico extra hoy.

Opciones descartadas y por qué:

- **A (Edge Function)** introduce un plano nuevo cuya única ventaja (desacoplar el envío del INSERT) se compensa con `try/catch` silencioso. No paga el coste.
- **C (SaaS)** asume coste recurrente y privacidad compartida sin contrapartida proporcional para una app open-source con foco RGPD.
- **D (esperar)** contradice ADR-0025 sin nuevos argumentos.

## Consecuencias

### Positivas

- Toda la lógica de push vive bajo `src/features/push/` (un único feature folder).
- Tests unit con mocks de `web-push` + cliente service-role mockeado: rápidos, deterministas, sin red.
- F6/F7/F8/F9/F10 enchufan su propio payload con una sola línea: `await enviarPushANotificarUsuarios(destinatarios, { titulo, cuerpo, url, datos })`.
- VAPID keys gestionadas como cualquier otra credencial (`.env.local` en dev, Vercel env vars en prod). Procedimiento de rotación documentado en `docs/operations/vapid-rotation.md`.
- Limpieza automática de suscripciones expiradas vía la respuesta `410/404` del servicio push — sin cron ni job manual.

### Negativas

- El server action de mensajería es ~200 ms más lento en el escenario pesimista (anuncio al centro entero, ~200 envíos). Aceptable; si llega a ser problema, se mueve a Promise.race + best-effort más agresivo o se introduce cola.
- No hay log persistido de entregas: si una familia reporta "no me llegó el push del lunes", solo tenemos los `console.error` en Vercel logs (con retención limitada). Mitigación: documentado como caso edge en el spec; se reevalúa si aparecen demandas recurrentes de auditoría.
- Acoplo a `web-push` como paquete npm. Es muy estable, pero un cambio breaking nos afectaría directamente. Mitigación: el helper está aislado en un único archivo (`enviar-push.ts`) — fácil de sustituir si hace falta.
- Cualquier futuro caso con audiencia > 1000 destinatarios necesitará mover el envío a cola/cron. Decisión consciente: pagar ese refactor cuando haga falta, no antes.

### Neutras

- Los desarrolladores aprenden que **el cliente service-role solo se usa en helpers server-side** (`enviarPushANotificarUsuarios`, `destinatariosDeConversacion`, `destinatariosPushDeAnuncio` y `getAutorPushInfo`). Nunca expuesto al cliente.
- El SW vive en `public/sw.js` (servido directo, no a través del bundler). El bundle de cliente sube ~3 KB por la lógica de subscribe/unsubscribe.

## Plan de implementación

- [x] Tabla `push_subscriptions` con RLS de aislamiento por usuario (migración `20260527090605_phase5_5_push_subscriptions.sql`).
- [x] Schema Zod (`schemas/push.ts`) + tests unit.
- [x] Server actions `suscribir-a-push`, `desuscribir-push`, `actualizar-actividad-push`.
- [x] Helper server-side `enviarPushANotificarUsuarios` con tests unit y mocks de `web-push`.
- [x] Helpers de audiencia: `destinatariosDeConversacion`, `destinatariosPushDeAnuncio`, `getAutorPushInfo` (service role).
- [x] Hooks en `enviar-mensaje.ts` y `publicar-anuncio.ts` con try/catch silencioso.
- [x] Service Worker `public/sw.js` con eventos `push` y `notificationclick`.
- [x] UI: `PushSettings` (en `/profile`) + `PushBanner` (en `/messages` para tutor/profe).
- [x] i18n trilingüe en namespace `push.*`.
- [x] Tests RLS (`src/test/rls/push.rls.test.ts`) cubriendo aislamiento + CASCADE.
- [x] Documentación: spec, rotación VAPID, ADR-0027 (este), ADR-0028 (manifest split).

## Verificación

- Tests unit verdes en CI: schema (11 tests) + helper `enviar-push` (9 tests).
- Tests RLS verdes: aislamiento SELECT/INSERT/UPDATE/DELETE entre usuarios + CASCADE on delete usuario + UNIQUE constraint.
- Smoke manual en producción tras merge (validado por el responsable): mensaje profe → tutor con push activado → notificación nativa. Click navega a la URL correcta. Anuncio del centro → todos los tutores con permiso reciben push. Profes no reciben push de anuncios.
- Las suscripciones expiradas se limpian automáticamente al recibir `410/404` del servicio push.

## Notas

- La estructura `usuario_id INTERVIENE → endpoint` permite múltiples dispositivos por usuario (móvil + portátil) sin colisión, gracias al `UNIQUE(usuario_id, endpoint)`.
- El SW NO incluye lógica de caching/offline — eso queda para F11 (PWA completa). Aquí solo cubrimos push.
- El `payload.titulo` para anuncios usa el locale del autor (decisión documentada en el spec) — limitación aceptada en F5.5; multi-locale por destinatario queda para Ola 2 si se demanda.
- Si en algún momento se introduce OneSignal o similar, el helper `enviarPushANotificarUsuarios` es el único punto a sustituir — el resto de la app no cambia.

## Referencias

- Spec: `/docs/specs/push-notifications.md`
- ADR-0025 — Push notifications fuera de F5
- ADR-0028 — Manifest mínimo en F5.5 vs PWA completa en F11
- `docs/operations/vapid-rotation.md`
- Web Push API (MDN): https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- Paquete npm `web-push`: https://github.com/web-push-libs/web-push
- VAPID (RFC 8292): https://datatracker.ietf.org/doc/html/rfc8292
