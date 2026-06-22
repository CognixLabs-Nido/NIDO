---
feature: onboarding-profe
wave: 1
status: approved
priority: high
last_updated: 2026-06-22
related_adrs: [ADR-0045, ADR-0046]
related_specs: [alta-tutor-driven.md, fotos-publicaciones.md]
---

# Spec — Onboarding de profesor (F11-C)

## Resumen ejecutivo

La directora invita a un profesor (nombre, email, un aula y su rol en el aula) desde la
app; el profe recibe un email, abre el formulario de accept y completa contraseña, acuse de
privacidad, idioma y (opcional) foto de perfil. Al aceptar se crea su cuenta, se le asigna
el rol `profe` del centro y se le auto-vincula al aula vía `profes_aulas`. Sustituye al alta
manual por SQL Editor que se usa hoy.

## Contexto

Hoy el alta de personal depende del **SQL Editor** (registrado como gap en
`docs/follow-ups.md`): la directora ejecuta `inviteUserByEmail` y luego inserta a mano
`roles_usuario` y `profes_aulas`. F11-C automatiza ese flujo **reusando la infra de
invitación/accept de tutores (D6)** —ya prevista como base compartida en
`docs/specs/alta-tutor-driven.md`— con UI propia y auto-vínculo a `profes_aulas` (no a
`vinculos_familiares`).

## User stories

- US-01: Como directora, quiero invitar a un profe (nombre, email, aula y rol en el aula)
  para que se dé de alta solo, sin tocar SQL.
- US-02: Como profe invitado, quiero completar mi alta (contraseña, idioma, acuse de
  privacidad y foto opcional) desde un enlace para empezar a usar la app.
- US-03: Como directora, quiero reenviar o revocar una invitación pendiente para gestionar
  altas que no se completan o que ya no proceden.
- US-04: Como profe que ya tiene cuenta (p. ej. también es tutor), quiero aceptar la
  invitación de profe desde mi sesión y quedar vinculado al aula sin crear otra cuenta.

## Decisiones cerradas (A–F)

- **A.** El "rol" del formulario = `tipo_personal_aula` (`coordinadora`/`profesora`/
  `tecnico`/`apoyo`). El `user_role` siempre es `'profe'`.
- **B.** Bucket **nuevo privado** `usuarios-fotos` (ruta `{centroId}/{usuarioId}/…`, enlaces
  firmados), espejo de `ninos-fotos`.
- **C.** La directora fija `nombre_completo` en la invitación; el profe puede **editarlo** al
  aceptar (prefill **editable**, no read-only).
- **D.** Foto **opcional** en el accept (no bloquea el alta).
- **E.** Coordinadora-única se valida **al invitar** (aviso claro, evita cuentas a medias)
  **y** se captura el `23505` en el accept como red de seguridad.
- **F.** Se incluye **B8-profe**: la misma rama `profes_aulas` también en
  `acceptPendingInvitation` (cuenta existente).

## Alcance

**Dentro (toda la feature F11-C):**

- Migración aditiva de fundación (F11-C-0): columnas + bucket + policies de Storage.
- Acción + UI admin para invitar profe; reenviar/revocar.
- Rama profe en el accept (cuenta nueva y existente) que inserta `profes_aulas`.
- Mecanismo de avatar de usuario (`usuarios.foto_url`) reusando el patrón F10-3.

**Fuera (no se hace aquí):**

- Profe en **varias aulas** a la vez desde la invitación: se invita a **1 aula**; añadir
  más aulas es gestión posterior (UI aparte, no en esta feature).
- Edición posterior del avatar fuera del accept más allá de lo mínimo de perfil (queda como
  ampliación natural, no bloqueante).
- Hardening de lookups de nombres por RPC SECURITY DEFINER (follow-up de F11-D).

## Reuso de D6 (invitación/accept de tutores)

| Pieza                                                          | Reuso                                                                                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabla `invitaciones`                                           | **Reutilizada** — `aula_id` (ya existe) + `rol_objetivo='profe'`. Se añaden `nombre_completo` y `tipo_personal_aula` (F11-C-0).                           |
| `sendInvitation`                                               | **Reutilizada** — el schema ya exige `aulaId` si `rolObjetivo='profe'`.                                                                                   |
| Email (`inviteUserByEmail`, GoTrue)                            | **Reutilizado tal cual** (role-agnóstico).                                                                                                                |
| Página accept `/invitation/[token]`                            | **Reutilizada tal cual.**                                                                                                                                 |
| `acceptInvitation` / `acceptPendingInvitation`                 | **Reutilizadas con rama profe** (insertar `profes_aulas` en vez de `vinculos_familiares`; el auto-vínculo de familia ya está gateado por `esRolFamilia`). |
| Consents (`registrar_consentimiento`, `terminos`+`privacidad`) | **Reutilizados tal cual** (role-agnósticos).                                                                                                              |
| `AcceptInvitationForm`                                         | **Reutilizado** — parentesco ya es condicional; se añade foto.                                                                                            |
| `InvitarFamiliaDialog`                                         | **NO reutilizado** — diálogo propio `InvitarProfeDialog`.                                                                                                 |

## Modelo de datos afectado (F11-C-0, esta pieza)

**Tablas modificadas:**

- `invitaciones`:
  - `+ nombre_completo text NULL` — nombre que fija la directora (editable por el profe al
    aceptar). CHECK longitud 2-120 (alineado con el schema de accept).
  - `+ tipo_personal_aula public.tipo_personal_aula NULL` — el "rol" en el aula de la
    invitación de profe. CHECK de coherencia: `NULL OR rol_objetivo = 'profe'` (análogo al
    CHECK `invitaciones_tipo_vinculo_coherente` de F11-alta-P1).
- `usuarios`:
  - `+ foto_url text NULL` — ruta del avatar en el bucket privado `usuarios-fotos` (patrón
    `ninos.foto_url`). Se firma para mostrar.

**Storage nuevo:**

- Bucket privado `usuarios-fotos` (≤15 MB, JPG/PNG/HEIC; tope efectivo 4 MB en la app; HEIC
  se rechaza en el pipeline, ADR-0046). Ruta `{centroId}/{usuarioId}/…`.

**ENUMs:** ninguno nuevo (se reusan `tipo_personal_aula` y `user_role`).

## Políticas RLS (F11-C-0)

**Tablas:** ninguna policy nueva en `invitaciones`/`usuarios` — las columnas viajan dentro
del row y heredan las policies existentes (`invitaciones_admin`, `usuarios_self_*` /
`usuarios_admin_select`). El auto-vínculo de `profes_aulas` en el accept va por
**service-role** (igual que el de `vinculos_familiares` del tutor); `profes_aulas_admin_all`
ya existe y es suficiente — **no se añaden policies de tabla**.

**Storage `usuarios-fotos`** (espejo de `ninos-fotos`, `[1]=centroId`, `[2]=usuarioId`):

```sql
-- Leer: staff del centro (admin/profe) o el propio usuario.
-- Escribir/actualizar/borrar: admin del centro o el propio usuario.
```

## Validaciones (Zod) — referencia para piezas posteriores

```typescript
// F11-C-1 (no en F11-C-0): invitar profe
export const invitarProfeSchema = z.object({
  nombreCompleto: z.string().min(2, 'auth.invite.errors.nombre').max(120),
  email: z.string().email('auth.invite.errors.email'),
  aulaId: z.string().uuid(),
  tipoPersonalAula: z.enum(['coordinadora', 'profesora', 'tecnico', 'apoyo']),
})
```

## Casos edge

- **Coordinadora ocupada (E):** al invitar como `coordinadora` un aula que ya tiene una
  activa → aviso y se bloquea; si aun así colisiona en el accept, se captura el `23505` y se
  devuelve error claro (cuenta creada pero sin vínculo → se reintenta vínculo desde gestión).
- **Profe que ya es tutor (F):** cuenta clasificada `real` → flujo B8
  (`acceptPendingInvitation`) que inserta el rol `profe` (idempotente) y el vínculo de aula.
- **Foto ausente (D):** alta válida sin foto; `usuarios.foto_url` queda NULL.
- **HEIC / >4 MB:** se rechaza con aviso (ADR-0046), sin romper el alta.
- **Reenvío:** re-`inviteUserByEmail` + UPDATE `expires_at`; el token vigente sigue válido.

## Pantallas y rutas (piezas posteriores, no F11-C-0)

- Admin: página de personal con `InvitarProfeDialog` (email, nombre, aula, rol).
- `/invitation/[token]` — reusada; el form añade foto e idioma desde `routing.locales`.

## Tests requeridos

**F11-C-0 (esta pieza):** la migración es de datos/Storage; sus tests llegan con la pieza
que la usa (F11-C-1/2/3). Gate de test de aislamiento de `usuarios-fotos` (un usuario no
escribe bajo el `{usuarioId}` de otro; un profe ajeno no escribe; admin sí) → con F11-C-3.

**Vitest (RLS) — piezas posteriores:**

- [ ] Aislamiento de `usuarios-fotos` entre usuarios y entre centros.
- [ ] Accept de profe crea cuenta + rol `profe` + `profes_aulas` (cuenta nueva y B8).
- [ ] Coordinadora-única: colisión devuelve error controlado.

## Criterios de aceptación (F11-C-0)

- [ ] Migración aditiva única aplicada al remoto (SQL Editor) sin romper filas existentes.
- [ ] `database.ts` refleja `invitaciones.nombre_completo`,
      `invitaciones.tipo_personal_aula`, `usuarios.foto_url`.
- [ ] Bucket `usuarios-fotos` creado con sus policies.
- [ ] typecheck / lint / build verdes.

## Plan por subfases

- **F11-C-0** — Fundación: migración aditiva (columnas + bucket + policies) + tipos. **(esta pieza)**
- **F11-C-1** — Invitar profe: acción `invitarProfe` + `InvitarProfeDialog` + reenviar/revocar.
- **F11-C-2** — Accept profe: rama `profes_aulas` en `acceptInvitation` y
  `acceptPendingInvitation` (B8); form con foto/idioma; captura `23505`.
- **F11-C-3** — Avatar: mecanismo `usuarios.foto_url` (patrón F10-3) + tests de aislamiento.
- **F11-C-4** — Cierre: tests RLS/gated + ADR + `progress.md` + tachar gap en `follow-ups.md`.

## Decisiones técnicas relevantes

- Auto-vínculo de `profes_aulas` por **service-role** (no por RLS de usuario) — coherente
  con el auto-vínculo de tutor; `profes_aulas_admin_all` cubre al admin, pero el profe recién
  creado no es admin → service-role evita el `42501`.
- Avatar de usuario en bucket propio (`usuarios-fotos`) en vez de reusar `ninos-fotos`:
  separación por sensibilidad/semántica (foto de adulto-personal ≠ foto de menor).

## Referencias

- ADR-0045 (Storage buckets + blog del aula), ADR-0046 (HEIC rechazado).
- `docs/specs/alta-tutor-driven.md` (D6 — infra compartida), `docs/specs/fotos-publicaciones.md` (F10-3).
- `docs/follow-ups.md` — gap "UI de alta de profesor + invitación al centro".
