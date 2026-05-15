import { expect, test } from '@playwright/test'

/**
 * Smoke tests de Fase 3 (agenda diaria).
 *
 * Sin sesiones reales (eso llega en Fase 11): validamos que las rutas
 * protegidas redirigen a login, que los strings del namespace `agenda`
 * están cargados en es/en/va, y dejamos el test de Realtime con dos
 * contextos como `test.skip` condicional (se activa cuando E2E_REAL_SESSIONS
 * = 1 esté disponible en CI con credenciales).
 */
test.describe('Fase 3 — daily agenda smoke', () => {
  test('ruta /teacher/aula/[id] protegida: redirige a login sin sesión', async ({ page }) => {
    await page.goto('/es/teacher/aula/a1b2c3d4-e5f6-4789-8abc-def012345678')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('ruta /family/nino/[id] protegida: redirige a login sin sesión', async ({ page }) => {
    await page.goto('/es/family/nino/a1b2c3d4-e5f6-4789-8abc-def012345678')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('i18n /es no muestra claves agenda.* sin resolver', async ({ page }) => {
    const response = await page.goto('/es/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('agenda.secciones.')
    expect(body).not.toContain('agenda.campos.')
    expect(body).not.toContain('agenda.errors.')
  })

  test('i18n /en sin claves agenda.* sin resolver', async ({ page }) => {
    const response = await page.goto('/en/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('agenda.secciones.')
    expect(body).not.toContain('agenda.campos.')
  })

  test('i18n /va sin claves agenda.* sin resolver', async ({ page }) => {
    const response = await page.goto('/va/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('agenda.secciones.')
    expect(body).not.toContain('agenda.campos.')
  })
})

/**
 * Realtime end-to-end con dos contextos en paralelo (profe + familia).
 *
 * Test conceptual del diferencial de NIDO: cuando la profe añade un evento,
 * la familia lo ve sin recargar manualmente. Requiere sesiones reales
 * (cuentas profe y tutor con permisos `puede_ver_agenda=true` sobre el
 * mismo niño, niño matriculado en un aula activa, ventana de edición
 * abierta = hoy hora Madrid).
 *
 * Variables de entorno esperadas (cuando `E2E_REAL_SESSIONS=1`):
 *  - E2E_PROFE_EMAIL, E2E_PROFE_PASSWORD
 *  - E2E_TUTOR_EMAIL, E2E_TUTOR_PASSWORD
 *  - E2E_AULA_ID, E2E_NINO_ID
 *
 * Se mantiene como `test.skip` por defecto para que el CI sin credenciales
 * no falle, y se documenta el flujo end-to-end para activación futura.
 */
test.describe('Fase 3 — realtime profe → familia (skip por defecto)', () => {
  test.skip(
    process.env.E2E_REAL_SESSIONS !== '1',
    'Requiere credenciales E2E_* en .env.local (ver comentario)'
  )

  test('profe añade comida y familia la ve sin recargar', async ({ browser }) => {
    const profeContext = await browser.newContext()
    const familiaContext = await browser.newContext()
    const profePage = await profeContext.newPage()
    const familiaPage = await familiaContext.newPage()

    // Login profe
    await profePage.goto('/es/login')
    await profePage.getByLabel(/email/i).fill(process.env.E2E_PROFE_EMAIL!)
    await profePage.getByLabel(/contraseña|password/i).fill(process.env.E2E_PROFE_PASSWORD!)
    await profePage.getByRole('button', { name: /entrar|sign in/i }).click()
    await profePage.waitForURL(/\/es\/teacher/)

    // Login familia
    await familiaPage.goto('/es/login')
    await familiaPage.getByLabel(/email/i).fill(process.env.E2E_TUTOR_EMAIL!)
    await familiaPage.getByLabel(/contraseña|password/i).fill(process.env.E2E_TUTOR_PASSWORD!)
    await familiaPage.getByRole('button', { name: /entrar|sign in/i }).click()
    await familiaPage.waitForURL(/\/es\/family/)

    // Familia abre el detalle del niño y mira la sección Agenda.
    await familiaPage.goto(`/es/family/nino/${process.env.E2E_NINO_ID}`)
    const seccionAgenda = familiaPage
      .locator('section')
      .filter({ hasText: /agenda/i })
      .first()
    await expect(seccionAgenda).toBeVisible()

    // Profe va al aula, expande la tarjeta del niño y añade una comida.
    await profePage.goto(`/es/teacher/aula/${process.env.E2E_AULA_ID}`)
    await profePage
      .getByRole('button', { name: new RegExp(process.env.E2E_NINO_ID!) })
      .first()
      .click()
    await profePage.getByRole('button', { name: /añadir comida/i }).click()
    await profePage.getByRole('button', { name: /guardar/i }).click()

    // Familia ve la nueva comida sin recargar (Realtime → router.refresh()).
    await expect(
      familiaPage
        .locator('section')
        .filter({ hasText: /comidas/i })
        .first()
    ).toBeVisible({
      timeout: 15_000,
    })

    await profeContext.close()
    await familiaContext.close()
  })
})
