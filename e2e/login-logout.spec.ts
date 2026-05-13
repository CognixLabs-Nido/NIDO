import { expect, test } from '@playwright/test'

test.describe('Login / logout flow', () => {
  test('credenciales inválidas muestran error genérico', async ({ page }) => {
    await page.goto('/es/login')
    await page.getByLabel('Correo electrónico').fill('no-existe@nido.test')
    await page.getByLabel('Contraseña').fill('Wrong-Password-2026!')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
  })

  test('home tiene CTA hacia login', async ({ page }) => {
    await page.goto('/es')
    await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible()
  })
})
