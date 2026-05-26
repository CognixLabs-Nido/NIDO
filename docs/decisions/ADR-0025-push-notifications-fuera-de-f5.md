# ADR-0025: Push notifications fuera de F5 (módulo transversal F5.5)

## Estado

`accepted`

**Fecha:** 2026-05-25
**Autores:** Responsable NIDO + Claude Code
**Fase del proyecto:** Fase 5 — Mensajería profe ↔ familia + anuncios

## Contexto

Mensajería sería el primer módulo "natural" para introducir notificaciones push (un mensaje nuevo o un anuncio publicado son disparadores obvios). Pero push es **transversal**: F6 (recordatorios bidireccionales), F7 (eventos de calendario), F8 (autorizaciones a firmar), F9 (informes publicados) y F10 (publicaciones del aula) lo querrán igual.

Si la infraestructura de push se construye dentro del scope de F5 ("push de mensajes y anuncios"), las fases siguientes tendrán que decidir entre:

- **Reutilizar mal**: pegar más triggers ad-hoc al servicio creado en F5, ensuciando su responsabilidad.
- **Reimplementar**: cada fase montará su propia ruta push y acabaremos con 5 caminos paralelos para el mismo concepto.

Push tiene además componentes específicos (registro de Service Worker, suscripciones del navegador, proveedor — Web Push API o OneSignal —, edge function que invoca al proveedor, tabla `push_subscriptions`, tabla `notificaciones_push` con log de entregas, UI opt-in) que no son trivialmente "cosa de mensajería".

## Opciones consideradas

### Opción A: Push dentro del scope de F5

Construir la infraestructura push en F5 y conectarla solo a `mensajes` y `anuncios`.

**Pros:**

- F5 cierra con notificaciones reales — usuario lo nota.

**Contras:**

- El módulo push queda como sub-feature de mensajería; F6/F7/F8 lo tendrán que extraer luego, lo cual es exactamente el tipo de refactor que se evita siempre que se planifica bien.
- Triggers de push en `mensajes` y `anuncios` añaden complejidad a la spec de mensajería. La spec se diluye.

### Opción B: Crear F5.5 como módulo transversal

Tras F5, una fase intermedia "F5.5 push notifications" añade la infraestructura común (tablas, edge function, registro Service Worker, opt-in UI) y la conecta retroactivamente a mensajes y anuncios. F6+ heredan la infraestructura tal cual.

**Pros:**

- Separación de responsabilidades clara: F5 = lógica de negocio (qué se envía y a quién), F5.5 = canal técnico (cómo se entrega).
- F5 termina con badge in-app vivo (Realtime + UI) — suficiente para que la familia vea novedades cuando tiene la app abierta. Push viene a cubrir el caso "app cerrada".
- Reutilización inmediata en F6/F7/F8 sin refactor.
- Tests E2E de F5 quedan acotados a Realtime, que es lo verdaderamente diferencial.

**Contras:**

- F5 cierra sin push real. Si una familia no abre la app, no se entera del mensaje (espacio de mejora de hasta F5.5).
- F5.5 es una fase extra en el plan.

### Opción C: Push diferido a Ola 2

Quitar push por completo de Ola 1 y replantear en Ola 2.

**Pros:**

- Ola 1 más estrecha y rápida.

**Contras:**

- Resta competitividad frente a Tyra/Schooltivity, que sí envían push.
- Decisión no realista para producto: las familias esperan recibir un aviso aunque la app esté cerrada.

## Decisión

**Se elige la Opción B (F5.5 transversal)** porque preserva la coherencia arquitectónica y evita que cada fase posterior reinvente el canal push. F5 entrega lo verdaderamente diferencial (Realtime + UI + badge in-app); F5.5 añade el canal de entrega cuando la app está cerrada y lo deja listo para que F6, F7, F8, F9 y F10 lo enchufen.

## Consecuencias

### Positivas

- Spec y código de F5 enfocados en mensajería pura.
- F5.5 puede tomarse el tiempo necesario para evaluar OneSignal vs Web Push nativa vs híbrido, evaluar el flujo de opt-in (con consentimientos), permisos del navegador, fallback offline, etc.
- Las fases posteriores tienen un canal estandarizado: triggers o edge functions invocan a la misma cola/función `notify-on-event` con un payload normalizado.

### Negativas

- F5 cierra sin push. Durante la ventana entre F5 y F5.5 una familia que no abra NIDO no se entera de mensajes nuevos hasta su próxima visita. Mitigación: F5.5 inmediatamente después; la ventana es de días, no semanas.
- Coste adicional en el roadmap: una fase nueva.

### Neutras

- La tabla `push_subscriptions` y `notificaciones_push` no se crean en F5. Su esquema se define en F5.5 cuando se valide el proveedor.

## Plan de implementación

- [x] F5 entrega: badge global en sidebar con Realtime, sin push.
- [ ] F5.5 entrega (futuro): tabla `push_subscriptions`, edge function `notify-on-mensaje-o-anuncio`, registro de Service Worker en cliente, opt-in UI, política RLS sobre `push_subscriptions`, integración con proveedor decidido. Triggers en `mensajes` y `anuncios` que invocan la edge function.
- [ ] F6 en adelante: cada nueva trigger (recordatorio creado, evento confirmado, autorización firmada) llama al mismo `notify-on-event` con su propio payload.

## Verificación

- F5 cierra con badge in-app funcionando vía Realtime (tests Playwright lo cubren).
- Cuando F5.5 se cierre, los tests Playwright de F5 (`mensaje-realtime`, `anuncio-aula`, `leer-baja-badge`) seguirán pasando: push se añade sin tocar la lógica existente.

## Notas

El nombre "F5.5" sigue el precedente F4.5 (calendario laboral) usado cuando una fase técnica intermedia simplifica las siguientes. Mantiene la numeración estable para los desarrollos posteriores.

## Referencias

- Spec: `/docs/specs/messaging.md` § "Eventos y notificaciones"
- ADR-0023 — Modelo de mensajería con 5 tablas
- ADR-0024 — Participantes y audiencia calculados dinámicamente
