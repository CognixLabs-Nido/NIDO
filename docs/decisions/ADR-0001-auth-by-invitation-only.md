# ADR-0001: Registro solo por invitación, email + password, sin OAuth

## Estado

`accepted`

**Fecha:** 2026-05-13
**Autores:** Iker Milla, claude-code
**Fase del proyecto:** Fase 1 — Identidad y acceso

## Contexto

NIDO es una agenda digital para escuelas infantiles 0–3 años. Maneja datos sensibles de menores: comidas, sueños, deposiciones, observaciones, fotografías, autorizaciones, datos médicos. El conjunto cae dentro del alcance de RGPD + LOPDGDD con la sensibilidad reforzada que la ley reserva para menores de 14 años.

Hay que decidir el modelo de acceso al sistema: ¿quién puede crear una cuenta y cómo? Las opciones son intuitivas (registro abierto con captcha, OAuth con Google/Apple, magic link, etc.) pero hay restricciones reales: ningún usuario debería poder acceder al sistema sin un vínculo verificado con un centro concreto. Un tutor solo existe si un admin lo invitó como tutor del niño X. Un profe solo existe si un admin lo asignó al aula Y.

Hay que tomar varias decisiones que se mueven juntas:

1. **Método de identificación**: ¿email + contraseña, OAuth, magic link, todo lo anterior?
2. **Vector de registro**: ¿landing pública con "Sign up", invitación cerrada, mixto?
3. **Email transaccional**: ¿Supabase Auth built-in, Resend, Postmark u otro proveedor?
4. **MFA**: ¿obligatorio, opcional, no en Ola 1?
5. **Requisitos de contraseña**: longitud y complejidad.

## Opciones consideradas

### A. Registro abierto + OAuth + magic link (modelo "Notion")

Landing con sign-up libre. OAuth Google/Apple. Magic link como alternativa. Verificación posterior del vínculo con el centro mediante un workflow administrativo.

**Pros:**

- Fricción mínima.
- Familiar para quien usa servicios SaaS modernos.

**Contras:**

- Cualquiera puede crear cuenta sin tener relación con NIDO. Eso genera ruido (cuentas fantasma) y crea superficie de ataque.
- El vínculo con el centro queda como verificación post-hoc — un agujero hasta que el admin valida.
- RGPD: la creación de cuenta crea procesamiento de datos personales sin base legal clara hasta que el admin confirma el vínculo.

### B. Registro solo por invitación, email + password, sin OAuth (elegida)

El admin (o profe con permisos delegados) envía invitaciones. El destinatario acepta desde un link único. No hay sign-up público. Email + password como único método. Resto de capacidades (OAuth, magic link, MFA) se pueden añadir más adelante si aparece la necesidad.

**Pros:**

- Cero usuarios anónimos en el sistema. Todo usuario tiene un vínculo verificable con un centro desde el momento del registro.
- Base legal RGPD limpia: el centro (responsable del tratamiento) decide quién entra y qué datos puede ver.
- Email + password es universal (no excluye a familias que no quieren cuenta Google/Apple).
- Espacio de problema pequeño: una sola superficie de ataque, fácil de auditar.

**Contras:**

- Fricción inicial alta para nuevos centros: hay que crear manualmente el primer admin (lo hacemos en Supabase Dashboard durante Ola 1).
- No hay fallback si Supabase Auth falla.
- Reset de contraseña obligatorio si el usuario la olvida (sin magic link como fallback).

### C. Magic link como único método (sin password)

Sign-in solo por enlace que llega al correo. Sin contraseña.

**Pros:**

- Sin gestión de contraseñas.
- Buena UX si el correo del usuario es ágil.

**Contras:**

- Familias acceden desde dispositivos compartidos. Si la sesión expira o cambian de móvil, dependen de un email cada vez. Inviable para centros donde el adulto que entra a verlo cambia frecuentemente.
- Diseñar reset de password ya no aplica, pero todos los problemas de entregabilidad de email se multiplican (cada login).

## Decisión

**Se elige la Opción B**: registro solo por invitación, email + password como único método, sin OAuth ni magic link en Ola 1.

**Concretamente:**

- Solo hay sign-in (no sign-up público). El link de invitación es el único vector de creación de cuenta.
- Validación de email + contraseña Zod en cliente y servidor con misma schema.
- **Requisitos de contraseña** (propuestos por claude-code, validados en revisión de spec): mínimo 12 caracteres, al menos 1 mayúscula, 1 número, 1 símbolo. Aplica a creación y a reset.
- **Expiración de invitación**: 7 días desde envío. Renovable reenviando la invitación.
- **Expiración de reset password**: 1 hora (default de Supabase, queda configurable en `config.toml`).
- **Email transaccional**: Supabase Auth built-in en Ola 1. Migración a Resend con plantillas custom en Ola 2 (cuando aparezca el primer email no-auth: recordatorios, notificaciones, etc.).
- **MFA**: opcional para todos en Ola 1, no obligatorio. Se ofrece como toggle en perfil en Ola 2.
- **Rate limit**: 5 intentos fallidos / 15 min / IP en la tabla `auth_attempts`. En el sexto intento, retraso de 5 s antes de procesar. Captcha solo si llegan problemas reales (Ola 2+).
- **Email ya existente al aceptar invitación** (caso típico: tutor con dos hijos): no se pide la contraseña en el flujo de invitación (anti-phishing). En su lugar, el sistema deja la invitación abierta, envía un aviso al destinatario y pide que inicie sesión por el flujo canónico. Tras login, la persona ve un banner persistente con sus invitaciones pendientes y las acepta desde su perfil.
- **Pantalla de invitación inválida**: las tres causas (token inexistente, expirada, ya aceptada) se renderizan con la misma vista uniforme — no revelamos qué falló, evitando fingerprinting de tokens.

## Consecuencias

### Positivas

- Modelo mental simple: "para entrar en NIDO necesitas que te inviten".
- RGPD-friendly: cada cuenta nace con vínculo verificado al centro.
- Cero código de "verificación posterior" o "estado pendiente de aprobación".
- Una sola superficie de auth para escribir specs y tests.
- Compatible con familias sin cuenta Google/Apple (que existen).
- Base lista para extender en Ola 2 con MFA, magic link como _alternativa_, o OAuth si aparece demanda real.

### Negativas

- Onboarding del primer admin en cada centro es manual (Supabase Dashboard). Aceptable mientras la base de centros sea pequeña (Ola 1 sirve a ANAIA). En Ola 11 o cuando entre el segundo centro, escribir un flow de "alta de centro" con verificación legal.
- Si Supabase Auth tiene downtime, NIDO no autentica. Mitigable con caché de sesión en cookies (Supabase ya rota refresh tokens).
- El usuario solo puede recuperar acceso por email: si pierde acceso al correo, hay que coordinar con el admin del centro fuera de la app.

### Neutras

- Las plantillas de email son las built-in de Supabase. Tras Ola 2 con Resend, se podrán personalizar.
- La migración a Resend en Ola 2 requiere reescribir `sendInvitation` y los tests que toquen el contenido del email — no afecta al modelo de datos ni al flujo.

## Plan de implementación

- [x] Migración `20260513114319_phase1_auth.sql` con `usuarios`, `roles_usuario`, `invitaciones`, `auth_attempts`.
- [x] Helpers RLS `public.usuario_actual()` y `public.es_admin()` (en `public` por restricción Supabase — ver ADR-0002).
- [x] Trigger `handle_new_user` para que la fila en `public.usuarios` aparezca automáticamente.
- [x] Server actions `sign-in`, `sign-out`, `request-password-reset`, `reset-password`, `send-invitation`, `accept-invitation` (incluye `acceptPendingInvitation` y `rejectPendingInvitation` para B8).
- [x] Middleware `src/proxy.ts` con whitelist de rutas públicas + role check para protegidas.
- [x] Páginas: `/login`, `/forgot-password`, `/reset-password`, `/invitation/[token]`, `/invitation/expired`, `/select-role`, `/admin`, `/teacher`, `/family`, `/profile`, `/profile/invitations`, `/privacy`, `/terms`, `/forbidden`.
- [x] i18n trilingüe (es/en/va) con namespace `auth.*` completo.
- [x] Tests Vitest unit (password, sign-in, invitation) + RLS (usuarios, roles, invitaciones).
- [x] Tests Playwright E2E (login flow, invitation expired, protected routes).

## Verificación

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build` deben pasar antes del merge.
- Tras merge, Vercel debe desplegar verde y la home `/es/` debe seguir cargando.
- El admin manualmente creado en Supabase Dashboard puede:
  1. Iniciar sesión en `/es/login`.
  2. Llegar a `/es/admin` (placeholder).
- Una URL `/es/admin` sin sesión redirige a login con `returnTo`.
- Una URL `/es/invitation/<uuid-inexistente>` redirige a `/es/invitation/expired`.

## Notas

- Las decisiones técnicas concretas (longitud de contraseña, ventana de rate limit, etc.) son revisables sin invalidar este ADR. Si cambian, basta con anotarlas en la spec de la fase que las modifique.
- OAuth (Google, Apple) podría reintroducirse como _alternativa adicional_ en Ola 2 si una familia real lo pide. No invalida la regla de "solo por invitación": la primera vez seguirías necesitando una invitación, OAuth solo sería un método alternativo de iniciar sesión.

## Referencias

- `docs/specs/auth.md` (spec completa).
- ADR-0002-rls-helpers-in-public-schema.md (decisión técnica forzada de plataforma).
- Migración: `supabase/migrations/20260513114319_phase1_auth.sql`.
