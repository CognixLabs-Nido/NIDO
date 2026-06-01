# Spec F6-C — Re-modelado granular de destinatarios + fix push + fix badge + entry points

> **Checkpoint A — SPEC ÚNICAMENTE.** Sin código, sin PR. Supera el modelo de
> [reminders.md](./reminders.md) (F6-A/B). ADR nuevo: **ADR-0037** (supera a ADR-0035).
> Fecha: 2026-05-31.

## 0. Resumen ejecutivo

F6-A/B entregaron recordatorios con un ENUM de 4 valores (`familia`/`equipo`/`direccion`/`personal`) y, tras el hotfix #44, admin/profe solo pueden enviar a "Familia" (todos los tutores de un niño) o "Personal". La matriz real del producto exige **granularidad fina**: enviar a una familia concreta, a todas las familias de un aula, a todas las familias del centro, a una profesora concreta o a todas las profesoras. Además F6-B arrastra **dos bugs de piloto**: push no llega a ningún dispositivo y no hay badge de pendientes en el sidebar.

Esta spec define: (1) un modelo nuevo de 6 destinos con `aula_id` y `usuario_destinatario_id`; (2) RLS reescrita; (3) la causa raíz del push (el Service Worker nunca se registra de forma proactiva); (4) el badge de pendientes replicando el patrón de mensajería; (5) partición en 3 sub-fases.

**Cambio conceptual clave:** la matriz solo lista **admin y profe como emisores**. Coherente con el hotfix #44 (tutor/autorizado no usan el módulo). La dirección "familia → centro" del modelo F6-A (`equipo`) **se elimina**: los tutores pasan a ser **solo receptores** (push + badge + lista). El nombre "bidireccionales" queda como legado histórico.

---

## 1. Auditoría

### 1.1 NIDO — modelo actual (F6-A + F6-B, mergeados)

**Tabla `recordatorios`** — `supabase/migrations/20260531120000_phase6_reminders.sql:30-66`. Columnas: `id`, `centro_id`, `destinatario` (ENUM), `nino_id` (NULL), `usuario_destinatario_id` (NULL), `creado_por`, `titulo` (1-210), `descripcion` (≤1000), `vencimiento` (NULL), `completado_en`/`completado_por`, `erroneo`, `created_at`, `updated_at`.

**ENUM** `recordatorio_destinatario` (`:26`): `'familia' | 'equipo' | 'direccion' | 'personal'`.

**CHECK `recordatorios_destino_coherencia`** (`:50-57`):

- `familia`/`equipo` → `nino_id NOT NULL`, `usuario_destinatario_id NULL`.
- `direccion` → ambos NULL.
- `personal` → `usuario_destinatario_id NOT NULL`, `nino_id NULL`.

**RLS INSERT** (`:148-166`) — limita la creación por destino:

- `familia` → `es_admin(centro_id) OR es_profe_de_nino(nino_id)`.
- `equipo` → `es_tutor_de(nino_id) AND tiene_permiso_sobre(nino_id,'puede_recibir_mensajes')`.
- `direccion` → `pertenece_a_centro(centro_id)`.
- `personal` → `usuario_destinatario_id = auth.uid()`.

  > Este es el predicado que el hotfix #44 chocaba: `equipo` exige `es_tutor_de`, por eso no se puede ofrecer a admin/profe sin tocar el modelo. F6-C lo resuelve de raíz.

**RLS SELECT** (`:127-145`) y **UPDATE** (`:175-195`): predicado de visibilidad por destino, simétrico USING/WITH CHECK en UPDATE. La restricción de columnas (completar vs anular) y la ventana de 5 min las enforza el **server action**, no la RLS (ADR-0036). El gotcha MVCC NO aplica: SELECT lee solo columnas del row + helpers sobre **otras** tablas.

**Action `crearRecordatorio`** — `src/features/recordatorios/actions/crear-recordatorio.ts:29-137`. Split core/wrapper. Resuelve `centro_id` server-side (del niño para `familia`/`equipo`; de `roles_usuario` para `direccion`/`personal`). Tras el INSERT dispara push **best-effort** (`:113-131`): llama `destinatariosRecordatorio(...)` → `enviarPushANotificarUsuarios(ids, payload)`.

**Audiencia push** — `src/features/recordatorios/lib/audiencia.ts:27-90`. `destinatariosRecordatorio()` usa **service role** (los nombres de columna confirmados aquí guían el SQL nuevo): `vinculos_familiares(usuario_id, permisos JSONB, deleted_at)`, `matriculas(aula_id, fecha_baja, deleted_at)`, `profes_aulas(profe_id, aula_id, fecha_fin, deleted_at)`, `roles_usuario(usuario_id, centro_id, rol, deleted_at)`. Hoy expande: `familia`→tutores con flag; `equipo`→profes del aula + admins; `direccion`→admins; `personal`→[].

**Pipeline push** — `src/features/push/lib/enviar-push.ts:90-159`. `enviarPushANotificarUsuarios(usuarioIds, payload)`: service role, lee `push_subscriptions`, `Promise.allSettled`, limpia 404/410, nunca lanza. `ensureVapidConfigured()` (`:14-38`) lee `VAPID_PUBLIC_KEY ?? NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; early-return silencioso si faltan.

**Queries** — `get-recordatorios-usuario.ts` (`getRecordatoriosPendientesDeUsuario`, `getRecordatoriosCompletadosDeUsuario(limit=50)`), `get-ninos-para-recordatorios.ts` (`getNinosParaRecordatorios()` → RLS filtra por rol).

### 1.2 NIDO — badge contador (mensajería funciona, recordatorios no)

**`SidebarNav`** — `src/shared/components/SidebarNav.tsx:12-18,87-89,153`. `SidebarItem.trailing?: ReactNode` se renderiza tal cual; es `'use client'`.

**`MessagingBadge`** — `src/features/messaging/components/MessagingBadge.tsx`. Recibe `initialTotal` (SSR), estado local, `refresh()` llama `getUnreadCountsAction()`, se re-dispara vía `useMessagingRealtime()` (suscrito a `mensajes`+`anuncios`). Sin polling, sin `router.refresh`.

**`countNoLeidos`** — `src/features/messaging/queries/count-no-leidos.ts`. Cuenta en JS sobre PostgREST: conversaciones donde el usuario es **participante** (RLS de `conversaciones`), mensajes no propios/no anulados posteriores a `last_read_at` (`lectura_conversacion`); anuncios visibles no leídos (`lectura_anuncio`). **Distinción clave para D7:** conversaciones = participante directo; anuncios = audiencia RLS.

**Cableado** — los layouts (`admin`/`teacher`/`messages`/`reminders`/`family`) hacen `buildSidebarItems(rol, locale, <MessagingBadge initialTotal={unread} />)`; el badge se asigna como `trailing` **solo al item de mensajería** (`src/shared/lib/sidebar-items.tsx:47,67`).

**Badge de recordatorios: NO EXISTE.** No hay `RecordatoriosBadge`, ni `countRecordatoriosPendientes`, ni `trailing` en la entrada "recordatorios". El "1" que reporta el usuario **no sale del código** (la entrada no tiene `trailing`): es un artefacto visual (probablemente un residuo de la preview o un badge fantasma del navegador). El fix correcto no es "quitar el 1" sino **construir el badge real** que hoy falta.

**Realtime cliente** — `src/features/recordatorios/lib/use-recordatorios-realtime.ts` suscribe a `*` sobre `recordatorios`; callback genérico (`router.refresh`), sin conteo.

### 1.3 MisterFC — push (funciona) vs NIDO (no llega)

Auditoría comparativa de los 5 ejes (web-push server, VAPID env, suscripción client, Service Worker, registro/arranque):

| Eje                                                         | MisterFC | NIDO                                               |
| ----------------------------------------------------------- | -------- | -------------------------------------------------- |
| 1. Envío server (`web-push`, VAPID, 410/404)                | ✅       | ✅ (incluso más robusto: no lanza, limpieza batch) |
| 2. VAPID env vars (nombres cliente/servidor)                | ✅       | ✅ en `.env.local`; **verificar en Vercel**        |
| 3. Suscripción client (subscribe + persistir)               | ✅       | ✅ (`subscribe-flow.ts`)                           |
| 4. Service Worker con listener `push` + `notificationclick` | ✅       | ✅ (`public/sw.js:44-114` correcto)                |
| 5. **Registro/arranque del SW en el árbol de la app**       | ✅       | ❌ **sin cablear**                                 |

**Causa raíz (#1, alta probabilidad): el Service Worker de NIDO nunca se registra de forma proactiva.** MisterFC monta `<ServiceWorkerRegister />` (`apps/web/src/components/service-worker-register.tsx`) en el layout raíz (`apps/web/src/app/[locale]/layout.tsx:69`), que hace `navigator.serviceWorker.register('/sw.js')` en cada carga. En NIDO el **único** `register('/sw.js')` vive en `subscribe-flow.ts:35`, dentro de `activarPush()`, que solo corre si el usuario pulsa "Activar" en `/profile`. Si nunca completó ese flujo → **`push_subscriptions` vacía** → `enviar-push.ts:116` early-return → no se envía nada. Encaja exacto con "no llega ni a móvil ni a PC".

> Matiz: MisterFC gatea el registro con `NODE_ENV !== 'production' → return` (`service-worker-register.tsx:7`). Decisión de NIDO: registrar también en dev para poder probar localmente (ver D6).

**Causa #2 (verificar, no descarta #1): VAPID vars ausentes en Vercel producción.** Si faltan, `ensureVapidConfigured()` early-return silencioso (solo `console.error` en logs). Revisar Project Settings → Environment Variables del proyecto Vercel de NIDO y los logs tras enviar.

**Causa #3 (menos probable): pública del cliente ≠ pareja privada del server** en Vercel (la pública se embebe en build). Solo si #1 y #2 descartadas; regenerar par con `npx web-push generate-vapid-keys` y sincronizar.

### 1.4 NIDO — queries/componentes para form granular y entry points

- **Existen:** `getAulaById`, `getAulasPorCurso`, `getAulasConPersonal(cursoId)`, `getNinosPorCentro`, `getNinoById`, `getNinosParaRecordatorios`, `getVinculosTutoresAula(aulaId)` (Map nino→tutores), `getProfesCandidatos(centroId)` (usuarios rol profe del centro), `getRolEnCentro`.
- **NO existen (crear):** `getAulasParaRecordatorios()` (aulas que el usuario puede destinar: admin→todas del centro, profe→sus aulas activas); opcionalmente `getNinosPorAula(aulaId)`.
- **UI:** `src/components/ui/select.tsx` (Base-UI Select con prop `items`). **No hay Combobox con búsqueda** — relevante para listas grandes (>30 tutores/aulas); se mitiga porque los destinos granulares operan sobre niño/aula/profe (listas acotadas), no sobre tutores individuales.
- **Entry points:** `/admin/ninos/[id]/page.tsx` tiene `nino.id/centro_id/nombre/apellidos` + aula activa (botón en header). `/teacher/aula/[id]/page.tsx` tiene `aula.id/centro_id/nombre` (botón junto a "Ver Asistencia"/"Ver Menú").

---

## 2. Decisiones de producto (🔒 con recomendación)

> Todas 🔒 — requieren tu cierre antes del Checkpoint B.

**🔒 D1 — Migración de datos.** Opciones: (a) drop tabla + ENUM y recrear; (b) migrar con mapping; (c) borrar registros y recrear esquema.
**Recomendación: (a) destructivo.** El piloto no ha arrancado y los datos de F6-A/B son de prueba. Mapear `equipo`/`direccion` (que se eliminan) a los nuevos destinos no tiene equivalente limpio y un ENUM no se "renombra" sin recrearlo. `audit_log` es append-only y conserva el histórico aunque se borre la tabla. La migración hará `DROP TABLE … CASCADE` + `DROP TYPE`. **Riesgo:** si hubiera datos reales, se pierden — el responsable confirma volumen ≈0 antes de aplicar.

**🔒 D2 — "Una familia concreta" = ¿niño o tutor?** Recomendación: **por niño (`nino_id`)**. "Una familia" = todos los tutores de ese niño (con `puede_recibir_mensajes`). Coincide con el entry point `/admin/ninos/[id]`, evita un picker de tutores (lista grande, sin Combobox) y es coherente con F6-A. El destino se llama `familia_individual` y lleva `nino_id`.

**🔒 D3 — "Una profesora concreta" para profe.** La matriz **no** da a profe los destinos `profe_individual` ni `profes_centro`. **Confirmar: profe solo envía a `familia_individual`, `familias_aula`, `personal`.** No hay envío profe↔profe en el MVP (ni dentro del aula). Recomendación: confirmado, sin profe→profe.

**🔒 D4 — UX del form.** Opciones: combobox jerárquico vs wizard de pasos.
**Recomendación: un solo Dialog con campos condicionales** (no wizard). Paso implícito: Select "tipo de destinatario" (las 6/3 opciones por rol) → segundo Select condicional para el objetivo concreto **solo** cuando el tipo lo requiere (`familia_individual`→niño, `familias_aula`→aula, `profe_individual`→profe). `familias_centro`/`profes_centro`/`personal` no piden segundo selector. Extiende el patrón actual `requiereNino` con `requiereAula`/`requiereUsuario`. Menos fricción que un wizard y reutiliza el `RecordatorioFormDialog` existente.

**🔒 D5 — Expansión de destinatarios para push.** Función `expandirDestinatariosRecordatorio(rec)` (reescritura de `destinatariosRecordatorio`), service role, devuelve `usuario_id[]` excluyendo al autor:

- `familia_individual` → tutores del `nino_id` con `permisos.puede_recibir_mensajes = true`.
- `familias_aula` → niños activos del `aula_id` (`matriculas` fecha_baja NULL) → sus tutores con flag (dedup).
- `familias_centro` → todos los niños del centro → tutores con flag (dedup).
- `profe_individual` → `[usuario_destinatario_id]`.
- `profes_centro` → `roles_usuario` rol `profe` del centro (deleted_at NULL).
- `personal` → `[]`.

**🔒 D6 — Diagnóstico push (hipótesis).** Causa raíz: **falta el registro proactivo del SW** (§1.3 #1). Fix: nuevo componente cliente `ServiceWorkerRegister` (`useEffect` → `navigator.serviceWorker.register('/sw.js')`) montado en `src/app/[locale]/layout.tsx`. **Sin gate de `NODE_ENV`** (registrar también en dev, para poder probar localmente — diferencia deliberada con MisterFC). En paralelo verificar VAPID en Vercel (#2). Sin esto, ninguna mejora del modelo entrega notificaciones.

**🔒 D7 — Fix badge.** Hoy no existe. Construir `contarRecordatoriosPendientesParaUsuario()` que cuente recordatorios **pendientes** (`completado_en IS NULL AND erroneo = false`) **dirigidos al usuario como destinatario** (no por mera visibilidad admin, no auto-creados salvo `personal`):

- `personal` → `usuario_destinatario_id = self`.
- `profe_individual` → `usuario_destinatario_id = self`.
- `profes_centro` → `es_profe_en_centro(self)`.
- `familia_individual` → `tiene_permiso_sobre(nino_id,'puede_recibir_mensajes')` AND `creado_por != self`.
- `familias_aula` → `es_tutor_en_aula(aula_id)` AND `creado_por != self`.
- `familias_centro` → `es_tutor_en_centro(centro_id)` AND `creado_por != self`.

**Recomendación de implementación:** RPC Postgres `contar_recordatorios_pendientes()` (`SECURITY DEFINER STABLE`, usa `auth.uid()`) — evita replicar el predicado en JS y resuelve el caso admin (que vía RLS ve todo pero **no** es destinatario). El badge cliente lo invoca por RPC. Distinción "destinatario directo vs visibilidad RLS" = exactamente el bug de mensajería que el usuario describe.

**🔒 D8 — Entry points: ¿en este PR o aparte?** Recomendación: **sub-fase aparte (F6-C-3)**, tras el remodel. Pre-rellenan: desde `/admin/ninos/[id]` → `familia_individual` con `nino_id` fijado; desde `/teacher/aula/[id]` → `familias_aula` con `aula_id` fijado. Mantenerlos fuera del PR de remodel evita inflarlo y permite validar el form genérico primero.

**🔒 D9 — RLS por destino (matriz rol → destinos).**

| Destino              | admin crea  | profe crea   | tutor/autorizado                      |
| -------------------- | ----------- | ------------ | ------------------------------------- |
| `familia_individual` | ✅ (centro) | ✅ (su niño) | ❌ (solo recibe)                      |
| `familias_aula`      | ✅ (centro) | ✅ (su aula) | ❌                                    |
| `familias_centro`    | ✅          | ❌           | ❌                                    |
| `profe_individual`   | ✅          | ❌           | ❌                                    |
| `profes_centro`      | ✅          | ❌           | ❌                                    |
| `personal`           | ✅ (self)   | ✅ (self)    | ❌ (sin acceso al módulo, hotfix #44) |

**🔒 D10 — Tests.** Recomendación: **reescritura completa** de `src/test/rls/recordatorios.rls.test.ts` y `src/test/audit/recordatorios-audit.test.ts` (cambia el modelo entero) y de los unit del action core. El test explícito del gotcha MVCC (`.insert().select()` por destino) se mantiene y se amplía a los 6 destinos.

---

## 3. Modelo nuevo + SQL

### 3.1 ENUM y tabla

```sql
CREATE TYPE public.recordatorio_destinatario AS ENUM (
  'familia_individual', 'familias_aula', 'familias_centro',
  'profe_individual', 'profes_centro', 'personal'
);

CREATE TABLE public.recordatorios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id   uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  destinatario public.recordatorio_destinatario NOT NULL,
  nino_id     uuid REFERENCES public.ninos(id)  ON DELETE CASCADE,
  aula_id     uuid REFERENCES public.aulas(id)  ON DELETE CASCADE,
  usuario_destinatario_id uuid REFERENCES public.usuarios(id) ON DELETE CASCADE,
  creado_por  uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  titulo      text NOT NULL,
  descripcion text,
  vencimiento timestamptz,
  completado_en  timestamptz,
  completado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  erroneo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recordatorios_destino_coherencia CHECK (
    (destinatario = 'familia_individual' AND nino_id IS NOT NULL AND aula_id IS NULL AND usuario_destinatario_id IS NULL)
    OR (destinatario = 'familias_aula'    AND aula_id IS NOT NULL AND nino_id IS NULL AND usuario_destinatario_id IS NULL)
    OR (destinatario = 'familias_centro'  AND nino_id IS NULL AND aula_id IS NULL AND usuario_destinatario_id IS NULL)
    OR (destinatario = 'profe_individual' AND usuario_destinatario_id IS NOT NULL AND nino_id IS NULL AND aula_id IS NULL)
    OR (destinatario = 'profes_centro'    AND nino_id IS NULL AND aula_id IS NULL AND usuario_destinatario_id IS NULL)
    OR (destinatario = 'personal'         AND usuario_destinatario_id IS NOT NULL AND nino_id IS NULL AND aula_id IS NULL)
  ),
  CONSTRAINT recordatorios_titulo_len CHECK (char_length(titulo) BETWEEN 1 AND 210),
  CONSTRAINT recordatorios_descripcion_len CHECK (descripcion IS NULL OR char_length(descripcion) <= 1000),
  CONSTRAINT recordatorios_completado_coherencia CHECK (
    (completado_en IS NULL AND completado_por IS NULL)
    OR (completado_en IS NOT NULL AND completado_por IS NOT NULL)
  )
);
```

**`nino_id` se mantiene** (D2): es la clave de `familia_individual`. `aula_id` nuevo (`familias_aula`). `usuario_destinatario_id` ahora cubre `profe_individual` y `personal`. `familias_centro`/`profes_centro` no necesitan ref extra (los lleva `centro_id`).

Índices: `(centro_id)`, parcial `(nino_id) WHERE nino_id IS NOT NULL`, parcial `(aula_id) WHERE aula_id IS NOT NULL`, parcial `(usuario_destinatario_id) WHERE usuario_destinatario_id IS NOT NULL`, `(creado_por)`, parcial pendientes `(vencimiento) WHERE completado_en IS NULL AND erroneo = false`.

### 3.2 Helpers SQL nuevos

```sql
-- ¿auth.uid() es tutor/autorizado de algún niño activo del aula?
CREATE OR REPLACE FUNCTION public.es_tutor_en_aula(p_aula_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    JOIN public.vinculos_familiares v ON v.nino_id = m.nino_id
    WHERE m.aula_id = p_aula_id AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
      AND v.usuario_id = auth.uid() AND v.deleted_at IS NULL
  );
$$;

-- ¿auth.uid() tiene rol profe en el centro?
CREATE OR REPLACE FUNCTION public.es_profe_en_centro(p_centro_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roles_usuario r
    WHERE r.centro_id = p_centro_id AND r.usuario_id = auth.uid()
      AND r.rol = 'profe' AND r.deleted_at IS NULL
  );
$$;
```

> Reutilizados: `es_admin`, `es_profe_de_nino`, `es_profe_de_aula`, `es_tutor_de`, `es_tutor_en_centro` (F5.6-A), `tiene_permiso_sobre`, `pertenece_a_centro`, `centro_de_nino`, `centro_de_aula`. Nombres de columna (`matriculas.deleted_at`, `vinculos_familiares.deleted_at`, `roles_usuario.deleted_at`) confirmados en `audiencia.ts`; **verificar contra el schema real durante impl** antes de aplicar.

### 3.3 RLS reescrita

```sql
-- SELECT: visibilidad por destino.
CREATE POLICY recordatorios_select ON public.recordatorios FOR SELECT USING (
  (destinatario = 'familia_individual' AND (
     public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id)
     OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')))
  OR (destinatario = 'familias_aula' AND (
     public.es_admin(centro_id) OR public.es_profe_de_aula(aula_id)
     OR public.es_tutor_en_aula(aula_id)))
  OR (destinatario = 'familias_centro' AND (
     public.es_admin(centro_id) OR public.es_tutor_en_centro(centro_id)))
  OR (destinatario = 'profe_individual' AND (
     public.es_admin(centro_id) OR usuario_destinatario_id = auth.uid()))
  OR (destinatario = 'profes_centro' AND (
     public.es_admin(centro_id) OR public.es_profe_en_centro(centro_id)))
  OR (destinatario = 'personal' AND usuario_destinatario_id = auth.uid())
);

-- INSERT: matriz D9. creado_por = auth.uid() (anti-suplantación).
CREATE POLICY recordatorios_insert ON public.recordatorios FOR INSERT WITH CHECK (
  creado_por = auth.uid() AND (
    (destinatario = 'familia_individual'
       AND (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id))
       AND public.centro_de_nino(nino_id) = centro_id)
    OR (destinatario = 'familias_aula'
       AND (public.es_admin(centro_id) OR public.es_profe_de_aula(aula_id))
       AND public.centro_de_aula(aula_id) = centro_id)
    OR (destinatario = 'familias_centro'  AND public.es_admin(centro_id))
    OR (destinatario = 'profe_individual' AND public.es_admin(centro_id))
    OR (destinatario = 'profes_centro'    AND public.es_admin(centro_id))
    OR (destinatario = 'personal'
       AND usuario_destinatario_id = auth.uid() AND public.pertenece_a_centro(centro_id))
  )
);

-- UPDATE: completar (quien lo ve) / anular (emisor, ventana en action). Simétrico.
CREATE POLICY recordatorios_update ON public.recordatorios FOR UPDATE
  USING ( /* mismo predicado que SELECT */ )
  WITH CHECK ( /* mismo predicado que SELECT */ );
```

**Decisión sobre el flag `puede_recibir_mensajes` en broadcasts.** Para `familias_aula`/`familias_centro` la **visibilidad** (SELECT) sigue a la **pertenencia** (`es_tutor_en_aula`/`es_tutor_en_centro`), sin chequear el flag por-niño (intratable en RLS para multi-hijo). La **entrega push** (`expandirDestinatarios`, D5) **sí** respeta el flag por niño. Es decir: un tutor con el flag desactivado podría ver un broadcast in-app pero no recibe push. Trade-off aceptado y documentado en ADR-0037.

**Gotcha MVCC:** no aplica — `recordatorios_select` lee columnas del propio row + helpers sobre **otras** tablas (`ninos`/`aulas`/`matriculas`/`vinculos_familiares`/`roles_usuario`), nunca re-lee `recordatorios`. Test explícito `.insert().select()` por los 6 destinos lo verifica.

**Gotcha "USING falso → 0 filas":** se mantiene para completar idempotente (`UPDATE … WHERE completado_en IS NULL … .select().maybeSingle()`).

### 3.4 RPC del badge (D7)

```sql
CREATE OR REPLACE FUNCTION public.contar_recordatorios_pendientes()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.recordatorios r
  WHERE r.completado_en IS NULL AND r.erroneo = false
    AND (
      (r.destinatario = 'personal'         AND r.usuario_destinatario_id = auth.uid())
      OR (r.destinatario = 'profe_individual' AND r.usuario_destinatario_id = auth.uid())
      OR (r.destinatario = 'profes_centro'  AND public.es_profe_en_centro(r.centro_id))
      OR (r.destinatario = 'familia_individual' AND r.creado_por <> auth.uid()
           AND public.tiene_permiso_sobre(r.nino_id, 'puede_recibir_mensajes'))
      OR (r.destinatario = 'familias_aula'  AND r.creado_por <> auth.uid()
           AND public.es_tutor_en_aula(r.aula_id))
      OR (r.destinatario = 'familias_centro' AND r.creado_por <> auth.uid()
           AND public.es_tutor_en_centro(r.centro_id))
    );
$$;
```

### 3.5 Trigger `set_centro_id`, audit y Realtime

- Trigger BEFORE INSERT `recordatorios_set_centro_id`: deriva `centro_id` desde `nino_id` (familia_individual) o desde `aula_id` (familias_aula, vía `centro_de_aula`); para `familias_centro`/`profe_individual`/`profes_centro`/`personal` el action lo pasa explícito. Si queda NULL → EXCEPTION.
- `audit_trigger_function`: la rama `recordatorios` se mantiene (`centro_id` directo). Sin cambios.
- Realtime: re-añadir `recordatorios` a `supabase_realtime`.

### 3.6 Migración (atómica, idempotente, DESTRUCTIVA — D1)

```sql
BEGIN;
  -- Idempotencia: limpiar policies/triggers/funciones del modelo viejo.
  DROP TABLE IF EXISTS public.recordatorios CASCADE;   -- borra policies, triggers, índices
  DROP TYPE  IF EXISTS public.recordatorio_destinatario;

  -- (re)crear: ENUM, helpers, tabla, índices, trigger set_centro_id,
  -- rama audit (idempotente), RLS x3, RPC badge, Realtime.
  -- … (cuerpo de §3.1–3.5) …
COMMIT;
```

Aplicada **manualmente vía Supabase SQL Editor pre-merge** (patrón F5B/F6-A; el CLI tiene el bug SIGILL). El responsable confirma volumen ≈0 antes (D1).

---

## 4. Sub-fases F6-C

Partición en **3 sub-PRs** por interdependencia:

- **F6-C-1 — Re-modelado granular + badge** (el grueso). Modelo nuevo, RLS, helpers, RPC badge, action cores reescritos, queries nuevas, form jerárquico, i18n, badge component + wiring, ADR-0037, tests. El badge va aquí porque su RPC depende del modelo nuevo (acoplado).
- **F6-C-2 — Fix push notifications** (`ServiceWorkerRegister` eager en layout raíz, sin gate dev). **Independiente del remodel**: bug bloqueante de piloto, bajo riesgo. **Puede ir ANTES de F6-C-1 si urge el piloto.**
- **F6-C-3 — Entry points contextuales** (botón en `/admin/ninos/[id]` y `/teacher/aula/[id]`). Depende del form de F6-C-1.

**Orden recomendado:** F6-C-2 (desbloquea push ya) → F6-C-1 → F6-C-3. Cada uno con sus 3 checkpoints del workflow NIDO; merge solo por el responsable.

---

## 5. Plan de cambios

### F6-C-1 — Re-modelado granular + badge

| Archivo                                                                 | Acción                                                                             | Líneas aprox. |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------- |
| `supabase/migrations/2026XXXX_phase6c_reminders_remodel.sql`            | nuevo: ENUM, 2 helpers, tabla, índices, trigger, audit, 3 RLS, RPC badge, Realtime | ~260          |
| `src/types/database.ts`                                                 | regenerar tras aplicar migración                                                   | (auto)        |
| `src/features/recordatorios/schemas/recordatorios.ts`                   | ENUM 6 valores, cross-field (`requiereNino`/`requiereAula`/`requiereUsuario`)      | ~40           |
| `src/features/recordatorios/types.ts`                                   | `RecordatorioListItem` + `aula_id`/`aula_nombre`/`usuario_destinatario_nombre`     | ~20           |
| `src/features/recordatorios/lib/form-helpers.ts`                        | `destinosParaRol` (6/3 por rol), `requiereAula`, `requiereUsuario`                 | ~50           |
| `src/features/recordatorios/lib/audiencia.ts`                           | reescritura `expandirDestinatariosRecordatorio` (6 destinos)                       | ~90           |
| `src/features/recordatorios/actions/crear-recordatorio.ts`              | core: payload + `centro_id` por destino (niño/aula/centro/usuario)                 | ~80           |
| `src/features/recordatorios/actions/{completar,anular}-recordatorio.ts` | menor (sin cambio de firma)                                                        | ~10           |
| `src/features/recordatorios/queries/get-aulas-para-recordatorios.ts`    | **nuevo** (admin→centro, profe→sus aulas)                                          | ~35           |
| `src/features/recordatorios/queries/get-profes-para-recordatorios.ts`   | **nuevo** (reusa `getProfesCandidatos`)                                            | ~20           |
| `src/features/recordatorios/queries/contar-pendientes.ts`               | **nuevo** (RPC `contar_recordatorios_pendientes`)                                  | ~20           |
| `src/features/recordatorios/components/RecordatorioFormDialog.tsx`      | selects condicionales niño/aula/profe                                              | ~120          |
| `src/features/recordatorios/components/RecordatoriosBadge.tsx`          | **nuevo** (mirror `MessagingBadge`)                                                | ~55           |
| `src/features/recordatorios/actions/get-pendientes-count-action.ts`     | **nuevo** (wrapper RPC para badge)                                                 | ~20           |
| `src/shared/lib/sidebar-items.tsx`                                      | `trailing` recordatorios para admin/profe                                          | ~10           |
| `src/app/[locale]/{admin,teacher}/layout.tsx` + `reminders/layout.tsx`  | calcular count inicial + pasar `<RecordatoriosBadge>`                              | ~15           |
| `messages/{es,en,va}.json`                                              | 6 destinos + labels selects + ayudas                                               | ~80           |
| `docs/decisions/ADR-0037-*.md`                                          | nuevo (supera ADR-0035)                                                            | ~60           |
| `docs/architecture/{data-model,rls-policies}.md`                        | actualizar sección recordatorios                                                   | ~40           |
| Tests (ver §6)                                                          | reescritura                                                                        | ~400          |

### F6-C-2 — Fix push

| Archivo                                                  | Acción                                                                       | Líneas |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| `src/features/push/components/ServiceWorkerRegister.tsx` | **nuevo**: `'use client'` + `useEffect` → `register('/sw.js')`, sin gate dev | ~25    |
| `src/app/[locale]/layout.tsx`                            | montar `<ServiceWorkerRegister />`                                           | ~3     |
| (ops) Vercel env vars                                    | verificar `VAPID_*` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY`                         | —      |
| Tests                                                    | smoke registro SW (mock `navigator.serviceWorker`) + e2e skip                | ~40    |

### F6-C-3 — Entry points

| Archivo                                                              | Acción                                                   | Líneas |
| -------------------------------------------------------------------- | -------------------------------------------------------- | ------ |
| `src/features/recordatorios/components/RecordatorioFormDialog.tsx`   | aceptar `preset` (`{ destinatario, nino_id?/aula_id? }`) | ~20    |
| `src/app/[locale]/admin/ninos/[id]/page.tsx`                         | botón "crear recordatorio sobre este niño"               | ~15    |
| `src/app/[locale]/teacher/aula/[id]/page.tsx`                        | botón "recordatorio a familias de esta aula"             | ~15    |
| `src/features/recordatorios/queries/get-ninos-para-recordatorios.ts` | (opcional) `getNinosPorAula` si hace falta               | ~25    |
| Tests                                                                | component + e2e skip                                     | ~60    |

---

## 6. Tests

- **Unit (action cores):** reescribir `crearRecordatorioCore` por los 6 destinos (payload, `centro_id`, coherencia). `expandirDestinatariosRecordatorio` por destino (mock service client). `form-helpers` (`destinosParaRol`/`requiereAula`/`requiereUsuario`).
- **RLS reales** (`src/test/rls/recordatorios.rls.test.ts`, gated `RECORDATORIOS_MIGRATION_APPLIED`): matriz D9 completa (INSERT por rol×destino), SELECT por destino (tutor del aula ve `familias_aula`; profe ve `profes_centro`; admin ve todo), **gotcha MVCC `.insert().select()` en los 6 destinos**, RPC `contar_recordatorios_pendientes` (tutor cuenta sus broadcasts no propios; admin no cuenta lo que solo observa).
- **Audit** (`recordatorios-audit.test.ts`): INSERT/UPDATE/anular con el modelo nuevo.
- **Component:** `RecordatorioFormDialog` monta con destinos por rol y muestra el segundo selector correcto (limitación jsdom Base-UI documentada, cobertura vía helpers + cores). `RecordatoriosBadge` (estado inicial + refresh por realtime, mock RPC).
- **E2E `test.skip`:** admin crea `familias_aula`; tutor recibe en badge; redirect tutor (ya en #44).

---

## 7. Estimación realista

| Sub-fase  | Alcance                                                  | Estimación    |
| --------- | -------------------------------------------------------- | ------------- |
| F6-C-1    | remodel + badge (lo más pesado: RLS + form + tests)      | **5–6 h**     |
| F6-C-2    | fix push (pequeño, pero validación real en dispositivos) | **1.5–2.5 h** |
| F6-C-3    | entry points                                             | **1.5–2 h**   |
| **Total** |                                                          | **~8–11 h**   |

Riesgo principal: validación push en dispositivos reales (móvil + PC) tras F6-C-2 — requiere ciclo de prueba manual con suscripción real, no automatizable.

---

## 8. Notas

- **Regla #45:** F6-C-1 y F6-C-3 modifican/añaden actions `'use server'` → **build obligatorio** antes de PR (con el workaround OOM del Chromebook: `rm -rf .next && NODE_OPTIONS="--max-old-space-size=3584" npm run build`). F6-C-2 no añade actions.
- **Migración:** aplicada manualmente vía **Supabase SQL Editor** pre-merge (CLI con bug SIGILL). DESTRUCTIVA (D1) — confirmar volumen ≈0.
- **ADR-0037** "Modelo granular de destinatarios de recordatorios" supera a **ADR-0035**; referencia el cambio de "bidireccional" a "centro→familia + interno admin→profe". ADR-0036 (completar idempotente) sigue vigente.
- **i18n:** valenciano traducido de verdad desde el día 1 (sin placeholders en JSON), patrón establecido.
- El **fix push (F6-C-2) es independiente y de bajo riesgo**: puede mergearse antes que el remodel para desbloquear el piloto cuanto antes.

---

## 9. Branch + título del primer sub-PR

- **F6-C-1** — rama `feat/recordatorios-c-remodel` · título `feat(recordatorios): re-modelado granular de destinatarios (F6-C-1)`
- **F6-C-2** — rama `fix/push-sw-registro` · título `fix(push): registrar service worker de forma proactiva (F6-C-2)`
- **F6-C-3** — rama `feat/recordatorios-entry-points` · título `feat(recordatorios): entry points contextuales niño/aula (F6-C-3)`
