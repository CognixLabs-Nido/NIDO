# Diario de progreso — NIDO

## Fase 0 — Fundaciones

**Fecha inicio:** 2026-05-12
**Estado:** En curso

### Completado

- [x] Next.js 16 + TypeScript strict + Tailwind 4
- [x] Git inicializado, rama `feat/phase-0-foundations`, remote `CognixLabs-Nido/NIDO`
- [x] Identidad git: Iker Milla <jovimib+nido@gmail.com>
- [x] direnv configurado (`PROJECT_NAME=nido`, switch a cuenta `CognixLabs-Nido`)
- [x] Tooling: Husky, lint-staged, commitlint, Prettier, ESLint strict
- [x] Supabase: proyecto creado, linkeado (`ttroedkdgomfmohgojvg`), clientes server/client
- [x] next-intl: routing es/en/va, messages base
- [x] shadcn/ui: componentes base instalados
- [x] Vitest + Playwright configurados
- [x] Vercel Analytics (Sentry descartado — no gratuito; error tracking en Fase 11)
- [x] Estructura `/docs/` con templates ADR y spec
- [ ] GitHub Actions (CI/CD)
- [ ] README.md
- [ ] Vercel
- [ ] PR final + merge

### Decisiones

- **Sentry descartado**: no tiene plan gratuito suficiente. Se usará highlight.io o GlitchTip en Fase 11.
- **Next.js 16**: `create-next-app` instaló la versión 16.2.6 (breaking changes vs 15). Se mantiene.
