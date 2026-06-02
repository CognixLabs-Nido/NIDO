import { expect, test } from '@playwright/test'

/**
 * Smoke tests de F7b (Agenda — citas con invitados nominales y RSVP).
 *
 * Sin sesiones reales: la ruta transversal `/agenda` redirige a login y el
 * namespace `citas.*` carga en es/en/va sin dejar claves sin resolver. El flujo
 * diferencial (admin crea una cita y la ve en la agenda) llega en B5 como
 * `test.skip` condicional con `E2E_REAL_SESSIONS=1`.
 */
test.describe('F7b — agenda smoke', () => {
  test('ruta /agenda protegida: redirige a login', async ({ page }) => {
    await page.goto('/es/agenda')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  for (const locale of ['es', 'en', 'va']) {
    test(`i18n /${locale}: sin claves citas.* sin resolver`, async ({ page }) => {
      const response = await page.goto(`/${locale}/login`)
      expect(response?.status()).toBe(200)
      const body = (await page.content()).toLowerCase()
      expect(body).not.toContain('citas.titulo')
      expect(body).not.toContain('citas.tipos.')
      expect(body).not.toContain('citas.vista.')
      expect(body).not.toContain('citas.campos.')
    })
  }
})
