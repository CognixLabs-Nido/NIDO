import { describe, expect, it } from 'vitest'

import { datosBloqueadosEnExport, fichaMedicaBloqueadaEnExport } from '../recolectar'
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
  it('la ficha médica bloqueada: dice que existe, que está bloqueada, desde cuándo, por qué y cómo pedirla, sin sus datos', () => {
    const html = renderExportHtml(
      docDeNino({ info_medica_emergencia: fichaMedicaBloqueadaEnExport('2026-08-01') }),
      t,
      'es'
    )
    // Premisa: la sección de salud sale, y sin la ficha del documento de prueba.
    expect(html).toContain('doc.secciones.salud')
    expect(html).not.toContain('Dra. García')
    expect(html).toContain(
      'Existe información médica del niño y está BLOQUEADA desde el 01/08/2026'
    )
    expect(html).toContain('terminó el curso en que causó baja')
    expect(html).toContain('art. 32 LOPDGDD')
    expect(html).toContain('pídela por escrito a la dirección del centro')
    // El campo con la fecha, con su etiqueta traducida.
    expect(html).toContain('doc.campos.bloqueada_desde')
    expect(html).toContain('01/08/2026</dd>')
  })

  it('lo bloqueado tras la purga: dice qué hay, cuánto, desde cuándo, por qué y cómo pedirlo', () => {
    const html = renderExportHtml(
      docDeNino({
        datos_bloqueados: datosBloqueadosEnExport([
          { codigo: 'firmas', n: 2, desde: '2027-03-01' },
          { codigo: 'lineas_recibo', n: 5, desde: '2027-02-10' },
        ]),
      }),
      t,
      'es'
    )
    expect(html).toContain('doc.secciones.datos_bloqueados')
    expect(html).toContain(
      'firmas de autorizaciones (2, desde el 01/03/2027); líneas de recibo (5, desde el 10/02/2027)'
    )
    expect(html).toContain('la ley obliga a guardar estos durante un plazo')
    expect(html).toContain('art. 32 LOPDGDD')
    expect(html).toContain('pídelos por escrito a la dirección del centro')
    // La fecha más antigua, con su etiqueta traducida.
    expect(html).toContain('doc.campos.bloqueados_desde')
    expect(html).toContain('10/02/2027</dd>')
  })

  it('sin nada bloqueado no sale la sección', () => {
    expect(renderExportHtml(docDeNino(), t, 'es')).not.toContain('doc.secciones.datos_bloqueados')
  })

  it('oculta identificadores, hashes, versiones y timestamps técnicos', () => {
    const html = renderExportHtml(docDeNino(), t, 'es')
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
    const html = renderExportHtml(docDeNino(), t, 'es')
    expect(html).toContain('15/03/2024') // fecha_nacimiento
    expect(html).toContain('02/05/2026') // firmado_at (solo fecha)
    expect(html).not.toContain('2024-03-15')
    expect(html).not.toContain('.123456')
    expect(html).not.toContain('T08:30')
  })

  it('renderiza la firma como imagen y muestra el contenido legible', () => {
    const html = renderExportHtml(docDeNino(), t, 'es')
    expect(html).toContain('<img class="firma"')
    expect(html).toContain('data:image/svg+xml')
    expect(html).toContain('Madre Pérez')
    expect(html).toContain('Dra. García')
  })

  it('incluye títulos de sección', () => {
    const html = renderExportHtml(docDeNino(), t, 'es')
    expect(html).toContain('doc.secciones.salud')
    expect(html).toContain('doc.secciones.autorizaciones_firmas')
  })

  it('omite los campos vacíos en vez de pintar "—"', () => {
    const html = renderExportHtml(
      {
        _meta: docDeNino()._meta,
        nino: {
          ficha: { nombre: 'Lía', apellidos: '', nacionalidad: null, fecha_nacimiento: undefined },
        },
      } as never,
      t,
      'es'
    )
    expect(html).not.toContain('—')
    expect(html).not.toContain('doc.campos.apellidos') // vacío → omitido
    expect(html).not.toContain('doc.campos.nacionalidad') // null → omitido
    expect(html).toContain('Lía') // el que sí tiene valor se mantiene
  })

  it('no incluye la sección de Mensajes (solo van en datos.json)', () => {
    const html = renderExportHtml(
      {
        _meta: docDeNino()._meta,
        usuario: {
          ficha: { nombre_completo: 'Madre Pérez' },
          mensajes: [{ contenido: 'hola', fecha: '2026-05-01' }],
        },
      } as never,
      t,
      'es'
    )
    expect(html).not.toContain('doc.secciones.mensajes')
    expect(html).not.toContain('hola')
  })

  it('informes: muestra el texto de la pregunta y la etiqueta "Valoración"', () => {
    const html = renderExportHtml(
      {
        _meta: docDeNino()._meta,
        nino: {
          ficha: { nombre: 'Lía' },
          informes_evolucion: [
            {
              id: 'inf1',
              periodo: 'trimestre_2',
              estructura_snapshot: [
                { titulo: 'Autonomía', items: [{ id: 'i1', texto: '¿Come solo/a?' }] },
              ],
              respuestas: { i1: { valoracion: 'conseguido', comentario: 'Genial' } },
            },
          ],
        },
      } as never,
      t,
      'es'
    )
    expect(html).toContain('¿Come solo/a?') // texto de la pregunta
    expect(html).not.toContain('Item 1') // ya no el genérico
    expect(html).toContain('doc.campos.valoracion') // etiqueta "Valoración" (no "Valoracion")
    expect(html).toContain('doc.valores.conseguido') // valoración mapeada
    expect(html).toContain('Autonomía') // título del área
    expect(html).toContain('Genial') // comentario del ítem
  })

  it('mapea valores de enum a su etiqueta i18n (no semi-crudos)', () => {
    const html = renderExportHtml(
      {
        _meta: docDeNino()._meta,
        usuario: {
          ficha: { nombre_completo: 'Madre Pérez', idioma_preferido: 'es' },
          consentimientos: [{ tipo: 'terminos', aceptado_en: '2025-09-01' }],
        },
      } as never,
      t,
      'es'
    )
    expect(html).toContain('doc.valores.es') // idioma "es" → etiqueta
    expect(html).toContain('doc.valores.terminos') // consentimiento "terminos" → etiqueta
    expect(html).not.toContain('>Terminos<') // ya no se humaniza el semi-crudo
  })

  it('export completo: los importes en euros con el idioma, sin rutas de Storage ni identificadores', () => {
    const html = renderExportHtml(
      {
        _meta: docDeNino()._meta,
        usuario: {
          ficha: { nombre_completo: 'Madre Pérez' },
          perfiles_familia: [
            {
              familia_id: '44444444-4444-4444-4444-444444444444',
              rol_familia: 'titular',
              direccion_ciudad: 'Valencia',
              dni_documento_path: 'centro/nino/dni.pdf',
            },
          ],
          cobros_familia: [
            {
              familia: 'Pérez',
              recibos: [
                {
                  anio: 2027,
                  mes: 1,
                  estado: 'borrador',
                  total_centimos: 12345,
                  lineas: [{ descripcion: 'Cuota', importe_centimos: 12345 }],
                },
              ],
            },
          ],
          lista_espera_contacto: [{ telefono_tutor: '600000015', email_tutor: 'a@b.test' }],
          adjuntos: [{ descripcion: 'DNI', url_firmada: 'https://firmado.test/dni' }],
        },
      } as never,
      t,
      'es'
    )
    expect(html).toContain('123,45') // céntimos → euros
    expect(html).toContain('€')
    expect(html).not.toContain('12345')
    expect(html).toContain('doc.secciones.perfil_familia')
    expect(html).toContain('doc.secciones.cobros_familia')
    expect(html).toContain('doc.secciones.lista_espera_contacto')
    expect(html).toContain('doc.secciones.documentos')
    expect(html).toContain('https://firmado.test/dni') // el DNI, como enlace firmado
    expect(html).not.toContain('centro/nino/dni.pdf') // nunca la ruta cruda
    expect(html).not.toContain('44444444')
    expect(html).toContain('doc.valores.titular')
  })

  it('export completo: las secciones nuevas del niño y la nota sin datos ampliados', () => {
    const html = renderExportHtml(
      docDeNino({
        lista_espera: [{ nombre_nino: 'Lía', estado: 'invitado' }],
        matriculas: [{ aula: 'Aula 1', estado: 'activa', motivo_baja: 'Interna' }],
        consentimientos: [{ tipo: 'imagen', otorgado_por: 'Padre Pérez' }],
        servicios_diarios: [{ fecha: '2027-01-15', servicio: 'comedor', presente: true }],
        datos_ampliados: { _nota: 'Solo los tutores legales y la Dirección.' },
      }),
      t,
      'en'
    )
    expect(html).toContain('doc.secciones.lista_espera')
    expect(html).toContain('doc.secciones.matriculas')
    expect(html).toContain('doc.secciones.consentimientos_nino')
    expect(html).toContain('doc.secciones.servicios_diarios')
    expect(html).toContain('doc.valores.comedor')
    expect(html).toContain('Padre Pérez')
    expect(html).toContain('Interna') // si el JSON lo trae (export de Dirección), se pinta
    expect(html).toContain('Solo los tutores legales y la Dirección.')
    expect(html).toContain('doc.secciones.datos_ampliados')
  })

  it('el centinela de la purga (zz) no sale como idioma', () => {
    const html = renderExportHtml(
      docDeNino({
        ficha: { nombre: '[borrado]', idioma_principal: 'zz' },
        datos_pedagogicos: [{ idiomas_casa: ['zz'], tipo_alimentacion: 'omnivora' }],
      }),
      t,
      'es'
    )
    expect(html).not.toContain('Zz')
    expect(html).not.toContain('>zz<')
    expect(html).not.toContain('doc.campos.idioma_principal')
    expect(html).not.toContain('doc.campos.idiomas_casa')
    expect(html).toContain('doc.valores.omnivora') // el resto de la fila sí sale
  })
})
