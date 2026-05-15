# Roadmap — NIDO

Notas vivas de cosas que conocemos hoy pero se difieren a una fase futura. No es una lista exhaustiva ni un compromiso de fechas; cada entrada explica el "qué" y el "cuándo despierta" para que cuando llegue el momento sepamos por qué se dejó pendiente.

## Plan Ola 1 — reorganización post-Fase 3 (2026-05-15)

Tras cerrar Fase 3 (agenda diaria), reorganizamos el resto de Ola 1 para reflejar dos aprendizajes:

1. El patrón UI **"pase de lista"** (tabla con todos los niños de un aula, click rápido por niño) es valioso y reutilizable. Conviene materializarlo desde el inicio de Fase 4 para que F4.5 (menús) y futuras fases lo reusen sin diseñarlo de cero.
2. Los **menús del centro** son un caso de uso fuerte que merece su propia fase: la cocina planifica mensualmente, la profe rellena un día concreto en segundos vía pase de lista, la familia ve qué comió cada día. Encaja entre F4 (asistencia) y F5 (mensajería).

### Fase 4 — Asistencia y ausencias (ampliada)

- **Antes:** 6-8 h / 2-3 sesiones.
- **Ahora:** 8-10 h / 3-4 sesiones.
- **Razón:** incluye desde el inicio el **patrón UI "pase de lista"** (tabla con todos los niños del aula, click rápido por niño para marcar entrada/salida/ausencia). El patrón es reusable para F4.5 (pase de lista de comida), F8 (autorizaciones de salida puntual), F10 (etiquetar niños en una publicación), y similares. Construirlo bien una vez ahorra rework en las cuatro fases siguientes.

### Fase 4.5 — Menús y pase de lista comida (NUEVA)

- **Posición:** entre F4 (asistencia) y F5 (mensajería).
- **Duración:** 6-8 h / 2-3 sesiones.
- **Scope:**
  - **Tablas nuevas:**
    - `plantillas_menu` (mensual por centro: nombre, mes, año, vigente).
    - `plantilla_menu_dia` (qué se come cada día de la semana: desayuno, media mañana, comida, merienda).
  - **UI admin** para crear/editar la plantilla mensual con el menú de cada día (estructura tabla `Lunes/Martes/.../Viernes` × `Desayuno/Comida/Merienda/Media mañana`).
  - **Auto-populate** al abrir la agenda del día: si hay plantilla vigente, las filas de `comidas` del día se pre-crean con `descripcion` del menú y `cantidad=NULL` (pendiente de marcar). El profe solo añade la cantidad.
  - **UI profe "pase de lista comida":** tabla con los niños del aula como filas y los 4 momentos como columnas. Click rápido en cada celda para marcar cantidad (`todo` / `mayoría` / `mitad` / `poco` / `nada`).
  - **Exclusión automática:** niños con `lactancia_estado='materna'` o `tipo_alimentacion='biberon'` quedan fuera del pase de lista de su columna correspondiente (datos ya cargados en Fase 2.6). Se muestran como "no aplica" con tooltip.
  - **Excepción puntual:** la profe puede sobrescribir el menú de un niño concreto en el día (caso "trajo tupper de casa") — editar la descripción en línea, queda en `audit_log`.
  - **Inserción batch en una transacción:** al guardar, las N filas de `comidas` se insertan/actualizan en un solo `INSERT ... ON CONFLICT`. Realtime dispara N notificaciones a los clientes suscritos; cada familia ve solo las de su hijo (RLS).
- **Reusa de F3 y F4:** modelo `comidas` ya existe (no se toca), patrón "pase de lista" viene de F4, ventana de edición (ADR-0013) sigue aplicando, audit log automático ya cubre `comidas`.

### Impacto en duración total

- **+6 h aprox** sobre el plan Ola 1 original.
- Sigue factible para **septiembre 2026** sin recortar otras fases.
- Las fases F5–F11 mantienen su scope y duración estimada.

> Cuando esta reorganización se acepte y empiece la implementación, hay que actualizar `docs/specs/scope-ola-1.md` (tabla numérica de fases) para incluir F4.5. No se toca aún para evitar fricción con specs ya escritas que referencian la numeración antigua.

---

## Datos pedagógicos / familia

- **Tabla `hermanos_nino` con auto-relación** — _disparador: cuando se necesite reporting de relaciones familiares (informes, exportes de aula, asistencia conjunta)_.
  Hoy `datos_pedagogicos_nino.tiene_hermanos_en_centro` es un `BOOLEAN` informativo. Cuando la directora necesite saber **qué niños** son hermanos entre sí (para ordenar las recogidas, prevenir conflictos de aula, generar informes familiares), migrar a una tabla `hermanos_nino` con auto-relación (`nino_id`, `hermano_id`, `tipo_relacion`) y borrar el BOOLEAN. La fase futura decide si la relación es bidireccional almacenada o derivada. Ver spec `pedagogical-data.md` §Alcance.

## Logo del centro / branding

- **Upload real de logo a Supabase Storage** — _disparador: cuando lleguemos a la Fase 10 (fotos y publicaciones) y Storage ya esté configurado, o antes si llega un segundo centro al producto_.
  Hoy `centros.logo_url TEXT` es una URL relativa que apunta a `public/brand/*`. Cuando exista bucket de Storage:
  1. Subir el PNG/SVG actual al bucket `centro-assets/{centroId}/logo.{ext}`.
  2. Cambiar el campo a la URL firmada (o pública, según política).
  3. UI de admin para subir/actualizar.
  4. Posiblemente añadir `logo_full_url` para distinguir wordmark vs hero. Ver ADR-0010.

- **Ampliar `scripts/process-logos.mjs`** — _disparador: cuando llegue un source de mayor calidad de ANAIA (vectorial) o se procesen logos de otros centros_.
  Hoy el script solo procesa el source de NIDO. Si aparecen N sources de centros distintos, ampliar para que itere sobre `public/brand/source/*.png` y aplique el mismo patrón idempotente. Ver `docs/dev-setup.md` §Logo de ANAIA.

## Permisos granulares

- **UI de gestión de permisos del vínculo** — _disparador: cuando un admin necesite cambiar qué ve cada tutor sin tocar SQL_.
  Hoy los permisos JSONB en `vinculos_familiares.permisos` se editan vía Server Action de `actualizar-vinculo` (sin pantalla específica). Cuando la directora necesite, por ejemplo, autorizar al padre a ver datos médicos pero no pedagógicos (o al revés), construir UI de toggles por permiso en `/admin/ninos/[id]` tab "Familia".

- **Permisos por rol "autorizado"** — _disparador: Fase 8 (autorizaciones)_.
  Hoy un autorizado tiene los mismos permisos JSONB que un tutor (con defaults a `false`). Cuando llegue la Fase 8, repensar si hay un set diferenciado para "puede recoger" vs "puede ver agenda" vs etc.

## Wizard y onboarding

- **Datos pedagógicos en el wizard de alta** — _disparador: cuando la directora confirme que prefiere rellenarlos en el momento del alta y no más adelante_.
  Hoy el wizard `/admin/ninos/nuevo` crea solo datos personales + médicos + matrícula. La tab Pedagógico del detalle se rellena después. Si en la práctica el admin siempre tiene los datos pedagógicos al dar de alta, añadir paso 4 al wizard. Ver spec `pedagogical-data.md` §Alcance.

- **Onboarding del primer admin desde la app** — _disparador: Ola 2 (multi-centro real)_.
  Hoy el primer admin de un centro se siembra manualmente vía Supabase Dashboard (procedimiento en `docs/dev-setup.md`). Para que se puedan crear centros nuevos desde la propia app sin intervención manual, hace falta un flow de auto-onboarding con confirmación por email + assignment automático del primer admin.

## Datos administrativos

- **IBAN y facturación** — _disparador: cuando se implemente cobro automático de cuotas_.
  Fuera de Ola 1 completa (ver `scope-ola-1.md`).

- **Datos administrativos del tutor** (NIF, dirección postal, autorización imagen firmada) — _disparador: Fase 8 (autorizaciones + firma digital)_.
  Tutor solo es identificado por email/nombre hoy. Para autorizaciones legales necesitará campos administrativos. Definir entonces.

- **Campo "verificado por tutor"** en datos del niño — _disparador: cuando el flujo híbrido admin-propone/tutor-confirma sea necesario en algún campo concreto_.
  Hoy admin escribe, tutor lee. Si en algún campo se requiere que tutor confirme (ej. dirección de recogida, datos sanitarios cruciales), añadir `verificado_at` + `verificado_por`.
