# ADR-0008: Sistema de diseño visual NIDO

## Estado

`accepted`

**Fecha:** 2026-05-14
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 2.5 — Sistema de diseño visual

## Contexto

Tras cerrar Fase 2 (Entidades core + RLS + audit log), NIDO era funcionalmente correcto pero estéticamente plano: tokens shadcn por defecto en `oklch` neutros (blanco/negro/grises), tipografía Geist, cero identidad de marca. Las próximas fases incorporan flujos visualmente críticos para una escuela infantil (agenda diaria con bienestar emocional B, lactancia D, fotos, mensajería). Si se construyen sobre la pintura neutra, cada feature arrastra el aspecto plano y refactorizar luego es caro.

Decidimos abrir una fase 2.5 corta para aterrizar la identidad **antes** de seguir con features funcionales, de modo que el resto del producto nazca con la cara final.

Cuestiones a decidir:

1. **Paleta**: ¿qué tokens de color y cómo se mapean a los semánticos de shadcn?
2. **Tipografía**: ¿qué fuente principal y qué escala?
3. **Logo**: el responsable proporcionó un PNG 1024×1024 con fondo negro; el vectorial definitivo llegará más adelante. ¿Cómo lo integramos hoy sin condicionar el reemplazo futuro?
4. **Variantes destructive**: el rojo `oklch` por defecto se siente agresivo y choca con la paleta cálida; ¿cómo manejar acciones reversibles vs irreversibles?
5. **Componentes utilitarios faltantes** (empty states, skeletons, loading con marca): ¿se hacen ahora o más tarde?

## Opciones consideradas

### Opción A: Postergar hasta Fase 11 (pulido final)

Mantener tokens shadcn por defecto y seguir con Fase 3 (Agenda diaria). Re-tematizar al final como parte del pulido.

**Pros:**

- Llega antes la primera versión funcional.
- Permite descubrir más necesidades antes de cristalizar el sistema (escala tipográfica, micropatrones).

**Contras:**

- Cada feature construida con la pintura neutra arrastra el aspecto plano y obliga a refactor en Fase 11.
- Demos intermedias para stakeholders quedan visualmente pobres.
- Decisiones tomadas con paleta neutra (contrastes, tamaños) pueden no encajar con la paleta final → re-trabajo silencioso.

### Opción B: Pintar tokens y dejar componentes / pantallas para más adelante

Sólo definir paleta + tipografía + sombras + radios. No tocar componentes ni pantallas todavía.

**Pros:**

- Trabajo menor, alcance limitado.
- Las próximas pantallas heredan los nuevos tokens automáticamente.

**Contras:**

- Pantallas existentes (auth, dashboards, listas) siguen visualmente desalineadas hasta Fase 11.
- Falta de componentes utilitarios (EmptyState, skeletons) sigue obligando a inventar UI ad hoc.

### Opción C: Sistema de diseño completo + repintar todo lo existente (elegida)

Definir tokens + tipografía + radios + sombras + microcomponentes utilitarios y aplicar el sistema a **todas** las pantallas existentes (auth, dashboards admin/teacher/family, listas, wizards, detalle, legal). Documentar pantalla por pantalla en spec. ADR + entrada de progress.

**Pros:**

- Identidad consistente desde la primera demo en preview, sin re-trabajo futuro.
- Componentes utilitarios (EmptyState, LoadingSkeleton, BrandedLoading, Logo\*) listos para las próximas fases.
- Spec + ADR documentan criterios de uso (cuándo `destructive` soft vs strong, cuándo aplica el prop `items` en `Select`, etc.).

**Contras:**

- Bloquea ~1 semana de features funcionales.
- Riesgo de pintar sin que el sistema haya tenido tiempo de probarse en uso real → posibles ajustes en Fase 11.

## Decisión

**Se elige la Opción C: sistema de diseño completo + propagación a todas las pantallas existentes.**

Las razones concretas:

- El producto es para escuelas infantiles 0-3, donde la identidad cálida no es decorativa sino un proxy de confianza para las familias. Una demo intermedia con paleta neutra rompe esa señal.
- Los componentes utilitarios (EmptyState, LoadingSkeleton, BrandedLoading) son los suficientemente genéricos como para no acumular deuda si los hacemos hoy.
- La spec captura criterios de uso, no sólo estilos: futuros desarrollos sobre el sistema tienen instrucciones claras.

Detalles de las decisiones tomadas dentro del sistema:

1. **Paleta**: 7 colores (primary, accent-warm, accent-yellow, success, coral, info, neutral) en HSL, derivados del logo del producto (chick + nest + decoraciones). Se mapean a los tokens semánticos de shadcn vía variables CSS en `globals.css`. El semántico `--primary` se ata a `primary-600` (no a `primary-500`) para garantizar ≥4.5:1 sobre blanco; `primary-500` sigue disponible vía `bg-primary-500` para badges y decoraciones donde el contraste no es crítico.

2. **Tipografía**: Plus Jakarta Sans (Google Fonts) vía `next/font/google` con pesos 400-800 y `display: 'swap'`. Escala custom `display / h1 / h2 / h3` declarada en `globals.css` como utility classes; body y small mantienen los tamaños de Tailwind.

3. **Logo**: se procesa el PNG source aplicando un threshold de luminancia para convertir el fondo negro en transparente (`scripts/process-logos.mjs` con `sharp`). El script es **idempotente** (misma source + misma versión de sharp → bytes idénticos, verificado con md5sum). Los outputs (`nido-logo-full|wordmark|mark.png`, `icon-{192,512}.png`, `src/app/icon.png`, `src/app/apple-icon.png`) están commiteados. `sharp` es devDependency, no entra en bundle. Cuando llegue el SVG vectorial definitivo, basta sustituir los archivos en `public/brand/` o reescribir el body de los componentes `<Logo />`, `<LogoWordmark />`, `<LogoMark />` con el SVG inline; el resto de la app no se entera.

4. **Destructive en dos variantes**:
   - `destructive` (soft, `bg-coral-100 text-coral-700`): acciones reversibles o contextuales (quitar vínculo, archivar, cancelar invitación, dar de baja una matrícula). El estado se conserva como dato.
   - `destructive-strong` (sólido, `bg-coral-500 text-white`): acciones irreversibles dentro de dialogs de confirmación (borrar niño, borrar usuario, vaciar tabla). Coral se usa en vez del rojo `oklch` del default porque encaja con la paleta cálida sin perder semántica de alarma.

5. **Componentes utilitarios**: `EmptyState`, `LoadingSkeleton` (variantes card/row/form/text), `BrandedLoading`, `Logo`, `LogoWordmark`, `LogoMark`, `SidebarNav`, `AuthShell`, `LegalShell`. Todos en `src/shared/components/`.

## Consecuencias

### Positivas

- Identidad NIDO consistente en todas las pantallas existentes (auth, dashboards, listas, wizards, detalles, legal).
- Componentes utilitarios reutilizables listos para Fase 3+ — agenda, mensajería, fotos no tienen que inventar empty states ni loadings.
- Tokens semánticos shadcn correctamente atados al `primary-600` aseguran WCAG AA en botones y links sobre blanco sin ajustes por pantalla.
- Coral suave como destructive reduce la fricción visual sin perder claridad para acciones críticas (que usan `destructive-strong`).

### Negativas

- 1 fase intercalada antes de Fase 3 — retrasa ~1 semana las features funcionales.
- Logo en PNG con threshold tiene rebabas si el source cambia mucho; mantenerlo idempotente exige no hacer ajustes manuales sobre los outputs.
- Dark mode queda pendiente para Ola 2 (la clase `.dark` está reservada en `globals.css` vacía).
- Plus Jakarta Sans descarga ~5 weights woff2 (~85 KB total); compensado por `display: swap` y subset latín.

### Neutras

- A partir de ahora, cualquier color hardcoded (`bg-blue-500`, `text-red-600`, etc.) en componentes es un antipatrón; usar tokens (`bg-primary`, `text-coral-700`).
- Los `<Card>` ahora tienen `border + shadow-md` por defecto; pantallas que añadan `border` o `shadow-*` manualmente deben revisar duplicación.
- Sidebars con nav horizontal en mobile (no drawer): suficiente para Ola 1, drawer (Sheet) se valora si el número de items crece.

## Plan de implementación

- [x] Spec `docs/specs/design-system.md` con paleta, tipografía, radios, sombras, componentes y pantalla por pantalla.
- [x] Tokens HSL en `globals.css` mapeados a semánticos shadcn dentro de `@theme inline`.
- [x] Plus Jakarta Sans vía `next/font/google` en `src/app/[locale]/layout.tsx`.
- [x] Script `scripts/process-logos.mjs` idempotente + outputs commiteados en `public/brand/` y `src/app/`.
- [x] Componentes shadcn adaptados: Button (con `destructive-strong`), Card, Badge (con success/warning/info/warm), Dialog, Tabs, Table, Sonner.
- [x] Componentes nuevos: Logo / LogoWordmark / LogoMark / EmptyState / LoadingSkeleton / BrandedLoading / SidebarNav / AuthShell / LegalShell.
- [x] Repintado de pantallas: login, forgot-password, reset-password, invitation/[token], invitation/expired, forbidden, privacy, terms.
- [x] Repintado de layouts admin/teacher/family con sidebar fija + header mobile.
- [x] Repintado de dashboards admin (cards de stats con icon tile), teacher (cards de aulas con icon tile + cohortes Badge warm), family (cards de niños con avatar primary).
- [x] Repintado de listas admin (centro, cursos, aulas, ninos, audit) con tablas envueltas en Card + EmptyState + variantes semánticas de Badge.
- [x] Repintado de wizard `/admin/ninos/nuevo` con barra de progreso visual.
- [x] Repintado de detalle `/admin/ninos/[id]` con header avatar + tabs con icono + EmptyState por tab vacío.
- [x] Repintado de `teacher/aula/[id]` y `family/nino/[id]`.
- [x] i18n trilingüe (es/en/va) para los nuevos strings (greeting, subtitle, empty descriptions, sidebar nav, wizard progress).

## Verificación

- `npm run typecheck` verde.
- `npm run lint` verde.
- `npm test` verde (no se rompe ninguno de los 36 tests RLS/audit/cifrado/unit existentes).
- `npm run test:e2e` verde para `admin-crud-flow.spec.ts` y `profe-aislamiento.spec.ts`: la lógica de los flows no ha cambiado.
- `npm run build` verde — generación estática y server components compilan.
- Lighthouse en `/es/login` ≥ 90 accesibilidad. axe-core sin violations en login, dashboards y listas (verificación manual durante checkpoints).
- Smoke visual en preview de Vercel: login, dashboards de los 3 roles, listas admin, wizard, detalle, teacher/aula, family/nino.

## Notas

Source del logo definitivo va en `public/brand/source/nido-logo-source.png`. Cuando llegue el SVG vectorial:

1. Sustituir los archivos en `public/brand/` por las versiones vectoriales (mismo nombre, extensión `.svg` o `.png` según convenga para `next/image`).
2. Si el SVG necesita props específicas (color, currentColor, etc.), reescribir el body de `<Logo />`/`<LogoWordmark />`/`<LogoMark />` en `src/shared/components/brand/` para renderizar SVG inline en lugar de `next/image`.
3. Re-ejecutar `node scripts/process-logos.mjs` si se mantienen los PNGs como source (genera favicon e iconos PWA desde el mark).
4. Actualizar este ADR con la nueva versión y la fecha del cambio.

## Referencias

- Spec: `/docs/specs/design-system.md`
- ADRs relacionados:
  - ADR-0002 (helpers RLS en `public.*`) — sin impacto.
  - ADR-0007 (recursión RLS) — sin impacto.
- Tailwind CSS 4 docs (theming via `@theme inline`).
- shadcn/ui docs (theming, customización).
- `@base-ui/react/select` resolveSelectedLabel (motivo por el que el prop `items` es obligatorio en Selects con value no human-readable; documentado en `docs/dev-setup.md`).
