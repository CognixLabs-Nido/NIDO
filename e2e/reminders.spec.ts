import { expect, test } from '@playwright/test'

/**
 * Smoke tests de F6 (recordatorios bidireccionales).
 *
 * Sin sesiones reales: la ruta transversal `/reminders` redirige a login y el
 * namespace `recordatorios.*` está cargado en es/en/va sin dejar claves sin
 * resolver. El flujo diferencial (admin crea un recordatorio para una familia)
 * queda como `test.skip` condicional con `E2E_REAL_SESSIONS=1`.
 */
test.describe('F6 — recordatorios smoke', () => {
  test('ruta /reminders protegida: redirige a login', async ({ page }) => {
    await page.goto('/es/reminders')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  for (const locale of ['es', 'en', 'va']) {
    test(`i18n /${locale}: sin claves recordatorios.* sin resolver`, async ({ page }) => {
      const response = await page.goto(`/${locale}/login`)
      expect(response?.status()).toBe(200)
      const body = (await page.content()).toLowerCase()
      expect(body).not.toContain('recordatorios.titulo_pagina')
      expect(body).not.toContain('recordatorios.destinos.')
      expect(body).not.toContain('recordatorios.form.')
      expect(body).not.toContain('recordatorios.acciones.')
    })
  }
})

/**
 * Test diferencial (skip por defecto). Requiere E2E_ADMIN_EMAIL/PASSWORD.
 * Deja una fila en `recordatorios`; el título lleva un marcador de test para
 * poder limpiarlo. No usa fechas conflictivas (vencimiento opcional, omitido).
 */
test.describe('F6 — admin crea recordatorio (skip por defecto)', () => {
  test.skip(process.env.E2E_REAL_SESSIONS !== '1', 'Requiere E2E_ADMIN_* en .env.local')

  test('admin abre /reminders, crea un recordatorio familia y lo ve en pendientes', async ({
    page,
  }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_ADMIN_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.waitForURL(/\/es\/admin/)

    await page.goto('/es/reminders')
    await page.getByTestId('recordatorios-nuevo').click()

    // Destino por defecto = familia (admin) → selector de niño visible.
    await page.getByTestId('recordatorio-nino-select').click()
    await page.getByRole('option').first().click()

    const titulo = `e2e recordatorio ${Date.now()}`
    await page.getByLabel(/título|title/i).fill(titulo)
    await page.getByRole('button', { name: /crear recordatorio|create reminder/i }).click()

    await expect(page.getByText(titulo)).toBeVisible()
  })
})
