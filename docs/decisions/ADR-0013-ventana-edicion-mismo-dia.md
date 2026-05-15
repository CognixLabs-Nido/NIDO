# ADR-0013: Ventana de edición de la agenda diaria = mismo día calendario (deroga la regla previa "hasta 06:00 día siguiente")

## Estado

`accepted` — **deroga** la regla previa documentada en `CLAUDE.md` y `docs/architecture/rls-policies.md`.

**Fecha:** 2026-05-15
**Autores:** Claude Code + responsable NIDO
**Fase del proyecto:** Fase 3 — Agenda diaria + bienestar

## Contexto

Antes de Fase 3, `CLAUDE.md` (línea ~94) y `docs/architecture/rls-policies.md` (sección "Ventana de edición agenda diaria") documentaban la siguiente regla:

> Profe edita hasta las 06:00 del día siguiente. Días anteriores: read-only para profe, **editable para admin con audit log forzado**.

Esta regla nació de la intuición de "dar margen a la profe para acabar la jornada al día siguiente", pero introducía dos problemas:

1. **Ambigüedad para la familia**: si la familia abre la agenda a las 23:55 y luego a las 03:00 ve cambios "del día anterior", la app se siente impredecible.
2. **Vector de error o manipulación**: si admin puede editar el histórico desde UI, antes o después alguien corrige a posteriori sin que la familia lo perciba. Esto rompe la garantía de inmutabilidad que es importante para la confianza familiar (RGPD, retención de evidencias).

Al planificar Fase 3, el responsable pidió revisar la regla y simplificar el modelo mental.

## Opciones consideradas

### Opción A: ventana = mismo día calendario (Madrid), sin excepciones desde UI

- Profe edita solo si `fecha == hoy hora Madrid` (RLS).
- A las 00:00 hora Madrid, el día anterior queda **read-only para todos** los roles (incluido admin) por RLS.
- Si admin debe corregir un evento pasado (caso excepcional: dato erróneo, derecho al olvido parcial), se hace vía SQL con `service_role` (que bypassa RLS) y el cambio queda en `audit_log` igualmente.

**Pros:**

- Una sola ventana, un solo criterio.
- Familia tiene garantía de inmutabilidad clara: lo que ve a las 00:01 hora Madrid es definitivo.
- Tests RLS triviales: no hay franjas horarias raras que mockear.
- Menos rutas de modificación = menos superficie de bugs y de manipulación.

**Contras:**

- Si la profe olvida algo a las 23:55 y guarda a las 00:01, pierde la ventana. La fila no se inserta y queda perdida (la profe podría apuntarla manualmente en mensajería al día siguiente).
- Cualquier corrección de histórico requiere intervención técnica (SQL). No es algo que un admin no-técnico pueda hacer solo.

### Opción B: ventana hasta 06:00 del día siguiente, admin edita histórico vía UI

(La regla original.)

**Pros:**

- Margen humano para la profe.
- Admin auto-suficiente para corregir errores.

**Contras:**

- Modelo mental ambiguo ("¿qué hora es la frontera?").
- Familia no sabe si lo que ve a la noche es definitivo.
- Vector de corrección silenciosa por admin.

### Opción C: ventana = mismo día Madrid, **pero** admin con flag explícito edita histórico vía UI

Híbrido: profe limitada a hoy, admin con un toggle visible ("modo edición histórica") puede editar pasado.

**Pros:**

- Simpler que B para profe; flexibilidad para admin.

**Contras:**

- Complica UI (toggle + indicador en cada evento que diga "editado por admin a posteriori").
- Sigue habiendo vector de corrección silenciosa (toggle activable sin barrera real).
- Aumenta complejidad para un caso de uso poco frecuente.

## Decisión

**Se elige la Opción A (mismo día calendario Madrid, sin excepciones desde UI)** porque:

- **Simplifica el modelo mental** para profe, familia y admin. Una sola ventana.
- **Da garantía explícita de inmutabilidad** a la familia: a las 00:00 hora Madrid el día anterior queda escrito en piedra.
- **Reduce la superficie de bugs y de manipulación accidental o intencionada**.
- **Forzar SQL para corregir histórico** crea una barrera explícita y auditada: cualquier corrección a posteriori requiere acción técnica deliberada, que queda en `audit_log`.
- **Trazabilidad histórica**: el ADR registra cuándo y por qué cambió la regla, evitando que futuros lectores se confundan con la documentación antigua.

### Esta decisión deroga explícitamente:

- `CLAUDE.md` línea ~94: _"Ventana de tiempo en agendas diarias: profe edita hasta 06:00 del día siguiente. Día anterior read-only. Excepciones solo admin con audit log forzado."_
- `docs/architecture/rls-policies.md` sección "Ventana de edición agenda diaria (Fase 3+)" con la misma redacción.

Ambos documentos se actualizan en el commit de docs de Fase 3 para que la regla nueva sea la única vigente.

## Consecuencias

### Positivas

- **Familia confía en lo que ve.** A las 00:00 hora Madrid la agenda del día anterior es definitiva.
- **RLS más simple.** El helper `dentro_de_ventana_edicion(fecha)` es 1 línea SQL.
- **Tests RLS estables.** No hay franjas horarias móviles que mockear.
- **Audit log limpio.** Las correcciones por SQL siguen quedando en `audit_log` con `usuario_id` = NULL o el del operador técnico que abrió la conexión.

### Negativas

- **Profe que olvida algo a las 23:55** y guarda a las 00:01 → la fila no se inserta. Mitigación: la profe avisa por mensajería (Fase 5) o admin lo corrige por SQL.
- **Admin no autosuficiente** para corregir histórico → requiere a un técnico con acceso a la BD. Cualquier centro suficientemente grande tendrá soporte técnico interno o contratado.
- **Resistencia inicial al cambio** de quienes esperaban margen post-medianoche. Mitigación: comunicación clara en onboarding.

### Neutras

- La política RLS de `UPDATE` evalúa `WITH CHECK` además de `USING`, así que **mover una fila a otro día** (cambiar `fecha` o `nino_id`) tampoco es posible: ambas comprobaciones exigen `dentro_de_ventana_edicion(fecha)`.

## Plan de implementación

- [x] Helper `public.dentro_de_ventana_edicion(fecha)` en migración Fase 3 (ver ADR-0011 para huso).
- [x] Políticas RLS de INSERT/UPDATE en las 5 tablas exigen `dentro_de_ventana_edicion(fecha)`.
- [x] DELETE sin policy → default DENY para todos los roles.
- [x] Tests RLS verifican: profe puede insertar agenda de hoy, NO puede insertar de ayer/anteayer, NO puede UPDATE en fila con `fecha=ayer`.
- [x] Tests Vitest del helper (`src/test/rls/dentro-de-ventana-edicion.test.ts`) cubren HOY/AYER/MAÑANA.
- [x] UI profe muestra inputs `disabled` + badge "Día cerrado" si `fecha != hoy`.
- [x] UI familia ya es read-only siempre — no necesita lógica adicional.
- [ ] Actualizar `CLAUDE.md` línea ~94 con la nueva regla.
- [ ] Actualizar `docs/architecture/rls-policies.md` sección "Ventana de edición agenda diaria" con la nueva regla y enlace a este ADR.
- [ ] Mencionar en `docs/journey/progress.md` la derogación.

## Verificación

- Tests RLS `agenda-diaria.rls.test.ts` cubren 8 escenarios, incluyendo:
  - Profe puede INSERT agenda de hoy ✓
  - Profe NO puede INSERT agenda de anteayer ✓
  - Profe NO puede UPDATE agenda existente con fecha=ayer ✓
- Test helper `dentro-de-ventana-edicion.test.ts`: HOY → true, AYER → false, MAÑANA → false ✓
- Smoke manual en preview: a las 23:55 hora Madrid se puede editar; a las 00:05 ya no.
- `audit_log` registra los intentos rechazados como ausencia de fila (no se inserta nada porque RLS rechaza antes que el trigger se dispare).

## Notas

- Si en el futuro aparece un caso real fuerte para la regla antigua (ej. profes en turno de noche que rellenan el día anterior), revisaremos. Por ahora, la simpleza pesa más que la flexibilidad hipotética.
- La regla "no hay UPDATE/DELETE por UI tras el cambio de día" se complementa con el flujo "Marcar como erróneo" (ver spec daily-agenda.md § B18): un evento mal apuntado se marca como anulado dentro de la ventana del mismo día, no se borra ni se reescribe a posteriori.

## Referencias

- Spec: `/docs/specs/daily-agenda.md` § "B21 — Ventana de edición (RLS-enforced)"
- Migración: `supabase/migrations/20260515153711_phase3_daily_agenda.sql`
- ADR-0011 — Timezone Europe/Madrid hardcoded en el helper
- ADR-0012 — 5 tablas separadas
- Documentos derogados: `CLAUDE.md` (línea ~94, regla previa), `docs/architecture/rls-policies.md` (sección "Ventana de edición agenda diaria")
