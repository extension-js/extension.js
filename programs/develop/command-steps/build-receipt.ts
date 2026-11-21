// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {NormalizedBrowser} from '../lib/paths'
import {readReadyRecord} from '../lib/ready-contract-writer'
import {readyContractPath} from '../lib/session-paths'
import {
  createReadyContractWriter,
  getSessionRunId
} from '../plugin-ready-contract'
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
    createReadyContractWriter({
      packageJsonDir,
      browser: String(browser),
      command: metadataCommand,
      distPath,
      manifestPath,
      port: configOptions.port,
      host: (configOptions as {host?: string}).host,
      instanceExplicit: configOptions.instanceExplicit,
      controlPortUnavailableReason: configOptions.controlPortUnavailableReason,
      controlPath: configOptions.controlPath,
      logsPath: configOptions.logsPath
    })

  // The receipt this run's compile left open: its own run, still starting.
  const heldReceipt = (): {compiledAt?: unknown} | undefined => {
    if (liveDevSession) return undefined

    const contract = readReadyRecord(readyContractPath(packageJsonDir, browser))
    const ownRun =
      contract?.runId === getSessionRunId(packageJsonDir, String(browser))

    return ownRun && contract?.status === 'starting' ? contract : undefined
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
