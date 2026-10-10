# NIDO

**Agenda digital para escuelas infantiles 0-3 años.** Trilingüe (es/en/va). Construida en abierto.

Una sola escuela inicialmente (ANAIA, Valencia), arquitectura preparada para multi-centro.

**Estado (2026-10-10):** en producción (Vercel + Supabase). Las fases 0–10 de Ola 1 están cerradas; F11 (pulido final y producción) y F12 (funcionalidad pendiente) están en curso. El detalle está en el [diario de progreso](docs/journey/progress.md) y en el [alcance de Ola 1](docs/specs/scope-ola-1.md).

---

## Stack

Next.js 16 · TypeScript strict · React 19 · Tailwind 4 · shadcn/ui · Supabase · TanStack Query · React Hook Form + Zod · next-intl · Vitest + Playwright · Vercel

---

## Arrancar en local

```bash
# 1. Clonar
git clone https://github.com/CognixLabs-Nido/NIDO.git
cd NIDO

# 2. Credenciales
# Crea .env.local con las variables de docs/dev-setup.md («Variables de entorno»)

# 3. Dependencias
npm install

# 4. Dev server
npm run dev
# → http://localhost:3000
```

---

## Comandos

| Comando                | Descripción                                  |
| ---------------------- | -------------------------------------------- |
| `npm run dev`          | Servidor de desarrollo                       |
| `npm run build`        | Build de producción                          |
| `npm test`             | Tests unitarios (Vitest)                     |
| `npm run test:rls`     | Suite RLS + audit (necesita una BD Supabase) |
| `npm run test:e2e`     | Tests E2E (Playwright)                       |
| `npm run typecheck`    | Comprobación de tipos                        |
| `npm run lint`         | Linting                                      |
| `npm run format`       | Formateo con Prettier                        |
| `npm run format:check` | Comprobación de formato (la que corre la CI) |

---

## Documentación

- [Puesta en marcha en local](docs/dev-setup.md)
- [Convenciones de código](docs/conventions.md)
- [Modelo de datos](docs/architecture/data-model.md)
- [Políticas RLS](docs/architecture/rls-policies.md)
- [Alcance Ola 1](docs/specs/scope-ola-1.md)
- [Decisiones de arquitectura (ADRs)](docs/decisions/README.md)
- [Pendientes y deuda técnica](docs/follow-ups.md)
- [Diario de progreso](docs/journey/progress.md)
- [Visión del proyecto](docs/vision-why.md)

---

## Licencia

Propietario. Software en desarrollo activo.
