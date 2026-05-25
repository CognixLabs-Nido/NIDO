import { describe, expect, it } from 'vitest'

import {
  ambitoAnuncioEnum,
  anuncioInputSchema,
  esAnuncioAnulado,
  esMensajeAnulado,
  marcarAnuncioErroneoSchema,
  marcarAnuncioLeidoSchema,
  marcarConversacionLeidaSchema,
  marcarMensajeErroneoSchema,
  mensajeInputSchema,
  PREFIX_ANULADO,
} from '../schemas/messaging'

const NINO_UUID = '4f1b1d0a-8e7f-4c8e-9b6d-2a3e6f5c0a91'
const AULA_UUID = 'c3b1e5d0-9d6f-4b8a-9c5d-1a2e6f4c0a02'
const MENSAJE_UUID = 'b7c0e4d2-1a3e-4b5c-9d8f-7e6c5b4a3d2f'
const ANUNCIO_UUID = 'f1e2d3c4-5b6a-4d5e-8f9a-0b1c2d3e4f5a'
const CONV_UUID = 'd9e8c7d6-e5f4-4a2b-9c0d-9e8f7a6b5c4d'

describe('messaging — ENUM ambito_anuncio', () => {
  it('acepta valores válidos', () => {
    expect(ambitoAnuncioEnum.safeParse('aula').success).toBe(true)
    expect(ambitoAnuncioEnum.safeParse('centro').success).toBe(true)
  })
  it('rechaza valores fuera del enum', () => {
    expect(ambitoAnuncioEnum.safeParse('global').success).toBe(false)
    expect(ambitoAnuncioEnum.safeParse('').success).toBe(false)
    expect(ambitoAnuncioEnum.safeParse(null).success).toBe(false)
  })
})

describe('messaging — mensajeInputSchema', () => {
  it('acepta contenido válido', () => {
    const r = mensajeInputSchema.safeParse({
      nino_id: NINO_UUID,
      contenido: 'Hola, ¿qué tal ha comido hoy?',
    })
    expect(r.success).toBe(true)
  })

  it('hace trim del contenido', () => {
    const r = mensajeInputSchema.safeParse({
      nino_id: NINO_UUID,
      contenido: '   hola   ',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.contenido).toBe('hola')
  })

  it('rechaza contenido vacío tras trim', () => {
    const r = mensajeInputSchema.safeParse({
      nino_id: NINO_UUID,
      contenido: '       ',
    })
    expect(r.success).toBe(false)
  })

  it('rechaza contenido > 2000 chars', () => {
    const r = mensajeInputSchema.safeParse({
      nino_id: NINO_UUID,
      contenido: 'a'.repeat(2001),
    })
    expect(r.success).toBe(false)
  })

  it('acepta contenido en el límite (2000 chars exactos)', () => {
    const r = mensajeInputSchema.safeParse({
      nino_id: NINO_UUID,
      contenido: 'a'.repeat(2000),
    })
    expect(r.success).toBe(true)
  })

  it('rechaza nino_id no-uuid', () => {
    const r = mensajeInputSchema.safeParse({
      nino_id: 'no-soy-un-uuid',
      contenido: 'mensaje válido',
    })
    expect(r.success).toBe(false)
  })
})

describe('messaging — anuncioInputSchema (cross-field ámbito ↔ aula)', () => {
  it('ámbito=aula con aula_id es válido', () => {
    const r = anuncioInputSchema.safeParse({
      ambito: 'aula',
      aula_id: AULA_UUID,
      titulo: 'Recordatorio',
      contenido: 'No olvidéis la ropa de cambio',
    })
    expect(r.success).toBe(true)
  })

  it('ámbito=centro con aula_id null es válido', () => {
    const r = anuncioInputSchema.safeParse({
      ambito: 'centro',
      aula_id: null,
      titulo: 'Fiesta de fin de curso',
      contenido: 'Os invitamos a todos los familiares...',
    })
    expect(r.success).toBe(true)
  })

  it('ámbito=aula sin aula_id rechaza con clave i18n específica', () => {
    const r = anuncioInputSchema.safeParse({
      ambito: 'aula',
      aula_id: null,
      titulo: 'OK',
      contenido: 'OK',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === 'aula_id')
      expect(issue?.message).toBe('messages.validation.aula_requerida')
    }
  })

  it('ámbito=centro con aula_id rechaza con clave i18n específica', () => {
    const r = anuncioInputSchema.safeParse({
      ambito: 'centro',
      aula_id: AULA_UUID,
      titulo: 'OK',
      contenido: 'OK',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === 'aula_id')
      expect(issue?.message).toBe('messages.validation.aula_no_aplica_centro')
    }
  })

  it('título vacío tras trim rechaza', () => {
    const r = anuncioInputSchema.safeParse({
      ambito: 'centro',
      aula_id: null,
      titulo: '   ',
      contenido: 'OK',
    })
    expect(r.success).toBe(false)
  })

  it('título > 200 chars rechaza', () => {
    const r = anuncioInputSchema.safeParse({
      ambito: 'centro',
      aula_id: null,
      titulo: 'a'.repeat(201),
      contenido: 'OK',
    })
    expect(r.success).toBe(false)
  })

  it('título en el límite (200 chars) acepta', () => {
    const r = anuncioInputSchema.safeParse({
      ambito: 'centro',
      aula_id: null,
      titulo: 'a'.repeat(200),
      contenido: 'OK',
    })
    expect(r.success).toBe(true)
  })

  it('contenido > 4000 chars rechaza', () => {
    const r = anuncioInputSchema.safeParse({
      ambito: 'centro',
      aula_id: null,
      titulo: 'OK',
      contenido: 'a'.repeat(4001),
    })
    expect(r.success).toBe(false)
  })

  it('contenido en el límite (4000) acepta', () => {
    const r = anuncioInputSchema.safeParse({
      ambito: 'centro',
      aula_id: null,
      titulo: 'OK',
      contenido: 'a'.repeat(4000),
    })
    expect(r.success).toBe(true)
  })
})

describe('messaging — schemas de "marcar como ..."', () => {
  it('marcarConversacionLeidaSchema requiere uuid', () => {
    expect(marcarConversacionLeidaSchema.safeParse({ conversacion_id: CONV_UUID }).success).toBe(
      true
    )
    expect(marcarConversacionLeidaSchema.safeParse({ conversacion_id: 'nope' }).success).toBe(false)
  })

  it('marcarAnuncioLeidoSchema requiere uuid', () => {
    expect(marcarAnuncioLeidoSchema.safeParse({ anuncio_id: ANUNCIO_UUID }).success).toBe(true)
    expect(marcarAnuncioLeidoSchema.safeParse({ anuncio_id: 'nope' }).success).toBe(false)
  })

  it('marcarMensajeErroneoSchema requiere uuid', () => {
    expect(marcarMensajeErroneoSchema.safeParse({ mensaje_id: MENSAJE_UUID }).success).toBe(true)
    expect(marcarMensajeErroneoSchema.safeParse({ mensaje_id: 'nope' }).success).toBe(false)
  })

  it('marcarAnuncioErroneoSchema requiere uuid', () => {
    expect(marcarAnuncioErroneoSchema.safeParse({ anuncio_id: ANUNCIO_UUID }).success).toBe(true)
    expect(marcarAnuncioErroneoSchema.safeParse({ anuncio_id: 'nope' }).success).toBe(false)
  })
})

describe('messaging — helpers de detección de anulado', () => {
  it('esMensajeAnulado detecta flag erroneo', () => {
    expect(esMensajeAnulado({ erroneo: true, contenido: 'lo que sea' })).toBe(true)
  })

  it('esMensajeAnulado detecta prefijo en contenido aunque flag sea false', () => {
    expect(esMensajeAnulado({ erroneo: false, contenido: `${PREFIX_ANULADO}me equivoqué` })).toBe(
      true
    )
  })

  it('esMensajeAnulado devuelve false en mensaje normal', () => {
    expect(esMensajeAnulado({ erroneo: false, contenido: 'mensaje normal' })).toBe(false)
  })

  it('esAnuncioAnulado detecta flag erroneo', () => {
    expect(esAnuncioAnulado({ erroneo: true, titulo: 'X' })).toBe(true)
  })

  it('esAnuncioAnulado detecta prefijo en título aunque flag sea false', () => {
    expect(esAnuncioAnulado({ erroneo: false, titulo: `${PREFIX_ANULADO}título erróneo` })).toBe(
      true
    )
  })

  it('PREFIX_ANULADO mide 10 caracteres ([anulado] + espacio)', () => {
    // El CHECK BD añade 11 chars de margen (10 reales + 1 colchón defensivo)
    // sobre el límite Zod del input: 2000 → 2011 en `mensajes.contenido`,
    // 200 → 211 en `anuncios.titulo`. El test fija el valor para detectar
    // cambios accidentales del prefijo.
    expect(PREFIX_ANULADO.length).toBe(10)
  })
})
