import {test, expect} from '@playwright/test'
import path from 'path'
import {
  getExtensionId,
  getPathToExtension,
  getSidebarPath
} from '../extension-fixtures'

const exampleDir = 'examples/transformers-js'
const pathToExtension = getPathToExtension(exampleDir)
let extensionId: string

test.beforeAll(async () => {
  extensionId = await getExtensionId(pathToExtension)
})

test('should exist as a directory', async () => {
  expect(pathToExtension).toBeTruthy()
})

test('should have a manifest.json file', async () => {
  const manifestPath = `${pathToExtension}/manifest.json`
  const fs = await import('fs')
  expect(fs.existsSync(manifestPath)).toBe(true)
})

test('should have a valid extension ID', async () => {
  expect(extensionId).toBeTruthy()
  expect(extensionId).toMatch(/^[a-z]{32}$/)
})

test('should have sidebar functionality', async ({page, context}) => {
  // Navigate to the sidebar
  const sidebarPath = getSidebarPath(extensionId)
  await page.goto(sidebarPath)
  // Wait for service worker/side panel to be ready
  await page.waitForLoadState('load')

  // Check that the sidebar loads
  await expect(page.locator('h1')).toContainText('Transformers.js')
  await expect(page.locator('h2')).toContainText(
    'Run 🤗 Transformers in the Side Panel!'
  )

  // Check that input field exists
  await expect(page.locator('#text')).toBeVisible()
  await expect(page.locator('#output')).toBeVisible()
})

test('should have working text input', async ({page}) => {
  const sidebarPath = getSidebarPath(extensionId)
  await page.goto(sidebarPath)
  await page.waitForLoadState('load')

  // Wait for the page to load
  await page.waitForSelector('#text')

  // Type in the input field
  await page.fill('#text', 'This is a great day!')

  // The input should contain the text
  const inputValue = await page.inputValue('#text')
  expect(inputValue).toBe('This is a great day!')
})

test('should have proper styling', async ({page}) => {
  const sidebarPath = getSidebarPath(extensionId)
  await page.goto(sidebarPath)
  await page.waitForLoadState('load')

  // Check that styles are applied
  const container = page.locator('.container')
  await expect(container).toBeVisible()

  // Check that the output area has proper styling
  const output = page.locator('#output')
  const outputStyles = await output.evaluate((el) => {
    const styles = window.getComputedStyle(el)
    return {
      fontFamily: styles.fontFamily,
      backgroundColor: styles.backgroundColor,
      borderRadius: styles.borderRadius
    }
  })

  expect(outputStyles.fontFamily).toContain('Roboto Mono')
})

test.afterAll(async () => {
  const fs = await import('fs')
  try {
    const distDir = path.dirname(pathToExtension)
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, {recursive: true, force: true})
    }
  } catch {}
})
