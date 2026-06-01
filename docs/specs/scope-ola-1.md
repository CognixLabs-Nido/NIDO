# Alcance Ola 1 — NIDO

## Modelo de olas

El plan se organiza en tres olas **scope-driven** (no por fecha; el responsable controla el calendario):

- **Ola 1 — producto web completo y desplegable.** Es el alcance de este documento. Cierra cuando la app web cubre todo el ciclo de un centro y puede operar en producción con datos reales.
- **Ola 2 — app nativa (iOS + Android).** Reusa `packages/core` y el backend; añade lo que solo tiene sentido en nativo (offline-first real, push nativo, etc.).
- **Ola 3 — mejoras y diferenciación.** Features de valor añadido sobre una base ya consolidada con datos reales.

> El alcance de Ola 1 es **fijo**; las fechas las decide el responsable. No hay deadline externo.

## Fases secuenciales (build del producto web)

| #    | Fase                                                            | Estado       |
| ---- | --------------------------------------------------------------- | ------------ |
| 0    | Fundaciones (Next.js, Supabase, tooling, CI/CD)                 | ✅ Cerrada   |
| 1    | Identidad y acceso (auth, invitaciones, roles)                  | ✅ Cerrada   |
| 2    | Entidades core + RLS + audit log                                | ✅ Cerrada   |
| 3    | Agenda diaria + bienestar (lactancia D, check-in B)             | ✅ Cerrada   |
| 4    | Asistencia y ausencias                                          | ✅ Cerrada   |
| 4.5a | Calendario laboral del centro                                   | ✅ Cerrada   |
| 4.5b | Menú mensual + pase de lista comida                             | ✅ Cerrada   |
| 5    | Mensajería profe ↔ familia + anuncios                           | ✅ Cerrada   |
| 5.5  | Push notifications (transversal — ADR-0025/0027)                | ✅ Cerrada   |
| 5.6  | Mensajería admin ↔ familia + ventana anulación 5 min            | ✅ Cerrada   |
| 6    | Recordatorios bidireccionales (E)                               | ✅ Cerrada   |
| 7    | Calendario + eventos + confirmaciones (**lean**)                | ⏳ Pendiente |
| 8    | Autorizaciones + firma digital                                  | ⏳ Pendiente |
| 9    | Informes de evolución                                           | ⏳ Pendiente |
| 10   | Fotos y publicaciones del aula                                  | ⏳ Pendiente |
| 11   | Pulido final + producción (incl. tolerancia básica offline PWA) | ⏳ Pendiente |

> **F7 queda lean**: solo calendario + eventos + confirmaciones de asistencia. La **reserva de franjas para tutorías** se mueve a **Ola 3** (ver `research-comparativa-nido.md`).

## Bloqueantes de Ola 1

Dos trabajos transversales son **bloqueantes** y no se ubican en la cola normal de fases:

- **Push-a-device (riesgo #1).** Item **temprano y bloqueante**: va **antes o junto a F7**, NO en F11. Es la capacidad de que la notificación salte en el dispositivo (no el badge in-app). La causa raíz de su fallo actual la diagnostica el responsable por separado; aquí solo queda registrado en el plan como prioridad.
- **Paquete RGPD — bloqueante ANTES de cargar el primer dato real.** Disparador: la primera familia/niño real en producción. Incluye:
  - Derecho al olvido funcional (anonimización/redacción, incl. `valores_antes` en `audit_log`).
  - Consentimiento de imagen de menores.
  - Registro de actividades de tratamiento (+ DPA con encargados).

## Items promovidos a Ola 1 (modelo de olas nuevo)

Subieron a Ola 1 desde la doc previa. Se ubicarán en su fase cuando toque — **no se inventan fases nuevas** aquí:

- **Medicación con doble confirmación** (antes Ola 2).
- **Onboarding guiado** para usuarios no-tech (antes Ola 2).
- **PIN de acceso para tablets compartidas** (tablet del aula compartida; antes Ola 2).

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
- **Menú en PDF/imagen** — descartado (redundante con los menús estructurados de F4.5b); si reaparece, sería Ola 3.
- **App nativa** → Ola 2. **Offline-first real** → Ola 2 (en Ola 1 solo tolerancia básica PWA en F11).
