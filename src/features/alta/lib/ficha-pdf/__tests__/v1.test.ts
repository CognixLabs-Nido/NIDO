import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { componerFichaFirmada } from '..'
import type { CopiaFichaFirmada } from '../tipos'
import { componerFichaFirmadaV1 } from '../v1'

/**
 * La condición de la (C) (el responsable, 2026-11-19): «Comprueba que con la versión guardada se
 * compone el mismo documento». La plantilla 1 compone, desde una copia fija, SIEMPRE los mismos
 * bytes, y esos bytes son los escritos aquí (`DORADO`).
 *
 * Si este test se pone rojo porque alguien tocó `v1.ts` o actualizó pdf-lib: NO se reescribe el
 * número. Una familia que firmó con la 1 descargaría otro documento. Se deshace el cambio, o el
 * cambio va a una `v2.ts` (y la base firma con la 2), o se comprueba y se escribe por qué el
 * documento es el mismo. Spec: «10c: el encargo, lo medido abierto y la condición de la (C)».
 */

// Un PNG de 2×2, como el trazo de una firma.
const TRAZO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC'

export const COPIA: CopiaFichaFirmada = {
  firmaId: '00000000-0000-4000-8000-00000000f1c0',
  ninoId: '00000000-0000-4000-8000-00000000a1a0',
  firmadoAt: '2026-11-19T16:29:04.076764+00:00',
  metodoFirma: 'digital',
  rolFirmante: 'tutor_legal_principal',
  nombreTecleado: 'Tutora Demo Ñúñez',
  firmaImagen: TRAZO,
  fichaVersion: 1,
  plantillaPdfVersion: 1,
  contenidoSha256: 'c'.repeat(64),
  ficha: {
    version: 1,
    nino: {
      nombre: 'Niño Demo',
      primer_apellido: 'Pruebas',
      segundo_apellido: null,
      fecha_nacimiento: '2025-03-14',
      sexo: 'F',
      lugar_nacimiento: 'València',
      nacionalidad: 'Española',
      idioma_principal: 'es',
      dni: null,
      sip: 'SIPDEMO0001',
      direccion_calle: 'Calle Ejemplo',
      direccion_numero: '1',
      direccion_cp: '46001',
      direccion_ciudad: 'València',
      direccion_provincia: 'València',
      estado_civil_familia: 'casados',
      hermanos_total: 1,
      hermanos_lugar: 1,
      observaciones_familia:
        'Una observación larga que tiene que partirse en varias líneas porque no cabe en el ancho de la columna de la derecha del documento.',
      como_nos_conocio: 'internet',
      como_nos_conocio_otro: null,
    },
    tutores: [
      {
        rol_familia: 'titular',
        nombre_completo: 'Tutora Demo Ñúñez',
        email: 'tutora@correo.test',
        telefono: '+34600000000',
        fecha_nacimiento: '1985-01-01',
        dni_numero: '12345678Z',
        direccion_calle: 'Calle Ejemplo',
        direccion_numero: '1',
        direccion_cp: '46001',
        direccion_ciudad: 'València',
        estudios: null,
        empresa: null,
      },
    ],
    pedagogicos: {
      lactancia_estado: 'materna',
      lactancia_observaciones: null,
      control_esfinteres: 'panal_completo',
      control_esfinteres_observaciones: null,
      siesta_horario_habitual: '13:00-15:00',
      siesta_numero_diario: 1,
      siesta_observaciones: null,
      tipo_alimentacion: 'omnivora',
      alimentacion_observaciones: null,
      idiomas_casa: ['es', 'va'],
      tiene_hermanos_en_centro: false,
    },
    servicios: [{ servicio: 'comedor', respuesta: 'si', concepto_id: null }],
    gastos_gestion: [
      {
        curso_academico_id: '00000000-0000-4000-8000-00000000c0c0',
        forma: 'transferencia',
        con_justificante: false,
      },
    ],
    imagen: [
      {
        usuario_id: '00000000-0000-4000-8000-0000000071a0',
        respuesta: 'si',
        aceptado_en: '2026-11-19T16:20:00+00:00',
      },
    ],
    medico: {
      alergias_graves: 'Cacahuete',
      notas_emergencia: null,
      medicacion_habitual: null,
      alergias_leves: 'Polen',
      medico_familia: 'Dra. Demo',
      telefono_emergencia: '+34611111111',
    },
  },
}

// Escrito el 2026-11-19 con pdf-lib 1.17.1, antes de ninguna firma en producción (0 en `firmas_ficha`):
// el mismo en otro proceso con TZ=America/New_York y Pacific/Auckland.
const DORADO = '7d0ce53a836b1560544ce174b2c0ae4434d2c0ee5dfe4bfcdf8e966efa5ab860'

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

describe('la plantilla 1 del PDF de la ficha firmada', () => {
  it('compone el documento escrito (el dorado)', async () => {
    const pdf = await componerFichaFirmadaV1(COPIA)
    // Premisa: es un PDF, no un vacío.
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-')
    expect(sha(pdf)).toBe(DORADO)
  })

  it('dos veces, el mismo documento; también con otro huso', async () => {
    const tz = process.env.TZ
    const a = sha(await componerFichaFirmadaV1(COPIA))
    try {
      process.env.TZ = 'Pacific/Auckland'
      expect(sha(await componerFichaFirmadaV1(COPIA))).toBe(a)
    } finally {
      process.env.TZ = tz
    }
    expect(sha(await componerFichaFirmadaV1(COPIA))).toBe(a)
  })

  it('control: otra foto da otro documento (el dorado no es un número cualquiera)', async () => {
    const otra = {
      ...COPIA,
      ficha: {
        ...COPIA.ficha,
        medico: { ...(COPIA.ficha.medico as object), alergias_graves: 'Huevo' },
      },
    }
    expect(sha(await componerFichaFirmadaV1(otra))).not.toBe(
      sha(await componerFichaFirmadaV1(COPIA))
    )
  })

  it('el registro compone cada copia con la plantilla de SU firma', async () => {
    expect(sha(await componerFichaFirmada(COPIA))).toBe(sha(await componerFichaFirmadaV1(COPIA)))
    await expect(componerFichaFirmada({ ...COPIA, plantillaPdfVersion: 99 })).rejects.toThrow(
      'plantilla del PDF desconocida: 99'
    )
  })

  it('la plantilla 1 no compone una ficha de otra versión', async () => {
    await expect(componerFichaFirmadaV1({ ...COPIA, fichaVersion: 2 })).rejects.toThrow(
      'la plantilla 1 no sabe componer la ficha 2'
    )
  })
})
