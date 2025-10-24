/* eslint-disable jest/no-identical-title, playwright/no-identical-title */
import path from 'path'
import {execSync} from 'child_process'
import {test, expect} from '@playwright/test'
import {extensionFixtures} from './extension-fixtures'
import {
  assertBackgroundServiceWorkerActive,
  assertContentImageLoads,
  assertContentPillPresent,
  assertSidebarPageRenders
} from './test-helpers'

type Params = {
  exampleDir: string
  dir: string
  hostSelectors?: string[]
}

export function registerTemplateTests({
  exampleDir,
  dir,
  hostSelectors
}: Params) {
  const pathToExtension = path.join(dir, 'dist/chrome')
  const t = extensionFixtures(pathToExtension, false)
  const displayName = path.basename(exampleDir)

  // Chromium-only: extension loading uses Chromium persistent context
  t.skip(
    ({browserName}) => browserName !== 'chromium',
    'Chromium-only template tests'
  )

  t.describe(displayName, () => {
    t.beforeAll(async () => {
      execSync(`pnpm extension build ${exampleDir}`, {
        cwd: path.join(dir, '..')
      })
      const fs = await import('fs')
      if (!fs.existsSync(pathToExtension)) {
        throw new Error(
          `Build output missing at ${pathToExtension}. Ensure the template builds to dist/chrome.`
        )
      }
    })

    t('content host and pill present', async ({page}) => {
      await assertContentPillPresent(
        page,
        hostSelectors,
        'https://example.com/'
      )
    })

    t('content image loads', async ({page}) => {
      await assertContentImageLoads(page, hostSelectors, 'https://example.com/')
    })

    t('background service worker is active', async ({context}) => {
      await assertBackgroundServiceWorkerActive(context)
    })

    t(
      'sidebar page renders with title and image',
      async ({page, extensionId}) => {
        await assertSidebarPageRenders(page, extensionId)
      }
    )

    t('sidebar assets built', async () => {
      const fs = await import('fs')
      const htmlPath = path.join(pathToExtension, 'sidebar', 'index.html')
      expect(
        fs.existsSync(htmlPath),
        `sidebar not found at ${htmlPath}; built path: ${pathToExtension}`
      ).toBeTruthy()
    })
  })
}
