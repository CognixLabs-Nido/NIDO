# ADR-0033: Tabla `/admin/aulas` enriquecida con personal y nº de alumnos

## Estado

`accepted`

**Fecha:** 2026-05-30
**Autores:** Jovi Mibimbi + claude-code (Opus 4.8)
**Fase del proyecto:** F5B — Cierre de Fase 5 (Item 3: tabla de aulas)

## Contexto

La tabla de `/admin/aulas` mostraba únicamente **Nombre · Cohorte · Capacidad · Descripción**. El admin no podía ver ni la **ocupación** (cuántos niños hay en el aula) ni el **responsable / personal** sin entrar al detalle de cada aula.

En un centro pequeño como ANAIA (5 aulas) esa información debe ser visible de un vistazo: es lo primero que mira la dirección al gestionar el día a día. El modelo de personal recién introducido por ADR-0032 (`tipo_personal_aula`) hace por fin posible mostrar el desglose por tipo.

Hay que decidir cómo presentar esta información sin convertir la tabla en un panel sobrecargado ni perder la jerarquía visual coordinadora/profesora/técnico.

## Opciones consideradas

### Opción A: Enriquecer la tabla con 3 columnas + badges jerárquicos

Añadir **Nº alumnos**, **Profesoras** y **Técnicos**. La **coordinadora** se distingue con `<Badge variant="warm">` + tooltip; profesoras regulares y técnicos con `variant="secondary"`. Badges en vertical si hay varios. La columna **Apoyos** se omite hasta que aparezca el primer apoyo (YAGNI). Mobile con `overflow-x-auto`.

**Pros:**

- Toda la información clave (ocupación + responsable + equipo) visible de un vistazo, sin clicks.
- La jerarquía visual (coordinadora destacada en cálido, resto en secundario) comunica el rol sin leer texto.
- Omitir "Apoyos" mantiene la tabla limpia mientras no haya datos.

**Contras:**

- Más ancho de tabla → requiere scroll horizontal en móvil.
- Necesita una query nueva que agregue personal y conteo de alumnos.

### Opción B: Panel de detalle por aula al hacer click, sin enriquecer la tabla

Mantener la tabla actual y mostrar ocupación/personal en un panel al pinchar cada fila.

**Pros:**

- Tabla principal compacta.

**Contras:**

- Añade 1 click + 1 carga para información que debe verse de un vistazo en un centro pequeño (5 aulas). El coste de navegación no se justifica.

### Opción C: Columna unificada "Personal" con badges mezclados

Una sola columna con todos los miembros (coordinadora, profesoras, técnicos) en badges juntos.

**Pros:**

- Menos columnas, tabla más estrecha.

**Contras:**

- Diluye la jerarquía visual coordinadora/profesora/técnico: todo se mezcla y cuesta leer quién es quién de un vistazo.

### Opción D: Statu quo (tabla sin enriquecer)

No cambiar nada.

**Contras:**

- No resuelve el problema: el admin sigue sin ver ocupación ni responsable sin entrar al detalle.

## Decisión

**Se elige la Opción A: enriquecer la tabla con Nº alumnos, Profesoras y Técnicos, con la coordinadora destacada en `Badge variant="warm"` + tooltip y el resto en `variant="secondary"`.**

En un centro de 5 aulas el valor de "verlo todo de un vistazo" supera el coste del ancho extra. La columna unificada (C) ahorraría espacio pero rompe la jerarquía visual que es justamente lo que aporta valor; el panel por click (B) penaliza con navegación información que debe ser inmediata. **Apoyos** se omite hasta el primer dato real (YAGNI), y el móvil resuelve el ancho con `overflow-x-auto`.

## Consecuencias

### Positivas

- Nuevo Server Component `TablaAulas.tsx` reutilizable para la vista enriquecida.
- Ocupación y equipo de cada aula visibles sin navegar.
- La jerarquía de personal queda comunicada por color/badge, no por texto.

### Negativas

- Tabla más ancha → scroll horizontal en móvil (`overflow-x-auto`).
- Dos queries con propósitos distintos a mantener: `getAulasConPersonal` (`Promise.all` de 3 SELECTs) para esta vista, y `getAulasPorCurso` que se mantiene para el wizard de nuevo niño (no necesita personal). Hay que recordar cuál usa cada vista.

### Neutras

- 5 keys i18n nuevas + rename `cohorte` → `anio_nacimiento`. Las cadenas de **VA quedan con TODOs pendientes** de traducción.

## Referencias

- Origen: PR #36 — `feat(admin): tabla aulas enriquecida con personal y nº alumnos`. Cierra F5B Item 3.
- Componente: [src/features/aulas/components/TablaAulas.tsx](../../src/features/aulas/components/TablaAulas.tsx)
- Query: [src/features/aulas/queries/get-aulas-con-personal.ts](../../src/features/aulas/queries/get-aulas-con-personal.ts)
- Depende de: ADR-0032 (ENUM `tipo_personal_aula` — fuente de la clasificación del personal).
- Sistema de diseño (badges): ADR-0008.
