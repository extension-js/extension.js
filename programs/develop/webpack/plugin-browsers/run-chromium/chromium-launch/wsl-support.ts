import * as fs from 'fs'
import {spawn, ChildProcess} from 'child_process'
import * as os from 'os'

type ChromiumLogger = {
  warn?: (...args: unknown[]) => void
}

export function isWslEnv(): boolean {
  // Guard against false positives on native Windows where WSLENV may be set.
  if (process.platform !== 'linux') return false

  const hasWslEnv = Boolean(
    String(process.env.WSL_DISTRO_NAME || '').trim() ||
      String(process.env.WSL_INTEROP || '').trim() ||
      String(process.env.WSLENV || '').trim()
  )
  if (hasWslEnv) return true

  // Fallback heuristic for Linux environments where env vars are unavailable.
  return /microsoft/i.test(os.release())
}

export function normalizeBinaryPathForWsl(input: string): string {
  let value = String(input || '').trim()
  if (!value) return value
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  if (!isWslEnv()) return value
  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    const drive = value[0].toLowerCase()
    const rest = value.slice(2).replace(/\\/g, '/').replace(/^\/+/, '')
    return `/mnt/${drive}/${rest}`
  }
  return value
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
  stdio: 'ignore'
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
          '[plugin-browsers] WSL detected: retrying with Windows browser binary.'
        )
        return await spawnOnce(fallback)
      }
    }
    throw error
  }
}
