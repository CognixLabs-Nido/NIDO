# Roadmap — NIDO

Notas vivas de cosas que conocemos hoy pero se difieren a una fase futura. No es una lista exhaustiva ni un compromiso de fechas; cada entrada explica el "qué" y el "cuándo despierta" para que cuando llegue el momento sepamos por qué se dejó pendiente.

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
