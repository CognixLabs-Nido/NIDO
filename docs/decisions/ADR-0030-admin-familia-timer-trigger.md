# ADR-0030: Timer reseteable de admin↔familia vía trigger AFTER INSERT con SECURITY DEFINER

## Estado

`accepted`

**Fecha:** 2026-05-28
**Autores:** Jovi Mibimbi + claude-code (Opus 4.7)
**Fase del proyecto:** Fase 5.6 — Conversación admin ↔ familia (F5.6-A)

## Contexto

Producto (Checkpoint A F5.6): un hilo admin↔familia debe **caducar a los 3 días sin actividad**. Al enviar un mensaje, el reloj se reinicia. Al caducar, el hilo queda read-only para ambos lados; el admin (y solo el admin) puede reabrirlo, lo que reinicia el reloj 3 días.

Restricciones de partida:

- El RLS de `conversaciones` en F5 es **default DENY UPDATE** (solo el trigger interno actualiza `last_message_at`). Cualquier UPDATE desde cliente para "renovar el timer" requiere ampliar la policy o saltarla.
- El **tutor** debe poder enviar mensajes en un hilo activo y eso debe renovar el timer del par. El tutor NO debe poder hacer UPDATE de `conversaciones` (rompe el principio "estado del hilo es del sistema, no del cliente").
- La renovación tiene que ser **atómica con el INSERT del mensaje** — si fallase y el mensaje quedase pero el timer no se renovase, el hilo aparecería como caducado tras un mensaje que lo despertó.
- La spec dice "3 días sin actividad", no "3 días sin mensajes del admin". Cualquier mensaje (admin o tutor) cuenta.

Hay que decidir AHORA porque la migración F5.6-A precisa el mecanismo de renovación antes de poder probar el flujo end-to-end.

## Opciones consideradas

### Opción A: Trigger AFTER INSERT en `mensajes` con `SECURITY DEFINER` (elegida)

Trigger `mensajes_reset_admin_familia_timer_trg` que tras cada INSERT en `mensajes` mira si la conversación es `admin_familia` y, si lo es, hace `UPDATE conversaciones SET expires_at = now() + 3 days WHERE id = NEW.conversacion_id`. La función trigger es `SECURITY DEFINER`, así que bypasa la RLS de `conversaciones` (que sigue siendo default DENY UPDATE).

**Pros:**

- Atómico con el INSERT del mensaje — misma transacción, mismo statement; si el INSERT falla, el UPDATE también.
- El tutor renueva el timer sin necesitar `UPDATE` directo en `conversaciones` (no tiene RLS para ello).
- Mantiene el invariante "estado del hilo lo gestiona el sistema, no el cliente".
- Coherente con el patrón ya existente: `last_message_at` se actualiza por un trigger AFTER INSERT en F5 con el mismo enfoque.

**Contras:**

- Lógica de negocio en la BD (no en la action). Más difícil de testear en aislamiento — hay que probarla contra Postgres real.
- Comportamiento "invisible" desde el cliente: el cliente envía mensaje y, sin haberlo pedido, el timer se renueva.

### Opción B: La server action `enviarMensaje` hace dos statements (INSERT mensaje + UPDATE conversación)

El action calcula el nuevo `expires_at` y emite dos peticiones a Postgres.

**Pros:**

- Lógica en TS, testable unit.

**Contras:**

- **Requiere abrir la RLS UPDATE de `conversaciones`** para el tutor o crear un RPC `SECURITY DEFINER` ad-hoc. Cualquiera de las dos opciones rompe el principio "el tutor no puede modificar conversaciones".
- No-atómico: si el INSERT pasa y el UPDATE falla (red, race), el mensaje queda pero el timer no se renueva. Estado inconsistente.
- Más round-trips desde el cliente.

### Opción C: Calcular caducidad en cliente desde `max(created_at)` de los mensajes

No persistir `expires_at`; computarlo en cada query: `max(mensaje.created_at) + 3 días`.

**Pros:**

- Sin columna nueva, sin trigger, sin RLS extra.

**Contras:**

- La caducidad depende de que existan mensajes. La reapertura sin mensaje (admin pulsa "reabrir") no tendría dónde anclarse. Habría que persistir un `last_reset_at` aparte y, de hecho, equivaldría a `expires_at` con un nombre distinto.
- Query más cara: cada lectura del hilo necesita el `max()` de mensajes para saber si está caducado.

### Opción D: No persistir caducidad — confiar solo en el cliente

UI deshabilita el composer pasados 3 días desde el último mensaje. Server no enforza nada.

**Pros:**

- Cero esfuerzo backend.

**Contras:**

- Cliente manipulable: cualquiera con devtools envía mensaje pasados 30 días. Rompe el principio "RLS es la red de seguridad".
- Inconsistencia entre clientes con reloj distinto.

## Decisión

**Opción A: trigger AFTER INSERT con SECURITY DEFINER.**

Implementación en `20260528100000_phase5_6_admin_family_messaging.sql`:

```sql
CREATE OR REPLACE FUNCTION public.mensajes_reset_admin_familia_timer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tipo public.tipo_conversacion;
BEGIN
  SELECT tipo_conversacion INTO v_tipo
  FROM public.conversaciones WHERE id = NEW.conversacion_id;
  IF v_tipo = 'admin_familia' THEN
    UPDATE public.conversaciones
       SET expires_at = now() + interval '3 days'
     WHERE id = NEW.conversacion_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER mensajes_reset_admin_familia_timer_trg
  AFTER INSERT ON public.mensajes
  FOR EACH ROW EXECUTE FUNCTION public.mensajes_reset_admin_familia_timer();
```

Y, complementario a este ADR, el comportamiento del UPDATE para "mensaje admin_familia caducado" (verificado en F5.6-B) se enforza con la policy del par `mensajes`+`conversaciones`:

- La policy `mensajes_insert` se amplió en F5.6-A para exigir `conversacion_activa(conversacion_id)` además de `puede_participar_conversacion(conversacion_id)`. `conversacion_activa` lee `expires_at > now()` o no aplica si el tipo no es `admin_familia`.

## Hallazgos durante la implementación

### USING + WITH CHECK son ambos necesarios en la policy UPDATE de F5.6-B

Cuando F5.6-B reescribe `mensajes_update_autor` para añadir `created_at > now() - interval '5 minutes'`:

```sql
USING (autor_id = auth.uid() AND created_at > now() - interval '5 minutes')
WITH CHECK (autor_id = auth.uid() AND created_at > now() - interval '5 minutes')
```

- `USING` filtra qué filas son visibles para actualizar (sin él, RLS deniega el UPDATE).
- `WITH CHECK` se evalúa sobre el resultado del UPDATE. Sin él, una mutación que NO cambia `created_at` ni `autor_id` aún pasaría aunque el momento del commit caiga fuera de ventana (race entre evaluación de USING y commit final).

Dejamos ambas alineadas — es el patrón de "defensa simétrica" recomendado.

### "USING falso → 0 filas afectadas, error null" (no 42501)

Postgres NO devuelve `42501` cuando el `USING` de un UPDATE rechaza filas. Devuelve "operación OK, 0 filas afectadas, sin error". Lo descubrimos al diseñar el server action `marcarMensajeErroneo`: la primera versión hacía `.update(...).then(check error)` y devolvía `ok` aunque RLS hubiese rechazado todo.

Mitigación: las dos actions de F5.6-B (`marcarMensajeErroneoCore`, `marcarAnuncioErroneoCore`) usan `.update().select('id').maybeSingle()` y, si `data === null`, mapean a `ventana_anulacion_expirada`. El handler de `42501` se mantiene como defensa en profundidad por si en el futuro `WITH CHECK` fallase por otra razón.

Este hallazgo es genérico (no específico de F5.6) y queda documentado aquí porque la próxima vez que alguien defina una policy UPDATE con condiciones temporales en `USING` lo pisará. Se complementa con el "Gotcha MVCC" de F5 (`docs/architecture/rls-policies.md`), que cubre el caso simétrico de `INSERT … RETURNING`.

## Consecuencias

**Positivas:**

- Atomicidad garantizada: si el mensaje se persiste, el timer se renueva.
- Tutor renueva sin necesitar `UPDATE` propio en `conversaciones`.
- Coherencia con el patrón existente de F5 (`last_message_at`).
- La regla queda BD-enforced, no cliente-enforced: cualquier herramienta que inserte un mensaje (script de migración, scheduled task, edge function) renueva el timer correctamente.

**Negativas:**

- El comportamiento de "renovación silenciosa" no es obvio leyendo solo la action: hay que mirar el trigger. Mitigado por comentario en la migración y por este ADR.
- Test del trigger requiere Postgres real (cubierto por `messaging.rls.test.ts` t14-t17 de F5.6-A).

## Referencias

- Spec F5.6: [docs/specs/phase-5-6-admin-family-messaging.md](../specs/phase-5-6-admin-family-messaging.md)
- Migración F5.6-A: [supabase/migrations/20260528100000_phase5_6_admin_family_messaging.sql](../../supabase/migrations/20260528100000_phase5_6_admin_family_messaging.sql)
- Migración F5.6-B: [supabase/migrations/20260528200000_phase5_6b_ventana_anulacion.sql](../../supabase/migrations/20260528200000_phase5_6b_ventana_anulacion.sql)
- ADR-0029 (per-par): [ADR-0029-admin-familia-per-par.md](ADR-0029-admin-familia-per-par.md)
- ADR-0031 (ventana 5 min): [ADR-0031-ventana-anulacion-5min.md](ADR-0031-ventana-anulacion-5min.md)
- ADR-0007 (recursión RLS): [ADR-0007-rls-policy-recursion-avoidance.md](ADR-0007-rls-policy-recursion-avoidance.md)
