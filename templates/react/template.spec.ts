import {
  extensionFixtures,
  getSidebarPath,
  resolveBuiltExtensionPath
} from '../extension-fixtures.js'
import {getDirname} from '../dirname.js'

const __dirname = getDirname(import.meta.url)
const pathToExtension = resolveBuiltExtensionPath(__dirname)
const test = extensionFixtures(pathToExtension)

async function getContentHost(page: any) {
  return await page.waitForSelector(
    '#extension-root, [data-extension-root="true"]',
    {
      state: 'attached',
      timeout: 15000
    }
  )
}

async function queryInShadow(page: any, hostLocator: any, selector: string) {
  const shadow = await hostLocator.evaluateHandle(
    (host: HTMLElement) => host.shadowRoot
  )
  return await shadow.evaluateHandle(
    (root: ShadowRoot, sel: string) => root?.querySelector(sel) ?? null,
    selector
  )
}

test('content script renders visible UI', async ({page, extensionId}) => {
  await page.goto('https://example.com/')
  const host = await getContentHost(page)
  const heading = await queryInShadow(page, host, 'h1, h2')
  test.expect(heading).not.toBeNull()
})

test('sidebar renders a visible heading', async ({page, extensionId}) => {
  await page.goto(getSidebarPath(extensionId))
  const heading = page.locator('h1, h2').first()
  await heading.waitFor({state: 'visible', timeout: 15000})
  await test.expect(heading).toBeVisible()
})
