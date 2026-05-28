# ADR-0031: Marcar erróneo limitado a 5 minutos, en RLS inline, sin moderación admin

## Estado

`accepted`

**Fecha:** 2026-05-28
**Autores:** Jovi Mibimbi + claude-code (Opus 4.7)
**Fase del proyecto:** Fase 5.6 — Ventana de anulación 5 minutos (F5.6-B)

## Contexto

F5 introdujo el patrón "marcar como erróneo" en mensajes y anuncios: en lugar de DELETE (bloqueado por default DENY), el autor pone `erroneo=true` y prefija el contenido con `[anulado] `. F5 documentaba explícitamente: _"Sin ventana de edición: mensajería es continua. Un mensaje enviado ayer sigue siendo anulable hoy."_

Producto (Checkpoint A F5.6): esa decisión se invierte por experiencia del usuario en piloto. **Anular un mensaje semanas después corrompe la lectura del histórico** — el otro extremo ve la "anulación" como una corrección, no como un evento puntual, y entra confusión. WhatsApp resuelve esto con la ventana de "Borrar para todos" de 60 minutos; Telegram con 48 horas. Decidimos **5 minutos** porque:

- ANAIA es comunicación profesional adulto↔adulto (familia↔centro), no chat social. El mensaje "se quedó mal" se detecta en segundos, no días.
- 5 minutos es suficiente para corregir un typo o un destinatario equivocado, lejos de "reescribir el histórico".
- Aplica a **mensajes** (profe↔familia y admin↔familia) **y anuncios** — coherencia: el mismo concepto en los dos canales.

Restricciones:

- La barrera debe ser autoritativa en BD; el cliente solo aporta UX (ocultar el botón).
- Ningún rol del centro debe poder "moderar" mensajes ajenos. El admin del centro NO puede anular un mensaje del tutor ni viceversa (ver justificación de no-moderación abajo).

Hay que decidir AHORA porque F5.6-B forma parte del scope de la fase y la migración tiene que aplicarse antes de cerrar.

## Opciones consideradas

### Opción A: RLS inline en UPDATE policies (`created_at > now() - interval '5 min'`)

Reescribir `mensajes_update_autor` y `anuncios_update_autor` añadiendo la condición temporal a `USING` y `WITH CHECK`.

**Pros:**

- Una sola línea por policy. Sin función SQL nueva. Sin lookup cross-tabla (no aplica el patrón de helpers SECURITY DEFINER de ADR-0007).
- Sin riesgo MVCC: es UPDATE, no `INSERT…RETURNING`, así que no aplica el gotcha de F5.
- BD-enforced: cualquier UPDATE (cliente, script, futura edge function) está sujeto a la regla.
- Verificable con tests RLS estándar de PostgREST.

**Contras:**

- La ventana se "hardcodea" en SQL. Cambiarla a 10 min implica una migración.

### Opción B: Helper SQL `dentro_de_ventana_anulacion(p_created_at timestamptz)`

Crear un helper `STABLE SECURITY DEFINER` con la lógica y usarlo en las dos policies.

**Pros:**

- Si se cambia la ventana, se cambia en un sitio.

**Contras:**

- Por simetría con `dentro_de_ventana_edicion(date)` (F3/F4) podría parecer la opción "natural", pero `dentro_de_ventana_edicion` justifica el helper porque hace tz-aware Madrid y porque se usa en N tablas. Aquí solo en 2 policies con una expresión trivial.
- Coste extra de función (pequeño) sin contraprestación.

### Opción C: Check solo en server action, RLS sin condición temporal

Mantener la RLS de F5 (`autor_id = auth.uid()`) y hacer el chequeo de 5 min en `marcarMensajeErroneo` / `marcarAnuncioErroneo`.

**Pros:**

- Lógica en TS, testeable unit puro.
- Mensaje de error más legible (no depende del `42501`).

**Contras:**

- Cualquier herramienta que mute esa tabla sin pasar por la action (script con service role; futura edge function) se salta la ventana.
- Si en el futuro otro server action toca `mensajes.UPDATE`, hereda la libertad — invariante frágil.

### Opción D: Statu quo (no implementar la ventana)

Mantener F5: mensajes/anuncios anulables sin límite temporal.

**Pros:**

- Cero esfuerzo.

**Contras:**

- Va contra la decisión validada en piloto (Checkpoint A).

### Opción E: Moderación por admin (descartada explícitamente)

Permitir que el admin del centro pueda marcar como erróneo cualquier mensaje del centro, no solo el suyo.

**Pros:**

- Útil ante un mensaje inapropiado.

**Contras:**

- **NIDO es comunicación entre adultos (padres ↔ profes/dirección), NO un canal con menores como destinatarios.** El modelo de moderación de plataformas con menores (Roblox, Discord teen) no aplica aquí. La analogía correcta es WhatsApp profesional / Slack: cada autor anula lo suyo, nadie más.
- La autoridad para "borrar para todos" rompe la trazabilidad: un mensaje desaparece y el otro extremo no sabe si lo leyó o no. Para incidencias graves existe el canal off-app (dirección llama por teléfono o convoca tutoría) — no debe colarse en el feed.
- Si en el futuro hay un problema real de mensaje inapropiado, el camino es el procedural (audit log) no el técnico (un botón "moderar").

## Decisión

**Opción A: RLS inline con `created_at > now() - interval '5 minutes'`. Aplica a mensajes y anuncios. NO hay moderación admin.**

Implementación en `20260528200000_phase5_6b_ventana_anulacion.sql`:

```sql
DROP POLICY IF EXISTS mensajes_update_autor ON public.mensajes;
CREATE POLICY mensajes_update_autor ON public.mensajes
  FOR UPDATE
  USING (
    autor_id = auth.uid()
    AND created_at > now() - interval '5 minutes'
  )
  WITH CHECK (
    autor_id = auth.uid()
    AND created_at > now() - interval '5 minutes'
  );

-- Análoga para anuncios_update_autor.
```

Capa cliente (defensa UX):

- `MarcarErroneoButton` recibe `createdAt` por props, snapshot `Date.now()` al montar con lazy initializer (React 19 `react-hooks/purity`), early-return `null` si la diferencia supera 5 min.
- Server actions `marcarMensajeErroneoCore` y `marcarAnuncioErroneoCore` pre-chequean la edad y, al hacer el UPDATE, usan `.select('id').maybeSingle()` y mapean `data === null` a `messages.errors.ventana_anulacion_expirada` (para el caso "USING falso → 0 filas", documentado en ADR-0030).

## Por qué aplica a ambos targets idéntico

Anuncio y mensaje son canales distintos pero el contrato "te equivocaste, tienes 5 min para corregir" es el mismo. Distinguir las ventanas por target dispararía preguntas constantes ("¿por qué un anuncio puedo anularlo en 60 min y un mensaje en 5?") sin valor. Misma constante en ambos.

## Consecuencias

**Positivas:**

- Inmutabilidad post-5min garantizada por BD. Histórico fiable.
- Sin moderación → flujo simple y predecible para usuarios y para el equipo de soporte.
- Coherencia con la mental model "tu mensaje, tu responsabilidad".

**Negativas:**

- Si un usuario detecta un error a los 6 minutos, no puede deshacerlo. La política operativa será "envía un mensaje rectificando" — la trazabilidad del histórico vale más que la facilidad de borrar.
- **Mensajes/anuncios creados >5min antes de aplicar la migración quedan inmutables desde ese momento.** En ANAIA pre-prod (sin tráfico real) impacto = 0. En centros con tráfico previo habría que comunicarlo.

## Referencias

- Spec F5.6: [docs/specs/phase-5-6-admin-family-messaging.md](../specs/phase-5-6-admin-family-messaging.md)
- Migración F5.6-B: [supabase/migrations/20260528200000_phase5_6b_ventana_anulacion.sql](../../supabase/migrations/20260528200000_phase5_6b_ventana_anulacion.sql)
- Tests RLS t32-t35: [src/test/rls/messaging.rls.test.ts](../../src/test/rls/messaging.rls.test.ts)
- ADR-0029 (per-par): [ADR-0029-admin-familia-per-par.md](ADR-0029-admin-familia-per-par.md)
- ADR-0030 (timer trigger): [ADR-0030-admin-familia-timer-trigger.md](ADR-0030-admin-familia-timer-trigger.md)
- ADR-0023 (modelo F5 + patrón "marcar erróneo" original): [ADR-0023-modelo-mensajeria-cinco-tablas.md](ADR-0023-modelo-mensajeria-cinco-tablas.md)
