import { createHash } from 'crypto'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS del REGISTRO DE ADMINISTRACIÓN DE MEDICACIÓN con doble confirmación
 * (F8-3b). **Gated** por `F8_3B_MIGRATION_APPLIED=1`: la migración
 * `20260608120000_phase8_3b_registro_administracion.sql` se aplica manualmente
 * vía SQL Editor (CLI con bug SIGILL).
 *
 *   F8_3B_MIGRATION_APPLIED=1 npm run test:rls -- administraciones-medicacion.rls
 *
 * Cubre (decisión 2026-06-08, Opción A — una tabla, confirmación = UPDATE acotado):
 *  - INSERT con confirmado_por NULL ok (registro pendiente por staff del niño).
 *  - INSERT con confirmado_por no-NULL bloqueado (no se autoconfirma ni se nombra al 2.º).
 *  - Confirmar por un 2.º staff distinto ok (fija confirmado_at en BD).
 *  - Autoconfirmar (mismo uid que administró) bloqueado.
 *  - Reconfirmar / editar otras columnas bloqueado (trigger de congelación).
 *  - Registrar sobre medicación NO vigente (caducada) o NO firmada bloqueado.
 *  - DELETE denegado a todos (append-only).
 *  - Aislamiento por ámbito (staff de otra aula/centro; tutor ajeno).
 *  - La FAMILIA del niño LEE el registro (transparencia); registrar NO.
 */
const MIGRATION_APPLIED = process.env.F8_3B_MIGRATION_APPLIED === '1'

const TEXTO_REAL =
  'Autorizo la administración de la medicación descrita. Texto del formato estándar.'
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const SVG_TRAZO = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>'

/** Hoy en huso Madrid como YYYY-MM-DD, con desplazamiento opcional en días. */
function ymdMadrid(offsetDias = 0): string {
  const base = new Date()
  base.setUTCDate(base.getUTCDate() + offsetDias)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(base)
}

type AdminInsert = Database['public']['Tables']['administraciones_medicacion']['Insert']
type FirmaInsert = Database['public']['Tables']['firmas_autorizacion']['Insert']

describe.skipIf(!MIGRATION_APPLIED)(
  'RLS administraciones_medicacion — F8-3b (doble confirmación)',
  () => {
    let centro: { id: string }
    let centroB: { id: string }
    let aula: { id: string }
    let admin: TestUser
    let profe1: TestUser // administra
    let profe2: TestUser // confirma (staff distinto del aula)
    let profeB: TestUser // staff de OTRO centro (aislamiento)
    let tutor: TestUser // tutor del niño (lee; no registra)
    let tutorB: TestUser // tutor de otro centro (no ve)
    let nino: { id: string }
    let medInstancia: string // instancia de medicación FIRMADA + VIGENTE hoy
    let medCaducada: string // instancia FIRMADA pero CADUCADA (no administrable)
    let medSinFirmar: string // instancia publicada SIN firma (no administrable)

    const adminsCreadas: string[] = []

    /**
     * Crea una instancia de medicación (es_plantilla=false) publicada para `nino`.
     * `vigenciaDesde` = día de creación (F8-3a). Para una caducada se pasa una fecha
     * pasada coherente (vigencia_hasta >= vigencia_desde lo exige el CHECK de la fila).
     */
    async function crearInstanciaMed(
      plantillaId: string,
      fechaFin: string,
      vigenciaDesde = ymdMadrid(0)
    ): Promise<string> {
      const { data, error } = await serviceClient
        .from('autorizaciones')
        .insert({
          centro_id: centro.id,
          tipo: 'medicacion',
          es_plantilla: false,
          plantilla_id: plantillaId,
          ambito: 'nino',
          nino_id: nino.id,
          titulo: 'Ibuprofeno',
          texto: TEXTO_REAL,
          texto_version: 'v1',
          texto_definitivo: true,
          estado: 'publicada',
          firmantes_requeridos: 'uno_principal',
          vigencia_desde: vigenciaDesde,
          vigencia_hasta: fechaFin,
          creado_por: tutor.id,
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`crearInstanciaMed falló: ${error?.message}`)
      return data.id
    }

    /** Firma 'firmado' del tutor con datos.medicacion (fechas del tratamiento). */
    async function firmarMed(autorizacionId: string, fechaInicio: string, fechaFin: string) {
      const medicacion = {
        medicamento: 'Ibuprofeno',
        dosis: '5 ml',
        pauta: 'cada 8 horas si fiebre',
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
      }
      const { error } = await serviceClient.from('firmas_autorizacion').insert({
        autorizacion_id: autorizacionId,
        nino_id: nino.id,
        firmante_id: tutor.id,
        rol_firmante: 'tutor_legal_principal',
        decision: 'firmado',
        texto_hash: sha256(TEXTO_REAL),
        texto_version: 'v1',
        nombre_tecleado: 'Tutor 3b',
        firma_imagen: SVG_TRAZO,
        datos: { medicacion } as FirmaInsert['datos'],
      })
      if (error) throw new Error(`firmarMed falló: ${error.message}`)
    }

    /** Payload de una administración pendiente (confirmado_por NULL). */
    function adminPayload(staff: TestUser, autorizacionId = medInstancia): AdminInsert {
      return {
        autorizacion_id: autorizacionId,
        nino_id: nino.id,
        centro_id: centro.id,
        administrado_por: staff.id,
        medicamento: 'Ibuprofeno',
        dosis: '5 ml',
      }
    }

    beforeAll(async () => {
      centro = await createTestCentro('Centro 3b')
      centroB = await createTestCentro('Centro 3b B')
      const curso = await createTestCurso(centro.id)
      const cursoB = await createTestCurso(centroB.id)
      aula = await createTestAula(centro.id, curso.id, 'Aula 3b')
      const aulaB = await createTestAula(centroB.id, cursoB.id, 'Aula 3b B')
      nino = await createTestNino(centro.id, '3b Nino')
      const ninoB = await createTestNino(centroB.id, '3b Nino B')
      await matricular(nino.id, aula.id, curso.id)
      await matricular(ninoB.id, aulaB.id, cursoB.id)

      admin = await createTestUser({ nombre: 'Admin 3b' })
      profe1 = await createTestUser({ nombre: 'Profe1 3b' })
      profe2 = await createTestUser({ nombre: 'Profe2 3b' })
      profeB = await createTestUser({ nombre: 'ProfeB 3b' })
      tutor = await createTestUser({ nombre: 'Tutor 3b' })
      tutorB = await createTestUser({ nombre: 'TutorB 3b' })

      await asignarRol(admin.id, centro.id, 'admin')
      await asignarRol(profe1.id, centro.id, 'profe')
      await asignarRol(profe2.id, centro.id, 'profe')
      await asignarRol(profeB.id, centroB.id, 'profe')
      await asignarRol(tutor.id, centro.id, 'tutor_legal')
      await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
      await asignarProfeAula(profe1.id, aula.id)
      await asignarProfeAula(profe2.id, aula.id)
      await asignarProfeAula(profeB.id, aulaB.id)
      await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', {
        puede_recibir_mensajes: true,
      })
      await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal', {
        puede_recibir_mensajes: true,
      })

      // Plantilla de medicación + 3 instancias: vigente, caducada, sin firmar.
      const plantilla = await serviceClient
        .from('autorizaciones')
        .insert({
          centro_id: centro.id,
          tipo: 'medicacion',
          es_plantilla: true,
          titulo: 'Formato medicación',
          texto: TEXTO_REAL,
          texto_version: 'v1',
          texto_definitivo: true,
          estado: 'publicada',
          creado_por: admin.id,
        })
        .select('id')
        .single()
      if (plantilla.error || !plantilla.data)
        throw new Error(`plantilla med falló: ${plantilla.error?.message}`)

      medInstancia = await crearInstanciaMed(plantilla.data.id, ymdMadrid(30))
      await firmarMed(medInstancia, ymdMadrid(-2), ymdMadrid(30)) // hoy ∈ [inicio, fin]

      // Caducada: creada hace 10 días, tratamiento terminó ayer (fila coherente).
      medCaducada = await crearInstanciaMed(plantilla.data.id, ymdMadrid(-1), ymdMadrid(-10))
      await firmarMed(medCaducada, ymdMadrid(-10), ymdMadrid(-1)) // fecha_fin < hoy

      medSinFirmar = await crearInstanciaMed(plantilla.data.id, ymdMadrid(30)) // sin firma
    }, 60_000)

    afterEach(async () => {
      for (const id of adminsCreadas.splice(0)) {
        await serviceClient.from('administraciones_medicacion').delete().eq('id', id)
      }
    })

    afterAll(async () => {
      await deleteTestCentro(centro.id)
      await deleteTestCentro(centroB.id)
      for (const u of [admin, profe1, profe2, profeB, tutor, tutorB]) await deleteTestUser(u.id)
    })

    /** Inserta una administración pendiente (service role) y la registra para limpieza. */
    async function seedPendiente(): Promise<string> {
      const { data, error } = await serviceClient
        .from('administraciones_medicacion')
        .insert(adminPayload(profe1))
        .select('id')
        .single()
      if (error || !data) throw new Error(`seedPendiente falló: ${error?.message}`)
      adminsCreadas.push(data.id)
      return data.id
    }

    // === INSERT (registrar) ====================================================

    it('staff registra una administración PENDIENTE (confirmado_por NULL)', async () => {
      const c = await clientFor(profe1)
      const r = await c
        .from('administraciones_medicacion')
        .insert(adminPayload(profe1))
        .select('id, confirmado_por, confirmado_at')
        .maybeSingle()
      expect(r.error, 'el profe del aula debe poder registrar').toBeNull()
      expect(r.data?.id).toBeTruthy()
      expect(r.data?.confirmado_por, 'nace pendiente').toBeNull()
      expect(r.data?.confirmado_at).toBeNull()
      if (r.data?.id) adminsCreadas.push(r.data.id)
    })

    it('INSERT nombrando al 2.º (confirmado_por no-NULL) está bloqueado', async () => {
      const c = await clientFor(profe1)
      const r = await c
        .from('administraciones_medicacion')
        .insert({ ...adminPayload(profe1), confirmado_por: profe2.id })
        .select('id')
        .maybeSingle()
      expect(r.data?.id, 'no se puede nombrar al confirmador al crear').toBeFalsy()
    })

    it('registrar como otro staff (administrado_por <> auth.uid()) está bloqueado', async () => {
      const c = await clientFor(profe1)
      const r = await c
        .from('administraciones_medicacion')
        .insert(adminPayload(profe2)) // dice que lo administró profe2, pero firma profe1
        .select('id')
        .maybeSingle()
      expect(r.data?.id, 'administrado_por debe ser auth.uid()').toBeFalsy()
    })

    it('la FAMILIA no puede registrar (solo staff)', async () => {
      const c = await clientFor(tutor)
      const r = await c
        .from('administraciones_medicacion')
        .insert({ ...adminPayload(profe1), administrado_por: tutor.id })
        .select('id')
        .maybeSingle()
      expect(r.data?.id, 'el tutor no administra').toBeFalsy()
    })

    it('registrar sobre medicación CADUCADA está bloqueado', async () => {
      const c = await clientFor(profe1)
      const r = await c
        .from('administraciones_medicacion')
        .insert({ ...adminPayload(profe1, medCaducada) })
        .select('id')
        .maybeSingle()
      expect(r.data?.id, 'fecha_fin < hoy → no administrable').toBeFalsy()
    })

    it('registrar sobre medicación SIN firmar está bloqueado', async () => {
      const c = await clientFor(profe1)
      const r = await c
        .from('administraciones_medicacion')
        .insert({ ...adminPayload(profe1, medSinFirmar) })
        .select('id')
        .maybeSingle()
      expect(r.data?.id, 'sin firma → no administrable').toBeFalsy()
    })

    // === UPDATE (confirmar) ====================================================

    it('un 2.º staff distinto confirma; confirmado_at queda fijado en BD', async () => {
      const id = await seedPendiente()
      const c = await clientFor(profe2)
      const r = await c
        .from('administraciones_medicacion')
        .update({ confirmado_por: profe2.id })
        .eq('id', id)
        .select('id, confirmado_por, confirmado_at')
        .maybeSingle()
      expect(r.error, 'el 2.º staff debe poder confirmar').toBeNull()
      expect(r.data?.confirmado_por).toBe(profe2.id)
      expect(r.data?.confirmado_at, 'el trigger fija confirmado_at').toBeTruthy()
    })

    it('el admin del centro también puede confirmar (staff distinto)', async () => {
      const id = await seedPendiente()
      const c = await clientFor(admin)
      const r = await c
        .from('administraciones_medicacion')
        .update({ confirmado_por: admin.id })
        .eq('id', id)
        .select('id, confirmado_por')
        .maybeSingle()
      expect(r.error).toBeNull()
      expect(r.data?.confirmado_por).toBe(admin.id)
    })

    it('autoconfirmar (mismo uid que administró) está bloqueado', async () => {
      const id = await seedPendiente() // administrado_por = profe1
      const c = await clientFor(profe1)
      const r = await c
        .from('administraciones_medicacion')
        .update({ confirmado_por: profe1.id })
        .eq('id', id)
        .select('id')
        .maybeSingle()
      // RLS USING (administrado_por <> auth.uid()) → 0 filas; no confirma.
      expect(r.data?.id, 'el que administró no se autoconfirma').toBeFalsy()
      const { data: check } = await serviceClient
        .from('administraciones_medicacion')
        .select('confirmado_por')
        .eq('id', id)
        .single()
      expect(check?.confirmado_por, 'sigue pendiente').toBeNull()
    })

    it('confirmar nombrando a OTRO (confirmado_por <> auth.uid()) está bloqueado', async () => {
      const id = await seedPendiente()
      const c = await clientFor(profe2)
      const r = await c
        .from('administraciones_medicacion')
        .update({ confirmado_por: admin.id }) // profe2 intenta poner a admin
        .eq('id', id)
        .select('id')
        .maybeSingle()
      expect(r.data?.id, 'WITH CHECK confirmado_por = auth.uid()').toBeFalsy()
    })

    it('reconfirmar una ya confirmada está bloqueado (USING pendiente → 0 filas)', async () => {
      const id = await seedPendiente()
      const c2 = await clientFor(profe2)
      await c2
        .from('administraciones_medicacion')
        .update({ confirmado_por: profe2.id })
        .eq('id', id)
      // admin intenta re-confirmar.
      const c = await clientFor(admin)
      const r = await c
        .from('administraciones_medicacion')
        .update({ confirmado_por: admin.id })
        .eq('id', id)
        .select('id')
        .maybeSingle()
      expect(r.data?.id, 'ya confirmada → no se vuelve a tocar').toBeFalsy()
    })

    it('editar otras columnas (notas) en una pendiente está bloqueado (trigger congela)', async () => {
      const id = await seedPendiente()
      const c = await clientFor(profe2)
      // Cambiar notas sin confirmar → el trigger exige que el único cambio sea confirmar.
      const r = await c
        .from('administraciones_medicacion')
        .update({ notas: 'manipulado' })
        .eq('id', id)
        .select('id')
        .maybeSingle()
      expect(r.error, 'el trigger debe rechazar cambiar el contenido').not.toBeNull()
    })

    // === DELETE ================================================================

    it('DELETE está denegado a todos (append-only)', async () => {
      const id = await seedPendiente()
      for (const u of [profe1, profe2, admin, tutor]) {
        const c = await clientFor(u)
        await c.from('administraciones_medicacion').delete().eq('id', id)
      }
      const { data } = await serviceClient
        .from('administraciones_medicacion')
        .select('id')
        .eq('id', id)
        .maybeSingle()
      expect(data?.id, 'la fila sigue existiendo (DELETE bloqueado)').toBe(id)
    })

    // === Lectura / aislamiento =================================================

    it('staff del niño y familia LEEN el registro; staff y tutor de otro centro NO', async () => {
      const id = await seedPendiente()

      for (const u of [profe1, profe2, admin, tutor]) {
        const c = await clientFor(u)
        const { data } = await c
          .from('administraciones_medicacion')
          .select('id')
          .eq('id', id)
          .maybeSingle()
        expect(data?.id, `${u.id} debe leer el registro`).toBe(id)
      }

      for (const u of [profeB, tutorB]) {
        const c = await clientFor(u)
        const { data } = await c
          .from('administraciones_medicacion')
          .select('id')
          .eq('id', id)
          .maybeSingle()
        expect(data?.id, `${u.id} (otro centro) no debe ver el registro`).toBeFalsy()
      }
    })

    it('staff de OTRO centro no puede registrar (fuera de ámbito)', async () => {
      const c = await clientFor(profeB)
      const r = await c
        .from('administraciones_medicacion')
        .insert({ ...adminPayload(profeB) })
        .select('id')
        .maybeSingle()
      expect(r.data?.id, 'profe de otro centro no registra a este niño').toBeFalsy()
    })
  }
)
