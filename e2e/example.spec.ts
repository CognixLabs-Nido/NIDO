import { test, expect } from '@playwright/test'

test('la página de inicio carga correctamente', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/NIDO/)
})
