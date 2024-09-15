import path from 'path'
import {execSync} from 'child_process'
import {extensionFixtures} from '../extension-fixtures'

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
    .toHaveText('This is a new tab page running React and Tailwind.css.')
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
