import { expect, type Page } from '@playwright/test'

/**
 * Harness de login E2E con sesiones reales contra el Supabase remoto.
 *
 * Se activa solo cuando `E2E_REAL_SESSIONS=1`; sin esa variable los specs que
 * dependan de login deben hacer `test.skip` (ver `skipSinSesionesReales`). Las
 * credenciales y los ids de datos viven en `.env.local` (gitignored, regla #10);
 * nunca se hardcodean (repo público, regla #6).
 *
 * Variables esperadas (todas obligatorias cuando `E2E_REAL_SESSIONS=1`):
 *  - E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD   → cuenta admin del centro
 *  - E2E_PROFE_EMAIL / E2E_PROFE_PASSWORD   → cuenta profe (solo rol profe),
 *                                             asignada a E2E_AULA_ID
 *  - E2E_TUTOR_EMAIL / E2E_TUTOR_PASSWORD   → tutor de E2E_NINO_ID
 *  - E2E_AULA_ID                            → aula de la profe
 *  - E2E_NINO_ID                            → niño del aula, hijo del tutor
 *
 * Nota: para que `getRolEnCentro` devuelva el rol esperado sin ambigüedad, las
 * cuentas profe/tutor deben tener UN solo rol en el centro (la prioridad
 * admin>profe>tutor haría que una cuenta multi-rol cargara como admin).
 */

export type E2ERole = 'admin' | 'profe' | 'tutor'

const LOCALES = '(es|en|va)'

/** Dashboard al que aterriza cada rol tras el login. */
export const DASHBOARD: Record<E2ERole, RegExp> = {
  admin: new RegExp(`/${LOCALES}/admin(\\b|/|$)`),
  profe: new RegExp(`/${LOCALES}/teacher(\\b|/|$)`),
  tutor: new RegExp(`/${LOCALES}/family(\\b|/|$)`),
}

/** Texto del botón de rol en /select-role (cuentas multi-rol), es/en/va. */
const ROLE_BUTTON: Record<E2ERole, RegExp> = {
  admin: /administraci|admin/i,
  profe: /profe|docent|teacher/i,
  tutor: /familia|tutor|family/i,
}

function env(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`Falta la variable de entorno ${key} (E2E_REAL_SESSIONS=1).`)
  return v
}

function credsFor(role: E2ERole): { email: string; password: string } {
  const prefix = role === 'tutor' ? 'TUTOR' : role.toUpperCase()
  return { email: env(`E2E_${prefix}_EMAIL`), password: env(`E2E_${prefix}_PASSWORD`) }
}

/** Datos de prueba compartidos por los specs. */
export const E2E_DATA = {
  aulaId: () => env('E2E_AULA_ID'),
  ninoId: () => env('E2E_NINO_ID'),
}

/** `true` si NO hay sesiones reales configuradas → el spec debe saltarse. */
export const skipSinSesionesReales = process.env.E2E_REAL_SESSIONS !== '1'

/**
 * Inicia sesión como el rol indicado y deja la página en su dashboard. Gestiona
 * el paso intermedio /select-role (auto-redirige con 1 rol; con varios, pulsa el
 * botón del rol). Lanza si las credenciales no entran (no enmascara fallos).
 */
export async function loginAs(page: Page, role: E2ERole, locale = 'es'): Promise<void> {
  const { email, password } = credsFor(role)

  await page.goto(`/${locale}/login`)
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/contraseña|password/i).fill(password)
  await page.getByRole('button', { name: /entrar|sign in|inicia|accede/i }).click()

  await page.waitForURL(new RegExp(`/${LOCALES}/(select-role|admin|teacher|family)`), {
    timeout: 20_000,
  })

  if (/\/select-role/.test(new URL(page.url()).pathname)) {
    await page.getByRole('button', { name: ROLE_BUTTON[role] }).first().click()
  }

  await expect(page, `login como ${role} debería aterrizar en su dashboard`).toHaveURL(
    DASHBOARD[role],
    { timeout: 20_000 }
  )
}
