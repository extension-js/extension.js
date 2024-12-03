import path from 'path'
import {execSync} from 'child_process'
import {type Page, type ElementHandle} from '@playwright/test'
import {extensionFixtures} from '../extension-fixtures'

const exampleDir = 'examples/content-react'
const pathToExtension = path.join(__dirname, `dist/chrome`)
const test = extensionFixtures(pathToExtension, true)

test.beforeAll(async () => {
  execSync(`pnpm extension build ${exampleDir}`, {
    cwd: path.join(__dirname, '..')
  })
})

/**
 * Utility to access elements inside the Shadow DOM.
 * @param page The Playwright Page object.
 * @param shadowHostSelector The selector for the Shadow DOM host element.
 * @param innerSelector The selector for the element inside the Shadow DOM.
 * @returns A Promise resolving to an ElementHandle for the inner element or null if not found.
 */
async function getShadowRootElement(
  page: Page,
  shadowHostSelector: string,
  innerSelector: string
): Promise<ElementHandle<HTMLElement> | null> {
  const shadowHost = page.locator(shadowHostSelector)
  const shadowRootHandle = await shadowHost.evaluateHandle(
    (host: HTMLElement) => host.shadowRoot
  )

  const innerElement = await shadowRootHandle.evaluateHandle(
    (shadowRoot: ShadowRoot, selector: string) =>
      shadowRoot.querySelector(selector),
    innerSelector
  )

  return innerElement.asElement() as ElementHandle<HTMLElement> | null
}

test('should exist an element with the class name extension-root', async ({
  page
}) => {
  await page.goto('https://extension.js.org/')
  const div = page.locator('#extension-root')
  await test.expect(div).toBeVisible()
})

test('should exist an h2 element with specified content', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const h2 = await getShadowRootElement(page, '#extension-root', 'h2')
  if (!h2) {
    throw new Error('h2 element not found in Shadow DOM')
  }

  const textContent = await h2.evaluate((node) => node.textContent)
  await test.expect(textContent).toContain('This is a content script')
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
  await test.expect(color).toEqual('rgb(255, 255, 255)')
})

test('should load all images successfully', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const shadowRoot = await page
    .locator('#extension-root')
    .evaluateHandle((host: HTMLElement) => host.shadowRoot)

  const imagesHandle = await shadowRoot.evaluateHandle((shadow: ShadowRoot) =>
    Array.from(shadow.querySelectorAll('img'))
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

  await test.expect(results.every((result) => result)).toBeTruthy()
})
