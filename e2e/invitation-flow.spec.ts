import { expect, test } from '@playwright/test'

test.describe('Invitation flow', () => {
  test('token inexistente redirige a pantalla expired uniforme', async ({ page }) => {
    await page.goto('/es/invitation/00000000-0000-0000-0000-000000000000')
    await page.waitForURL(/\/es\/invitation\/expired$/)
    await expect(page.getByText('Este enlace ya no es válido')).toBeVisible()
  })

  test('token con formato inválido también va a expired', async ({ page }) => {
    await page.goto('/es/invitation/no-es-uuid')
    await page.waitForURL(/\/es\/invitation\/expired$/)
  })
})
