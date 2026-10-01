// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  CONTROL_TOKEN_FILE_PREFIX,
  controlTokenPath,
  legacyControlTokenPath,
  sessionStateDir
} from '../../lib/session-paths'

// Eval session token, keyed per project+browser (like the control-port file):
// a single per-project slot broke concurrent chrome+chromium sessions.
export {controlTokenPath, legacyControlTokenPath}

export function writeControlToken(
  projectPath: string,
  browser: string
): string {
  const token = crypto.randomBytes(32).toString('hex')
  const file = controlTokenPath(projectPath, browser)

  fs.mkdirSync(path.dirname(file), {recursive: true})

  // Write then chmod: writeFileSync mode is pre-umask, so set it explicitly.
  fs.writeFileSync(file, token, {encoding: 'utf-8', mode: 0o600})

  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // best-effort on platforms without POSIX modes
  }

  // Mirror to the legacy slot so an older CLI reading control.token keeps
  // working; last writer wins, no worse than the pre-fix behavior.
  try {
    const legacy = legacyControlTokenPath(projectPath)
    fs.writeFileSync(legacy, token, {encoding: 'utf-8', mode: 0o600})
    fs.chmodSync(legacy, 0o600)
  } catch {
    // Ignore
  }

  return token
}

function readTokenFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8').trim() || null
  } catch {
    return null
  }
}

function hasAnyPerBrowserToken(projectPath: string): boolean {
  try {
    return fs
      .readdirSync(sessionStateDir(projectPath))
      .some((name) => name.startsWith(CONTROL_TOKEN_FILE_PREFIX))
  } catch {
    return false
  }
}

export function readControlToken(
  projectPath: string,
  browser: string
): string | null {
  const token = readTokenFile(controlTokenPath(projectPath, browser))
  if (token) return token

  // The shared slot is last-writer-wins across browsers, so it only speaks
  // for a layout that never wrote per-browser files (older dev servers).
  if (hasAnyPerBrowserToken(projectPath)) return null

  return readTokenFile(legacyControlTokenPath(projectPath))
}

export function clearControlToken(projectPath: string, browser: string): void {
  const file = controlTokenPath(projectPath, browser)
  let token: string | null = null

  try {
    token = fs.readFileSync(file, 'utf-8').trim() || null
  } catch {
    // Ignore
  }

  try {
    fs.rmSync(file, {force: true})
  } catch {
    // Ignore
  }

  // Clear the legacy mirror only when it still holds THIS session's token,
  // a concurrent session of another browser may have re-mirrored its own.
  try {
    const legacy = legacyControlTokenPath(projectPath)

    if (token && fs.readFileSync(legacy, 'utf-8').trim() === token) {
      fs.rmSync(legacy, {force: true})
    }
  } catch {
    // Ignore
  }
}
