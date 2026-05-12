---
feature: [slug-de-la-feature]
wave: 1
status: draft
priority: critical | high | medium | low
last_updated: YYYY-MM-DD
related_adrs: []
related_specs: []
---

# Spec — [Nombre de la feature]

> Plantilla. Copia este archivo a `/docs/specs/[feature].md` y rellena cada sección. Borra estos comentarios introductorios y todas las pistas en cursiva antes de marcar la spec como `approved`.

## Resumen ejecutivo

_Una o dos frases describiendo qué hace esta feature y por qué existe. Nivel "elevator pitch"._

## Contexto

_Por qué se hace esta feature ahora. A qué problema responde. Qué usuarios la solicitaron o qué hueco cubre. Referencia a entrevistas o reuniones en `/docs/research/` si aplica._

## User stories

_Una por flujo principal. Formato: "Como [rol], quiero [acción] para [beneficio]."_

- US-01: Como [rol], quiero [acción] para [beneficio].
- US-02: ...
- US-03: ...

## Alcance

**Dentro:**

- _qué entra en esta feature_

**Fuera (no se hace aquí):**

- _qué expresamente NO entra, para evitar scope creep_
- _si algo se difiere a Ola 2 o 3, decirlo explícitamente_

## Comportamientos detallados

### Comportamiento 1: [nombre]

_Descripción funcional clara. Qué pasa cuando el usuario hace X. Qué se valida. Qué se persiste. Qué se notifica._

**Pre-condiciones:**

- ...

**Flujo:**

1. ...
2. ...
3. ...

**Post-condiciones:**

- ...

### Comportamiento 2: [nombre]

...

## Casos edge

_Listar exhaustivamente lo que puede salir mal o las situaciones poco frecuentes._

- **Sin datos previos**: qué muestra la UI cuando no hay nada que listar.
- **Sin permisos**: qué pasa si el usuario llega a una pantalla a la que no debería tener acceso.
- **Sin conexión / red lenta**: cómo se comporta.
- **Datos inválidos**: qué validaciones se aplican y cómo se muestran los errores.
- **Concurrencia**: qué pasa si dos usuarios editan a la vez (relevante para agenda compartida entre profes).
- **Permisos cambiados mientras se usa**: qué pasa si pierdes permisos en medio de una sesión.
- **Idiomas**: cualquier comportamiento dependiente de idioma (formato de fechas, plurales, etc.).
- **Borrado y soft delete**: cómo se comporta sobre datos marcados como `deleted_at`.
- **Datos sensibles**: tratamiento de info médica, consentimientos, etc.
- ...

## Validaciones (Zod)

_Listar los schemas Zod que se usarán. Incluir las reglas de validación y los mensajes de error en i18n._

```typescript
// Ejemplo
export const ComidaSchema = z.object({
  hora: z.string().regex(/^\d{2}:\d{2}$/, 'validation.hora_invalida'),
  cantidad: z.enum(['nada', 'poco', 'mitad', 'todo']),
  observaciones: z.string().max(500, 'validation.observaciones_largas').optional(),
})

export type Comida = z.infer<typeof ComidaSchema>
```

## Modelo de datos afectado

_Listar tablas y columnas nuevas, modificadas o consultadas. Si la feature requiere migración, indicar el archivo `supabase/migrations/`._

**Tablas nuevas:** ...
**Tablas modificadas:** ...
**Tablas consultadas:** ...

## Políticas RLS

_Si esta feature toca tablas con RLS, listar las políticas necesarias. Si todas heredan de funciones helper, indicarlo._

```sql
-- Ejemplo
CREATE POLICY "profes pueden ver agendas de niños de su aula"
ON agendas_diarias
FOR SELECT
USING (auth.es_profe_de_aula(
  (SELECT aula_id FROM matriculas WHERE matriculas.nino_id = agendas_diarias.nino_id AND matriculas.fecha_baja IS NULL)
));
```

## Pantallas y rutas

_Listar las rutas Next.js afectadas. Si hay nuevas pantallas, breve descripción de cada una. Si hay wireframes/mockups, enlazar._

- `/teacher/agenda/[ninoId]/[fecha]` — formulario de rellenado de agenda.
- `/family/agenda` — vista lectora del día actual.
- ...

## Componentes UI

_Listar los componentes principales que se crearán. Marcar Server Components vs Client Components._

- `AgendaForm.tsx` (Client) — formulario con react-hook-form.
- `AgendaView.tsx` (Server) — vista de lectura para familia.
- ...

## Eventos y notificaciones

_¿Esta feature dispara notificaciones push? ¿Emails? ¿Eventos de audit_log especiales?_

- Push: cuando profe cierra la agenda → notificar tutores legales.
- Audit: cualquier UPDATE en agenda registra cambio (automático por trigger).
- ...

## i18n

_Claves de traducción nuevas que se añaden. Mantener namespace coherente._

```json
{
  "agenda": {
    "title": "Agenda diaria",
    "fields": {
      "comidas": "Comidas",
      ...
    },
    "validation": {
      "hora_invalida": "Hora inválida. Formato HH:MM.",
      ...
    }
  }
}
```

## Accesibilidad

_Consideraciones específicas: roles ARIA, navegación con teclado, contraste, tamaños de toque._

- Formulario navegable con teclado completo.
- Mensajes de error vinculados con `aria-describedby`.
- Botón submit con estado `aria-busy` durante envío.
- ...

## Performance

_Consideraciones específicas: tamaño de bundle, queries pesadas, paginación._

- Query principal con índice en `(nino_id, fecha)`.
- Paginación de 20 items al ver histórico de agendas.
- Bundle de la página < 150KB JS.

## Telemetría

_Eventos custom a trackear (sin PII)._

- `agenda_rellenada` — cuando profe completa una agenda.
- `agenda_vista_familia` — cuando familia abre la agenda del día.
- ...

## Tests requeridos

**Vitest (unit/integration):**

- [ ] Schema Zod valida casos correctos e incorrectos.
- [ ] Server Action retorna `success: true` con datos válidos.
- [ ] Server Action retorna `success: false` con datos inválidos.
- [ ] Trigger de audit_log registra cambios.

**Vitest (RLS):**

- [ ] Profe de aula A no puede leer agendas de niños de aula B.
- [ ] Familia de niño X no puede leer agendas del niño Y.
- [ ] Autorizado sin permiso `puede_ver_agenda` no puede leer agendas.

**Playwright (E2E):**

- [ ] Profe rellena una agenda completa de principio a fin.
- [ ] Familia ve la agenda rellenada inmediatamente después.

## Criterios de aceptación

_Lista verificable. Cada item debe poder marcarse como hecho._

- [ ] Todos los tests listados arriba pasan en CI.
- [ ] Lighthouse de las pantallas afectadas > 90 en accesibilidad y performance.
- [ ] axe-core no reporta violations en las pantallas afectadas.
- [ ] Las 3 lenguas (es/en/va) tienen todas las claves de i18n.
- [ ] La feature funciona en iOS Safari 16.4+ y Chrome Android.
- [ ] ADR escrito si hubo decisión arquitectónica no obvia.
- [ ] `/docs/architecture/data-model.md` actualizado si toca el modelo.

## Decisiones técnicas relevantes

_Si durante la spec se toman decisiones que merecen ADR, listarlas aquí y crear el ADR correspondiente en `/docs/decisions/`._

- ...

## Referencias

- ADR-XXXX: ...
- Spec relacionada: ...
- Entrevista / reunión: ...

---

**Workflow de esta spec:**

1. Claude Code escribe esta spec basándose en CLAUDE.md y las decisiones globales.
2. Responsable revisa y comenta (status: `draft` → `review`).
3. Responsable aprueba (status: `review` → `approved`).
4. Claude Code implementa (status: `approved` → `in-progress`).
5. PR mergeado y desplegado (status: `in-progress` → `done`).
