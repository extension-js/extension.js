// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {Compilation} from '@rspack/core'
import * as messages from '../../browsers-lib/messages'
import {deriveDebugPortWithInstance} from '../../browsers-lib/shared-utils'
import {
  printDevBannerOnce,
  printProdBannerOnce
} from '../../browsers-lib/banner'
import {CDPExtensionController} from '../chromium-source-inspection/cdp-extension-controller'
import {type ChromiumPluginRuntime} from '../chromium-types'
import {getExtensionOutputPath} from './extension-output-path'

export async function setupCdpAfterLaunch(
  compilation: Compilation | undefined,
  plugin: ChromiumPluginRuntime,
  chromiumArgs: string[]
): Promise<void> {
  // Try to find the --load-extension flag for getting the user extension's output path
  const loadExtensionFlag = chromiumArgs.find((flag: string) =>
    flag.startsWith('--load-extension=')
  )
  const extensionOutputPath = getExtensionOutputPath(
    compilation,
    loadExtensionFlag
  )

  // Try to find the --remote-debugging-port flag (for CDP port)
  const remoteDebugPortFlag = chromiumArgs.find((flag: string) =>
    flag.startsWith('--remote-debugging-port=')
  )

  const chromeRemoteDebugPort = remoteDebugPortFlag
    ? parseInt(remoteDebugPortFlag.split('=')[1], 10)
    : deriveDebugPortWithInstance(
        plugin.port as number | string,
        plugin.instanceId
      )

  // Log the Chrome user data directory and debug port if in development
  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    const userDataDirFlag = chromiumArgs.find((flag: string) =>
      flag.startsWith('--user-data-dir=')
    )

    if (userDataDirFlag) {
      const userDataDir = userDataDirFlag
        .replace('--user-data-dir=', '')
        .replace(/^"|"$/g, '')

      console.log(messages.devChromeProfilePath(userDataDir))
    }

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
    cdpPort: chromeRemoteDebugPort
  })

  // Utility function to retry an async operation a certain number of times
  const retryAsync = async <T>(
    operation: () => Promise<T>,
    attempts = 5,
    initialDelayMs = 150
  ) => {
    let lastError: unknown

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        const backoffMs = initialDelayMs * Math.pow(2, attempt)
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
      }
    }

    throw lastError
  }

  await retryAsync(() => cdpExtensionController.connect())
  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    console.log(messages.cdpClientConnected('127.0.0.1', chromeRemoteDebugPort))
  }

  // Get extension and environment info after ensuring everything is loaded
  let extensionControllerInfo: {
    extensionId: string
    name?: string
    version?: string
  } | null = null
  try {
    extensionControllerInfo = await cdpExtensionController.ensureLoaded()
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
    const mode = (compilation?.options?.mode || 'development') as string

    if (mode === 'development') {
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

  plugin.cdpController = cdpExtensionController
}
