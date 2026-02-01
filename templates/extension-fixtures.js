import {test as base, chromium} from '@playwright/test'
import path from 'path'
import {execSync} from 'child_process'
import fs from 'fs'
import {getDirname} from './dirname.js'

export const extensionFixtures = (pathToExtension, headless) => {
  // Default to headed mode for better extension compatibility.
  const isHeadless =
    headless !== undefined ? headless : process.env.HEADLESS === 'true'

  // Map to store userDataDir per context instance (for parallel test safety)
  const userDataDirMap = new WeakMap()

  return base.extend({
    context: async ({}, use) => {
      const os = await import('os')
      const tmpRoot = os.tmpdir()
      let userDataDir = ''
      let context = null
      try {
        userDataDir = fs.mkdtempSync(path.join(tmpRoot, 'pw-ext-'))
        context = await chromium.launchPersistentContext(userDataDir, {
          headless: isHeadless,
          args: [
            `--disable-extensions-except=${pathToExtension}`,
            `--load-extension=${pathToExtension}`,
            '--no-first-run',
            '--disable-extensions-file-access-check',
            '--disable-client-side-phishing-detection',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-features=InterestFeedContentSuggestions',
            '--disable-features=Translate',
            '--hide-scrollbars',
            '--mute-audio',
            '--no-default-browser-check',
            '--no-first-run',
            '--ash-no-nudges',
            '--disable-search-engine-choice-screen',
            '--disable-features=MediaRoute',
            '--use-mock-keychain',
            '--disable-background-networking',
            '--disable-breakpad',
            '--disable-component-update',
            '--disable-domain-reliability',
            '--disable-features=AutofillServerCommunicatio',
            '--disable-features=CertificateTransparencyComponentUpdate',
            '--disable-sync',
            '--disable-features=OptimizationHints',
            '--disable-features=DialMediaRouteProvider',
            '--no-pings',
            '--enable-features=SidePanelUpdates'
          ].filter((arg) => !!arg)
        })

        userDataDirMap.set(context, userDataDir)

        let hasServiceWorker = false
        try {
          if (context.serviceWorkers().length === 0) {
            await context
              .waitForEvent('serviceworker', {timeout: 3000})
              .catch(() => {
                /* extension may not have background script */
              })
          }
          hasServiceWorker = context.serviceWorkers().length > 0
        } catch {
          /* extension may not have background script */
        }

        if (!hasServiceWorker) {
          await new Promise((resolve) => setTimeout(resolve, 2500))
        }

        await use(context)
      } finally {
        if (context) {
          try {
            await context.close()
          } catch {
            /* ignore close errors */
          }
        }
        try {
          if (userDataDir && fs.existsSync(userDataDir)) {
            fs.rmSync(userDataDir, {recursive: true, force: true})
          }
        } catch {
          /* ignore cleanup errors */
        }
      }
    },
    page: async ({context}, use) => {
      const pages = context.pages()
      const page = pages.length > 0 ? pages[0] : await context.newPage()
      await use(page)
    },
    extensionId: async ({context}, use) => {
      if (
        !fs.existsSync(pathToExtension) ||
        !fs.existsSync(path.join(pathToExtension, 'manifest.json'))
      ) {
        throw new Error(
          `Extension not built or invalid: ${pathToExtension}. ` +
            `Directory exists: ${fs.existsSync(pathToExtension)}, ` +
            `Manifest exists: ${fs.existsSync(path.join(pathToExtension, 'manifest.json'))}`
        )
      }

      let extensionId

      const readExtensionIdFromPreferences = (userDataDirValue) => {
        try {
          const prefsPath = path.join(
            userDataDirValue,
            'Default',
            'Preferences'
          )
          if (!fs.existsSync(prefsPath)) {
            return undefined
          }

          const stats = fs.statSync(prefsPath)
          if (stats.size < 100) {
            return undefined
          }

          const prefsText = fs.readFileSync(prefsPath, 'utf-8')
          if (!prefsText || prefsText.trim().length === 0) {
            return undefined
          }

          const prefs = JSON.parse(prefsText)
          const settings = prefs?.extensions?.settings || {}

          const extensionEntries = Object.entries(settings).filter(
            ([, info]) => info?.path
          )
          if (extensionEntries.length === 0) {
            return undefined
          }

          const normalizedTargetPath = path.resolve(pathToExtension)
          const targetBasename = path.basename(normalizedTargetPath)

          if (extensionEntries.length === 1) {
            return extensionEntries[0][0]
          }

          for (const [id, info] of extensionEntries) {
            if (info?.path) {
              try {
                const normalizedInfoPath = path.resolve(String(info.path))
                if (normalizedInfoPath === normalizedTargetPath) {
                  return id
                }
                if (
                  fs.realpathSync(normalizedInfoPath) ===
                  fs.realpathSync(normalizedTargetPath)
                ) {
                  return id
                }
                if (path.basename(normalizedInfoPath) === targetBasename) {
                  const targetParent = path.dirname(normalizedTargetPath)
                  const infoParent = path.dirname(normalizedInfoPath)
                  if (
                    path.basename(targetParent) === path.basename(infoParent)
                  ) {
                    return id
                  }
                }
              } catch {
                continue
              }
            }
          }
        } catch {
          /* ignore preferences read errors */
        }
        return undefined
      }

      const userDataDirValue = userDataDirMap.get(context)

      try {
        const testPage = context.pages()[0] || (await context.newPage())
        const cdpSession = await context.newCDPSession(testPage)
        try {
          const targets = await cdpSession.send('Target.getTargets')
          const extensionTargets = targets.targetInfos.filter(
            (target) =>
              target.type === 'service_worker' ||
              target.url?.startsWith('chrome-extension://')
          )

          if (extensionTargets.length > 0) {
            const extensionUrl = extensionTargets[0].url
            const match = extensionUrl.match(/chrome-extension:\/\/([a-z]{32})/)
            if (match && match[1]) {
              extensionId = match[1]
            }
          }
        } finally {
          await cdpSession.detach()
        }
      } catch {
        /* CDP failed, continue to fallbacks */
      }

      if (!extensionId) {
        let [background] = context.serviceWorkers()
        if (!background) {
          try {
            background = await context.waitForEvent('serviceworker', {
              timeout: 5000
            })
          } catch {
            /* no service worker */
          }
        }
        if (background) {
          extensionId = background.url().split('/')[2]
        }
      }

      if (!extensionId && userDataDirValue) {
        await new Promise((resolve) => setTimeout(resolve, 500))

        const maxRetries = 20
        const retryDelay = 300

        for (let i = 0; i < maxRetries; i++) {
          extensionId = readExtensionIdFromPreferences(userDataDirValue)
          if (extensionId) {
            break
          }
          if (i < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, retryDelay))
          }
        }
      }

      if (!extensionId) {
        const errorDetails = userDataDirValue
          ? `Preferences file exists: ${fs.existsSync(
              path.join(userDataDirValue, 'Default', 'Preferences')
            )}`
          : 'UserDataDir not found'
        throw new Error(
          `Could not determine extension ID for ${pathToExtension}. ${errorDetails}. ` +
            `Service workers: ${context.serviceWorkers().length}`
        )
      }
      await use(extensionId)
    }
  })
}

export async function takeScreenshot(page, screenshotPath) {
  await page.screenshot({path: screenshotPath})
}

export async function getShadowRootElement(
  page,
  shadowHostSelector,
  innerSelector,
  timeoutMs = 30000
) {
  const isCI = !!process.env.CI
  const effectiveTimeout = timeoutMs === 30000 && isCI ? 60000 : timeoutMs

  await page.waitForSelector(shadowHostSelector, {
    state: 'attached',
    timeout: effectiveTimeout
  })

  const shadowHost = page.locator(shadowHostSelector)
  const shadowRootHandle = await shadowHost.evaluateHandle(
    (host) => host.shadowRoot
  )

  const startTime = Date.now()
  while (Date.now() - startTime < effectiveTimeout) {
    const element = await shadowRootHandle.evaluateHandle(
      (shadowRoot, selector) => shadowRoot?.querySelector(selector) ?? null,
      innerSelector
    )
    const elementHandle = element.asElement()
    if (elementHandle) {
      return elementHandle
    }
    await page.waitForTimeout(250)
  }

  return null
}

export async function waitForShadowElement(
  page,
  shadowHostSelector,
  innerSelector,
  timeoutMs = 30000
) {
  const isCI = !!process.env.CI
  const effectiveTimeout = timeoutMs === 30000 && isCI ? 60000 : timeoutMs

  const start = Date.now()
  while (Date.now() - start < effectiveTimeout) {
    try {
      const el = await getShadowRootElement(
        page,
        shadowHostSelector,
        innerSelector,
        timeoutMs
      )
      if (el) return el
    } catch {
      /* noop */
    }
    await page.waitForTimeout(250)
  }
  return null
}

export function getPathToExtension(exampleDir) {
  const __dirname = getDirname(import.meta.url)
  const absoluteExampleDir = path.join(__dirname, exampleDir)
  const chromeDist = path.join(absoluteExampleDir, 'dist', 'chrome')
  try {
    if (!fs.existsSync(chromeDist)) {
      execSync(`pnpm extension build ${exampleDir}`, {
        cwd: __dirname,
        stdio: 'inherit'
      })
    }
  } catch {
    /* noop */
  }
  return chromeDist
}

export async function getExtensionId(pathToExtension) {
  const os = await import('os')
  const tmpRoot = os.tmpdir()
  const userDataDirValue = fs.mkdtempSync(path.join(tmpRoot, 'pw-ext-'))
  const isHeadless = process.env.HEADLESS === 'true'
  const context = await chromium.launchPersistentContext(userDataDirValue, {
    headless: isHeadless,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
      '--no-first-run'
    ]
  })
  try {
    try {
      const prefsPath = path.join(userDataDirValue, 'Default', 'Preferences')
      const prefsText = fs.readFileSync(prefsPath, 'utf-8')
      const prefs = JSON.parse(prefsText)
      const settings = prefs?.extensions?.settings || {}
      for (const [id, info] of Object.entries(settings)) {
        if (
          info?.path &&
          path.resolve(String(info.path)) === path.resolve(pathToExtension)
        ) {
          return id
        }
      }
    } catch {
      /* noop */
    }
    let [background] = context.serviceWorkers()
    if (!background) background = await context.waitForEvent('serviceworker')
    return background.url().split('/')[2]
  } finally {
    await context.close()
  }
}

export function getSidebarPath(extensionId) {
  return `chrome-extension://${extensionId}/sidebar/index.html`
}

export function resolveBuiltExtensionPath(exampleDirAbsolute) {
  const roots = ['dist', 'build', '.extension']
  const channels = ['chrome', 'chromium', 'chrome-mv3']
  const candidateDirs = []
  for (const root of roots) {
    for (const ch of channels) {
      candidateDirs.push(path.join(exampleDirAbsolute, root, ch))
    }
  }
  const hasManifest = (dir) => {
    try {
      return fs.existsSync(path.join(dir, 'manifest.json'))
    } catch {
      return false
    }
  }
  for (const dir of candidateDirs) if (hasManifest(dir)) return dir

  const runBuild = () => {
    execSync(
      `node ../../ci-scripts/build-with-manifest.mjs build --browser=chrome`,
      {
        cwd: exampleDirAbsolute,
        stdio: 'inherit'
      }
    )
  }
  try {
    runBuild()
  } catch {
    /* noop */
  }
  if (!candidateDirs.some((dir) => hasManifest(dir))) {
    try {
      runBuild()
    } catch {
      /* noop */
    }
  }
  for (const dir of candidateDirs) if (hasManifest(dir)) return dir

  for (const root of roots) {
    const rootPath = path.join(exampleDirAbsolute, root)
    try {
      const entries = fs.readdirSync(rootPath, {withFileTypes: true})
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const dir = path.join(rootPath, entry.name)
        if (hasManifest(dir)) return dir
      }
    } catch {
      /* noop */
    }
  }

  return path.join(exampleDirAbsolute, 'dist', 'chrome')
}
