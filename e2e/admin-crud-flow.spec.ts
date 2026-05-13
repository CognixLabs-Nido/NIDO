import { expect, test } from '@playwright/test'

/**
 * Smoke tests de las páginas nuevas de Fase 2.
 *
 * Las pruebas con sesión admin real requieren fixtures de autenticación que
 * se introducen en Fase 11 (pulido). En Fase 2 verificamos:
 *   - las rutas existen y responden 200 (con redirect a login si no hay sesión).
 *   - los strings i18n renderizan en es/en/va sin claves faltantes ([key]).
 *   - el middleware protege las rutas admin contra acceso anónimo.
 */
test.describe('Admin CRUD flow — rutas protegidas y i18n', () => {
  const adminRoutes = [
    '/es/admin',
    '/es/admin/centro',
    '/es/admin/cursos',
    '/es/admin/aulas',
    '/es/admin/ninos',
    '/es/admin/audit',
  ]

  for (const route of adminRoutes) {
    test(`${route} sin sesión redirige a login`, async ({ page }) => {
      await page.goto(route)
      await page.waitForURL(/\/es\/login\?.*returnTo=/)
    })
  }

  test('/es/admin/ninos/nuevo redirige a login sin sesión', async ({ page }) => {
    await page.goto('/es/admin/ninos/nuevo')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('login muestra el formulario en es/en/va sin claves rotas', async ({ page }) => {
    for (const locale of ['es', 'en', 'va']) {
      await page.goto(`/${locale}/login`)
      const html = await page.content()
      // Si una clave i18n falta, next-intl la renderiza literalmente entre corchetes.
      // Detectamos esa firma para fallar si alguna falta.
      expect(html).not.toMatch(/\[admin\./)
      expect(html).not.toMatch(/\[centro\./)
      expect(html).not.toMatch(/\[curso\./)
      expect(html).not.toMatch(/\[aula\./)
      expect(html).not.toMatch(/\[nino\./)
    }
  })
})
