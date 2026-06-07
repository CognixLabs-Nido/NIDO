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

test.describe('F8-RW-1 — catálogo + enviar (gateado)', () => {
  test.skip(process.env.E2E_REAL_SESSIONS !== '1', 'Requiere E2E_ADMIN_* en .env.local')

  test('admin ve las dos acciones (catálogo + enviar), no el viejo botón de reglas', async ({
    page,
  }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_ADMIN_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.goto('/es/admin/autorizaciones')
    // Acción de catálogo: «Nueva autorización» (crear plantilla).
    const nueva = page.getByRole('button', { name: /nueva autorización/i })
    await expect(nueva).toBeVisible()
    await nueva.click()
    // El diálogo pide el TIPO de documento (no un niño): es el catálogo.
    await expect(page.getByText(/tipo de documento|tipus de document|document type/i)).toBeVisible()
  })
})

test.describe('F8-RW-2 — recogida B2 (la familia inicia) (gateado)', () => {
  test.skip(
    process.env.E2E_REAL_SESSIONS !== '1',
    'Requiere E2E_TUTOR_* + plantilla de recogida publicada'
  )

  test('tutor abre el diálogo de autorizar recogida (niño + modalidad + lista)', async ({
    page,
  }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_TUTOR_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_TUTOR_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.goto('/es/family/autorizaciones')
    const crear = page.getByRole('button', { name: /autorizar recogida/i })
    await expect(crear).toBeVisible()
    await crear.click()
    // El diálogo lo inicia la familia: modalidad (habitual/puntual) + añadir persona.
    await expect(page.getByText(/modalidad|modalitat|type/i).first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: /añadir persona|afegir persona|add person/i })
    ).toBeVisible()
  })
})
