import { expect, test } from '@playwright/test'

/**
 * Smoke tests de Fase 2.6 (datos pedagógicos + logo del centro).
 *
 * Mantenemos el mismo patrón que el resto de E2E: sin sesión admin real
 * (eso espera a Fase 11), validamos que las rutas existen, que el asset
 * del logo de ANAIA se sirve estáticamente y que los strings i18n del
 * namespace pedagogico están presentes en los tres idiomas.
 */
test.describe('Fase 2.6 — pedagogical-data + centro logo', () => {
  test('asset del logo ANAIA se sirve estáticamente', async ({ request }) => {
    const r = await request.get('/brand/anaia-logo-wordmark.png')
    expect(r.status()).toBe(200)
    const ct = r.headers()['content-type'] ?? ''
    expect(ct).toContain('image/png')
  })

  test('detalle de niño protegido: redirige a login sin sesión', async ({ page }) => {
    // UUID inventado, basta para que la ruta dinámica resuelva y el middleware actúe.
    await page.goto('/es/admin/ninos/a1b2c3d4-e5f6-4789-8abc-def012345678')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('i18n /es/login no muestra claves [pedagogico.*] sin resolver', async ({ page }) => {
    const response = await page.goto('/es/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    // Si el namespace estuviera mal cargado, next-intl mostraría literal "pedagogico.fields..."
    expect(body).not.toContain('pedagogico.fields.')
    expect(body).not.toContain('pedagogico.lactancia_opciones.')
  })

  test('versión inglesa renderiza correctamente', async ({ page }) => {
    const response = await page.goto('/en/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('pedagogico.fields.')
  })

  test('versión valenciana renderiza correctamente', async ({ page }) => {
    const response = await page.goto('/va/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('pedagogico.fields.')
  })
})
