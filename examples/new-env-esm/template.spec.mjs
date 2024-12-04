import path from 'path'
import {fileURLToPath} from 'url'
import {execSync} from 'child_process'
import {extensionFixtures, takeScreenshot} from '../extension-fixtures.mjs'

// Recreate __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const exampleDir = 'examples/new-env-esm'
const pathToExtension = path.join(__dirname, `dist/chrome`)

const test = extensionFixtures(pathToExtension, true)

test.beforeAll(async () => {
  execSync(`pnpm extension build ${exampleDir}`, {
    cwd: path.join(__dirname, '..')
  })
})

test('should exist an element with the welcome message text', async ({
  page
}) => {
  await page.goto('chrome://newtab/')
  const h1 = page.locator('h1')
    test.expect(h1).toContainText('Welcome to your');

  // Take a screenshot once the element is found
  await takeScreenshot(page, path.join(__dirname, 'screenshot.png'));
})

test('should exist a default color value', async ({page}) => {
  await page.goto('chrome://newtab/')
  const h1 = page.locator('h1')
  const color = await page.evaluate(
    (locator) => {
      return window.getComputedStyle(locator).getPropertyValue('color')
    },
    await h1.elementHandle()
  )
  test.expect(color).toEqual('rgb(201, 201, 201)')
})
