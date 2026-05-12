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

## Idioma

- Specs, comentarios y documentación: **español**.
- Código (nombres de variables, funciones, tipos, rutas): **inglés**.
