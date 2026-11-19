import { describe, expect, it } from 'vitest'

import { fichaLegible, valorLegible } from '../ficha-legible'
import { faltanDeHint } from '../gate-alta'

/** Traductor que devuelve la clave: así se ve qué etiqueta y qué valor eligió cada campo. */
const t = (k: string) => k

/**
 * Fase 10b-2: la ficha que se firma, en palabras. Las etiquetas y los valores son los del export del
 * art. 15, para que la ficha firmada y el export digan lo mismo. Lo que se firma es el `jsonb` y su
 * sello; esto solo cuenta cómo se lee.
 */
describe('la ficha en palabras (10b-2)', () => {
  it('valores: vacío, sí/no, sexo, respuesta y forma, estado civil, fechas, enums conocidos y texto libre', () => {
    expect(valorLegible('dni', null, t)).toBe('—')
    expect(valorLegible('dni', '', t)).toBe('—')
    expect(valorLegible('tiene_hermanos_en_centro', true, t)).toBe('export.doc.si')
    expect(valorLegible('sexo', 'F', t)).toBe('export.doc.sexo.F')
    expect(valorLegible('respuesta', 'mensual', t)).toBe('export.doc.respuesta_servicio.mensual')
    expect(valorLegible('forma', 'efectivo', t)).toBe('export.doc.forma_gastos.efectivo')
    expect(valorLegible('estado_civil_familia', 'casados', t)).toBe(
      'alta.tutor.estado_civil_opciones.casados'
    )
    expect(valorLegible('fecha_nacimiento', '2025-03-01', t)).toBe('01/03/2025')
    expect(valorLegible('lactancia_estado', 'materna', t)).toBe('export.doc.valores.materna')
    expect(valorLegible('idiomas_casa', ['es', 'va'], t)).toBe(
      'export.doc.valores.es, export.doc.valores.va'
    )
    // Un texto libre que parece un código pero no está en el catálogo se respeta tal cual.
    expect(valorLegible('alergias_graves', 'cacahuete', t)).toBe('cacahuete')
    expect(valorLegible('hermanos_total', 2, t)).toBe('2')
  })

  it('secciones en el orden de lo declarado; sin los identificadores internos; una por tutor', () => {
    const ficha = {
      version: 1,
      nino: { nombre: 'Niño Demo 1', estado_civil_familia: 'casados' },
      tutores: [
        { rol_familia: 'titular', nombre_completo: 'Tutor Demo' },
        { rol_familia: 'segundo_tutor' },
      ],
      pedagogicos: { lactancia_estado: 'materna' },
      servicios: [{ servicio: 'comedor', respuesta: 'mensual', concepto_id: 'x' }],
      gastos_gestion: [{ curso_academico_id: 'y', forma: 'efectivo', con_justificante: false }],
      imagen: [
        { usuario_id: 'u1', respuesta: 'no', aceptado_en: '2026-11-18T10:00:00Z' },
        { usuario_id: 'u2', respuesta: 'si', aceptado_en: '2026-11-17T10:00:00Z' },
      ],
      medico: { alergias_graves: 'cacahuete', medico_familia: null },
    }
    const s = fichaLegible(ficha, t, (id) => (id === 'u1' ? 'Tutor Demo' : null))
    expect(s.map((x) => x.seccion)).toEqual([
      'nino',
      'tutor',
      'tutor',
      'pedagogicos',
      'servicios',
      'gastos',
      'imagen',
      'medico',
    ])
    expect(s[0]!.filas).toContainEqual({
      etiqueta: 'alta.tutor.estado_civil',
      valor: 'alta.tutor.estado_civil_opciones.casados',
    })
    // Ni la versión ni los ids salen en ninguna sección.
    const etiquetas = s.flatMap((x) => x.filas.map((f) => f.etiqueta))
    expect(etiquetas.some((e) => /concepto_id|curso_academico_id|usuario_id|version/.test(e))).toBe(
      false
    )
    expect(s[4]!.filas).toEqual([
      { etiqueta: 'export.doc.valores.comedor', valor: 'export.doc.respuesta_servicio.mensual' },
    ])
    // La respuesta de imagen, con el nombre del tutor si se conoce; si no, «—».
    expect(s[6]!.filas).toEqual([
      { etiqueta: 'Tutor Demo', valor: 'export.doc.no (18/11/2026)' },
      { etiqueta: '—', valor: 'export.doc.si (17/11/2026)' },
    ])
  })

  it('sin servicios, gastos ni imagen, esas secciones no salen', () => {
    const s = fichaLegible({ nino: {}, tutores: [], pedagogicos: null, medico: {} }, t, () => null)
    expect(s.map((x) => x.seccion)).toEqual(['nino', 'pedagogicos', 'medico'])
  })
})

describe('lo que falta según el HINT con que la base frena el cierre', () => {
  it('cada HINT de completitud a su bloque, y el resto a null', () => {
    expect(faltanDeHint('datos_nino_por_completar')).toEqual(['identidad'])
    expect(faltanDeHint('datos_tutor_por_completar')).toEqual(['tutor1', 'tutor2'])
    expect(faltanDeHint('servicios_por_contestar')).toEqual(['servicios'])
    expect(faltanDeHint('gastos_por_contestar')).toEqual(['gastos'])
    expect(faltanDeHint('documentos_por_firmar')).toEqual(['documentos_centro'])
    expect(faltanDeHint('imagen_sin_respuesta')).toEqual(['imagen'])
    expect(faltanDeHint('ficha_cambiada')).toBeNull()
    expect(faltanDeHint(null)).toBeNull()
  })
})
