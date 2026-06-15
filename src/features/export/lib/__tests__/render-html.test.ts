import { describe, expect, it } from 'vitest'

import { renderExportHtml, type Etiquetador } from '../render-html'
import type { DocumentoExport } from '../../types'

// Traductor falso: devuelve la clave (suficiente para asserts estructurales).
const t: Etiquetador = (k: string) => k

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>'

function docDeNino(extra: Record<string, unknown> = {}): DocumentoExport {
  return {
    _meta: {
      generado_en: '2026-06-15T08:30:45.123456Z',
      derecho: 'acceso (art. 15) + portabilidad (art. 20)',
      formato: 'JSON estructurado + copia HTML legible',
      nota: 'x',
      solicitado_por: 'u1',
    },
    nino: {
      ficha: {
        id: '11111111-1111-1111-1111-111111111111',
        centro_id: '22222222-2222-2222-2222-222222222222',
        nombre: 'Lía',
        apellidos: 'Pérez',
        fecha_nacimiento: '2024-03-15',
        sexo: 'F',
        foto_url: 'centro/lia.jpg',
        created_at: '2026-01-01T00:00:00Z',
      },
      info_medica_emergencia: { medico_familia: 'Dra. García' },
      datos_pedagogicos: [],
      vinculos_familiares: [],
      agendas_diarias: [],
      asistencias: [],
      ausencias: [],
      informes_evolucion: [],
      autorizaciones: [],
      firmas: [
        {
          id: '33333333-3333-3333-3333-333333333333',
          texto_hash: 'abc123def456',
          texto_version: 'v1',
          decision: 'firmado',
          nombre_tecleado: 'Madre Pérez',
          firma_imagen: SVG,
          firmado_at: '2026-05-02T10:11:12Z',
        },
      ],
      administraciones_medicacion: [],
      adjuntos: [],
      fotos_compartidas: [],
      ...extra,
    },
  }
}

describe('renderExportHtml', () => {
  it('oculta identificadores, hashes, versiones y timestamps técnicos', () => {
    const html = renderExportHtml(docDeNino(), t)
    expect(html).not.toContain('11111111-1111-1111-1111-111111111111') // ficha.id
    expect(html).not.toContain('22222222-2222-2222-2222-222222222222') // centro_id
    expect(html).not.toContain('33333333') // firma.id
    expect(html).not.toContain('texto_hash')
    expect(html).not.toContain('abc123def456')
    expect(html).not.toContain('texto_version')
    expect(html).not.toContain('centro/lia.jpg') // foto_url técnico
    expect(html).not.toContain('created_at')
  })

  it('formatea fechas como DD/MM/AAAA sin horas ni microsegundos', () => {
    const html = renderExportHtml(docDeNino(), t)
    expect(html).toContain('15/03/2024') // fecha_nacimiento
    expect(html).toContain('02/05/2026') // firmado_at (solo fecha)
    expect(html).not.toContain('2024-03-15')
    expect(html).not.toContain('.123456')
    expect(html).not.toContain('T08:30')
  })

  it('renderiza la firma como imagen y muestra el contenido legible', () => {
    const html = renderExportHtml(docDeNino(), t)
    expect(html).toContain('<img class="firma"')
    expect(html).toContain('data:image/svg+xml')
    expect(html).toContain('Madre Pérez')
    expect(html).toContain('Dra. García')
  })

  it('incluye títulos de sección', () => {
    const html = renderExportHtml(docDeNino(), t)
    expect(html).toContain('doc.secciones.salud')
    expect(html).toContain('doc.secciones.autorizaciones_firmas')
  })
})
