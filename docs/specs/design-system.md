---
feature: design-system
wave: 1
phase: 2.5
status: draft
priority: high
last_updated: 2026-05-14
related_adrs: [ADR-0008]
related_specs: [auth, core-entities]
---

# Spec — Sistema de diseño visual NIDO

## Resumen ejecutivo

Personalización visual completa de NIDO antes de continuar con features funcionales. Esta fase define la identidad de marca (paleta, tipografía, logo, sombras, radios), aterriza los componentes shadcn/ui sobre esa identidad y rediseña todas las pantallas existentes (auth, dashboards admin/profe/familia, listas, formularios) para que el resto del producto se construya ya con la cara final.

## Contexto

Hasta hoy la app es funcional pero estéticamente plana: colores `oklch` neutros (esencialmente blanco + negro + grises) heredados de los defaults de shadcn/ui. El producto tiene cuatro fases mergeadas (Fundaciones, Identidad, Core, Hotfixes) y va a entrar en flujos visualmente críticos (agenda diaria, fotos, mensajería) que necesitan una identidad cariñosa, cercana y profesional — coherente con el tipo de centro infantil 0-3 al que va dirigido.

La marca ya tiene logo (PNG con polluelo en un nido, "NiDO" en azul gradiente, tagline "Agenda Infantil 0-3 Años"), del que se extraen los colores. El logo definitivo en vectorial llegará más adelante; mientras tanto se procesa el PNG para tener una versión usable con fondo transparente.

## Decisiones cerradas (no revisar)

- Modo único: **light mode**. Dark mode se valora en Ola 2.
- Tipografía: **Plus Jakarta Sans** (Google Fonts), pesos 400, 500, 600, 700, 800. Cargada vía `next/font/google`.
- Estilo: **"Soft & Rounded"** — `rounded-2xl` cards, `rounded-xl` botones, sombras suaves, colores saturados pero no estridentes.
- Logo: PNGs en `public/brand/` procesados a fondo transparente. Versiones: full, wordmark, mark. Favicon y manifest a partir del mark.
- Cero colores hardcoded en componentes (`bg-blue-500` prohibido): todo usa tokens semánticos (`bg-primary`, `text-foreground`, etc.) o tokens de paleta (`bg-accent-warm-100`).

## User stories

- US-DS-01: Como usuario de cualquier rol, quiero que la app refleje una identidad cálida y cercana desde el primer momento (login) para confiar en el producto.
- US-DS-02: Como admin/profe/tutor, quiero que los textos sean legibles a tamaños cómodos en móvil y desktop para no forzar la vista.
- US-DS-03: Como persona con baja visión o daltonismo, quiero que la interfaz cumpla WCAG AA y que el color no sea el único indicador de estado.
- US-DS-04: Como desarrollador del proyecto, quiero un set de tokens estable y un par de componentes utilitarios (EmptyState, LoadingSkeleton) para no inventar UI cada vez que aparece un estado nuevo.
- US-DS-05: Como responsable de marca, quiero un mapa claro de dónde aparece el logo y cómo se comporta en cada pantalla para garantizar consistencia.

## Alcance

**Dentro:**

- Paleta de colores completa (primary, accent-warm, accent-yellow, success, coral, info, neutral) en variables CSS sobre `globals.css`.
- Mapeo de paleta a tokens semánticos shadcn (`background`, `foreground`, `card`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar-*`, `chart-*`).
- Carga de Plus Jakarta Sans vía `next/font/google` y escala tipográfica documentada.
- Logos procesados (PNG con fondo transparente) en `public/brand/`. Componentes `<Logo />`, `<LogoMark />`, `<LogoWordmark />`.
- Favicon e iconos PWA basados en el mark.
- Adaptación de los 13 componentes shadcn ya instalados (Button, Card, Input, Select, Textarea, Badge, Form, Label, Dialog, Tabs, Table, Sonner toast, Checkbox).
- Nuevos componentes: `<EmptyState />`, `<LoadingSkeleton />` (variantes Table, Card, Form), `<BrandedLoading />`.
- Rediseño de todas las pantallas existentes listadas en la sección "Pantalla por pantalla".
- ADR-0008 documentando paleta + tipografía + decisiones de logo (incluyendo plan de sustitución por vectorial).

**Fuera (no se hace aquí):**

- Dark mode. La clase `.dark` queda preparada (existe, vacía) para Ola 2.
- Tematizado configurable por centro (logos / colores por escuela): se descarta por simplicidad; ANAIA es el centro inicial y NIDO es la marca del producto.
- Animaciones complejas o ilustraciones decorativas más allá del logo. Microinteracciones (hover, focus, transitions) sí.
- Refactor estructural de carpetas o componentes: solo se tocan estilos, no la lógica.
- Sustitución del logo PNG por SVG vectorial: se difiere hasta que llegue la versión definitiva. El plan de migración va en ADR-0008.

## Paleta de colores

Las variables CSS se escriben en HSL para que las variantes con transparencia (`bg-primary/20`) funcionen con la sintaxis `color-mix`. Cada color tiene 10 variantes salvo `coral` e `info` que tienen 5 (uso puntual).

### Primary (azul NiDO)

Extraído del wordmark "NiDO" del logo (azul gradiente medio).

| Token           | HSL         | HEX     | Uso recomendado                                   |
| --------------- | ----------- | ------- | ------------------------------------------------- |
| `--primary-50`  | 208 80% 97% | #F1F7FD | Fondos sutiles de zonas primary (banners, badges) |
| `--primary-100` | 208 80% 93% | #DCEAF9 | Hover sobre fondos `primary-50`                   |
| `--primary-200` | 208 75% 85% | #B7D4F1 | Bordes y separadores de zonas primary             |
| `--primary-300` | 208 75% 75% | #8BBAE7 | Iconos secundarios sobre primary                  |
| `--primary-400` | 208 75% 67% | #6BA8E2 | Estados hover/focus de botones primary            |
| `--primary-500` | 208 75% 58% | #4A95DC | **Base** — botones primary, links, headers        |
| `--primary-600` | 208 75% 48% | #2675BC | Hover de botones primary 500                      |
| `--primary-700` | 208 75% 38% | #1D5B95 | Texto sobre fondos claros                         |
| `--primary-800` | 208 70% 30% | #19497A | Texto enfático sobre fondos claros                |
| `--primary-900` | 208 65% 22% | #143657 | Headings sobre fondos claros (alt al neutral-900) |

### Accent warm (naranja terracota nido)

Extraído del nido del logo (madera anaranjada). Para destacados cálidos, callouts, badges informativos no urgentes.

| Token               | HSL        | HEX     | Uso recomendado                        |
| ------------------- | ---------- | ------- | -------------------------------------- |
| `--accent-warm-50`  | 25 85% 97% | #FDF3EB | Backgrounds suaves (cards destacadas)  |
| `--accent-warm-100` | 25 80% 92% | #FBE0CB | Sidebar item activo, hover items       |
| `--accent-warm-200` | 25 80% 84% | #F8C49C | Bordes de badges warm                  |
| `--accent-warm-300` | 25 80% 74% | #F4A86E | Iconos warm                            |
| `--accent-warm-400` | 25 78% 65% | #EE9550 | Estados hover                          |
| `--accent-warm-500` | 25 78% 55% | #E68645 | **Base** — badges, highlights          |
| `--accent-warm-600` | 25 78% 45% | #C46B25 | Texto sobre fondos accent-warm-50/100  |
| `--accent-warm-700` | 25 75% 36% | #9A551D | Headings de secciones warm             |
| `--accent-warm-800` | 25 70% 28% | #794317 | Texto sobre fondos accent-warm-100/200 |
| `--accent-warm-900` | 25 65% 20% | #56300E | Reservado                              |

### Accent yellow (amarillo polluelo)

Extraído del cuerpo del polluelo. Para highlights energéticos y destacados positivos (logros, eventos festivos).

| Token                 | HSL         | HEX     | Uso recomendado                       |
| --------------------- | ----------- | ------- | ------------------------------------- |
| `--accent-yellow-50`  | 46 100% 96% | #FFFAEA | Fondos celebrativos                   |
| `--accent-yellow-100` | 46 100% 90% | #FFF0C9 | Backgrounds de tooltips/popovers warm |
| `--accent-yellow-200` | 46 100% 82% | #FFE4A0 | Bordes                                |
| `--accent-yellow-300` | 46 95% 73%  | #FFD675 | Iconos                                |
| `--accent-yellow-400` | 46 95% 65%  | #FFCC56 | Hover de badges yellow                |
| `--accent-yellow-500` | 46 95% 58%  | #F4BC2C | **Base** — badge warning / highlight  |
| `--accent-yellow-600` | 45 90% 48%  | #DD9D0C | Hover de botones yellow               |
| `--accent-yellow-700` | 43 88% 38%  | #B57E0B | Texto sobre fondos yellow             |
| `--accent-yellow-800` | 40 85% 30%  | #8C5F0E | Reservado                             |
| `--accent-yellow-900` | 38 80% 22%  | #66440F | Reservado                             |

### Success (verde estrella)

Extraído de la estrellita del logo. Para confirmaciones, estados positivos, badges "Listo / Hecho / Activo".

| Token           | HSL         | HEX     | Uso recomendado                             |
| --------------- | ----------- | ------- | ------------------------------------------- |
| `--success-50`  | 115 60% 96% | #ECF9E8 | Background de mensajes de éxito             |
| `--success-100` | 115 60% 90% | #CFEFC4 | Badges success light                        |
| `--success-200` | 115 55% 80% | #A8E093 | Bordes                                      |
| `--success-300` | 115 55% 68% | #79CC5D | Iconos check                                |
| `--success-400` | 115 55% 58% | #59BC3B | Hover                                       |
| `--success-500` | 115 52% 50% | #4FC23A | **Base** — botones success, badges "Activo" |
| `--success-600` | 115 55% 40% | #3FA52C | Hover de botones success                    |
| `--success-700` | 115 55% 32% | #338522 | Texto sobre fondos success-50/100           |
| `--success-800` | 115 50% 24% | #28681B | Reservado                                   |
| `--success-900` | 115 45% 18% | #1E4D15 | Reservado                                   |

### Coral (corazón) — 5 variantes

Extraído del corazoncito del logo. Para atención/cuidado/importante y acciones destructive (en sus dos variantes: soft y strong). En vez del rojo `oklch(0.577 0.245 27.325)` del default shadcn — que se siente agresivo y choca con la paleta cálida — usamos coral como base con dos intensidades.

| Token         | HSL        | HEX     | Uso recomendado                                    |
| ------------- | ---------- | ------- | -------------------------------------------------- |
| `--coral-100` | 0 100% 95% | #FFE5E5 | Background de la variante **destructive soft**     |
| `--coral-300` | 0 100% 82% | #FFA3A3 | Bordes, hover de destructive soft                  |
| `--coral-500` | 0 100% 71% | #FF6B6B | **Base** — fill de **destructive strong**, errores |
| `--coral-700` | 0 70% 50%  | #D92626 | Texto sobre fondos coral-100, hover strong         |
| `--coral-900` | 0 65% 30%  | #7E1C1C | Reservado                                          |

#### Criterio de uso: dos variantes destructive

| Variante             | Estilo                                              | Cuándo usar                                                                                                                                                                     |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `destructive` (soft) | `bg-coral-100 text-coral-700 hover:bg-coral-300/60` | **Reversibles o contextuales**: quitar vínculo, archivar, cancelar invitación, dar de baja una matrícula activa (queda `fecha_baja` pero el dato se conserva).                  |
| `destructive-strong` | `bg-coral-500 text-white hover:bg-coral-600`        | **Irreversibles o destructivas reales**: borrar niño, borrar usuario, borrar centro, soft-delete que no se va a deshacer, vaciar tabla. Siempre exige confirmación en `Dialog`. |

La variante `destructive` (soft) se usa en línea, en botones secundarios, en menús contextuales. La variante `destructive-strong` aparece exclusivamente dentro de dialogs/modales de confirmación o en CTA muy destacados que el usuario tenga que clickear deliberadamente.

### Info (cielo nube) — 5 variantes

Extraído de la nubecita del logo. Para badges informativos neutros, tooltips, estados "Pendiente / En progreso".

| Token        | HSL         | HEX     | Uso recomendado                     |
| ------------ | ----------- | ------- | ----------------------------------- |
| `--info-100` | 197 75% 95% | #E8F5FC | Background de mensajes informativos |
| `--info-300` | 197 73% 85% | #BAE3F4 | Bordes de badges info               |
| `--info-500` | 197 71% 73% | #87CEEB | **Base** — badge info, tooltip bg   |
| `--info-700` | 197 70% 50% | #2BB0DD | Texto sobre fondos info-100         |
| `--info-900` | 197 70% 30% | #1A6883 | Reservado                           |

### Neutral (grises cálidos)

Grises con un toque cálido (matiz hacia el ámbar/crema, no fríos). Más amables que los grises azulados de la mayoría de UIs.

| Token           | HSL        | HEX     | Uso recomendado                                |
| --------------- | ---------- | ------- | ---------------------------------------------- |
| `--neutral-50`  | 35 35% 98% | #FDFBF8 | **Background general de la app (off-white)**   |
| `--neutral-100` | 33 30% 95% | #F7F2EC | Hover de filas en tablas, secondary background |
| `--neutral-200` | 30 18% 88% | #E5DCD0 | Bordes y separadores                           |
| `--neutral-300` | 28 14% 78% | #CCBFB1 | Bordes activos                                 |
| `--neutral-400` | 28 10% 64% | #ACA095 | Placeholders, iconos deshabilitados            |
| `--neutral-500` | 28 8% 50%  | #877F76 | Texto muted, captions                          |
| `--neutral-600` | 28 9% 38%  | #6A5F55 | Texto secundario                               |
| `--neutral-700` | 28 12% 28% | #4F463C | Texto body                                     |
| `--neutral-800` | 28 14% 18% | #34281F | Texto fuerte                                   |
| `--neutral-900` | 28 16% 11% | #1F1813 | **Foreground principal**                       |

### Mapeo a tokens semánticos shadcn (light mode)

```css
:root {
  /* Backgrounds */
  --background: hsl(35 35% 98%); /* neutral-50 */
  --foreground: hsl(28 16% 11%); /* neutral-900 */
  --card: hsl(0 0% 100%); /* white pura sobre el off-white */
  --card-foreground: hsl(28 16% 11%);
  --popover: hsl(0 0% 100%);
  --popover-foreground: hsl(28 16% 11%);

  /* Acentos */
  --primary: hsl(208 75% 58%); /* primary-500 */
  --primary-foreground: hsl(0 0% 100%);
  --secondary: hsl(33 30% 95%); /* neutral-100 */
  --secondary-foreground: hsl(28 14% 18%);
  --muted: hsl(33 30% 95%);
  --muted-foreground: hsl(28 8% 50%); /* neutral-500 */
  --accent: hsl(25 80% 92%); /* accent-warm-100 */
  --accent-foreground: hsl(25 70% 28%); /* accent-warm-800 */

  /* Estados */
  --destructive: hsl(0 100% 71%); /* coral-500 */
  --destructive-foreground: hsl(0 0% 100%);

  /* Bordes / inputs / focus */
  --border: hsl(30 18% 88%); /* neutral-200 */
  --input: hsl(30 18% 88%);
  --ring: hsl(208 75% 67%); /* primary-400 */

  /* Charts (futuro Fase 9) */
  --chart-1: hsl(208 75% 58%); /* primary */
  --chart-2: hsl(25 78% 55%); /* accent-warm */
  --chart-3: hsl(115 52% 50%); /* success */
  --chart-4: hsl(46 95% 58%); /* accent-yellow */
  --chart-5: hsl(197 71% 73%); /* info */

  /* Sidebar */
  --sidebar: hsl(0 0% 100%);
  --sidebar-foreground: hsl(28 14% 18%);
  --sidebar-primary: hsl(208 75% 58%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(25 80% 92%); /* warm-100 item activo */
  --sidebar-accent-foreground: hsl(25 70% 28%);
  --sidebar-border: hsl(30 18% 88%);
  --sidebar-ring: hsl(208 75% 67%);

  /* Radio base */
  --radius: 0.75rem;
}

.dark {
  /* Vacío de momento — placeholders para Ola 2 */
}
```

Cada paleta extendida (`--primary-50` … `--primary-900`, etc.) se declara en `:root` también para poder hacer `bg-accent-warm-100`, `text-success-700`, etc. directamente desde Tailwind 4 (mapeo en el bloque `@theme inline` de `globals.css`).

## Tipografía

### Familia

**Plus Jakarta Sans** vía `next/font/google` con pesos 400, 500, 600, 700, 800. Variable CSS `--font-jakarta` aplicada al `<body>` y mapeada a `--font-sans` en el bloque `@theme inline` (sustituye al `Geist` actual). El binario Geist deja de cargarse.

### Escala

| Token     | Tamaño         | Line-height | Peso | Uso                                   |
| --------- | -------------- | ----------- | ---- | ------------------------------------- |
| `display` | 3rem (48px)    | 1.15        | 800  | Hero del login y bienvenida           |
| `h1`      | 2rem (32px)    | 1.2         | 800  | Títulos de página                     |
| `h2`      | 1.5rem (24px)  | 1.3         | 700  | Títulos de sección (CardTitle largos) |
| `h3`      | 1.25rem (20px) | 1.4         | 600  | Subtítulos                            |
| `body-lg` | 1.125rem(18px) | 1.5         | 500  | Body destacado (intros)               |
| `body`    | 1rem (16px)    | 1.55        | 400  | Body por defecto                      |
| `small`   | 0.875rem(14px) | 1.5         | 400  | Captions, helper text                 |
| `caption` | 0.75rem (12px) | 1.45        | 500  | Etiquetas, microcopy en cards         |

Las clases utility se definen en `globals.css` dentro de `@layer base`:

```css
.text-display {
  font-size: 3rem;
  line-height: 1.15;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.text-h1 {
  font-size: 2rem;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.text-h2 {
  font-size: 1.5rem;
  line-height: 1.3;
  font-weight: 700;
  letter-spacing: -0.005em;
}
.text-h3 {
  font-size: 1.25rem;
  line-height: 1.4;
  font-weight: 600;
}
```

Body, small y caption usan los tamaños default de Tailwind (`text-base`, `text-sm`, `text-xs`) — no necesitan utility custom.

### Letter-spacing y tracking

Plus Jakarta Sans es una geométrica humanista; a tamaños grandes (h1, display) se ve mejor con un `letter-spacing` ligeramente negativo (`-0.01em` a `-0.02em`). A tamaño body default (1.55 line-height) y sin tracking custom.

## Espaciado, radios y sombras

### Espaciado

Escala Tailwind por defecto (base 4px). Convenciones de uso más frecuente:

| Token | Valor | Uso                         |
| ----- | ----- | --------------------------- |
| `1`   | 4px   | Iconos a texto adyacente    |
| `2`   | 8px   | Padding compacto            |
| `3`   | 12px  | Gap entre form fields       |
| `4`   | 16px  | Padding cards pequeñas      |
| `6`   | 24px  | Padding cards estándar      |
| `8`   | 32px  | Margen entre secciones      |
| `12`  | 48px  | Padding hero del login      |
| `16`  | 64px  | Espacios verticales grandes |

### Radios

```css
--radius: 0.75rem; /* base = lg */
```

Los radios shadcn (`--radius-sm`, `--radius-md`, etc.) se derivan en el bloque `@theme inline` con multiplicadores: `sm = 0.6×`, `md = 0.8×`, `lg = 1×`, `xl = 1.4×`, `2xl = 1.8×`.

| Componente        | Clase Tailwind | Valor calculado |
| ----------------- | -------------- | --------------- |
| Botones           | `rounded-xl`   | ~16.8px         |
| Cards             | `rounded-2xl`  | ~21.6px         |
| Inputs / Textarea | `rounded-lg`   | 12px            |
| Select trigger    | `rounded-lg`   | 12px            |
| Badge             | `rounded-full` | —               |
| Avatar            | `rounded-full` | —               |
| Dialog / Popover  | `rounded-2xl`  | ~21.6px         |
| Toast (sonner)    | `rounded-2xl`  | ~21.6px         |
| Skeleton          | `rounded-lg`   | 12px            |

### Sombras

Sombras suaves de capa única, con desenfoque amplio y opacidad baja (efecto "flotando suavemente" más que "drop shadow agresivo"). Definidas en `@theme inline`:

```css
--shadow-sm: 0 1px 2px 0 hsl(28 16% 11% / 0.04);
--shadow-md: 0 4px 14px -2px hsl(28 16% 11% / 0.06), 0 1px 4px 0 hsl(28 16% 11% / 0.04);
--shadow-lg: 0 10px 28px -4px hsl(28 16% 11% / 0.08), 0 2px 6px 0 hsl(28 16% 11% / 0.04);
--shadow-xl: 0 20px 50px -6px hsl(28 16% 11% / 0.1), 0 4px 12px 0 hsl(28 16% 11% / 0.06);
```

Aplicación:

| Token       | Uso                                    |
| ----------- | -------------------------------------- |
| `shadow-sm` | Bordes sutiles (no se usa por defecto) |
| `shadow-md` | Cards en su estado normal              |
| `shadow-lg` | Cards hover, hero del login            |
| `shadow-xl` | Dialogs, popovers, dropdowns           |

## Logo: variantes, procesado y uso

### Punto de partida

`Logo Nido.png` (en raíz del repo, no comiteado todavía): 1024×1024, fondo negro, contiene chick + nest + "NiDO" + tagline "Agenda Infantil 0-3 Años".

### Decisión: Opción C — procesar a transparente

El PNG original tiene fondo negro sólido. **Opción C** del prompt: procesar el PNG con `sharp` en un script Node (`scripts/process-logos.mjs`) que:

1. Lee `Logo Nido.png` desde la raíz del repo (`./Logo Nido.png`).
2. Aplica un threshold sobre el canal alpha derivado de la luminancia: píxeles con luminancia < 12 se vuelven transparentes (capta el fondo negro y rincones oscuros, sin tocar los gradientes del logo que tienen luminancia >> 12).
3. Exporta variantes recortadas y redimensionadas a `public/brand/`:
   - `nido-logo-full.png` — full asset 1024×1024 con tagline.
   - `nido-logo-wordmark.png` — recorte de la parte superior + texto "NiDO" sin tagline, 1024×~700.
   - `nido-logo-mark.png` — solo chick+nest cuadrado 512×512.
   - `icon-192.png`, `icon-512.png` — versiones del mark para PWA manifest.
   - `favicon.ico` — 32×32 multi-resolución (16/24/32) generado desde el mark.

**Justificación frente a opción A (CSS blend) y B (aceptar fondo negro):**

- A complica todos los sitios donde aparece el logo (necesita fondo de cierto color, no escala a sidebar blanco).
- B descarta el aspecto cariñoso del logo y obliga a banners negros que no encajan con la paleta.
- C es trabajo único, deja un asset reutilizable y, si el threshold deja rebabas, se puede afinar antes del Checkpoint B.

**Plan B si sharp no está disponible o el threshold no funciona limpio:** caer en opción A para login (fondo `primary-50` con `mix-blend-mode: multiply` sobre el logo) y para sidebar usar solo `wordmark` con fondo blanco que oculte el negro residual. Decidir en Paso 3.3.

### Reglas del script `scripts/process-logos.mjs`

- **Idempotente**: mismo input PNG → mismo output PNG (byte-a-byte si es posible). Conseguido fijando todos los parámetros de `sharp` (compresión, filtros, palette, profile) y desactivando metadata variable (`withMetadata(false)`). Cualquier ejecución sucesiva con el mismo source produce un diff vacío en git.
- **Manual, no en build**: el script se ejecuta a mano cuando se actualice el logo original. CI **no** depende de él. Si el responsable cambia `Logo Nido.png`, corre `node scripts/process-logos.mjs` y commitea los outputs.
- **`sharp` como devDependency**: `npm install --save-dev sharp`. No queda en el bundle de producción (Next.js bundle = solo `dependencies` + tree-shaking).
- **Outputs commiteados** en `public/brand/`. Los PNGs procesados forman parte del repo. No se generan en runtime ni en `next build`.
- **Comando de regeneración** documentado en `docs/dev-setup.md`: `node scripts/process-logos.mjs` (sin args, lee siempre `Logo Nido.png` y escribe a `public/brand/`).
- **Source PNG comiteado**: `Logo Nido.png` se commitea en `public/brand/source/` (renombrado a `nido-logo-source.png` para evitar el espacio) para que cualquier dev pueda regenerar sin pedírselo al responsable. El PNG original en la raíz del repo se mueve allí.

### Variantes y uso

| Variante          | Archivo                  | Dónde                                             |
| ----------------- | ------------------------ | ------------------------------------------------- |
| `Logo` (completo) | `nido-logo-full.png`     | `/login` hero, `/invitation/[token]`, splash      |
| `LogoWordmark`    | `nido-logo-wordmark.png` | Sidebar headers admin/teacher/family, footer      |
| `LogoMark`        | `nido-logo-mark.png`     | Sidebar colapsado (futuro), favicon, PWA manifest |

Componentes React:

- `<Logo className?, priority? />` — renderiza `nido-logo-full.png` con `next/image`, `width={320} height={320}` por defecto, `priority` opcional para LCP.
- `<LogoWordmark />` — `width={180} height={56}` por defecto.
- `<LogoMark />` — `width={40} height={40}` por defecto.

Todos los componentes usan `next/image` con `alt="NIDO"` (string i18n no necesario: es nombre de marca).

### Plan de sustitución por vectorial

Cuando llegue el SVG definitivo (responsable lo proporcionará), basta sustituir los archivos en `public/brand/` (mismo nombre, formato `.svg` o `.png` según corresponda) o, si el SVG necesita props específicas, reemplazar el body de `<Logo />`/`<LogoWordmark />`/`<LogoMark />` por el SVG inline. El resto de la app no se entera. Plan registrado en ADR-0008.

## Componentes shadcn/ui — adaptación

Para cada componente ya instalado en `src/components/ui/` (13 archivos), se revisa que use exclusivamente tokens semánticos y se le aplican radios + sombras del sistema. La mayoría ya usa tokens (`bg-primary`, `border-input`, etc.); el trabajo está en confirmar variantes y matizar radios.

### `Button` (`button.tsx`)

Variantes actuales: `default | outline | secondary | ghost | destructive | link`. Cambios:

- Radius base: `rounded-xl` (ahora `rounded-lg`).
- Variante `default` ya usa `bg-primary text-primary-foreground` — OK.
- Variante `destructive` reescrita como **soft** (`bg-coral-100 text-coral-700 hover:bg-coral-300/60`): acciones reversibles o contextuales.
- **Añadir** variante `destructive-strong`: `bg-destructive text-destructive-foreground hover:bg-coral-600 focus-visible:ring-coral-300`. Para acciones irreversibles dentro de dialogs de confirmación.
- Tamaños actuales (h-6/7/8/9): se conservan; solo se sube el radius.

Tabla resumen de variantes:

```ts
variant: {
  default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/90',
  outline: 'border-border bg-background hover:bg-muted',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-muted hover:text-foreground',
  destructive:        'bg-coral-100 text-coral-700 hover:bg-coral-300/60 focus-visible:ring-coral-300/40',
  'destructive-strong':'bg-destructive text-destructive-foreground hover:bg-coral-600 focus-visible:ring-coral-300',
  link: 'text-primary underline-offset-4 hover:underline',
}
```

Criterio de uso documentado en la sección "Coral (corazón)". Confirmación obligatoria en `Dialog` para `destructive-strong`.

### `Card` (`card.tsx`)

- `rounded-2xl` (ahora algo distinto).
- `shadow-md` por defecto.
- Padding interno consistente (`p-6` en CardHeader/Content/Footer).

### `Input`, `Textarea`, `Select` trigger

- `rounded-lg`.
- Border `border-input` (ya).
- Focus ring `ring-2 ring-ring/40` con `border-ring`.

### `Badge`

Añadir variantes nuevas:

```typescript
variant: {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  outline: 'border-border text-foreground',
  success: 'bg-success-100 text-success-700',
  warning: 'bg-accent-yellow-100 text-accent-yellow-700',
  info: 'bg-info-100 text-info-700',
  destructive: 'bg-coral-100 text-coral-700',
  warm: 'bg-accent-warm-100 text-accent-warm-800',
}
```

### `Dialog` y `Popover` (sonner toast también)

- `rounded-2xl`.
- `shadow-xl`.
- Backdrop con `bg-foreground/40 backdrop-blur-sm`.

### `Tabs`

- `TabsTrigger` activo: `data-[state=active]:bg-card` (sale del trigger neutro).
- `TabsList` con `bg-muted` y `rounded-xl`.

### `Table`

- `thead` con `bg-neutral-100`.
- `tbody tr:hover` con `bg-neutral-50`.
- Bordes con `border-border`.

### `Checkbox`

- Caja `rounded-md` (ya lo tiene).
- Estado checked: `bg-primary text-primary-foreground` con un check icon de Lucide (`Check`, `strokeWidth={3}`).

### Componentes a no tocar (ya correctos con tokens)

`Form`, `Label`, `Sonner` provider (los toasts heredan del Card style).

## Nuevos componentes

### `<EmptyState />`

```tsx
interface EmptyStateProps {
  icon?: React.ReactNode // Lucide icon o emoji
  title: string // i18n key resuelta
  description?: string
  cta?: { label: string; onClick?: () => void; href?: string }
}
```

Estructura: contenedor centrado con padding `py-16 px-6`, icono 48px (`text-muted-foreground`), título `text-h3`, descripción `text-muted-foreground`, CTA opcional como `<Button>`. Ubicación: `src/shared/components/EmptyState.tsx`.

### `<LoadingSkeleton />`

Variantes: `card | row | form | text`. Implementación: divs con clase `animate-pulse bg-muted rounded-lg` y proporciones distintas por variante. Ubicación: `src/shared/components/LoadingSkeleton.tsx`.

### `<BrandedLoading />`

Para esperas largas (>2s estimados, ej. exportación de informes en futuras fases). Logo mark + texto "Un momento…" + barra de progreso indeterminada con `bg-primary-100` y un fragmento que se desliza con `animate-[shimmer]`. Ubicación: `src/shared/components/BrandedLoading.tsx`.

### `<Logo />`, `<LogoWordmark />`, `<LogoMark />`

Ya descritos arriba. Ubicación: `src/shared/components/brand/`.

## Pantalla por pantalla — cambios visuales

Resumen de cómo cambia cada pantalla al aplicar el sistema. No se cambia lógica ni queries; solo presentación.

### Públicas / Auth

**`/[locale]/login`:**

- Layout: `min-h-screen` con gradiente de fondo `from-primary-50 via-background to-accent-warm-50` (suave, no estridente).
- Card centrada `max-w-md`, `shadow-lg`, `rounded-2xl`.
- Encima de la card: `<Logo />` a 280×280, centrado.
- Título `t('title')` con clase `text-h1`, subtítulo `text-muted-foreground`.
- Botón principal con ancho completo, `rounded-xl`.
- Link "¿Olvidaste tu contraseña?" debajo en `text-sm text-primary-700 hover:underline`.

**`/[locale]/forgot-password`, `/[locale]/reset-password`:**

- Variante minimal del login: misma estructura, sin logo grande (solo wordmark pequeño arriba), card sencilla.

**`/[locale]/invitation/[token]`:**

- Bienvenida visualmente celebrativa: `<Logo />` a 280, headline `text-display` con copy cálido ("¡Te damos la bienvenida a NIDO!"), card con formulario de aceptación.
- Color de acento: `accent-warm-500` en botón principal en lugar de `primary` (transmite calidez en lugar de neutralidad).

**`/[locale]/invitation/expired`:**

- Empty state amable: icono `Clock` (Lucide) en `text-accent-warm-400`, título `t('expired_title')`, descripción "Esta invitación caducó. Pide al admin que te envíe una nueva.", CTA "Volver al login".

**`/[locale]/forbidden` y 404:**

- Empty state amable: icono `Lock` o `Search` en `text-muted-foreground`, copy en tono no alarmista, CTA "Volver atrás" / "Inicio".

**`/[locale]/privacy`, `/[locale]/terms`:**

- Layout `prose`-like: max-width `max-w-3xl mx-auto px-6 py-12`, headings con escala del sistema, párrafos `text-base leading-relaxed text-neutral-800`. Wordmark arriba.

### Layouts dashboard

**Admin (`/[locale]/admin/layout.tsx`):**

- Migrar del horizontal nav actual a layout de dos columnas: sidebar fija a la izquierda (`w-64`, `bg-card`, `border-r border-border`), main content a la derecha en off-white.
- Sidebar header: `<LogoWordmark />` en padding generoso.
- Sidebar items: lista vertical con icono Lucide + label. Estado activo: `bg-accent-warm-100 text-accent-warm-800` con barra izquierda 3px en `border-l-accent-warm-500`. Hover: `bg-neutral-50`.
- Sidebar footer: avatar usuario + nombre + link a `/profile`.
- Main: container con `max-w-6xl mx-auto px-6 py-6`.
- Header opcional sobre main para breadcrumbs (`Admin / Niños / Nuevo`) en `text-sm text-muted-foreground`.

**Teacher (`/[locale]/teacher/page.tsx` lo crea inline):**

- Mismo patrón que admin, sidebar más corto (solo "Mi tablero", "Mis aulas", "Perfil").

**Family (`/[locale]/family/page.tsx`):**

- Mismo patrón, sidebar con "Inicio", "Mi hijo/a", "Perfil".

### Admin internas

**`/admin` (dashboard):**

- Hero compacto con saludo: "Hola, [nombre]" (`text-h1`) + descripción.
- Grid de cards de stats (3 columnas en md+, 1 en mobile): "Aulas activas", "Niños matriculados", "Profes asignados". Cada card con icono color-coded (`primary`, `accent-warm`, `success`), número grande (`text-display` size 36), label.
- Sección "Acciones rápidas": botones outline `rounded-xl` con icono Lucide + label ("Crear niño", "Ver audit log", "Activar curso").

**`/admin/centro`:**

- Card "Datos del centro" (`rounded-2xl`, `shadow-md`) con form de edición (admin) o solo lectura (futuro).

**`/admin/cursos`:**

- Lista de cursos como cards apiladas (no tabla; pocas filas en general). Cada card: nombre + fechas + badge de estado (`success` para activo, `info` para planificado, `secondary` para cerrado). CTA "Crear curso" arriba derecha.

**`/admin/aulas`:**

- Grid de cards (2 columnas md, 1 mobile). Cada card: nombre del aula + cohortes (badges `warm`) + capacidad + CTA "Editar".

**`/admin/aulas/[id]`** (futuro detalle de aula, ya soportado en routing):

- Header con nombre del aula + badge cohortes.
- Tabs: "Niños asignados", "Profes asignados".

**`/admin/ninos` (lista):**

- Tabla con: nombre, fecha nacimiento, aula actual (badge `warm`), tutores, CTA "Ver". Cabecera de tabla con `bg-neutral-100`.
- Filtro arriba: select de aula, search por nombre.
- CTA "Añadir niño" arriba derecha en `bg-primary text-primary-foreground`.

**`/admin/ninos/nuevo` (wizard):**

- Mantener la lógica del wizard de Fase 2 (3 pasos: datos, médica, aula). Visualmente:
- Indicador de paso arriba: `Paso 2 de 3 — Información médica` en `text-caption` con barra de progreso `bg-primary-100` con fragmento `bg-primary-500`.
- Card central `max-w-2xl shadow-md rounded-2xl`.
- Botones de navegación: "Atrás" outline, "Siguiente" / "Guardar" primary, ambos `rounded-xl`.

**`/admin/ninos/[id]` (detalle):**

- Header con avatar del niño (si hay foto, si no inicial sobre `bg-primary-100`), nombre `text-h1`, edad calculada, badge de aula actual.
- Tabs: "Datos generales", "Datos médicos", "Vínculos familiares", "Matrículas", "Audit log".

**`/admin/audit`:**

- Tabla scrolleable con: fecha, tabla, acción (badge `success`/`info`/`destructive` según insert/update/delete), usuario (nombre), id de registro.
- Filtros: rango de fechas, tabla, usuario.

### Teacher

**`/teacher` (dashboard):**

- Card destacada "Tus aulas" con `bg-accent-warm-50 border-accent-warm-200`: lista de aulas asignadas como chips clicables.
- Stats: "Niños a tu cargo" total.

**`/teacher/aula/[id]`:**

- Lista de niños del aula como cards con avatar + nombre + edad. Click → detalle del niño (solo si el flujo de Fase 3+ lo habilita; ahora vista mínima).

### Family

**`/family`:**

- Card del niño/hijo destacada con `<LogoMark />` o avatar + nombre + edad + badge de aula.
- Stats hoy (placeholder hasta Fase 3): "Asistencia", "Última actualización".

**`/family/nino/[id]`:**

- Header con avatar y nombre.
- Tabs: "Datos básicos", "Aula", "Tutores autorizados".

### Profile

**`/profile`:**

- Card con datos del usuario + form de edición de nombre.
- Card "Tus invitaciones" → enlace a `/profile/invitations`.

## Empty / loading / error states

### Empty state

Patrón único: `<EmptyState icon={Icon} title="" description="" cta={...} />`. Icon 48px en `text-muted-foreground` o color de la sección. Copy amable, primera persona del plural cuando aplique ("Aún no tenemos niños registrados").

Ejemplos de copy:

- Niños vacío: "Aún no hay niños registrados. ¿Quieres añadir el primero?"
- Cursos vacío: "Sin cursos académicos todavía. Crea el primero para empezar a configurar el centro."
- Audit log vacío: "No se ha registrado actividad en este rango. Prueba otra fecha."

### Loading state

Patrón: `<LoadingSkeleton variant="row" count={n} />` o `<LoadingSkeleton variant="card" count={n} />`. Sin spinners genéricos.

Para esperas largas (export, generación de PDF en futuras fases): `<BrandedLoading message={t('loading.preparing_report')} />`.

### Error state

Mensaje no técnico. Ejemplos:

- "Algo no ha ido bien. Vuelve a intentarlo en un momento."
- "No hemos podido cargar esta información. Comprueba tu conexión."
- Acción primaria: "Reintentar". Acción secundaria: "Volver atrás".

## Microcopy y tono

Reglas generales:

- **Tú**, no "usted". Cercano.
- Confirmaciones positivas: "¡Hecho!", "Guardado", "Listo".
- Errores: nunca "Error: ..." técnico. "Algo no ha ido bien" / "No hemos encontrado…".
- Acciones destructivas: requieren confirmación explícita en `Dialog` con CTA `destructive` (coral atenuado).
- Botones primarios: verbos en infinitivo o presente ("Guardar cambios", "Crear niño", "Enviar invitación"). No "OK" / "Aceptar" genéricos.
- Saludos contextuales: "Buenos días, [nombre]" / "Buenas tardes" según hora local en el dashboard (Fase 3+ si aplica; Fase 2.5 deja "Hola, [nombre]").

## Iconografía

- **Lucide React** ya instalado.
- Tamaños base: 20px (`h-5 w-5`) inline en texto, 24px (`h-6 w-6`) standalone.
- Color: `currentColor` (heredan).
- Weight: regular por defecto, `strokeWidth={2.5}` cuando se quiera énfasis (ej. iconos en cards de stats).
- Selección consistente por concepto:
  - Centro/escuela: `Building2`
  - Curso académico: `CalendarDays`
  - Aula: `Users` o `BookOpen`
  - Niño: `User` o `Baby`
  - Médica: `Heart` o `Stethoscope`
  - Audit: `History`
  - Profe: `GraduationCap`
  - Familia: `Users`
  - Login: `LogIn`
  - Logout: `LogOut`
  - Plus/añadir: `Plus`
  - Editar: `Pencil`
  - Borrar: `Trash2`

## Accesibilidad y contraste

- Todas las combinaciones texto/fondo cumplen **WCAG AA**: 4.5:1 texto normal, 3:1 texto grande (>18pt o >14pt bold).
  - `--foreground` (neutral-900) sobre `--background` (neutral-50): ratio ~13:1 ✅
  - `--primary-foreground` (white) sobre `--primary` (primary-500): ratio ~3.8:1 (texto grande/bold OK; verificar en botones tamaño default — si no llega, oscurecer primary-500 a primary-600).
  - `--muted-foreground` (neutral-500) sobre `--background`: ratio ~5.6:1 ✅
- Verificación: usar `npx @axe-core/cli` en build estático en CI o `axe-core` en Playwright.
- Color nunca es el único indicador: badges incluyen icono cuando comunican estado (Check, AlertTriangle, etc.).
- Focus ring visible en todos los elementos interactivos: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- Estados hover, focus, active, disabled definidos en cada variante de Button, Input, Select, etc.
- Tamaño de toque mínimo 44×44px en móvil (botones `h-9` con padding `px-3` cumplen).

## Tests requeridos

**Vitest (unit):**

- [ ] Componente `<EmptyState />` renderiza icon, title, description y cta condicionalmente.
- [ ] Componente `<LoadingSkeleton />` renderiza el número correcto de placeholders por variante.
- [ ] Componente `<Logo />` aplica `priority` cuando se pasa.

**Playwright (E2E):**

- [ ] `/login` muestra el logo completo y la tipografía Plus Jakarta Sans está cargada (verificar `getComputedStyle(document.body).fontFamily` incluye "Plus Jakarta Sans").
- [ ] Dashboard admin muestra el wordmark en el sidebar.
- [ ] Tests E2E existentes (`admin-crud-flow.spec.ts`, `profe-aislamiento.spec.ts`) siguen pasando — la lógica no cambia, solo presentación.

**Visual (manual durante checkpoints, no automatizado en CI):**

- Lighthouse en `/es/login` y `/es/admin` (modo desktop y mobile) — accesibilidad y mejores prácticas > 90.
- axe-core en las pantallas auth y admin dashboard — 0 violations.

## Criterios de aceptación

- [ ] `npm run typecheck && npm run lint && npm test && npm run test:e2e && npm run build` todo verde.
- [ ] Lighthouse > 90 en `/es/login` (accesibilidad ≥ 95, mejores prácticas ≥ 90).
- [ ] axe-core sin violations en login, dashboards admin/teacher/family, listas admin, wizard niño.
- [ ] Plus Jakarta Sans cargada correctamente (no cae a system fallback).
- [ ] Logo visible en: `/login` (full), sidebar admin (wordmark), sidebar teacher (wordmark), sidebar family (wordmark), favicon del navegador.
- [ ] Cero clases Tailwind con colores hardcoded (`bg-blue-*`, `text-red-*`, etc.) en `src/` salvo archivos generados (`database.ts`). Verificar con `grep`.
- [ ] i18n trilingüe completa para cualquier nuevo string (componentes EmptyState con copy específico por pantalla).
- [ ] `docs/decisions/ADR-0008-design-system.md` escrito.
- [ ] `docs/journey/progress.md` con entrada de Fase 2.5.

## Pantallas y rutas afectadas

Todas las existentes (ninguna nueva en esta fase):

- Auth: `/login`, `/forgot-password`, `/reset-password`, `/invitation/[token]`, `/invitation/expired`, `/forbidden`, `/privacy`, `/terms`.
- Profile: `/profile`, `/profile/invitations`, `/select-role`.
- Admin: `/admin`, `/admin/centro`, `/admin/cursos`, `/admin/aulas`, `/admin/ninos`, `/admin/ninos/nuevo`, `/admin/ninos/[id]`, `/admin/audit`.
- Teacher: `/teacher`, `/teacher/aula/[id]`.
- Family: `/family`, `/family/nino/[id]`.

## Componentes UI a tocar / crear

**Modificar** (`src/components/ui/`):

- `button.tsx` (radius xl, variantes ya OK).
- `card.tsx` (radius 2xl, shadow-md por defecto).
- `input.tsx`, `textarea.tsx`, `select.tsx` (radius lg, focus ring sistemático).
- `badge.tsx` (añadir variantes success, warning, info, destructive, warm).
- `dialog.tsx` (radius 2xl, shadow-xl).
- `tabs.tsx` (TabsList rounded-xl con bg-muted).
- `table.tsx` (thead bg-neutral-100, tbody hover bg-neutral-50).
- `checkbox.tsx` (icono Check de Lucide).
- `sonner.tsx` (heredar styles de Card).
- `form.tsx`, `label.tsx` (sin cambios).

**Crear** (`src/shared/components/`):

- `brand/Logo.tsx`, `brand/LogoWordmark.tsx`, `brand/LogoMark.tsx`.
- `EmptyState.tsx`.
- `LoadingSkeleton.tsx`.
- `BrandedLoading.tsx`.
- `sidebar/SidebarNav.tsx` (compartido por admin/teacher/family layouts).

**Layouts a modificar:**

- `src/app/[locale]/layout.tsx`: cargar Plus Jakarta Sans, sustituir `font-sans` mapping.
- `src/app/[locale]/admin/layout.tsx`: pasar de horizontal nav a layout con sidebar.
- `src/app/[locale]/teacher/page.tsx`: extraer layout dashboard a `teacher/layout.tsx`.
- `src/app/[locale]/family/page.tsx`: extraer layout dashboard a `family/layout.tsx`.

## i18n

Strings nuevos a añadir en `messages/{es,en,va}.json`:

```json
{
  "brand": {
    "name": "NIDO",
    "tagline": "Agenda Infantil 0-3 Años"
  },
  "common": {
    "empty": {
      "title": "Aún no hay nada por aquí",
      "description": "Cuando haya datos, los verás listados.",
      "cta_back": "Volver"
    },
    "loading": {
      "default": "Cargando…",
      "preparing": "Un momento, lo estamos preparando…"
    },
    "errors": {
      "generic": "Algo no ha ido bien. Inténtalo otra vez.",
      "network": "No hemos podido conectar. Comprueba tu conexión.",
      "retry": "Reintentar"
    }
  },
  "admin": {
    "dashboard": {
      "greeting": "Hola, {nombre}",
      "stats": {
        "aulas_activas": "Aulas activas",
        "ninos_matriculados": "Niños matriculados",
        "profes_asignados": "Profes asignados"
      },
      "quick_actions": "Acciones rápidas"
    }
  }
}
```

Mantener los namespaces de Fase 1 y 2 intactos; solo se añaden los anteriores.

## Eventos y notificaciones

No aplica — esta fase no toca server actions ni triggers de BD.

## Performance

- Plus Jakarta Sans con `display: 'swap'` para evitar bloqueo de render.
- Logo PNGs comprimidos con `sharp`: full < 80KB, wordmark < 40KB, mark < 15KB.
- `next/image` con `width`/`height` explícitos para evitar CLS.
- `priority` en logo del login y wordmark del sidebar (LCP).
- Animaciones con `transform`/`opacity` solo (GPU-friendly).
- Skeletons con `animate-pulse` en lugar de spinners (menos repintado).

## Telemetría

No aplica (fase 100% UI). Lighthouse manual antes y después.

## Decisiones técnicas relevantes

- **ADR-0008** Sistema de diseño NIDO: paleta extraída del logo, tipografía Plus Jakarta Sans, estilo Soft & Rounded, mapeo a tokens shadcn, plan de sustitución del logo PNG por SVG vectorial cuando esté disponible.

## Referencias

- `docs/specs/auth.md` (Fase 1) — pantallas auth a rediseñar.
- `docs/specs/core-entities.md` (Fase 2) — pantallas admin a rediseñar.
- ADR-0002 (helpers RLS), ADR-0007 (recursión RLS) — sin impacto en esta fase.
- Tailwind CSS 4 docs sobre `@theme inline`.
- shadcn/ui docs sobre tematizado.

---

**Workflow de esta spec:**

1. ✅ Claude Code escribe esta spec basándose en CLAUDE.md y el prompt de Fase 2.5.
2. ⏳ Responsable revisa y aprueba (`draft` → `approved`).
3. Claude Code implementa hasta tener login funcionando en local (Checkpoint B).
4. Continúa con el resto de pantallas, ADR-0008 y progreso.
5. PR + merge + smoke test en producción.
