import { describe, expect, it } from 'vitest'

import {
  CAMPOS_IDENTIDAD_COLA,
  cambiosIdentidad,
  clavesQueCambian,
  normalizarDni,
  type IdentidadGuardada,
} from '../diff'

/**
 * Puerta de identidad (2026-11-08): la cola recibe solo lo que cambia, normalizado como lo guarda
 * la base (`actualizar_identidad_nino_tutor`, 20270113120000). Si la app y la base normalizaran
 * distinto, la app encolaría lo que la base da por igual, o al revés.
 */

const GUARDADA: IdentidadGuardada = {
  nombre: 'Lucía',
  primer_apellido: 'García',
  segundo_apellido: 'López',
  fecha_nacimiento: '2024-03-15',
  sexo: 'F',
  nacionalidad: 'española',
  lugar_nacimiento: 'Valencia',
  dni: '12345678Z',
}

describe('cambiosIdentidad', () => {
  it('los ocho campos de la cola son los decididos el 2026-11-07', () => {
    expect([...CAMPOS_IDENTIDAD_COLA].sort()).toEqual(
      [
        'dni',
        'fecha_nacimiento',
        'lugar_nacimiento',
        'nacionalidad',
        'nombre',
        'primer_apellido',
        'segundo_apellido',
        'sexo',
      ].sort()
    )
  })

  it('lo mismo que está guardado no es un cambio', () => {
    expect(cambiosIdentidad({ ...GUARDADA }, GUARDADA)).toEqual({})
  })

  it('el mismo valor escrito de otra forma tampoco (espacios, DNI con puntos y minúscula)', () => {
    const c = cambiosIdentidad(
      {
        primer_apellido: '  García ',
        segundo_apellido: ' López',
        lugar_nacimiento: ' Valencia ',
        dni: '12.345.678-z',
      },
      GUARDADA
    )
    expect(c).toEqual({})
  })

  it('cada uno de los ocho, cambiado solo, es un cambio y solo él', () => {
    const otro: Record<string, string> = {
      nombre: 'Lucia',
      primer_apellido: 'Garcia',
      segundo_apellido: 'Lopez',
      fecha_nacimiento: '2024-03-16',
      sexo: 'X',
      nacionalidad: 'italiana',
      lugar_nacimiento: 'Alzira',
      dni: 'X1234567L',
    }
    for (const campo of CAMPOS_IDENTIDAD_COLA) {
      // Los apellidos van en pareja, como los manda la app: con el primero llega el segundo (si no,
      // el segundo es «no tiene» y también cambia), y con el segundo, el primero sin cambiar.
      const propuesta =
        campo === 'segundo_apellido'
          ? { primer_apellido: GUARDADA.primer_apellido, segundo_apellido: otro[campo] }
          : campo === 'primer_apellido'
            ? { primer_apellido: otro[campo], segundo_apellido: GUARDADA.segundo_apellido }
            : { [campo]: otro[campo] }
      expect.soft(cambiosIdentidad(propuesta, GUARDADA), campo).toEqual({ [campo]: otro[campo] })
    }
  })

  it('NULL o ausente es «no tocar», no «borrar»', () => {
    expect(
      cambiosIdentidad(
        { nombre: null, sexo: null, nacionalidad: null, dni: null, lugar_nacimiento: null },
        GUARDADA
      )
    ).toEqual({})
  })

  it('el primer apellido sin el segundo quita el segundo: la pareja, como en la base', () => {
    expect(cambiosIdentidad({ primer_apellido: 'García' }, GUARDADA)).toEqual({
      segundo_apellido: null,
    })
  })

  it('con el primer apellido, el segundo vacío es «no tiene» y quitarlo es un cambio', () => {
    expect(cambiosIdentidad({ primer_apellido: 'García', segundo_apellido: '' }, GUARDADA)).toEqual(
      { segundo_apellido: null }
    )
    expect(
      cambiosIdentidad(
        { primer_apellido: 'García', segundo_apellido: '' },
        { ...GUARDADA, segundo_apellido: null }
      )
    ).toEqual({})
  })

  it('el DNI y el lugar vacíos borran lo guardado; con nada guardado, no es un cambio', () => {
    expect(cambiosIdentidad({ dni: ' ', lugar_nacimiento: '' }, GUARDADA)).toEqual({
      dni: null,
      lugar_nacimiento: null,
    })
    expect(
      cambiosIdentidad(
        { dni: '', lugar_nacimiento: '' },
        { ...GUARDADA, dni: null, lugar_nacimiento: null }
      )
    ).toEqual({})
  })

  it('normaliza el DNI como la base: sin espacios, puntos ni guiones, en mayúsculas', () => {
    expect(normalizarDni(' 12.345.678-z ')).toBe('12345678Z')
    expect(normalizarDni('x-1234567-l')).toBe('X1234567L')
    expect(normalizarDni(' . - ')).toBeNull()
  })
})

describe('clavesQueCambian', () => {
  const guardado = { direccion_calle: 'Mayor', direccion_cp: null, direccion_ciudad: 'Valencia' }

  it('solo lo distinto; undefined no se mira; NULL y ausente valen lo mismo', () => {
    expect(
      clavesQueCambian(
        {
          direccion_calle: 'Mayor',
          direccion_cp: null,
          direccion_ciudad: 'Alzira',
          direccion_numero: undefined,
        },
        guardado
      )
    ).toEqual({ direccion_ciudad: 'Alzira' })
  })

  it('borrar lo que había es un cambio', () => {
    expect(clavesQueCambian({ direccion_calle: null }, guardado)).toEqual({ direccion_calle: null })
  })

  it('sin nada guardado, cada valor es un cambio y cada NULL no', () => {
    expect(clavesQueCambian({ direccion_calle: 'Mayor', direccion_cp: null }, null)).toEqual({
      direccion_calle: 'Mayor',
    })
  })
})
