// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Readable, Writable} from 'node:stream'
import {
  printDevBannerOnce,
  printProdBannerOnce
} from '../../browsers-lib/banner'
import * as messages from '../../browsers-lib/messages'
import {stampReadyExtensionLoadRefused} from '../../browsers-lib/ready-stamp'
import {deriveDebugPortWithInstance} from '../../browsers-lib/shared-utils'
import type {CompilationLike} from '../../browsers-types'
import {CDPExtensionController} from '../cdp/cdp-extension-controller'
import type {ChromiumPluginRuntime} from '../chromium-types'
import {getExtensionOutputPath} from './extension-output-path'

// True when the emitted manifest overrides the new tab page. Also check the
// prefixed keys: a raw --load-extension dir may never have been de-prefixed.
function manifestDeclaresNewtabOverride(outPath: string): boolean {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(outPath, 'manifest.json'), 'utf-8')
    )
    const overrides =
      manifest?.chrome_url_overrides ||
      manifest?.['chromium:chrome_url_overrides'] ||
      manifest?.['chrome:chrome_url_overrides']
    return Boolean(overrides && typeof overrides.newtab === 'string')
  } catch {
    return false
  }
}

export async function setupCdpAfterLaunch(
  compilation: CompilationLike | undefined,
  plugin: ChromiumPluginRuntime,
  chromiumArgs: string[],
  pipeStreams?: {input: Readable; output: Writable}
): Promise<void> {
  const loadExtensionFlag = chromiumArgs.find((flag: string) =>
    flag.startsWith('--load-extension=')
  )
  const extensionOutputPath = getExtensionOutputPath(
    compilation,
    loadExtensionFlag
  )
  const extensionPaths = loadExtensionFlag
    ? loadExtensionFlag
        .replace('--load-extension=', '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  const selectedExtensionPaths =
    extensionOutputPath && extensionOutputPath.length > 0
      ? [extensionOutputPath]
      : extensionPaths

  const remoteDebugPortFlag = chromiumArgs.find((flag: string) =>
    flag.startsWith('--remote-debugging-port=')
  )

  const chromeRemoteDebugPort = remoteDebugPortFlag
    ? parseInt(remoteDebugPortFlag.split('=')[1], 10)
    : deriveDebugPortWithInstance(
        plugin.port as number | string,
        plugin.instanceId
      )

  const userDataDirFlag = chromiumArgs.find((flag: string) =>
    flag.startsWith('--user-data-dir=')
  )
  const userDataDir = userDataDirFlag
    ? userDataDirFlag.replace('--user-data-dir=', '').replace(/^"|"$/g, '')
    : ''

  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    if (userDataDir) console.log(messages.devChromeProfilePath(userDataDir))

    console.log(
      messages.devChromiumDebugPort(
        chromeRemoteDebugPort,
        chromeRemoteDebugPort
      )
    )
  }

  const cdpExtensionController = new CDPExtensionController({
    outPath: extensionOutputPath,
    browser: (plugin.browser === 'chromium-based'
      ? 'chrome'
      : plugin.browser) as 'chrome' | 'edge' | 'chromium-based',
    cdpPort: chromeRemoteDebugPort,
    profilePath: userDataDir || undefined,
    extensionPaths: selectedExtensionPaths,
    pipeIn: pipeStreams?.input,
    pipeOut: pipeStreams?.output,
    logSink: plugin.logSink
  })

  // connectToChromeCdp already performs bounded startup retries internally.
  // Avoid layering another retry loop here, which can make startup feel hung.
  await cdpExtensionController.connect()

  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    console.log(messages.cdpClientConnected('127.0.0.1', chromeRemoteDebugPort))
  }

  try {
    if (extensionOutputPath && Number.isFinite(chromeRemoteDebugPort)) {
      const readyPath = path.join(
        path.dirname(extensionOutputPath),
        'extension-js',
        path.basename(extensionOutputPath),
        'ready.json'
      )

      if (fs.existsSync(readyPath)) {
        const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))

        if (ready.cdpPort !== chromeRemoteDebugPort) {
          ready.cdpPort = chromeRemoteDebugPort
          fs.writeFileSync(readyPath, JSON.stringify(ready, null, 2))
        }
      }
    }
  } catch {
    // best-effort; never block launch on this
  }

  // Ask the browser whether the guest actually loaded BEFORE any banner: the
  // banner's id falls back to a path hash, so it prints happily for an
  // extension the browser threw away (§83).
  const loadOutcome =
    (await cdpExtensionController.verifyGuestLoaded?.()) ??
    ({status: 'unknown'} as const)

  if (loadOutcome.status === 'refused') {
    const refusedPath = extensionOutputPath || selectedExtensionPaths[0] || ''
    console.error(
      messages.chromiumExtensionLoadRefused(refusedPath, loadOutcome.reason)
    )
    plugin.logSink?.({
      level: 'error',
      text: `extension_load_refused: ${refusedPath}${
        loadOutcome.reason ? ` - ${loadOutcome.reason}` : ''
      }`,
      source: 'browser'
    })
    stampReadyExtensionLoadRefused(extensionOutputPath, loadOutcome.reason)

    // No banner and no Extension ID: there is nothing in the browser to name.
    // The flag withholds the launch path's "ready for development" claim.
    plugin.extensionLoadRefused = loadOutcome.reason
    plugin.cdpController = cdpExtensionController
    // Bind the banner the refusal just withheld, so a later compile that gets
    // the dist accepted can finally name the guest the browser is running.
    plugin.printBannerOnRecovery = async () => {
      await printDevBannerOnce({
        outPath: extensionOutputPath,
        browser: plugin.browser,
        hostPort: {host: '127.0.0.1', port: chromeRemoteDebugPort},
        getInfo: async () => cdpExtensionController.getInfoBestEffort(),
        browserVersionLine: plugin.browserVersionLine
      })
    }
    return
  }

  const mode = (compilation?.options?.mode || 'development') as string
  let earlyBannerPrinted = false

  // Fast path: print banner from manifest/fallback data before CDP handshake.
  // If no extension ID can be derived yet, later passes still print it.
  if (mode === 'development') {
    try {
      earlyBannerPrinted = await printDevBannerOnce({
        outPath: extensionOutputPath,
        browser: plugin.browser,
        hostPort: {host: '127.0.0.1', port: chromeRemoteDebugPort},
        getInfo: async () => null,
        browserVersionLine: plugin.browserVersionLine
      })
    } catch {
      // best-effort only
    }
  }

  if (mode === 'development') {
    try {
      earlyBannerPrinted = await printDevBannerOnce({
        outPath: extensionOutputPath,
        browser: plugin.browser,
        hostPort: {host: '127.0.0.1', port: chromeRemoteDebugPort},
        getInfo: async () => cdpExtensionController.getInfoBestEffort(),
        browserVersionLine: plugin.browserVersionLine
      })
    } catch {
      // best-effort only
    }
  }

  let extensionControllerInfo: {
    extensionId: string
    name?: string
    version?: string
  } | null = null
  try {
    const ensureLoadedTimeoutMs = 10000
    extensionControllerInfo = await Promise.race([
      cdpExtensionController.ensureLoaded(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(`ensureLoaded timeout (${ensureLoadedTimeoutMs}ms)`)
            ),
          ensureLoadedTimeoutMs
        )
      })
    ])
  } catch (error) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.warn(
        `[CDP] ensureLoaded failed: ${String(
          (error as Error)?.message || error
        )}`
      )
    }
  }

  try {
    if (mode === 'development') {
      if (!earlyBannerPrinted) {
        const bannerPrinted = await printDevBannerOnce({
          outPath: extensionOutputPath,
          browser: plugin.browser,
          hostPort: {host: '127.0.0.1', port: chromeRemoteDebugPort},
          getInfo: async () => extensionControllerInfo,
          browserVersionLine: plugin.browserVersionLine
        })

        if (!bannerPrinted) {
          await printDevBannerOnce({
            outPath: extensionOutputPath,
            browser: plugin.browser,
            hostPort: {host: '127.0.0.1', port: chromeRemoteDebugPort},
            getInfo: async () => cdpExtensionController.getInfoBestEffort(),
            browserVersionLine: plugin.browserVersionLine
          })
        }
      }
    } else if (mode === 'production') {
      const runtime = extensionControllerInfo
        ? {
            extensionId: extensionControllerInfo.extensionId,
            name: extensionControllerInfo.name,
            version: extensionControllerInfo.version
          }
        : undefined
      await printProdBannerOnce({
        browser: plugin.browser,
        outPath: extensionOutputPath,
        browserVersionLine: plugin.browserVersionLine,
        runtime
      })
    }
  } catch (bannerErr) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.warn(messages.bestEffortBannerPrintFailed(String(bannerErr)))
    }

    // Fallback: even if CDP/rich info fails, try to print a manifest-based
    // production summary so users still see a banner.
    try {
      const mode = (compilation?.options?.mode || 'development') as string
      if (mode === 'production') {
        await printProdBannerOnce({
          browser: plugin.browser,
          outPath: extensionOutputPath,
          browserVersionLine: plugin.browserVersionLine
        })
      }
    } catch {
      // best-effort only
    }
  }

  // The launch tab predates extension registration, so it shows the default new
  // tab; open a fresh tab onto the newtab override. Skipped for startingUrl/--no-open.
  try {
    if (
      extensionControllerInfo &&
      !plugin.startingUrl &&
      !plugin.noOpen &&
      manifestDeclaresNewtabOverride(extensionOutputPath)
    ) {
      await cdpExtensionController.openTab('chrome://newtab/')
    }
  } catch {
    // best-effort only, never block launch on the courtesy tab
  }

  plugin.cdpController = cdpExtensionController
}
