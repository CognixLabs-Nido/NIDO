import { expect, test } from '@playwright/test'

/**
 * Tras la reestructuración, la pestaña/página separada "Notificaciones" se eliminó:
 * sus avisos viven ahora en el panel de Inicio y la zona de trabajo en la pestaña
 * Autorizaciones. Smoke sin credenciales: la ruta ya no existe y el login no filtra
 * literales del namespace.
 */
test.describe('Notificaciones — eliminada (smoke)', () => {
  test('la ruta /notifications ya no existe (no es una página)', async ({ page }) => {
    const res = await page.goto('/es/notifications')
    // Sin ruta: 404 (o lo que sirva el catch-all), nunca un 200 con la página vieja.
    expect(res?.status()).not.toBe(200)
  })

  test('i18n /es: sin literales notificaciones.* en login', async ({ page }) => {
    const response = await page.goto('/es/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('notificaciones.avisos.')
  })
})
