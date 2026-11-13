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

// A fast restart writes the next session's token before this one exits,
// so a session removes only the slots that still hold its own token.
export function clearControlToken(
  projectPath: string,
  browser: string,
  ownToken: string
): void {
  const slots = [
    controlTokenPath(projectPath, browser),
    legacyControlTokenPath(projectPath)
  ]

  for (const slot of slots) {
    try {
      if (readTokenFile(slot) === ownToken) fs.rmSync(slot, {force: true})
    } catch {
      // Ignore
    }
  }
}
