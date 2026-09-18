// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawn} from 'node:child_process'
import colors from 'pintor'
import {EMULATOR_LOGS_REFUSAL} from '../../helpers/emulator-session'
import {prefix} from '../../helpers/messaging'

export interface EmulatorLaunchOptions {
  browser: string
  mode?: 'development' | 'production'
  noOpen?: boolean
  dryRun?: boolean
  logLevel?: string
  emulatorViewerUrl?: string
}

export interface EmulatorController {
  enableUnifiedLogging(): Promise<void>
}

export type UrlOpener = (url: string) => void

export function emulatorViewerUrlLine(url: string): string {
  return (
    `${prefix('info')} Emulated Chromium runs in a web page. Open it at:\n` +
    `${colors.underline(url)}`
  )
}

export function emulatorLogsLimitLine(): string {
  return `${prefix('warn')} --logs has no effect here: ${EMULATOR_LOGS_REFUSAL}`
}

export function openCommandFor(
  url: string,
  platform: NodeJS.Platform = process.platform
): {command: string; args: string[]} {
  if (platform === 'darwin') return {command: 'open', args: [url]}

  if (platform === 'win32') {
    return {command: 'rundll32', args: ['url.dll,FileProtocolHandler', url]}
  }

  return {command: 'xdg-open', args: [url]}
}

export function openInDefaultBrowser(url: string): void {
  const {command, args} = openCommandFor(url)

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.on('error', () => {})
    child.unref()
  } catch {
    return
  }
}

export async function launchEmulator(
  opts: EmulatorLaunchOptions,
  opener: UrlOpener = openInDefaultBrowser
): Promise<EmulatorController> {
  if ((opts.mode || 'production') !== 'development') {
    throw new Error(
      'emulated Chromium runs only under extension dev, whose dev server serves the files the page reads.'
    )
  }

  const url = opts.emulatorViewerUrl

  if (!url) {
    throw new Error(
      'this extension-develop version does not serve emulated Chromium; update extension-develop to match the CLI.'
    )
  }

  console.log(emulatorViewerUrlLine(url))

  if (!opts.noOpen && !opts.dryRun) opener(url)

  const logsRequested = Boolean(opts.logLevel && opts.logLevel !== 'off')

  return {
    async enableUnifiedLogging() {
      if (logsRequested) console.warn(emulatorLogsLimitLine())
    }
  }
}
