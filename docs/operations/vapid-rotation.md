# Rotación de VAPID keys — NIDO

Las **VAPID keys** son el par de claves asimétricas que identifican al servidor que envía las push notifications. La pública vive en el cliente (ver `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) y se incluye en cada `pushManager.subscribe`; la privada vive en el servidor (`VAPID_PRIVATE_KEY`) y firma los envíos.

Este documento describe cómo generarlas la primera vez y cómo rotarlas.

## Generación inicial

Ejecutar localmente desde la raíz del proyecto:

```bash
npx web-push generate-vapid-keys --json
```

Salida (ejemplo):

```json
{
  "publicKey": "BNJ1...",
  "privateKey": "L8jK..."
}
```

> Guarda este JSON en un sitio seguro (1Password / KeePass / Vault). La clave privada **no se versiona** en git.

Configura las variables de entorno en estos tres sitios:

### 1. `.env.local` (desarrollo local)

```bash
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<publicKey>
VAPID_PUBLIC_KEY=<publicKey>            # mismo valor — espejo server-only
VAPID_PRIVATE_KEY=<privateKey>
VAPID_SUBJECT=mailto:contacto@nido.app
```

`.env.local` está en `.gitignore` y nunca debe commitearse.

### 2. Vercel — Production, Preview y Development

```bash
vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY production
vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY preview
vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY development
vercel env add VAPID_PUBLIC_KEY         production
vercel env add VAPID_PUBLIC_KEY         preview
vercel env add VAPID_PUBLIC_KEY         development
vercel env add VAPID_PRIVATE_KEY        production
vercel env add VAPID_PRIVATE_KEY        preview
vercel env add VAPID_PRIVATE_KEY        development
vercel env add VAPID_SUBJECT            production
vercel env add VAPID_SUBJECT            preview
vercel env add VAPID_SUBJECT            development
```

O desde el Dashboard: `Project → Settings → Environment Variables`.

Tras añadirlas, redespliega para que las nuevas variables se apliquen.

### 3. CI (GitHub Actions)

Las VAPID keys **no** se necesitan en CI: los tests unit mockean `web-push`. No añadir secrets al repo.

## Rotación programada (ej. anual o tras cambio de equipo)

1. Generar par nuevo con `npx web-push generate-vapid-keys --json`.
2. Actualizar las 3 variables en **Vercel** (Prod + Preview + Dev) y redeploy.
3. Actualizar el `.env.local` de cada dev local.
4. **Implicación clave**: las suscripciones existentes en `push_subscriptions` **siguen siendo válidas**. Los endpoints del navegador no se invalidan por cambiar VAPID en servidor; lo único que cambia es la firma del envío, que el navegador verifica contra la `applicationServerKey` original.
5. Las suscripciones **nuevas** (alta tras el rollout) usarán automáticamente la `NEXT_PUBLIC_VAPID_PUBLIC_KEY` actualizada.

## Rotación de emergencia (compromiso de la clave privada)

Si la clave privada se filtra o se sospecha compromiso:

1. Generar par nuevo inmediatamente.
2. Actualizar Vercel (Prod + Preview + Dev) y redeploy.
3. **Vaciar `push_subscriptions`** para forzar re-opt-in con la nueva clave:

   ```sql
   -- En Supabase SQL Editor
   TRUNCATE public.push_subscriptions;
   ```

   Las suscripciones quedan invalidadas: la próxima vez que cada usuario abra NIDO y el `useNotificationPermission` detecte `hasSubscription === false`, podrá re-activar.

4. Comunicar al equipo y al responsable.
5. Si la clave filtrada estaba en `.env.local` de algún dev, rotar también sus credenciales de Supabase service role por buena medida.

## Verificación post-rotación

Smoke en un dispositivo recién registrado:

1. Login en NIDO desde Chrome.
2. `/profile` → "Activar notificaciones".
3. Supabase SQL Editor:
   ```sql
   SELECT id, endpoint, created_at FROM public.push_subscriptions
   WHERE usuario_id = '<tu-uuid>' ORDER BY created_at DESC LIMIT 1;
   ```
4. Comprobar que aparece la nueva fila.
5. Envía un mensaje desde otra sesión a la conversación → confirmar que la notificación llega.

Si llega: rotación OK.

Si no llega:

- Revisar logs de Vercel Functions del action `enviar-mensaje` / `publicar-anuncio` por errores con prefijo `[enviarPush]`.
- Probable causa: alguna de las tres variables no se actualizó.

## Referencias

- ADR-0027 — Arquitectura push (decisión de NO usar Edge Functions).
- Spec: `docs/specs/push-notifications.md`.
- web-push library: <https://github.com/web-push-libs/web-push>
- VAPID RFC: <https://datatracker.ietf.org/doc/html/rfc8292>
