---
feature: alta-tutor-driven
wave: 1
status: approved
priority: high
last_updated: 2026-06-15
related_adrs: []
related_specs:
  - auth.md
  - core-entities.md
  - autorizaciones-firma.md
  - proteccion-datos.md
  - fotos-publicaciones.md
---

# Spec — Alta tutor-driven (onboarding guiado)

## Resumen ejecutivo

Rediseña el alta para que, tras la invitación de la dirección, sea **el tutor** quien se dé de alta y cumplimente toda la información de su hijo (datos personales, datos pedagógicos, consentimientos, información médica + cartilla de vacunas, adjuntos), en un **asistente guiado con guardado por paso**. Hoy el alta es admin-driven (la dirección rellena todo en el wizard `NuevoNinoWizard`). El paso médico que se iba a hacer suelto (consentimiento de datos de salud + cartilla) entra **como un paso de este alta**, no aparte.

## Contexto

El alta actual carga todo el trabajo en la dirección: la directora crea el niño, rellena su información médica cifrada y lo matricula, y por separado vincula al tutor. El tutor, al aceptar la invitación, solo obtiene cuenta + rol — `accept-invitation.ts` **no crea el `vinculos_familiares`** (el `nino_id` de la invitación se lee pero no se usa), así que el vínculo tutor↔niño queda como tarea manual administrativa.

Esto no escala para el piloto (la familia conoce mejor sus propios datos: alergias, alimentación, idiomas en casa, teléfonos de emergencia) y choca con el item de Ola 1 **"Onboarding guiado para usuarios no-tech"** (`scope-ola-1.md`). Además, el paquete RGPD (F11) introduce el consentimiento explícito de datos de salud (art. 9 RGPD) que debe **gatear** la captura de info médica: si el tutor no consiente, no se piden ni se guardan esos datos. El sitio natural de ese consentimiento es el propio alta.

Esta spec recoge el mapa del estado actual, el flujo objetivo y las decisiones ya cerradas (D1–D7 + decisiones médicas), para implementar después por piezas.

## User stories

- US-01: Como **directora**, quiero invitar a una familia indicando email + nombre del niño + aula, para que el tutor complete el resto sin que yo teclee toda la ficha.
- US-02: Como **tutor**, quiero entrar desde el enlace de invitación y completar la ficha de mi hijo paso a paso (pudiendo pausar y retomar), para dar de alta a mi hijo sin depender de la dirección.
- US-03: Como **tutor**, quiero decidir explícitamente si autorizo el tratamiento de datos de salud y de imagen, y poder revocarlo, para ejercer mi consentimiento RGPD.
- US-04: Como **tutor**, quiero adjuntar la cartilla de vacunas, la foto de mi hijo y los DNIs de las personas autorizadas, para completar la documentación desde mi móvil.
- US-05: Como **directora**, quiero ver el avance del alta y activar la matrícula cuando la información esté completa, para mantener el control operativo (aula/curso) sin rellenar los datos de la familia.
- US-06: Como **directora**, quiero seguir pudiendo crear/editar la ficha de un niño (override), para casos en que la familia no pueda hacerlo.

## Alcance

**Dentro:**

- Asistente de alta **tutor-driven** con guardado por paso (reanudable), tras invitación.
- Extensión de `accept-invitation` para **crear el `vinculos_familiares`** tutor↔niño al aceptar.
- **Esqueleto de niño** creado por la dirección en la invitación (nombre + centro + aula + cohorte) que el tutor completa.
- Escritura por el tutor (con **whitelist de columnas** vía RPC/action) de: datos personales del niño, datos pedagógicos, info médica (cifrada, gateada por consentimiento), foto, cartilla de vacunas, DNIs de recogida.
- Consentimientos en el flujo: términos/privacidad (ya existen), imagen (firma A3), **datos_medicos** (per-usuario).
- **Paso médico** (decisiones ya cerradas): info médica + cartilla gateadas por consentimiento `datos_medicos`; revocación fácil e inmediata + aviso a la dirección + borrado total.
- **Estado de matrícula** (pendiente/activa) y activación por la dirección.
- Coexistencia con el camino admin (override/fallback).
- Infra de invitación/accept compartida, reusable por F11-C (alta de profes).

**Fuera (no se hace aquí):**

- **F11-C (alta de profes)**: usará la misma infra de invitación/accept, pero su UI y el auto-vínculo `profes_aulas` son pieza aparte.
- **Migración de niños existentes** a tutor-driven: no se migran; el camino admin permanece.
- **Base legal definitiva** de cada consentimiento (la confirma abogado en F11-B); aquí se modela el mecanismo, no la validez jurídica.
- **App nativa / offline-first** (Ola 2).
- Política de retención por tiempo de la cartilla: el **borrido al revocar** sí entra aquí; la purga por antigüedad la cubre F11-A6 (extender su manifiesto con el bucket nuevo).

## Estado actual (mapa)

### Invitación

- `invitaciones(id, token, email, rol_objetivo, centro_id, nino_id?, aula_id?, invitado_por, expires_at=7d, accepted_at, rejected_at)`. ENUM `user_role = admin | profe | tutor_legal | autorizado`.
- `sendInvitation` (`src/features/auth/actions/send-invitation.ts`), **admin-only** (`es_admin`); email vía Supabase `inviteUserByEmail` → `/{locale}/invitation/{token}`. El schema exige `nino_id` para tutor_legal/autorizado y `aula_id` para profe.

### Aceptación

- `acceptInvitation` (`src/features/auth/actions/accept-invitation.ts`) crea: `auth.users` → (trigger `handle_new_user`) `usuarios` → `roles_usuario` → consents **terminos + privacidad** (`registrar_consentimiento`) → marca `accepted_at` → auto-login.
- **Hueco:** `nino_id`/`aula_id` se leen pero **no se usan** → **no crea `vinculos_familiares`** (ni `profes_aulas`). El vínculo lo crea hoy la dirección por separado.

### Creación del niño (admin)

- `NuevoNinoWizard.tsx` + `crearNinoCompleto` (3 pasos: datos del niño · info médica cifrada · matrícula/aula). **Todo admin-only.** `set_info_medica_emergencia_cifrada` cifra con Vault (`medical_encryption_key`) y solo `es_admin` puede llamarla.
- `ninos`: nombre, apellidos, fecha_nacimiento, sexo, nacionalidad, idioma_principal, foto_url, notas_admin, centro_id, `requiere_ambos_firmantes`, `puede_aparecer_en_fotos`, deleted_at.
- `matriculas`: nino_id, aula_id, curso_academico_id, fecha_alta, fecha_baja, motivo_baja. **No tiene columna de estado** (pendiente/activa).
- `datos_pedagogicos_nino` (1:1): lactancia, control de esfínteres, siesta, alimentación, idiomas_casa, hermanos. Admin-only, no se recoge en el wizard hoy.
- `info_medica_emergencia` (1:1): `alergias_graves`/`notas_emergencia` cifradas (bytea pgcrypto), resto plaintext.

### Qué puede el tutor hoy

- Aceptar invitación; firmar/revocar autorizaciones F8 (recogida, medicación, imagen, reglas, salida); subir foto del niño y DNIs (F10-3, buckets `ninos-fotos`/`recogida-adjuntos`, EXIF fuera, firmados ~1 h); leer `/family`.
- **No puede** escribir datos del niño, info médica, ni datos pedagógicos.

### Piezas ya construidas que encajan

- **Consentimientos (#88 / F11-A):** enum `consentimiento_tipo` ya incluye `datos_medicos`; `registrar_consentimiento(p_usuario_id, p_tipo, p_version, p_ip, p_user_agent)` y `revocar_consentimiento(p_tipo)` listos; `CONSENT_VERSIONS.datos_medicos = 'v1.0'`. Modelo **per-usuario** (sin `nino_id`), append-only, revocación por `revocado_en`.
- **Imagen (A3):** el consentimiento de imagen va por **firma** (`autorizacion tipo='autorizacion_imagenes'`) → trigger `firma_imagen_sync_trg` → `consentimientos(tipo='imagen')` + flag `ninos.puede_aparecer_en_fotos`. No es un checkbox directo.
- **F10-3 Storage:** patrón replicable para la cartilla (bucket privado, `es_tutor_de`, ruta `{centroId}/{ninoId}/…`, `procesarDocumento` con EXIF fuera, firmados ~1 h, tope 4 MB).
- **F11-A4 (olvido) / F11-A6 (retención):** primitivas reutilizables para el borrado al revocar (`borrarObjetosBucket`, manifiesto `FUENTES_ADJUNTOS`/`FUENTES_RETENCION`).

## Decisiones resueltas

> Cerradas con el responsable (2026-06-15). No re-abrir sin acuerdo.

- **D1 — Esqueleto de niño.** La invitación crea un **esqueleto** de niño: la dirección fija `centro_id`, `aula_id`/cohorte y `nombre`; el tutor completa el resto. (Reusa `invitaciones.nino_id`.) El tutor **no** crea el niño de cero ni elige aula.
- **D2 — Split admin-only / tutor-editable.**
  - **Admin-only:** `aula_id`, `curso_academico_id`, `centro_id`, `ninos.requiere_ambos_firmantes`, `ninos.notas_admin`, estado/baja de matrícula.
  - **Tutor-editable (su hijo):** identidad del niño (apellidos, fecha_nacimiento, sexo, nacionalidad, idioma_principal), datos pedagógicos, info médica (gateada), foto, cartilla, DNIs, sus consentimientos.
  - La escritura del tutor va **siempre por RPC/action con whitelist de columnas** — nunca `UPDATE` directo a `ninos` (para que no pueda tocar aula/centro/flags). El admin mantiene **override** (camino actual).
- **D3 — Obligatorio vs opcional (RGPD art. 7.4).**
  - **Obligatorio para cerrar matrícula:** identidad del niño (nombre, apellidos, fecha_nacimiento) + términos/privacidad + parentesco del tutor.
  - **Opcional en el app:** info médica, `datos_medicos`, cartilla, imagen, foto, DNIs, datos pedagógicos.
  - ⚖️ **No se bloquea la matrícula sobre un consentimiento** (art. 7.4 RGPD: el consentimiento debe ser libre; condicionar un servicio a consentir un tratamiento no necesario lo invalida). El centro puede **exigirlo por política**, pero el software no lo fuerza. **Base legal a confirmar por abogado (F11-B).**
- **D4 — Encaje de #88/A3/médico/cartilla + write-paths nuevos.**
  - terminos/privacidad: en `accept-invitation` (sin cambios de mecanismo).
  - imagen: se firma como autorización A3 dentro del wizard → requiere **instanciar la autorización de imagen** para el esqueleto.
  - datos_medicos: `registrar_consentimiento` per-usuario.
  - **Nuevos:** (a) helper `tiene_consentimiento(p_usuario_id, p_tipo)`; (b) **RPC de escritura médica del tutor** (la pieza más sensible — ver más abajo); (c) bucket `cartilla-vacunas` + policy `es_tutor_de` + columna `info_medica_emergencia.cartilla_vacunas_path`; (d) `accept-invitation` crea `vinculos_familiares`; (e) **estado de matrícula** (pendiente/activa), hoy inexistente.
- **D5 — Coexistencia.** Los dos caminos coexisten: admin path como override/fallback; tutor-driven por defecto en altas nuevas. **No se migran** niños existentes.
- **D6 — Infra compartida con F11-C.** La infra de invitación/accept (incluido el auto-vínculo) es base reusable: para tutor crea `vinculos_familiares`; para profe (F11-C) creará `profes_aulas`. El wizard del niño es rama **exclusiva del tutor**.
- **D7 — Parentesco / tipo_vinculo / permisos.** El **tutor declara el parentesco** en el primer paso; la dirección fija `tipo_vinculo` en la invitación (**primer tutor = `tutor_legal_principal`**); `permisos` JSONB con defaults sensatos para el principal (`puede_ver_agenda`, `puede_ver_fotos`, `puede_ver_info_medica`, `puede_ver_datos_pedagogicos`, `puede_recibir_mensajes`, `puede_reportar_ausencias` = `true`).

### Decisiones médicas ya cerradas (entran como el paso médico)

- El tutor rellena lo médico **gateado por el consentimiento `datos_medicos`**: con consentimiento vigente puede rellenar; sin él, no se piden ni se guardan.
- Consentimiento **per-usuario** (cubre a todos los hijos de ese tutor).
- Columna **`info_medica_emergencia.cartilla_vacunas_path`** (1 cartilla por niño).
- **Revocar = fácil e inmediato + AVISO a la dirección (no aprobación) + borrado total** de la info médica de los hijos de ese tutor + la cartilla en Storage.
- La **cartilla** solo se habilita tras el consentimiento.

## Flujo objetivo (tutor-driven)

**Patrón: asistente guiado con guardado por paso (reanudable).** Como el esqueleto del niño ya existe, cada paso escribe a las tablas reales bajo RLS → el progreso persiste en servidor (no se pierde al recargar) y la dirección ve el avance. Tras el alta, las mismas secciones quedan editables desde `/family/nino/[id]` (ficha progresiva). Híbrido: orden guiado la primera vez, edición libre después.

1. **Invitación (dirección).** `sendInvitation` extendido: crea esqueleto de niño (`nombre`, `centro_id`, `aula_id`/cohorte) + matrícula `pendiente` + invitación con `nino_id` y `tipo_vinculo`.
2. **Cuenta + tutor.** El tutor entra por el enlace, fija nombre/idioma/contraseña, acepta términos/privacidad y declara parentesco. `acceptInvitation` crea cuenta + rol + consents + **`vinculos_familiares`** (con `tipo_vinculo` de la invitación, `parentesco` declarado, `permisos` por defecto).
3. **Datos del niño.** Completa apellidos, fecha_nacimiento, sexo, nacionalidad, idioma_principal (RPC whitelist).
4. **Datos pedagógicos.** Lactancia, alimentación, idiomas en casa, siesta, esfínteres, hermanos (RPC/action whitelist).
5. **Consentimientos firmables.** Imagen (firma A3 sobre la autorización instanciada) y **datos_medicos** (`registrar_consentimiento`).
6. **Info médica + cartilla.** Gateadas por `datos_medicos`: RPC de escritura médica del tutor + subida de cartilla al bucket privado.
7. **Adjuntos.** Foto del niño (`ninos-fotos`) y DNIs de personas autorizadas (`recogida-adjuntos`, F8/F10-3).
8. **Cierre.** El tutor marca "completado"; la **dirección activa la matrícula** (`pendiente → activa`).

## Comportamientos detallados

### Comportamiento 1: Invitación con esqueleto de niño (dirección)

**Pre-condiciones:** usuario admin del centro; aula existente.

**Flujo:**

1. La dirección rellena email del tutor + nombre del niño + aula (+ `tipo_vinculo`, default principal).
2. El action crea (transaccional, service role): fila `ninos` esqueleto (`nombre`, `centro_id`, `aula_id` derivada), `matriculas` con `estado='pendiente'`, e `invitaciones` con `rol_objetivo='tutor_legal'`, `nino_id`, `aula_id`.
3. Instancia la **autorización de imagen** (`tipo='autorizacion_imagenes'`) para ese niño desde la plantilla del centro (para que el tutor pueda firmarla en el paso 5).
4. Envía email de invitación.

**Post-condiciones:** esqueleto + matrícula pendiente + invitación abierta; nada PII de la familia aún.

**Casos edge:** sin plantilla de imagen publicada en el centro → el paso de imagen se omite con aviso (no bloquea); re-invitación del mismo email reusa/actualiza la invitación abierta (dedupe actual).

### Comportamiento 2: Aceptación + auto-vínculo (tutor)

**Pre-condiciones:** invitación abierta y no expirada; email no registrado.

**Flujo:**

1. El tutor fija nombre/idioma/contraseña, acepta términos/privacidad, declara parentesco.
2. `acceptInvitation`: crea `auth.users` → `usuarios` → `roles_usuario` → consents → **`vinculos_familiares`** (`nino_id` de la invitación, `usuario_id` nuevo, `tipo_vinculo` de la invitación, `parentesco` declarado, `permisos` por defecto) → marca `accepted_at` → auto-login.
3. Si cualquier paso falla → rollback completo (borra usuario/rol/vínculo) (extiende el rollback actual).

**Post-condiciones:** el tutor queda vinculado al niño y `es_tutor_de(nino_id)=true` → desbloquea la escritura del resto del wizard por RLS.

**Casos edge:** invitación expirada/aceptada/rechazada → error claro; email ya registrado → flujo `acceptPendingInvitation` (B8) que también debe crear el vínculo.

### Comportamiento 3: Escritura del tutor con whitelist (datos del niño / pedagógicos)

**Pre-condiciones:** `es_tutor_de(nino_id)`.

**Flujo:** el tutor envía solo las columnas editables; el action/RPC ignora/rechaza cualquier columna fuera de la whitelist (aula/centro/flags). Validación Zod server-side.

**Post-condiciones:** `ninos`/`datos_pedagogicos_nino` actualizados solo en columnas permitidas; queda en `audit_log`.

**Casos edge:** intento de enviar `aula_id`/`centro_id`/`requiere_ambos_firmantes` → ignorado por la whitelist (defensa, no error visible necesariamente).

### Comportamiento 4: Consentimiento + paso médico (gate)

**Pre-condiciones:** `es_tutor_de(nino_id)`.

**Flujo:**

1. Si no hay `datos_medicos` vigente, la UI ofrece consentir; al consentir → `registrar_consentimiento(usuario, 'datos_medicos', version, ip, ua)`.
2. Con consentimiento vigente, se habilitan los campos médicos y la cartilla. La escritura médica va por la **RPC de escritura médica del tutor**.
3. La cartilla se sube al bucket `cartilla-vacunas` (`{centroId}/{ninoId}/…`), EXIF fuera, firmada ~1 h; la ruta se guarda en `info_medica_emergencia.cartilla_vacunas_path` (vía service role tras autorizar, como F10-3 foto).

**Post-condiciones:** info médica cifrada + cartilla asociadas al niño, solo si hubo consentimiento.

**Casos edge:** sin consentimiento → los campos médicos no se muestran ni se guardan; si el tutor intenta la RPC sin consentimiento vigente → la RPC rechaza (gate server-side).

### Comportamiento 5: Revocación del consentimiento médico

**Pre-condiciones:** `datos_medicos` vigente del tutor.

**Flujo:**

1. El tutor revoca → `revocar_consentimiento('datos_medicos')`.
2. Acción de borrado (service role, reusa primitivas A4/A6): NULL-ea los 6 campos de `info_medica_emergencia` (incluidos los cifrados) de **los hijos de ese tutor** + `borrarObjetosBucket('cartilla-vacunas', …)` + limpia `cartilla_vacunas_path`.
3. **Aviso a la dirección** (no aprobación): notificación/registro de que el tutor revocó y se borraron los datos.

**Post-condiciones:** sin datos médicos ni cartilla para esos niños; consentimiento marcado `revocado_en`; aviso emitido. Borrado **total** (incluye alergias de emergencia — riesgo de seguridad aceptado y avisado a la dirección).

**Casos edge:** revocación con varios hijos → afecta a todos; revocación idempotente (si no hay vigente, no-op); el aviso a dirección no debe contener PII médica.

### Comportamiento 6: Activación de matrícula (dirección)

**Pre-condiciones:** matrícula `pendiente`; admin del centro.

**Flujo:** la dirección revisa el avance y activa (`pendiente → activa`). La activación es el gate operativo (confirma aula/cohorte).

**Post-condiciones:** matrícula activa; el niño entra en los flujos normales (agenda, etc.).

**Casos edge:** activar con datos incompletos → permitido (lo obligatorio mínimo ya se valida en pasos previos; lo opcional no bloquea, D3); fuera de cohorte → confirmación explícita (como hoy en `crearNinoCompleto`).

## Casos edge (transversales)

- **Reanudar a medias:** el tutor cierra el navegador en el paso 4 → al volver, el wizard detecta qué hay persistido y reanuda en el primer paso incompleto.
- **Sin permisos:** un usuario que no es `es_tutor_de(nino)` no puede escribir nada del esqueleto (RLS/RPC deniegan).
- **Permisos cambiados mientras se usa:** si la dirección revoca el vínculo a media sesión, las siguientes escrituras fallan por RLS (gestión de error en el action).
- **Idiomas:** todo el wizard en es/en/va; el idioma del tutor se fija en el paso 1.
- **Datos sensibles:** info médica cifrada (Vault); cartilla en bucket privado; nunca loggear PII médica; el aviso de revocación a dirección sin PII.
- **Esqueleto huérfano** (creado y nunca completado, invitación expirada): lo gestiona la **dirección** — re-invitar **reusa** el mismo esqueleto, o lo borra. Además, **F11-A6 (retención)** lo auto-limpia con un predicado nuevo en su manifiesto extensible (matrícula `'pendiente'` + invitación expirada + sin `vinculos_familiares`, tras periodo de gracia). Decisión menor (d) cerrada.
- **Concurrencia:** dirección y tutor editando el mismo niño → la whitelist evita choques de columnas (la dirección toca aula/flags; el tutor, datos de familia).

## Validaciones (Zod)

Schemas a definir (no exhaustivo):

```typescript
// Invitación con esqueleto
export const InvitarConEsqueletoSchema = z.object({
  email: z.string().email('auth.invitation.errors.email_invalido'),
  nombreNino: z.string().min(1).max(80, 'nino.validation.nombre_largo'),
  aulaId: z.string().uuid('nino.validation.aula_invalida'),
  tipoVinculo: z.enum(['tutor_legal_principal', 'tutor_legal_secundario', 'autorizado']),
})

// Aceptación extendida con parentesco
export const AceptarAltaTutorSchema = AcceptInvitationSchema.extend({
  parentesco: z.enum([
    'madre',
    'padre',
    'abuela',
    'abuelo',
    'tia',
    'tio',
    'hermana',
    'hermano',
    'cuidadora',
    'otro',
  ]),
  descripcionParentesco: z.string().max(120).optional().nullable(),
})

// Escritura del niño por el tutor (whitelist — sin aula/centro/flags)
export const ActualizarNinoTutorSchema = z.object({
  apellidos: z.string().min(1).max(120),
  fechaNacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sexo: z.enum(['F', 'M', 'X']).nullable().optional(),
  nacionalidad: z.string().max(60).nullable().optional(),
  idiomaPrincipal: z.enum(['es', 'en', 'va']),
})
```

## Modelo de datos afectado

**Tablas nuevas:** ninguna. El **aviso de revocación a dirección** NO crea tabla-log nueva: reusa un canal de notificación a dirección ya existente (recordatorio/anuncio), y el registro persistente del hecho ya vive en `consentimientos.revocado_en` (decisión menor (c) cerrada).

**Tablas modificadas:**

- `info_medica_emergencia`: **+ `cartilla_vacunas_path text NULL`** (ruta en bucket `cartilla-vacunas`).
- `matriculas`: **+ `estado matricula_estado NOT NULL DEFAULT 'activa'`** — nuevo ENUM `matricula_estado` con valores `'pendiente' | 'activa' | 'baja'` (decisión menor (a) cerrada). **Reconciliación con `fecha_baja`:** `fecha_baja` conserva la **fecha** de baja; `estado` es el **estado**, no se derivan el uno del otro (la fecha es un dato, el estado una transición explícita). El alta tutor-driven arranca en `'pendiente'`; la dirección activa a `'activa'` (Comportamiento 6); la baja pasa a `'baja'` y rellena `fecha_baja`.
- `invitaciones`: **+ `tipo_vinculo tipo_vinculo NOT NULL DEFAULT 'tutor_legal_principal'`** (decisión menor (b) cerrada). El accept lo aplica al crear el `vinculos_familiares`. La dirección lo sube a `'tutor_legal_secundario'` al invitar al segundo tutor. **No** se deriva de `rol_objetivo` (que no distingue principal/secundario).

**Tablas consultadas/escritas en el flujo:** `ninos`, `vinculos_familiares`, `datos_pedagogicos_nino`, `consentimientos`, `autorizaciones`/`firmas_autorizacion` (imagen), `usuarios`, `roles_usuario`, `audit_log` (triggers).

**Migraciones que implicará (sin aplicar aún; CLI SIGILL → SQL Editor + línea `schema_migrations`):**

1. Bucket privado `cartilla-vacunas` + políticas `storage.objects` (`es_tutor_de(((storage.foldername(name))[2])::uuid)` para INSERT/SELECT/DELETE del tutor; staff del centro para SELECT) + columna `cartilla_vacunas_path`.
2. ENUM `matricula_estado` (`'pendiente' | 'activa' | 'baja'`) + columna `matriculas.estado`. **Backfill:** existentes con `fecha_baja IS NOT NULL` → `'baja'`; el resto → `'activa'`.
3. Helper `tiene_consentimiento(p_usuario_id, p_tipo)` y **RPC de escritura médica del tutor**.
4. `invitaciones.tipo_vinculo` (ENUM `tipo_vinculo`, default `'tutor_legal_principal'`).
5. Predicado de auto-limpieza de **esqueletos huérfanos** en el manifiesto de F11-A6 (retención): ver "Decisiones técnicas" (d).

## RPC / helpers nuevos

- **`set_info_medica_emergencia_cifrada_tutor(...)`** — la pieza **MÁS SENSIBLE**. `SECURITY DEFINER`, `search_path = public, extensions`. Acotada a lo médico de **su** hijo:
  - Autoriza con `es_tutor_de(p_nino_id) AND tiene_consentimiento(auth.uid(), 'datos_medicos')` (gate de consentimiento server-side).
  - Cifra `alergias_graves`/`notas_emergencia` con la clave de Vault **sin exponerla** (igual que la RPC admin).
  - **No** puede tocar otros niños ni otras columnas (solo las 6 médicas + `cartilla_vacunas_path`).
  - Mismo cuidado que las RPC de F8/A4 (contrato NULL = preservar, ADR-0004).
- **`tiene_consentimiento(p_usuario_id, p_tipo)`** → boolean — última fila vigente (`revocado_en IS NULL`) para (usuario, tipo). `STABLE SECURITY DEFINER`.
- (Posible) RPC/action para la **escritura whitelist** de `ninos` y `datos_pedagogicos_nino` por el tutor.

## Políticas RLS

- **Storage `cartilla-vacunas`** (nuevo): patrón F10-3. INSERT/SELECT/DELETE del tutor con `es_tutor_de(((storage.foldername(name))[2])::uuid)` (ruta `{centroId}/{ninoId}/…`); SELECT staff del centro (`es_admin OR es_profe_en_centro`). Bucket privado, enlaces firmados ~1 h.
- **`info_medica_emergencia`**: hoy INSERT/UPDATE solo admin. Se añade escritura del tutor **vía RPC `SECURITY DEFINER`** (no se abre una policy de UPDATE directa al tutor, para no exponer columnas ni el cifrado — mismo criterio que `archivar_autorizacion`/RPC de F8). La RPC hace el gate.
- **`ninos` / `datos_pedagogicos_nino`**: la escritura del tutor va por RPC/action con whitelist (no `UPDATE` directo). Si se opta por policy, debe ser estrictamente acotada por columnas (preferible RPC).
- **`vinculos_familiares`**: el INSERT del auto-vínculo lo hace `acceptInvitation` con **service role** (tras validar la invitación), no el cliente.
- **Gotcha MVCC / recursión:** cualquier helper nuevo en policies de SELECT que se evalúen vía `INSERT…RETURNING` debe ser row-aware; los lookups van por helpers `SECURITY DEFINER` (ADR-0007). `tiene_consentimiento` lee `consentimientos` (tabla distinta de las que se insertan en el flujo) → sin MVCC.

## Pantallas y rutas

- `/{locale}/invitation/{token}` — aceptación (existe) + **paso de parentesco** nuevo.
- `/{locale}/family/alta/{ninoId}` (o `/family/nino/{id}/completar`) — **asistente de alta** reanudable (nuevo). Pasos 3–7.
- `/{locale}/family/nino/{id}` — ficha (existe), pasa a permitir **edición** de las secciones tutor-editables tras el alta.
- `/{locale}/admin/...` — UI de invitación con esqueleto + vista de avance del alta + **activar matrícula** (extensión del área admin).

## Componentes UI

- `AltaTutorWizard.tsx` (Client) — asistente con estado de paso derivado de lo ya persistido (reanudable). Reusa el layout de pasos/progreso de `NuevoNinoWizard` pero **con guardado por paso**.
- `PasoDatosNino.tsx`, `PasoDatosPedagogicos.tsx`, `PasoConsentimientos.tsx`, `PasoMedico.tsx`, `PasoAdjuntos.tsx` (Client).
- Reusa: `SubirFotoNino`, `PersonasAutorizadasEditor` (DNIs), `FirmarAutorizacionPanel` (imagen), pad/uploader de cartilla (nuevo, molde `procesarDocumento`).
- `InvitarFamiliaConEsqueleto.tsx` (admin), `AvanceAltaCard.tsx` (admin), botón **Activar matrícula**.

## Eventos y notificaciones

- **Aviso a la dirección al revocar `datos_medicos`** (no aprobación): reusa un **canal de notificación a dirección ya existente** (recordatorio/anuncio); **NO** se crea tabla-log nueva (el registro persistente ya está en `consentimientos.revocado_en`). **Sin PII médica** en el aviso.
- Audit log: automático por triggers en `ninos`, `info_medica_emergencia`, `datos_pedagogicos_nino`, `vinculos_familiares`, `consentimientos` (vía RPC), `matriculas`.
- Email: invitación (Supabase, existente).

## i18n

Nuevos namespaces (es/en/va): `alta.*` (pasos, títulos, ayudas), `alta.medico.*`, `alta.cartilla.*`, `alta.consentimientos.*`, `alta.parentesco.*`, claves de validación. La revocación y sus avisos también traducidos.

## Accesibilidad

- Wizard navegable por teclado completo; foco gestionado entre pasos; progreso anunciado (`aria-current`).
- Errores vinculados con `aria-describedby`; subida de adjuntos con estados `aria-busy`.
- Subida desde móvil (cámara) con `accept` y mensajes claros (HEIC se rechaza, como F10).

## Performance

- Cada paso guarda de forma independiente (payloads pequeños). Subidas ≤ 4 MB (tope app, margen bajo el body de Vercel).
- Esqueleto + matrícula pendiente creados una sola vez en la invitación.

## Telemetría (sin PII)

- `alta_iniciada`, `alta_paso_completado` (con índice de paso), `alta_completada`, `consentimiento_datos_medicos_otorgado/revocado`, `cartilla_subida`, `matricula_activada`.

## Tests requeridos

**Vitest (unit/integration):**

- [ ] Schemas Zod (invitación con esqueleto, aceptación con parentesco, whitelist del niño) válidos/ inválidos.
- [ ] `acceptInvitation` crea `vinculos_familiares` con `tipo_vinculo`/`parentesco`/permisos correctos y hace rollback ante fallo.
- [ ] Whitelist: enviar `aula_id`/`centro_id`/flags no muta esas columnas.
- [ ] Gate médico: la RPC del tutor rechaza sin consentimiento vigente.
- [ ] Revocación: borra info médica de **todos** los hijos del tutor + cartilla; idempotente; emite aviso sin PII.

**Vitest (RLS / Storage) — gateados por flag de migración aplicada:**

- [ ] Tutor escribe la info médica de su hijo solo con consentimiento; no puede la de otro niño.
- [ ] Storage `cartilla-vacunas`: aislamiento entre familias (un tutor no sube bajo el `{ninoId}` de otra familia); staff del centro lee.
- [ ] `tiene_consentimiento` refleja alta/revocación.
- [ ] `.insert().select()` en las tablas tocadas (regresión MVCC) donde aplique.

**Playwright (E2E):**

- [ ] Flujo completo: dirección invita con esqueleto → tutor acepta, completa todos los pasos → dirección activa matrícula.
- [ ] Reanudar el wizard a media.
- [ ] Consentir y revocar datos médicos (verifica borrado + aviso).

## Criterios de aceptación

- [ ] Todos los tests anteriores en verde en CI.
- [ ] Las 3 lenguas (es/en/va) completas para los namespaces nuevos.
- [ ] La RPC de escritura médica del tutor no expone la clave de Vault ni permite tocar otros niños/columnas (revisado + test).
- [ ] El camino admin (override) sigue funcionando sin regresiones.
- [ ] ADR(s) escritos para las decisiones no obvias (ver abajo).
- [ ] `docs/architecture/data-model.md` y `rls-policies.md` actualizados (cartilla, estado matrícula, RPC/helper, auto-vínculo).

## Decisiones técnicas relevantes (ADR a crear)

- **ADR — Alta tutor-driven y auto-vínculo en accept.** Cambio de modelo (admin-driven → tutor-driven), creación de `vinculos_familiares` en `acceptInvitation`, esqueleto de niño, coexistencia con admin path.
- **ADR — Escritura médica del tutor (RPC `SECURITY DEFINER` gateada por consentimiento).** Por qué RPC y no policy de UPDATE; gate de consentimiento; no exposición de Vault; alcance de columnas.
- **ADR — Estado de matrícula.** ENUM `matricula_estado` (`'pendiente' | 'activa' | 'baja'`), reconciliación con `fecha_baja` (fecha = dato, estado = transición), backfill, gate de activación por dirección.

### Decisiones menores resueltas (2026-06-15)

- **(a) `matricula_estado`:** ENUM `('pendiente' | 'activa' | 'baja')`. `fecha_baja` conserva la fecha; el estado es el estado (no se derivan). Backfill: con `fecha_baja` → `'baja'`; resto → `'activa'`.
- **(b) `invitaciones.tipo_vinculo`:** **nueva columna** (ENUM `tipo_vinculo`), default `'tutor_legal_principal'`; el admin la sube a `'tutor_legal_secundario'` para el segundo tutor. No se deriva de `rol_objetivo`.
- **(c) aviso de revocación:** reusa canal de notificación a dirección ya existente; **sin tabla-log nueva** (el registro ya está en `consentimientos.revocado_en`); sin PII médica.
- **(d) esqueleto huérfano:** lo gestiona el admin (re-invitar reusa el esqueleto, o lo borra) **y** F11-A6 lo auto-limpia con un predicado nuevo (matrícula `'pendiente'` + invitación expirada + sin `vinculos_familiares`, tras gracia), reusando su manifiesto extensible.

## Referencias

- `docs/specs/auth.md`, `docs/specs/core-entities.md`, `docs/specs/autorizaciones-firma.md`, `docs/specs/proteccion-datos.md`, `docs/specs/fotos-publicaciones.md`.
- ADR-0004 (cifrado info médica), ADR-0007 (recursión RLS), ADR-0041 (autorizaciones/firma), ADR-0045/0046 (Storage).
- `scope-ola-1.md` — item "Onboarding guiado para usuarios no-tech" (Ola 1).
- F11-A4 (olvido) y F11-A6 (retención) — primitivas de borrado reutilizadas.

---

**Workflow de esta spec:**

1. Claude Code escribe esta spec basándose en CLAUDE.md y las decisiones globales. ✅
2. Responsable revisa y comenta (status: `draft` → `review`). ✅
3. Responsable aprueba (status: `review` → `approved`). ✅ (2026-06-15, con las 4 decisiones menores resueltas)
4. Claude Code implementa por piezas (status: `approved` → `in-progress`).
5. PR mergeado y desplegado (status: `in-progress` → `done`).
