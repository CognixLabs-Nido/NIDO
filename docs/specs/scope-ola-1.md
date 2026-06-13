# Alcance Ola 1 — NIDO

## Modelo de olas

El plan se organiza en tres olas **scope-driven** (no por fecha; el responsable controla el calendario):

- **Ola 1 — producto web completo y desplegable.** Es el alcance de este documento. Cierra cuando la app web cubre todo el ciclo de un centro y puede operar en producción con datos reales. **Ola 1 = el 100% de la FUNCIONALIDAD.** Ninguna funcionalidad core se difiere a Ola 2/3: si algo es funcional (un derecho RGPD, un flujo de usuario, una capacidad de gestión), va en Ola 1. Lo único que se difiere es lo que **no** es funcionalidad core: la app nativa (Ola 2) y las mejoras (Ola 3).
- **Ola 2 — app nativa (iOS + Android).** Reusa `packages/core` y el backend; añade **solo** lo que tiene sentido únicamente en nativo (offline-first real, push nativo, etc.). No es donde aterriza funcionalidad web pendiente.
- **Ola 3 — MEJORAS (no funcionalidad core).** Valor añadido sobre una base ya consolidada con datos reales: p. ej. **IA para redactar mensajes**, **IA para identificar niños en fotos**, y diferenciadores análogos. **No** es un cajón para diferir funcionalidad básica.

> El alcance de Ola 1 es **fijo**; las fechas las decide el responsable. No hay deadline externo.

## Fases secuenciales (build del producto web)

| #    | Fase                                                                      | Estado       |
| ---- | ------------------------------------------------------------------------- | ------------ |
| 0    | Fundaciones (Next.js, Supabase, tooling, CI/CD)                           | ✅ Cerrada   |
| 1    | Identidad y acceso (auth, invitaciones, roles)                            | ✅ Cerrada   |
| 2    | Entidades core + RLS + audit log                                          | ✅ Cerrada   |
| 3    | Agenda diaria + bienestar (lactancia D, check-in B)                       | ✅ Cerrada   |
| 4    | Asistencia y ausencias                                                    | ✅ Cerrada   |
| 4.5a | Calendario laboral del centro                                             | ✅ Cerrada   |
| 4.5b | Menú mensual + pase de lista comida                                       | ✅ Cerrada   |
| 5    | Mensajería profe ↔ familia + anuncios                                     | ✅ Cerrada   |
| 5.5  | Push notifications (transversal — ADR-0025/0027)                          | ✅ Cerrada   |
| 5.6  | Mensajería admin ↔ familia + ventana anulación 5 min                      | ✅ Cerrada   |
| 6    | Recordatorios bidireccionales (E)                                         | ✅ Cerrada   |
| 7    | Calendario + eventos + confirmaciones (**lean**)                          | ✅ Cerrada   |
| 7b   | Agenda de citas con invitados nominales + RSVP (ADR-0039)                 | ✅ Cerrada   |
| 8    | Autorizaciones + firma digital (ADR-0041)                                 | ✅ Cerrada   |
| 9    | Informes de evolución                                                     | ✅ Cerrada   |
| 10   | Fotos y publicaciones del aula                                            | ✅ Cerrada   |
| 11   | Pulido final + producción (incl. tolerancia básica offline PWA)           | ⏳ Pendiente |
| 12   | Funcionalidad pendiente post-F11 (la puebla el análisis de cierre de F11) | ⏳ Pendiente |

> **F12 — funcionalidad pendiente post-F11.** Sigue siendo **Ola 1** (Ola 1 = 100% de la funcionalidad; F12 es secuencial, no una ola posterior). Recoge funcionalidad core que aflore tras estabilizar producción en F11. El **análisis de cierre de F11 poblará F12**; arranca con un primer ítem ya identificado (ver "Backlog F12" abajo).

> **F7 queda lean**: solo calendario + eventos + confirmaciones de asistencia. La **reserva de franjas para tutorías** se mueve a **F12** (es funcionalidad, no una mejora → no va a Ola 3; ver "Backlog F12" abajo y `research-comparativa-nido.md`).

## Bloqueantes de Ola 1

Dos trabajos transversales son **bloqueantes** y no se ubican en la cola normal de fases:

- **Push-a-device (riesgo #1).** Item **temprano y bloqueante**: va **antes o junto a F7**, NO en F11. Es la capacidad de que la notificación salte en el dispositivo (no el badge in-app). La causa raíz de su fallo actual la diagnostica el responsable por separado; aquí solo queda registrado en el plan como prioridad.
- **Paquete RGPD — bloqueante ANTES de cargar el primer dato real.** Disparador: la primera familia/niño real en producción. Incluye:
  - Derecho al olvido funcional (anonimización/redacción, incl. `valores_antes` en `audit_log`).
  - Consentimiento de imagen de menores.
  - Registro de actividades de tratamiento (+ DPA con encargados).
  - ⚖️ **Least-privilege en supervisión de mensajería (admin).** La pestaña "Dirección" deja a la directora **leer** las conversaciones profe↔familia (solo lectura en la UI), pero la RLS todavía le permite **postear** en ellas (`es_admin` → `puede_participar_conversacion` → INSERT). Cerrarlo a nivel RLS con una migración aparte (p. ej. excluir a admin del INSERT en `profe_familia`, dejándole solo SELECT). Origen: reparación de Mensajería (PR #66), ver `docs/journey/progress.md`.
  - ⚖️ **Transparencia del acceso de dirección a la mensajería privada.** La supervisión expone a la directora **todos** los mensajes privados familia↔profe del centro → debe constar en el **aviso de privacidad** y en el **Registro de Actividades de Tratamiento (RAT)**. Origen: reparación de Mensajería (PR #66).

## Items promovidos a Ola 1 (modelo de olas nuevo)

Subieron a Ola 1 desde la doc previa. Se ubicarán en su fase cuando toque — **no se inventan fases nuevas** aquí:

- **Medicación con doble confirmación** (antes Ola 2).
- **Onboarding guiado** para usuarios no-tech (antes Ola 2).
- **PIN de acceso para tablets compartidas** (tablet del aula compartida; antes Ola 2).
- **Badge de invitaciones pendientes de la Agenda** (AG-14). Contador en el nav de
  `/agenda` (RPC, patrón Recordatorios; sin push/Realtime). Va **dentro del PR de la
  Agenda** (#51). Ver `agenda-citas.md`.
- **Inicio: resumen de la semana** (AG-15) — eventos del Calendario Escolar + citas
  de la Agenda (día + semana, por rol). Sustituye el widget "Próximos días cerrados".
  **Pieza propia tras el core de la Agenda** (cruza F7 + Agenda; recupera el Dominio
  C "Inicio Hoy" de f7a). Ver `agenda-citas.md`.

## Backlog F12 (funcionalidad pendiente post-F11)

F12 es la fase que recoge la **funcionalidad core** que quede pendiente o aflore tras
estabilizar producción en F11. **Sigue siendo Ola 1** (secuencial, no ola posterior). El
**análisis de cierre de F11 poblará esta lista**; hoy arranca con un ítem ya identificado:

- **Tutorías — reserva de franjas formal con la profesora.** Hoy ya existe una **vía
  informal**: la familia y la profe acuerdan una tutoría por **mensajería** y/o la cuelgan
  en la **Agenda/Calendario** (citas de F7b, `reunion_familia`). F12 añadiría la **capa de
  reserva formal encima** —franjas ofertadas por la profe/centro, autoservicio de reserva
  por la familia, confirmación— **no desde cero** (reusa Agenda + mensajería existentes).
  Antes estaba mal etiquetada como Ola 3; es funcionalidad, por eso baja a F12 (Ola 1).

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
