import path from 'path'
import {execSync} from 'child_process'
import {
  extensionFixtures,
  getShadowRootElement,
  takeScreenshot
} from '../extension-fixtures'
import {getDirname} from '../dirname'

const __dirname = getDirname(import.meta.url)
const exampleDir = 'examples/content-typescript'
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
  const div = await getShadowRootElement(
    page,
    '#extension-root',
    'div.content_script'
  )
  if (!div) {
    throw new Error('div with class content_script not found in Shadow DOM')
  }
  test.expect(div).not.toBeNull()
})

test('should exist an h1 element with specified content', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const h1 = await getShadowRootElement(
    page,
    '#extension-root',
    'div.content_script > h1'
  )
  if (!h1) {
    throw new Error('h1 element not found in Shadow DOM')
  }
  const textContent = await h1.evaluate((node) => node.textContent)
  test.expect(textContent).toContain('Welcome to your')
})

test('should exist a default color value', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const h1 = await getShadowRootElement(
    page,
    '#extension-root',
    'div.content_script > h1'
  )
  if (!h1) {
    throw new Error('h1 element not found in Shadow DOM')
  }
  const color = await h1.evaluate((node) =>
    window.getComputedStyle(node as HTMLElement).getPropertyValue('color')
  )
  test.expect(color).toEqual('rgb(201, 201, 201)')
})

test.skip('takes a screenshot of the page', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const contentScriptDiv = await getShadowRootElement(
    page,
    '#extension-root',
    'div.content_script'
  )
  if (!contentScriptDiv) {
    throw new Error('div.content_script not found in Shadow DOM for screenshot')
  }
  await takeScreenshot(page, path.join(__dirname, 'screenshot.png'))
})
