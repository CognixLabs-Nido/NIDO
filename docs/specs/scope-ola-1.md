# Alcance Ola 1 — NIDO

## 12 Fases secuenciales

| #    | Fase                                                | Estado       |
| ---- | --------------------------------------------------- | ------------ |
| 0    | Fundaciones (Next.js, Supabase, tooling, CI/CD)     | ✅ Cerrada   |
| 1    | Identidad y acceso (auth, invitaciones, roles)      | ✅ Cerrada   |
| 2    | Entidades core + RLS + audit log                    | ✅ Cerrada   |
| 3    | Agenda diaria + bienestar (lactancia D, check-in B) | ✅ Cerrada   |
| 4    | Asistencia y ausencias                              | ✅ Cerrada   |
| 4.5a | Calendario laboral del centro                       | 🚧 En curso  |
| 4.5b | Menú mensual + pase de lista comida                 | ⏳ Pendiente |
| 5    | Mensajería profe ↔ familia                          | ⏳ Pendiente |
| 6    | Recordatorios bidireccionales (E)                   | ⏳ Pendiente |
| 7    | Calendario y eventos                                | ⏳ Pendiente |
| 8    | Autorizaciones + firma digital                      | ⏳ Pendiente |
| 9    | Informes de evolución                               | ⏳ Pendiente |
| 10   | Fotos y publicaciones del aula                      | ⏳ Pendiente |
| 11   | Pulido final + producción                           | ⏳ Pendiente |

## Regla de avance

Cada fase termina con:

1. Tests Vitest en verde
2. Tests Playwright en verde
3. TypeScript sin errores
4. Deploy a producción (Vercel)
5. ADR escrito en `docs/decisions/`
6. Entrada en `docs/journey/progress.md`

No se avanza a la siguiente fase sin completar todos los puntos anteriores.

## Fuera del alcance Ola 1

- Facturación / Veri\*factu
- Fichaje de personal
- Pictogramas NEE
- IA
