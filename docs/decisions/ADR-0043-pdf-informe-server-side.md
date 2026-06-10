# ADR-0043: Generación server-side del PDF del informe de evolución con pdf-lib

## Estado

`accepted`

**Fecha:** 2026-06-10
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 9 — Informes de evolución (F9-4)

## Contexto

La spec de F9 (`docs/specs/informes-evolucion.md`, Q11) fija que la familia **ve y descarga en PDF** los informes **publicados** de su hijo, y que el PDF se genera en el **servidor** (no en el cliente). El contenido del PDF va **siempre en castellano** (Q10), independientemente del idioma de la interfaz, y debe usar el **snapshot congelado** del informe (`estructura_snapshot` + `respuestas`), no la plantilla viva.

Restricciones del entorno:

- La app corre en **Vercel serverless** (Next.js 16, runtime Node). Cualquier dependencia con binarios nativos pesados o que necesite un navegador headless complica el despliegue (tamaño de la función, cold starts, Chromium en serverless).
- El acceso debe respetar la **RLS de F9-0**: un tutor no puede descargar el PDF de un informe que no le corresponde, ni de un borrador.
- El **nombre del autor** (profe) para el pie del documento **no es legible por la familia vía RLS** (`usuarios` solo permite SELECT de uno mismo / admin del centro).

Hay que decidir **cómo** generar el PDF (librería) y **cómo** servir la descarga respetando la RLS.

## Opciones consideradas

### Opción A: Puppeteer / headless Chrome (HTML → PDF)

Renderizar una plantilla HTML y "imprimir" a PDF con Chromium headless.

**Pros:**

- Layout con CSS, fidelidad visual alta, reutiliza el render web.

**Contras:**

- Chromium en serverless es pesado y frágil (tamaño de bundle, cold start, `@sparticuz/chromium`). Riesgo operativo desproporcionado para un boletín de texto.
- Dependencia grande para un documento estructurado simple.

### Opción B: @react-pdf/renderer (componentes React → PDF)

Definir el PDF con componentes React y `renderToBuffer`.

**Pros:**

- Ergonómico, paginación automática, encaja con el stack React.

**Contras:**

- Dependencia considerable y su propio motor de layout/fuentes; histórico de fricción de bundling con versiones nuevas de Next/React.
- Aporta más de lo necesario para un documento de texto con secciones.

### Opción C: pdf-lib (construcción programática, JS puro) — elegida

Construir el PDF con primitivas (texto, líneas, páginas) usando **pdf-lib**.

**Pros:**

- **JS puro, sin dependencias nativas ni navegador** → ideal para serverless (bundle pequeño, sin cold start de Chromium).
- Determinista y fácil de testear (función pura `bytes`).
- La fuente estándar **Helvetica (WinAnsi/Latin-1)** cubre los acentos del castellano (á é í ó ú ñ ¿ ¡ ü) sin embeber TTF.

**Contras:**

- Layout **manual**: hay que implementar ajuste de línea y paginación a mano (resuelto con un pequeño `Writer` con wrap + salto de página automático).
- Sin CSS: el estilo es básico (suficiente para un boletín).

## Decisión

**Opción C — pdf-lib**, con un generador puro `generarInformePdf(data)` (`src/features/informes/lib/informe-pdf.ts`) que pinta cabecera (centro · niño · período · curso · fecha de publicación), áreas → ítems con su valoración (Conseguido/En proceso/No iniciado) + comentarios, observaciones generales y, al pie, **autor + fecha**. Etiquetas de período y escala **hardcodeadas en castellano** (Q10).

**Entrega y autorización** (route handler `GET /[locale]/informes/[id]/pdf`, ruta **neutra de rol**):

1. **Autorización con el cliente del usuario** (`loadInformeParaPdf(client, id)`): lee `informes_evolucion` bajo **RLS de F9-0** y exige `estado='publicado'`. Si no es accesible → **404**. Es la frontera de seguridad; un tutor solo obtiene el informe de su hijo y solo publicado.
2. **Metadatos con service role** (`assembleInformePdfData`): centro, curso y **nombre del autor** se leen con `createServiceClient()` **solo tras autorizar**, porque `usuarios` no es legible por la familia vía RLS. Mismo patrón "service role tras verificación" que el motor de push (ADR-0027): el service role nunca se expone al cliente y se usa en un helper server-side claramente acotado.
3. **Generación** y respuesta `application/pdf` con `Content-Disposition: attachment` y `Cache-Control: private, no-store`.

Es una de las **excepciones legítimas** a "Server Actions, no API routes" (convenciones): una descarga binaria necesita un route handler. La familia es el caso principal; **profe/admin** enlazan a la misma ruta (botón visible solo si el informe está publicado), reusando el generador.

## Consecuencias

- **Positivas:** despliegue serverless sin fricción (sin Chromium); generador testeable como función pura; acceso gobernado por la RLS existente (sin policy nueva); el PDF refleja el snapshot, coherente con la vista in-app.
- **Negativas / límites:** estilo visual básico (texto, sin CSS); el ajuste de línea/paginación es propio (cubierto por tests de contenido largo). Si en el futuro se quiere un diseño rico (logo, colores de marca, tablas), habría que evaluar una capa de layout o migrar a otra librería — anotado como posible mejora de Ola 3.
- **Privacidad:** una copia ya descargada no se puede revocar (limitación inherente, ya anotada en la spec §Casos límite); a documentar en el aviso de privacidad si procede.

## Referencias

- Spec: `docs/specs/informes-evolucion.md` (Q10 castellano, Q11 server-side).
- ADR-0042 — Modelo de informes de evolución (snapshot congelado).
- ADR-0027 — Arquitectura push (precedente de service role tras verificación).
