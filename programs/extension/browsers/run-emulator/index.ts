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
    `${prefix('info')} Emulated Chromium runs in a web page. Open this address to load your extension:\n` +
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

export type EngineOriginVerdict = 'open' | 'held' | 'throttled' | 'unknown'

export type OriginFetch = (
  url: string,
  init: {signal: AbortSignal}
) => Promise<{status: number; json(): Promise<unknown>}>

export function engineVersionUrl(viewerUrl: string): string | null {
  try {
    const parsed = new URL(viewerUrl)
    const base = parsed.pathname.endsWith('/')
      ? parsed.pathname
      : `${parsed.pathname.replace(/[^/]*$/, '')}`

    return `${parsed.origin}${base}version.json`
  } catch {
    return null
  }
}

export async function probeEngineOrigin(
  viewerUrl: string,
  fetchImpl: OriginFetch = (url, init) => fetch(url, init),
  timeoutMs = 3000
): Promise<EngineOriginVerdict> {
  const url = engineVersionUrl(viewerUrl)

  if (!url) return 'unknown'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {signal: controller.signal})

    if (response.status === 429) return 'throttled'
    if (response.status === 503) return 'held'
    if (response.status !== 200) return 'unknown'

    const report = (await response.json()) as {hold?: unknown} | null

    return report && report.hold === 'held' ? 'held' : 'open'
  } catch {
    return 'unknown'
  } finally {
    clearTimeout(timer)
  }
}

export function engineOriginLine(verdict: EngineOriginVerdict): string | null {
  if (verdict === 'held') {
    return `${prefix('warn')} emulated Chromium is not open to the public yet, so this address answers 503 until it is. Run this project with --browser=chrome in the meantime.`
  }

  if (verdict === 'throttled') {
    return `${prefix('warn')} the emulated Chromium origin is rate limiting this address (HTTP 429). Wait a minute, then run extension dev again, or run this project with --browser=chrome.`
  }

  return null
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
  opener: UrlOpener = openInDefaultBrowser,
  probe: (url: string) => Promise<EngineOriginVerdict> = probeEngineOrigin
): Promise<EmulatorController> {
  if ((opts.mode || 'production') !== 'development') {
    throw new Error(
      'emulated Chromium needs the dev server that serves the files the page reads. Run extension dev instead.'
    )
  }

  const url = opts.emulatorViewerUrl

  if (!url) {
    throw new Error(
      'this version of extension-develop does not serve emulated Chromium. Update extension-develop so it matches the CLI, then run extension dev again.'
    )
  }

  console.log(emulatorViewerUrlLine(url))

  const willOpen = !opts.noOpen && !opts.dryRun
  const verdict = willOpen ? await probe(url) : 'unknown'
  const originLine = engineOriginLine(verdict)

  if (originLine) console.warn(originLine)

  if (willOpen && !originLine) opener(url)

  const logsRequested = Boolean(opts.logLevel && opts.logLevel !== 'off')

  return {
    async enableUnifiedLogging() {
      if (logsRequested) console.warn(emulatorLogsLimitLine())
    }
  }
}
