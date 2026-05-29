import { expect, test } from '@playwright/test'

/**
 * Smoke tests de Fase 5 (mensajería).
 *
 * Sin sesiones reales: validamos que las 4 rutas /messages/* y la ruta
 * /messages/nino/[id] redirigen a login sin auth, y que no hay claves
 * `messages.*` ni `messages.lista.*` sin resolver en los 3 idiomas.
 *
 * Los 3 tests E2E completos (mensaje-realtime, anuncio-aula,
 * leer-baja-badge) están en el bloque `test.skip` con E2E_REAL_SESSIONS=1
 * (mismo patrón que F3/F4 — se activan en CI cuando haya credenciales).
 */
test.describe('Fase 5 — messaging smoke', () => {
  test('ruta /messages protegida: redirige a login sin sesión', async ({ page }) => {
    await page.goto('/es/messages')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('ruta /messages/conversacion/[id] protegida', async ({ page }) => {
    await page.goto('/es/messages/conversacion/a1b2c3d4-e5f6-4789-8abc-def012345678')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('ruta /messages/anuncios/[id] protegida', async ({ page }) => {
    await page.goto('/es/messages/anuncios/a1b2c3d4-e5f6-4789-8abc-def012345678')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('ruta /messages/nuevo-anuncio protegida', async ({ page }) => {
    await page.goto('/es/messages/nuevo-anuncio')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  test('ruta /messages/nino/[id] protegida', async ({ page }) => {
    await page.goto('/es/messages/nino/a1b2c3d4-e5f6-4789-8abc-def012345678')
    await page.waitForURL(/\/es\/login\?.*returnTo=/)
  })

  // F5.6-A: la ruta `/messages/conversacion/[id]` sirve también hilos
  // admin_familia (dispatcher SSR por tipo_conversacion); no hay rutas
  // nuevas que proteger. F5.6 solo añade keys i18n — comprobamos que
  // no quedan placeholders sin resolver en /es.
  test('i18n F5.6-A: messages.badge.* y messages.admin_familia.* sin placeholders', async ({
    page,
  }) => {
    const r = await page.goto('/es/login')
    expect(r?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('messages.badge.')
    expect(body).not.toContain('messages.admin_familia.')
  })

  test('i18n F5.6-B: clave ventana_anulacion_expirada sin placeholder', async ({ page }) => {
    const r = await page.goto('/es/login')
    expect(r?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('messages.errors.ventana_anulacion_expirada')
  })

  test('i18n F5.6-C: clave conversacion.ir_al_ultimo sin placeholder', async ({ page }) => {
    const r = await page.goto('/es/login')
    expect(r?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('messages.conversacion.ir_al_ultimo')
  })

  test('i18n /es no muestra claves messages.* sin resolver', async ({ page }) => {
    const r = await page.goto('/es/login')
    expect(r?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('messages.lista.')
    expect(body).not.toContain('messages.tabs.')
    expect(body).not.toContain('messages.anuncio.')
    expect(body).not.toContain('messages.errors.')
  })

  test('i18n /en sin claves messages.* sin resolver', async ({ page }) => {
    const r = await page.goto('/en/login')
    expect(r?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('messages.lista.')
    expect(body).not.toContain('messages.tabs.')
    expect(body).not.toContain('messages.anuncio.')
  })

  test('i18n /va sin claves messages.* sin resolver', async ({ page }) => {
    const r = await page.goto('/va/login')
    expect(r?.status()).toBe(200)
    const body = (await page.content()).toLowerCase()
    expect(body).not.toContain('messages.lista.')
    expect(body).not.toContain('messages.tabs.')
    expect(body).not.toContain('messages.anuncio.')
  })
})

/**
 * E2E con dos contextos en paralelo (profe + familia).
 *
 * Activación: E2E_REAL_SESSIONS=1 con credenciales en .env.local.
 *
 * Variables esperadas:
 *  - E2E_PROFE_EMAIL, E2E_PROFE_PASSWORD
 *  - E2E_TUTOR_EMAIL, E2E_TUTOR_PASSWORD
 *  - E2E_AULA_ID, E2E_NINO_ID (con el tutor teniendo
 *    puede_recibir_mensajes=true sobre ese niño)
 *
 * Cubre los 3 escenarios definidos en spec § "Tests requeridos":
 *  1. mensaje-realtime: profe envía mensaje desde la ficha del niño,
 *     tutor (en otro contexto) lo ve aparecer en /messages sin recargar
 *     y el badge global pasa de 0 a 1.
 *  2. anuncio-aula: profe publica anuncio ambito='aula', tutor del aula
 *     lo ve en la tab Anuncios sin recargar; tutor de otra aula NO.
 *  3. leer-baja-badge: tutor con badge=1 abre la conversación; el badge
 *     pasa a 0 sin recargar tras el UPSERT de lectura_conversacion.
 */
test.describe('Fase 5 — messaging realtime (skip por defecto)', () => {
  test.skip(process.env.E2E_REAL_SESSIONS !== '1', 'Requiere credenciales E2E_* en .env.local')

  test('mensaje-realtime: tutor ve mensaje y badge sube', async ({ browser }) => {
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

    // Familia abre /messages
    await familiaPage.goto('/es/messages')

    // Profe abre la conversación del niño y envía un mensaje.
    await profePage.goto(`/es/messages/nino/${process.env.E2E_NINO_ID}`)
    const contenido = `E2E msg ${Date.now()}`
    await profePage.getByPlaceholder(/escribe tu mensaje/i).fill(contenido)
    await profePage.getByRole('button', { name: /enviar/i }).click()

    // Familia lo ve aparecer en la lista sin recargar
    await expect(familiaPage.getByText(contenido)).toBeVisible({ timeout: 15_000 })

    await profeContext.close()
    await familiaContext.close()
  })

  test('anuncio-aula: tutor de la aula recibe; tutor de otra aula no', async ({ browser }) => {
    const profeContext = await browser.newContext()
    const tutorAulaContext = await browser.newContext()
    const profePage = await profeContext.newPage()
    const tutorAulaPage = await tutorAulaContext.newPage()

    // Login profe + tutor de la misma aula
    await profePage.goto('/es/login')
    await profePage.getByLabel(/email/i).fill(process.env.E2E_PROFE_EMAIL!)
    await profePage.getByLabel(/contraseña|password/i).fill(process.env.E2E_PROFE_PASSWORD!)
    await profePage.getByRole('button', { name: /entrar|sign in/i }).click()
    await profePage.waitForURL(/\/es\/teacher/)

    await tutorAulaPage.goto('/es/login')
    await tutorAulaPage.getByLabel(/email/i).fill(process.env.E2E_TUTOR_EMAIL!)
    await tutorAulaPage.getByLabel(/contraseña|password/i).fill(process.env.E2E_TUTOR_PASSWORD!)
    await tutorAulaPage.getByRole('button', { name: /entrar|sign in/i }).click()
    await tutorAulaPage.waitForURL(/\/es\/family/)

    // Tutor abre /messages tab Anuncios
    await tutorAulaPage.goto('/es/messages')
    await tutorAulaPage.getByRole('tab', { name: /anuncios/i }).click()

    // Profe publica un anuncio de aula
    const titulo = `E2E anuncio ${Date.now()}`
    await profePage.goto('/es/messages/nuevo-anuncio')
    await profePage.getByLabel(/título/i).fill(titulo)
    await profePage.getByLabel(/contenido/i).fill('Recordatorio de excursión la próxima semana')
    await profePage.getByRole('button', { name: /publicar/i }).click()
    await profePage.waitForURL(/\/messages\/anuncios\//)

    // Tutor del aula lo ve aparecer sin recargar
    await expect(tutorAulaPage.getByText(titulo)).toBeVisible({ timeout: 15_000 })

    await profeContext.close()
    await tutorAulaContext.close()
  })

  test('leer-baja-badge: abrir conversación baja el contador', async ({ browser }) => {
    const profeContext = await browser.newContext()
    const familiaContext = await browser.newContext()
    const profePage = await profeContext.newPage()
    const familiaPage = await familiaContext.newPage()

    await profePage.goto('/es/login')
    await profePage.getByLabel(/email/i).fill(process.env.E2E_PROFE_EMAIL!)
    await profePage.getByLabel(/contraseña|password/i).fill(process.env.E2E_PROFE_PASSWORD!)
    await profePage.getByRole('button', { name: /entrar|sign in/i }).click()
    await profePage.waitForURL(/\/es\/teacher/)

    await familiaPage.goto('/es/login')
    await familiaPage.getByLabel(/email/i).fill(process.env.E2E_TUTOR_EMAIL!)
    await familiaPage.getByLabel(/contraseña|password/i).fill(process.env.E2E_TUTOR_PASSWORD!)
    await familiaPage.getByRole('button', { name: /entrar|sign in/i }).click()
    await familiaPage.waitForURL(/\/es\/family/)

    // Profe envía un mensaje nuevo desde la conversación.
    await profePage.goto(`/es/messages/nino/${process.env.E2E_NINO_ID}`)
    const contenido = `unread-${Date.now()}`
    await profePage.getByPlaceholder(/escribe tu mensaje/i).fill(contenido)
    await profePage.getByRole('button', { name: /enviar/i }).click()

    // Tutor está en su dashboard family — debe ver el badge aparecer en sidebar.
    await familiaPage.goto('/es/family')
    const badge = familiaPage.locator('[aria-label*="sin leer" i]').first()
    await expect(badge).toBeVisible({ timeout: 15_000 })

    // Tutor abre /messages y entra en la conversación; el badge desaparece.
    await familiaPage.goto('/es/messages')
    await familiaPage.getByText(contenido).first().click()
    await expect(badge).toHaveCount(0, { timeout: 15_000 })

    await profeContext.close()
    await familiaContext.close()
  })

  // TODO(F5B): activar cuando exista e2e/helpers/seed-mensajes.ts con un
  // niño de ≥50 mensajes en el centro de pruebas. Hoy el test se queda
  // bajo el skip global del describe (E2E_REAL_SESSIONS !== '1') pero
  // incluso con la flag activa requiere ese seed; sin él el assert de
  // `scrollHeight > clientHeight` puede pasar por casualidad con pocos
  // mensajes y no validar realmente la regresión.
  test('F5B-Item4: el contenedor del split-view tiene scroll interno acotado con ≥50 mensajes', async ({
    browser,
  }) => {
    const profeContext = await browser.newContext()
    const profePage = await profeContext.newPage()

    await profePage.goto('/es/login')
    await profePage.getByLabel(/email/i).fill(process.env.E2E_PROFE_EMAIL!)
    await profePage.getByLabel(/contraseña|password/i).fill(process.env.E2E_PROFE_PASSWORD!)
    await profePage.getByRole('button', { name: /entrar|sign in/i }).click()
    await profePage.waitForURL(/\/es\/teacher/)

    // Mobile 375x812 (iPhone 13 mini).
    await profePage.setViewportSize({ width: 375, height: 812 })
    await profePage.goto(`/es/messages?nino=${process.env.E2E_NINO_ID}`)
    await profePage.waitForSelector('[data-testid="conv-split-scroll"]')

    const dimsMobile = await profePage
      .locator('[data-testid="conv-split-scroll"]')
      .evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
    expect(dimsMobile.clientHeight).toBeGreaterThan(0)
    expect(dimsMobile.scrollHeight).toBeGreaterThan(dimsMobile.clientHeight)
    // Sanity: clientHeight cabe en el viewport (no infinito).
    expect(dimsMobile.clientHeight).toBeLessThan(812)

    // Desktop 1280x800.
    await profePage.setViewportSize({ width: 1280, height: 800 })
    await profePage.reload()
    await profePage.waitForSelector('[data-testid="conv-split-scroll"]')

    const dimsDesktop = await profePage
      .locator('[data-testid="conv-split-scroll"]')
      .evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
    expect(dimsDesktop.scrollHeight).toBeGreaterThan(dimsDesktop.clientHeight)
    expect(dimsDesktop.clientHeight).toBeLessThan(800)

    await profeContext.close()
  })
})

/**
 * E2E de Fase 5.6 (admin↔familia + ventana anulación + scroll).
 *
 * Activación: E2E_REAL_SESSIONS=1 con credenciales en .env.local.
 *
 * Variables esperadas:
 *  - E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
 *  - E2E_TUTOR_EMAIL, E2E_TUTOR_PASSWORD
 *  - E2E_NINO_ID (con el tutor anterior vinculado a este niño)
 *  - E2E_TUTOR_ID (UUID del tutor)
 *
 * Los 3 flujos completos no se ejecutan en CI por defecto (mismo patrón
 * que los E2E de F5). El "simular caducidad" para F5.6-A requeriría una
 * ruta admin para forzar `expires_at` por SQL o esperar 3 días reales,
 * así que ese paso se documenta como TODO dentro del test — el smoke
 * básico de "abrir / escribir / reabrir" sí queda cubierto.
 */
test.describe('Fase 5.6 — admin↔familia + ventana anulación (skip por defecto)', () => {
  test.skip(process.env.E2E_REAL_SESSIONS !== '1', 'Requiere credenciales E2E_* en .env.local')

  test('admin↔familia: admin abre conversación con tutor desde ficha del niño', async ({
    browser,
  }) => {
    const adminContext = await browser.newContext()
    const adminPage = await adminContext.newPage()

    await adminPage.goto('/es/login')
    await adminPage.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL!)
    await adminPage.getByLabel(/contraseña|password/i).fill(process.env.E2E_ADMIN_PASSWORD!)
    await adminPage.getByRole('button', { name: /entrar|sign in/i }).click()
    await adminPage.waitForURL(/\/es\/admin/)

    // Entrar en la ficha del niño, tab Vínculos.
    await adminPage.goto(`/es/admin/ninos/${process.env.E2E_NINO_ID}`)
    await adminPage.getByRole('tab', { name: /vínculos|vinculos/i }).click()

    // Pulsar el botón "Conversación con dirección" en la fila del tutor.
    await adminPage
      .getByRole('button', { name: /conversación con dirección|conversacion con direccion/i })
      .first()
      .click()

    // Debería navegar a /messages/conversacion/<id> con el badge "Dirección".
    await adminPage.waitForURL(/\/es\/messages\/conversacion\//)
    await expect(adminPage.getByTestId('badge-direccion')).toBeVisible()

    // Escribir y enviar un mensaje.
    const contenido = `admin-familia ${Date.now()}`
    await adminPage.getByPlaceholder(/escribe tu mensaje/i).fill(contenido)
    await adminPage.getByRole('button', { name: /enviar/i }).click()
    await expect(adminPage.getByText(contenido)).toBeVisible({ timeout: 10_000 })

    await adminContext.close()
  })

  test('admin↔familia: tutor ve badge "Dirección" en su sección y puede responder', async ({
    browser,
  }) => {
    const tutorContext = await browser.newContext()
    const tutorPage = await tutorContext.newPage()

    await tutorPage.goto('/es/login')
    await tutorPage.getByLabel(/email/i).fill(process.env.E2E_TUTOR_EMAIL!)
    await tutorPage.getByLabel(/contraseña|password/i).fill(process.env.E2E_TUTOR_PASSWORD!)
    await tutorPage.getByRole('button', { name: /entrar|sign in/i }).click()
    await tutorPage.waitForURL(/\/es\/family/)

    await tutorPage.goto('/es/messages')

    // La sección "Dirección" debería contener al menos el hilo creado
    // en el test anterior. Asumimos que el test admin corrió antes
    // (Playwright preserva el orden por defecto dentro de un file).
    const direccionBadge = tutorPage.getByText(/dirección|direccio/i).first()
    await expect(direccionBadge).toBeVisible({ timeout: 10_000 })

    // Abrir el hilo y responder.
    await direccionBadge.click()
    await tutorPage.waitForURL(/\/es\/messages\/conversacion\//)
    const respuesta = `tutor-respuesta ${Date.now()}`
    await tutorPage.getByPlaceholder(/escribe tu mensaje/i).fill(respuesta)
    await tutorPage.getByRole('button', { name: /enviar/i }).click()
    await expect(tutorPage.getByText(respuesta)).toBeVisible({ timeout: 10_000 })

    // TODO: forzar caducidad por SQL (UPDATE expires_at = now() - interval '1 day')
    // y verificar que el composer se renderiza deshabilitado con el banner
    // "composer-cerrado" + que el admin (no el tutor) ve el botón Reabrir.
    // Requiere una ruta admin de test o ejecutar SQL desde el harness — se
    // hace en seguimiento aparte si el smoke de prod descubre regresión.

    await tutorContext.close()
  })

  test('marcar erróneo: dentro de 5 min OK; fuera de ventana el botón no aparece', async ({
    browser,
  }) => {
    const profeContext = await browser.newContext()
    const profePage = await profeContext.newPage()

    await profePage.goto('/es/login')
    await profePage.getByLabel(/email/i).fill(process.env.E2E_PROFE_EMAIL!)
    await profePage.getByLabel(/contraseña|password/i).fill(process.env.E2E_PROFE_PASSWORD!)
    await profePage.getByRole('button', { name: /entrar|sign in/i }).click()
    await profePage.waitForURL(/\/es\/teacher/)

    // Profe envía un mensaje fresco y verifica que el botón "marcar erróneo"
    // aparece (mensaje <5 min). Lo pulsa y confirma; la burbuja queda con
    // line-through.
    await profePage.goto(`/es/messages/nino/${process.env.E2E_NINO_ID}`)
    const contenido = `err-test ${Date.now()}`
    await profePage.getByPlaceholder(/escribe tu mensaje/i).fill(contenido)
    await profePage.getByRole('button', { name: /enviar/i }).click()
    const burbuja = profePage.getByText(contenido)
    await expect(burbuja).toBeVisible({ timeout: 10_000 })

    // El botón marcar erróneo en la burbuja propia <5 min debe estar visible.
    const marcarBtn = profePage.getByRole('button', { name: /anular|erróneo|erroneo/i }).last()
    await expect(marcarBtn).toBeVisible()
    await marcarBtn.click()
    await profePage.getByRole('button', { name: /confirmar|sí|si/i }).click()
    await expect(profePage.getByText(/anulado/i)).toBeVisible({ timeout: 10_000 })

    // TODO: simular "mensaje creado hace 10 min" con UPDATE directo a BD
    // (created_at antiguo) y recargar la página. Debe NO renderizarse el
    // botón "marcar erróneo" (early-return null del componente).
    // Requiere fixture seeding desde el harness — se hace en seguimiento.

    await profeContext.close()
  })

  // ─── F5B Items 1+2 — Admin direccion split-view ────────────────────────
  // El admin entra a `/messages?tab=direccion`, ve la lista de tutores del
  // centro, busca uno, lo selecciona y escribe el primer mensaje. El tutor
  // recibe el hilo en la sección "Dirección" de su tab Conversaciones.

  test('F5B Items 1+2: admin lista tutores, busca, selecciona, inicia hilo', async ({
    browser,
  }) => {
    // TODO(F5B): el test asume que existe al menos un tutor con vínculo
    // sobre `E2E_NINO_ID` que matchea con el patrón de búsqueda
    // `E2E_TUTOR_SEARCH_HINT` (típicamente las 3-4 primeras letras del
    // nombre del tutor). Si no se aporta, el filtrado client-side
    // probablemente devolverá la lista completa y el test seguirá
    // siendo válido (la selección es por id de tutor, no por nombre).
    const adminContext = await browser.newContext()
    const adminPage = await adminContext.newPage()

    await adminPage.goto('/es/login')
    await adminPage.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL!)
    await adminPage.getByLabel(/contraseña|password/i).fill(process.env.E2E_ADMIN_PASSWORD!)
    await adminPage.getByRole('button', { name: /entrar|sign in/i }).click()
    await adminPage.waitForURL(/\/es\/admin/)

    await adminPage.goto('/es/messages?tab=direccion')

    // El sidebar muestra al menos al tutor conocido. Su `data-testid` es
    // `tutor-list-item-<usuario_id>` — necesitamos el id, que vive en
    // E2E_TUTOR_ID (definido para los flujos admin↔familia).
    const tutorItem = adminPage.getByTestId(`tutor-list-item-${process.env.E2E_TUTOR_ID}`)
    await expect(tutorItem).toBeVisible({ timeout: 10_000 })

    // Ejercitar el buscador: tecleamos un fragmento del nombre y
    // verificamos que el item sigue visible (filtrado client-side).
    if (process.env.E2E_TUTOR_SEARCH_HINT) {
      await adminPage
        .getByPlaceholder(/buscar familia o niño/i)
        .fill(process.env.E2E_TUTOR_SEARCH_HINT)
      await expect(tutorItem).toBeVisible()
    }

    // Seleccionar el tutor.
    await tutorItem.click()
    await adminPage.waitForURL(
      new RegExp(`/es/messages\\?tab=direccion&tutor=${process.env.E2E_TUTOR_ID}`)
    )

    // Si el hilo NO existía aún, el panel muestra `panel-iniciar-empty`;
    // si ya existía, muestra `conv-admin-familia`. En cualquier caso,
    // el composer está disponible.
    const composer = adminPage.getByTestId('mensaje-composer-form')
    await expect(composer).toBeVisible({ timeout: 10_000 })

    const contenido = `admin-direccion ${Date.now()}`
    await adminPage.getByPlaceholder(/escribe tu mensaje/i).fill(contenido)
    await adminPage.getByRole('button', { name: /enviar/i }).click()

    // Tras enviar, el SSR refresca y el panel debe mostrar la burbuja.
    await expect(adminPage.getByText(contenido)).toBeVisible({ timeout: 10_000 })

    await adminContext.close()
  })

  test('F5B Items 1+2: tutor recibe el hilo en su sección Dirección', async ({ browser }) => {
    // Asume que el test anterior corrió antes y dejó al menos un hilo
    // admin↔familia activo entre adminA y tutorConocido.
    const tutorContext = await browser.newContext()
    const tutorPage = await tutorContext.newPage()

    await tutorPage.goto('/es/login')
    await tutorPage.getByLabel(/email/i).fill(process.env.E2E_TUTOR_EMAIL!)
    await tutorPage.getByLabel(/contraseña|password/i).fill(process.env.E2E_TUTOR_PASSWORD!)
    await tutorPage.getByRole('button', { name: /entrar|sign in/i }).click()
    await tutorPage.waitForURL(/\/es\/family/)

    await tutorPage.goto('/es/messages')

    // La sección "Dirección" debe estar visible (la pinta `AdminFamiliaSection`
    // cuando hay al menos un hilo del par admin↔tutor).
    await expect(tutorPage.getByTestId('admin-familia-section')).toBeVisible({ timeout: 10_000 })

    // Click en el primer item → carga la vista del hilo y puede responder.
    const primerItem = tutorPage.locator('[data-testid^="admin-familia-list-item-"]').first()
    await primerItem.click()
    await tutorPage.waitForURL(/\/es\/messages\/conversacion\//)
    const respuesta = `respuesta tutor ${Date.now()}`
    await tutorPage.getByPlaceholder(/escribe tu mensaje/i).fill(respuesta)
    await tutorPage.getByRole('button', { name: /enviar/i }).click()
    await expect(tutorPage.getByText(respuesta)).toBeVisible({ timeout: 10_000 })

    await tutorContext.close()
  })

  // TODO(F5B): activar cuando exista e2e/helpers/seed-aulas-multitutor.ts
  // con un aula que contenga al menos un niño con ≥2 tutores activos. Si
  // no, este test valida el caso 1-tutor: el picker es transparente (sin
  // Dialog) y navega directo. Sin seed, no podemos validar el modo Dialog.
  test('F5B #33: admin desde vista de aula → picker → SplitView con tutor preseleccionado', async ({
    browser,
  }) => {
    const adminContext = await browser.newContext()
    const adminPage = await adminContext.newPage()

    await adminPage.goto('/es/login')
    await adminPage.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL!)
    await adminPage.getByLabel(/contraseña|password/i).fill(process.env.E2E_ADMIN_PASSWORD!)
    await adminPage.getByRole('button', { name: /entrar|sign in/i }).click()
    await adminPage.waitForURL(/\/es\/admin/)

    // Admin abre la vista de aula (la ruta /teacher/aula/[id] sirve a
    // ambos roles; admin la usa para supervisar).
    await adminPage.goto(`/es/teacher/aula/${process.env.E2E_AULA_ID}`)

    // Localizamos la primera card y su botón "Escribir a la familia".
    const escribirBtn = adminPage.locator('[data-testid="escribir-familia-button"]').first()
    await expect(escribirBtn).toBeVisible({ timeout: 10_000 })

    // Caso esperado en el seed actual (1 tutor por niño): click navega
    // directo al SplitView con ?tab=direccion&tutor=<id>. Si en el seed
    // hay ≥2 tutores, el botón abre Dialog; añadiremos rama cuando
    // exista el helper de seed multi-tutor.
    await escribirBtn.click()
    await adminPage.waitForURL(/\/es\/messages\?tab=direccion&tutor=/, { timeout: 10_000 })

    // Verifica que el SplitView del PR #32 está montado y el tutor
    // queda preseleccionado (el item de la lista activa coincide con el
    // ?tutor=<id> de la URL).
    const url = new URL(adminPage.url())
    const tutorId = url.searchParams.get('tutor')
    expect(tutorId).toBeTruthy()
    const itemActivo = adminPage.locator(`[data-testid="tutor-list-item-${tutorId}"]`)
    await expect(itemActivo).toBeVisible({ timeout: 10_000 })

    await adminContext.close()
  })
})
