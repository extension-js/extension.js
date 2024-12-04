import path from 'path'
import {execSync} from 'child_process'
import {extensionFixtures, takeScreenshot} from '../extension-fixtures'

const exampleDir = 'examples/new-tailwind'
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
  const h2 = page.locator('h2')
  await test
    .expect(h2)
    .toContainText('This is a new tab page running React and Tailwind.css.')
})

test('should exist a default color value', async ({page}) => {
  await page.goto('chrome://newtab/')
  const h2 = page.locator('h2')
  const color = await page.evaluate(
    (locator) => {
      return window.getComputedStyle(locator!).getPropertyValue('color')
    },
    await h2.elementHandle()
  )
  await test.expect(color).toEqual('rgb(255, 255, 255)')
})

test.skip('takes a screenshot of the page', async ({page}) => {
  await page.goto('chrome://newtab/')
  await page.waitForSelector('h1')
  await takeScreenshot(page, path.join(__dirname, 'screenshot.png'))
})
