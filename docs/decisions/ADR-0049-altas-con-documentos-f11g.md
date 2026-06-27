# ADR-0049: Altas con documentos (F11-G) — buckets, IBAN cifrado, validación de cambios y purga

## Estado

`accepted`

**Fecha:** 2026-06-27
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 11 — Pulido final + producción (subfase F11-G)

## Contexto

El alta de un niño en NIDO pasó de ser un alta tutor-driven mínima (F11-P) a un **alta de 8 pasos con documentos** (F11-G), porque el centro real (ANAIA) necesita capturar en el onboarding: libro de familia, DNI de los dos tutores, mandato SEPA firmado (para domiciliar cuotas), dirección y estado civil de la familia, y permitir un **tutor 2 sin cuenta** que se invita al validar. Esto introduce documentos sensibles (categorías personales y un dato financiero: el IBAN) y obliga a decidir almacenamiento, cifrado, control de cambios post-validación y retención RGPD.

F11-G se construyó en 5 subfases una-por-PR (patrón F11-C): **G-0** fundación (migración: 3 buckets + 3 tablas + RLS + helpers, sin UI); **G-1** wizard de 8 pasos + documentos; **G-2** IBAN + mandato SEPA; **G-2bis** cifrado del IBAN en reposo; **G-3** edición con validación de dirección + invitación al tutor 2 + purga semimanual; **G-4** cierre (completar la purga al dato estructurado, tests RLS gated, este ADR, progress/follow-ups, retirada de código muerto).

Decisiones de producto cerradas por el responsable (A–J, 2026-06-24). Este ADR consolida las **decisiones arquitectónicas** transversales de la fase; las de modelado fino viven en los comentarios de cada migración.

## Opciones consideradas

### Opción A: documentos como filas/tablas en Postgres (bytea)

Guardar los PDFs como `bytea` en tablas.

**Pros:** todo en una transacción; RLS uniforme.
**Contras:** infla la BD; backups pesados; Postgres no es un object store; descarga/streaming incómodo.

### Opción B: Storage privado + RLS sobre `storage.objects`, dato estructurado en tablas

3 buckets privados (`libro-familia`, `dni-tutores`, `mandato-sepa`), rutas `{centroId}/{ninoId}/…`, acceso por `es_admin([1]) OR es_tutor_legal_de([2])`; el dato estructurado (identidad tutor, IBAN, mandato) en tablas con su RLS.

**Pros:** reusa el patrón de Storage ya introducido en F10; separa fichero de metadato; URLs firmadas; backups de BD ligeros.
**Contras:** dos planos de autorización (objeto + fila) que hay que mantener coherentes.

### Opción C: como B pero con IBAN en claro

**Pros:** simple; el IBAN no es categoría especial del RGPD (solo salud se cifra, ADR-0004).
**Contras:** dato financiero sensible en claro en reposo; un dump de BD lo expone; pre-piloto inaceptable para el responsable.

## Decisión

**Se elige la Opción B, con el IBAN cifrado en reposo (refinamiento sobre C).**

- **Reuso de la infraestructura de invitaciones (D6)** para el tutor 2: al validar el alta, `activarMatricula` dispara `sendInvitation` (`rol_objetivo='tutor_legal'`, vínculo `tutor_legal_secundario`) con el email que tecleó el tutor 1. No se inventa flujo nuevo; el tutor 2 pone contraseña al aceptar. Best-effort e idempotente (dedupe de invitaciones).
- **3 buckets privados** con RLS sobre `storage.objects` (rutas `{centroId}/{ninoId}/…`): leer/subir = admin del centro o tutor legal del niño; borrar = admin; **profes fuera** (no son admin ni tutor legal). "Previsualizar-no-descargar" se resuelve en capa app (disposition de la URL firmada), no en RLS.
- **IBAN cifrado (G-2bis)** con pgcrypto (`iban_cifrado bytea`, `pgp_sym_encrypt`), clave `sepa_encryption_key` en Vault **separada** de la médica (espejo de ADR-0004). Escritura por RPC `registrar_mandato_sepa` (`SECURITY DEFINER`, autoriza `es_tutor_legal_de` y cifra). El descifrado en lote (remesas pain.008) se **difiere a la Fase B**: hoy ningún cliente puede leer el IBAN en claro.
- **Edición con validación (decisión J)**: tras validar el alta (matrícula `activa`), las ediciones de datos/documentos sensibles **no se aplican directas**; se encolan en `cambios_pendientes` (estado `pendiente`) y la dirección aprueba/rechaza desde `/admin/pendientes` (badge in-app, sin push/email). Al aprobar se aplica con service role tras autorizar por RLS admin.
- **Purga semimanual (decisión H)**: retención de 5 años **sin cron** (NIDO no tiene). La directora purga un curso (fin ≥5 años) con doble validación; afecta solo a alumni (sin matrícula activa). **Borra el dato, no solo el PDF** (ver "derecho al olvido" en consecuencias).

## Consecuencias

### Positivas

- Documentos sensibles fuera de la BD, con doble autorización (objeto + fila) coherente y aislamiento entre familias/centros verificado por tests RLS gated.
- El IBAN nunca está en claro en reposo ni es legible por el cliente: un dump de BD no lo expone; solo el proceso autorizado de Fase B lo descifrará server-side.
- La validación de cambios da a la dirección control sobre los datos sensibles tras el alta sin re-abrir el wizard como vía de escritura directa.
- La purga cumple la retención RGPD de 5 años eliminando el dato estructurado.

### Negativas

- **Derecho al olvido en `audit_log` (pendiente F11-B):** la purga anula columnas de `ninos` (tabla auditada) → la dirección queda copiada en `audit_log.valores_antes`. La redacción de `valores_antes` es trabajo del paquete RGPD F11-B (puede requerir abogado). Las 3 tablas borradas (`datos_tutor`/`mandatos_sepa`/`cambios_pendientes`) **no** están auditadas, así que su DELETE no copia PII al log.
- **Alcance de la purga del menor acotado:** se anulan dirección + estado civil (datos de alta), **no** se borra la ficha del niño (identidad core, médica, pedagógica) — eso es el "derecho al olvido" general, mayor, de F11-B.
- Dos planos de autorización (Storage + tablas) a mantener sincronizados en cada cambio futuro del modelo.
- ⚖️ **Validez jurídica del mandato SEPA / firma**: F11-G implementa un mecanismo técnico auditable, no certifica validez legal (igual aviso que F8); revisión legal en F11-B.

### Neutras

- Las migraciones de F11-G se aplican **manualmente por SQL Editor** (CLI con bug SIGILL en el equipo) y requieren `npm run db:types` después.
- Prerrequisito de operador: crear `sepa_encryption_key` en Vault **antes** de aplicar G-2bis (si no, la migración revierte).

## Plan de implementación

- [x] G-0: 3 buckets + `datos_tutor`/`mandatos_sepa`/`cambios_pendientes` + RLS + helper `derivar_centro_id_de_nino`.
- [x] G-1: wizard 8 pasos, pipeline imágenes→PDF, escritura service-role-tras-authz.
- [x] G-2 / G-2bis: IBAN + mandato SEPA firmado; cifrado del IBAN + RPC `registrar_mandato_sepa`.
- [x] G-3: validación de cambios (`/admin/pendientes` + badge), invitación tutor 2, purga (PDFs).
- [x] G-4: purga completa el dato estructurado; tests RLS gated; este ADR; progress/follow-ups.

## Verificación

- Tests RLS gated `src/test/rls/f11g-validacion-purga.rls.test.ts` (gate `F11G_RLS_APPLIED=1`): datos_tutor (admin/tutor leen, profe no, aislamiento), mandatos_sepa (IBAN nunca en claro al cliente, profe no), cambios_pendientes (encolar lo propio, solo admin decide), buckets (tutor su carpeta, profe no, no carpeta ajena).
- Unit: `fechaLimitePurga` (corte de 5 años) y el dispatcher de `cambios-pendientes`.
- Verde local typecheck/lint/unit/build antes del PR.

## Notas

La purga de G-3 solo borraba PDFs + anulaba rutas; el responsable detectó el gap RGPD (el dato estructurado sobrevivía) antes de mergear G-3, y se cierra en G-4: hard-delete de filas `datos_tutor`/`mandatos_sepa`/`cambios_pendientes` del alumni + anulado de dirección/estado civil del menor. Factible sin SQL nuevo: ninguna de las 3 tablas tiene trigger de protección de DELETE ni FK entrante con RESTRICT; el service role bypassa la RLS default-DENY.

## Referencias

- Specs: decisiones A–J (memoria `project_nido_f11g_altas_documentos`).
- ADRs: ADR-0004 (cifrado pgcrypto médico, patrón espejo del IBAN), ADR-0045 (buckets + Storage F10), ADR-0007 (recursión RLS), ADR-0048 (matrícula multicurso).
- Migraciones: `20260624120000_phase11g_0_*`, `20260626120000_phase11g_2bis_cifrar_iban`.
