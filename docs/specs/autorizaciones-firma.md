---
feature: autorizaciones-firma
wave: 1
status: draft
priority: critical
last_updated: 2026-06-03
related_adrs: [ADR-0001, ADR-0004, ADR-0006, ADR-0038, ADR-0039]
related_specs: [scope-ola-1, agenda-citas, f7-calendario, core-entities]
---

# Spec — Fase 8: Autorizaciones + firma digital

> **Checkpoint A cerrado** (responsable, 2026-06-03): decisiones **🔒 D1–D9 cerradas** (ver §
> _Decisiones cerradas_). Este documento incluye ya el **detalle de Checkpoint B por sub-fases**
> (ver § _Checkpoint B — detalle_) a la espera del OK del responsable. **NO se implementa nada
> todavía.** Los **flags legales ⚖️** siguen pendientes de abogado; los textos legales arrancan
> como placeholder `PENDIENTE` y una autorización con texto placeholder **no es firmable** (guard a
> nivel de BD), así que el proyecto no se bloquea esperando al abogado.

> ⚖️ **AVISO LEGAL TRANSVERSAL.** Esta spec describe un **mecanismo técnico** para recoger y
> conservar autorizaciones con un registro auditable de quién/cuándo/qué se firmó. **NO certifica
> que ese mecanismo tenga validez jurídica** como firma o consentimiento vinculante. Toda
> afirmación sobre validez legal está marcada con ⚖️ y **requiere validación de un abogado**
> (eIDAS Reg. 910/2014, LOPDGDD, normativa educativa autonómica). No se dan por buenas.

## Resumen ejecutivo

F8 da a NIDO un modelo de **autorizaciones administrativas firmadas** por los tutores: salidas/
excursiones, administración de medicación y personas autorizadas a recoger. Una autorización es un
**documento con texto versionado** que el centro emite y el tutor **firma o rechaza** desde la app;
se guarda un registro **auditable e inmutable** del acto (quién, cuándo, qué versión exacta del
texto, contexto). Es un **modelo aparte** del de confirmaciones de F7 (asistencia ligera) y del de
consentimientos RGPD de F11 (imagen de menores) — ver delimitación abajo.

## Contexto

- F7 (eventos, [ADR-0038](../decisions/ADR-0038-modelo-eventos-y-confirmaciones.md)) introdujo
  `confirmaciones_evento`: una confirmación **ligera** de asistencia (sin valor legal, **no
  auditada**, "sin fila = pendiente"). El propio modelo lo marca: _"asistencia ligera, no
  autorización legal"_. **F8 NO reutiliza ese modelo como si fuera consentimiento.**
- El roadmap fija el disparador: _"Datos administrativos del tutor (NIF, dirección postal,
  autorización de imagen firmada) — disparador: Fase 8"_. Hoy el tutor solo se identifica por
  email/nombre.
- "Medicación con doble confirmación" se promovió a Ola 1 (`scope-ola-1.md`); no tiene spec aún.
- El **paquete RGPD** (F11, bloqueante antes del primer dato real) incluye **consentimiento de
  imagen de menores**, derecho al olvido y registro de tratamiento. **Eso NO es F8** (ver §
  Delimitación).

## Auditoría — qué es reutilizable

### A1. Modelo de confirmaciones de F7 (`confirmaciones_evento`) — patrón, NO tabla

`supabase/migrations/20260601140000_phase7_eventos.sql`.

- Estructura `(evento_id, nino_id)` UNIQUE, `estado` (confirmado/rechazado), `comentario`,
  `confirmado_por`, `confirmado_at`. "Sin fila = pendiente".
- **NO se audita** (decisión D13 de F7: asistencia ligera). ⇒ F8 es lo contrario: **las firmas SÍ
  se auditan** (son documentos legales).
- **Reutilizable como patrón**, no como tabla: el roster por ámbito y el flujo UPSERT idempotente
  con `.maybeSingle()` (gotcha "USING falso → 0 filas") se replican; el **modelo de datos es
  nuevo** y más rico (estado de ciclo de vida, hash del texto, audit).

### A2. Eventos/excursiones a los que colgar la autorización

- `eventos` tiene `tipo='excursion'` y `requiere_confirmacion boolean`. El ámbito
  (`centro`/`aula`/`nino`) y el helper `evento_aplica_a_nino(evento_id, nino_id)` ya resuelven
  **qué niños** entran en una salida (vía `matriculas`). ⇒ una autorización de excursión puede
  **colgar de un `evento_id`** y reusar esa audiencia. **Reutilizable directamente.**
- Patrón RLS **row-aware** `usuario_es_audiencia_evento_row(centro_id, ambito, aula_id, nino_id)`
  (recibe campos por parámetro, no re-lee la tabla → evita el gotcha MVCC en `INSERT…RETURNING`).
  ⇒ se replica para `autorizaciones`/`firmas_autorizacion`.

### A3. Estructura tutores/niños/roles

`vinculos_familiares` (`20260513202012_phase2_core_entities.sql`):

- `permisos jsonb`, helper `tiene_permiso_sobre(nino_id, permiso)` y `es_tutor_de(nino_id)`.
- `tipo_vinculo`: `tutor_legal_principal | tutor_legal_secundario | autorizado`.
  `parentesco` ENUM. **Multi-tutor:** varias filas por niño; **no hay constraint** que limite a un
  principal — es regla de producto.
- **5 claves de permiso existentes**; **NO existe** `puede_recoger`/pickup ni
  `puede_firmar_autorizaciones`. ⇒ posibles claves nuevas (decisión 🔒 D7).

### A4. `consentimientos` (Fase 2) — referencia de patrón, NO la tabla de F8

`consentimientos (usuario_id, tipo, version, aceptado_en, ip_address, user_agent)`, append-only,
RLS solo-self + admin. **Pero:** (1) es **por usuario**, no por niño; (2) **no guarda el texto ni
un hash**; (3) **está sin uso en código** (las versiones se llevan denormalizadas en `usuarios`).
⇒ Sirve como **referencia** del trío "versión + IP + user_agent + append-only", **no** como tabla
de las firmas de F8 (que son por niño y necesitan el hash del texto firmado).

### A5. Decisiones RGPD registradas (delimitación F8 ↔ F11)

- ADR-0001 (alta solo por invitación = base legal de tratamiento), ADR-0004 (cifrado de datos
  médicos), ADR-0006 (permisos granulares).
- **Paquete RGPD = F11**, bloqueante antes del primer dato real: **consentimiento de imagen**,
  derecho al olvido, registro de actividades de tratamiento. **Fuera de F8.**
- `info_medica_emergencia.medicacion_habitual` (texto, **no cifrado**) ya existe; F8 **no** lo
  sustituye: añade la **autorización** y, en su caso, el **registro de administración**.

### A6. Convenciones

- Migración aditiva nueva: `20260603hhmmss_phase8_autorizaciones.sql` (patrón
  `YYYYMMDDhhmmss_phase8_*`). **Las tablas `autorizaciones`/`firmas_autorizacion` NO existen aún.**
- RLS default-DENY, helpers `STABLE SECURITY DEFINER` row-aware, i18n es/en/va, commitlint en
  minúsculas, validación pre-merge en Preview de Vercel.

## Delimitación de solapes (cerrar ambigüedad)

| Tema                                                                        | Fase                          | Qué cubre                                      |
| --------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| Autorizaciones administrativas firmadas (excursión, medicación, recogida)   | **F8**                        | Documento + firma/rechazo + audit              |
| Doble confirmación de **administración** de medicación (registro operativo) | **F8 (sub-fase) o follow-up** | Log de administración por dos personas — 🔒 D6 |
| **Consentimiento de imagen** de menores                                     | **F11 (RGPD)**                | Doc legal + retención. F8 NO lo hace           |
| Derecho al olvido / registro de tratamiento                                 | **F11 (RGPD)**                | Anonimización audit_log, RAT, DPA              |
| Confirmación de asistencia a evento (ligera)                                | **F7** (ya hecho)             | `confirmaciones_evento`, no legal              |

> El **mecanismo de firma** que se construye en F8 podrá **reutilizarse** en F11 para el
> consentimiento de imagen, pero el documento legal y las reglas de retención de imagen son F11.

## Propuesta de alcance LEAN (🔒 D1 — abierto, con recomendación)

Modelo **genérico** de autorización con un `tipo_autorizacion`, cubriendo en Ola 1:

- **A) Salida / excursión** — cuelga de un `evento` (`tipo='excursion'`). El tutor firma por niño.
  _Reusa audiencia por ámbito de F7._ **Recomendado dentro.**
- **B) Administración de medicación (autorización firmada)** — doc con campos estructurados
  (medicamento, dosis, vía, pauta horaria, fechas). El tutor **autoriza** legalmente. **Recomendado
  dentro.**
- **C) Personas autorizadas a recoger** — lista de personas (nombre + DNI) que el tutor autoriza a
  recoger al niño; firmado. **Recomendado dentro** (es el caso legal clásico de guardería).

**Recomendación:** F8 = modelo genérico + **A, B y C**. El **log de administración con doble
confirmación** (operativo, no legal) se separa en sub-fase **F8-3b** o se difiere (🔒 D6): es un
registro de seguridad de dos personas, distinto de la firma del tutor.

**Fuera de F8 (explícito):** consentimiento de imagen (F11), firma con certificado/cl@ve/firma
cualificada eIDAS (Ola 3 si se requiere validez reforzada — ⚖️), autorizaciones recurrentes
auto-renovables, flujos de firma de personal/contratos.

## Modelo de firma / qué se guarda (🔒 D2 — abierto, con recomendación)

### Mecanismo recomendado: **firma electrónica simple** con registro probatorio

Acto afirmativo del tutor (checkbox explícito "Autorizo …" + **tecleo de su nombre completo** que
debe coincidir con el del perfil), sobre un **texto exacto versionado**. Se guarda:

| Campo                                                                     | Por qué                                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `firmante_id` (usuario), `rol_firmante` (principal/secundario/autorizado) | quién                                                                       |
| `firmado_at timestamptz`                                                  | cuándo                                                                      |
| `texto_version` + `texto_hash` (SHA-256 del texto exacto renderizado)     | **qué** firmó (prueba de integridad: si el texto cambia, el hash no cuadra) |
| `decision` (`firmado`/`rechazado`/`revocado`)                             | acto                                                                        |
| `ip_address inet`, `user_agent text`                                      | contexto probatorio (patrón `consentimientos`)                              |
| `nombre_tecleado`                                                         | acto afirmativo explícito                                                   |
| (opcional) `firma_imagen` (PNG/SVG de canvas)                             | refuerzo visual — 🔒 D2.b                                                   |

- **Se audita** (trigger `audit_log`, a diferencia de `confirmaciones_evento`).
- **Inmutable:** una firma no se edita ni borra (default DENY UPDATE/DELETE). Revocar/re-firmar =
  **nueva fila** (append-only), el estado "actual" es la última fila por (autorización, niño,
  firmante).

> ⚖️ **REQUIERE ABOGADO:** que esta "firma electrónica simple" (checkbox + nombre + hash + IP)
> sea **jurídicamente suficiente y vinculante** para (a) salidas, (b) administración de medicación
> y (c) autorización de recogida, bajo eIDAS + LOPDGDD + normativa educativa. Es plausible para
> consentimientos escolares, pero **no lo certificamos**. El abogado dirá si basta la simple, si
> hace falta DNI del firmante, o si algún tipo exige firma avanzada.

### Versionado del texto (🔒 D8)

El `texto` + `version` viven en la **autorización**; la **firma** guarda el hash de la versión que
el tutor vio. **Una autorización con firmas es inmutable**; cambiar el texto materialmente ⇒ **nueva
versión** ⇒ re-firma (mismo principio que "migración aplicada = inmutable"). 🔒 D8 decide si el
texto legal es **monolingüe** (el idioma en que se firma, recomendado para que el hash sea
inequívoco) con el **chrome de UI** en es/en/va, o trilingüe con un hash por idioma.

## Vinculación: ¿cuelga de evento y/o por niño? (🔒 D3 — abierto, con recomendación)

**Recomendación: ambas, vía `tipo_autorizacion` + `evento_id` opcional**, con CHECK estructural
(espejo de `eventos_ambito_coherencia`):

- `salida` ⇒ `evento_id NOT NULL` (audiencia por el ámbito del evento; reusa F7).
- `medicacion` y `recogida` ⇒ `evento_id NULL`, alcance **por niño** (`nino_id NOT NULL`).
- (futuro) genérica por aula/centro ⇒ sin `nino_id`, expandida a roster como en eventos.

## Borrador de modelo de datos (propuesta para Checkpoint B, no final)

> Indicativo; se concreta tras cerrar D1–D9. Migración **aditiva**.

- **ENUMs nuevos:** `tipo_autorizacion (salida|medicacion|recogida)`,
  `autorizacion_estado (borrador|publicada|cerrada|anulada)`,
  `firma_decision (firmado|rechazado|revocado)`.
- **`autorizaciones`** (el documento): `id`, `centro_id`, `tipo`, `evento_id?`, `nino_id?`,
  `aula_id?`, `titulo`, `texto`, `texto_version`, `datos jsonb` (campos estructurados de
  medicación), `vigencia_desde`, `vigencia_hasta`, `firmantes_requeridos` (ver 🔒 D5), `estado`,
  `creado_por`, `created_at/updated_at`. CHECK de coherencia tipo↔referencias. **Auditada.**
- **`firmas_autorizacion`** (la respuesta): `id`, `autorizacion_id`, `nino_id`, `firmante_id`,
  `rol_firmante`, `decision`, `texto_hash`, `comentario?`, `nombre_tecleado`, `firma_imagen?`,
  `ip_address?`, `user_agent?`, `firmado_at`, `created_at`. UNIQUE/append según D4. **Auditada,
  inmutable.**
- **Datos administrativos del tutor** (🔒 D7): `usuarios.dni`, `usuarios.direccion` o tabla
  `tutor_datos` — solo si el abogado los exige para validez.

## RLS (patrón row-aware, propuesta)

- Helper row-aware `usuario_es_audiencia_autorizacion_row(centro_id, tipo, evento_id, nino_id, aula_id)`
  - `autorizacion_aplica_a_nino(autorizacion_id, nino_id)` (lee otras tablas ⇒ sin MVCC), espejo de
    F7.
- `autorizaciones` — SELECT: admin del centro, profe del niño/aula (para operar), tutor del niño.
  INSERT: admin (cualquiera) / profe (solo `salida` de su aula, espejo `eventos_insert`). UPDATE:
  autor/admin **solo si no tiene firmas** (inmutabilidad). DELETE: DENY.
- `firmas_autorizacion` — SELECT: el firmante (la suya), tutor del niño, profe del niño, admin.
  INSERT: **solo un tutor del niño**, `firmante_id = auth.uid()`, sobre autorización publicada que
  aplica al niño y **dentro de vigencia**. UPDATE/DELETE: **DENY** (append-only; revocar = nueva
  fila). **Auditada.**

## Caducidad y revocación (🔒 D4 — abierto, con recomendación)

- **Caducidad:** `vigencia_desde/hasta` en la autorización. Salida: hasta la fecha del evento.
  Medicación: rango de la pauta. Recogida: hasta fin de curso o revocación. La firma fuera de
  vigencia se rechaza por RLS.
- **Revocación:** el tutor revoca añadiendo una **fila nueva** `decision='revocado'` (append-only,
  conserva la traza). El estado vigente = última fila por (autorización, niño, firmante).
  **Recomendado** frente a borrar/editar (mantiene prueba). 🔒 D4 confirma este modelo append-only.

## Multi-tutor: ¿firma uno o ambos? (🔒 D5 — ABIERTO, ⚖️ legal)

**Recomendación de mecanismo (no de derecho):** columna `firmantes_requeridos` por autorización con
política `uno_principal | todos_los_principales | cualquiera`, y la UI calcula "estado de firma del
niño" = ¿se cumplen los requeridos? Default propuesto: `uno_principal` para recogida; **a confirmar
para salida y medicación.**

> ⚖️ **REQUIERE ABOGADO:** **cuántos** tutores deben firmar para que la autorización sea
> **legalmente válida** (¿basta un progenitor? ¿ambos para actos médicos/salidas?) es una cuestión
> jurídica (Código Civil patria potestad conjunta, normativa del centro). Nosotros damos el
> **mecanismo configurable**; el **valor legal** de cada tipo lo fija el abogado.

## Casos edge (a desarrollar en Checkpoint B)

- Niño con un solo tutor vinculado vs dos; tutor secundario que firma; autorizado sin permiso de
  firma. Tutor pierde el vínculo a mitad de vigencia. Autorización publicada y luego anulada por el
  centro con firmas existentes (¿qué pasa con las firmas?). Texto editado tras firmas (bloqueado →
  nueva versión). Firma fuera de vigencia. Doble firma simultánea (concurrencia). Niño dado de baja
  (`deleted_at`). Idioma del texto firmado ≠ idioma de UI.

## Sub-fases (Checkpoint B) — troceado propuesto

| Sub-fase   | Contenido                                                                                                                                                                                             | Depende de |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **F8-0**   | Migración aditiva (ENUMs, `autorizaciones`, `firmas_autorizacion`, helpers row-aware, RLS, audit) + **tests RLS de aislamiento** (tutor A no firma por niño B; firma inmutable; append-only). Sin UI. | —          |
| **F8-1**   | Modelo genérico + **firma simple** (crear autorización admin, firmar/rechazar tutor, roster de estados) sobre el caso **salida/excursión** (cuelga de evento, reusa audiencia). UI + i18n.            | F8-0       |
| **F8-2**   | **Recogida**: personas autorizadas (nombre + DNI) por niño + firma. Claves/datos nuevos si aplica (🔒 D7).                                                                                            | F8-1       |
| **F8-3a**  | **Medicación**: autorización firmada con campos estructurados (medicamento/dosis/pauta/fechas).                                                                                                       | F8-1       |
| **F8-3b**  | _(condicional 🔒 D6)_ **Log de administración** con doble confirmación de dos personas (operativo, no legal).                                                                                         | F8-3a      |
| **F8-4**   | _(condicional 🔒 D7/⚖️)_ Datos administrativos del tutor (DNI/dirección) si el abogado los exige.                                                                                                     | F8-1       |
| **Cierre** | ADR de la fase, data-model + rls-policies actualizados, Checkpoint C (barrido), validación legal registrada.                                                                                          | todas      |

## Decisiones a cerrar (responsable) — 🔒

- **🔒 D1 — Alcance LEAN:** ¿F8 = salida + medicación + recogida? ¿Algo fuera para Ola 3?
  _Rec.: las tres dentro._
- **🔒 D2 — Mecanismo de firma:** ¿firma simple (checkbox + nombre + hash + IP)? ¿+ canvas de firma
  dibujada (D2.b)? _Rec.: simple; canvas opcional como refuerzo, no requisito._
- **🔒 D3 — Vinculación:** ¿modelo genérico `tipo` + `evento_id` opcional? _Rec.: sí._
- **🔒 D4 — Caducidad/revocación:** ¿`vigencia_*` + revocación append-only (nueva fila)? _Rec.: sí._
- **🔒 D5 — Multi-tutor:** política `firmantes_requeridos` configurable; **valor legal por tipo ⚖️
  pendiente de abogado.** ¿Default `uno_principal`?
- **🔒 D6 — Medicación doble confirmación:** ¿el **log de administración** (dos personas) entra en
  F8 (F8-3b) o se difiere? _Rec.: separarlo; decidir si entra ahora._
- **🔒 D7 — Datos administrativos del tutor:** ¿se añaden DNI/dirección? ¿clave nueva
  `puede_firmar_autorizaciones` en `vinculos_familiares`, o el rol `tutor_legal_*` ya habilita
  firmar? _Rec.: rol habilita; DNI solo si abogado lo exige (F8-4)._
- **🔒 D8 — Texto legal:** ¿monolingüe (idioma de firma) con UI trilingüe, o texto trilingüe con
  hash por idioma? _Rec.: monolingüe para hash inequívoco._
- **🔒 D9 — Retención/anulación:** ¿qué pasa con firmas cuando el centro anula una autorización o el
  niño causa baja? (Solapa con retención RGPD F11.) _Rec.: conservar firmas (prueba), marcar
  autorización `anulada`; retención fina en F11._

## ⚖️ Afirmaciones que REQUIEREN validación de abogado (no dadas por buenas)

1. Que la **firma electrónica simple** (checkbox + nombre tecleado + hash del texto + IP/user-agent)
   sea **jurídicamente suficiente y vinculante** para salidas, medicación y recogida.
2. **Cuántos** tutores deben firmar (uno vs ambos) para validez en cada tipo (patria potestad).
3. Si se requiere **DNI/identificación reforzada** del firmante, o firma avanzada/cualificada
   (eIDAS) para algún tipo (p. ej. administración de medicación).
4. **Texto legal** de cada autorización (lo redacta/valida el centro o su asesor, no Claude).
5. **Retención y prueba**: cuánto tiempo conservar firmas e IP, y cómo casa con minimización RGPD
   (F11) y con el derecho al olvido.
6. Si la **administración de medicación** exige requisitos adicionales (prescripción médica
   adjunta, consentimiento informado específico) más allá de la autorización del tutor.

> El spec **describe el mecanismo**; **no** certifica su validez legal. Ningún punto ⚖️ se
> implementa como "válido" hasta que el abogado lo confirme por escrito (a registrar en el ADR de
> cierre).

## Tests requeridos (resumen; detalle en Checkpoint B)

- **RLS:** tutor de A no puede firmar por niño de B; firma inmutable (UPDATE/DELETE DENY); append
  de revocación permitido; profe ve roster pero no firma; autorizado sin permiso no firma; firma
  fuera de vigencia rechazada.
- **Unit:** hash del texto estable y verificable; coincidencia nombre tecleado ↔ perfil; cálculo de
  "estado de firma del niño" según `firmantes_requeridos`.
- **E2E:** admin publica autorización de salida → tutor firma → estado pasa a firmado y queda en
  audit; tutor revoca → estado refleja revocado conservando histórico.

## Decisiones cerradas (responsable, 2026-06-03)

| #      | Decisión                      | Cierre                                                                                                                                                                                    |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | Alcance LEAN                  | salida + medicación + recogida. **`atencion_medica_urgencia` queda pendiente de decidir**; el modelo (ENUM `tipo_autorizacion`) lo admitirá luego con `ALTER TYPE … ADD VALUE` (aditivo). |
| **D2** | Mecanismo de firma            | firma electrónica **simple** (checkbox + nombre tecleado + **hash SHA-256 del texto** + IP/UA). **SIN canvas** en Ola 1.                                                                  |
| **D3** | Vinculación                   | `tipo_autorizacion` + `evento_id` opcional.                                                                                                                                               |
| **D4** | Caducidad/revocación          | `vigencia_*` + revocar = **fila nueva** (append-only).                                                                                                                                    |
| **D5** | Multi-tutor                   | `firmantes_requeridos` configurable, **default `uno_principal`** (valor legal por tipo ⚖️ a abogado).                                                                                     |
| **D6** | Medicación doble confirmación | el **log de administración (2 personas) DENTRO**, en sub-fase **F8-3b**.                                                                                                                  |
| **D7** | Datos admin tutor             | DNI **solo si el abogado lo exige** → **F8-4 condicional**.                                                                                                                               |
| **D8** | Texto legal                   | **monolingüe** (idioma de firma) + UI trilingüe.                                                                                                                                          |
| **D9** | Retención/anulación           | conservar firmas, marcar autorización `anulada`; retención fina → F11.                                                                                                                    |

### GUARD crítico — texto `PENDIENTE` no firmable (a nivel de BD)

Los textos legales de los 3 tipos arrancan como **placeholder `PENDIENTE`** (es/en/va) para no parar
el proyecto. **Una autorización cuyo texto siga en placeholder NO debe poder firmarse de verdad**,
porque el hash debe ser del **texto real**. Se enforza así (no solo en UI):

- Columna `autorizaciones.texto_definitivo boolean NOT NULL DEFAULT false`.
- **CHECK** de BD: `estado = 'publicada' ⇒ texto_definitivo = true` — no se puede **publicar** una
  autorización con texto placeholder.
- Helper `autorizacion_firmable(id)` (usado en la RLS de `INSERT` de firmas) exige
  `estado='publicada' AND texto_definitivo AND now() dentro de vigencia`. ⇒ **placeholder = no
  firmable** por RLS, no solo por UI.
- Flujo: el centro crea la autorización en `borrador` con texto `PENDIENTE`; cuando llegan los
  textos reales, se **reemplazan**, se marca `texto_definitivo=true` y se **publica** → ahí pasa a
  firmable. El hash de cada firma es siempre del texto real vigente en el momento de firmar.

---

## Checkpoint B — detalle por sub-fases

> Pendiente del **OK del responsable**. Patrón de siempre: migración **aditiva**, RLS **row-aware**,
> i18n **es/en/va**, tests de aislamiento bloqueantes. Cada sub-fase es un PR reviewable.

### F8-0 — Migración + RLS + tests (sin UI)

**Objetivo:** las tablas, ENUMs, helpers y políticas que sostienen todo F8, con tests de aislamiento
verdes contra el remoto. Reviewable: la migración + la suite RLS.

**ENUMs nuevos:**

- `tipo_autorizacion`: `salida | medicacion | recogida` _(reservado futuro: `atencion_medica_urgencia`)_.
- `autorizacion_estado`: `borrador | publicada | anulada`.
- `firma_decision`: `firmado | rechazado | revocado`.
- `firmantes_requeridos`: `uno_principal | todos_los_principales | cualquiera`.

**`autorizaciones`** (auditada):

```
id uuid PK
centro_id        uuid NOT NULL → centros(id) ON DELETE CASCADE
tipo             tipo_autorizacion NOT NULL
evento_id        uuid → eventos(id) ON DELETE CASCADE      -- solo 'salida'
nino_id          uuid → ninos(id)  ON DELETE CASCADE       -- 'medicacion'/'recogida'
aula_id          uuid → aulas(id)  ON DELETE CASCADE        -- reservado (ámbito aula futuro)
titulo           text NOT NULL                              -- 1..200
texto            text NOT NULL                              -- arranca 'PENDIENTE'
texto_version    text NOT NULL                              -- p.ej. 'v0-pendiente' / 'v1'
texto_definitivo boolean NOT NULL DEFAULT false             -- GUARD D-texto
datos            jsonb NOT NULL DEFAULT '{}'::jsonb         -- campos estructurados (medicación/recogida)
firmantes_requeridos firmantes_requeridos NOT NULL DEFAULT 'uno_principal'
vigencia_desde   date
vigencia_hasta   date
estado           autorizacion_estado NOT NULL DEFAULT 'borrador'
creado_por       uuid NOT NULL → usuarios(id) ON DELETE RESTRICT
created_at/updated_at timestamptz
-- CHECK tipo↔referencias: salida ⇒ evento_id NOT NULL, nino_id NULL;
--                          medicacion/recogida ⇒ evento_id NULL, nino_id NOT NULL
-- CHECK publicar_requiere_texto: estado='publicada' ⇒ texto_definitivo
-- CHECK vigencia: vigencia_hasta IS NULL OR vigencia_desde IS NULL OR vigencia_hasta >= vigencia_desde
-- CHECK longitudes titulo/texto
```

**`firmas_autorizacion`** (auditada, **append-only, inmutable**):

```
id uuid PK
autorizacion_id  uuid NOT NULL → autorizaciones(id) ON DELETE CASCADE
nino_id          uuid NOT NULL → ninos(id) ON DELETE CASCADE
firmante_id      uuid NOT NULL → usuarios(id) ON DELETE RESTRICT
rol_firmante     tipo_vinculo NOT NULL                      -- snapshot del vínculo al firmar
decision         firma_decision NOT NULL
texto_hash       text NOT NULL                              -- SHA-256 hex del texto exacto firmado
texto_version    text NOT NULL                              -- snapshot de la versión
nombre_tecleado  text NOT NULL
comentario       text                                       -- <=500
ip_address       inet
user_agent       text
firmado_at       timestamptz NOT NULL DEFAULT now()
created_at       timestamptz
-- SIN UNIQUE: el historial es append-only; estado vigente = última fila por
--   (autorizacion_id, nino_id, firmante_id) por firmado_at.
-- UPDATE/DELETE: SIN policy → default DENY.
```

**Helpers (`STABLE SECURITY DEFINER SET search_path = public`, row-aware donde aplica):**

- `usuario_es_audiencia_autorizacion_row(p_centro_id, p_tipo, p_evento_id, p_nino_id, p_aula_id)` →
  boolean. **Row-aware** (recibe campos, no re-lee `autorizaciones`) → evita MVCC en `INSERT…RETURNING`.
- `autorizacion_aplica_a_nino(p_autorizacion_id, p_nino_id)` → boolean. Lee `autorizaciones`/`eventos`/
  `matriculas`/`ninos` (otras tablas relativas a `firmas_autorizacion`) → sin MVCC. Para `salida`
  delega en la audiencia del evento (`evento_aplica_a_nino`, reuso F7); para `medicacion`/`recogida`
  compara `nino_id`.
- `autorizacion_firmable(p_autorizacion_id)` → boolean: `estado='publicada' AND texto_definitivo AND
(vigencia_desde IS NULL OR hoy_madrid() >= vigencia_desde) AND (vigencia_hasta IS NULL OR
hoy_madrid() <= vigencia_hasta)`. **Enforza el guard placeholder.**

**RLS:**

- `autorizaciones` — SELECT: `usuario_es_audiencia_autorizacion_row(...)` (admin centro, profe del
  niño/aula, tutor del niño). INSERT: `creado_por = auth.uid() AND (es_admin(centro_id) OR (tipo='salida'
AND es_profe_de_aula(aula_del_evento) ...))` (espejo `eventos_insert`). UPDATE: `es_admin(centro_id)
OR creado_por = auth.uid()` (defensa simétrica); la **inmutabilidad tras firmas** y el límite de
  columnas los enforza el server action (+ trigger opcional que bloquea editar `texto` si hay firmas).
  DELETE: DENY.
- `firmas_autorizacion` — SELECT: `firmante_id = auth.uid() OR es_tutor_de(nino_id) OR
es_profe_de_nino(nino_id) OR es_admin(centro_de_nino(nino_id))`. INSERT: `es_tutor_de(nino_id) AND
firmante_id = auth.uid() AND autorizacion_aplica_a_nino(autorizacion_id, nino_id) AND
autorizacion_firmable(autorizacion_id)`. UPDATE/DELETE: **DENY** (revocar = fila nueva).
- Audit: triggers en ambas tablas (`centro_id` directo / vía `centro_de_nino`).

**Tests RLS (bloqueantes):** tutor de A no firma por niño de B; firma **inmutable** (UPDATE/DELETE
denegados); **append** de revocación permitido; **placeholder no firmable** (`texto_definitivo=false`
⇒ INSERT de firma rechazado por RLS); no se puede **publicar** con `texto_definitivo=false` (CHECK);
profe ve el roster pero no firma; autorizado sin vínculo de tutor no firma; firma **fuera de
vigencia** rechazada; `.insert().select()` en ambas tablas (regresión MVCC).

**Migración:** `20260603hhmmss_phase8_autorizaciones.sql`. La aplica el responsable por SQL Editor
(bug SIGILL del CLI); tras aplicarla: `db:types` + typecheck.

### F8-1 — Salida / excursión (primer tipo end-to-end)

**Objetivo:** flujo completo del tipo `salida` colgando de un `evento` (`tipo='excursion'`), reusando
la audiencia por ámbito de F7.

- **Server actions** (`'use server'`): `crearAutorizacion` (admin/profe), `publicarAutorizacion`
  (exige `texto_definitivo`), `anularAutorizacion`, `firmarAutorizacion`/`rechazarAutorizacion`/
  `revocarFirma` (tutor). Patrón Result; `.select().maybeSingle()` (gotcha "USING falso → 0 filas").
  El hash SHA-256 del texto se computa **server-side** al firmar y se compara con el de la
  autorización vigente (integridad).
- **Queries** (server-only): `getAutorizacionDetalle` (doc + roster de firmas por niño, calcula el
  estado de firma según `firmantes_requeridos`), `getAutorizacionesRango`/por evento.
- **Rutas/UI:** en el detalle del evento (`CalendarioConEventos` / `EventoDetalleDialog`) → sección
  "Autorización" cuando la hay; vista tutor con el texto + checkbox + nombre tecleado + firmar/
  rechazar; vista admin/profe con roster (firmado/pendiente/rechazado/revocado). Server Components +
  un Client para el acto de firma.
- **i18n** `autorizaciones.*` (es/en/va): chrome de UI. El **texto legal NO es i18n** (es el campo
  `texto`, monolingüe, hasheado) — D8. Placeholders `PENDIENTE` para los textos de los 3 tipos.
- **Build** obligatorio (toca `'use server'`).
- **Tests:** unit (hash estable/verificable; nombre tecleado ↔ perfil; cálculo de estado por
  `firmantes_requeridos`); E2E gateado (admin publica salida → tutor firma → estado firmado + audit;
  revoca → refleja revocado conservando histórico).

### F8-2 — Recogida (personas autorizadas)

**Objetivo:** autorización `tipo='recogida'` por niño, con **lista de personas** (nombre + DNI) que
el tutor autoriza a recoger; firmada.

- **Modelo:** la lista vive en `autorizaciones.datos` jsonb (`{ personas: [{ nombre, dni }] }`); se
  renderiza dentro del `texto` que se hashea (la lista forma parte de lo firmado). _No requiere tabla
  nueva._ (Alternativa tabla hija `personas_autorizadas_recogida` si se prefiere — 🔒 menor a decidir
  en B si quieres normalizarlo; recomiendo jsonb para Ola 1.)
- **UI:** alta admin de la lista de personas; vista tutor firma la autorización con esa lista.
- **i18n** + tests (validación DNI básica formato; el resto reusa F8-1).

### F8-3a — Medicación (autorización firmada)

**Objetivo:** `tipo='medicacion'` con campos estructurados en `datos` jsonb: `{ medicamento, dosis,
via, pauta_horaria, fecha_inicio, fecha_fin, observaciones }`, renderizados en el `texto` firmado.

- **Modelo:** reusa `autorizaciones`/`firmas_autorizacion`; `nino_id` por niño; vigencia = rango de
  la pauta. No sustituye `info_medica_emergencia.medicacion_habitual` (que sigue siendo el dato de
  emergencia).
- **UI/i18n/tests** análogos a F8-1, con el formulario estructurado de medicación.

### F8-3b — Log de administración con doble confirmación (D6, DENTRO)

**Objetivo:** registro **operativo** de cada administración con **regla de dos personas** (quien
administra ≠ quien confirma). Sobre una autorización de medicación **firmada y vigente**.

- **Migración aditiva** `…_phase8_administraciones.sql`. **`administraciones_medicacion`** (auditada):
  `id, autorizacion_id → autorizaciones, nino_id, centro_id, administrado_por → usuarios,
administrado_at, dosis_administrada, observaciones, confirmado_por → usuarios (NULL=pendiente),
confirmado_at`. **CHECK `confirmado_por <> administrado_por`** (dos personas). Estado derivado:
  `confirmado_por IS NULL ⇒ pendiente_confirmacion`.
- **RLS:** SELECT profe/admin del niño. INSERT: profe/admin del centro, `administrado_por=auth.uid()`,
  **solo si existe firma de medicación vigente** para el niño (helper `medicacion_autorizada_vigente(
nino_id)`). UPDATE (confirmar): profe/admin, `confirmado_por=auth.uid() AND confirmado_por <>
administrado_por`, `.maybeSingle()`. DELETE: DENY.
- **Tests:** una persona no puede confirmar su propia administración; sin autorización firmada vigente
  no se puede registrar; aislamiento por centro.

> ⚠️ F8-3b es **registro de seguridad operativo**, NO la firma legal. La validez de la pauta y si
> requiere prescripción médica adjunta es ⚖️ (abogado/sanitario).

### F8-4 — Datos administrativos del tutor (condicional, ⚖️)

**Solo si el abogado exige DNI/identificación** para la validez de la firma (🔒 D7). Migración
aditiva: `usuarios.dni`/`usuarios.direccion` o tabla `tutor_datos` (RLS self + admin). Si el abogado
dice que la firma simple basta sin DNI, **esta sub-fase no se hace**.

### Cierre

ADR de la fase (registrando **la respuesta del abogado** a los puntos ⚖️ tal como llegue),
`data-model.md` + `rls-policies.md` actualizados, Checkpoint C (barrido), entrada en
`progress.md`. **El merge lo hace el responsable.**

---

## Referencias

- Specs: `scope-ola-1.md`, `agenda-citas.md`, `f7-calendario.md`, `core-entities.md`
- ADRs: ADR-0001 (alta por invitación), ADR-0004 (cifrado médico), ADR-0006 (permisos granulares),
  ADR-0038 (eventos/confirmaciones), ADR-0039 (agenda/citas)
- Roadmap: disparador "datos administrativos del tutor / firma" en Fase 8
- Migración de referencia (patrón RLS row-aware + audit): `20260601140000_phase7_eventos.sql`
