import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  altaEnProceso,
  fueAlumno,
  type SenalMatricula,
} from '@/features/matriculas/lib/estado-alumno'

import {
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  deleteTestCentro,
  serviceClient,
} from './setup'

/**
 * ALUMNOS · `matriculas.activada_at` — los 4 casos de las pestañas de alumnos.
 *
 * El modelo no registraba que una matrícula hubiese llegado a estar `activa`: `archivar_nino`
 * escribe `estado='baja'` SOBRE LA MISMA FILA viniendo de 'pendiente', 'lista' o 'activa'. Un
 * ex-alumno y un alta a medias archivada quedaban idénticos, así que "Niños" no podía filtrar
 * a los que nunca fueron alumnos sin cargarse el archivo de ex-alumnos.
 *
 * Este fichero fija el comportamiento sobre filas REALES, no sobre objetos de mentira: el
 * sello lo pone el trigger de BD ante los mismos UPDATE/INSERT que hacen `activarMatricula`,
 * `desarchivar_nino` y `archivar_nino`. Los tests unitarios de `estado-alumno.ts` cubren la
 * decisión pura; lo que aquí se comprueba es que la BD produce las señales que esa decisión
 * espera.
 *
 * FIXTURE AISLADO: centro propio `@nido.test` (invariante del wipe: nunca alcanza a un centro
 * real) y `deleteTestCentro` en el teardown. No toca ni lee datos de ningún centro real.
 *
 * Gateado: ALUMNOS_ACTIVADA_AT_MIGRATION_APPLIED=1 (requiere
 * `20260830120000_phase_matriculas_activada_at`). Sin la migración aplicada no corre.
 */

const APPLIED = process.env.ALUMNOS_ACTIVADA_AT_MIGRATION_APPLIED === '1'

/** Lee del remoto las señales de un niño tal y como las leen las tres queries de producción. */
async function senalesDe(ninoId: string): Promise<SenalMatricula[]> {
  const { data, error } = await serviceClient
    .from('matriculas')
    .select('estado, activada_at')
    .eq('nino_id', ninoId)
    .is('deleted_at', null)
  if (error) throw new Error(`senalesDe falló: ${error.message}`)
  return (data ?? []) as SenalMatricula[]
}

/**
 * Crea el ALTA A MEDIAS que estos casos necesitan: una matrícula en `pendiente`.
 *
 * No sirve el `matricular()` de `setup.ts`: inserta sin `estado`, y la columna tiene
 * `DEFAULT 'activa'`, así que la fila nace matriculada Y —desde esta migración— sellada por
 * el trigger en el propio INSERT. Ese default es correcto para los tests que solo quieren
 * "un niño matriculado", por eso se deja intacto y el estado se fuerza aquí.
 */
async function matricularPendiente(
  ninoId: string,
  aulaId: string,
  cursoId: string
): Promise<string> {
  const { data, error } = await serviceClient
    .from('matriculas')
    .insert({
      nino_id: ninoId,
      aula_id: aulaId,
      curso_academico_id: cursoId,
      fecha_alta: '2026-09-01',
      estado: 'pendiente',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`matricularPendiente falló: ${error?.message}`)
  return data.id
}

/** Cierra una matrícula igual que hace `archivar_nino`: UPDATE en la MISMA fila. */
async function darDeBaja(matriculaId: string): Promise<void> {
  const { error } = await serviceClient
    .from('matriculas')
    .update({ estado: 'baja', fecha_baja: '2027-06-30', motivo_baja: 'fin de etapa' })
    .eq('id', matriculaId)
  if (error) throw new Error(`darDeBaja falló: ${error.message}`)
}

describe.skipIf(!APPLIED)('activada_at — quién es alumno y qué alta sigue en proceso', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }

  beforeAll(async () => {
    centro = await createTestCentro('Centro activada_at')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
  })

  afterAll(async () => {
    await deleteTestCentro(centro.id)
  })

  it('CASO 1 · alta a medias (nunca activada): NO es alumno, SÍ sigue en Admisiones', async () => {
    const nino = await createTestNino(centro.id, 'Alta A Medias')
    await matricularPendiente(nino.id, aula.id, curso.id)

    const senales = await senalesDe(nino.id)
    expect(senales).toHaveLength(1)
    expect(senales[0].estado).toBe('pendiente')
    // Nadie la activó → el trigger no ha sellado nada.
    expect(senales[0].activada_at).toBeNull()

    expect(fueAlumno(senales)).toBe(false) // fuera de Niños y del archivo
    expect(altaEnProceso(senales)).toBe(true) // sigue en Admisiones
  })

  it('CASO 2 · matriculado: el trigger SELLA al pasar a activa; sale de Admisiones', async () => {
    const nino = await createTestNino(centro.id, 'Matriculado')
    const matriculaId = await matricularPendiente(nino.id, aula.id, curso.id)

    const antes = await senalesDe(nino.id)
    expect(antes[0].activada_at).toBeNull()

    // Exactamente lo que hace `activarMatricula`: un UPDATE del estado, sin tocar la columna.
    const { error } = await serviceClient
      .from('matriculas')
      .update({ estado: 'activa' })
      .eq('id', matriculaId)
    expect(error).toBeNull()

    const despues = await senalesDe(nino.id)
    expect(despues[0].estado).toBe('activa')
    expect(despues[0].activada_at).not.toBeNull() // ← lo sella la BD, no la app

    expect(fueAlumno(despues)).toBe(true) // aparece en Niños
    expect(altaEnProceso(despues)).toBe(false) // desaparece de Admisiones
  })

  it('CASO 3 · ex-alumno: el sello SOBREVIVE a la baja → sigue siendo alumno', async () => {
    const nino = await createTestNino(centro.id, 'Ex Alumno')
    // Arranca en 'pendiente' y se ACTIVA: así el sello lo pone la activación, que es la
    // historia de un ex-alumno. Naciendo 'activa' el sello vendría del INSERT y este caso
    // sería un duplicado del último.
    const matriculaId = await matricularPendiente(nino.id, aula.id, curso.id)
    await serviceClient.from('matriculas').update({ estado: 'activa' }).eq('id', matriculaId)

    const activo = await senalesDe(nino.id)
    const selloOriginal = activo[0].activada_at
    expect(selloOriginal).not.toBeNull()

    await darDeBaja(matriculaId)

    const exAlumno = await senalesDe(nino.id)
    expect(exAlumno[0].estado).toBe('baja')
    // El sello no se borra ni se mueve: es la prueba de que fue alumno.
    expect(exAlumno[0].activada_at).toBe(selloOriginal)

    expect(fueAlumno(exAlumno)).toBe(true) // SÍ en Niños / archivo
    expect(altaEnProceso(exAlumno)).toBe(false) // NO en Admisiones
  })

  it('CASO 4 · alta a medias ARCHIVADA: misma baja, pero sin sello → NO ensucia el archivo', async () => {
    const nino = await createTestNino(centro.id, 'A Medias Archivada')
    const matriculaId = await matricularPendiente(nino.id, aula.id, curso.id)
    await darDeBaja(matriculaId) // de 'pendiente' directo a 'baja', sin pasar por activa

    const senales = await senalesDe(nino.id)
    expect(senales[0].estado).toBe('baja')
    expect(senales[0].activada_at).toBeNull()

    // AQUÍ está el valor de la columna: por `estado` este caso y el CASO 3 son idénticos
    // ('baja'), y antes eran indistinguibles. El sello los separa.
    expect(fueAlumno(senales)).toBe(false) // fuera del archivo
    expect(altaEnProceso(senales)).toBe(false) // y tampoco vuelve a Admisiones
  })

  it('el sello es IDEMPOTENTE: reactivar no pisa la primera activación', async () => {
    const nino = await createTestNino(centro.id, 'Reactivado')
    const matriculaId = await matricularPendiente(nino.id, aula.id, curso.id)
    await serviceClient.from('matriculas').update({ estado: 'activa' }).eq('id', matriculaId)
    const primero = (await senalesDe(nino.id))[0].activada_at

    await darDeBaja(matriculaId)
    await serviceClient
      .from('matriculas')
      .update({ estado: 'activa', fecha_baja: null, motivo_baja: null })
      .eq('id', matriculaId)

    expect((await senalesDe(nino.id))[0].activada_at).toBe(primero)
  })

  it('un INSERT que ya nace activa (desarchivar_nino) también queda sellado', async () => {
    const nino = await createTestNino(centro.id, 'Desarchivado')
    const { data, error } = await serviceClient
      .from('matriculas')
      .insert({
        nino_id: nino.id,
        aula_id: aula.id,
        curso_academico_id: curso.id,
        fecha_alta: '2026-09-01',
        estado: 'activa',
      })
      .select('activada_at')
      .single()

    expect(error).toBeNull()
    // Si el sello viviera solo en `activarMatricula`, esta fila entraría sin sellar y el
    // niño desaparecería de Niños pese a estar matriculado. Por eso el trigger cubre INSERT.
    expect(data?.activada_at).not.toBeNull()
  })
})
