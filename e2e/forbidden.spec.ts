import { expect, test } from '@playwright/test'

test.describe('Protected routes', () => {
  test('acceso a /admin sin sesión redirige a login con returnTo', async ({ page }) => {
    await page.goto('/es/admin')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
    await expect(page.getByText('Accede con tu correo y contraseña.')).toBeVisible()
  })

  test('acceso a /teacher sin sesión redirige a login', async ({ page }) => {
    await page.goto('/es/teacher')
    await page.waitForURL(/\/es\/login/)
  })

  test('acceso a /family sin sesión redirige a login', async ({ page }) => {
    await page.goto('/es/family')
    await page.waitForURL(/\/es\/login/)
  })
})
