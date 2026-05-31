---
feature: reminders
wave: 1
status: draft
priority: high
last_updated: 2026-05-31
related_adrs: [ADR-0029, ADR-0030, ADR-0031, ADR-0027, ADR-0025, ADR-0016, ADR-0011, ADR-0007]
related_specs: [messaging, phase-5-6-admin-family-messaging, push-notifications, school-calendar]
---

# Spec — F6 · Recordatorios bidireccionales (E)

> **Checkpoint A.** Esta spec es el entregable del Checkpoint A. No se toca código hasta aprobación del responsable. Las 10 decisiones de producto van marcadas 🔒 con recomendación.

## Resumen ejecutivo

Recordatorios accionables y **bidireccionales** entre el centro y la familia: un mensaje con **vencimiento opcional** y **estado de cumplimiento** (`pendiente` → `completado`), dirigido a un destinatario que debe verlo o actuar. A diferencia de la mensajería (F5, conversación libre) o los anuncios (F5, broadcast), un recordatorio es una **tarea con dueño y opcionalmente fecha límite** que se puede marcar como hecha y que dispara un push al crearse.

## Contexto

- Feature **E** del research (`docs/research-comparativa-nido.md` líneas 168–213): _"recordatorios bidireccionales completos — unifica lo que Tyra ofrece a medias en su caja del perfil"_. Diferenciador de producto frente a la competencia.
- Hueco real del piloto ANAIA (centro pequeño, 5 aulas, 0-3 años): hoy la mensajería sirve para conversar, pero **no** para "el viernes traer la cartilla de vacunas" con seguimiento de si se hizo. Eso acaba perdido en el hilo.
- Toda la infraestructura transversal ya existe y se reutiliza sin refactor: push (F5.5/#41), patrón "marcar erróneo" con ventana de 5 min (F5.6-B), patrón bidireccional admin↔familia (F5.6-A), helpers RLS (`es_admin`, `es_profe_de_nino`, `es_tutor_de`, `tiene_permiso_sobre`, `centro_de_nino`, `pertenece_a_centro`), audit log automático y el gotcha MVCC documentado.
- F7 (Calendario y eventos) viene después y se coordina aquí (ver 🔒 D8): F7 introducirá `eventos` + `confirmaciones_evento` con rango `inicio/fin`; los recordatorios usan un único instante `vencimiento`. Son entidades distintas; F7 podrá referenciar un recordatorio con una FK nullable sin rehacer el modelo.

## Definición de producto: ¿qué es "bidireccional"?

El eje del producto es la **arista centro ↔ familia de un niño**, recorrida en los dos sentidos, más dos destinos auxiliares. Se modela con un único ENUM `destinatario`:

| `destinatario` | Sentido               | Quién lo crea (emisor)                       | Quién lo ve / actúa (destinatario)                            | Requiere         |
| -------------- | --------------------- | -------------------------------------------- | ------------------------------------------------------------- | ---------------- |
| `familia`      | centro → familia      | admin del centro, profe del niño             | tutores del niño con `puede_recibir_mensajes` (+ staff)       | `nino_id`        |
| `equipo`       | familia → centro      | tutor del niño con `puede_recibir_mensajes`  | profes del aula del niño + admin del centro (+ tutor creador) | `nino_id`        |
| `direccion`    | miembro → dirección   | cualquier miembro del centro (profe o tutor) | admins del centro (+ creador)                                 | solo `centro_id` |
| `personal`     | uno mismo → uno mismo | cualquier miembro                            | el propio creador                                             | solo `centro_id` |

`familia` y `equipo` son **las dos direcciones de la misma arista** (niño-céntrica) → ahí vive la "bidireccionalidad". `direccion` cubre profe→admin (material, baja imprevista) y familia→dirección general. `personal` cubre las notas para uno mismo.

### Casos de uso reales del piloto ANAIA (🔒 D2)

| Caso                                | `destinatario` | Ejemplo                                                                    |
| ----------------------------------- | -------------- | -------------------------------------------------------------------------- |
| Documentación pendiente             | `familia`      | "Traer cartilla de vacunas actualizada antes del viernes"                  |
| Material que aporta la familia      | `familia`      | "Quedan pocos pañales talla 3", "traer muda de recambio"                   |
| Cuota / pago                        | `familia`      | "Recordatorio: cuota de junio pendiente"                                   |
| Reunión / fiesta / salida           | `familia`      | "Reunión de familias el martes 18:00", "salida al parque el jueves, gorra" |
| Recogida distinta hoy               | `equipo`       | "Hoy recoge la abuela a las 16:30"                                         |
| Medicación / novedad médica del día | `equipo`       | "Hoy lleva jarabe, dar a las 13:00", "nueva alergia: frutos secos"         |
| Traer algo especial                 | `equipo`       | "Mañana es su cumple, lleva bizcocho"                                      |
| Necesidad de material (profe)       | `direccion`    | "Faltan toallitas en el aula Pollitos"                                     |
| Baja / incidencia (profe)           | `direccion`    | "Mañana llego 30 min tarde, cita médica"                                   |
| Nota propia                         | `personal`     | (admin) "Llamar al proveedor de menús"                                     |

**MVP del piloto = las 4 categorías de `destinatario`, single-shot, push inmediato al crear.** Fuera de MVP: recurrencia, push programado pre-vencimiento, recordatorio a un usuario arbitrario fuera de estos cuatro destinos, adjuntos. Ver 🔒 D5/D7 y "Alcance".

## User stories

- US-01: Como **admin**, quiero crear un recordatorio para la familia de un niño con fecha límite opcional, para que no se olviden de traer documentación/material y poder ver si ya lo hicieron.
- US-02: Como **profe**, quiero recordar a la familia algo del día a día del niño (material, reunión) y avisar a dirección de necesidades del aula.
- US-03: Como **tutor legal**, quiero avisar al equipo del niño de algo puntual (recogida distinta, medicación de hoy) con un recordatorio que la profe vea destacado, no perdido en el chat.
- US-04: Como **destinatario** (familia o staff), quiero marcar un recordatorio como **completado** y recibir un push al crearse uno nuevo.
- US-05: Como **emisor**, quiero **anular** un recordatorio que mandé por error (ventana de 5 min, igual que en mensajería).
- US-06: Como **admin o profe**, quiero anotarme recordatorios **personales** y verlos en mi lista de pendientes.

## Alcance

**Dentro (MVP F6):**

- 1 tabla nueva `recordatorios` + ENUM `recordatorio_destinatario`.
- 4 destinos: `familia`, `equipo`, `direccion`, `personal`.
- `vencimiento` **opcional** (timestamptz, interpretado en `Europe/Madrid`).
- Estados derivados: `pendiente` / `completado` (vía `completado_en`) + flag `erroneo` (anulación con prefijo `[anulado] `).
- Completar (idempotente, gotcha "0 filas" resuelto) por destinatario o emisor.
- Anular por el emisor dentro de 5 min.
- **Push inmediato al crear** (reutiliza `enviarPushANotificarUsuarios`).
- Vista "Mis pendientes" + lista por niño + formulario de creación.
- RLS por destino, audit log, Realtime, i18n es/en/va.

**Fuera (no se hace aquí):**

- **Recurrencia** (diario/semanal/mensual/custom) → diferida (🔒 D5). Requiere RRULE + generación de instancias + edición serie/instancia.
- **Push programado X horas antes del vencimiento** → diferido (🔒 D7). **No existe infraestructura de cron** en el proyecto (verificado: sin `supabase/functions`, sin `pg_cron`). Requeriría pg_cron + tabla `notificaciones_push` para dedupe + ADR propio.
- **Recordatorio a un usuario arbitrario** (p.ej. admin→profe concreto que no sea vía `direccion`) → fuera de MVP.
- **Adjuntos / enlaces a documentos** → F10 (media).
- **Integración con F7 eventos** (un evento que genera un recordatorio) → se deja el modelo compatible (🔒 D8) pero el cableado es de F7.
- **Borrado físico** → bloqueado (default DENY); no hay `deleted_at` propio (🔒 D10).

## 10 decisiones de producto (🔒)

### 🔒 D1 — Alcance "bidireccional": pares de roles

**Recomendación:** MVP cubre los 4 destinos de la tabla de arriba → `admin↔familia`, `profe↔familia` (ambos vía `familia`/`equipo`), `profe→dirección` y `familia→dirección` (vía `direccion`), y `personales` (`personal`). El rol **`autorizado` queda excluido** del canal por defecto, heredando el patrón F5: solo participa si tiene `puede_recibir_mensajes = true` (igual que conversaciones/anuncios). `service` solo vía bypass server-side.

### 🔒 D2 — Casos de uso MVP

**Recomendación:** los 10 casos enumerados en la tabla "Casos de uso reales del piloto ANAIA". Subset cerrado y suficiente para el piloto.

### 🔒 D3 — Asociación del recordatorio

**Recomendación:** combinación controlada por CHECK estructural según `destinatario`:

- `centro_id` **NOT NULL siempre** (redundante, simplifica RLS — convención del proyecto).
- `nino_id` **obligatorio** para `familia`/`equipo`, **NULL** para `direccion`/`personal`.
- `usuario_destinatario_id` solo para `personal` (= `creado_por`); NULL en el resto.
- **Sin** `conversacion_id` en MVP: el recordatorio es entidad propia, no va hilado a un chat. (Cross-link a F7 `evento_id` se añade en F7, nullable, sin rework.)

### 🔒 D4 — Vencimiento

**Recomendación:** **opcional** (`vencimiento timestamptz NULL`). La UI permite "sin fecha", "solo fecha" (hora por defecto 09:00 Madrid) o "fecha + hora". Se persiste `timestamptz`; se interpreta y muestra en `Europe/Madrid` (coherente con `hoy_madrid()`/`dentro_de_ventana_edicion`). Sin vencimiento = ítem pendiente sin orden temporal. Índice parcial sobre `vencimiento WHERE completado_en IS NULL AND erroneo = false` para "mis pendientes" ordenados.

### 🔒 D5 — Recurrencia

**Recomendación:** **single-shot only en MVP.** Recurrencia diferida a fase posterior (F6.5 o dentro de F7 calendario, donde la recurrencia ya es first-class para eventos). Justificación: RRULE + materialización de instancias + UX de "editar esta / toda la serie" no caben en las 6–8h y el piloto es mayoritariamente puntual.

### 🔒 D6 — Completar

**Recomendación:** pueden marcar **completado** el **destinatario** y el **emisor** (cualquiera que vea el recordatorio según RLS). Sin límite temporal para completar. El gotcha "marcar como completado solo si no estaba ya completo" se resuelve en el server action:

```ts
.update({ completado_en: nowIso, completado_por: userId })
.eq('id', id)
.is('completado_en', null)      // solo si seguía pendiente
.select('id').maybeSingle()
// data === null && !error → ya estaba completado (o RLS USING rechazó) → fail('ya_completado')
```

El `.is('completado_en', null)` hace la operación **idempotente y race-safe** (🔒 D6 resuelve también D-race): dos destinatarios marcando a la vez → el segundo recibe `data: null` → la UI optimista revierte y muestra "ya estaba completado", sin error duro.

### 🔒 D7 — Notificaciones push

**Recomendación:** **(a) inmediata al crear, únicamente, en MVP.** Se reutiliza el pipeline F5.5 (`enviarPushANotificarUsuarios(usuarioIds, payload)`) con un helper de audiencia nuevo por destino. **(b) X horas antes del vencimiento → diferido** por ausencia de cron (ver "Fuera"). `personal` **no** dispara push al crear (te lo creas tú estando en la app). Anti-spam: ver Riesgos.

### 🔒 D8 — Integración futura con F7 Calendario

**Recomendación:** **no** forzar `inicio/fin`. Recordatorio = único instante `vencimiento`; evento (F7) = rango `inicio/fin`. Entidades separadas. Compatibilidad garantizada: F7 podrá añadir `recordatorios.evento_id uuid NULL REFERENCES eventos(id)` para que un evento genere su recordatorio, sin tocar lo de F6. Se documenta el límite en el ADR de F6.

### 🔒 D9 — Visibilidad y RLS por rol

**Recomendación:** por `destinatario` (detalle SQL en "Políticas RLS"):

- `familia`: ven admin del centro, profe del niño, y tutores del niño con `puede_recibir_mensajes`.
- `equipo`: ven admin del centro, profe del niño, y tutores del niño (incluido el creador).
- `direccion`: ven admins del centro y el creador.
- `personal`: solo el creador.

Esto reusa exactamente los helpers existentes (`es_admin`, `es_profe_de_nino`, `es_tutor_de`, `tiene_permiso_sobre`), que leen **otras** tablas (no `recordatorios`) → **el gotcha MVCC NO aplica** (ver "Riesgos"). Un tutor solo ve recordatorios de **sus** niños; un profe, solo de niños de **su** aula; un admin, los de **su** centro.

### 🔒 D10 — Borrado / histórico

**Recomendación:** **sin `deleted_at` propio.** Se reutiliza el patrón de mensajería (F5): el ciclo de vida es `pendiente → completado` (normal) y el error se corrige con `erroneo = true` + prefijo `[anulado] ` en `titulo` (ventana 5 min, solo emisor). **Sin hard delete** (default DENY). Trazabilidad completa en `audit_log`. El derecho al olvido se cubre, como en el resto de tablas operativas, vía soft-delete/CASCADE del niño o usuario + `service_role` (no requiere columna propia). Coherente con `mensajes`/`anuncios`/`agendas`, que tampoco tienen `deleted_at`.

## Comportamientos detallados

### Comportamiento 1: crear recordatorio

**Pre-condiciones:** usuario autenticado, miembro del centro; según destino, ser admin/profe del niño (`familia`), tutor del niño con permiso (`equipo`), miembro del centro (`direccion`/`personal`).
**Flujo:**

1. Usuario elige destino, (si aplica) niño, escribe `titulo` (≤200) y `descripcion` opcional (≤1000), y `vencimiento` opcional.
2. Zod valida cross-field (destino ↔ niño ↔ usuario_destinatario).
3. Server action inserta con `creado_por = auth.uid()`; trigger BEFORE rellena `centro_id` derivado si falta (vía `centro_de_nino`); RLS WITH CHECK autoriza.
4. **Push best-effort** a la audiencia del destino (no `personal`). Si falla, el recordatorio ya está persistido (patrón "catch-all silencioso" de #41).
5. `revalidatePath` de la lista.
   **Post-condiciones:** fila `pendiente`, audit `INSERT`, destinatarios notificados.

### Comportamiento 2: marcar completado

**Pre-condiciones:** ver el recordatorio (RLS), estar pendiente.
**Flujo:** action ejecuta el UPDATE con `.is('completado_en', null)` + `.select().maybeSingle()` (🔒 D6). `data` no nulo → `completado`; `data` null sin error → ya estaba completo → mensaje informativo.
**Post-condiciones:** `completado_en`/`completado_por` poblados, audit `UPDATE`, badge de pendientes decrementa.

### Comportamiento 3: anular (marcar erróneo)

**Pre-condiciones:** ser el emisor, `created_at > now() - 5 min`, no anulado ya.
**Flujo:** pre-check de ventana y autoría en el action; UPDATE `erroneo=true` + prefijo `[anulado] ` en `titulo`; `.select().maybeSingle()` y null-check ("0 filas" → ventana caducó).
**Post-condiciones:** fila marcada, oculta de "pendientes", visible tachada en histórico, audit `UPDATE`.

## Casos edge

- **Sin pendientes:** la lista muestra estado vacío amable por rol ("No tienes recordatorios pendientes").
- **Sin permiso:** un `autorizado` sin `puede_recibir_mensajes` no ve ni crea recordatorios `familia`/`equipo`; ruta protegida redirige a login.
- **Niño dado de baja / sin matrícula activa:** `es_profe_de_nino` deja de resolver al cerrar matrícula → el recordatorio queda visible solo para admin y tutores; se cubre con test.
- **Permiso revocado en sesión:** al perder `puede_recibir_mensajes`, deja de ver `familia`/`equipo` en el siguiente fetch (RLS server-side).
- **Vencimiento en el pasado:** permitido (recordatorio "atrasado"); se resalta en UI, no se bloquea.
- **Race al completar:** segundo escritor recibe `data: null` → "ya completado" (🔒 D6).
- **Anular fuera de ventana:** UPDATE devuelve 0 filas → `fail('ventana_anulacion_expirada')`.
- **Idiomas:** `vencimiento` se formatea con `Intl`/next-intl por locale; `titulo` con prefijo `[anulado] ` no se traduce (es marca de sistema, igual que en mensajería).
- **Push sin suscripción / VAPID ausente:** no rompe la creación (best-effort).

## Validaciones (Zod)

```typescript
export const recordatorioDestinatarioEnum = z.enum(['familia', 'equipo', 'direccion', 'personal'])

export const crearRecordatorioSchema = z
  .object({
    destinatario: recordatorioDestinatarioEnum,
    nino_id: z.string().uuid().nullable(),
    titulo: z
      .string()
      .trim()
      .min(1, 'recordatorios.validation.titulo_vacio')
      .max(200, 'recordatorios.validation.titulo_largo'),
    descripcion: z
      .string()
      .trim()
      .max(1000, 'recordatorios.validation.descripcion_larga')
      .optional(),
    vencimiento: z.string().datetime({ offset: true }).nullable().optional(), // ISO; null = sin fecha
  })
  .superRefine((v, ctx) => {
    if ((v.destinatario === 'familia' || v.destinatario === 'equipo') && !v.nino_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'recordatorios.validation.nino_requerido',
      })
    }
    if ((v.destinatario === 'direccion' || v.destinatario === 'personal') && v.nino_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'recordatorios.validation.nino_no_permitido',
      })
    }
  })

export type CrearRecordatorio = z.infer<typeof crearRecordatorioSchema>

export const completarRecordatorioSchema = z.object({ recordatorio_id: z.string().uuid() })
export const anularRecordatorioSchema = z.object({ recordatorio_id: z.string().uuid() })
```

## Modelo de datos afectado

**Tablas nuevas:** `recordatorios`.
**ENUMs nuevos:** `recordatorio_destinatario`.
**Funciones modificadas:** `audit_trigger_function()` (rama nueva `recordatorios`).
**Tablas consultadas:** `ninos`, `matriculas`, `profes_aulas`, `vinculos_familiares`, `roles_usuario`, `usuarios` (vía helpers existentes y para audiencia push).
**Migración:** `supabase/migrations/2026XXXXXXXXXX_phase6_reminders.sql` (timestamp real al implementar).

### Migración SQL (completa, atómica, idempotente donde aplica)

```sql
-- ==================================================================
-- Fase 6 — Recordatorios bidireccionales
-- ==================================================================
BEGIN;

-- 1) ENUM de destino
DO $$ BEGIN
  CREATE TYPE public.recordatorio_destinatario AS ENUM ('familia', 'equipo', 'direccion', 'personal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Tabla
CREATE TABLE IF NOT EXISTS public.recordatorios (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id                uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  destinatario             public.recordatorio_destinatario NOT NULL,
  nino_id                  uuid REFERENCES public.ninos(id)             ON DELETE CASCADE,
  usuario_destinatario_id  uuid REFERENCES public.usuarios(id)          ON DELETE CASCADE,
  creado_por               uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  titulo                   text NOT NULL,
  descripcion              text,
  vencimiento              timestamptz,
  completado_en            timestamptz,
  completado_por           uuid REFERENCES public.usuarios(id)          ON DELETE SET NULL,
  erroneo                  boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- coherencia estructural por destino (paralelo a conversaciones_tipo_coherencia, F5.6-A)
  CONSTRAINT recordatorios_destino_coherencia CHECK (
    (destinatario IN ('familia','equipo')
       AND nino_id IS NOT NULL AND usuario_destinatario_id IS NULL)
    OR (destinatario = 'direccion'
       AND nino_id IS NULL AND usuario_destinatario_id IS NULL)
    OR (destinatario = 'personal'
       AND nino_id IS NULL AND usuario_destinatario_id IS NOT NULL)
  ),
  -- 200 + 10 chars del prefijo '[anulado] ' (mismo criterio que mensajes/anuncios)
  CONSTRAINT recordatorios_titulo_len CHECK (char_length(titulo) BETWEEN 1 AND 210),
  CONSTRAINT recordatorios_descripcion_len CHECK (descripcion IS NULL OR char_length(descripcion) <= 1000),
  CONSTRAINT recordatorios_completado_coherencia CHECK (
    (completado_en IS NULL AND completado_por IS NULL)
    OR (completado_en IS NOT NULL AND completado_por IS NOT NULL)
  )
);

COMMENT ON TABLE public.recordatorios IS
  'Recordatorios bidireccionales centro<->familia (F6). Ver docs/specs/reminders.md.';

-- 3) Índices
CREATE INDEX IF NOT EXISTS idx_recordatorios_centro
  ON public.recordatorios (centro_id);
CREATE INDEX IF NOT EXISTS idx_recordatorios_nino
  ON public.recordatorios (nino_id) WHERE nino_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recordatorios_usuario_destinatario
  ON public.recordatorios (usuario_destinatario_id) WHERE usuario_destinatario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recordatorios_creado_por
  ON public.recordatorios (creado_por);
-- "mis pendientes" ordenados por vencimiento
CREATE INDEX IF NOT EXISTS idx_recordatorios_pendientes
  ON public.recordatorios (vencimiento)
  WHERE completado_en IS NULL AND erroneo = false;

-- 4) updated_at
DROP TRIGGER IF EXISTS recordatorios_set_updated_at ON public.recordatorios;
CREATE TRIGGER recordatorios_set_updated_at
  BEFORE UPDATE ON public.recordatorios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) Derivar centro_id si falta (paralelo a conversaciones_set_centro_id)
CREATE OR REPLACE FUNCTION public.recordatorios_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL AND NEW.nino_id IS NOT NULL THEN
    NEW.centro_id := public.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'recordatorios: no se pudo derivar centro_id (destinatario=% nino_id=%)',
      NEW.destinatario, NEW.nino_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS recordatorios_set_centro_id_trg ON public.recordatorios;
CREATE TRIGGER recordatorios_set_centro_id_trg
  BEFORE INSERT ON public.recordatorios
  FOR EACH ROW EXECUTE FUNCTION public.recordatorios_set_centro_id();

-- 6) Audit log: añadir rama 'recordatorios' a audit_trigger_function()
--    (se recrea la función completa con la rama nueva; ver migración real)
--    ELSIF TG_TABLE_NAME = 'recordatorios' THEN
--      v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
DROP TRIGGER IF EXISTS audit_recordatorios ON public.recordatorios;
CREATE TRIGGER audit_recordatorios
  AFTER INSERT OR UPDATE OR DELETE ON public.recordatorios
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- 7) RLS
ALTER TABLE public.recordatorios ENABLE ROW LEVEL SECURITY;

-- SELECT: visibilidad por destino (reusa helpers que leen OTRAS tablas → sin gotcha MVCC)
DROP POLICY IF EXISTS recordatorios_select ON public.recordatorios;
CREATE POLICY recordatorios_select ON public.recordatorios
  FOR SELECT USING (
    (destinatario = 'familia' AND (
      public.es_admin(centro_id)
      OR public.es_profe_de_nino(nino_id)
      OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')
    ))
    OR (destinatario = 'equipo' AND (
      public.es_admin(centro_id)
      OR public.es_profe_de_nino(nino_id)
      OR public.es_tutor_de(nino_id)
    ))
    OR (destinatario = 'direccion' AND (
      public.es_admin(centro_id)
      OR creado_por = auth.uid()
    ))
    OR (destinatario = 'personal' AND usuario_destinatario_id = auth.uid())
  );

-- INSERT: quién puede crear cada destino. creado_por anti-suplantación.
DROP POLICY IF EXISTS recordatorios_insert ON public.recordatorios;
CREATE POLICY recordatorios_insert ON public.recordatorios
  FOR INSERT WITH CHECK (
    creado_por = auth.uid()
    AND (
      (destinatario = 'familia'
        AND (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id))
        AND public.centro_de_nino(nino_id) = centro_id)
      OR (destinatario = 'equipo'
        AND public.es_tutor_de(nino_id)
        AND public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')
        AND public.centro_de_nino(nino_id) = centro_id)
      OR (destinatario = 'direccion'
        AND public.pertenece_a_centro(centro_id))
      OR (destinatario = 'personal'
        AND usuario_destinatario_id = auth.uid()
        AND public.pertenece_a_centro(centro_id))
    )
  );

-- UPDATE: completar (cualquiera que lo vea) o anular (emisor, ventana en el action).
-- Misma predicado de visibilidad en USING y WITH CHECK (defensa simétrica, ver gotcha F5.6-B).
-- La restricción de columnas (solo completar/anular) y la ventana de 5 min las enforza el server action.
DROP POLICY IF EXISTS recordatorios_update ON public.recordatorios;
CREATE POLICY recordatorios_update ON public.recordatorios
  FOR UPDATE
  USING (
    (destinatario = 'familia' AND (
      public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id)
      OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')))
    OR (destinatario = 'equipo' AND (
      public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id) OR public.es_tutor_de(nino_id)))
    OR (destinatario = 'direccion' AND (public.es_admin(centro_id) OR creado_por = auth.uid()))
    OR (destinatario = 'personal' AND usuario_destinatario_id = auth.uid())
  )
  WITH CHECK (
    (destinatario = 'familia' AND (
      public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id)
      OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')))
    OR (destinatario = 'equipo' AND (
      public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id) OR public.es_tutor_de(nino_id)))
    OR (destinatario = 'direccion' AND (public.es_admin(centro_id) OR creado_por = auth.uid()))
    OR (destinatario = 'personal' AND usuario_destinatario_id = auth.uid())
  );

-- DELETE: sin policy → default DENY (se usa erroneo + prefijo).

-- 8) Realtime: el badge de "pendientes" se actualiza en vivo (RLS de SELECT filtra los eventos)
ALTER PUBLICATION supabase_realtime ADD TABLE public.recordatorios;

COMMIT;
```

> **Nota de implementación (paso 6):** la migración real **recrea `audit_trigger_function()` completa** añadiendo la rama `recordatorios` (`centro_id` directo), siguiendo el patrón de cada fase que añade tabla auditada (F5 lo hizo así). No se puede `ALTER` una rama suelta del `IF/ELSIF`.

## Políticas RLS

Resumen (SQL completo arriba). Todas reutilizan helpers `SECURITY DEFINER STABLE` existentes; **no se crea ningún helper SQL nuevo** y **no se necesita ningún helper row-aware** porque la policy SELECT lee solo columnas del propio row (`centro_id`, `nino_id`, `creado_por`, `destinatario`, `usuario_destinatario_id`) y delega lookups a **otras** tablas → el gotcha MVCC de F5 **no aplica** (se verifica con test de INSERT…RETURNING).

| Operación | `familia`                                           | `equipo`                                | `direccion`        | `personal`        |
| --------- | --------------------------------------------------- | --------------------------------------- | ------------------ | ----------------- |
| SELECT    | admin · profe del niño · tutor c/permiso            | admin · profe del niño · tutor del niño | admin · creador    | creador           |
| INSERT    | admin · profe del niño                              | tutor del niño c/permiso                | miembro del centro | el propio usuario |
| UPDATE    | = SELECT (completar/anular, restringido por action) | = SELECT                                | = SELECT           | creador           |
| DELETE    | — DENY —                                            | — DENY —                                | — DENY —           | — DENY —          |

## Pantallas y rutas

- `/[locale]/reminders` — "Mis pendientes": lista del usuario (recibidos pendientes + creados), filtros pendiente/completado.
- `/[locale]/reminders/nuevo` — formulario de creación (o modal/composer embebido).
- Integración en mensajería/niño: en la vista del niño (split-view F5B) un acceso a "recordatorios del niño". **Sin ruta nueva por niño en MVP**; se filtra desde la lista. (A confirmar en F6-B según UI.)
- Badge "pendientes" en sidebar vía `buildSidebarItems(rol, locale, badge)` (helper compartido existente).

## Componentes UI

- `RecordatorioForm.tsx` (Client) — RHF + Zod; selector de destino, niño (si aplica), título, descripción, vencimiento opcional.
- `ListaRecordatorios.tsx` (Server) — lista por rol con secciones pendiente/completado.
- `RecordatorioItem.tsx` (Client) — fila con acciones completar / anular (ventana 5 min) y estado.
- `RecordatoriosBadge.tsx` (Client/Server) — contador de pendientes para el sidebar.
- Estados vacíos y skeleton coherentes con messaging.

## Eventos y notificaciones

- **Push (inmediato al crear)** reutilizando `enviarPushANotificarUsuarios`. Audiencia por destino (helper nuevo `destinatariosRecordatorio` en `src/features/recordatorios/lib/audiencia.ts`, análogo a `destinatariosDeNino`):
  - `familia` → tutores del niño con `puede_recibir_mensajes` (excluyendo al emisor).
  - `equipo` → profes activos del aula del niño + admins del centro (excluyendo al emisor).
  - `direccion` → admins del centro (excluyendo al emisor).
  - `personal` → nadie (no push).
- Payload: `{ titulo: <nombre emisor o etiqueta>, cuerpo: <título recordatorio>, url: '/<locale>/reminders', datos: { tipo: 'recordatorio', recordatorio_id } }`.
- **Audit:** automático por trigger (INSERT/UPDATE). DELETE no ocurre.
- **Realtime:** `recordatorios` publicada; el cliente refresca el badge y la lista.

## i18n

Namespace nuevo `recordatorios` en `messages/{es,en,va}.json`:

```json
{
  "recordatorios": {
    "title": "Recordatorios",
    "pendientes": "Pendientes",
    "completados": "Completados",
    "nuevo": "Nuevo recordatorio",
    "destino": {
      "familia": "Para la familia",
      "equipo": "Para el equipo del niño",
      "direccion": "Para dirección",
      "personal": "Para mí"
    },
    "campos": {
      "nino": "Niño",
      "titulo": "Título",
      "descripcion": "Descripción (opcional)",
      "vencimiento": "Fecha límite (opcional)"
    },
    "acciones": {
      "completar": "Marcar como hecho",
      "anular": "Anular",
      "crear": "Crear recordatorio"
    },
    "estado": {
      "completado_por": "Hecho por {nombre}",
      "vence": "Vence {fecha}",
      "sin_fecha": "Sin fecha límite",
      "atrasado": "Atrasado"
    },
    "vacio": {
      "pendientes": "No tienes recordatorios pendientes.",
      "completados": "Aún no hay recordatorios completados."
    },
    "validation": {
      "titulo_vacio": "El título no puede estar vacío.",
      "titulo_largo": "El título no puede exceder 200 caracteres.",
      "descripcion_larga": "La descripción no puede exceder 1000 caracteres.",
      "nino_requerido": "Selecciona el niño.",
      "nino_no_permitido": "Este destino no lleva niño asociado."
    },
    "errors": {
      "no_autorizado": "No tienes permiso para esta acción.",
      "creacion_fallo": "No se pudo crear. Inténtalo de nuevo.",
      "ya_completado": "Este recordatorio ya estaba completado.",
      "ventana_anulacion_expirada": "Solo puedes anular en los primeros 5 minutos.",
      "ya_anulado": "Este recordatorio ya fue anulado."
    }
  }
}
```

## Accesibilidad

- Formulario navegable por teclado; errores con `aria-describedby`.
- Botones completar/anular con `aria-busy` durante la mutación.
- Badge con `aria-label` ("{n} recordatorios pendientes").
- Estado completado/anulado anunciado a lectores (no solo color).

## Performance

- Query "mis pendientes" sobre `idx_recordatorios_pendientes`.
- Listas paginadas (20) en histórico de completados.
- Push: `Promise.allSettled` (igual que F5.5), best-effort, no bloquea la respuesta del action.

## Telemetría

- `recordatorio_creado` (con `destinatario`, sin PII).
- `recordatorio_completado`.
- `recordatorio_anulado`.

## Tests requeridos

**Vitest (unit / action cores):**

- [ ] `crearRecordatorioCore`: éxito por cada destino; rechazo cross-field Zod.
- [ ] `completarRecordatorioCore`: pendiente → completado; **race / ya completado** (`data: null` → `ya_completado`).
- [ ] `anularRecordatorioCore`: dentro de ventana → ok; fuera de ventana / 0 filas → `ventana_anulacion_expirada`; ya anulado → `ya_anulado`.
- [ ] Schema Zod: casos válidos e inválidos por destino.

**Vitest (RLS, proyecto `rls`):**

- [ ] Tutor del niño A no ve recordatorios `familia`/`equipo` del niño B.
- [ ] Profe del aula X ve recordatorios de niños de X, no de otra aula.
- [ ] `autorizado` sin `puede_recibir_mensajes` no ve ni crea `familia`/`equipo`.
- [ ] `personal` solo visible/editable por su creador.
- [ ] `direccion` visible para admin del centro y creador; no para otros tutores.
- [ ] **INSERT…RETURNING** (`.insert().select()`) funciona para cada destino → confirma que el gotcha MVCC no aplica.
- [ ] Completar por destinatario y por emisor permitido; por externo, denegado.
- [ ] DELETE denegado a todos.

**Vitest (audit):**

- [ ] INSERT, UPDATE (completar), UPDATE (anular) generan filas en `audit_log` con `centro_id` correcto.

**Playwright (E2E):**

- [ ] Smoke: ruta `/reminders` protegida (redirige a login) + i18n sin claves crudas (`recordatorios.*`).
- [ ] `test.skip` (real sessions): admin crea recordatorio `familia` → familia lo ve y lo completa.

## Criterios de aceptación

- [ ] Todos los tests anteriores en verde en CI.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (obligatorio por `'use server'`) en verde local.
- [ ] Las 3 lenguas (es/en/va) con todas las claves `recordatorios.*`.
- [ ] axe-core sin violations en `/reminders` y formulario.
- [ ] `docs/architecture/data-model.md` y `docs/architecture/rls-policies.md` actualizados.
- [ ] ADR(s) de F6 escritos (ver abajo).

## Sub-fases de F6

Patrón F5.6 (backend primero, UI+push después). **2 sub-fases, 1 PR cada una.**

| Sub-fase                    | Scope                                                                                                                                                                                                                                                                                                                  | Estimación   | Dependencias                                  | PR                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------- | ---------------------------- |
| **F6-A — Backend**          | Migración (`recordatorios` + ENUM + triggers + audit + RLS + Realtime), Zod schemas, action cores (crear/completar/anular), queries (mis pendientes / por niño), tests RLS + unit + audit. ADR-0035 (modelo recordatorios + por qué no extender `mensajes`) y ADR-0036 (push inmediato y diferimiento del programado). | **~3.5–4 h** | F5.6 mergeado y desplegado (✅, PR #41/#42).  | `feat/recordatorios-backend` |
| **F6-B — UI + push + i18n** | Componentes (`RecordatorioForm`, `ListaRecordatorios`, `RecordatorioItem`, badge), rutas `/reminders`, sidebar badge, helper de audiencia + cableado push best-effort, i18n es/en/va, smoke + e2e skip, docs update.                                                                                                   | **~3–3.5 h** | F6-A mergeado y migración aplicada al remoto. | `feat/recordatorios-ui`      |

**Global revisado: ~6.5–7.5 h** (dentro de la estimación 6–8 h). No se abre F6-C: recurrencia y push programado quedan fuera de F6 (🔒 D5/D7); si entraran, serían una F6.5 con su propia spec.

## Plan de cambios

### F6-A — Backend

| Archivo                                                        | Acción                         | Líneas aprox.                                                               |
| -------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `supabase/migrations/2026XXXX_phase6_reminders.sql`            | crear                          | ~180 (tabla, ENUM, 2 triggers, audit fn recreada, 4 RLS, índices, realtime) |
| `src/features/recordatorios/schemas/recordatorios.ts`          | crear                          | ~50                                                                         |
| `src/features/recordatorios/types.ts`                          | crear                          | ~40                                                                         |
| `src/features/recordatorios/actions/crear-recordatorio.ts`     | crear                          | ~90 (wrapper + core)                                                        |
| `src/features/recordatorios/actions/completar-recordatorio.ts` | crear                          | ~70                                                                         |
| `src/features/recordatorios/actions/anular-recordatorio.ts`    | crear                          | ~70                                                                         |
| `src/features/recordatorios/queries/get-mis-recordatorios.ts`  | crear                          | ~60                                                                         |
| `src/features/recordatorios/queries/get-recordatorios-nino.ts` | crear                          | ~50                                                                         |
| `src/test/rls/recordatorios.rls.test.ts`                       | crear                          | ~250                                                                        |
| `src/features/recordatorios/actions/__tests__/*.test.ts`       | crear                          | ~200                                                                        |
| `src/test/audit/recordatorios-audit.test.ts`                   | crear                          | ~80                                                                         |
| `src/types/database.ts`                                        | regenerar (`npm run db:types`) | —                                                                           |
| `docs/architecture/data-model.md`, `rls-policies.md`           | actualizar                     | ~40                                                                         |
| `docs/decisions/ADR-0035-*.md`, `ADR-0036-*.md`                | crear                          | ~120                                                                        |

### F6-B — UI + push + i18n

| Archivo                                                        | Acción                           | Líneas aprox.                                                                                      |
| -------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/features/recordatorios/lib/audiencia.ts`                  | crear                            | ~90                                                                                                |
| `src/features/recordatorios/lib/constants.ts`                  | crear                            | ~10 (cuidado regla `'use server'`: constantes fuera de archivos con la directiva — lección PR #30) |
| `src/features/recordatorios/components/RecordatorioForm.tsx`   | crear                            | ~140                                                                                               |
| `src/features/recordatorios/components/ListaRecordatorios.tsx` | crear                            | ~110                                                                                               |
| `src/features/recordatorios/components/RecordatorioItem.tsx`   | crear                            | ~90                                                                                                |
| `src/features/recordatorios/components/RecordatoriosBadge.tsx` | crear                            | ~40                                                                                                |
| `src/app/[locale]/reminders/page.tsx` (+ `nuevo/`)             | crear                            | ~120                                                                                               |
| cableado push en `crear-recordatorio.ts`                       | modificar                        | ~30                                                                                                |
| `src/shared/.../buildSidebarItems`                             | modificar (badge)                | ~15                                                                                                |
| `messages/{es,en,va}.json`                                     | añadir namespace `recordatorios` | ~3×60                                                                                              |
| `e2e/reminders.spec.ts`                                        | crear                            | ~80                                                                                                |

**Orden de aplicación:** F6-A completa y mergeada → migración aplicada al remoto por el responsable (SQL Editor, bug SIGILL del CLI) → `db:types` → F6-B.

## Riesgos y gotchas

1. **"USING falso → 0 filas sin error" al completar (🔒 D6).** Resuelto con `.is('completado_en', null).select().maybeSingle()` + null-check → idempotente y race-safe. Es el caso canónico que avisaba el contexto de F6. Cubierto por test de "race / ya completado".
2. **Gotcha MVCC en INSERT…RETURNING — NO aplica aquí.** La policy SELECT de `recordatorios` solo lee columnas del propio row y delega a helpers que consultan otras tablas (`ninos`, `matriculas`, `vinculos`, `roles_usuario`). Se añade un test explícito de `.insert().select()` por destino para confirmarlo (si algún día se añadiera un helper que lea `recordatorios`, habría que hacerlo row-aware).
3. **Ventana de anulación enforzada en el action, no en RLS.** A diferencia de mensajería (ventana en RLS), aquí el UPDATE multiplexa _completar_ (sin límite temporal) y _anular_ (5 min), imposible de separar en una sola policy por tiempo. Trade-off documentado: la ventana de anular vive en el server action (pre-check + null-check); un cliente manipulado podría anular un recordatorio **propio** más tarde — riesgo bajo (solo añade prefijo a lo tuyo, queda en `audit_log`). Se documenta en ADR-0035.
4. **Push spam** con varios recordatorios seguidos. MVP sin batching; mitigación: `personal` no notifica, y el push es 1 por creación (no por vencimiento, que está diferido). Si molesta en piloto, se evalúa digest en fase posterior.
5. **Race al completar** (dos destinatarios). Resuelto por el guard `.is('completado_en', null)` (mismo mecanismo que el gotcha #1).
6. **Coordinación con F7 (🔒 D8).** `vencimiento` (instante) vs `inicio/fin` (rango de evento). No se fuerza compatibilidad estructural; F7 añadirá `evento_id` nullable si quiere generar recordatorios desde eventos.
7. **Regla `'use server'` (lección PR #30).** Las constantes (p.ej. ventana en ms) van en `lib/constants.ts` **sin** la directiva `'use server'`. `npm run build` es obligatorio antes del PR (rutas `/reminders` serán dynamic → además smoke con `npm run start`).

## Decisiones técnicas relevantes (ADRs a crear en F6-A)

- **ADR-0035 — Modelo de recordatorios: tabla propia con ENUM `destinatario`, no extensión de `mensajes`.** Opciones consideradas (extender `mensajes`/`conversaciones` vs tabla nueva), decisión (tabla nueva por el ciclo de vida `pendiente/completado` + `vencimiento`), consecuencias. Incluye el trade-off de la ventana de anulación en action (riesgo #3) y el límite con F7 (🔒 D8).
- **ADR-0036 — Push de recordatorios: inmediato al crear; programado pre-vencimiento diferido.** Por qué no hay cron hoy y qué haría falta (pg_cron + `notificaciones_push`).

## Referencias

- Spec mensajería: `docs/specs/messaging.md`, `docs/specs/phase-5-6-admin-family-messaging.md`.
- Patrón bidireccional + trigger SECURITY DEFINER: ADR-0029, ADR-0030.
- Ventana de anulación 5 min: ADR-0031.
- Push: ADR-0025, ADR-0027; `src/features/push/lib/enviar-push.ts`.
- Gotchas RLS: `docs/architecture/rls-policies.md` (MVCC INSERT…RETURNING; "USING falso → 0 filas").
- F7 calendario: `docs/specs/school-calendar.md`, `scope-ola-1.md`.

---

**Workflow:** Claude escribe (✅ Checkpoint A) → responsable revisa/aprueba (`draft → approved`) → F6-A (implementación + Checkpoint B con migración aplicada y tests verdes) → F6-B (Checkpoint C: pre-merge + preview) → merge por el responsable.
