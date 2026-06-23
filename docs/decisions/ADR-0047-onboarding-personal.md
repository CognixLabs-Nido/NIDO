# ADR-0047: Onboarding de personal (profesor) reusando la infra de invitación/accept

## Estado

`accepted`

**Fecha:** 2026-06-23
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 11 — Pulido final + producción (F11-C)

## Contexto

Hasta F11-C el alta de personal (profes) dependía del **SQL Editor**: la directora
ejecutaba `inviteUserByEmail` y luego insertaba a mano `roles_usuario` y `profes_aulas`
(gap registrado en `docs/follow-ups.md`). Sin una UI propia el piloto no es autónomo.

La invitación/accept de **tutores** (D6, `docs/specs/alta-tutor-driven.md`) ya resuelve el
grueso del problema: tabla `invitaciones` con `token`/expiración/`aula_id`, envío de email
por GoTrue (`inviteUserByEmail`, role-agnóstico), página `/invitation/[token]`,
`acceptInvitation` (cuenta nueva, B2) / `acceptPendingInvitation` (cuenta existente, B8),
captura de consentimientos y auto-vínculo. El profe se diferencia del tutor solo en el
**destino del vínculo**: `profes_aulas` (no `vinculos_familiares`) y un "rol" en el aula
(`tipo_personal_aula`). Además se quería una **foto de perfil** opcional para el personal.

Decisión a tomar: ¿construir un onboarding de profe a medida, o reusar la infra D6 con una
rama específica? Y para el avatar: ¿bucket propio o reusar `ninos-fotos`?

## Opciones consideradas

### Opción A: Reusar D6 con rama profe (elegida)

`invitaciones` gana `nombre_completo` + `tipo_personal_aula`; `sendInvitation` ya exige
`aulaId` para `rolObjetivo='profe'`; el accept gana una rama que inserta `profes_aulas` por
service-role; el avatar va a un bucket nuevo `usuarios-fotos`.

**Pros:**

- Reutiliza email, token, expiración, consents, página de accept y clasificación de cuenta
  (stub vs real) sin duplicar nada.
- B8 (cuenta existente, p. ej. un tutor que también es profe) sale casi gratis.
- Cambios aditivos: una sola migración de fundación (F11-C-0), sin tocar el alta de tutor.

**Contras:**

- Acopla dos flujos en los mismos archivos (`accept-invitation.ts`), con ramas por rol.
- El avatar fuerza un split `acceptInvitationCore`/wrapper para subir la foto sin romper el
  redirect server-side.

### Opción B: Onboarding de profe a medida (tabla/acciones propias)

**Pros:** desacople total del alta de tutor.
**Contras:** duplica token/expiración/email/consents/clasificación de cuenta; más superficie
que mantener y testear; diverge del patrón ya probado.

### Opción C: Mantener el statu quo (SQL Editor)

**Pros:** cero código.
**Contras:** el piloto no es autónomo; alta manual propensa a error; no escalable.

### Sub-decisión — bucket del avatar: `usuarios-fotos` propio vs reusar `ninos-fotos`

Se elige **bucket nuevo privado `usuarios-fotos`** (espejo de `ninos-fotos`, ruta
`{centroId}/{usuarioId}/…`, enlaces firmados). Reusar `ninos-fotos` mezclaría fotos de
**menores** con fotos de **adultos del personal**: semántica y sensibilidad distintas, y las
policies (`es_tutor_de(ninoId)`) no aplican a un avatar de adulto. Separar es más limpio para
RGPD y para las RLS.

## Decisión

**Se elige la Opción A** (reusar D6 con rama profe) **y un bucket propio `usuarios-fotos`**,
con las decisiones A–F cerradas con el responsable:

- **A.** El "rol" del formulario = `tipo_personal_aula` (`coordinadora`/`profesora`/
  `tecnico`/`apoyo`); el `user_role` siempre es `'profe'`.
- **B.** Bucket nuevo privado `usuarios-fotos` (ruta `{centroId}/{usuarioId}/…`, enlaces
  firmados), espejo de `ninos-fotos`.
- **C.** La directora fija `nombre_completo` en la invitación; el profe puede **editarlo** al
  aceptar (prefill editable, no read-only).
- **D.** Foto **opcional** en el accept: no bloquea el alta (sin foto → `foto_url` NULL).
- **E.** Coordinadora-única se valida **al invitar** (aviso claro, evita cuentas a medias)
  **y** se captura el `23505` del índice parcial en el accept como red de seguridad.
- **F.** Se incluye **B8-profe**: la rama `profes_aulas` también en `acceptPendingInvitation`
  (cuenta existente).

Se elige A porque maximiza el reuso del flujo ya probado (riesgo bajo, cambios aditivos) y
cubre B8 sin esfuerzo extra; el coste (ramas por rol en `accept-invitation.ts`) es acotado y
explícito.

## Consecuencias

### Positivas

- Alta de personal autónoma desde la app (UI admin `admin/personal`), sin SQL Editor.
- Un profe que ya es tutor se vincula a su aula sin crear otra cuenta (B8).
- Avatar de usuario reutiliza el pipeline de Storage de F10-3 (sharp EXIF-strip→JPEG, HEIC
  rechazado, tope 4 MB, URL firmada).

### Negativas

- `accept-invitation.ts` multiplexa familia y profe con ramas por rol.
- El avatar obliga al split `acceptInvitationCore` (sin redirect) + wrapper; el camino sin
  foto conserva el redirect server-side de siempre (no-flash + propagación de cookie).
- El auto-vínculo de `profes_aulas` va por **service-role** (el profe recién creado no es
  admin → la RLS le daría `42501`), coherente con el auto-vínculo de tutor.

### Neutras

- Nuevo bucket `usuarios-fotos` con 4 policies (read = staff del centro o el propio usuario;
  write/update/delete = admin del centro o el propio usuario).

## Plan de implementación

Cerrado en 4 subfases (PRs separados):

- [x] **F11-C-0** — Fundación: migración aditiva (columnas `invitaciones.nombre_completo`/
      `tipo_personal_aula`, `usuarios.foto_url`) + bucket `usuarios-fotos` + policies (#133).
- [x] **F11-C-1** — Invitar profe: `invitarProfe` + `InvitarProfeDialog` + reenviar/revocar +
      validación coordinadora-única al invitar; página `admin/personal` (#134).
- [x] **F11-C-2** — Accept: rama `profes_aulas` en `acceptInvitation` y
      `acceptPendingInvitation` (B8); prefill editable del nombre; red del `23505` (#135).
- [x] **F11-C-3** — Avatar: route handler `usuarios/[id]/avatar` + `AvatarUploader` (perfil) + foto opcional en el accept (#136).
- [x] **F11-C-4** — Cierre: test end-to-end RLS/gated del flujo + este ADR + `progress.md` +
      tachar el gap en `follow-ups.md`.

## Verificación

- Tests unit: action `invitarProfe` + schema (17), accept B8-profe + helper de vínculo +
  23505 (9), procesado de avatar (3), foto opcional no rompe el accept (2).
- Test **end-to-end RLS** gated (`F11C0_MIGRATION_APPLIED=1`,
  `src/test/rls/onboarding-profe.rls.test.ts`): invitación → accept (cuenta nueva y B8) →
  `profes_aulas` con tipo correcto → aislamiento entre centros → conflicto coordinadora
  (23505) → aislamiento del bucket `usuarios-fotos`.
- typecheck / lint / build verdes en cada PR.
- El flujo de las acciones reales (que usan `next/headers` + `auth.admin`) se verifica en
  preview (no invocable en vitest, igual que `alta-p1-fundacion.rls`).

## Notas

- Spec: `docs/specs/onboarding-profe.md`. Relacionados: ADR-0045 (Storage buckets), ADR-0046
  (HEIC rechazado), `docs/specs/alta-tutor-driven.md` (D6).
- Follow-up vivo: salud de CI de los tests RLS gated (la BD de CI no recibe las migraciones
  aplicadas a mano; ver `docs/follow-ups.md`).
