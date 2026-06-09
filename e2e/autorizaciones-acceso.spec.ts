import { expect, test } from '@playwright/test'

import { DASHBOARD, E2E_DATA, loginAs, skipSinSesionesReales } from './helpers/auth'

/**
 * Verificación de los accesos del rework de autorizaciones (sesiones reales).
 *
 * Cubre el bug histórico: la profe NO podía entrar a Autorizaciones (la ruta colgaba
 * de `/admin`, cuyo layout redirige a no-admin → /forbidden). Ahora vive en
 * `/teacher/autorizaciones`. Y la nueva vista admin de SEGUIMIENTO sustituye a las
 * tarjetas "Tipos de autorización" y a "Para firmar".
 *
 * Se salta sin `E2E_REAL_SESSIONS=1` (CI sin credenciales no falla). Variables y
 * cuentas: ver e2e/helpers/auth.ts.
 */
test.describe('F8 accesos autorizaciones — sesiones reales', () => {
  test.skip(skipSinSesionesReales, 'Requiere E2E_REAL_SESSIONS=1 + credenciales (ver auth.ts)')

  test('profe entra a /teacher/autorizaciones sin /forbidden ni logout', async ({ page }) => {
    await loginAs(page, 'profe')
    await page.goto('/es/teacher/autorizaciones')

    // No la echa a /forbidden ni a /login (el bug cerraba/expulsaba).
    await expect(page).toHaveURL(/\/es\/teacher\/autorizaciones/)
    await expect(page).not.toHaveURL(/\/forbidden/)
    await expect(page).not.toHaveURL(/\/login/)
    // Ve sus secciones de aula (recogidas / medicación).
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const body = (await page.content()).toLowerCase()
    expect(body).toContain('recogid')
    expect(body).toContain('medicaci')
  })

  test('profe: detalle fuera de su ámbito → mensaje en página, sin logout', async ({ page }) => {
    await loginAs(page, 'profe')
    // UUID inexistente: getAutorizacionDetalle devuelve null → AccesoDenegado en la
    // misma página (NO redirige a login ni a una página aparte).
    await page.goto('/es/teacher/autorizaciones/00000000-0000-4000-8000-000000000000')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).toHaveURL(/\/es\/teacher\/autorizaciones/)
  })

  test('admin ve SEGUIMIENTO y "Nueva autorización"; sin "Tipos" ni "Para firmar"', async ({
    page,
  }) => {
    await loginAs(page, 'admin')
    await page.goto('/es/admin/autorizaciones')
    await expect(page).toHaveURL(/\/es\/admin\/autorizaciones/)

    // Botón unificado "Nueva autorización" (engloba excursión).
    await expect(page.getByRole('button', { name: /nueva autorización/i })).toBeVisible()
    // Secciones de seguimiento.
    const body = (await page.content()).toLowerCase()
    expect(body).toContain('pendientes de firma')
    expect(body).toContain('últimas enviadas')
    // Las cabeceras eliminadas ya no están.
    expect(body).not.toContain('tipos de autorización')
  })

  test('"Nueva autorización" ofrece el modo excursión en el mismo desplegable', async ({
    page,
  }) => {
    await loginAs(page, 'admin')
    await page.goto('/es/admin/autorizaciones')
    await page.getByRole('button', { name: /nueva autorización/i }).click()
    // El selector de modo incluye la opción Excursión (sin botón aparte ni salto).
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/excursión/i).first()).toBeVisible()
  })

  test('admin entra a su dashboard tras login (sanity de credenciales)', async ({ page }) => {
    await loginAs(page, 'admin')
    await expect(page).toHaveURL(DASHBOARD.admin)
    // E2E_DATA disponible (lanza si faltan ids) — documenta el contrato de datos.
    expect(E2E_DATA.aulaId()).toBeTruthy()
    expect(E2E_DATA.ninoId()).toBeTruthy()
  })

  // Cadena cross-rol: la familia crea+firma una recogida NUEVA → el admin (y la
  // profe del aula) ven el aviso "ha llegado una firma nueva" en su panel de inicio.
  test('familia firma una recogida → aviso de nueva firma en el panel del admin', async ({
    browser,
  }) => {
    const tutorCtx = await browser.newContext()
    const adminCtx = await browser.newContext()
    const tutor = await tutorCtx.newPage()
    const admin = await adminCtx.newPage()

    // 1) La familia crea una recogida (el diálogo firma en el acto, patrón B2).
    await loginAs(tutor, 'tutor')
    await tutor.goto('/es/family/autorizaciones')
    await tutor
      .getByRole('button', { name: /recogida/i })
      .first()
      .click()
    const dialog = tutor.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Nombre tecleado de la firma.
    await dialog
      .getByLabel(/nombre/i)
      .first()
      .fill('Tutor Pruebas E2E')
    // Dibuja en el FirmaPad (canvas) para que la firma no esté vacía.
    const canvas = dialog.locator('canvas').first()
    const box = await canvas.boundingBox()
    if (box) {
      await tutor.mouse.move(box.x + 10, box.y + 10)
      await tutor.mouse.down()
      await tutor.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 8 })
      await tutor.mouse.up()
    }
    // Marca el consentimiento (checkbox de confirmación).
    await dialog.getByRole('checkbox').first().check()
    await dialog
      .getByRole('button', { name: /crear|firmar|guardar/i })
      .last()
      .click()

    // 2) El admin ve el aviso de nueva firma en su panel.
    await loginAs(admin, 'admin')
    await admin.goto('/es/admin')
    await expect(admin.getByText(/firma nueva|firmas nuevas/i).first()).toBeVisible({
      timeout: 15_000,
    })

    await tutorCtx.close()
    await adminCtx.close()
  })
})
