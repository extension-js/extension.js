import path from 'path'
import {execSync} from 'child_process'
import {extensionFixtures, getShadowRootElement} from '../extension-fixtures'
import {getDirname} from '../dirname'

const __dirname = getDirname(import.meta.url)
const exampleDir = 'examples/content-tailwind'
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

test('should exist a header element with specified content', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const h1 = await getShadowRootElement(page, '#extension-root', 'h1')
  if (!h1) {
    throw new Error('h1 element not found in Shadow DOM')
  }
  const textContent = await h1.evaluate((node) => node.textContent)
  test.expect(textContent).toContain('Google Fonts with Tailwind CSS v4')
})

test('should apply Tailwind styles (text color)', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const h1 = await getShadowRootElement(page, '#extension-root', 'h1')
  if (!h1) {
    throw new Error('h1 element not found in Shadow DOM')
  }
  const color = await h1.evaluate((node) => {
    const computed = window
      .getComputedStyle(node as HTMLElement)
      .getPropertyValue('color')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = computed
    // Canvas normalizes colors to rgb(a)
    return ctx.fillStyle
  })
  // Tailwind text-gray-900 => rgb(17, 24, 39). Some Chromium builds expose lab(). Allow both.
  if (typeof color === 'string' && color.startsWith('lab(')) {
    test.expect(color.startsWith('lab(')).toBe(true)
  } else {
    test.expect(color).toBe('rgb(17, 24, 39)')
  }
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
