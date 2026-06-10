import { describe, expect, it } from 'vitest'

import { generarInformePdf, type InformePdfData } from '@/features/informes/lib/informe-pdf'

/**
 * F9-4 — Generación del PDF de un informe (unit, sin BD). Verifica que el generador
 * server-side (pdf-lib) produce un PDF válido a partir del snapshot del informe,
 * tolera acentos del castellano, ítems sin valorar, observaciones vacías y contenido
 * largo (multipágina) sin lanzar. El control de acceso se cubre en el test RLS gated.
 */

const BASE: InformePdfData = {
  centroNombre: 'Escola Infantil Demo',
  ninoNombre: 'Niño Demo Apellido', // acentos + ñ (castellano)
  periodo: 'trimestre_1',
  cursoNombre: '2025-2026',
  publicadoEn: '2026-03-15T10:30:00.000Z',
  autorNombre: 'Profe Pruebas',
  estructura: [
    {
      titulo: 'Autonomía',
      items: [
        { id: 'item-1', texto: 'Come solo' },
        { id: 'item-2', texto: 'Se lava las manos' },
      ],
    },
    {
      titulo: 'Socialización',
      items: [{ id: 'item-3', texto: 'Comparte juguetes con sus compañeros' }],
    },
  ],
  respuestas: {
    'item-1': { valoracion: 'conseguido', comentario: 'Lo hace con autonomía y disfruta.' },
    'item-2': { valoracion: 'en_proceso' },
    // item-3 sin valorar → debe pintar '—'
  },
  observaciones: 'Un trimestre muy positivo. ¡Enhorabuena!',
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.slice(0, 5))
  return head.startsWith('%PDF-')
}

describe('generarInformePdf (F9-4)', () => {
  it('genera un PDF válido (magic %PDF- y tamaño no trivial)', async () => {
    const bytes = await generarInformePdf(BASE)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(startsWithPdfMagic(bytes)).toBe(true)
    expect(bytes.byteLength).toBeGreaterThan(800)
  })

  it('tolera curso/autor nulos y observaciones vacías sin lanzar', async () => {
    const bytes = await generarInformePdf({
      ...BASE,
      cursoNombre: null,
      autorNombre: null,
      observaciones: null,
      respuestas: {},
    })
    expect(startsWithPdfMagic(bytes)).toBe(true)
  })

  it('no lanza con caracteres fuera de WinAnsi en texto libre (se sanean)', async () => {
    const bytes = await generarInformePdf({
      ...BASE,
      observaciones: 'Comentario con emoji 🎉 y alfabeto no latino дом — debe sanearse, no romper.',
      respuestas: {
        'item-1': { valoracion: 'conseguido', comentario: 'Día estupendo 😀' },
      },
    })
    expect(startsWithPdfMagic(bytes)).toBe(true)
  })

  it('pagina contenido largo (muchas áreas e ítems) sin lanzar', async () => {
    const estructura = Array.from({ length: 12 }, (_, a) => ({
      titulo: `Área ${a + 1}`,
      items: Array.from({ length: 8 }, (_, i) => ({
        id: `a${a}-i${i}`,
        texto: `Ítem ${i + 1} con un texto razonablemente largo para forzar el ajuste de línea y la paginación automática del documento PDF.`,
      })),
    }))
    const respuestas = Object.fromEntries(
      estructura.flatMap((area) =>
        area.items.map((it) => [
          it.id,
          { valoracion: 'conseguido' as const, comentario: 'Comentario de ejemplo.' },
        ])
      )
    )
    const bytes = await generarInformePdf({ ...BASE, estructura, respuestas })
    expect(startsWithPdfMagic(bytes)).toBe(true)
    expect(bytes.byteLength).toBeGreaterThan(2000)
  })
})
