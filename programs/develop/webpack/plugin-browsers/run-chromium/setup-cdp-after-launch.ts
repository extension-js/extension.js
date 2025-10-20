import * as path from 'path'
import { Compilation } from '@rspack/core'
import * as messages from '../browsers-lib/messages'
import {deriveDebugPortWithInstance} from '../browsers-lib/shared-utils'
import {printDevBannerOnce} from '../browsers-lib/banner'
import {setupUnifiedLogging} from './unified-logging'
import {CDPExtensionController} from './setup-chrome-inspection/cdp-extension-controller'
import {type PluginRuntime} from '../browsers-types'

type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'all'

export async function setupCdpAfterLaunch(
  compilation: Compilation | undefined,
  plugin: PluginRuntime,
  chromiumArgs: string[]
): Promise<void> {
  // Try to find the --load-extension flag for getting the user extension's output path
  const loadExtensionFlag = chromiumArgs.find((flag: string) =>
    flag.startsWith('--load-extension=')
  )
  const extensionOutputPath = loadExtensionFlag
    ? loadExtensionFlag.replace('--load-extension=', '').split(',')[0]
    : (compilation?.options?.output?.path as string) ||
      path.join(process.cwd(), 'dist')

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
  if (process.env.EXTENSION_ENV === 'development') {
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
  if (process.env.EXTENSION_ENV === 'development') {
      console.log(
        messages.cdpClientConnected('127.0.0.1', chromeRemoteDebugPort)
      )
  }

  // Get extension and environment info after ensuring everything is loaded
  const extensionControllerInfo = await cdpExtensionController.ensureLoaded()

  if (compilation?.options?.mode !==
    'production') {
    try {
      const bannerPrinted = await printDevBannerOnce({
        outPath: extensionOutputPath,
        browser: (plugin.browser === 'chromium-based'
          ? 'chrome'
          : plugin.browser) as 'chrome' | 'edge',
        hostPort: {host: '127.0.0.1', port: chromeRemoteDebugPort},
        getInfo: async () => extensionControllerInfo
      })

      if (!bannerPrinted) {
        await printDevBannerOnce({
          outPath: extensionOutputPath,
          browser: (plugin.browser === 'chromium-based'
            ? 'chrome'
            : plugin.browser) as 'chrome' | 'edge',
          hostPort: {host: '127.0.0.1', port: chromeRemoteDebugPort},
          getInfo: async () => cdpExtensionController.getInfoBestEffort()
        })
      }
    } catch (bannerErr) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.warn(messages.bestEffortBannerPrintFailed(String(bannerErr)))
      }
    }
  }

  await setupUnifiedLogging(cdpExtensionController, {
    level: plugin.logLevel as LogLevel,
    contexts: plugin.logContexts,
    urlFilter: plugin.logUrl,
    tabFilter: plugin.logTab,
    format: plugin.logFormat,
    timestamps: plugin.logTimestamps !== false,
    color: plugin.logColor !== false
  })

  plugin.cdpController = cdpExtensionController
}
