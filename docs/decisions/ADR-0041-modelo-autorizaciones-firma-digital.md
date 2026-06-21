# ADR-0041: Modelo de autorizaciones + firma digital (cierre de Fase 8)

## Estado

`accepted`

**Fecha:** 2026-06-09
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 8 — Autorizaciones + firma digital

> ADR de cierre de fase. Consolida las decisiones tomadas a lo largo de F8-0 → F8-RW-0 → F8-1/2/3a/3b → archivar. La spec de arranque (`docs/specs/autorizaciones-firma.md`, Checkpoint A) fijó D1–D9 y los flags ⚖️; aquí se documenta el **estado final** y dónde divergió de la spec.

## Contexto

Un centro 0-3 necesita recoger autorizaciones legalmente trazables de las familias para: **salidas/excursiones**, **administración de medicación**, **recogida** por terceros, y formatos de centro (**régimen interno**, **imágenes**). Hasta F8 la app no tenía ni el modelo de datos ni el flujo de firma.

Fuerzas en juego:

- **Trazabilidad legal vs. simplicidad.** Una firma electrónica cualificada (eIDAS) es desproporcionada para el caso y para usuarios no-técnicos en un móvil; pero hace falta una prueba auditable e inmutable de qué se consintió, quién y cuándo.
- **Reúso de F7.** `eventos` (con audiencia por ámbito) ya existe; las salidas deben **colgar** de un evento de excursión, no reinventar la difusión.
- **Multi-tutor y patria potestad.** Hay niños con uno o dos tutores con potestad; el número de firmas exigibles es una cuestión **jurídica**, no técnica.
- **Medicación = riesgo alto.** Dar un medicamento a un menor exige más que la autorización: doble verificación humana en el acto.
- **Repo público, RGPD, minimización.** Datos de menores; no guardar más de lo necesario; la capa legal real (textos, retención, RAT, imagen) es **F11** y requiere abogado.
- **Sin piloto arrancado.** Las migraciones aún pueden re-modelarse sin coste (regla de inmutabilidad aplica al primer dato real).

La decisión hay que tomarla ahora porque F8 es bloqueante del flujo operativo del centro y porque el modelo de datos condiciona F9–F11.

## Opciones consideradas

### Eje 1 — Mecanismo de firma

#### Opción A1: Firma electrónica **cualificada/avanzada** (eIDAS, certificado)

**Pros:** máxima validez jurídica; no objetable.
**Contras:** desproporcionada para el caso; fricción enorme para familias no-técnicas; coste e integración de un proveedor; fuera del alcance de Ola 1.

#### Opción A2 (elegida): Firma electrónica **simple, auditable e inmutable**

Checkbox de acto afirmativo + **nombre tecleado** (debe coincidir con el perfil) + **trazo dibujado** (`firma_imagen`) + **hash SHA-256** del texto exacto versionado + **IP/UA** + timestamp, todo append-only.

**Pros:** UX de un móvil; prueba razonable (qué texto, quién, cuándo, desde dónde); barato; encaja con `consentimientos` (patrón F2). El hash detecta cualquier alteración posterior del documento.
**Contras:** su suficiencia jurídica **no está certificada** — es un ⚖️ para abogado. Mitigación: todo el mecanismo es auditable y el modelo soporta endurecerlo (DNI, doble firma) sin re-migrar.

### Eje 2 — Cómo llega el formato a la familia (catálogo)

#### Opción B-plano: una fila por (niño, tipo), sin catálogo

**Contras:** el texto legal se duplica y diverge entre niños; no hay "formato del centro" único; difícil de mantener y de versionar.

#### Opción B1: catálogo de **plantillas** y la familia firma **la plantilla** directamente

**Pros:** una sola fila por formato.
**Contras:** no hay estado por-niño de primera clase (vigencia de un episodio de medicación, lista de recogida habitual/puntual); el freeze tras firma colisiona con un documento compartido por todos.

#### Opción B2 (elegida): catálogo de **plantillas durables** + **instancia firmable por-niño**

- **Plantilla** (`es_plantilla=true`): el **formato estándar** del centro, una activa por (centro, tipo), no firmable.
- **Instancia** (`es_plantilla=false`): lo que se firma. Dos patrones:
  - **Patrón A** — la **directora ENVÍA** a una audiencia (régimen interno / imágenes / salida) por ámbito niño/aula/centro, reusando la audiencia de `eventos` (F7). Snapshot del texto.
  - **Patrón B2** — la **familia INICIA** su propia instancia por-niño desde la plantilla publicada (recogida / medicación) y firma esa.

**Pros:** vigencia y estado por-niño de primera clase (episodios de medicación con su caducidad, recogida habitual/puntual); el freeze congela la instancia firmada sin afectar a otras familias; el texto legal vive una vez en la plantilla.
**Contras:** dos conceptos (plantilla/instancia) y un `plantilla_id` auto-referencial; CHECK de coherencia con 5 formas. Aceptado por la flexibilidad.

> La spec recomendaba **B1**; el rework del 2026-06-07 (F8-RW-0) eligió **B2**. Las filas legacy de #56 (instancia-por-niño pre-rework) siguen válidas y se enganchan a su plantilla con la migración de datos `20260608130000` (idempotente).

### Eje 3 — Medicación: ¿basta la autorización firmada?

#### Opción C1: solo autorización del tutor

**Contras:** dar el medicamento es un acto de riesgo; un único adulto puede equivocarse de niño/dosis.

#### Opción C2 (elegida): autorización firmada **+ registro de administración con doble confirmación**

Tabla `administraciones_medicacion`: el staff que administra crea la fila; un **segundo** staff distinto la confirma nombrándose a sí mismo. Append-only salvo el único UPDATE pendiente→confirmada (trigger `solo_confirmar`, `confirmado_at` server-side). La política efectiva de firmas la deriva `medicacion_administrable_hoy` (si el niño tiene `requiere_ambos_firmantes`, exige la última decisión `firmado` de todos los tutores principales) y verifica la vigencia del tratamiento (que viaja en `firmas.datos.medicacion`).

**Pros:** doble verificación humana en el acto, trazable; antisuplantación (quien administra no confirma).
**Contras:** dos pasos operativos. Aceptado: es el patrón sanitario correcto.

## Decisión

**Se elige A2 + B2 + C2.** Modelo de **catálogo de plantillas durables + instancias firmables por-niño** (patrón A "la directora envía" / patrón B2 "la familia inicia"), con **firma electrónica simple, auditable e inmutable** (nombre tecleado + trazo dibujado + hash SHA-256 compuesto **texto+`datos`** + IP/UA), **append-only con freeze** del alcance consentido una vez hay firmas, y para medicación un **registro de administración con doble confirmación**.

Decisiones de soporte:

- **Append-only / revocación:** la firma es inmutable (default DENY UPDATE/DELETE). Revocar o re-firmar = **fila nueva**; el estado vigente es la última fila por (autorización, niño, firmante) por `firmado_at`. Retirar una autorización = `estado='anulada'` (conserva firmas, D9).
- **Freeze tras firma:** el trigger `autorizaciones_bloquea_texto_tras_firma` congela texto, versión, título, `datos`, vigencia, tipo, alcance y `plantilla_id` cuando ya hay firmas → el hash siempre cuadra con lo consentido.
- **Archivar medicación ≠ anular:** columnas `archivada_at/archivada_por` + **RPC `archivar_autorizacion`** (`SECURITY DEFINER`, idempotente). Se hace por RPC **a propósito** para autorizar a admin **y profe del niño** sin ampliar la policy `autorizaciones_update` (autor|admin) — eso le abriría publicar/anular/editar el texto. La familia NO archiva. Estado compartido del centro (columna en la fila, no preferencia por usuario).
- **RLS row-aware** (espejo F7): el helper de audiencia recibe los campos por parámetro y no re-lee `autorizaciones` → seguro frente a `INSERT…RETURNING` (gotcha MVCC de F5). Las 3 tablas **se auditan** (documentos legales).
- **Requisito de doble firma** del niño en `ninos.requiere_ambos_firmantes` (minimización: no guarda el motivo). El **número** legal de firmantes (`politica_firmantes`, default `uno_principal`) es ⚖️.

## Postura legal ⚖️ (no cerrada en F8)

F8 implementa un **mecanismo técnico con registro auditable**; **no certifica validez jurídica**. Para uso real, un abogado debe validar (eIDAS / LOPDGDD / normativa educativa autonómica):

1. Que la **firma electrónica simple** (checkbox + nombre tecleado + trazo + hash + IP/UA) sea suficiente y vinculante para salida, medicación y recogida.
2. **Cuántos** tutores deben firmar por tipo (uno vs ambos; patria potestad).
3. Si algún tipo (p. ej. medicación) exige **DNI/identificación reforzada** o firma avanzada/cualificada.
4. El **texto legal** de cada autorización (lo redacta/valida el centro o su asesor — **no** Claude; las plantillas arrancan en `PENDIENTE`).
5. **Retención y prueba**: cuánto conservar firmas e IP, y encaje con minimización RGPD / derecho al olvido (F11).
6. Si la **administración de medicación** exige extras (prescripción médica adjunta, consentimiento informado específico) más allá de la autorización del tutor.

El modelo soporta endurecer cualquiera de estos puntos (añadir DNI, exigir doble firma, adjuntar prescripción) de forma **aditiva**, sin re-migrar.

## Consecuencias

### Positivas

- Trazabilidad auditable e inmutable de cada consentimiento, con detección de alteración por hash.
- Un solo "formato del centro" por tipo (plantilla), instanciado y versionado por-niño.
- Reúso de la audiencia de `eventos` (F7) para las salidas; sin difusión duplicada.
- Doble verificación humana en la administración de medicación.
- Endurecimiento legal posible de forma aditiva.

### Negativas (deuda aceptada)

- Suficiencia jurídica **no certificada** (⚖️ pendiente de abogado) — explícito y acotado.
- Complejidad del modelo plantilla/instancia (auto-referencia + CHECK de 5 formas + freeze).
- El texto legal arranca `PENDIENTE`: una plantilla no es publicable/firmable hasta que alguien teclea el texto real y lo marca definitivo.
- 1 regla legacy (#56) queda sin enganchar hasta que exista la plantilla publicada de Régimen interno (la migración de datos la salta sin inventar texto).

### Neutras

- Nuevo patrón "archivar vía RPC `SECURITY DEFINER`" para ampliar autorización sin tocar la policy de UPDATE — reutilizable en fases futuras.
- Las migraciones productivas/destructivas las aplica el responsable por SQL Editor (regla #11); el agente no las ejecuta.

## Follow-ups (NO entran en F8)

- ⚖️ **Textos legales reales + validación del abogado** (bloqueante para uso real; las plantillas siguen en `PENDIENTE` hasta entonces).
- **Autorización de imágenes firmable** → **F11** (paquete RGPD: imagen, olvido, RAT).
- **Adjuntos** (informe médico / foto DNI / prescripción) → **F10** (`media`); `firmas.datos` ya reserva el hueco.
- ~~**F8-4 — DNI del tutor** en los datos de la firma: **condicional** a que el abogado lo exija (D7).~~ ✅ **RESUELTO (2026-06-21):** la firma electrónica **simple basta**; **no** se embebe el DNI en la firma. El DNI/identificación del tutor, cuando se requiera, se recoge en la **fase de documentación del alta** (post-F11-B), no acoplado a `firmas_autorizacion`. F8 no añade `usuarios.dni`/`tutor_datos`.
- **Recogida puntual con fecha futura** (hoy la recogida es habitual; la puntual con vigencia propia queda pendiente).
- **Migración de la regla legacy #56**: se engancha al publicar el formato real de Régimen interno y re-ejecutar `20260608130000` (idempotente).
- **Aviso en el botón "Enviar" cuando está deshabilitado** (no hay plantillas publicadas) — mejora menor de UI.

## Verificación

- Checkpoint C (cierre F8): `npm run typecheck`, `npm run lint`, `npm test` (suite entera), `npm run build` en verde.
- Tests RLS/append-only/doble-confirmación de F8 en `src/test/` (vertical slices F8-0…F8-3b) pasando.
- Migraciones aditivas aplicadas en remoto; `20260608130000_phase8_migrar_reglas_56` documentada como **pendiente** de aplicar por el responsable.
