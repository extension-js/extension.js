// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import type {NormalizedBrowser} from '../lib/paths'
import {readyContractPath} from '../lib/session-paths'
import {
  createPlaywrightMetadataWriter,
  getSessionRunId
} from '../plugin-playwright'
import type {WebpackConfigOptions} from '../types'

// The receipt of a build is the ready contract its compile opened. These read
// and close it once the output is in place.
export function createBuildReceipt(input: {
  packageJsonDir: string
  browser: NormalizedBrowser
  metadataCommand: NonNullable<WebpackConfigOptions['metadataCommand']>
  distPath: string
  manifestPath: string
  configOptions: WebpackConfigOptions
  liveDevSession: unknown
  launchFollows: boolean | undefined
}) {
  const {
    packageJsonDir,
    browser,
    metadataCommand,
    distPath,
    manifestPath,
    configOptions,
    liveDevSession,
    launchFollows
  } = input

  // Opened after the plugin's own writer, with the options the plugin got,
  // so the document keeps every field the compile wrote.
  const openReceipt = () =>
    createPlaywrightMetadataWriter({
      packageJsonDir,
      browser: String(browser),
      command: metadataCommand,
      distPath,
      manifestPath,
      port: configOptions.port,
      host:
        process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST ||
        (configOptions as {host?: string}).host,
      instanceId: configOptions.instanceId,
      instanceExplicit: configOptions.instanceExplicit,
      controlPort: configOptions.controlPort,
      controlPortUnavailableReason: configOptions.controlPortUnavailableReason,
      controlPath: configOptions.controlPath,
      logsPath: configOptions.logsPath
    })

  // The receipt this run's compile left open: its own run, still starting.
  const heldReceipt = (): {compiledAt?: unknown} | undefined => {
    if (liveDevSession) return undefined

    try {
      const contract = JSON.parse(
        fs.readFileSync(readyContractPath(packageJsonDir, browser), 'utf-8')
      )
      const ownRun =
        contract?.runId === getSessionRunId(packageJsonDir, String(browser))

      return ownRun && contract.status === 'starting' ? contract : undefined
    } catch {
      return undefined
    }
  }

  const writeReadyWhenHeld = () => {
    if (
      launchFollows !== true &&
      typeof heldReceipt()?.compiledAt === 'string'
    ) {
      openReceipt().writeReady()
    }
  }

  return {openReceipt, heldReceipt, writeReadyWhenHeld}
}
