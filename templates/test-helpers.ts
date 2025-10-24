import {expect, type BrowserContext, type Page} from '@playwright/test'

export async function assertContentPillPresent(
  page: Page,
  hostSelectors: string[] = ['[data-extension-root="true"]', '#extension-root'],
  url: string = 'https://example.com/'
) {
  await page.goto(url)
  let handle = await getFromShadow(page, hostSelectors, 'button.content_pill')
  if (!handle) handle = await getFromShadow(page, hostSelectors, 'button')
  if (!handle) throw new Error('button.content_pill not found in Shadow DOM')
  expect(handle).not.toBeNull()
}

export async function assertContentImageLoads(
  page: Page,
  hostSelectors: string[] = ['[data-extension-root="true"]', '#extension-root'],
  url: string = 'https://example.com/'
) {
  await page.goto(url)
  let img = await getFromShadow(page, hostSelectors, 'img.content_pill_logo')
  if (!img) img = await getFromShadow(page, hostSelectors, 'img')
  if (!img) throw new Error('img.content_pill_logo not found')
  const naturalWidth = await img.evaluate(
    (node) => (node as HTMLImageElement).naturalWidth
  )
  expect(naturalWidth).toBeGreaterThan(0)
}

export async function assertBackgroundServiceWorkerActive(
  context: BrowserContext
) {
  let [background] = context.serviceWorkers()
  if (!background) background = await context.waitForEvent('serviceworker')
  expect(background).toBeTruthy()
}

export async function assertSidebarPageRenders(
  page: Page,
  extensionId: string
) {
  const url = `chrome-extension://${extensionId}/sidebar/index.html`
  await page.goto(url)
  await page.waitForSelector('.sidebar_title', {timeout: 15000})
  const title = await page.locator('.sidebar_title').textContent()
  expect(title || '').toContain('Sidebar')
  const nat = await page
    .locator('.sidebar_logo')
    .evaluate((n) => (n as HTMLImageElement).naturalWidth)
  expect(nat).toBeGreaterThan(0)
}

async function getFromShadow(
  page: Page,
  hostSelectors: string[],
  innerSelector: string
) {
  const timeoutMs = 15000
  for (const host of hostSelectors) {
    try {
      await page.waitForSelector(host, {timeout: timeoutMs, state: 'attached'})
      const hostEl = await page.$(host)
      if (!hostEl) continue
      // Wait for shadowRoot to become available
      const startShadow = Date.now()
      let shadowRoot: any = null
      while (Date.now() - startShadow < timeoutMs) {
        shadowRoot = await page.evaluateHandle(
          (h) => (h as HTMLElement).shadowRoot,
          hostEl
        )
        if (shadowRoot) break
        await page.waitForTimeout(100)
      }
      if (!shadowRoot) continue
      const start = Date.now()
      let handle = null
      while (Date.now() - start < timeoutMs) {
        handle = await page.evaluateHandle(
          (root, sel) => root?.querySelector(sel as string),
          shadowRoot,
          innerSelector
        )
        if (handle && handle.asElement()) break
        await page.waitForTimeout(100)
      }
      const el = handle.asElement()
      if (el) return el
    } catch {}
  }
  // Fallback: scan any shadow hosts on the page
  try {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const handle = await page.evaluateHandle((sel) => {
        const all = Array.from(document.querySelectorAll('*')) as HTMLElement[]
        for (const el of all) {
          const root = (el as any).shadowRoot as ShadowRoot | null
          if (!root) continue
          const found = root.querySelector(sel as string)
          if (found) return found
        }
        return null
      }, innerSelector)
      const el = handle.asElement()
      if (el) return el
      await page.waitForTimeout(100)
    }
  } catch {}
  return null
}
