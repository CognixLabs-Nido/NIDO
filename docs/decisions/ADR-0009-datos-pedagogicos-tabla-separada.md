# ADR-0009: Datos pedagógicos como tabla separada y permiso JSONB dedicado

## Estado

`accepted`

**Fecha:** 2026-05-14
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 2.6 — Datos pedagógicos del niño + logo del centro

## Contexto

Fase 3 (agenda diaria + bienestar) necesita saber, antes de cada apunte que el profe rellene, qué tipo de niño tiene delante: si toma biberón, si lleva pañal, cuántas siestas hace al día, qué tipo de alimentación lleva, qué idiomas se hablan en casa. Estos datos no son médicos (no requieren cifrado pgcrypto) pero sí íntimos: dietas religiosas, ritmos de sueño, lengua materna de la familia.

La decisión es dónde y cómo alojarlos:

1. **Columnas dentro de `ninos`**, junto al resto de la ficha (nombre, fecha, sexo).
2. **Tabla separada `datos_pedagogicos_nino`**, 1:1 con `ninos`, mismo patrón que `info_medica_emergencia` (Fase 2).

Y, simultáneamente, cómo gating la lectura para los tutores: la columna `permisos JSONB` de `vinculos_familiares` ya tiene `puede_ver_info_medica` para los datos médicos. ¿Reusamos ese flag para todo lo "íntimo" o introducimos uno nuevo?

## Opciones consideradas

### Opción A: Columnas en `ninos` + reusar `puede_ver_info_medica`

Añadir las 12 columnas funcionales (lactancia, esfínteres, siesta, alimentación, idiomas, hermanos) directamente a `ninos` y filtrar la visibilidad de tutor con el flag existente.

**Pros:**

- Menos cambios en el modelo, menos joins en queries.
- Una sola fila por niño contiene "todo el contexto".
- Sin migración del JSONB.

**Contras:**

- `ninos` crece de ~10 a ~22 columnas; el audit log de cualquier UPDATE en `ninos` empieza a recoger cambios de cualquier campo (médico, administrativo, pedagógico) en el mismo registro, costando trazabilidad.
- Reusar `puede_ver_info_medica` para datos no médicos confunde semántica: un tutor podría querer ver pañal pero no alergias graves, y al revés.
- Cualquier nueva dimensión (hobbies, alergias no médicas) presiona más esta fila.

### Opción B: Tabla separada `datos_pedagogicos_nino` + permiso JSONB dedicado (elegida)

Crear `datos_pedagogicos_nino` 1:1 con `ninos` (UNIQUE, ON DELETE RESTRICT), con audit log propio, y añadir `puede_ver_datos_pedagogicos` al JSONB de `vinculos_familiares.permisos`. La migración pobla el nuevo permiso heredando el valor de `puede_ver_info_medica` para los vínculos existentes, preservando las visibilidades actuales sin sorpresas.

**Pros:**

- Separación de concerns: cada tabla audita sus cambios; al hacer UPDATE de datos pedagógicos no se "ensucia" la entry de auditoría de `ninos`.
- Patrón idéntico a `info_medica_emergencia` (Fase 2): RLS reutiliza los helpers `centro_de_nino`, `es_profe_de_nino`, `tiene_permiso_sobre` sin recursión.
- Semántica clara: el día de mañana un tutor puede ver datos médicos pero no pedagógicos, o al revés. La UI de permisos (futura) tiene una checkbox por concepto.
- Espacio para crecer: cuando lleguen hobbies, alergias no médicas, observaciones generales, etc., todo cabe en esta tabla sin reformatear `ninos`.

**Contras:**

- Una migración más de coordinación: hay que cerrar la migración del JSONB con un backfill consistente para los vínculos existentes (lo hace `UPDATE ... SET permisos = permisos || jsonb_build_object('puede_ver_datos_pedagogicos', COALESCE(...))`).
- Un join (o un fetch separado) al ver el detalle del niño completo. Aceptable: la página del detalle ya hacía 3 queries en paralelo (vínculos, médica, matrículas); añadir una cuarta no se nota.

### Opción C: Vista materializada que joinea `ninos` + pedagógicos

Mantener tabla separada pero ofrecer una vista para queries que necesiten "todo de un niño".

**Pros:**

- Lo mejor de los dos mundos para lectura.

**Contras:**

- Las vistas con RLS en Supabase requieren cuidado especial (security_invoker en PG 15+, y aun así se complican con los helpers SECURITY DEFINER).
- Es prematuro: hoy no hay query crítica que se beneficie. Si llega, se hace entonces.

## Decisión

**Se elige la Opción B.**

Razones principales:

- Refuerza la coherencia del modelo de datos: `info_medica_emergencia`, `vinculos_familiares` y ahora `datos_pedagogicos_nino` siguen el mismo patrón 1:1 con `ninos`. Esto facilita razonar sobre el sistema y reutilizar helpers RLS.
- Audit log limpio: cada tabla con sus eventos, sin entradas "ruidosas" en `ninos`.
- Semántica de permisos clara desde el primer momento, lo que evita el coste de re-mapping cuando llegue la UI de gestión de permisos.

## Consecuencias

### Positivas

- Patrón RLS replicado: 3 policies + helpers existentes, sin recursión (ADR-0007 sigue siendo la única referencia para esto).
- Backfill del JSONB preserva visibilidades sin sorpresas (los tutores que ya veían info médica ven también los datos pedagógicos por defecto).
- El día de mañana, distinguir "ver datos médicos vs ver datos pedagógicos" en la UI es una checkbox por permiso, no un refactor.

### Negativas

- Más complejidad operativa al rellenar la ficha del niño: ahora hay tres "lugares" donde editar datos (general, médica, pedagógico). El sistema de tabs del detalle (Fase 2.5) absorbe la complejidad bien.
- Audit log gana ~1 tipo de evento más por niño activo. Volumen despreciable (los datos pedagógicos se editan ocasionalmente).

### Neutras

- Los wizards no tocan estos datos en esta fase. La directora rellena la tab cuando los recibe, no en el momento del alta. Si en el futuro queremos forzar el alta completa, se añade paso 4 al wizard (documentado en roadmap).

## Plan de implementación

- [x] Migración `20260514142245_phase2_6_pedagogical_data.sql` con la tabla, ENUMs, CHECKs (incluida la función `idiomas_iso_2letras` IMMUTABLE para evitar el límite de subqueries en CHECK), 3 policies RLS, trigger AFTER para audit log, extensión de `audit_trigger_function` y backfill del JSONB.
- [x] Tipos TS regenerados con `npm run db:types`.
- [x] Feature `src/features/datos-pedagogicos/` con schema Zod, query, server action upsert y componentes UI.
- [x] Integración en `/admin/ninos/[id]` (tab "Pedagógico") y `/family/nino/[id]` (sección read-only gated por permiso).
- [x] Tests: 9 unit (schema Zod) + 5 RLS (admin cruzado, profe del aula, profe de otra aula, tutor con/sin permiso).
- [x] i18n trilingüe (es/en/va).

## Verificación

- `npm run typecheck` verde.
- `npm test` 14 tests nuevos en verde + los 46 anteriores siguen pasando = 60 totales.
- `npm run build` verde.
- Verificación funcional manual en preview de Vercel (admin entra, rellena tab, guarda, recarga, mantiene datos).

## Notas

Si llega un caso en el que un tutor tiene que ver datos pedagógicos pero no médicos (o al revés), basta editar la columna `permisos` JSONB del vínculo. Hoy no existe UI para ello; los toggles individuales llegan cuando la directora los pida (apuntado en `docs/roadmap.md`).

## Referencias

- Spec: `/docs/specs/pedagogical-data.md`
- ADR-0006 (permisos granulares en vínculos familiares).
- ADR-0007 (recursión RLS): el patrón de helpers `centro_de_nino` / `es_profe_de_nino` que usamos aquí.
- Migración: `supabase/migrations/20260514142245_phase2_6_pedagogical_data.sql`.
