/* eslint-disable jest/no-identical-title, playwright/no-identical-title */
import path from 'path'
import * as fs from 'fs'
import {execFileSync} from 'child_process'
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
  // Chromium-only e2e: dist/chromium
  const chromiumOut = path.join(dir, 'dist/chromium')
  const expectedOutDir = chromiumOut
  const pathToExtension = expectedOutDir
  const t = extensionFixtures(pathToExtension, false)
  const displayName = path.basename(exampleDir)
  const hasSidebar = fs.existsSync(path.join(dir, 'src', 'sidebar'))

  // Chromium-only: extension loading uses Chromium persistent context
  t.skip(
    ({browserName}) => browserName !== 'chromium',
    'Chromium-only template tests'
  )

  t.describe(displayName, () => {
    t.beforeAll(async () => {
      // Ensure deterministic output: clean chromium output
      try {
        if (fs.existsSync(chromiumOut))
          fs.rmSync(chromiumOut, {recursive: true, force: true})
      } catch {
        // ignore
      }

      // Templates are source-only. Ensure deps are installed before building.
      execFileSync('pnpm', ['install', '--ignore-scripts'], {
        cwd: dir,
        stdio: 'inherit'
      })

      const args = ['extension', 'build', exampleDir]
      execFileSync('pnpm', args, {
        cwd: path.join(dir, '..'),
        stdio: 'inherit'
      })
      const fsMod = await import('fs')
      if (!fsMod.existsSync(expectedOutDir)) {
        throw new Error(
          `Build output missing at ${expectedOutDir}. Ensure the template builds to dist/chromium.`
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

    if (hasSidebar) {
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
    }
  })
}
