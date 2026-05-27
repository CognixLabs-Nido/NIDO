// Mock vacío de `server-only` para Vitest.
//
// En producción `import 'server-only'` lanza si el módulo se carga fuera de
// un Server Component / server action. En tests cliente (jsdom) la cadena de
// imports puede arrastrar archivos que usan esa guardia (ej.
// MensajeComposer → enviar-mensaje → audiencia.ts), y vite no sabe resolver
// el módulo. Aliasamos a este archivo vacío para que la cadena no rompa —
// el aislamiento real lo hace cada test con `vi.mock()` de las acciones.

export {}
