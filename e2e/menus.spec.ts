import { expect, test } from '@playwright/test'

/**
 * Smoke tests de Fase 4.5 (menús + pase de comida batch).
 *
 * Sin sesiones reales: validamos que las rutas protegidas redirigen a
 * login y que los namespaces `menus.*` / `comida_batch.*` /
 * `menu_del_dia_widget.*` cargan sin claves sin resolver en es/en/va.
 *
 * Los 2 E2E "con sesión real" (admin crea+publica plantilla; profe pasa
 * lista batch) quedan como `test.skip` con E2E_REAL_SESSIONS=1.
 */
test.describe('Fase 4.5 — menús smoke', () => {
  test('ruta /admin/menus protegida: redirige a login sin sesión', async ({ page }) => {
    await page.goto('/es/admin/menus')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('ruta /teacher/aula/[id]/comida protegida: redirige a login', async ({ page }) => {
    await page.goto('/es/teacher/aula/a1b2c3d4-e5f6-4789-8abc-def012345678/comida')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('i18n /es no muestra claves menus.* / comida_batch.* sin resolver', async ({ page }) => {
    const response = await page.goto('/es/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('menus.title')
    expect(body).not.toContain('menus.estado.')
    expect(body).not.toContain('menus.dia.')
    expect(body).not.toContain('menus.momento.')
    expect(body).not.toContain('comida_batch.title')
    expect(body).not.toContain('comida_batch.columna.')
    expect(body).not.toContain('menu_del_dia_widget.title')
  })

  test('i18n /en sin claves menus.* / comida_batch.* sin resolver', async ({ page }) => {
    const response = await page.goto('/en/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('menus.title')
    expect(body).not.toContain('menus.estado.')
    expect(body).not.toContain('comida_batch.title')
  })

  test('i18n /va sin claves menus.* / comida_batch.* sin resolver', async ({ page }) => {
    const response = await page.goto('/va/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('menus.title')
    expect(body).not.toContain('menus.estado.')
    expect(body).not.toContain('comida_batch.title')
  })
})

/**
 * Test diferencial 1 (skip por defecto): admin crea plantilla,
 * rellena los 5 días, publica, ve la plantilla como "Publicada" en
 * el listado.
 *
 * Variables de entorno requeridas:
 *  - E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
 */
test.describe('Fase 4.5 — admin crea y publica plantilla (skip por defecto)', () => {
  test.skip(
    process.env.E2E_REAL_SESSIONS !== '1',
    'Requiere credenciales E2E_ADMIN_* en .env.local'
  )

  test('admin crea plantilla con menú semanal y la publica', async ({ page }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_ADMIN_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.waitForURL(/\/es\/admin/)

    await page.goto('/es/admin/menus')

    // 1. Crear plantilla.
    await page.getByTestId('nueva-plantilla').click()
    const nombre = `Plantilla E2E ${Date.now()}`
    await page.getByTestId('plantilla-nombre').fill(nombre)
    await page.getByTestId('plantilla-guardar').click()

    // Redirige al editor.
    await page.waitForURL(/\/es\/admin\/menus\/[0-9a-f-]+/)

    // 2. Rellenar lunes con desayuno + comida y guardar.
    await page.getByTestId('campo-lunes-desayuno').fill('Tostadas con tomate')
    await page.getByTestId('campo-lunes-comida').fill('Lentejas')
    await page.getByTestId('guardar-dia-lunes').click()

    // 3. Volver al listado y publicar.
    await page.goto('/es/admin/menus')
    await page.locator(`text=${nombre}`).first().waitFor()

    // El botón Publicar de esta plantilla — su id la sabemos por la fila.
    const fila = page.locator('tr', { hasText: nombre })
    await fila.locator('[data-testid^="publicar-"]').click()
    await page.locator('[data-testid^="confirmar-publicar-"]').click()

    await expect(fila.locator('[data-testid^="plantilla-estado-"]')).toHaveText(/publicada/i)
  })
})

/**
 * Test diferencial 2 (skip por defecto): profe abre pase de comida,
 * ve el menú del día pre-cargado, aplica cantidad a todos con quick
 * action, guarda y al recargar conserva los datos.
 *
 * Requiere E2E_PROFE_*, E2E_AULA_ID con una plantilla publicada vigente
 * (poblada por el test anterior si E2E_REAL_SESSIONS está activo).
 */
test.describe('Fase 4.5 — profe pasa lista batch (skip por defecto)', () => {
  test.skip(
    process.env.E2E_REAL_SESSIONS !== '1',
    'Requiere credenciales E2E_PROFE_* y E2E_AULA_ID en .env.local'
  )

  test('profe ve menú del día y marca cantidades para todos los niños', async ({ page }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_PROFE_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_PROFE_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.waitForURL(/\/es\/teacher/)

    await page.goto(`/es/teacher/aula/${process.env.E2E_AULA_ID}/comida?momento=comida`)

    // El widget "menú del día" debe mostrarse (no es '—').
    const menuTexto = await page.getByTestId('comida-menu-del-dia').textContent()
    expect(menuTexto?.trim()).not.toBe('—')

    // Quick action — selector + aplicar a todos.
    await page.getByTestId('comida-cantidad-quick-selector').click()
    await page.getByRole('option', { name: /todo/i }).first().click()
    await page.getByTestId('pase-quick-aplicar-cantidad').click()

    // Submit.
    await page.getByTestId('pase-submit').click()

    // Tras submit, los estados de fila pasan a "Guardado".
    await expect(page.getByText(/Guardado/).first()).toBeVisible({ timeout: 10_000 })
  })
})
