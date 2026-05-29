---
feature: messaging-admin-direccion-split-view
wave: 1
status: implemented
priority: high
last_updated: 2026-05-29
related_specs: [messaging.md, phase-5-6-admin-family-messaging.md]
related_adrs: [ADR-0029, ADR-0030]
---

# Spec F5B Items 1+2 — Admin direccion split-view

## Resumen ejecutivo

Rediseño UX del flujo admin↔familia. El admin pasa de iniciar conversaciones desde la tabla "Vínculos" de la ficha del niño a una experiencia paralela a la de los profes en `/messages`: una lista de tutores del centro con buscador, selección que abre/inicia el hilo en split-view. **El modelo de datos no cambia**: sigue siendo 1 hilo por par `(admin, tutor)` (ADR-0029) con su RLS, helpers y triggers F5.6-A intactos.

## Contexto

Reporte F5B en producción:

- **Item 1**: el botón "Escribir a la familia" del header de `/admin/ninos/[id]` redirigía a `/messages/nino/[id]` → `/messages?nino=<id>`, pero para admin `MessagesView` fuerza `tabActual = 'anuncios'` y el deep-link `?nino=` queda ignorado. Botón engañoso.
- **Item 2**: el admin reportó que abrir conversaciones desde la tabla "Vínculos" es contraintuitivo — espera el mismo split-view tipo WhatsApp que tienen los profes.

## Alcance

**Dentro:**

- Query nueva `getTutoresParaAdminDireccion(centroId)` con un núcleo `*Core(supabase, userId, centroId)` testeable.
- Tipo nuevo `TutorDireccionItem`.
- Componente nuevo `AdminDireccionSplitView` paralelo a `ConversacionesSplitView`.
- Subcomponente interno `PanelIniciar` para el caso sin hilo previo.
- Modo nuevo `admin_familia_iniciar` en `MensajeComposer` con flujo cliente secuencial.
- Prop opcional `fillParent?: boolean` en `ConversacionAdminFamiliaView`.
- Sustitución del antiguo `AdminFamiliaList` (helper interno de `MessagesView`) por el nuevo split-view en el tab Dirección del admin. Eliminación del helper huérfano.
- `messages/page.tsx`: carga la query nueva solo para admin (Promise.all con las otras), resuelve `?tutor=<id>` deep-link con fallback graceful.
- Eliminación del botón "Escribir a la familia" del header de `/admin/ninos/[id]` (Opción A).
- i18n: namespace nuevo `messages.admin_direccion.*` en es/en/va.
- Tests Vitest del `*Core` (6 casos).
- Tests RLS integration bajo Supabase local (3 casos).
- 2 tests E2E reales bajo `test.skip` (gated por `E2E_REAL_SESSIONS=1`).

**Fuera:**

- Migración SQL, RLS, ENUMs, helpers, triggers: nada cambia.
- Botón `AbrirConversacionDireccionButton` en la tabla Vínculos: se queda como acceso directo alternativo.
- `AdminFamiliaSection` + `AdminFamiliaListItem` + `getAdminFamiliaList`: se mantienen — los usa el lado tutor para la sección "Dirección" del tab Conversaciones.
- Push notifications de admin↔familia: diferido a F5.6-D (sin cambio).
- Paginación server-side de la lista de tutores: client-side con <200 tutores por centro. Telemetría aparte si pasa de 300.

## Decisiones cerradas

| ID                              | Decisión                                                                                                                                                        | Aplicada en                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| D1 — Item 1                     | Opción A: eliminar el botón del header admin. El acceso desde la ficha sigue por la tabla Vínculos.                                                             | [admin/ninos/[id]/page.tsx](../../src/app/[locale]/admin/ninos/[id]/page.tsx)                                   |
| D2 — `puede_recibir_mensajes`   | NO aplica a admin↔familia. La query incluye TODOS los tutores del centro.                                                                                       | [get-tutores-para-admin-direccion.ts](../../src/features/messaging/queries/get-tutores-para-admin-direccion.ts) |
| D3 — `AdminFamiliaList` interno | BORRADO. Su tab admin pasa a renderizar `AdminDireccionSplitView`.                                                                                              | [MessagesView.tsx](../../src/features/messaging/components/MessagesView.tsx)                                    |
| D4 — Composer iniciar           | Secuencial cliente: `abrirConversacionAdminFamilia(tutorId)` → `enviarMensaje({kind:'admin_familia', conversacion_id, contenido})`. Sin wrapper atómico server. | [MensajeComposer.tsx](../../src/features/messaging/components/MensajeComposer.tsx)                              |
| D5 — Ordenación                 | con-hilo-activo (`last_message_at` desc) → con-hilo-vacío (`expires_at` desc) → sin-hilo (alfabético).                                                          | [get-tutores-para-admin-direccion.ts](../../src/features/messaging/queries/get-tutores-para-admin-direccion.ts) |
| D6 — `fillParent` prop          | OK como prop opcional, default `false`. Cambio quirúrgico de 3 líneas.                                                                                          | [ConversacionAdminFamiliaView.tsx](../../src/features/messaging/components/ConversacionAdminFamiliaView.tsx)    |
| D7 — E2E skip                   | 2 tests añadidos bajo `test.skip` con TODO sobre el seed.                                                                                                       | [e2e/messaging.spec.ts](../../e2e/messaging.spec.ts)                                                            |
| D8 — i18n namespace             | `messages.admin_direccion.*` paralelo a `messages.admin_familia.*`.                                                                                             | [messages/{es,en,va}.json](../../messages/es.json)                                                              |

## Comportamientos detallados

### Lista de tutores

Universo: vínculos activos (`tipo_vinculo IN (tutor_legal_principal, tutor_legal_secundario, autorizado)`, `deleted_at IS NULL`) sobre niños del centro del admin (no borrados). Dedup por `usuario_id`. Cada item incluye `hijos: Array<{nino_id, nombre, apellidos}>`.

### Ordenación

1. Tutores con hilo activo (`conversacion_id !== null` y `last_message_at !== null`), por `last_message_at` desc.
2. Tutores con hilo abierto sin mensajes (`conversacion_id !== null` y `last_message_at === null`), por `expires_at` desc.
3. Tutores sin hilo, alfabéticos por `nombre_completo` asc.

### Buscador

- Client-side (no round-trips). Normaliza acentos (NFD + replace diacritics) y case.
- Tokeniza la query por espacios: cada token debe aparecer en `nombre_completo` o en el listado de hijos del tutor.

### Composer "iniciar"

Cuando el admin selecciona un tutor sin hilo previo, el panel renderiza el `PanelIniciar`:

- Header con badge "Dirección" + nombre del tutor + lista de hijos del centro.
- Cuerpo: empty state con `iniciar_titulo` + `iniciar_subtitulo`.
- `MensajeComposer` modo `admin_familia_iniciar`.

Al enviar:

1. `abrirConversacionAdminFamilia(tutorId)` — UPSERT idempotente (creación o reapertura).
2. Si OK, `enviarMensaje({kind: 'admin_familia', conversacion_id: <recibido>, contenido})`.
3. `router.refresh()` — el SSR recarga la lista, ahora el tutor tiene `conversacion_id`, el panel pasa a `ConversacionAdminFamiliaView`.

Si el paso 1 falla, el toast muestra el error y nada se persiste. Si el paso 2 falla post-éxito de paso 1, el hilo queda creado con `expires_at` sin mensajes; el siguiente envío usa el mismo hilo (idempotencia del UPSERT). Mismo patrón "conv lazy sin mensajes" que `profe_familia`.

### Realtime

`useMessagingRealtime` global (sin filtro de conversación). `onChange` memoizado con `useCallback` que hace `router.refresh()`. Patrón heredado de `ConversacionesSplitView` (lección PR #26 sobre refresh storm).

### Deep-link `?tutor=<id>`

Si el `usuario_id` no está en la lista (admin perdió permiso, vínculo borrado), se ignora gracefully: render sin selección, sin error visible. Nota C del checkpoint B.

### Mobile

`hidden md:flex` en aside/section según `tutorSeleccionadoId`. Lista fullscreen → click → panel fullscreen → URL sin `?tutor=` para volver.

## Modelo de datos afectado

Nada cambia. La query usa:

- `vinculos_familiares` (F2, RLS admin-del-centro vía `es_admin(centro_de_nino)`).
- `conversaciones` con `tipo='admin_familia' AND admin_id=auth.uid()` (F5.6-A, RLS por par).
- `mensajes` filtrados por `conversacion_id IN (...)` (F5, RLS `puede_participar_conversacion`).
- `lectura_conversacion` con `usuario_id=auth.uid()` (F5).

## Validaciones

Sin Zod schemas nuevos. La query es de lectura (SELECT). El composer reusa los schemas existentes:

- `abrirConversacionAdminFamiliaSchema` para el paso 1.
- `mensajeInputSchema` con discriminator `kind: 'admin_familia'` para el paso 2.

## Tests

### Vitest

[`__tests__/get-tutores-para-admin-direccion.test.ts`](../../src/features/messaging/queries/__tests__/get-tutores-para-admin-direccion.test.ts) — 6 casos:

1. Dedup por `usuario_id` (tutor con 2 hijos del centro → 1 row).
2. Filtrado por centro (tutor de centro B no aparece para admin de A).
3. Ignora niños soft-deleted.
4. Ordenación con-activo → con-vacío → sin-hilo.
5. `unread_count` ignora mensajes propios y anulados.
6. `last_message_preview` null cuando el último mensaje está anulado.

### RLS integration

[`src/test/rls/messaging.rls.test.ts`](../../src/test/rls/messaging.rls.test.ts) — 3 casos nuevos:

1. Admin A solo ve tutores con vínculo en su centro (no ve los de centro B).
2. Admin A solo ve conversaciones `admin_familia` donde es `admin_id`.
3. Tutor NO puede SELECT vínculos cruzados (RLS bloquea).

### E2E

[`e2e/messaging.spec.ts`](../../e2e/messaging.spec.ts) — 2 tests bajo `test.skip` (gated por `E2E_REAL_SESSIONS=1`):

1. Admin lista tutores, busca, selecciona, inicia hilo.
2. Tutor recibe el hilo en su sección "Dirección".

## Performance

`getTutoresParaAdminDireccion` paraleliza con `Promise.all` los SELECTs independientes (último mensaje + lecturas en la ronda 3). Las 3 rondas son secuenciales (cada una necesita IDs de la anterior). Con seed de ~30 tutores en local: ~80-120 ms estimados; medición real durante el commit.

## Riesgos y gotchas

| Riesgo                                       | Mitigación                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Lista de tutores >200                        | Hoy ANAIA tiene ≈40; client-side basta. Telemetría aparte si pasa de 300.          |
| Tutor con varios hijos del mismo centro      | Dedup por `usuario_id` post-SELECT.                                                |
| Tutor multi-centro (Ola 2)                   | La query filtra por `nino.centro_id = centroId`; cada admin solo ve a sus tutores. |
| `puede_recibir_mensajes=false`               | NO aplica a admin↔familia (verificado en migración F5.6-A líneas 245-249).         |
| Race "doble clic" composer iniciar           | `abrirConversacionAdminFamilia` ya gestiona 23505 con recovery a UPDATE.           |
| `ConversacionAdminFamiliaView` altura propia | Prop `fillParent` lo cambia a `h-full` dentro del padre acotado por `grid-rows-1`. |
| Realtime storm con muchos hilos activos      | Mitigado por `useCallback` + `useId` en el hook.                                   |
| iOS Safari PWA + `100dvh`                    | Validado en PR #31.                                                                |

## Plan de implementación (ya aplicado en PR #32)

1. ✅ Tipo `TutorDireccionItem` en `types.ts`.
2. ✅ i18n `admin_direccion.*` en `messages/{es,en,va}.json`.
3. ✅ Query `getTutoresParaAdminDireccion` + `*Core` testeable.
4. ✅ Prop `fillParent` en `ConversacionAdminFamiliaView`.
5. ✅ Modo `admin_familia_iniciar` en `MensajeComposer`.
6. ✅ Componente `AdminDireccionSplitView`.
7. ✅ `MessagesView`: importar split-view, sustituir tab Dirección admin, borrar helper.
8. ✅ `messages/page.tsx`: query nueva via `Promise.all`, deep-link `?tutor`.
9. ✅ `admin/ninos/[id]/page.tsx`: eliminar botón header.
10. ✅ Tests Vitest del `*Core`.
11. ✅ Tests RLS integration.
12. ✅ E2E bajo `test.skip` con TODO de seed.

## Verificación pre-merge (PR #32)

```bash
npm run typecheck   # debe quedar verde
npm test            # incluye 6 tests nuevos query + 3 RLS + smoke heredado
npm run build       # producción (esp. importante por la lección PR #30)
```

## Follow-ups (no en este PR)

- Picker de tutores en el header de la ficha del niño (Opción B del Item 1) si el negocio echa de menos el atajo.
- `e2e/helpers/seed-mensajes.ts` para activar los E2E reales del PR #31 y #32.
- Telemetría de tamaño de lista de tutores para decidir paginación server-side.
