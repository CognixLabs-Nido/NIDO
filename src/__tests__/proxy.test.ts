import { describe, expect, it } from 'vitest'

import { PROTECTED_PREFIXES, requiredRolesFor } from '../proxy-roles'

/**
 * El proxy (middleware Next.js) decide a qué prefijos puede acceder cada rol
 * antes de que se ejecuten los layouts/pages del árbol. Si el proxy rechaza,
 * la respuesta es un 307 → `/forbidden` sin entrar siquiera a ejecutar el
 * código del layout.
 *
 * Estos tests son la red de seguridad contra regresiones del bug post-F5
 * `fix/admin-access-teacher-asistencia`: el admin tiene que poder entrar a
 * `/teacher/*` (es "super-profe") y los layouts internos ya estaban escritos
 * para aceptarlo. El proxy es la única capa que hay que mantener sincronizada.
 */
describe('proxy — mapa de prefijos protegidos', () => {
  it('PROTECTED_PREFIXES incluye los 3 espacios con sus roles esperados', () => {
    const map = new Map<string, ReadonlyArray<string>>()
    for (const { prefix, roles } of PROTECTED_PREFIXES) {
      map.set(prefix.source, roles)
    }
    expect(map.get('^\\/admin(\\/.*)?$')).toEqual(['admin'])
    expect(map.get('^\\/teacher(\\/.*)?$')).toEqual(['profe', 'admin'])
    expect(map.get('^\\/family(\\/.*)?$')).toEqual(['tutor_legal', 'autorizado'])
  })

  it('admin puede entrar a las 5 subrutas de /teacher visibles en el sidebar de admin/aulas', () => {
    const aulaId = '53489738-e934-435e-9543-3881a5d151d8'
    const subrutas = [
      '/teacher',
      '/teacher/calendario',
      `/teacher/aula/${aulaId}`,
      `/teacher/aula/${aulaId}/asistencia`,
      `/teacher/aula/${aulaId}/comida`,
    ]
    for (const ruta of subrutas) {
      const roles = requiredRolesFor(ruta)
      expect(roles, `proxy debería permitir ${ruta}`).not.toBeNull()
      expect(roles, `proxy debería incluir 'admin' para ${ruta}`).toContain('admin')
      expect(roles, `proxy debería incluir 'profe' para ${ruta}`).toContain('profe')
    }
  })

  it('rol profe sigue teniendo acceso a /teacher', () => {
    const roles = requiredRolesFor('/teacher/aula/abc/asistencia')
    expect(roles).toContain('profe')
  })

  it('roles tutor/autorizado NO tienen acceso a /teacher (regresión)', () => {
    const roles = requiredRolesFor('/teacher/aula/abc/asistencia')
    expect(roles).not.toContain('tutor_legal')
    expect(roles).not.toContain('autorizado')
  })

  it('/admin sigue requiriendo solo admin (no profe ni tutor)', () => {
    const roles = requiredRolesFor('/admin/aulas')
    expect(roles).toEqual(['admin'])
  })

  it('profe puede entrar a /admin/autorizaciones (ruta compartida con admin)', () => {
    // Regla específica ANTES del catch-all `/admin` → la profe llega a la page
    // (que la admite) sin caer en /forbidden. Cubre el bug de logout al navegar.
    for (const ruta of ['/admin/autorizaciones', '/admin/autorizaciones/abc-123']) {
      const roles = requiredRolesFor(ruta)
      expect(roles, ruta).toContain('admin')
      expect(roles, ruta).toContain('profe')
    }
  })

  it('/admin/autorizaciones NO da acceso a tutor/autorizado', () => {
    const roles = requiredRolesFor('/admin/autorizaciones')
    expect(roles).not.toContain('tutor_legal')
    expect(roles).not.toContain('autorizado')
  })

  it('/family sigue requiriendo solo tutor_legal o autorizado', () => {
    const roles = requiredRolesFor('/family/calendario')
    expect(roles).toEqual(['tutor_legal', 'autorizado'])
  })

  it('rutas no protegidas (públicas o desconocidas) devuelven null', () => {
    expect(requiredRolesFor('/')).toBeNull()
    expect(requiredRolesFor('/login')).toBeNull()
    expect(requiredRolesFor('/messages')).toBeNull()
  })
})
