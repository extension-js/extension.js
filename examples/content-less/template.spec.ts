import path from 'path'
import {execSync} from 'child_process'
import {extensionFixtures, takeScreenshot} from '../extension-fixtures'

const exampleDir = 'examples/content-less'
const pathToExtension = path.join(__dirname, `dist/chrome`)
const test = extensionFixtures(pathToExtension, true)

test.beforeAll(async () => {
  execSync(`pnpm extension build ${exampleDir}`, {
    cwd: path.join(__dirname, '..')
  })
})

test('should exist an element with the class name content_script', async ({
  page
}) => {
  await page.goto('https://extension.js.org/')
  const div = page.locator('body > div.content_script')
  await test.expect(div).toBeVisible()
})

test('should exist an h1 element with specified content', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const h1 = page.locator('body > div.content_script > h1')
  await test.expect(h1).toContainText('Welcome to your')
})

test('should exist a default color value', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const h1 = page.locator('body > div.content_script > h1')
  const color = await page.evaluate(
    (locator) => {
      return window.getComputedStyle(locator!).getPropertyValue('color')
    },
    await h1.elementHandle()
  )
  await test.expect(color).toEqual('rgb(201, 201, 201)')
})

test.skip('takes a screenshot of the page', async ({page}) => {
  await page.goto('https://extension.js.org/')
  await page.waitForSelector('body > div.content_script')
  await takeScreenshot(page, path.join(__dirname, 'screenshot.png'))
})
