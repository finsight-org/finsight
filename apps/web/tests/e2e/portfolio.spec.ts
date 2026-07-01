import { expect, test } from '@playwright/test'

test('portfolio shell renders', async ({ page }) => {
  await page.goto('/portfolio')

  await expect(page.getByRole('link', { name: 'FinSight' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '$2,000.00 CAD' })).toBeVisible()
  await expect(page.getByTestId('portfolio-chart')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible()
})
