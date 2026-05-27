---
feature: push-notifications
wave: 1
phase: 5.5
status: draft
priority: high
last_updated: 2026-05-27
related_adrs: [ADR-0025, ADR-0027, ADR-0028]
related_specs: [messaging]
---

# Spec — Push notifications transversal (Fase 5.5)

> Capa común de notificaciones push web para NIDO. Cubre Chrome/Firefox/Edge desktop, Android Chrome y iOS Safari (instalado en pantalla de inicio). Esta fase la conecta a mensajes y anuncios; F6+ la enchufan a sus propios eventos sin tocar la infraestructura.

## Resumen ejecutivo

Implementa el **motor de push** que enviará avisos al usuario cuando NO tiene la app abierta. Es complemento de Realtime — Realtime mantiene el badge in-app vivo mientras la sesión está activa; push cubre el hueco "app cerrada".

- Una tabla nueva `push_subscriptions` con RLS de aislamiento estricto por usuario.
- Server actions de Next.js (`suscribir-a-push`, `desuscribir-push`) + helper server-side `enviarPushANotificarUsuarios`. Sin Edge Functions de Supabase (ADR-0027).
- Service Worker mínimo en `public/sw.js` que pinta la notificación y la abre al hacer click.
- Manifest mínimo `public/manifest.json` + meta tags iOS para que la web pueda añadirse a pantalla de inicio y recibir push en iOS Safari 16.4+ (ADR-0028 documenta por qué el manifest llega ya en F5.5 y no espera a F11).
- Hook automático en `enviar-mensaje` y `publicar-anuncio`: tras INSERT exitoso, identificar destinatarios y enviar push. El envío NO bloquea la respuesta del action — un fallo en el motor de push no rompe el mensaje persistido.
- Componente `PushSettings` con toggle global ON/OFF por usuario y banner iOS si el usuario llega desde Safari sin instalar.

## Contexto

ADR-0025 fijó que push se separa de F5 para no contaminar la spec de mensajería con la complejidad de notificación cross-device. Ahora se aborda como módulo transversal con dos hooks iniciales (mensajes, anuncios) y la infraestructura preparada para que F6 (recordatorios), F7 (eventos), F8 (autorizaciones), F9 (informes) y F10 (publicaciones) reutilicen `enviarPushANotificarUsuarios` sin re-arquitectura.

Decisiones de producto ya cerradas (no replantear):

- **Granularidad**: un único toggle global ON/OFF por usuario. Sin granularidad por tipo de notificación en F5.5; si en Ola 2 se demanda, se añadirá una tabla `push_preferencias` sin afectar al motor de envío.
- **Plataformas**: Chrome/Firefox/Edge desktop, Android Chrome, iOS Safari 16.4+ con la web instalada en pantalla de inicio (PWA-lite). El manifest mínimo de F5.5 es prerrequisito para iOS; la PWA completa con offline llega en F11.
- **Eventos iniciales**: mensaje nuevo + anuncio nuevo. F6/F7/F8/F9/F10 enchufarán sus propios disparadores cuando llegue cada fase.
- **Arquitectura**: server actions + paquete `web-push`. **Sin** Edge Functions de Supabase (justificación en ADR-0027). El envío se hace desde el server action de mensajería con `await` en try/catch silencioso, no bloqueante respecto al resultado al usuario.

## User stories

- **US-35**: Como **tutor legal con push activado**, quiero recibir una notificación en mi móvil cuando la profe me escriba aunque tenga NIDO cerrado, para no perderme avisos importantes.
- **US-36**: Como **tutor legal**, quiero activar las notificaciones desde un único interruptor sin tener que configurar por tipo. Lo quiero todo o nada.
- **US-37**: Como **profe**, quiero que cuando un tutor me responda en la conversación de un niño, mi móvil vibre con la notificación.
- **US-38**: Como **admin**, quiero que mi anuncio al centro llegue al móvil de todos los tutores activos sin tener que avisarles por WhatsApp.
- **US-39**: Como **usuario iOS Safari**, quiero instrucciones claras de "añadir a pantalla de inicio" para poder activar push (limitación de Apple — sin home-screen install no hay push web en iOS).
- **US-40**: Como **usuario**, quiero poder desactivar las notificaciones en cualquier momento desde mi perfil sin tener que ir a ajustes del navegador.
- **US-41**: Como **usuario que cambia de dispositivo**, quiero que las suscripciones obsoletas se limpien automáticamente (sin spam de notificaciones a teléfonos que ya no uso).

## Alcance

**Dentro:**

- Tabla `push_subscriptions` con RLS de aislamiento por usuario.
- Server actions: `suscribir-a-push`, `desuscribir-push`, `actualizar-actividad-push`.
- Helper server-side `enviarPushANotificarUsuarios(usuario_ids, payload)` reutilizable por cualquier fase.
- Hooks en `enviar-mensaje.ts` y `publicar-anuncio.ts` que llaman al helper tras INSERT exitoso.
- Service Worker `public/sw.js` (push + notificationclick).
- Manifest `public/manifest.json` y meta tags iOS en el layout.
- Componente cliente `PushSettings` y banner contextual iOS.
- i18n trilingüe (es/en/va) en namespace `push.*`.
- Variables de entorno VAPID (público + privado + subject) en Vercel.
- ADRs 0027 (arquitectura) y 0028 (manifest split F5.5 vs PWA F11).
- Tests unit (actions, helper), tests RLS (aislamiento), smoke manual documentado.

**Fuera (no se hace aquí):**

- **PWA completa con offline / caching**: se aborda en F11. El service worker de F5.5 cubre solo push.
- **Granularidad por tipo** (silenciar mensajes pero mantener anuncios): Ola 2 si se demanda.
- **Push schedulado / digest diario**: Ola 2.
- **Notificaciones in-app persistentes** (lista de notificaciones en la web tipo Twitter): el sustituto en F5.5 sigue siendo el badge in-app de Realtime de F5.
- **Multi-idioma del payload de la notificación**: la notificación se construye con el locale del usuario remitente, no del destinatario. Documentado como caso edge.
- **Provider tipo OneSignal**: descartado en ADR-0027. Vamos con `web-push` directo.
- **Tabla `notificaciones_push` con log de entregas**: queda fuera de F5.5; los `console.error` server-side son suficientes en esta fase. Si en F6+ aparece necesidad de auditar entregas, se añade entonces.
- **E2E de Playwright para push**: el service worker en CI headless es frágil. Se documenta smoke manual y se cubre lo testeable (acciones, helper, RLS) con unit + RLS.

## Comportamientos detallados

### B35 — Activación del push (primera vez)

**Pre-condiciones:**

- Usuario autenticado en NIDO.
- Navegador soporta `Notification` y `serviceWorker` (los 3 navegadores objetivo lo soportan; iOS Safari requiere PWA-instalada).

**Flujo:**

1. Usuario va a `/profile` o ve el banner contextual en `/messages`.
2. Pulsa "Activar notificaciones".
3. Cliente detecta plataforma:
   - **Desktop/Android**: `Notification.requestPermission()` → si `granted`, sigue al paso 4.
   - **iOS sin PWA instalada**: muestra modal "Para iOS, añade NIDO a pantalla de inicio: Compartir → Añadir a pantalla de inicio. Después abre desde el icono y vuelve aquí". **No** intenta `requestPermission` — fallaría silenciosamente.
   - **iOS con PWA instalada** (detectado por `display-mode: standalone` o `navigator.standalone`): igual que desktop.
4. `navigator.serviceWorker.register('/sw.js')` → espera ready.
5. `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`.
6. Llama a server action `suscribir-a-push({ endpoint, p256dh, auth, user_agent })`.
7. Server action hace UPSERT en `push_subscriptions` por `(usuario_id, endpoint)`.
8. UI muestra toast "Notificaciones activadas" y el toggle queda en ON.

**Post-condiciones:**

- Una fila en `push_subscriptions` para este usuario y endpoint.
- Service Worker registrado y activo en el navegador.

### B36 — Recepción de un push tras mensaje nuevo

**Pre-condiciones:**

- Tutor A (destinatario) tiene una suscripción válida en `push_subscriptions`.
- Profe B envía un mensaje al niño cuya conversación incluye al Tutor A.

**Flujo:**

1. Profe B invoca el action `enviarMensaje(ninoId, contenido)` (F5).
2. El action persiste el mensaje (lógica de F5 intacta).
3. Tras el INSERT exitoso, el action invoca `enviarPushANotificarUsuarios(destinatarios, payload)`:
   - **Destinatarios**: otros participantes de la conversación, calculados como en la RLS de SELECT (`puede_participar_conversacion`): profe activo del aula y tutores con `puede_recibir_mensajes`. Se excluye al autor.
   - **Payload**:
     ```ts
     {
       titulo: '<Nombre del autor>',
       cuerpo: '<primeros 100 chars del mensaje>',
       url: '/<locale>/messages/conversacion/<id>',
       datos: { tipo: 'mensaje', conversacion_id, nino_id },
     }
     ```
4. El helper:
   - Carga `push_subscriptions` de esos `usuario_ids` con **service role client** (porque la RLS exige `usuario_id = auth.uid()` y el invocador no es el destinatario).
   - Por cada suscripción, llama a `webpush.sendNotification(subscription, JSON.stringify(payload))`.
   - **410 Gone**: la suscripción está expirada → DELETE de esa fila.
   - **Otros errores**: `console.error` y sigue (no bloquea al resto).
5. El service worker del dispositivo del tutor recibe el evento `push`, parsea el payload y llama a `self.registration.showNotification(titulo, opciones)`.
6. Tutor ve la notificación.

**Post-condiciones:**

- Mensaje persistido (idéntico a F5).
- Push entregado a cada dispositivo registrado del destinatario (best-effort, no garantizado).

### B37 — Recepción de un push tras anuncio nuevo

**Pre-condiciones:**

- Profe o admin publica un anuncio.

**Flujo:**

1. Action `publicarAnuncio(input)` persiste el anuncio (lógica F5 intacta).
2. Tras INSERT exitoso, calcula audiencia:
   - Para `ambito='aula'`: tutores activos del aula con `puede_recibir_mensajes`.
   - Para `ambito='centro'`: tutores activos del centro con `puede_recibir_mensajes`.
   - **No** se incluyen profes ni admin como destinatarios push del anuncio (ellos lo ven in-app pero el push apuntaba a familias; tabla `roles_usuario` se consulta para excluir).
3. Llama a `enviarPushANotificarUsuarios(audiencia, payload)`:
   ```ts
   {
     titulo: ambito === 'centro' ? 'Nuevo anuncio del centro' : 'Nuevo anuncio del aula',
     cuerpo: '<primeros 100 chars del contenido>',
     url: '/<locale>/messages/anuncios/<id>',
     datos: { tipo: 'anuncio', anuncio_id },
   }
   ```

**Post-condiciones:**

- Anuncio persistido.
- Push entregado a cada destinatario.

### B38 — Click en notificación

**Flujo:**

1. Usuario pulsa la notificación en su dispositivo.
2. Service Worker `notificationclick`:
   - `notification.close()`.
   - `clients.matchAll({ type: 'window', includeUncontrolled: true })` → si existe una ventana de NIDO abierta, `client.focus()` + `client.navigate(url)`.
   - Si no, `clients.openWindow(url)`.
3. La ventana navega a la conversación o al anuncio.

### B39 — Desactivación de push

**Pre-condiciones:**

- Usuario tiene la suscripción activa.

**Flujo:**

1. Usuario en `/profile` pulsa "Desactivar notificaciones".
2. Cliente: `registration.pushManager.getSubscription()` → `subscription.unsubscribe()`.
3. Llama a `desuscribir-push({ endpoint })`.
4. Server action DELETE la fila de `push_subscriptions` para `(usuario_id, endpoint)`.

**Post-condiciones:**

- Suscripción eliminada de BD y del navegador.

### B40 — Limpieza automática de suscripciones expiradas

**Flujo:**

1. Helper `enviarPushANotificarUsuarios` recibe `410 Gone` (la API push del navegador ha invalidado el endpoint).
2. DELETE la fila de `push_subscriptions` correspondiente sin notificar al usuario.
3. `console.error` para trazabilidad mínima.

**Post-condiciones:**

- Las suscripciones inválidas no acumulan basura en BD ni causan errores repetidos.

## Casos edge

- **Usuario sin suscripciones**: el envío no falla; el helper simplemente devuelve sin operar. Se loguea el caso para diagnóstico.
- **Usuario con varias suscripciones activas** (móvil + portátil): se envía a cada endpoint independientemente. Si una falla, el resto no se ven afectados.
- **Mensaje muy largo**: el `cuerpo` se trunca a 100 chars con `…` si excede.
- **Mensaje marcado como erróneo después del envío**: el push ya se envió. No se re-notifica la corrección. Documentado como limitación esperada — el patrón `[anulado] ` ya está en F5 para que el usuario vea el cambio al abrir la app.
- **Audiencia vacía** (todos los tutores con `puede_recibir_mensajes=false` o anuncio sin nadie en el aula): el action persiste pero el push no se envía. No es un error.
- **Action ejecutado por usuario sin push activado**: irrelevante, el sujeto es el destinatario, no el autor.
- **iOS Safari sin PWA-install**: detectar y mostrar instrucción explícita. No mostrar el botón "Activar" en ese estado para no engañar.
- **Permiso `denied` por el usuario**: estado "denegado" en UI con copy "Has bloqueado las notificaciones. Para activarlas, ve a Ajustes del navegador → NIDO → Notificaciones".
- **Navegador sin soporte de Service Worker** (raro en 2026): estado "unsupported", botón deshabilitado.
- **VAPID keys ausentes en el entorno** (dev local sin .env.local con las claves): el helper detecta y devuelve early con `console.error('VAPID no configurado')`. Mensajería sigue funcionando — solo no se envía push.
- **Concurrencia: dos sesiones del mismo usuario se suscriben a la vez**: el UNIQUE `(usuario_id, endpoint)` + UPSERT evita duplicados.
- **Idioma del payload**: el titulo "Nuevo anuncio del centro/aula" usa el locale **del autor** (el que ejecuta `publicarAnuncio`), no del destinatario. Es una limitación aceptada en F5.5 — el cuerpo es el contenido del autor, así que mezcla de idiomas en una sesión multilingüe es esperable. Para Ola 2 se valorará multi-locale.
- **El destinatario no es el mismo que el autor** del action, así que el cliente Supabase del action (autenticado como autor) NO tiene RLS para leer `push_subscriptions` del destinatario. El helper usa el **service role client** para esa lectura. La service role key nunca se expone al cliente.
- **Test E2E de service worker en CI headless**: descartado por fragilidad. Cobertura via unit (actions, helper) + RLS + smoke manual documentado.

## Validaciones (Zod)

```ts
// schemas/push.ts
export const suscribirInputSchema = z.object({
  endpoint: z.string().url().max(2048),
  p256dh: z.string().min(1).max(256),
  auth: z.string().min(1).max(64),
  user_agent: z.string().max(512).nullable().optional(),
})

export type SuscribirInput = z.infer<typeof suscribirInputSchema>

export const desuscribirInputSchema = z.object({
  endpoint: z.string().url().max(2048),
})

export type DesuscribirInput = z.infer<typeof desuscribirInputSchema>
```

## Modelo de datos afectado

**Tablas nuevas:**

- `push_subscriptions(id, usuario_id, endpoint, p256dh, auth, user_agent, created_at, updated_at, last_active_at)`.
  - PK `id uuid` (gen_random_uuid).
  - FK `usuario_id → usuarios(id) ON DELETE CASCADE`.
  - UNIQUE `(usuario_id, endpoint)`.
  - Índice `(usuario_id)` para el lookup desde el helper.
  - Timestamps `timestamptz` (regla del data-model).
  - Trigger `touch_updated_at` reutilizado.

**Tablas modificadas:** ninguna.

**Tablas consultadas (lectura por el helper):**

- `push_subscriptions` (con service role).
- `vinculos_familiares`, `matriculas`, `profes_aulas`, `aulas`, `roles_usuario` (para calcular audiencia desde los hooks; las queries reutilizan helpers ya existentes en `features/messaging`).

## Políticas RLS

Default DENY ALL + 4 políticas específicas, aislamiento estricto por usuario:

```sql
-- SELECT: solo el propio usuario.
CREATE POLICY push_subscriptions_select_self ON public.push_subscriptions
  FOR SELECT USING (usuario_id = auth.uid());

-- INSERT: solo el propio usuario; WITH CHECK fuerza usuario_id = auth.uid().
CREATE POLICY push_subscriptions_insert_self ON public.push_subscriptions
  FOR INSERT WITH CHECK (usuario_id = auth.uid());

-- UPDATE: solo el propio usuario; útil para actualizar `last_active_at`.
CREATE POLICY push_subscriptions_update_self ON public.push_subscriptions
  FOR UPDATE
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

-- DELETE: solo el propio usuario.
CREATE POLICY push_subscriptions_delete_self ON public.push_subscriptions
  FOR DELETE USING (usuario_id = auth.uid());
```

Notas:

- **Helper no usado** porque la condición es trivial y no hay JOIN con otras tablas. Sin riesgo de recursión (ADR-0007).
- **MVCC gotcha** no aplica: el INSERT lo hace el propio usuario y la policy SELECT solo mira `usuario_id`, no lookups internos a la tabla.
- **DELETE por CASCADE de `usuarios`**: si se borra el usuario, sus suscripciones se borran automáticamente. No requiere acción extra.

## Pantallas y rutas

- `/profile` (existente) — añadir bloque `PushSettings` con toggle global y estados.
- `/messages` — banner contextual no intrusivo si el usuario nunca ha decidido (`Notification.permission === 'default'`) y la plataforma soporta push.
- **No** se crean rutas nuevas en F5.5.

## Componentes UI

- `PushSettings.tsx` (Client) — controla el flujo: detect platform, request permission, register SW, subscribe, persist.
- `PushBanner.tsx` (Client) — banner descartable en `/messages` con CTA "Activar notificaciones".
- `useNotificationPermission.ts` (hook) — encapsula la detección de estado (`granted | denied | default | unsupported | ios_sin_pwa`).

## Eventos y notificaciones

- **Push**: este módulo. Mensaje nuevo + anuncio nuevo en F5.5; F6+ enchufan sus disparadores al mismo helper.
- **Audit**: `push_subscriptions` NO se audita (telemetría operativa, no contenido). El `audit_log` se reserva para tablas con contenido sensible. Si en el futuro hace falta auditar suscripciones por compliance, se añade trigger entonces.
- **Realtime**: NO aplica. `push_subscriptions` no se publica.

## i18n

Claves nuevas en `messages/{es,en,va}.json` bajo namespace `push.*`:

```json
{
  "push": {
    "settings": {
      "titulo": "Notificaciones",
      "descripcion": "Recibe avisos cuando llegue un mensaje o anuncio nuevo",
      "activar": "Activar notificaciones",
      "desactivar": "Desactivar notificaciones",
      "estado_activado": "Notificaciones activadas",
      "estado_denegado": "Notificaciones bloqueadas en tu navegador",
      "estado_unsupported": "Tu navegador no soporta notificaciones",
      "ios_anadir_a_pantalla": "Para iOS, añade NIDO a tu pantalla de inicio: Compartir → Añadir a pantalla de inicio"
    },
    "banner": {
      "titulo": "¿Quieres recibir notificaciones?",
      "descripcion": "Te avisaremos cuando llegue un mensaje o anuncio nuevo",
      "cta_activar": "Activar",
      "cta_descartar": "Ahora no"
    },
    "notificaciones": {
      "anuncio_centro_titulo": "Nuevo anuncio del centro",
      "anuncio_aula_titulo": "Nuevo anuncio del aula"
    },
    "errors": {
      "permiso_denegado": "Has rechazado las notificaciones. Cámbialo en ajustes del navegador.",
      "suscripcion_fallo": "No hemos podido activar las notificaciones. Inténtalo de nuevo.",
      "no_autorizado": "Sesión expirada. Vuelve a iniciar sesión."
    }
  }
}
```

Ver § "Errores tipados" abajo para el mapeo a `ActionResult`.

## Errores tipados

Las server actions devuelven `ActionResult<T>` (ver `docs/architecture/error-handling.md`). Vocabulario en `push.errors.*`:

| Clave               | Cuándo                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| `no_autorizado`     | `supabase.auth.getUser()` devuelve null.                               |
| `suscripcion_fallo` | Fallback: error inesperado en UPSERT/DELETE. Va con `console.error`.   |
| `permiso_denegado`  | (solo cliente) `Notification.requestPermission()` devolvió `'denied'`. |

El helper `enviarPushANotificarUsuarios` **no devuelve errores al caller**: los logguea y sigue. Un fallo de push no rompe el mensaje persistido (decisión del prompt: el push es best-effort).

## Variables de entorno

| Variable                       | Visibilidad     | Origen                                                                                         |
| ------------------------------ | --------------- | ---------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | client + server | `npx web-push generate-vapid-keys` (público — lo lee el browser).                              |
| `VAPID_PUBLIC_KEY`             | server          | Mismo valor que el anterior; el helper de envío la prefiere y cae al `NEXT_PUBLIC_*` si falta. |
| `VAPID_PRIVATE_KEY`            | server (solo)   | `npx web-push generate-vapid-keys`                                                             |
| `VAPID_SUBJECT`                | server          | `mailto:contacto@nido.app` (o el correo del responsable).                                      |

Procedimiento de rotación: ver `docs/operations/vapid-rotation.md`. Resumen: regenerar par, actualizar Vercel envs en Prod + Preview + Dev, desplegar, las suscripciones existentes seguirán funcionando hasta que expiren (los endpoints siguen siendo válidos contra la API del navegador; cambia solo la clave que firma). En caso de rotación de emergencia, vaciar `push_subscriptions` para forzar re-opt-in.

## Accesibilidad

- Toggle de `PushSettings` con `role="switch"` y `aria-checked` reflejando el estado actual.
- Botón "Activar" como `<button>` real con `type="button"`, sin envoltura.
- Banner descartable con `aria-label` y botón "Ahora no" enfocable.
- Mensajes de estado vinculados con `aria-live="polite"`.
- Iconos de notificación con `aria-hidden`.

## Performance

- Helper `enviarPushANotificarUsuarios` paraleliza envíos por endpoint con `Promise.allSettled`.
- Si la audiencia tiene N destinatarios con M suscripciones cada uno, son N×M envíos. Tope práctico esperado en ANAIA: ~50 niños × 2 tutores × 2 dispositivos = ~200 envíos por anuncio al centro. Manejable en una Vercel function (timeout default 60s).
- El helper no espera al resultado del envío para devolver al action: `Promise.allSettled` corre en paralelo y el action `await`ea sólo lo necesario para que Vercel no termine la lambda antes de tiempo. Si en F7+ las audiencias crecen, se valorará una cola (Inngest, Trigger.dev, o tabla `notificaciones_push_pending` con cron).
- Service worker NO incluye caching en F5.5: peso mínimo (~3KB), tiempo de registro insignificante.

## Telemetría

`console.error` server-side (Vercel logs) en:

- VAPID keys no configuradas.
- Fallo al cargar suscripciones de un usuario.
- Fallo de `webpush.sendNotification` con código distinto de 410.
- DELETE por 410 (informativo).

Sin eventos custom de analytics en F5.5. Si en Ola 2 se quiere medir engagement por push (CTR, opens), se añade entonces.

## Tests requeridos

**Vitest (unit):**

- [ ] `suscribir-a-push`: usuario autenticado → UPSERT correcto, devuelve `success: true`.
- [ ] `suscribir-a-push`: sin sesión → `no_autorizado`.
- [ ] `suscribir-a-push`: payload inválido (endpoint no URL) → error de Zod.
- [ ] `desuscribir-push`: endpoint válido → DELETE correcto.
- [ ] `desuscribir-push`: sin sesión → `no_autorizado`.
- [ ] `enviarPushANotificarUsuarios`: mock `web-push.sendNotification` → envío con payload correcto.
- [ ] `enviarPushANotificarUsuarios`: respuesta 410 → DELETE de la suscripción.
- [ ] `enviarPushANotificarUsuarios`: otra respuesta de error → `console.error`, no DELETE.
- [ ] `enviarPushANotificarUsuarios`: audiencia vacía → no envíos, no error.
- [ ] `enviarPushANotificarUsuarios`: VAPID no configurado → early return con log.

**Vitest (RLS):**

- [ ] Usuario A no puede SELECT suscripciones de Usuario B.
- [ ] Usuario A no puede INSERT con `usuario_id` ≠ propio.
- [ ] Usuario A no puede UPDATE suscripciones de Usuario B.
- [ ] Usuario A no puede DELETE suscripciones de Usuario B.
- [ ] DELETE CASCADE al borrar `usuarios` elimina las suscripciones.

**Playwright (E2E):**

- No automatizado en F5.5 (fragilidad de service worker en CI headless).

**Smoke manual (documentado en este spec):**

- [ ] Login → activar push → confirmar SW registrado en DevTools → confirmar fila en `push_subscriptions`.
- [ ] Profe envía mensaje a tutor (con push activado) → tutor recibe notificación PUSH.
- [ ] Tutor click en notificación → abre la conversación correcta.
- [ ] Admin publica anuncio al centro → tutores con push reciben notificación.
- [ ] Desactivar push desde `/profile` → fila eliminada de BD.
- [ ] Activar push en iOS Safari sin PWA → muestra instrucciones de "añadir a pantalla de inicio".

## Criterios de aceptación

- [ ] Tabla `push_subscriptions` creada con migración aplicada al remoto.
- [ ] RLS verde: 5 tests de aislamiento pasan.
- [ ] Server actions `suscribir-a-push` y `desuscribir-push` con tests unit.
- [ ] Helper `enviarPushANotificarUsuarios` con tests unit (mocks de `web-push`).
- [ ] `enviar-mensaje.ts` y `publicar-anuncio.ts` llaman al helper sin bloquear la respuesta.
- [ ] Service worker `public/sw.js` registrado y funcional.
- [ ] Manifest `public/manifest.json` + meta tags iOS en `layout.tsx`.
- [ ] Componente `PushSettings` con los 5 estados (activado, denegado, default, unsupported, ios_sin_pwa).
- [ ] i18n trilingüe (es/en/va) con todas las claves del namespace `push.*`.
- [ ] Smoke manual del Checkpoint A + B verde.
- [ ] `npm run typecheck && npm run lint && npm test && npm run build` verde.
- [ ] ADR-0027 y ADR-0028 escritos.
- [ ] `docs/operations/vapid-rotation.md` con procedimiento.
- [ ] Entrada en `docs/journey/progress.md`.

## Decisiones técnicas relevantes

- **ADR-0027**: Arquitectura de push con server actions + `web-push` directo (sin Edge Functions ni OneSignal).
- **ADR-0028**: Manifest mínimo en F5.5 separado de la PWA completa de F11.

## Referencias

- ADR-0025 — Push notifications fuera de F5
- ADR-0027 — Push notifications arquitectura (a crear)
- ADR-0028 — Manifest mínimo en F5.5 (a crear)
- Spec relacionada: `docs/specs/messaging.md`
- Docs: `docs/architecture/rls-policies.md`, `docs/architecture/db-triggers.md`, `docs/architecture/error-handling.md`, `docs/dev-setup.md`
- Web Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- VAPID: https://datatracker.ietf.org/doc/html/rfc8292

---

**Workflow de esta spec:**

1. Claude Code escribe esta spec (`draft`).
2. Responsable revisa.
3. Responsable aprueba (`approved`).
4. Claude Code implementa (`in-progress`).
5. PR mergeado y desplegado (`done`).
