import { describe, expect, it, vi } from 'vitest'

/**
 * PR 3 del modelo de roles — el menú de Dirección. La admin del centro ve Centro y Auditoría, que
 * son solo suyos; una directora (Dirección sin `esResponsable`) ve el resto, igual que la admin.
 */

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (clave: string) => clave,
}))

const { buildSidebarItems } = await import('../sidebar-items')

const SOLO_DE_LA_ADMIN = ['/es/admin/centro', '/es/admin/audit']

async function hrefs(esResponsable: boolean) {
  return (await buildSidebarItems('admin', 'es', esResponsable)).map((i) => i.href)
}

describe('menú de Dirección', () => {
  it('la admin ve Centro y Auditoría', async () => {
    expect(await hrefs(true)).toEqual(expect.arrayContaining(SOLO_DE_LA_ADMIN))
  })

  it('la directora no los ve, y ve todo lo demás que ve la admin', async () => {
    const admin = await hrefs(true)
    const directora = await hrefs(false)
    for (const h of SOLO_DE_LA_ADMIN) expect(directora).not.toContain(h)
    expect(directora).toEqual(admin.filter((h) => !SOLO_DE_LA_ADMIN.includes(h)))
    // Premisa: el resto del menú de Dirección sigue ahí (las páginas mixtas incluidas).
    expect(directora).toEqual(
      expect.arrayContaining(['/es/admin/cursos', '/es/admin/cuotas', '/es/admin/pasar-de-curso'])
    )
  })

  it('a la profe no le afecta', async () => {
    const conResponsable = (await buildSidebarItems('profe', 'es', true)).map((i) => i.href)
    const sin = (await buildSidebarItems('profe', 'es', false)).map((i) => i.href)
    expect(sin).toEqual(conResponsable)
  })
})
