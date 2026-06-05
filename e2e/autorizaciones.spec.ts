import { expect, test } from '@playwright/test'

/**
 * F8-1 — Autorizaciones de salida (firma digital). Smoke sin credenciales
 * (protección de ruta + i18n sin literales) + flujo real gateado con
 * `E2E_REAL_SESSIONS=1`.
 */
test.describe('F8-1 — autorizaciones smoke', () => {
  test('ruta /admin/autorizaciones protegida: redirige a login', async ({ page }) => {
    await page.goto('/es/admin/autorizaciones')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('ruta /family/autorizaciones protegida: redirige a login', async ({ page }) => {
    await page.goto('/es/family/autorizaciones')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('i18n /es: sin literales autorizaciones.* en la pantalla de login', async ({ page }) => {
    const response = await page.goto('/es/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('autorizaciones.title')
    expect(body).not.toContain('autorizaciones.acciones.')
    expect(body).not.toContain('autorizaciones.firma.')
  })
})

test.describe('F8-1 — admin publica salida → tutor firma (gateado)', () => {
  test.skip(
    process.env.E2E_REAL_SESSIONS !== '1',
    'Requiere E2E_ADMIN_* y E2E_TUTOR_* en .env.local'
  )

  test('admin ve la lista de autorizaciones de salida', async ({ page }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_ADMIN_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.goto('/es/admin/autorizaciones')
    await expect(page.getByRole('heading', { name: /autorizaciones/i })).toBeVisible()
  })

  test('tutor abre sus autorizaciones', async ({ page }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_TUTOR_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_TUTOR_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.goto('/es/family/autorizaciones')
    await expect(page.getByRole('heading', { name: /autorizaciones/i })).toBeVisible()
  })
})
