import { expect, test } from '@playwright/test'

/**
 * Centro de notificaciones (accesos + avisos). Smoke sin credenciales:
 * protección de ruta + i18n sin literales del namespace.
 */
test.describe('Notificaciones — smoke', () => {
  test('ruta /notifications protegida: redirige a login', async ({ page }) => {
    await page.goto('/es/notifications')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('i18n /es: sin literales notificaciones.* en login', async ({ page }) => {
    const response = await page.goto('/es/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('notificaciones.title')
    expect(body).not.toContain('notificaciones.avisos.')
    expect(body).not.toContain('notificaciones.tipo.')
  })
})
