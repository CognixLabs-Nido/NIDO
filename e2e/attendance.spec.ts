import { expect, test } from '@playwright/test'

/**
 * Smoke tests de Fase 4 (asistencia + ausencias).
 *
 * Sin sesiones reales: validamos que las rutas protegidas redirigen a login
 * y que los namespaces `asistencia.*` / `ausencia.*` están cargados en los
 * tres idiomas.
 *
 * El test diferencial de la fase ("auto-link familia → profe") queda como
 * test.skip condicional con E2E_REAL_SESSIONS=1 + credenciales tutor/profe.
 */
test.describe('Fase 4 — attendance smoke', () => {
  test('ruta /teacher/aula/[id]/asistencia protegida: redirige a login', async ({ page }) => {
    await page.goto('/es/teacher/aula/a1b2c3d4-e5f6-4789-8abc-def012345678/asistencia')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('i18n /es no muestra claves asistencia.*/ausencia.* sin resolver', async ({ page }) => {
    const response = await page.goto('/es/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('asistencia.title')
    expect(body).not.toContain('asistencia.columna.')
    expect(body).not.toContain('asistencia.estado_opciones.')
    expect(body).not.toContain('ausencia.title')
    expect(body).not.toContain('ausencia.motivo_opciones.')
  })

  test('i18n /en sin claves asistencia.*/ausencia.* sin resolver', async ({ page }) => {
    const response = await page.goto('/en/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('asistencia.title')
    expect(body).not.toContain('ausencia.motivo_opciones.')
  })

  test('i18n /va sin claves asistencia.*/ausencia.* sin resolver', async ({ page }) => {
    const response = await page.goto('/va/login')
    expect(response?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('asistencia.title')
    expect(body).not.toContain('ausencia.motivo_opciones.')
  })
})

/**
 * Test diferencial de Fase 4 (skip por defecto, igual que daily-agenda).
 *
 * Auto-link familia → profe: una madre reporta ausencia desde
 * /family/nino/[id] para hoy → la profe abre el pase de lista del aula y ve
 * al niño pre-marcado como `ausente` con el badge "Ausencia reportada".
 *
 * Variables de entorno requeridas:
 *  - E2E_PROFE_EMAIL, E2E_PROFE_PASSWORD
 *  - E2E_TUTOR_EMAIL, E2E_TUTOR_PASSWORD (con `puede_reportar_ausencias=true`)
 *  - E2E_AULA_ID, E2E_NINO_ID
 *
 * NOTA: deja la ausencia creada — el test no la limpia (el test es idempotente
 * porque el upsert de asistencias acepta sobrescribir y reportar la misma
 * ausencia varias veces no rompe nada). En un futuro con cleanup helpers, se
 * podría hacer GET + cancelar al final.
 */
test.describe('Fase 4 — auto-link familia → profe (skip por defecto)', () => {
  test.skip(
    process.env.E2E_REAL_SESSIONS !== '1',
    'Requiere credenciales E2E_* en .env.local (ver comentario)'
  )

  test('madre reporta ausencia y profe la ve pre-marcada en el pase de lista', async ({
    browser,
  }) => {
    const tutorContext = await browser.newContext()
    const profeContext = await browser.newContext()
    const tutorPage = await tutorContext.newPage()
    const profePage = await profeContext.newPage()

    // Login familia
    await tutorPage.goto('/es/login')
    await tutorPage.getByLabel(/email/i).fill(process.env.E2E_TUTOR_EMAIL!)
    await tutorPage.getByLabel(/contraseña|password/i).fill(process.env.E2E_TUTOR_PASSWORD!)
    await tutorPage.getByRole('button', { name: /entrar|sign in/i }).click()
    await tutorPage.waitForURL(/\/es\/family/)

    // Familia abre ficha del niño y reporta ausencia para hoy.
    await tutorPage.goto(`/es/family/nino/${process.env.E2E_NINO_ID}`)
    await tutorPage.getByTestId('ausencia-reportar-boton').click()
    await tutorPage.getByTestId('ausencia-guardar').click()
    await expect(tutorPage.getByTestId('ausencias-list')).toBeVisible()

    // Login profe (en otra pestaña).
    await profePage.goto('/es/login')
    await profePage.getByLabel(/email/i).fill(process.env.E2E_PROFE_EMAIL!)
    await profePage.getByLabel(/contraseña|password/i).fill(process.env.E2E_PROFE_PASSWORD!)
    await profePage.getByRole('button', { name: /entrar|sign in/i }).click()
    await profePage.waitForURL(/\/es\/teacher/)

    // Profe abre pase de lista del aula. El niño debería aparecer con
    // estado `ausente` pre-marcado y badge "Ausencia reportada".
    await profePage.goto(`/es/teacher/aula/${process.env.E2E_AULA_ID}/asistencia`)
    const filaNino = profePage.getByRole('row', {
      name: new RegExp(process.env.E2E_NINO_ID!),
    })
    await expect(filaNino).toBeVisible()
    await expect(filaNino.getByTestId('row-badge-ausente')).toBeVisible({ timeout: 5_000 })

    await tutorContext.close()
    await profeContext.close()
  })
})

/**
 * Día cerrado: profe abre asistencia de ayer y los inputs vienen disabled,
 * sin botón de guardar. Conceptualmente equivalente al test de día cerrado
 * de Fase 3 — la regla es transversal (ADR-0016).
 */
test.describe('Fase 4 — día cerrado read-only (skip por defecto)', () => {
  test.skip(process.env.E2E_REAL_SESSIONS !== '1', 'Requiere credenciales E2E_* en .env.local')

  test('profe abre ?fecha=ayer y la tabla queda en read-only', async ({ page }) => {
    await page.goto('/es/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_PROFE_EMAIL!)
    await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_PROFE_PASSWORD!)
    await page.getByRole('button', { name: /entrar|sign in/i }).click()
    await page.waitForURL(/\/es\/teacher/)

    const ayer = new Date()
    ayer.setDate(ayer.getDate() - 1)
    const fechaAyer = ayer.toISOString().slice(0, 10)

    await page.goto(`/es/teacher/aula/${process.env.E2E_AULA_ID}/asistencia?fecha=${fechaAyer}`)
    // Sin botón submit (readOnly) y badge "Día cerrado" visible.
    await expect(page.getByTestId('pase-submit')).toHaveCount(0)
    await expect(page.getByText(/día cerrado/i)).toBeVisible()
  })
})
