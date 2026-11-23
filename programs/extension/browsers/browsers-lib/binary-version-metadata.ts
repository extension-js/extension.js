// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'
import {getChromeVersion} from 'chrome-location2'
import {getChromiumVersion} from 'chromium-location'
import {getEdgeVersion} from 'edge-location'
import {getFirefoxVersion} from 'firefox-location2'

// A cold PowerShell start can take seconds, so the read is bounded and a
// slow one reads as no version, like a failed one.
export const WINDOWS_VERSION_READ_TIMEOUT_MS = 5000

const PATH_VARIABLE = 'EXTENSION_VERSION_READ_PATH'

// The path travels in a variable, so no text from it is ever read as script.
const READ_COMMAND = `[System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:${PATH_VARIABLE}).ProductVersion`

type Run = (
  bin: string,
  args: string[],
  options: {
    encoding: 'utf8'
    env: Record<string, string | undefined>
    stdio: ['ignore', 'pipe', 'ignore']
    timeout: number
    windowsHide: true
  }
) => {status: number | null; stdout: string | null}

const runPowerShell: Run = (bin, args, options) =>
  spawnSync(bin, args, {...options, env: options.env as NodeJS.ProcessEnv})

// A static .NET call loads no module. Get-Item made PowerShell discover its
// modules first, which took 22 seconds a read with no analysis cache.
export function readWindowsProductVersion(
  file: string,
  run: Run = runPowerShell,
  env: Record<string, string | undefined> = process.env,
  timeoutMs = WINDOWS_VERSION_READ_TIMEOUT_MS
): string {
  try {
    const result = run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', READ_COMMAND],
      {
        encoding: 'utf8',
        env: {...env, [PATH_VARIABLE]: file},
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: timeoutMs,
        windowsHide: true
      }
    )

    return result.status === 0 ? String(result.stdout || '').trim() : ''
  } catch {
    return ''
  }
}

const CHROMIUM_VERSION = /(\d+(?:\.\d+){1,3})/
const GECKO_VERSION = /(\d+(?:\.\d+){1,3}(?:[a-z]+\d*)?)/i

type Version = string | null | undefined

// Windows keeps the version in the file's metadata for every browser, so
// one read answers there. Elsewhere each location helper knows its bundle.
function windowsVersion(file: string, version: RegExp): Version {
  return version.exec(readWindowsProductVersion(file))?.[1] ?? null
}

const onWindows = () => process.platform === 'win32'

export function readChromeVersion(file: string): Version {
  return onWindows()
    ? windowsVersion(file, CHROMIUM_VERSION)
    : getChromeVersion(file)
}

export function readChromiumVersion(file: string): Version {
  return onWindows()
    ? windowsVersion(file, CHROMIUM_VERSION)
    : getChromiumVersion(file)
}

export function readEdgeVersion(file: string): Version {
  return onWindows()
    ? windowsVersion(file, CHROMIUM_VERSION)
    : getEdgeVersion(file)
}

export function readFirefoxVersion(file: string): Version {
  return onWindows()
    ? windowsVersion(file, GECKO_VERSION)
    : getFirefoxVersion(file)
}
