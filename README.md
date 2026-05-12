# NIDO

**Agenda digital para escuelas infantiles 0-3 años.** Trilingüe (es/en/va). Construida en abierto.

Una sola escuela inicialmente (ANAIA, Valencia), arquitectura preparada para multi-centro.

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
cp .env.example .env.local
# Rellena .env.local con los valores reales (ver docs/dev-setup.md)

# 3. Dependencias
npm install

# 4. Dev server
npm run dev
# → http://localhost:3000
```

---

## Comandos

| Comando             | Descripción              |
| ------------------- | ------------------------ |
| `npm run dev`       | Servidor de desarrollo   |
| `npm run build`     | Build de producción      |
| `npm test`          | Tests unitarios (Vitest) |
| `npm run test:e2e`  | Tests E2E (Playwright)   |
| `npm run typecheck` | Comprobación de tipos    |
| `npm run lint`      | Linting                  |
| `npm run format`    | Formateo con Prettier    |

---

## Documentación

- [Convenciones de código](docs/conventions.md)
- [Modelo de datos](docs/architecture/data-model.md)
- [Políticas RLS](docs/architecture/rls-policies.md)
- [Alcance Ola 1](docs/specs/scope-ola-1.md)
- [Diario de progreso](docs/journey/progress.md)
- [Visión del proyecto](docs/vision-why.md)

---

## Licencia

Propietario. Software en desarrollo activo.
