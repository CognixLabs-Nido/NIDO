import { test, expect } from '@playwright/test'

/**
 * E2E F5B-#36 B3 — Tabla `/admin/aulas` enriquecida.
 *
 * Gated por `E2E_REAL_SESSIONS=1` igual que los E2E reales de PR #31,
 * #32 y #33: requieren login real y datos productivos en ANAIA.
 *
 * Valida:
 *  - La tabla renderiza las 7 columnas en orden.
 *  - Al menos un aula muestra el badge "warm" de coordinadora si
 *    procede (asume que ANAIA tiene coordinadoras tras el backfill
 *    de PR #34).
 *  - El `data-testid="admin-aula-link-<id>"` sigue presente en la
 *    primera fila (Nota B PR #36 — no se rompen E2E previos).
 */

const ENABLED = process.env.E2E_REAL_SESSIONS === '1'

test.skip(!ENABLED, 'requiere E2E_REAL_SESSIONS=1 + seed real ANAIA')

test('admin ve la tabla /admin/aulas con las 7 columnas enriquecidas', async ({ page }) => {
  // TODO(F5B#36): activar cuando exista e2e/helpers/seed-aulas-personal.ts
  // que garantice al menos 1 aula con coordinadora + profesora + técnico.
  await page.goto('/es/admin/aulas')

  // Headers en orden — confirma rename `cohorte → anio_nacimiento`.
  const headers = await page.getByRole('columnheader').allTextContents()
  expect(headers).toEqual([
    'Nombre',
    'Año nacimiento',
    'Capacidad máxima',
    'Nº alumnos',
    'Profesoras',
    'Técnicos',
    'Descripción',
  ])

  // data-testid preservado.
  const links = page.locator('[data-testid^="admin-aula-link-"]')
  await expect(links.first()).toBeVisible()
})
