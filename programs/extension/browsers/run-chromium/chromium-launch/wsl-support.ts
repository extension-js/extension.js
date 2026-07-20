// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {type ChildProcess, type StdioOptions, spawn} from 'node:child_process'
import * as fs from 'node:fs'
import {
  hasGuiDisplay,
  isWslEnv,
  normalizeBinaryPathForWsl
} from '../../browsers-lib/wsl-support'

export {hasGuiDisplay, isWslEnv, normalizeBinaryPathForWsl}

type ChromiumLogger = {
  warn?: (...args: unknown[]) => void
}

// Known Linux install locations, in preference order. Real binaries come
// before bash wrappers so `--remote-debugging-pipe` keeps its FDs open
// (the Debian/Ubuntu `google-chrome` script uses process substitution,
// which closes extra FDs on exec, see issue covered by WXT PR #2055).
const LINUX_BROWSER_PATHS: Record<string, string[]> = {
  chrome: [
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ],
  'chromium-based': [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
  ],
  chromium: [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
  ],
  edge: ['/opt/microsoft/msedge/msedge', '/usr/bin/microsoft-edge']
}

/**
 * Native Linux browser binary for use under WSL+GUI. Prefers real binaries
 * over wrapper scripts. Returns null when not in WSL, when no GUI is
 * available, or when no candidate exists on disk.
 */
export function resolveWslLinuxBinary(browser: string): string | null {
  if (!isWslEnv() || !hasGuiDisplay()) return null
  const candidates = LINUX_BROWSER_PATHS[browser] || LINUX_BROWSER_PATHS.chrome
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

const CHROME_WRAPPER_BASENAMES = new Set([
  'google-chrome',
  'google-chrome-stable',
  'google-chrome-beta',
  'google-chrome-dev',
  'google-chrome-unstable'
])

function basename(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx === -1 ? filePath : filePath.slice(idx + 1)
}

function looksLikeChromeWrapperScript(filePath: string): boolean {
  if (!filePath) return false
  return CHROME_WRAPPER_BASENAMES.has(basename(filePath))
}

/**
 * Under WSL+GUI, swap a Chrome wrapper script for the real binary if
 * present. The wrapper closes extra file descriptors on exec, which
 * breaks `--remote-debugging-pipe`. No-op outside WSL+GUI.
 */
export function preferRealChromeBinary(
  binary: string | null | undefined
): string | null {
  if (!binary) return binary || null
  if (!isWslEnv() || !hasGuiDisplay()) return binary
  if (!looksLikeChromeWrapperScript(binary)) return binary
  const realBinary = '/opt/google/chrome/chrome'
  if (fs.existsSync(realBinary)) return realBinary
  return binary
}

export function resolveWslWindowsBinary(browser: string): string | null {
  if (!isWslEnv()) return null
  const chromeCandidates = [
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ]
  const chromiumCandidates = [
    '/mnt/c/Program Files/Chromium/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Chromium/Application/chrome.exe'
  ]
  const edgeCandidates = [
    '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ]
  const candidates =
    browser === 'edge'
      ? edgeCandidates
      : browser === 'chromium' || browser === 'chromium-based'
        ? [...chromiumCandidates, ...chromeCandidates]
        : chromeCandidates
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

export async function spawnChromiumProcess(opts: {
  binary: string
  launchArgs: string[]
  stdio: StdioOptions
  browser: string
  logger?: ChromiumLogger
}): Promise<ChildProcess> {
  const {binary, launchArgs, stdio, browser, logger} = opts
  const isWin = process.platform === 'win32'
  const spawnOnce = async (bin: string) => {
    const child = spawn(bin, launchArgs, {
      stdio,
      detached: false,
      ...(isWin ? {windowsHide: true} : {}),
      ...(process.platform !== 'win32' && {group: process.getgid?.()})
    })
    await new Promise<void>((resolve, reject) => {
      const handleError = (error: unknown) => {
        child.removeListener('spawn', handleSpawn)
        reject(error)
      }
      const handleSpawn = () => {
        child.removeListener('error', handleError)
        resolve()
      }
      child.once('error', handleError)
      child.once('spawn', handleSpawn)
    })
    return child
  }

  try {
    return await spawnOnce(binary)
  } catch (error) {
    if (isWslEnv()) {
      const fallback = resolveWslWindowsBinary(browser)
      if (fallback && fallback !== binary) {
        logger?.warn?.(
          '[browser] WSL detected: retrying with Windows browser binary.'
        )
        return await spawnOnce(fallback)
      }
    }
    throw error
  }
}
