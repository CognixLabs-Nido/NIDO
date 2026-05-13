---
feature: auth
wave: 1
status: draft
priority: critical
last_updated: 2026-05-13
related_adrs: ['ADR-0001-auth-by-invitation-only']
related_specs: []
---

# Spec — Identidad y acceso (Fase 1)

## Resumen ejecutivo

Sistema de identidad y acceso por invitación con 4 roles (`admin`, `profe`, `tutor_legal`, `autorizado`). Email + password, sin OAuth ni magic link. Punto de entrada único al sistema; sin registro abierto. Es la base sobre la que se construyen las fases 2–11.

## Contexto

NIDO maneja datos de menores de 0–3 años. RGPD + LOPDGDD exigen que solo personas con vínculo verificado con el centro accedan al sistema. Por eso el registro nace cerrado: solo se entra si un admin (o profe con permisos delegados) te invita explícitamente con email + rol + vínculo. La invitación se materializa en un link único y de un solo uso. El que acepta crea cuenta o se vincula a una ya existente (caso típico: tutor con varios hijos en el mismo centro).

Las decisiones de producto vienen marcadas en el prompt de Fase 1 y están reforzadas en el ADR-0001.

## User stories

- US-01: Como admin, quiero invitar a un profe por email indicando su aula para que pueda acceder a sus alumnos.
- US-02: Como admin, quiero invitar a un tutor legal vinculado a un niño concreto.
- US-03: Como admin, quiero invitar a un autorizado (no tutor) para recogida con permisos limitados.
- US-04: Como invitado, quiero aceptar la invitación con un formulario pre-rellenado y completar mi registro en menos de 30 segundos.
- US-05: Como usuario registrado, quiero iniciar sesión con email y contraseña.
- US-06: Como usuario, quiero recuperar mi contraseña por email si la olvido.
- US-07: Como tutor con dos hijos, quiero recibir una invitación por hijo y poder vincular ambas a la misma cuenta sin duplicarme.
- US-08: Como usuario con varios roles (ej. admin que también es tutor de su propio hijo), quiero elegir desde qué rol entro al iniciar sesión.

## Alcance

**Dentro:**

- Tabla `usuarios` (extensión de `auth.users` con datos de aplicación).
- Tabla `roles_usuario` (un usuario puede tener N roles, scope por centro).
- Tabla `invitaciones` (token + expiración + binding opcional a niño/aula).
- Tabla `auth_attempts` (rate limiting de login).
- Funciones helper Postgres `auth.usuario_actual()`, `auth.es_admin()`.
- Trigger `handle_new_user` (crea fila en `usuarios` al insertarse en `auth.users`).
- Políticas RLS para las 4 tablas.
- Server Actions: `signIn`, `signOut`, `requestPasswordReset`, `resetPassword`, `acceptInvitation`, `sendInvitation`.
- Schemas Zod compartidos cliente/servidor.
- Páginas Next.js: `/login`, `/forgot-password`, `/reset-password`, `/invitation/[token]`, `/select-role`, `/admin` (placeholder), `/teacher` (placeholder), `/family` (placeholder), `/profile`, `/privacy` (placeholder), `/terms` (placeholder), `/forbidden`.
- Middleware `src/proxy.ts` reescrito: i18n + auth check + verificación de rol según ruta.
- i18n trilingüe (es/en/va) para todos los strings de auth.
- Tests Vitest (unit + RLS) y Playwright (E2E).

**Fuera (no se hace aquí):**

- Tablas `centros`, `aulas`, `ninos`, `vinculos_familiares`, `profes_aulas` → **Fase 2**. La spec asume que estas tablas existirán y referencia `centro_id`, `nino_id`, `aula_id` como `uuid` sin foreign key todavía (constraint deferred).
- Onboarding del primer admin del centro → manual en Supabase Dashboard para Fase 1 (se documenta en `docs/dev-setup.md`).
- MFA TOTP/WebAuthn → opcional, **Ola 2**. En Ola 1 ningún usuario lo habilita.
- Emails con plantillas custom (logo, branding) → Supabase Auth built-in en Ola 1; migración a Resend en **Ola 2**.
- OAuth (Google, Apple) y magic link → no planificado en Ola 1.
- Captcha → no en Ola 1; rate limit es suficiente.
- Contenido legal real de `/privacy` y `/terms` → **Fase 11** (pulido final). En Ola 1 son placeholders.

## Comportamientos detallados

### B1 — Envío de invitación (admin o profe con permisos delegados)

**Pre-condiciones:**

- Usuario autenticado con rol `admin` en `centro_id` (o `profe` para invitar `tutor_legal`/`autorizado` de un niño de su aula).
- Email del invitado bien formado.

**Flujo:**

1. UI del invitador muestra formulario con: `email`, `rol_objetivo`, `nino_id` (opcional, requerido si rol es `tutor_legal`/`autorizado`), `aula_id` (opcional, requerido si rol es `profe`).
2. Submit → Server Action `sendInvitation`. Validación Zod en servidor: email válido, rol válido, vínculo coherente con rol.
3. Si ya existe `invitaciones` con mismo `email + nino_id + rol_objetivo` y `accepted_at IS NULL`: se actualiza `expires_at` (extensión 7d) y se reenvía email (no se duplica fila).
4. Si no existe: `INSERT INTO invitaciones (token = gen_random_uuid(), email, rol_objetivo, centro_id, nino_id, aula_id, invitado_por, expires_at = now() + interval '7 days')`.
5. Llama a `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: '{APP_URL}/{locale}/invitation/{token}', data: { token, rol_objetivo } })`.
6. Devuelve `{ success: true, invitation_id }`.

**Post-condiciones:**

- Fila en `invitaciones` con `accepted_at IS NULL`.
- Email entregado al destinatario (Inbucket en local, Supabase SMTP por defecto en producción).

### B2 — Aceptación de invitación (email nuevo)

**Pre-condiciones:**

- Token UUID presente en la URL `/{locale}/invitation/[token]`.
- El email de la invitación **no existe** todavía en `auth.users`.

**Flujo:**

1. Página Server Component busca `invitaciones` por token (RLS bypass vía service role en server action interna).
2. Si no existe / `accepted_at IS NOT NULL` / `expires_at < now()` → redirect a `/{locale}/invitation/expired` (ver B7).
3. Si el email **ya existe** en `auth.users` → flujo B8 (no se muestra este formulario).
4. Si válida y email nuevo → muestra formulario Client:
   - Email pre-rellenado (readonly).
   - Nombre completo (required).
   - Contraseña (required, ver requisitos).
   - Idioma preferido (`es` por defecto, dropdown).
   - Checkbox "Acepto los Términos v1.0" (link).
   - Checkbox "Acepto la Política de Privacidad v1.0" (link).
5. Submit → Server Action `acceptInvitation` con `service_role`:
   - `auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nombre_completo, idioma_preferido } })` → trigger inserta en `usuarios`.
   - `INSERT INTO roles_usuario (usuario_id, centro_id, rol)`.
   - `UPDATE invitaciones SET accepted_at = now() WHERE id = $1`.
   - `UPDATE usuarios SET consentimiento_terminos_version = 'v1.0', consentimiento_privacidad_version = 'v1.0' WHERE id = $usuario_id`.
   - Iniciar sesión inmediatamente (`auth.signInWithPassword`).
6. Redirige a `/{locale}/{dashboard-del-rol-aceptado}`.

**Post-condiciones:**

- Usuario en `auth.users` y `usuarios`.
- Fila en `roles_usuario`.
- Invitación marcada como aceptada.
- Cookies de sesión Supabase establecidas.

### B7 — Invitación inválida, caducada o ya aceptada

**Política UX:** los tres casos (token inexistente, `expires_at < now()`, `accepted_at IS NOT NULL`) se tratan con la **misma pantalla** y mensaje amable. No revelamos por qué falló (evita enumeración de tokens válidos) ni damos 404 genérico.

**Ruta:** `/{locale}/invitation/expired`.

**Flujo:**

1. Si la página `/{locale}/invitation/[token]` detecta cualquiera de los tres casos: `redirect('/{locale}/invitation/expired')`.
2. La página `expired` (Server Component) renderiza una vista con:
   - Título: "Este enlace ya no es válido".
   - Descripción: "Los enlaces de invitación caducan a los 7 días o solo se pueden usar una vez. Si necesitas acceso, pide al administrador de tu centro que te envíe una nueva invitación."
   - CTA secundario: `mailto:` al email de contacto genérico del proyecto (variable `NEXT_PUBLIC_CONTACT_EMAIL`, sale en `.env.local`).
   - CTA terciario: enlace a `/{locale}/login` por si la persona ya tiene cuenta.

**Decisión técnica:** internamente la página `[token]` distingue los 3 casos para telemetría (`auth.invitation_expired`, `auth.invitation_already_used`, `auth.invitation_token_not_found`), pero al usuario le muestra siempre el mismo contenido.

**Por qué no decimos cuál es el motivo:** un atacante podría adivinar tokens UUID y diferenciar respuestas le daría información ("este token existió pero ya se usó" vs "este token nunca existió"). La uniformidad cierra ese vector.

### B8 — Aceptación de invitación con email ya existente (doble confirmación por email + login)

**Motivación:** un tutor con dos hijos en el mismo centro tiene una sola cuenta. Cuando recibe la invitación para el segundo hijo, no queremos pedirle su contraseña dentro del formulario del invitation link (es un vector de phishing: el link viene por email, el usuario podría no saber distinguir si es legítimo). En su lugar: emitimos un **segundo email de confirmación** y le hacemos validar el vínculo solo después de iniciar sesión con sus credenciales habituales.

**Pre-condiciones:**

- Invitación válida (no expirada, no aceptada).
- El email de la invitación **ya existe** en `auth.users`.

**Flujo:**

1. Página `/{locale}/invitation/[token]` (Server Component) detecta que el email ya existe.
2. Server Action `notifyExistingAccountInvitation`:
   - Envía un email transaccional al destinatario: "Hay una invitación pendiente en tu cuenta NIDO". Cuerpo: "Inicia sesión y verás un aviso para confirmar el vínculo del nuevo niño/aula". Sin token clicable en el email — no es necesario.
   - **No** marca la invitación como aceptada. La fila sigue `accepted_at IS NULL` con su `expires_at` original.
3. La página renderiza una vista "Tienes ya una cuenta en NIDO" con:
   - "Te hemos enviado un email a `[email_ofuscado]`. Inicia sesión en NIDO y confirma el vínculo desde tu perfil."
   - Botón CTA → `/{locale}/login?returnTo=/{locale}/profile/invitations`.
   - Texto secundario: "¿Has olvidado tu contraseña? Recupérala aquí" → `/{locale}/forgot-password`.

**Tras login del usuario existente:**

4. Middleware o layout de área autenticada hace query: `SELECT * FROM invitaciones WHERE email = current_user.email AND accepted_at IS NULL AND expires_at > now()` (con service role o policy específica).
5. Si hay ≥ 1 invitación pendiente, muestra `<PendingInvitationsBanner />` persistente en todo el layout autenticado: "Tienes N vínculos pendientes. Revisar".
6. Click → `/{locale}/profile/invitations`. Lista cada invitación con resumen ("Eres invitado como {rol} para {niño/aula} en {centro}") + botón "Aceptar" y "Rechazar".
7. "Aceptar" → Server Action `acceptInvitation` versión "vincular existente":
   - `INSERT INTO roles_usuario (usuario_id, centro_id, rol)`.
   - `UPDATE invitaciones SET accepted_at = now()`.
   - Toast de confirmación.
8. "Rechazar" → Server Action `rejectInvitation` → marca `invitaciones.rejected_at = now()` (columna nueva opcional; o simplemente `UPDATE accepted_at = '-infinity'` para indicar rechazada). _Decisión: añadir columna `rejected_at timestamptz` en la migración para hacerlo explícito y permitir auditoría futura._

**Post-condiciones (tras aceptación):**

- Nueva fila en `roles_usuario`.
- Invitación con `accepted_at` poblado.
- Banner desaparece si no quedan más invitaciones pendientes.

**Por qué este flujo (no pedir contraseña en el link de invitación):**

- **Anti-phishing**: el enlace de invitación llega por email; pedir contraseña ahí entrena al usuario a meter su contraseña en URLs que llegan por correo. Movemos esa entrada al flujo de login canónico, que el usuario ya conoce y donde se aplica rate-limit.
- **Reuso de credenciales**: el usuario no tiene que recordar/escribir su contraseña en un dispositivo distinto. Inicia sesión como hace cada día.
- **Auditable**: la aceptación queda registrada con un login previo, no como un evento aislado dentro del flujo de invitación.

### B3 — Login

**Pre-condiciones:**

- Email y password proporcionados.

**Flujo:**

1. `/{locale}/login` Client form con RHF + Zod (email + password).
2. Submit → Server Action `signIn`.
3. Lee IP de header `x-forwarded-for` (o `request.ip` fallback). Hashea IP y email para `auth_attempts`.
4. Si `SELECT count(*) FROM auth_attempts WHERE ip_hash = $1 AND created_at > now() - interval '15 minutes' AND success = false >= 5`: retraso de 5 segundos antes de procesar (sleep en servidor), respuesta `{ success: false, error: 'too_many_attempts' }`.
5. Llama a `supabase.auth.signInWithPassword({ email, password })`. Inserta `auth_attempts (success = result.error == null)`.
6. Si error: respuesta genérica `{ success: false, error: 'invalid_credentials' }` (no diferenciar email inexistente vs password incorrecto).
7. Si éxito: lee `roles_usuario` del usuario. Si tiene un único rol activo → redirige a su dashboard. Si tiene varios → redirige a `/{locale}/select-role`.

**Post-condiciones:**

- Cookies Supabase establecidas.
- Una nueva fila en `auth_attempts`.

### B4 — Recuperación de contraseña

**Flujo:**

1. `/{locale}/forgot-password` form con email.
2. Submit → Server Action `requestPasswordReset` → `supabase.auth.resetPasswordForEmail(email, { redirectTo: '{APP_URL}/{locale}/reset-password' })`.
3. Respuesta **siempre** `{ success: true }`, incluso si el email no existe (evita leak de existencia).
4. El usuario abre el email y aterriza en `/{locale}/reset-password`. El token de Supabase llega en el URL hash; un useEffect en Client Component lo intercepta y establece sesión temporal vía `supabase.auth.exchangeCodeForSession`.
5. Form con campo "Nueva contraseña" + "Confirmar contraseña" (ambos sujetos a validación de fortaleza).
6. Submit → Server Action `resetPassword` → `supabase.auth.updateUser({ password })` → `supabase.auth.signOut()` → toast "Contraseña actualizada" → redirect a `/{locale}/login`.

### B5 — Sesión persistente y logout

- Sesión vía cookies Supabase con refresh token rotation (habilitado en `config.toml`).
- `signOut`: `supabase.auth.signOut()` + redirect a `/{locale}/login`.

### B6 — Protección de rutas (middleware `src/proxy.ts`)

**Lista blanca de rutas públicas (acepta cualquier locale):**

- `/{locale}` (home)
- `/{locale}/login`
- `/{locale}/forgot-password`
- `/{locale}/reset-password`
- `/{locale}/invitation/[token]`
- `/{locale}/privacy`
- `/{locale}/terms`

**Rutas protegidas y rol esperado:**

- `/{locale}/admin/*` → solo `admin`.
- `/{locale}/teacher/*` → solo `profe`.
- `/{locale}/family/*` → `tutor_legal` o `autorizado`.
- `/{locale}/profile` → cualquier autenticado.
- `/{locale}/select-role` → cualquier autenticado.

**Flujo del middleware:**

1. Aplica i18n middleware de `next-intl` primero (mantiene Fase 0).
2. Si la ruta cae en la lista blanca → pasa.
3. Lee sesión Supabase vía `createServerClient` con `request.cookies`.
4. Sin sesión → `NextResponse.redirect('/{locale}/login?returnTo={pathname}')`.
5. Con sesión: consulta `roles_usuario` del usuario. Si **ninguno** de sus roles activos coincide con el requerido por la ruta → `NextResponse.redirect('/{locale}/forbidden')`.

### B6.bis — Nota de seguridad: cookie de rol activo vs. RLS

**Importante.** La cookie `nido_active_role` (HttpOnly) controla **únicamente la UI**: qué dashboard se renderiza cuando el usuario tiene varios roles. **No** participa en ninguna decisión de autorización a nivel de base de datos.

- **Las políticas RLS de Supabase siempre validan contra _todos_ los roles activos del usuario** (`roles_usuario` filtrado por `deleted_at IS NULL`). No leen la cookie.
- Un admin que también es tutor de su propio hijo tendrá, a nivel BD, los permisos de admin _y_ de tutor simultáneamente, independientemente del rol activo en la UI.
- Si el usuario cambia el rol activo desde el selector, la UI re-renderiza el dashboard correspondiente, pero las queries devolverán los mismos datos que antes a igualdad de parámetros.
- Una cookie manipulada por el cliente no escala privilegios: lo único que cambia es qué pantalla se le muestra, no qué puede leer o escribir.
- El middleware aplica esta misma regla: para autorizar una ruta `/admin/*`, comprueba que **alguno** de los roles del usuario es `admin`. La cookie no influye en la decisión.

Esto simplifica el modelo (menos código de auth en RLS) y elimina toda una clase de bugs por mismatch entre cookie y permisos reales. La cookie es presentational state, no security state.

## Casos edge

- **Token de invitación expirado / usado / inexistente**: los tres casos → redirect a `/{locale}/invitation/expired` con UX uniforme (B7). No revelamos el motivo concreto al usuario.
- **Email ya registrado al aceptar invitación**: NO se pide contraseña en el formulario del invitation link. Se emite un email de aviso al usuario, el usuario hace login normal, y desde su área autenticada confirma el vínculo en `/{locale}/profile/invitations` (B8).
- **Usuario invitado con email existente que ha olvidado la contraseña**: usa el flujo normal `/{locale}/forgot-password`. La invitación sigue pendiente y se ve tras iniciar sesión.
- **Invitación rechazada**: queda registrada con `rejected_at`, no se vuelve a mostrar al usuario, admin puede ver el rechazo (futura tabla de auditoría en Fase 2).
- **Múltiples invitaciones pendientes al mismo email para el mismo niño**: en B1 se deduplican (UPDATE en lugar de INSERT).
- **Reset password de email inexistente**: respuesta idéntica a la del caso éxito.
- **Acceso a ruta protegida sin sesión**: redirect a `/{locale}/login?returnTo=...`. El returnTo se respeta tras login.
- **Acceso a ruta de otro rol**: redirect a `/{locale}/forbidden`. El middleware comprueba contra _todos_ los roles del usuario, no contra el rol activo (B6.bis).
- **Sesión expirada durante navegación**: Supabase SDK refresca automáticamente; si el refresh falla, el siguiente request al middleware redirige a login.
- **Usuario sin ningún rol activo** (caso anómalo): redirect a `/{locale}/forbidden`.
- **Multi-rol**: tras login, redirect a `/{locale}/select-role`. La cookie `nido_active_role` (HttpOnly) controla solo qué dashboard se renderiza; no afecta RLS (B6.bis).
- **Cookie `nido_active_role` manipulada**: la única consecuencia es que la UI renderiza un dashboard que no corresponde al rol elegido; las RLS de Supabase no se ven afectadas.
- **i18n del email de Supabase**: en Ola 1 los emails van en inglés/español según preferencia configurada en Dashboard. Mejoramos plantillas en Ola 2 con Resend.
- **Sin conexión al enviar formulario**: RHF muestra estado "Enviando..."; al fallar fetch, toast de error con CTA "Reintentar".
- **Datos inválidos**: Zod errores con claves i18n.
- **Borrado de usuario**: `usuarios.deleted_at` filtra; las políticas RLS deben excluir filas con `deleted_at IS NOT NULL` (a hacer cuando llegue el caso, no en Fase 1).

## Validaciones (Zod)

`src/features/auth/schemas/password.ts`:

```typescript
import { z } from 'zod'

export const passwordSchema = z
  .string()
  .min(12, 'auth.validation.password.too_short')
  .regex(/[A-Z]/, 'auth.validation.password.uppercase_required')
  .regex(/[0-9]/, 'auth.validation.password.digit_required')
  .regex(/[^A-Za-z0-9]/, 'auth.validation.password.symbol_required')
```

`sign-in.schema.ts`:

```typescript
export const signInSchema = z.object({
  email: z.string().email('auth.validation.email_invalid'),
  password: z.string().min(1, 'auth.validation.password_required'),
})
```

`invitation.schema.ts`:

```typescript
export const acceptInvitationSchema = z.object({
  nombre_completo: z.string().min(2).max(120),
  password: passwordSchema,
  idioma_preferido: z.enum(['es', 'en', 'va']),
  acepta_terminos: z.literal(true),
  acepta_privacidad: z.literal(true),
})

export const sendInvitationSchema = z
  .object({
    email: z.string().email(),
    rol_objetivo: z.enum(['admin', 'profe', 'tutor_legal', 'autorizado']),
    centro_id: z.string().uuid(),
    nino_id: z.string().uuid().optional(),
    aula_id: z.string().uuid().optional(),
  })
  .refine((d) => (['tutor_legal', 'autorizado'].includes(d.rol_objetivo) ? !!d.nino_id : true), {
    message: 'auth.validation.nino_id_required',
  })
  .refine((d) => (d.rol_objetivo === 'profe' ? !!d.aula_id : true), {
    message: 'auth.validation.aula_id_required',
  })
```

## Modelo de datos afectado

**Tablas nuevas:** `usuarios`, `roles_usuario`, `invitaciones`, `auth_attempts`.
**Tablas modificadas:** ninguna.
**Tablas consultadas:** `auth.users` (Supabase Auth).

Archivo de migración: `supabase/migrations/<timestamp>_phase1_auth.sql`.

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE public.user_role AS ENUM ('admin','profe','tutor_legal','autorizado');

CREATE TABLE public.usuarios (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre_completo text NOT NULL,
  idioma_preferido text NOT NULL DEFAULT 'es' CHECK (idioma_preferido IN ('es','en','va')),
  consentimiento_terminos_version text,
  consentimiento_privacidad_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.roles_usuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  centro_id uuid NOT NULL,
  rol public.user_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (usuario_id, centro_id, rol)
);

CREATE TABLE public.invitaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  email text NOT NULL,
  rol_objetivo public.user_role NOT NULL,
  centro_id uuid NOT NULL,
  nino_id uuid,
  aula_id uuid,
  invitado_por uuid REFERENCES public.usuarios(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invitaciones_token_open ON public.invitaciones(token) WHERE accepted_at IS NULL AND rejected_at IS NULL;
CREATE INDEX idx_invitaciones_email_pending ON public.invitaciones(email) WHERE accepted_at IS NULL AND rejected_at IS NULL;

CREATE TABLE public.auth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text NOT NULL,
  email_hash text NOT NULL,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_attempts_ip_time ON public.auth_attempts(ip_hash, created_at);
```

## Políticas RLS

Funciones helper:

```sql
CREATE OR REPLACE FUNCTION auth.usuario_actual() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT auth.uid(); $$;

CREATE OR REPLACE FUNCTION auth.es_admin(p_centro_id uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roles_usuario
    WHERE usuario_id = auth.uid()
      AND rol = 'admin' AND deleted_at IS NULL
      AND (p_centro_id IS NULL OR centro_id = p_centro_id)
  );
$$;
```

Políticas:

```sql
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles_usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY usuarios_self_select ON public.usuarios FOR SELECT USING (id = auth.uid());
CREATE POLICY usuarios_self_update ON public.usuarios FOR UPDATE USING (id = auth.uid());
CREATE POLICY usuarios_admin_select ON public.usuarios FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.roles_usuario ru
          WHERE ru.usuario_id = public.usuarios.id AND auth.es_admin(ru.centro_id))
);

CREATE POLICY roles_self_select ON public.roles_usuario FOR SELECT USING (usuario_id = auth.uid());
CREATE POLICY roles_admin_all ON public.roles_usuario FOR ALL USING (auth.es_admin(centro_id));

CREATE POLICY invitaciones_admin ON public.invitaciones FOR ALL USING (auth.es_admin(centro_id));
-- auth_attempts: sin políticas → solo service role la usa.
```

## Pantallas y rutas

- `/{locale}/login` — formulario login.
- `/{locale}/forgot-password` — solicitar reset.
- `/{locale}/reset-password` — nueva contraseña.
- `/{locale}/invitation/[token]` — aceptar invitación (email nuevo) o redirigir a confirmación por email (B8).
- `/{locale}/invitation/expired` — pantalla amable para token inválido / caducado / ya usado (B7).
- `/{locale}/select-role` — elegir rol si multi-rol.
- `/{locale}/admin` — placeholder "Dashboard admin (Fase 2)".
- `/{locale}/teacher` — placeholder.
- `/{locale}/family` — placeholder.
- `/{locale}/profile` — datos básicos + logout.
- `/{locale}/profile/invitations` — lista de invitaciones pendientes del usuario logueado (B8).
- `/{locale}/privacy` — placeholder.
- `/{locale}/terms` — placeholder.
- `/{locale}/forbidden` — 403.

## Componentes UI

- `LoginForm.tsx` (Client) — RHF + Zod.
- `ForgotPasswordForm.tsx` (Client).
- `ResetPasswordForm.tsx` (Client) — captura token de URL hash.
- `AcceptInvitationForm.tsx` (Client) — solo para email nuevo (B2).
- `InvitationExistingAccountNotice.tsx` (Server) — vista cuando el email ya existe (B8): CTA a login.
- `InvitationInvalid.tsx` (Server) — vista uniforme expirada/usada/inexistente (B7).
- `PendingInvitationsBanner.tsx` (Client) — banner persistente tras login si hay invitaciones pendientes (B8).
- `PendingInvitationsList.tsx` (Client) — lista en `/profile/invitations` con Aceptar/Rechazar (B8).
- `RoleSelector.tsx` (Client).
- `SignOutButton.tsx` (Client).
- `SendInvitationDialog.tsx` (Client) — formulario para admin/profe en el dashboard.
- `ProtectedPagePlaceholder.tsx` (Server) — base de las 3 páginas dashboard placeholders.

## Eventos y notificaciones

- **Push**: ninguna en Fase 1.
- **Email** (via Supabase Auth built-in):
  - Invitación (token + redirect a `/{locale}/invitation/[token]`).
  - Reset password.
  - Aviso "invitación pendiente en tu cuenta existente" (cuando un email invitado ya tiene cuenta — B8). Email sin token clicable; solo informativo + CTA a `/{locale}/login`.
- **Audit log**: no se implementa en Fase 1; queda para Fase 2 con `audit_log` + triggers automáticos en `usuarios`, `roles_usuario` e `invitaciones`.

## i18n

Claves nuevas bajo `auth.*` en `messages/{es,en,va}.json`:

```json
{
  "auth": {
    "login": {
      "title": "Iniciar sesión",
      "email": "Correo electrónico",
      "password": "Contraseña",
      "submit": "Entrar",
      "forgot": "¿Has olvidado tu contraseña?",
      "errors": {
        "invalid_credentials": "Credenciales incorrectas.",
        "too_many_attempts": "Demasiados intentos. Espera unos minutos."
      }
    },
    "forgot": {
      "title": "Recuperar contraseña",
      "description": "Te enviaremos un enlace para crear una nueva.",
      "submit": "Enviar enlace",
      "success": "Si el correo existe, recibirás un enlace en breve."
    },
    "reset": {
      "title": "Nueva contraseña",
      "new_password": "Nueva contraseña",
      "confirm_password": "Confirmar contraseña",
      "submit": "Actualizar contraseña",
      "success": "Contraseña actualizada. Inicia sesión."
    },
    "invitation": {
      "title": "Acepta tu invitación a NIDO",
      "subtitle_new": "Completa tus datos para crear tu cuenta.",
      "subtitle_existing": "Verifica tu contraseña para vincular esta invitación a tu cuenta.",
      "fields": {
        "name": "Nombre completo",
        "language": "Idioma preferido",
        "current_password": "Contraseña actual",
        "terms": "He leído y acepto los Términos y condiciones.",
        "privacy": "He leído y acepto la Política de privacidad."
      },
      "submit": "Aceptar y entrar",
      "invalid": {
        "title": "Invitación no válida",
        "description": "El enlace ha caducado o ya se ha usado. Pide una nueva al administrador."
      }
    },
    "select_role": {
      "title": "Selecciona tu rol",
      "subtitle": "Tienes acceso desde varios perfiles. Elige con cuál entrar."
    },
    "forbidden": {
      "title": "No tienes acceso",
      "description": "Tu rol no permite acceder a esta sección.",
      "back_to_home": "Volver al inicio"
    },
    "validation": {
      "email_invalid": "Correo no válido.",
      "password_required": "Introduce tu contraseña.",
      "password": {
        "too_short": "Mínimo 12 caracteres.",
        "uppercase_required": "Debe contener al menos una mayúscula.",
        "digit_required": "Debe contener al menos un número.",
        "symbol_required": "Debe contener al menos un símbolo."
      },
      "nino_id_required": "Selecciona un niño para este rol.",
      "aula_id_required": "Selecciona un aula para este rol."
    },
    "common": {
      "sign_out": "Cerrar sesión"
    }
  }
}
```

Traducciones equivalentes para `en` y `va`.

## Accesibilidad

- Todos los formularios navegables solo con teclado.
- `<label htmlFor>` asociado a cada input.
- Errores enlazados con `aria-describedby` + `role="alert"` / `aria-live="polite"`.
- Botón submit con `aria-busy` durante envío.
- Focus visible (Tailwind `focus-visible:ring-2`).
- Contraste mínimo AA en todos los textos.
- Tamaño mínimo de área táctil 44×44.

## Performance

- Páginas de auth como Server Components donde sea posible (form es Client porque usa RHF).
- Bundle JS de `/login` < 100 KB.
- Consulta de `roles_usuario` en middleware cacheada por request.
- Sin imágenes pesadas; iconos `lucide-react` tree-shakeables.

## Telemetría

Eventos sin PII (a integrar cuando haya logger estructurado en Fase 11):

- `auth.invitation_sent` (rol_objetivo, centro_id).
- `auth.invitation_accepted` (rol).
- `auth.login_success` / `auth.login_failed` (con `reason`).
- `auth.password_reset_requested`.

## Tests requeridos

**Vitest unit (`src/features/auth/__tests__/`):**

- [ ] `password.test.ts` — validador acepta/rechaza ejemplos representativos.
- [ ] `sign-in.schema.test.ts` — schema válido + variantes inválidas.
- [ ] `invitation.schema.test.ts` — `acceptInvitationSchema` y `sendInvitationSchema` (incluye refine de coherencia rol/vínculo).

**Vitest integration (con cliente Supabase contra DB local o remota):**

- [ ] `send-invitation.action.test.ts` — devuelve `success: true` con datos válidos; deduplica si ya hay pendiente.
- [ ] `accept-invitation.action.test.ts` — crea usuario nuevo; vincula existente; rechaza token caducado.

**Vitest RLS (`src/test/rls/`):**

- [ ] `usuarios.rls.test.ts` — usuario A no lee fila de usuario B; admin del centro X lee usuarios de X.
- [ ] `roles.rls.test.ts` — no-admin no lee `roles_usuario` ajenos.
- [ ] `invitaciones.rls.test.ts` — non-admin no lee invitaciones.

**Playwright E2E (`e2e/`):**

- [ ] `invitation-flow.spec.ts` — admin envía invitación → fixture lee token de DB → aceptar formulario → login funciona → llega al dashboard.
- [ ] `login-logout.spec.ts` — login válido, logout vuelve a login; credenciales inválidas muestran mensaje genérico.
- [ ] `forbidden.spec.ts` — usuario profe accediendo a `/{locale}/admin` redirige a `/{locale}/forbidden`.

## Criterios de aceptación

- [ ] Todos los tests listados pasan en CI.
- [ ] Lighthouse > 90 en `/login` y `/invitation/[token]`.
- [ ] axe-core sin violations en pantallas de auth.
- [ ] Las 3 lenguas (es/en/va) tienen todas las claves de `auth.*`.
- [ ] La feature funciona en iOS Safari 16.4+ y Chrome Android.
- [ ] ADR-0001 escrito y aceptado.
- [ ] `docs/architecture/data-model.md` actualizado con detalles de las 4 tablas nuevas.
- [ ] `docs/journey/progress.md` con entrada de Fase 1.
- [ ] Deploy a Vercel verde tras merge.

## Decisiones técnicas relevantes

- **Registro solo por invitación, email+password, sin OAuth** → ADR-0001.
- **Supabase Auth built-in en Ola 1 (no Resend)** → ADR-0001.
- **Requisitos de contraseña (12 chars + mayúscula + número + símbolo)** → ADR-0001 propone, validado en review.
- **Rate limit en tabla propia `auth_attempts` vs depender solo de Supabase** → permite control fino y queda como base para Captcha en Ola 2.
- **`auth_attempts` sin RLS policy (deny-all default)** → solo service role escribe/lee.

## Referencias

- ADR-0001-auth-by-invitation-only.md (a crear en esta fase).
- `docs/architecture/data-model.md`
- `docs/architecture/rls-policies.md`
