import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  asignarProfeAula,
  asignarRol,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * F11-D — guardia de regresión a NIVEL DE DATOS para el barrido
 * `createServiceClient` (cookie-bound) → `createServiceRoleClient` (service role
 * real, cookie-less).
 *
 * El bug original era SILENCIOSO: bajo la sesión de un emisor no privilegiado,
 * el cliente cookie-bound adjuntaba el JWT del usuario y la RLS filtraba las
 * lecturas cross-user → 0 filas SIN error. En especial `enviarPushANotificarUsuarios`
 * leía las suscripciones de los DESTINATARIOS bajo `usuario_id = auth.uid()` → 0 →
 * push a nadie.
 *
 * Con el fix, los helpers usan service role real (bypass de RLS, independiente de
 * la sesión), así que con datos sembrados resuelven N>0. Como Vitest no tiene
 * sesión de Next, esta es una aserción PERMANENTE del comportamiento correcto
 * (sustituye la sonda con-sesión del diagnóstico): los helpers leen cross-user.
 *
 * `web-push` se mockea: aquí verificamos que el motor LEE las subs de los
 * destinatarios, no que las envíe por red.
 */
const sendNotification = vi.fn(async () => ({ statusCode: 201 }))
const setVapidDetails = vi.fn()
vi.mock('web-push', () => ({
  default: { setVapidDetails, sendNotification },
  setVapidDetails,
  sendNotification,
}))

describe('F11-D — push/audiencia resuelve destinatarios vía service-role', () => {
  let centro: { id: string }
  let nino: { id: string }
  let emisor: TestUser // tutor legal NO privilegiado que dispara la notificación
  let tutorDest: TestUser // co-tutor con `puede_recibir_mensajes` → destinatario
  let profeDest: TestUser // profe del aula → destinatario

  beforeAll(async () => {
    // `enviarPushANotificarUsuarios` hace short-circuit (`return total:0`) si faltan
    // las VAPID env. En CI no hay `.env.local` ni secretos VAPID, así que sin esto el
    // motor nunca llega al SELECT que este test verifica. `web-push` está mockeado, así
    // que valores dummy bastan (no se valida el formato de la clave). Stub local al test.
    vi.stubEnv('VAPID_PUBLIC_KEY', 'test-vapid-public-key')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'test-vapid-private-key')
    vi.stubEnv('VAPID_SUBJECT', 'mailto:test@nido.test')

    centro = await createTestCentro('Centro F11D push')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino F11D')
    // Matrícula ACTIVA explícita (criterio app/RLS: estado='activa').
    const { error: mErr } = await serviceClient.from('matriculas').insert({
      nino_id: nino.id,
      aula_id: aula.id,
      curso_academico_id: curso.id,
      fecha_alta: '2026-09-01',
      estado: 'activa',
    })
    if (mErr) throw new Error(`matricular falló: ${mErr.message}`)

    emisor = await createTestUser({ nombre: 'Emisor Tutor' })
    tutorDest = await createTestUser({ nombre: 'Tutor Destinatario' })
    profeDest = await createTestUser({ nombre: 'Profe Destinataria' })
    await crearVinculo(nino.id, emisor.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })
    await crearVinculo(nino.id, tutorDest.id, 'tutor_legal_secundario', {
      puede_recibir_mensajes: true,
    })
    await asignarRol(profeDest.id, centro.id, 'profe')
    await asignarProfeAula(profeDest.id, aula.id)

    // Suscripciones push de los DESTINATARIOS (no del emisor): es justo lo que la
    // RLS estricta `usuario_id = auth.uid()` ocultaría al cliente cookie-bound.
    const { error: sErr } = await serviceClient.from('push_subscriptions').insert([
      {
        usuario_id: tutorDest.id,
        endpoint: 'https://fcm.example/f11d-td',
        p256dh: 'p256dh'.repeat(3),
        auth: 'auth-token-f11d',
      },
      {
        usuario_id: profeDest.id,
        endpoint: 'https://fcm.example/f11d-pd',
        p256dh: 'p256dh'.repeat(3),
        auth: 'auth-token-f11d',
      },
    ])
    if (sErr) throw new Error(`seed subs falló: ${sErr.message}`)
  })

  afterAll(async () => {
    await deleteTestCentro(centro.id)
    await deleteTestUser(emisor.id)
    await deleteTestUser(tutorDest.id)
    await deleteTestUser(profeDest.id)
    vi.unstubAllEnvs()
  })

  it('destinatariosDeNino: co-tutor con flag + profe del aula, excluye al emisor (N>0)', async () => {
    const { destinatariosDeNino } = await import('@/features/push/lib/audiencia')
    const dest = await destinatariosDeNino(nino.id, emisor.id)
    expect(dest).toContain(tutorDest.id)
    expect(dest).toContain(profeDest.id)
    expect(dest).not.toContain(emisor.id)
  })

  it('expandirDestinatariosRecordatorio (familia_individual): co-tutor con flag (N>0)', async () => {
    const { expandirDestinatariosRecordatorio } =
      await import('@/features/recordatorios/lib/audiencia')
    const dest = await expandirDestinatariosRecordatorio(
      {
        destinatario: 'familia_individual',
        centro_id: centro.id,
        nino_id: nino.id,
        aula_id: null,
        usuario_destinatario_id: null,
      },
      emisor.id
    )
    expect(dest).toContain(tutorDest.id)
    expect(dest.length).toBeGreaterThan(0)
  })

  it('enviarPushANotificarUsuarios: LEE las subs de los destinatarios (total>0, no 0)', async () => {
    const { enviarPushANotificarUsuarios } = await import('@/features/push/lib/enviar-push')
    const res = await enviarPushANotificarUsuarios([tutorDest.id, profeDest.id], {
      titulo: 'T',
      cuerpo: 'C',
      url: '/x',
    })
    // El bug daba total=0 (subs invisibles bajo la sesión del emisor). Service role
    // real lee las 2 suscripciones sembradas.
    expect(res.total).toBe(2)
    expect(res.enviados).toBe(2)
  })
})
