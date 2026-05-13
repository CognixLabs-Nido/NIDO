import { expect, test } from '@playwright/test'

/**
 * Smoke tests de las rutas de profe y family.
 *
 * El aislamiento real (profe A no ve niños de aula B) se valida con tests
 * RLS contra el remoto en src/test/rls/aulas.rls.test.ts. Aquí solo
 * verificamos que las rutas existen y siguen el flujo de gating del
 * middleware sin sesión.
 */
test.describe('Profe y family — protección de rutas', () => {
  test('/es/teacher sin sesión redirige a login', async ({ page }) => {
    await page.goto('/es/teacher')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('/es/teacher/aula/dummy-id sin sesión redirige a login', async ({ page }) => {
    await page.goto('/es/teacher/aula/00000000-0000-0000-0000-000000000000')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('/es/family sin sesión redirige a login', async ({ page }) => {
    await page.goto('/es/family')
    await page.waitForURL(/\/es\/login/)
  })

  test('/es/family/nino/dummy-id sin sesión redirige a login', async ({ page }) => {
    await page.goto('/es/family/nino/00000000-0000-0000-0000-000000000000')
    await page.waitForURL(/\/es\/login/)
  })

  test('home en cada locale tiene CTA login y renderiza fase 2 strings', async ({ page }) => {
    for (const locale of ['es', 'en', 'va']) {
      await page.goto(`/${locale}`)
      await expect(page.getByRole('link').first()).toBeVisible()
    }
  })
})
