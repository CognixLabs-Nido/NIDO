# ADR-0028: Manifest mínimo en F5.5 vs PWA completa en F11

## Estado

`accepted`

**Fecha:** 2026-05-27
**Autores:** Responsable NIDO + Claude Code
**Fase del proyecto:** Fase 5.5 — Push notifications transversal

## Contexto

Para que un usuario de **iOS Safari** pueda recibir notificaciones push web, Apple exige que la web esté instalada como aplicación en pantalla de inicio (limitación introducida con iOS 16.4 en 2023). Esa instalación requiere:

1. Un archivo `public/manifest.json` con `name`, `short_name`, `display: standalone`, `start_url`, e iconos.
2. Meta tags `apple-touch-icon`, `apple-mobile-web-app-capable` y `apple-mobile-web-app-title` en el `<head>`.

Sin estos prerrequisitos, iOS Safari no muestra la opción "Añadir a pantalla de inicio" (o la muestra pero la web abierta desde el icono no recibe push). Chrome/Firefox/Edge desktop y Android Chrome no necesitan PWA-install para push, pero también respetan el manifest si existe.

El plan original de NIDO en `scope-ola-1.md` reserva la **PWA completa** (manifest + service worker con caching offline + estrategias de cache + actualización progresiva + lighthouse score PWA) para **F11 — Pulido final**. F5.5 llega antes; aún así necesita "algo" de manifest para que iOS funcione.

Hay que decidir si:

- A) F5.5 entrega un manifest **completo** y absorbe parte del scope de F11.
- B) F5.5 entrega un manifest **mínimo** (sólo lo necesario para push) y F11 lo extiende cuando llegue.
- C) F5.5 se hace sin iOS y se difiere la PWA-install para más tarde.

## Opciones consideradas

### Opción A: Manifest completo en F5.5 (absorber scope de F11)

Adelantar todo lo que está planificado para F11: manifest completo con `screenshots`, `categories`, `orientation`, `theme_color`, `background_color`, lighthouse PWA 90+, splash screens, etc. Incluiría también el service worker con estrategias de cache offline.

**Pros:**

- Una sola entrega "PWA" en lugar de dos pasos.
- iOS funciona desde el primer día.

**Contras:**

- F5.5 deja de ser "transversal acotado" y se convierte en "transversal + PWA". Se desdibuja.
- El service worker para caching offline necesita pruebas E2E específicas (estrategias por ruta, manejo de actualización del SW, expulsión del cache) que no caben en el tiempo de F5.5.
- F11 quedaría vacía o con tareas sueltas.

### Opción B: Manifest mínimo en F5.5; PWA completa en F11

F5.5 entrega únicamente:

- `public/manifest.json` con los campos imprescindibles para iOS PWA-install y la primera Lighthouse PWA Audit pasable (`name`, `short_name`, `description`, `start_url: '/es'`, `display: 'standalone'`, `theme_color`, `background_color`, `icons` 192/512 con `purpose: 'any maskable'`).
- 2 iconos PNG (192×192 y 512×512) generados desde el logo existente (procesados a través del script existente o manual).
- Meta tags iOS en el layout: `<link rel="manifest">`, `<link rel="apple-touch-icon">`, `<meta name="apple-mobile-web-app-capable">`, `<meta name="apple-mobile-web-app-title">`.
- Service Worker en `public/sw.js` que **solo** atiende eventos `push` y `notificationclick`. **Sin** lógica de offline/caching.

F11 luego añade lo restante: estrategias offline (network-first / cache-first por ruta), splash screens iOS, screenshots, `theme_color` ajustado al sistema de diseño definitivo, banner de "instalar app" en navegadores compatibles, manejo de actualizaciones del SW (`skipWaiting`, prompt al usuario), audit Lighthouse PWA ≥ 90.

**Pros:**

- Scope claro: F5.5 termina cuando push funciona en todas las plataformas objetivo. Punto.
- iOS Safari ≥ 16.4 funciona desde F5.5 (con instrucciones explícitas en UI: "Añade a pantalla de inicio").
- F11 conserva su scope original y puede iterar la PWA con base estable.
- Bajo riesgo de regresión: el SW de F5.5 hace una sola cosa.

**Contras:**

- iOS sin PWA-instalada no recibe push (limitación de Apple, no nuestra) y vemos un banner contextual explícito en `PushSettings` para guiar al usuario.
- El manifest queda "minimalista" durante el tiempo entre F5.5 y F11 — un Lighthouse PWA Audit completo no pasará al 100 % en ese intervalo.
- Existe una pequeña posibilidad de conflicto cuando F11 introduzca el SW con caching: hay que asegurar que la actualización del SW no rompe las suscripciones push existentes (versionado del SW + `skipWaiting`).

### Opción C: F5.5 sin iOS, PWA completa en F11

Lanzar push solo para Chrome/Firefox/Edge desktop + Android Chrome en F5.5. iOS queda fuera hasta F11.

**Pros:**

- Cero solapamiento con F11.
- Menos archivos/decisiones en F5.5.

**Contras:**

- iOS Safari es ~30 % del tráfico esperado de familias españolas (iPhone es muy mayoritario en padres jóvenes urbanos). Excluirlos de push hasta F11 erosiona el valor de la feature.
- F11 está varias fases por delante; "más adelante" se traduce en meses.

## Decisión

**Se elige la Opción B (manifest mínimo en F5.5, PWA completa en F11).**

Razones concretas:

1. **Cobertura de plataformas sin desbordar scope.** Apple exige PWA-install para push web; entregamos lo mínimo para que iOS Safari ≥ 16.4 pueda instalar y recibir. No entregamos caching offline, splash screens ni screenshots — eso pertenece al pulido de F11.
2. **F11 conserva sentido.** Si absorbiéramos PWA completa en F5.5, F11 se quedaría sin contenido y habría que reorganizar el roadmap. El manifest mínimo deja a F11 los problemas reales de offline-first (estrategias por ruta, fallbacks, actualizaciones del SW) sin haber pre-resuelto los ergonómicos.
3. **Riesgo bajo de regresión.** El SW de F5.5 solo expone dos listeners (`push`, `notificationclick`) y no tiene `fetch` interceptado. Cuando F11 introduzca el SW con caching, será un cambio incremental (añadir listeners + lógica de versión), no una sustitución.
4. **UX honesta con el usuario iOS.** El componente `PushSettings` detecta iOS sin PWA y muestra instrucciones explícitas: "Para iOS, añade NIDO a tu pantalla de inicio: Compartir → Añadir a pantalla de inicio". No intentamos `requestPermission` en ese estado (fallaría silenciosamente). Esto es UX mejor que "no funciona y no sabe por qué".

## Consecuencias

### Positivas

- F5.5 cierra con push funcionando en todas las plataformas objetivo.
- El manifest mínimo desbloquea iOS sin sumar trabajo a F11.
- El SW es minúsculo (~150 líneas con comentarios) y aislado: tests manuales de smoke + tests unit del helper son suficientes.
- F11 puede planificarse con la PWA completa en mente sin tener que deshacer nada.

### Negativas

- **Lighthouse PWA Audit no pasará al 100 % entre F5.5 y F11.** El manifest mínimo cubre lo necesario para iOS install pero no incluye `screenshots`, splash screens iOS específicos, ni el SW con offline. Auditorías intermedias mostrarán warnings; aceptado.
- **Versionado del SW al llegar F11.** Cuando F11 reemplace el SW con uno que sí tiene caching, hay que asegurar `skipWaiting` + prompt al usuario para refrescar. Si no se hace bien, las suscripciones push podrían quedar huérfanas durante la transición. Mitigación: incluir test E2E manual de "instalar SW v1 → activar push → desplegar SW v2 → push sigue llegando" antes de cerrar F11.
- **Theme color provisional.** El `theme_color` del manifest mínimo es un valor placeholder coherente con el sistema de diseño actual (ver `ADR-0008-design-system.md`). Cuando F11 ajuste el sistema de diseño definitivo, habrá que actualizarlo. Documentado como TODO en el spec.

### Neutras

- iOS antes de 16.4 queda totalmente fuera del push web — limitación de Apple no resoluble desde nuestra app. Se documenta en el spec como caso edge.
- El usuario que añade NIDO a home screen pero no activa notificaciones tendrá una experiencia parecida a una app instalada (icono propio, splash genérico) aunque sin offline. No es regresión — es una pequeña mejora gratis.

## Plan de implementación

- [x] `public/manifest.json` con campos mínimos + 2 iconos 192/512 con `purpose: 'any maskable'`.
- [x] Meta tags en `src/app/[locale]/layout.tsx`: `<link rel="manifest">`, `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`.
- [x] `public/sw.js` con solo `push` + `notificationclick`.
- [x] Detección iOS-sin-PWA en `useNotificationPermission` y UI específica en `PushSettings`.
- [x] Sección "Manifest mínimo" en `docs/specs/push-notifications.md` con TODOs para F11.
- [ ] F11 (futuro): manifest completo + SW con caching + lighthouse PWA ≥ 90 + plan de actualización del SW + theme color definitivo.

## Verificación

- iOS Safari 16.4+ acepta "Añadir a pantalla de inicio" y la web abierta desde el icono recibe push (smoke manual en producción tras merge).
- Chrome desktop, Firefox desktop, Edge desktop y Android Chrome reciben push sin necesidad de instalar como PWA.
- Lighthouse PWA Audit muestra el subconjunto esperado de checks pasados (manifest + iconos + start_url) y warnings explícitos en los pendientes (offline, screenshots) — esperado y documentado.

## Notas

- iOS exige que el manifest se sirva desde el mismo origen que la web. Como NIDO se sirve desde Vercel bajo el dominio único, no hay problema.
- Los iconos 192/512 son la unión mínima compatible. iOS preferiría 180×180 específico, pero el genérico 192 con `purpose: 'any maskable'` lo cubre.
- `start_url: '/es'` fuerza al usuario instalado a abrir en español por defecto. Cuando F11 introduzca selección de locale persistente, se puede valorar `start_url` parametrizable; mientras tanto, el redirect normal de NIDO lleva al locale preferido del navegador.
- El nombre del archivo es `sw.js` (no `service-worker.js` ni `pwa-sw.js`) por convención mayoritaria y para que F11 lo extienda sin renombrar.

## Referencias

- Spec: `/docs/specs/push-notifications.md`
- ADR-0025 — Push notifications fuera de F5
- ADR-0027 — Arquitectura de push notifications con server actions + `web-push`
- ADR-0008 — Design system (theme color provisional documentado allí)
- iOS PWA push (WebKit blog): https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Web App Manifest spec: https://www.w3.org/TR/appmanifest/
