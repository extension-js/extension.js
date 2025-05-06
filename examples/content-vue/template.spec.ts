import path from 'path'
import {execSync} from 'child_process'
import {extensionFixtures, getShadowRootElement} from '../extension-fixtures'
import {getDirname} from '../dirname'

const __dirname = getDirname(import.meta.url)
const exampleDir = 'examples/content-vue'
const pathToExtension = path.join(__dirname, `dist/chrome`)
const test = extensionFixtures(pathToExtension, true)

test.beforeAll(async () => {
  execSync(`pnpm extension build ${exampleDir}`, {
    cwd: path.join(__dirname, '..')
  })
})

test('should exist an element with the class name extension-root', async ({
  page
}) => {
  await page.goto('https://extension.js.org/')
  const shadowRootHandle = await page
    .locator('#extension-root')
    .evaluateHandle((host: HTMLElement) => host.shadowRoot)

  // Validate that the Shadow DOM exists
  test.expect(shadowRootHandle).not.toBeNull()

  // Verify Shadow DOM has children
  const shadowChildrenCount = await shadowRootHandle.evaluate(
    (shadowRoot: ShadowRoot) => shadowRoot.children.length
  )
  test.expect(shadowChildrenCount).toBeGreaterThan(0)
})

test('should exist an h2 element with specified content', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const h2 = await getShadowRootElement(page, '#extension-root', 'h2')
  if (!h2) {
    throw new Error('h2 element not found in Shadow DOM')
  }
  const textContent = await h2.evaluate((node) => node.textContent)
  await test
    .expect(textContent)
    .toContain(
      'This is a content script running Vue, TypeScript, and Tailwind.css.'
    )
})

test('should exist a default color value', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const h2 = await getShadowRootElement(page, '#extension-root', 'h2')
  if (!h2) {
    throw new Error('h2 element not found in Shadow DOM')
  }
  const color = await h2.evaluate((node) =>
    window.getComputedStyle(node as HTMLElement).getPropertyValue('color')
  )
  test.expect(color).toEqual('rgb(255, 255, 255)')
})

test('should load all images successfully', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const shadowRootHandle = await page
    .locator('#extension-root')
    .evaluateHandle((host: HTMLElement) => host.shadowRoot)

  const imagesHandle = await shadowRootHandle.evaluateHandle(
    (shadow: ShadowRoot) => Array.from(shadow.querySelectorAll('img'))
  )

  const imageHandles = await imagesHandle.getProperties()
  const results: boolean[] = []

  for (const [, imageHandle] of imageHandles) {
    const naturalWidth = await imageHandle.evaluate(
      (img) => (img as HTMLImageElement).naturalWidth
    )
    const naturalHeight = await imageHandle.evaluate(
      (img) => (img as HTMLImageElement).naturalHeight
    )
    const loadedSuccessfully = naturalWidth > 0 && naturalHeight > 0
    results.push(loadedSuccessfully)
  }

  test.expect(results.every((result) => result)).toBeTruthy()
})
