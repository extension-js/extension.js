// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawn} from 'node:child_process'
import {getChromeVersion} from 'chrome-location2'
import {getChromiumVersion} from 'chromium-location'
import {getEdgeVersion} from 'edge-location'
import {getFirefoxVersion} from 'firefox-location2'
import {CODES} from '../../helpers/messaging'
import * as messages from './messages'

export const VERSION_PROBE_TIMEOUT_MS = 10_000

type BinaryFlag = '--chromium-binary' | '--gecko-binary'

function normalizeVersion(text: string): string {
  return /(\d+(?:\.\d+){1,3})/.exec(text)?.[1] ?? ''
}

function killProbeTree(pid: number | undefined): void {
  if (!pid) return

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      }).on('error', () => {})
    } else {
      // The probe leads its own group, so a wrapper script takes the
      // process it started down with it.
      process.kill(-pid, 'SIGKILL')
    }
  } catch {
    // Already gone
  }
}

// null means the binary never answered. A binary that exits, fails to spawn
// or prints nothing parseable resolves '' and the card names no version.
function readVersionOutput(
  bin: string,
  args: string[],
  timeoutMs: number
): Promise<string | null> {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const settle = (value: string | null) => {
      if (settled) return

      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    let child: ReturnType<typeof spawn>

    try {
      child = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: process.platform !== 'win32',
        windowsHide: true
      })
    } catch {
      resolve('')

      return
    }

    timer = setTimeout(() => {
      killProbeTree(child.pid)
      child.stdout?.destroy()
      settle(null)
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
    })

    child.on('error', () => settle(''))
    child.on('close', (code) => settle(code === 0 ? output.trim() : ''))
  })
}

export function isVersionProbeTimeout(error: unknown): boolean {
  return (
    (error as {code?: unknown} | null)?.code ===
      CODES.E_BROWSER_BINARY_INVALID &&
    (error as {versionProbe?: unknown} | null)?.versionProbe === true
  )
}

async function execVersionProbe(
  bin: string,
  argSets: string[][],
  flag: BinaryFlag,
  timeoutMs: number
): Promise<string> {
  for (const args of argSets) {
    const output = await readVersionOutput(bin, args, timeoutMs)

    if (output === null) {
      throw Object.assign(
        new Error(
          messages.browserBinaryVersionTimedOut(
            bin,
            flag,
            Math.round(timeoutMs / 1000)
          )
        ),
        {code: CODES.E_BROWSER_BINARY_INVALID, versionProbe: true}
      )
    }

    const version = normalizeVersion(output)
    if (version) return version
  }

  return ''
}

// The location helpers read metadata first and only run the binary when told
// to, with no time limit. The run is done here instead, under a bound.
export async function probeChromiumBinaryVersion(
  bin: string,
  browser?: string,
  timeoutMs = VERSION_PROBE_TIMEOUT_MS
): Promise<string> {
  const target = String(browser || '')
  const readers: Array<(file: string) => string | null | undefined> = []

  if (target === 'edge') readers.push(getEdgeVersion)

  if (target === 'chromium' || target === 'chromium-based') {
    readers.push(getChromiumVersion)
  }

  readers.push(getChromeVersion, getChromiumVersion, getEdgeVersion)

  for (const read of readers) {
    try {
      const line = read(bin)
      if (line && String(line).trim()) return String(line).trim()
    } catch {
      // Try the next helper, one miss must not hide the launched binary.
    }
  }

  const argSets =
    process.platform === 'win32'
      ? [['--product-version'], ['--version']]
      : [['--version']]

  return execVersionProbe(bin, argSets, '--chromium-binary', timeoutMs)
}

export async function probeGeckoBinaryVersion(
  bin: string,
  timeoutMs = VERSION_PROBE_TIMEOUT_MS
): Promise<string> {
  try {
    const line = getFirefoxVersion(bin)
    if (line && String(line).trim()) return String(line).trim()
  } catch {
    // Fall through to asking the binary itself
  }

  return execVersionProbe(bin, [['--version']], '--gecko-binary', timeoutMs)
}
