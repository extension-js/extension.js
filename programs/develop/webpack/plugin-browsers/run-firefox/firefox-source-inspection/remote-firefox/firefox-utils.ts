// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import * as messages from '../../../browsers-lib/messages'
import {printDevBannerOnce} from '../../../browsers-lib/banner'

async function waitForManifest(outPath: string, timeoutMs = 8000) {
  const manifestPath = path.join(outPath, 'manifest.json')
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (fs.existsSync(manifestPath)) return true
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}

export async function printRunningInDevelopmentSummary(
  candidateAddonPaths: string[],
  browser: 'firefox',
  extensionId?: string,
  browserVersionLine?: string
): Promise<boolean> {
  try {
    // Prefer a path whose manifest name is not the manager name
    let chosenPath: string | null = null

    for (const p of candidateAddonPaths) {
      const isManager = /extensions\/[a-z-]+-manager/.test(String(p))
      const isDevtools = /extension-js-devtools/.test(String(p))
      const isThemePath = /extension-js-theme/.test(String(p))
      if (isManager || isDevtools || isThemePath) continue

      const mp = path.join(p, 'manifest.json')
      if (fs.existsSync(mp)) {
        const mf = JSON.parse(fs.readFileSync(mp, 'utf-8'))
        const name = mf?.name || ''
        const isThemeManifest =
          mf?.theme != null || String(mf?.type || '') === 'theme'

        if (
          typeof name === 'string' &&
          !/Extension\.js DevTools/i.test(name) &&
          !/theme/i.test(name) &&
          !isThemeManifest
        ) {
          chosenPath = p
          break
        }
      }
    }

    // Fallback to last candidate if none matched
    if (!chosenPath && candidateAddonPaths.length > 0) {
      chosenPath = candidateAddonPaths[candidateAddonPaths.length - 1]
    }

    if (!chosenPath) return false

    const manifestPath = path.join(chosenPath, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      const ready = await waitForManifest(chosenPath, 10000)
      if (!ready) return false
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const printed = await printDevBannerOnce({
      browser,
      outPath: chosenPath,
      hostPort: {host: '127.0.0.1'},
      getInfo: async () => ({
        extensionId,
        name: manifest.name,
        version: manifest.version
      }),
      browserVersionLine
    })
    return printed
  } catch {
    return false
  }
}

export function printSourceInspection(html: string) {
  console.log(messages.separatorLine())
  console.log(messages.separatorLine())
  console.log(html)
  console.log(messages.separatorLine())
}

export function printLogEventPretty(
  event: {
    id: string
    timestamp: number
    level: string
    context: string
    messageParts: string[]
    url: string
    tabId: number | undefined
  },
  color: boolean,
  colorFns: {
    red: (s: string) => string
    yellow: (s: string) => string
    gray: (s: string) => string
    blue: (s: string) => string
  },
  showTs: boolean
) {
  const ts = showTs ? new Date(event.timestamp).toISOString() + ' ' : ''
  const level = event.level
  const context = event.context
  const text = event.messageParts[0]
  const url = event.url
  const arrow =
    level === 'error'
      ? color
        ? colorFns.red('►►►')
        : '►►►'
      : level === 'warn'
        ? color
          ? colorFns.yellow('►►►')
          : '►►►'
        : level === 'log'
          ? color
            ? colorFns.gray('►►►')
            : '►►►'
          : color
            ? colorFns.blue('►►►')
            : '►►►'
  const where = url ? ` ${url}` : ''

  console.log(`${arrow} ${ts}${context}${where} - ${text}`)
}

export function printLogEventJson(event: unknown) {
  console.log(JSON.stringify(event))
}
