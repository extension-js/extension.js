import path from 'path'
import {execSync} from 'child_process'
import {extensionFixtures, takeScreenshot} from '../extension-fixtures'

const exampleDir = 'examples/new-react'
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
  const h1 = await page.waitForSelector('h1', {
    state: 'visible',
    timeout: 10000
  })
  const textContent = await h1.textContent()
  test.expect(textContent).toMatch(/Welcome to your/i)
})

test('should exist a default color value', async ({page}) => {
  await page.goto('chrome://newtab/')
  const h1 = page.locator('h1')
  const color = await page.evaluate(
    (locator) => {
      return window.getComputedStyle(locator!).getPropertyValue('color')
    },
    await h1.elementHandle()
  )
  test.expect(color).toEqual('rgb(201, 201, 201)')
})

test.skip('takes a screenshot of the page', async ({page}) => {
  await page.goto('chrome://newtab/')
  await page.waitForSelector('h1')
  await takeScreenshot(page, path.join(__dirname, 'screenshot.png'))
})
