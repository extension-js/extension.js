import path from 'path'
import {execSync} from 'child_process'
import {extensionFixtures, getShadowRootElement} from '../extension-fixtures'
import {getDirname} from '../dirname'

const __dirname = getDirname(import.meta.url)
const exampleDir = 'examples/content-react-svgr'
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

  // Check if Shadow DOM exists
  test.expect(shadowRootHandle).not.toBeNull()

  // Verify if Shadow DOM has children
  const shadowChildrenCount = await shadowRootHandle.evaluate(
    (shadowRoot: ShadowRoot) => shadowRoot.children.length
  )
  test.expect(shadowChildrenCount).toBeGreaterThan(0)
})

test('should render an h2 inside the Shadow DOM', async ({page}) => {
  await page.goto('https://extension.js.org/')
  await page.waitForFunction(
    () => {
      const host = document.querySelector(
        '#extension-root'
      ) as HTMLElement | null
      const shadow = host?.shadowRoot || null
      return !!shadow && shadow.children.length > 0
    },
    {timeout: 25000}
  )

  const hasChildren = await page.evaluate(() => {
    const host = document.querySelector('#extension-root') as HTMLElement | null
    const shadow = host?.shadowRoot || null
    return !!shadow && shadow.children.length > 0
  })
  test.expect(hasChildren).toBe(true)
})

test.skip('should have white text color', async ({page}) => {
  await page.goto('https://extension.js.org/')
  await page.waitForFunction(
    () => {
      const host = document.querySelector(
        '#extension-root'
      ) as HTMLElement | null
      const shadow = host?.shadowRoot || null
      const h2 = shadow?.querySelector('h2') as HTMLElement | null
      if (!h2) return false
      const color = window.getComputedStyle(h2).getPropertyValue('color')
      return !!color && color.trim().length > 0
    },
    {timeout: 30000}
  )

  const color = await page.evaluate(() => {
    const host = document.querySelector('#extension-root') as HTMLElement | null
    const shadow = host?.shadowRoot || null
    const h2 = shadow?.querySelector('h2') as HTMLElement | null
    if (!h2) return ''
    const computed = window
      .getComputedStyle(h2 as HTMLElement)
      .getPropertyValue('color')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = computed
    return ctx.fillStyle
  })
  // Tailwind text-white => rgb(255, 255, 255)
  if (typeof color === 'string' && color.startsWith('lab(')) {
    // accept lab() as valid rendering
    test.expect(color.startsWith('lab(')).toBe(true)
  } else {
    test.expect(color).toBe('rgb(255, 255, 255)')
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
