import { expect, test } from '@playwright/test'

/**
 * Smoke + flujo del resumen de Inicio (AG-15).
 *
 * Sin sesiones reales: los 3 home protegidos redirigen a login y el namespace
 * `inicio_resumen.*` no deja claves sin resolver. El flujo diferencial —el tutor
 * ve su invitación en Inicio y el enlace lleva a `/agenda`— queda como
 * `test.skip` condicional con `E2E_REAL_SESSIONS=1` + `E2E_TUTOR_*` (patrón F4/F7).
 */
test.describe('AG-15 — inicio resumen smoke', () => {
  for (const rol of ['family', 'teacher', 'admin']) {
    test(`ruta /${rol} protegida: redirige a login`, async ({ page }) => {
      await page.goto(`/es/${rol}`)
      await page.waitForURL(/\/es\/login/)
    })
  }

  for (const locale of ['es', 'en', 'va']) {
    test(`i18n /${locale}: sin claves inicio_resumen.* sin resolver`, async ({ page }) => {
      const response = await page.goto(`/${locale}/login`)
      expect(response?.status()).toBe(200)
      const body = (await page.content()).toLowerCase()
      expect(body).not.toContain('inicio_resumen.')
    })
  }
})

/**
 * Flujo diferencial (skip por defecto). Requiere `E2E_REAL_SESSIONS=1` y un tutor
 * con credenciales (`E2E_TUTOR_EMAIL` / `E2E_TUTOR_PASSWORD`). Para ver el ítem de
 * invitación en el resumen, el tutor debe tener una cita de esta semana a la que
 * se le convoca (sembrada aparte); el enlace "Ver agenda" está siempre disponible
 * y es el que se verifica aquí de forma determinista.
 */
test.describe('AG-15 — tutor ve el resumen en Inicio (skip por defecto)', () => {
  test.skip(process.env.E2E_REAL_SESSIONS !== '1', 'Requiere E2E_TUTOR_* en .env.local')

  test('tutor entra en /family, ve el resumen y el enlace lleva a /agenda', async ({ page }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_TUTOR_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_TUTOR_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.waitForURL(/\/es\/family/)

    const widget = page.getByTestId('widget-resumen-semana')
    await expect(widget).toBeVisible()

    // El enlace "Ver agenda" del resumen navega a la Agenda.
    await widget.getByRole('link', { name: /ver agenda|view agenda/i }).click()
    await page.waitForURL(/\/es\/agenda/)
  })
})
