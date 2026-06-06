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
    expect(body).not.toContain('autorizaciones.recogida.')
  })
})

test.describe('F8-2 — recogida: editor de personas (gateado)', () => {
  test.skip(process.env.E2E_REAL_SESSIONS !== '1', 'Requiere E2E_TUTOR_* + recogida publicada')

  test('tutor ve el editor de personas autorizadas al firmar una recogida', async ({ page }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_TUTOR_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_TUTOR_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.goto('/es/family/autorizaciones')
    const recogida = page.getByRole('link', { name: /recogida/i }).first()
    if ((await recogida.count()) > 0) {
      await recogida.click()
      await expect(page.getByText(/personas autorizadas/i).first()).toBeVisible()
    }
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

test.describe('F8-2b — reglas de régimen interno (gateado)', () => {
  test.skip(process.env.E2E_REAL_SESSIONS !== '1', 'Requiere E2E_ADMIN_* en .env.local')

  test('admin puede abrir el diálogo de nuevas reglas (por niño)', async ({ page }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_ADMIN_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.goto('/es/admin/autorizaciones')
    const nuevasReglas = page.getByRole('button', { name: /reglas/i })
    await expect(nuevasReglas).toBeVisible()
    await nuevasReglas.click()
    // El diálogo pide elegir niño + título (cuelga del niño, sin evento).
    await expect(page.getByText(/niño|xiquet|child/i).first()).toBeVisible()
  })
})
