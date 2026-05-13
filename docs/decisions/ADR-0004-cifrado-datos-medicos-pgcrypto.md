# ADR-0004: Cifrado a nivel columna con pgcrypto en `info_medica_emergencia`

## Estado

`accepted`

**Fecha:** 2026-05-13
**Autores:** Iker Milla, claude-code
**Fase del proyecto:** Fase 2 — Entidades core

## Contexto

`info_medica_emergencia` guarda dos campos sensibles especialmente: `alergias_graves` y `notas_emergencia`. Son datos de menores con vida en juego (anafilaxia, autoinyectable de adrenalina, alergias por contacto a frutos secos…) y al mismo tiempo extremadamente útiles para los profes en una situación de urgencia. RGPD los clasifica como datos de salud, categoría especial: requieren medidas técnicas adicionales más allá de RLS.

Las medidas técnicas pueden ser:

1. Solo RLS aplicativa (lo que hace el resto del modelo).
2. Cifrado a nivel columna en la BD (los valores se almacenan ya cifrados y se descifran al leer con una clave que no vive en BD).
3. Cifrado a nivel columna + KMS externo (la clave vive en un servicio externo como AWS KMS / GCP KMS).
4. Tokenización: el campo guarda solo un token y el valor real vive en un vault externo.

Hay que elegir uno (o combinar).

## Opciones consideradas

### Opción A: Cifrado pgcrypto + clave en Supabase Vault (elegida)

`alergias_graves` y `notas_emergencia` son `BYTEA`. Se escriben via `set_info_medica_emergencia_cifrada(...)` que llama a `pgp_sym_encrypt(text, clave)` y se leen via `get_info_medica_emergencia(...)` que llama a `pgp_sym_decrypt`. La clave maestra vive en Supabase Vault como secreto con `name = 'medical_encryption_key'` y la lee la función con:

```sql
SELECT decrypted_secret INTO v_clave
FROM vault.decrypted_secrets
WHERE name = 'medical_encryption_key';
```

**Pros:**

- Defensa en profundidad: si un atacante consigue acceso de lectura al schema `public` sin pasar por RLS (e.g. via un backup, un superusuario comprometido a nivel de hosting), las columnas siguen cifradas.
- La clave no aparece en ningún `.env`, ni en variables de entorno de Vercel, ni en código. Vive solo en Supabase Vault.
- Las funciones SECURITY DEFINER incorporan la autorización (admin / profe del aula / tutor con permiso) y son el único punto de entrada a los datos cifrados.
- Rotación factible: una migración con `rotate_medical_key(nueva)` itera filas, descifra-con-vieja + cifra-con-nueva en una transacción.

**Contras:**

- pgcrypto vive en el schema `extensions` en Supabase, lo que obliga a ampliar el `search_path` de las funciones (ver `docs/dev-setup.md` y la migración `20260513214411_phase2_fix_pgcrypto_search_path.sql`).
- Si Supabase Vault sufre un incidente, los datos quedan inaccesibles temporalmente (mitigación: backup de la clave fuera de Vault en el gestor de contraseñas del responsable).
- Búsqueda full-text sobre los campos cifrados no es posible. Aceptable: nadie hace búsquedas globales sobre alergias.

### Opción B: Solo RLS, sin cifrado

Aceptar que RLS + auditoría son suficientes para datos médicos de menores.

**Pros:**

- Cero código de cifrado.
- Búsqueda y queries directas funcionan.

**Contras:**

- RGPD recomienda explícitamente cifrado para categorías especiales de datos. Un fallo de configuración RLS o un backup mal protegido filtraría datos médicos en texto plano.
- Inadmisible para un producto que se publica en abierto y maneja datos de menores.

### Opción C: pgcrypto + clave en variable de entorno

La clave en `MEDICAL_ENCRYPTION_KEY` del `.env.local` / Vercel.

**Pros:**

- Más simple operacionalmente.

**Contras:**

- La clave aparece en variables de entorno: cualquier dev/sysadmin que toque Vercel la ve.
- Sincronizar `app.medical_encryption_key` entre Vercel y Supabase requiere `ALTER DATABASE postgres SET ...`, **que Supabase managed NO permite ejecutar desde la migración** — descartado.
- La clave acaba en logs de plataforma si alguien hace `env`.

### Opción D: KMS externo (AWS KMS, GCP KMS)

La clave nunca toca Supabase. Las funciones la consultan en cada operación contra el KMS.

**Pros:**

- Máximo aislamiento.
- Rotación automatizada por el KMS.

**Contras:**

- Sobrediseño en Ola 1 (una escuela, decenas de niños).
- Coste fijo mensual + dependencia operativa adicional.
- Latencia añadida en cada lectura/escritura.
- No queda descartado para Ola 2 si NIDO escala a multi-tenant grande.

### Opción E: Tokenización con vault externo

El valor sensible vive en un servicio externo (Hashicorp Vault, Skyflow, etc.), la BD solo guarda un token referencial.

**Pros:**

- Cifrado fuera de la app.

**Contras:**

- Misma desventaja operativa que KMS.
- Cada query necesita un round-trip al vault.
- Sobrediseño para Ola 1.

## Decisión

**Se elige la Opción A: pgcrypto + Supabase Vault.**

Esta combinación da defensa en profundidad sin añadir infraestructura externa, encaja con la decisión de plataforma (Supabase managed) y reusa el mismo modelo que el resto de helpers SECURITY DEFINER (ver ADR-0002 y ADR-0007).

## Consecuencias

### Positivas

- Datos médicos cifrados en reposo a nivel columna. Un dump del schema `public` muestra `\x...` BYTEA, no texto.
- La clave vive en Vault, fuera de código y fuera de `.env`.
- Autorización embebida en las funciones (`set_*` y `get_*`) es testeable con tests RLS.
- El test `src/test/rls/cifrado.test.ts` verifica que un SELECT directo a `alergias_graves` devuelve BYTEA y que `get_*` lo descifra correctamente.

### Negativas

- pgcrypto vive en `extensions` → search_path obligatorio (documentado en `docs/dev-setup.md` y aplicado vía `ALTER FUNCTION ... SET search_path = public, extensions` en la migración `20260513214411_phase2_fix_pgcrypto_search_path.sql`).
- Si la clave se pierde, los datos cifrados son irrecuperables. **El responsable debe mantener un backup de la clave** fuera de Vault (gestor de contraseñas) — esto ya está hecho desde la fase de generación de la clave.
- Las funciones de cifrado tienen el contrato "NULL = preservar campo" en `set_info_medica_emergencia_cifrada`, lo que requiere documentar bien y que el cliente envíe NULL explícito en lugar de cadena vacía cuando no quiera tocar un campo.

### Neutras

- El flujo de la app SIEMPRE pasa por `set_*`/`get_*`. SELECT/INSERT directos quedan reservados para emergencias de soporte (con service role y auditoría manual).

## Plan de rotación de la clave maestra

Si en algún momento hay sospecha de compromiso de la clave o se cumple un calendario rotacional (Ola 2 fijará el periodo):

1. Generar nueva clave: `openssl rand -base64 48`.
2. Crear función `public.rotate_medical_key(p_new_key text)` que:
   - Lee la clave actual de Vault.
   - En una transacción, itera todas las filas de `info_medica_emergencia` y re-cifra `alergias_graves` y `notas_emergencia` con la nueva clave.
   - Si algún descifrado falla, ROLLBACK y aborta.
3. Una vez la función completa con éxito, el responsable actualiza el secreto `medical_encryption_key` en Supabase Vault con la nueva clave.
4. **Importante**: la función debe correr ANTES del cambio en Vault, porque mientras corre necesita descifrar con la clave vieja. Idealmente la función acepta `p_old_key` y `p_new_key` para no depender del orden temporal.
5. Esta función no se implementa en Fase 2 — se añade en una migración propia cuando llegue la primera rotación real.

## Plan de implementación

- [x] Función `_get_medical_key()` interna que lee Vault y falla con excepción explícita si falta.
- [x] Función `set_info_medica_emergencia_cifrada(...)` con autorización admin embebida.
- [x] Función `get_info_medica_emergencia(...)` con autorización admin/profe-del-aula/tutor-con-permiso embebida.
- [x] Bloque DO al final de la migración principal que invoca `_get_medical_key()` para abortar si Vault está vacío.
- [x] Migración correctiva `20260513214411_phase2_fix_pgcrypto_search_path.sql` que añade `extensions` al search_path.
- [x] Tests RLS: roundtrip + verificación BYTEA + NULL preserva.
- [ ] `rotate_medical_key` se implementará cuando se necesite (no en Fase 2).

## Verificación

- Test `src/test/rls/cifrado.test.ts` pasa:
  - SELECT directo devuelve `\x...` (BYTEA).
  - `set` + `get` roundtrip correctamente.
  - NULL en parámetros preserva valores existentes (`get_info_medica_emergencia` devuelve los valores anteriores tras un `set` con NULLs y un solo campo modificado).
- Bloque DO de la migración aborta si la clave no está en Vault (probado al fallar el primer push antes de configurar el secreto).

## Notas

- Supabase Vault usa libsodium internamente para cifrar los secretos en reposo. La clave maestra de Vault la gestiona Supabase, no nosotros.
- `pgp_sym_encrypt` produce salida no determinista (IV aleatorio), así que dos encriptaciones del mismo texto plano dan BYTEA distintos. Esto es deseable para evitar pattern matching, pero impide indexar la columna.

## Referencias

- Spec: `docs/specs/core-entities.md` (B15)
- Migración principal: `supabase/migrations/20260513202012_phase2_core_entities.sql`
- Migración correctiva search_path: `supabase/migrations/20260513214411_phase2_fix_pgcrypto_search_path.sql`
- Dev setup notes: `docs/dev-setup.md`
- ADR-0002 (helpers en `public.*`), ADR-0007 (recursión RLS).
