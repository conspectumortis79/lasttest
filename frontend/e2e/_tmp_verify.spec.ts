// Temporary: capture both buttons + a selected endpoint for a
// visual check that the colors match.
import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const demoSpecification = path.resolve(currentDirectory, '../../demo/openapi-demo.yaml')

test('start button matches endpoint selection accent', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(demoSpecification)
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
  // Select the first endpoint
  await page.getByLabel(/Endpoint GET \/products auswählen/).check()
  // Scroll to the start button
  await page.locator('.start').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  await page.screenshot({ path: '/tmp/buttons-after.png', fullPage: true })
})
