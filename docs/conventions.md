# Convenciones de código — NIDO

## Nombres de archivos y carpetas

| Tipo                | Convención          | Ejemplo                |
| ------------------- | ------------------- | ---------------------- |
| Componentes React   | PascalCase          | `AgendaForm.tsx`       |
| Hooks               | camelCase con `use` | `useAgenda.ts`         |
| Utilities / helpers | kebab-case          | `format-date.ts`       |
| Carpetas            | kebab-case          | `agenda-diaria/`       |
| Rutas Next.js       | kebab-case          | `app/[locale]/agenda/` |
| Tablas BD           | plural snake_case   | `agendas_diarias`      |

## TypeScript

- `strict: true` siempre. Sin `any`, sin excepciones.
- Zod schemas como fuente de verdad de tipos: `type X = z.infer<typeof XSchema>`.
- Imports ordenados: external → `@/...` → relative.
- **Tipos de la base: se importan de `@/types/db`.** `src/types/database.ts` es la salida de
  `npm run db:types` (desde producción) y **no se toca a mano**: la CI lo regenera contra la base
  efímera y, si difiere de lo commiteado, da rojo (`scripts/ci/comparar-tipos.mjs`). Lo que el
  generador no sabe va en `src/types/db.ts`, encima: la nulabilidad de las columnas de las funciones
  `RETURNS TABLE` (todas `| null` salvo las que su cuerpo garantiza, con su motivo), los argumentos
  que aceptan NULL a propósito y las columnas generadas (`?: never`). Una función `RETURNS TABLE`
  nueva entra en `FUNCIONES_RETURNS_TABLE` o la CI se pone roja (`tipos-overlay.rls.test.ts`).
  Importar `@/types/database` fuera de `db.ts` lo para el lint.

## Componentes

- Server Components por defecto.
- `'use client'` solo cuando sea imprescindible (interactividad, hooks de estado).
- Nunca `useEffect` con fetch — usar Server Components o TanStack Query.

## Mutaciones

- Server Actions para todas las mutaciones (no API routes salvo webhooks).
- Patrón Result: `{ success: true, data } | { success: false, error }`.
- Nunca `throw` visible al usuario — capturar y devolver en Result.

## Internacionalización

- Todo string visible al usuario va en `messages/{locale}.json`.
- Cero strings hardcoded en JSX.
- Claves en formato `namespace.key` (ej. `agenda.titulo`).

## Logging

- `console.log` prohibido en producción.
- Logger centralizado en `src/shared/lib/logger.ts`.
- Nunca loggear PII (nombres, emails, datos médicos).
- `logger.error` además envía el error a Sentry (ADR-0056). La limpieza quita los datos personales reconocibles (emails, DNI, teléfonos, IBAN, identificadores, campos con nombre de dato personal), pero **un nombre propio en un texto libre no tiene patrón**: no metas nombres en mensajes de error.

## Idioma

- Specs, comentarios y documentación: **español**.
- Código (nombres de variables, funciones, tipos, rutas): **inglés**.
