import { expect, test } from '@playwright/test'

test('portfolio shell renders', async ({ page }) => {
  await page.goto('/portfolio')

  await expect(page.getByRole('link', { name: 'FinSight' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '$79,720.00' })).toBeVisible()
  await expect(page.getByTestId('portfolio-chart')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Wealthsimple TFSA' })).toBeVisible()
})
