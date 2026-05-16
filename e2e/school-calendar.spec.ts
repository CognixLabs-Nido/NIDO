import { expect, test } from '@playwright/test'

/**
 * Smoke tests de Fase 4.5a (calendario laboral del centro).
 *
 * Sin sesiones reales: validamos que las 3 rutas protegidas redirigen a
 * login y que el namespace `calendario.*` está cargado en es/en/va sin
 * dejar claves sin resolver.
 *
 * El test diferencial — admin marca un día y aplica un rango — queda
 * como `test.skip` condicional con `E2E_REAL_SESSIONS=1` + credenciales
 * de admin, siguiendo el patrón de F4.
 */
test.describe('Fase 4.5a — school-calendar smoke', () => {
  test('ruta /admin/calendario protegida: redirige a login', async ({ page }) => {
    await page.goto('/es/admin/calendario')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('ruta /teacher/calendario protegida: redirige a login', async ({ page }) => {
    await page.goto('/es/teacher/calendario')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('ruta /family/calendario protegida: redirige a login', async ({ page }) => {
    await page.goto('/es/family/calendario')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('i18n /es: claves calendario.* resueltas (sin literales)', async ({ page }) => {
    const response = await page.goto('/es/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('calendario.title')
    expect(body).not.toContain('calendario.tipos.')
    expect(body).not.toContain('calendario.leyenda.')
    expect(body).not.toContain('calendario.dialog_rango.')
  })

  test('i18n /en sin claves calendario.* sin resolver', async ({ page }) => {
    const response = await page.goto('/en/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('calendario.title')
    expect(body).not.toContain('calendario.tipos.')
  })

  test('i18n /va sin claves calendario.* sin resolver', async ({ page }) => {
    const response = await page.goto('/va/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('calendario.title')
    expect(body).not.toContain('calendario.tipos.')
  })
})

/**
 * Tests diferenciales de F4.5a (skip por defecto, igual que F3/F4).
 *
 * Variables de entorno requeridas:
 *  - E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
 *
 * NOTA: dejan filas en `dias_centro` — los tests son idempotentes
 * gracias al ON CONFLICT del upsert. Las fechas usadas (2027-12-25 y
 * un rango en 2027-08) están en futuro lejano para no chocar con otros
 * tests ni datos productivos.
 */
test.describe('Fase 4.5a — admin marca festivo (skip por defecto)', () => {
  test.skip(process.env.E2E_REAL_SESSIONS !== '1', 'Requiere E2E_ADMIN_* en .env.local')

  test('admin abre /admin/calendario y marca un día como festivo', async ({ page }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_ADMIN_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.waitForURL(/\/es\/admin/)

    await page.goto('/es/admin/calendario?anio=2027&mes=12')

    // Click en el día 25 de diciembre 2027 (Navidad) → abre dialog.
    await page.getByTestId('celda-2027-12-25').click()

    // Seleccionar tipo festivo y guardar.
    await page.getByTestId('select-tipo-dia').click()
    await page.getByTestId('option-tipo-festivo').click()
    await page.getByTestId('btn-guardar-dia').click()

    // Toast de éxito.
    await expect(page.getByText(/día actualizado/i)).toBeVisible()

    // Recargar y verificar que el día sigue marcado.
    await page.reload()
    const celda = page.getByTestId('celda-2027-12-25')
    await expect(celda.locator('[data-tipo=festivo]')).toBeVisible()
  })
})

test.describe('Fase 4.5a — admin aplica rango (skip por defecto)', () => {
  test.skip(process.env.E2E_REAL_SESSIONS !== '1', 'Requiere E2E_ADMIN_* en .env.local')

  test('admin selecciona rango y aplica escuela_verano', async ({ page }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_ADMIN_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.waitForURL(/\/es\/admin/)

    await page.goto('/es/admin/calendario?anio=2027&mes=8')

    // Click en 2027-08-01 (sin shift) para fijar diaActivo.
    await page.getByTestId('celda-2027-08-01').click()
    // El dialog del día abre — cerramos para activar selección de rango.
    await page.getByRole('button', { name: /cancelar/i }).click()

    // Shift+click sobre 2027-08-10 → debería abrir dialog de rango.
    await page.getByTestId('celda-2027-08-10').click({ modifiers: ['Shift'] })
    await expect(page.getByTestId('dialog-rango-confirmacion')).toBeVisible()

    // Seleccionar escuela_verano y aplicar.
    await page.getByTestId('select-tipo-rango').click()
    await page.getByTestId('option-rango-escuela_verano').click()
    await page.getByTestId('btn-aplicar-rango').click()

    // Verificar que se aplicó al rango (10 días).
    await expect(page.getByText(/10 días actualizados/i)).toBeVisible()

    // Recargar y verificar al menos un día del rango.
    await page.reload()
    const celda = page.getByTestId('celda-2027-08-05')
    await expect(celda.locator('[data-tipo=escuela_verano]')).toBeVisible()
  })
})
